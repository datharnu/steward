import { type SealKeyPair } from "@qorechain/qoreseal";
import { type UnifiedAccount } from "@qorechain/sdk";
import { readMlDsaKey, requireMlDsaKey } from "haven-pq-kit";
import { hexToBytes, type Address, type Hex, type PublicClient } from "viem";
import { openAndVerifyMandate, type MandatePayload, type SealedMandate } from "../src/ts/mandate.js";
import { ERC20_ABI, PAYGATE_ABI, invoiceKey } from "../src/ts/paygate.js";
import { clampDecision, type GateSnapshot, type InvoiceRecord } from "../src/ts/policy.js";
import { type SignedReceipt } from "../src/ts/receipts.js";
import { type ChainExecutor, type StateStore } from "./executor.js";
import { type InboxAdapter, verifyInvoiceOffChain } from "./inbox.js";
import { type Planner } from "./planner.js";
import { type ReceiptStore } from "./receipt-store.js";

export type GateReader = (vendor: Address, invoiceId: Hex) => Promise<GateSnapshot>;

export function createChainGateReader(publicClient: PublicClient, gate: Address): GateReader {
  return async (vendor: Address, invoiceId: Hex): Promise<GateSnapshot> => {
    const key = invoiceKey(vendor, invoiceId);
    const [tokenAddress, paused, dailyCap, spentToday, vendorTuple, invState] = await Promise.all([
      publicClient.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "token" }),
      publicClient.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "paused" }),
      publicClient.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "dailyCap" }),
      publicClient.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "spentToday" }),
      publicClient.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "vendors", args: [vendor] }),
      publicClient.readContract({ address: gate, abi: PAYGATE_ABI, functionName: "invoiceState", args: [key] }),
    ]);
    const gateBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [gate],
    });
    return {
      gateAddress: gate,
      tokenAddress,
      paused,
      dailyCap,
      spentToday,
      gateBalance,
      vendor: {
        active: vendorTuple[0],
        payout: vendorTuple[1],
        perInvoiceCap: vendorTuple[2],
        epoch: vendorTuple[3],
      },
      invoiceState: Number(invState) as 0 | 1 | 2,
    };
  };
}

export class StewardAgent {
  private readonly chainId: string;
  private readonly evmChainId: bigint;
  private readonly gate: Address;
  private readonly ownerCosmos: string;
  private readonly ownerEvm: Address;
  private readonly agentAccount: UnifiedAccount;
  private readonly agentSealKeys: SealKeyPair;
  private readonly publicClient: PublicClient;
  private readonly readGate: GateReader;
  private readonly planner: Planner;
  private readonly executor: ChainExecutor;
  private readonly state: StateStore;
  private readonly receipts: ReceiptStore;
  private readonly verifySig: (invoice: InvoiceRecord) => Promise<boolean>;

  constructor(opts: {
    chainId: string;
    evmChainId: bigint;
    gate: Address;
    ownerCosmos: string;
    ownerEvm: Address;
    agentAccount: UnifiedAccount;
    agentSealKeys: SealKeyPair;
    publicClient: PublicClient;
    readGate?: GateReader;
    planner: Planner;
    executor: ChainExecutor;
    state: StateStore;
    receipts: ReceiptStore;
    verifySig?: (invoice: InvoiceRecord) => Promise<boolean>;
  }) {
    this.chainId = opts.chainId;
    this.evmChainId = opts.evmChainId;
    this.gate = opts.gate;
    this.ownerCosmos = opts.ownerCosmos;
    this.ownerEvm = opts.ownerEvm;
    this.agentAccount = opts.agentAccount;
    this.agentSealKeys = opts.agentSealKeys;
    this.publicClient = opts.publicClient;
    this.readGate = opts.readGate ?? createChainGateReader(opts.publicClient, opts.gate);
    this.planner = opts.planner;
    this.executor = opts.executor;
    this.state = opts.state;
    this.receipts = opts.receipts;
    this.verifySig =
      opts.verifySig ??
      (async (invoice) => {
        const res = await verifyInvoiceOffChain({
          client: opts.publicClient,
          chainId: opts.evmChainId,
          gate: opts.gate,
          invoice,
        });
        return res.valid;
      });
  }

