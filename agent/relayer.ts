import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  executeEvmMsg,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { TESTNET, qorechainDiana } from "haven-pq-kit";
import { createPublicClient, http, toFunctionSelector, toHex, type Address } from "viem";

const PAY_SELECTOR = toFunctionSelector(
  "function pay((address vendor, address payee, address token, uint256 amount, bytes32 invoiceId, uint256 dueDate, bytes32 memoHash) invoice, bytes vendorSig)",
).toLowerCase();

const QUEUE_SELECTOR = toFunctionSelector(
  "function queue((address vendor, address payee, address token, uint256 amount, bytes32 invoiceId, uint256 dueDate, bytes32 memoHash) invoice, bytes vendorSig)",
).toLowerCase();

export { PAY_SELECTOR, QUEUE_SELECTOR };

export type RelayRequest = {
  account: string;
  pubkey: Uint8Array;
  signature: Uint8Array;
  to: Address;
  value: string;
  data: Uint8Array;
  gasLimit: bigint;
  nonce: bigint;
};

export type RelayOutcome = {
  txHash: string;
  txCode: number;
  executionSuccess: boolean;
  reason?: string;
};

export interface Relayer {
  readonly addressCosmos: string;
  relayExecuteEvm(req: RelayRequest): Promise<RelayOutcome>;
}

/**
 * Pays gas and broadcasts `MsgExecuteEVM`. Holds no authority in PayGate and
 * refuses any call outside its allowlist (only `PayGate.pay` and `PayGate.queue`).
 */
export class AllowlistedRelayer implements Relayer {
  readonly addressCosmos: string;
  private readonly relayerAccount: UnifiedAccount;
  private readonly expectedOwnerCosmos: string;
  private readonly allowedGate: Address;
  private readonly maxGasLimit: bigint;

  constructor(opts: {
    relayerAccount: UnifiedAccount;
    expectedOwnerCosmos: string;
    allowedGate: Address;
    maxGasLimit?: bigint;
  }) {
    this.relayerAccount = opts.relayerAccount;
    this.addressCosmos = opts.relayerAccount.cosmos;
    this.expectedOwnerCosmos = opts.expectedOwnerCosmos;
    this.allowedGate = opts.allowedGate;
    this.maxGasLimit = opts.maxGasLimit ?? 1_500_000n;
  }

  validateRequest(req: RelayRequest): void {
    if (req.account !== this.expectedOwnerCosmos) {
      throw new Error(`relayer refused: account ${req.account} != ${this.expectedOwnerCosmos}`);
    }
    if (req.to.toLowerCase() !== this.allowedGate.toLowerCase()) {
      throw new Error(`relayer refused: target ${req.to} is not PayGate ${this.allowedGate}`);
    }
    if (req.value !== "0") {
      throw new Error(`relayer refused: non-zero native value ${req.value}`);
    }
    if (req.gasLimit > this.maxGasLimit) {
      throw new Error(`relayer refused: gasLimit ${req.gasLimit} > ${this.maxGasLimit}`);
    }
    if (req.data.length < 4) {
      throw new Error("relayer refused: calldata shorter than 4-byte selector");
    }
    const selector = toHex(req.data.slice(0, 4)).toLowerCase();
    if (selector !== PAY_SELECTOR && selector !== QUEUE_SELECTOR) {
      throw new Error(`relayer refused: selector ${selector} is not pay or queue`);
    }
  }

  async relayExecuteEvm(req: RelayRequest): Promise<RelayOutcome> {
    this.validateRequest(req);

    const msg = executeEvmMsg({
      relayer: this.relayerAccount.cosmos,
      account: req.account,
      scheme: "secp256k1",
      pubkey: req.pubkey,
      signature: req.signature,
      to: req.to.toLowerCase(),
      value: req.value,
      data: req.data,
      gasLimit: req.gasLimit,
      nonce: req.nonce,
    });

    const publicClient = createPublicClient({ chain: qorechainDiana, transport: http(TESTNET.evmRpc) });
    const [authRes, evmNonce] = await Promise.all([
      fetch(`${TESTNET.rest}/cosmos/auth/v1beta1/accounts/${this.relayerAccount.cosmos}`),
      publicClient.getTransactionCount({ address: this.relayerAccount.evm as Address, blockTag: "pending" }),
    ]);
    if (!authRes.ok) throw new Error(`relayer account fetch failed (${authRes.status})`);
    const authJson = (await authRes.json()) as { account?: { account_number?: string } };
    if (!authJson.account?.account_number) throw new Error("relayer account_number missing");

    const signer = new EthNativeSigner(this.relayerAccount, {
      signMode: "hybrid",
      rest: TESTNET.rest,
      signBytesVersion: "auto",
    });
    const node = await StargateClient.connect(TESTNET.rpc);
    try {
      const result = await signer.signAndBroadcast(node, {
        chainId: TESTNET.chainId,
        messages: [msg],
        fee: { amount: [{ denom: "uqor", amount: "180000" }], gas: "1200000" },
        accountNumber: BigInt(authJson.account.account_number),
        sequence: BigInt(evmNonce),
      });
      if (result.code !== 0) {
        return {
          txHash: result.transactionHash,
          txCode: result.code,
          executionSuccess: false,
          reason: result.rawLog ?? `tx failed with code ${result.code}`,
        };
      }
      const txRes = (await fetch(`${TESTNET.rest}/cosmos/tx/v1beta1/txs/${result.transactionHash}`).then((r) =>
        r.json(),
      )) as {
        tx_response?: {
          raw_log?: string;
          events?: { type: string; attributes?: { key: string; value: string }[] }[];
        };
      };
      const events = txRes.tx_response?.events ?? [];
      const failedEvent = events.find((e) => e.type === "abstractaccount_execution_failed");
      if (failedEvent) {
        const attrs = Object.fromEntries((failedEvent.attributes ?? []).map((a) => [a.key, a.value]));
        return {
          txHash: result.transactionHash,
          txCode: result.code,
          executionSuccess: false,
          reason: attrs.reason ?? "abstractaccount_execution_failed",
        };
      }
      const execEvent = events.find((e) => e.type === "abstractaccount_execution");
      const execAttrs = Object.fromEntries((execEvent?.attributes ?? []).map((a) => [a.key, a.value]));
      const ok = execAttrs.success === "true";
      return {
        txHash: result.transactionHash,
        txCode: result.code,
        executionSuccess: ok,
        reason: ok ? undefined : execAttrs.vm_error ?? execAttrs.reason ?? "execution_failed",
      };
    } finally {
      node.disconnect();
    }
  }
}
