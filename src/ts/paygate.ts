import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { encodeAuthMessage, encodeInvoice, type AuthFields, type InvoiceFields } from "haven-pq-kit";

export const FUSD_ADDRESS = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as const;
export const FUSD_DECIMALS = 6;

export const ACTION_PROPOSE = keccak256(toBytes("steward.PayGate.v1.propose"));
export const ACTION_CANCEL = keccak256(toBytes("steward.PayGate.v1.cancel"));
export const ACTION_APPROVE = keccak256(toBytes("steward.PayGate.v1.approveQueued"));
export const ACTION_PAUSE = keccak256(toBytes("steward.PayGate.v1.pause"));
export const ACTION_UNPAUSE = keccak256(toBytes("steward.PayGate.v1.unpause"));

export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

export enum PayGateOp {
  AddVendor = 0,
  SetPayout = 1,
  SetVendorCap = 2,
  SetDailyCap = 3,
  SetAgent = 4,
  Revoke = 5,
  Withdraw = 6,
}

export const PAYGATE_ABI = parseAbi([
  "function token() view returns (address)",
  "function timelockDelay() view returns (uint256)",
  "function owner() view returns (address)",
  "function ownerNonce() view returns (uint256)",
  "function agent() view returns (address)",
  "function agentUntil() view returns (uint256)",
  "function dailyCap() view returns (uint256)",
  "function paused() view returns (bool)",
  "function today() view returns (uint256)",
  "function spentToday() view returns (uint256)",
  "function spentOnDay(uint256 day) view returns (uint256)",
  "function vendors(address vendor) view returns (bool active, address payout, uint256 perInvoiceCap, uint64 epoch)",
  "function invoiceState(bytes32 key) view returns (uint8)",
  "function queued(bytes32 key) view returns (address payee, uint256 amount, uint64 epoch, uint64 queuedAt)",
  "function pendingEta(bytes32 opHash) view returns (uint256)",
  "function invoiceKey(address vendor, bytes32 invoiceId) pure returns (bytes32)",
  "function opHashOf(uint8 kind, bytes params) pure returns (bytes32)",
  "function approveArgsHash(address vendor, bytes32 invoiceId, address payee, uint256 amount) pure returns (bytes32)",
  "function invoiceMessage((address vendor, address payee, address token, uint256 amount, bytes32 invoiceId, uint256 dueDate, bytes32 memoHash) invoice) view returns (bytes)",
  "function ownerMessage(bytes32 action, bytes32 argsHash, uint256 deadline) view returns (bytes)",
  "function pay((address vendor, address payee, address token, uint256 amount, bytes32 invoiceId, uint256 dueDate, bytes32 memoHash) invoice, bytes vendorSig)",
  "function queue((address vendor, address payee, address token, uint256 amount, bytes32 invoiceId, uint256 dueDate, bytes32 memoHash) invoice, bytes vendorSig)",
  "function approveQueued(address vendor, bytes32 invoiceId, uint256 deadline, bytes ownerSig)",
  "function pause(uint256 deadline, bytes ownerSig)",
  "function unpause(uint256 deadline, bytes ownerSig)",
  "function propose(uint8 kind, bytes params, uint256 deadline, bytes ownerSig)",
  "function execute(uint8 kind, bytes params)",
  "function cancel(bytes32 opHash, uint256 deadline, bytes ownerSig)",
  "event InvoicePaid(address indexed vendor, bytes32 indexed invoiceId, address payee, uint256 amount, bool approvedByOwner)",
  "event InvoiceQueued(address indexed vendor, bytes32 indexed invoiceId, address payee, uint256 amount, uint64 epoch)",
  "event OpProposed(bytes32 indexed opHash, uint8 kind, bytes params, uint256 eta)",
  "event OpExecuted(bytes32 indexed opHash, uint8 kind, bytes params)",
  "event OpCancelled(bytes32 indexed opHash)",
  "event VendorChanged(address indexed vendor, bool active, address payout, uint256 perInvoiceCap, uint64 epoch)",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export function invoiceKey(vendor: Address, invoiceId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [vendor, invoiceId]));
}

export function opHashOf(kind: PayGateOp, params: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [kind, params]));
}

export function approveArgsHash(vendor: Address, invoiceId: Hex, payee: Address, amount: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [vendor, invoiceId, payee, amount],
    ),
  );
}

export function encodeAddVendorParams(vendor: Address, payout: Address, perInvoiceCap: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [vendor, payout, perInvoiceCap],
  );
}

export function encodeSetPayoutParams(vendor: Address, payout: Address): Hex {
  return encodeAbiParameters([{ type: "address" }, { type: "address" }], [vendor, payout]);
}

export function encodeSetVendorCapParams(vendor: Address, perInvoiceCap: bigint): Hex {
  return encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [vendor, perInvoiceCap]);
}

export function encodeSetDailyCapParams(dailyCap: bigint): Hex {
  return encodeAbiParameters([{ type: "uint256" }], [dailyCap]);
}

export function encodeSetAgentParams(agent: Address, agentUntil: bigint): Hex {
  return encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [agent, agentUntil]);
}

export function encodeRevokeParams(vendor: Address): Hex {
  return encodeAbiParameters([{ type: "address" }], [vendor]);
}

export function encodeWithdrawParams(amount: bigint): Hex {
  return encodeAbiParameters([{ type: "uint256" }], [amount]);
}

export function encodePayGateOwnerMessage(fields: AuthFields): Hex {
  return encodeAuthMessage(fields);
}

export function encodePayGateInvoiceMessage(invoice: InvoiceFields): Hex {
  return encodeInvoice(invoice);
}
