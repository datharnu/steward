/**
 * Read-only chain access for /jailbreak: live PayGate reads and `eth_call` simulations of the
 * exact `pay` / `queue` call the agent key would submit. Nothing here signs or broadcasts.
 */
import {
  decodeErrorResult,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type Hex as ViemHex,
} from "viem";
import type { Address, GateSnapshot, Hex, InvoiceRecord } from "./core";

export const RPC_URL = "https://evm-testnet.qore.host";
export const GATE: Address = "0xb0c44d0a628c4593314a5c3c113d27f2d1842a05";
export const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
export const PQC_STATUS: Address = "0x0000000000000000000000000000000000000a02";
export const EVM_CHAIN_ID = 9800n;

const GATE_ABI = parseAbi([
  "function token() view returns (address)",
  "function agent() view returns (address)",
  "function agentUntil() view returns (uint256)",
  "function dailyCap() view returns (uint256)",
  "function paused() view returns (bool)",
  "function spentToday() view returns (uint256)",
  "function vendors(address vendor) view returns (bool active, address payout, uint256 perInvoiceCap, uint64 epoch)",
  "function invoiceState(bytes32 key) view returns (uint8)",
  "function pay((address vendor, address payee, address token, uint256 amount, bytes32 invoiceId, uint256 dueDate, bytes32 memoHash) invoice, bytes vendorSig)",
  "function queue((address vendor, address payee, address token, uint256 amount, bytes32 invoiceId, uint256 dueDate, bytes32 memoHash) invoice, bytes vendorSig)",
]);
const ERC20_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);
const PQC_ABI = parseAbi([
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
]);

/** Every custom error `pay` / `queue` can reach: src/PayGate.sol, haven-pq-kit PqAuth.sol and VendorSig.sol. */
export const REVERT_ABI = parseAbi([
  "error IsPaused()",
  "error NotAgent(address caller)",
  "error AgentExpired(uint256 agentUntil)",
  "error WrongToken(address token)",
  "error ZeroAmount()",
  "error UnknownVendor(address vendor)",
  "error WrongPayee(address payee, address payout)",
  "error InvoiceUsed(address vendor, bytes32 invoiceId, uint8 state)",
  "error OverInvoiceCap(uint256 amount, uint256 cap)",
  "error OverDailyCap(uint256 spentToday, uint256 amount, uint256 cap)",
  "error InsufficientFunds(uint256 balance, uint256 amount)",
  "error TransferFailed()",
  "error Reentrancy()",
  "error PqPrecompileUnavailable()",
  "error KeyNotRegistered(address account)",
  "error WrongAlgorithm(address account, uint8 algorithmId)",
  "error PossessionNotProven(address account)",
  "error BadKeyLength(address account, uint256 length)",
  "error BadSignatureLength(uint256 length)",
  "error SignatureInvalid()",
  "error VendorZero()",
]);

/** Plain-English reading of each revert, for the page. */
export const REVERT_MEANING: Record<string, string> = {
  IsPaused: "The owner has paused PayGate.",
  NotAgent: "Only the registered agent account may call pay or queue.",
  AgentExpired: "The agent's PayGate registration has expired.",
  WrongToken: "The invoice names a token PayGate does not hold.",
  ZeroAmount: "A zero amount is refused.",
  UnknownVendor: "The vendor is not active in PayGate's registry.",
  WrongPayee: "PayGate pays only the payout the owner registered for this vendor. It refuses before it even checks the signature.",
  InvoiceUsed: "This invoice ID was already paid or queued.",
  OverInvoiceCap: "The amount is over this vendor's per-invoice cap; it can only be queued for the owner.",
  OverDailyCap: "The amount would take today's spend over the daily cap.",
  InsufficientFunds: "PayGate does not hold enough fUSD for this invoice.",
  SignatureInvalid:
    "The vendor's ML-DSA-87 signature does not cover this invoice. The pqcVerify precompile (0x…0a01) checked it against the vendor's key in pqcKeyStatus and said no.",
  BadSignatureLength: "The signature is not an ML-DSA-87 signature (4,627 bytes).",
  KeyNotRegistered: "The vendor has no ML-DSA key registered on chain.",
  WrongAlgorithm: "The vendor's on-chain key is not ML-DSA-87.",
  PossessionNotProven: "The vendor never proved possession of its on-chain key.",
  BadKeyLength: "The vendor's on-chain key has the wrong length.",
  PqPrecompileUnavailable: "The PQC precompile did not answer.",
  VendorZero: "The vendor address is zero.",
  TransferFailed: "The token transfer failed.",
  Reentrancy: "Re-entrant call.",
};