  loadMandate(sealed: SealedMandate, ownerPqPubkey?: Uint8Array, nowUnix?: number): Promise<MandatePayload> {
    return this.verifyMandateInternal(sealed, ownerPqPubkey, nowUnix);
  }

  private async verifyMandateInternal(
    sealed: SealedMandate,
    ownerPqPubkey?: Uint8Array,
    nowUnix?: number,
  ): Promise<MandatePayload> {
    let pubkey = ownerPqPubkey;
    if (!pubkey) {
      const onChain = await readMlDsaKey(this.publicClient, this.ownerEvm);
      requireMlDsaKey(onChain);
      pubkey = hexToBytes(onChain.pubkey);
    }
    const replayedIds = new Set(
      this.state.data.consumedMandateIds.filter((id) => id !== this.state.data.activeMandateId),
    );
    const payload = openAndVerifyMandate({
      sealed,
      agentSealKeys: this.agentSealKeys,
      expectedChainId: this.chainId,
      expectedGate: this.gate,
      expectedOwnerCosmos: this.ownerCosmos,
      expectedAgentCosmos: this.agentAccount.cosmos,
      ownerPqPublicKey: pubkey,
      replayedIds,
      nowUnix,
    });
    if (this.state.data.activeMandateId !== payload.mandateId) {
      if (this.state.data.activeMandateId && !this.state.data.consumedMandateIds.includes(this.state.data.activeMandateId)) {
        this.state.data.consumedMandateIds.push(this.state.data.activeMandateId);
      }
      this.state.data.activeMandateId = payload.mandateId;
      this.state.save();
    }
    return payload;
  }

  async processInvoice(
    invoice: InvoiceRecord,
    mandate: MandatePayload,
    nowUnix = Math.floor(Date.now() / 1000),
  ): Promise<SignedReceipt> {
    await this.executor.reconcilePending();

    const [vendorSigValid, gate] = await Promise.all([
      this.verifySig(invoice),
      this.readGate(invoice.vendor, invoice.invoiceId),
    ]);

    const spent = this.state.spentForMandate(mandate.mandateId);
    const proposal = await this.planner.propose(invoice, {
      mandate,
      mandateBudgetSpent: spent,
      gate,
      nowUnix,
    });

    const decision = clampDecision({
      invoice,
      vendorSigValid,
      mandate,
      mandateBudgetSpent: spent,
      gate,
      agentLocallyPaused: this.state.data.locallyPaused,
      proposal,
      nowUnix,
    });

    let txHash: string | undefined;
    let txStatus: SignedReceipt["body"]["txStatus"] = "none";

    if (decision.willExecuteOnChain && (decision.action === "pay" || decision.action === "queue")) {
      const exec = await this.executor.execute(decision.action, invoice, mandate.mandateId);
      txHash = exec.txHash;
      txStatus = exec.status;
    }

    return this.receipts.append({
      bodyWithoutChain: {
        timestamp: nowUnix,
        chainId: this.chainId,
        gate: this.gate,
        mandateId: mandate.mandateId,
        invoiceKey: invoiceKey(invoice.vendor, invoice.invoiceId),
        vendor: invoice.vendor,
        invoiceId: invoice.invoiceId,
        amount: invoice.amount,
        planner: proposal.planner ?? this.planner.name,
        plannerAction: proposal.action,
        plannerReason: proposal.reason,
        finalAction: decision.action,
        decisionCode: decision.code,
        decisionReason: decision.reason,
        txHash,
        txStatus,
      },
      secretKey: this.agentAccount.pqc.secretKey,
      publicKey: this.agentAccount.pqc.publicKey,
    });
  }

  async drainInbox(inbox: InboxAdapter, mandate: MandatePayload, nowUnix?: number): Promise<SignedReceipt[]> {
    const items = await inbox.listPending();
    const out: SignedReceipt[] = [];
    for (const item of items) {
      out.push(await this.processInvoice(item.invoice, mandate, nowUnix));
      await inbox.markHandled(item.id);
    }
    return out;
  }
}
