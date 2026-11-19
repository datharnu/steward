import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { evmAuthSignBytesV2, fetchAuthNonce, type UnifiedAccount } from "@qorechain/sdk";
import { TESTNET } from "haven-pq-kit";
import { encodeFunctionData, hexToBytes, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PAYGATE_ABI, invoiceKey } from "../src/ts/paygate.js";
import { type InvoiceRecord } from "../src/ts/policy.js";
import { type Relayer } from "./relayer.js";

export type PendingFlight = {
  invoiceKey: Hex;
  vendor: Address;
  invoiceId: Hex;
  action: "pay" | "queue";
  amount: string;
  authNonce: string;
  startedAt: number;
};

export type PersistedAgentState = {
  mandateSpentById: Record<string, string>;
  consumedMandateIds: string[];
  activeMandateId?: string;
  locallyPaused: boolean;
  pendingFlight?: PendingFlight;
};

export type ExecuteResult = {
  status: "confirmed" | "failed_execution" | "unknown";
  txHash?: string;
  reason?: string;
};

export interface ChainExecutor {
  reconcilePending(): Promise<{ resolved: boolean; status?: "confirmed" | "failed_execution" | "rejected" }>;
  execute(action: "pay" | "queue", invoice: InvoiceRecord, mandateId: string): Promise<ExecuteResult>;
}

export class StateStore {
  readonly path: string;
  data: PersistedAgentState;