export type RpcError = { code?: number; message?: string; data?: string };
export type RpcReply = { result?: string; error?: RpcError };
export type Rpc = (method: string, params: unknown[]) => Promise<RpcReply>;

export class ChainUnavailableError extends Error {
  constructor(message = "Could not reach the QoreChain testnet RPC.") {
    super(message);
    this.name = "ChainUnavailableError";
  }
}

export function httpRpc(url = RPC_URL, timeoutMs = 8_000, fetchImpl: typeof fetch = fetch): Rpc {
  return async (method, params) => {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ChainUnavailableError();
    }
    if (!res.ok) throw new ChainUnavailableError(`The testnet RPC answered HTTP ${res.status}.`);
    try {
      return (await res.json()) as RpcReply;
    } catch {
      throw new ChainUnavailableError("The testnet RPC sent something that is not JSON.");
    }
  };
}

async function read(rpc: Rpc, to: Address, data: ViemHex): Promise<ViemHex> {
  const reply = await rpc("eth_call", [{ to, data }, "latest"]);
  if (reply.error || typeof reply.result !== "string") throw new ChainUnavailableError(`A read of ${to} failed.`);
  return reply.result as ViemHex;
}

export function invoiceKey(vendor: Address, invoiceId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [vendor, invoiceId]));
}

export type GateRead = GateSnapshot & { agent: Address; agentUntil: bigint };

/** The live `GateSnapshot` the policy needs for this invoice, plus the agent account to simulate from. */
export async function readGate(rpc: Rpc, invoice: InvoiceRecord): Promise<GateRead> {
  const call = (functionName: "token" | "agent" | "agentUntil" | "dailyCap" | "paused" | "spentToday") =>
    read(rpc, GATE, encodeFunctionData({ abi: GATE_ABI, functionName }));
  const [token, agent, agentUntil, dailyCap, paused, spentToday, vendor, state, balance] = await Promise.all([
    call("token"),
    call("agent"),
    call("agentUntil"),
    call("dailyCap"),
    call("paused"),
    call("spentToday"),
    read(rpc, GATE, encodeFunctionData({ abi: GATE_ABI, functionName: "vendors", args: [invoice.vendor] })),
    read(rpc, GATE, encodeFunctionData({ abi: GATE_ABI, functionName: "invoiceState", args: [invoiceKey(invoice.vendor, invoice.invoiceId)] })),
    read(rpc, FUSD, encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [GATE] })),
  ]);
  try {
    const v = decodeFunctionResult({ abi: GATE_ABI, functionName: "vendors", data: vendor });
    const s = Number(decodeFunctionResult({ abi: GATE_ABI, functionName: "invoiceState", data: state }));
    return {
      gateAddress: GATE,
      tokenAddress: decodeFunctionResult({ abi: GATE_ABI, functionName: "token", data: token }),
      agent: decodeFunctionResult({ abi: GATE_ABI, functionName: "agent", data: agent }),
      agentUntil: decodeFunctionResult({ abi: GATE_ABI, functionName: "agentUntil", data: agentUntil }),
      paused: decodeFunctionResult({ abi: GATE_ABI, functionName: "paused", data: paused }),
      dailyCap: decodeFunctionResult({ abi: GATE_ABI, functionName: "dailyCap", data: dailyCap }),
      spentToday: decodeFunctionResult({ abi: GATE_ABI, functionName: "spentToday", data: spentToday }),
      gateBalance: decodeFunctionResult({ abi: ERC20_ABI, functionName: "balanceOf", data: balance }),
      vendor: { active: v[0], payout: v[1], perInvoiceCap: v[2], epoch: v[3] },
      invoiceState: (s === 1 || s === 2 ? s : 0) as 0 | 1 | 2,
    };
  } catch {
    throw new ChainUnavailableError("The testnet RPC returned data PayGate's ABI cannot decode.");
  }
}