  constructor(path = "agent-state/state.json") {
    this.path = path;
    if (existsSync(path)) {
      this.data = JSON.parse(readFileSync(path, "utf8")) as PersistedAgentState;
    } else {
      this.data = {
        mandateSpentById: {},
        consumedMandateIds: [],
        locallyPaused: false,
      };
    }
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.data, null, 2)}\n`);
  }

  spentForMandate(mandateId: string): bigint {
    const base = BigInt(this.data.mandateSpentById[mandateId] ?? "0");
    // An in-flight / unknown-outcome payment is conservatively counted as spent until reconciled.
    const pending =
      this.data.pendingFlight && this.data.pendingFlight.action === "pay"
        ? BigInt(this.data.pendingFlight.amount)
        : 0n;
    return base + pending;
  }

  addSpent(mandateId: string, amount: bigint): void {
    const cur = BigInt(this.data.mandateSpentById[mandateId] ?? "0");
    this.data.mandateSpentById[mandateId] = (cur + amount).toString();
    this.save();
  }
}

export class QoreChainExecutor implements ChainExecutor {
  private readonly publicClient: PublicClient;
  private readonly gate: Address;
  private readonly ownerCosmos: string;
  private readonly agentKey: UnifiedAccount;
  private readonly relayer: Relayer;
  private readonly state: StateStore;
  private readonly restUrl: string;
  private readonly gasLimit: bigint;

  constructor(opts: {
    publicClient: PublicClient;
    gate: Address;
    ownerCosmos: string;
    agentKey: UnifiedAccount;
    relayer: Relayer;
    state: StateStore;
    restUrl?: string;
    gasLimit?: bigint;
  }) {
    this.publicClient = opts.publicClient;
    this.gate = opts.gate;
    this.ownerCosmos = opts.ownerCosmos;
    this.agentKey = opts.agentKey;
    this.relayer = opts.relayer;
    this.state = opts.state;
    this.restUrl = opts.restUrl ?? TESTNET.rest;
    this.gasLimit = opts.gasLimit ?? 800_000n;
  }

  /** "Did it land?" check before any retry, so nothing is ever paid twice. */
  async reconcilePending(): Promise<{ resolved: boolean; status?: "confirmed" | "failed_execution" | "rejected" }> {
    const pending = this.state.data.pendingFlight;
    if (!pending) return { resolved: true };

    const invState = Number(
      await this.publicClient.readContract({
        address: this.gate,
        abi: PAYGATE_ABI,
        functionName: "invoiceState",
        args: [pending.invoiceKey],
      }),
    );

    if ((pending.action === "pay" && invState === 2) || (pending.action === "queue" && invState === 1)) {
      if (pending.action === "pay" && this.state.data.activeMandateId) {
        this.state.addSpent(this.state.data.activeMandateId, BigInt(pending.amount));
      }
      this.state.data.pendingFlight = undefined;
      this.state.save();
      return { resolved: true, status: "confirmed" };
    }

    const pubkey = hexToBytes(this.agentKey.evm as Hex);
    const currentNonce = (
      await fetchAuthNonce({ rest: this.restUrl, address: this.ownerCosmos, pubkey })
    ).nonce;
    if (BigInt(currentNonce) > BigInt(pending.authNonce)) {
      // Nonce was consumed on chain without advancing invoiceState => execution failed.
      this.state.data.pendingFlight = undefined;
      this.state.save();
      return { resolved: true, status: "failed_execution" };
    }

    // Nonce unchanged and invoiceState == None => never reached chain.
    this.state.data.pendingFlight = undefined;
    this.state.save();
    return { resolved: true, status: "rejected" };
  }

  async execute(action: "pay" | "queue", invoice: InvoiceRecord, mandateId: string): Promise<ExecuteResult> {
    if (this.state.data.pendingFlight) {
      await this.reconcilePending();
      if (this.state.data.pendingFlight) {
        return { status: "unknown", reason: "previous in-flight transaction unresolved" };
      }
    }

    const invTuple = {
      vendor: invoice.vendor,
      payee: invoice.payee,
      token: invoice.token,
      amount: BigInt(invoice.amount),
      invoiceId: invoice.invoiceId,
      dueDate: BigInt(invoice.dueDate),
      memoHash: invoice.memoHash,
    };

    const calldata = hexToBytes(
      encodeFunctionData({
        abi: PAYGATE_ABI,
        functionName: action,
        args: [invTuple, invoice.vendorSig],
      }),
    );

    const pubkey = hexToBytes(this.agentKey.evm as Hex);
    const nonce = (await fetchAuthNonce({ rest: this.restUrl, address: this.ownerCosmos, pubkey })).nonce;
    const digest = evmAuthSignBytesV2({
      chainId: TESTNET.chainId,
      account: this.ownerCosmos,
      pubkey,
      to: this.gate.toLowerCase(),
      value: "0",
      data: calldata,
      nonce,
      gasLimit: this.gasLimit,
    });
    const sigHex = await privateKeyToAccount(this.agentKey.privateKey as Hex).signMessage({
      message: { raw: digest },
    });

    const key = invoiceKey(invoice.vendor, invoice.invoiceId);
    // Record pending flight BEFORE broadcasting so a lost connection counts as unknown/spent.
    this.state.data.pendingFlight = {
      invoiceKey: key,
      vendor: invoice.vendor,
      invoiceId: invoice.invoiceId,
      action,
      amount: invoice.amount,
      authNonce: nonce.toString(),
      startedAt: Math.floor(Date.now() / 1000),
    };
    this.state.save();

    try {
      const outcome = await this.relayer.relayExecuteEvm({
        account: this.ownerCosmos,
        pubkey,
        signature: hexToBytes(sigHex),
        to: this.gate,
        value: "0",
        data: calldata,
        gasLimit: this.gasLimit,
        nonce: BigInt(nonce),
      });

      this.state.data.pendingFlight = undefined;
      if (outcome.txCode === 0 && outcome.executionSuccess) {
        if (action === "pay") {
          this.state.addSpent(mandateId, BigInt(invoice.amount));
        } else {
          this.state.save();
        }
        return { status: "confirmed", txHash: outcome.txHash };
      }
      this.state.save();
      return { status: "failed_execution", txHash: outcome.txHash, reason: outcome.reason };
    } catch (err) {
      // Lost connection / broadcast timeout: leave pendingFlight recorded (counted as spent), return unknown.
      return {
        status: "unknown",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