export type VendorKey = { registered: boolean; algorithmId: number; pubkey: Hex; possessionProven: boolean };

export async function readVendorKey(rpc: Rpc, vendor: Address): Promise<VendorKey> {
  const raw = await read(rpc, PQC_STATUS, encodeFunctionData({ abi: PQC_ABI, functionName: "pqcKeyStatus", args: [vendor] }));
  try {
    const k = decodeFunctionResult({ abi: PQC_ABI, functionName: "pqcKeyStatus", data: raw });
    return { registered: k[0], algorithmId: Number(k[1]), pubkey: k[2], possessionProven: k[3] };
  } catch {
    throw new ChainUnavailableError("pqcKeyStatus returned data that does not decode.");
  }
}

export type DecodedRevert = { name: string; args: string[]; meaning: string };

/** Decode revert data with PayGate's and the PQ kit's custom errors. */
export function decodeRevert(data: string | undefined): DecodedRevert | undefined {
  if (!data || !/^0x[0-9a-fA-F]{8}/.test(data)) return undefined;
  try {
    const decoded = decodeErrorResult({ abi: REVERT_ABI, data: data as ViemHex });
    const args = (decoded.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
    return { name: decoded.errorName, args, meaning: REVERT_MEANING[decoded.errorName] ?? "" };
  } catch {
    return undefined;
  }
}

export type SimulationCall = { fn: "pay" | "queue"; invoice: InvoiceRecord; from: Address };

export type SimulationOutcome =
  | { status: "ok" }
  | { status: "reverted"; selector: string; revert?: DecodedRevert; rawMessage: string }
  | { status: "unavailable"; message: string };

export function encodeAgentCall(call: SimulationCall): ViemHex {
  const inv = call.invoice;
  return encodeFunctionData({
    abi: GATE_ABI,
    functionName: call.fn,
    args: [
      {
        vendor: inv.vendor,
        payee: inv.payee,
        token: inv.token,
        amount: BigInt(inv.amount),
        invoiceId: inv.invoiceId,
        dueDate: BigInt(inv.dueDate),
        memoHash: inv.memoHash,
      },
      inv.vendorSig,
    ],
  });
}

/** `eth_call` of the agent's `pay` / `queue` from the agent account against the latest block. Never a transaction. */
export async function simulateAgentCall(rpc: Rpc, call: SimulationCall): Promise<SimulationOutcome> {
  let reply: RpcReply;
  try {
    reply = await rpc("eth_call", [{ from: call.from, to: GATE, data: encodeAgentCall(call) }, "latest"]);
  } catch (err) {
    return { status: "unavailable", message: err instanceof Error ? err.message : "The testnet RPC did not answer." };
  }
  if (reply.error) {
    const data = typeof reply.error.data === "string" ? reply.error.data : undefined;
    if (!data && !/revert/i.test(reply.error.message ?? "")) {
      return { status: "unavailable", message: `The RPC returned an error: ${String(reply.error.message ?? "unknown").slice(0, 200)}` };
    }
    return {
      status: "reverted",
      selector: data ? data.slice(0, 10) : "",
      revert: decodeRevert(data),
      rawMessage: String(reply.error.message ?? "execution reverted").slice(0, 200),
    };
  }
  if (typeof reply.result === "string") return { status: "ok" };
  return { status: "unavailable", message: "The RPC gave no result." };
}
