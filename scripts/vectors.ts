import { mkdirSync, writeFileSync } from "node:fs";
import { keccak256, toBytes, type Hex } from "viem";
import {
  ACTION_APPROVE,
  ACTION_PROPOSE,
  FUSD_ADDRESS,
  PayGateOp,
  approveArgsHash,
  encodeAddVendorParams,
  encodePayGateInvoiceMessage,
  encodePayGateOwnerMessage,
  encodeSetPayoutParams,
  invoiceKey,
  opHashOf,
} from "../src/ts/paygate.js";

const gate = "0x3333333333333333333333333333333333333333" as const;
const owner = "0x1111111111111111111111111111111111111111" as const;
const vendor = "0x4444444444444444444444444444444444444444" as const;
const payout = "0x5555555555555555555555555555555555555555" as const;
const invoiceId = keccak256(toBytes("steward.vectors.inv-1"));
const memoHash = keccak256(toBytes("steward.vectors.memo"));

const addVendorParams = encodeAddVendorParams(vendor, payout, 1_000_000_000n);
const setPayoutParams = encodeSetPayoutParams(vendor, payout);
const approveHash = approveArgsHash(vendor, invoiceId, payout, 5_000_000_000n);
const proposeOpHash = opHashOf(PayGateOp.AddVendor, addVendorParams);

const invoice = {
  chainId: 9800n,
  gate,
  vendor,
  payee: payout,
  token: FUSD_ADDRESS,
  amount: 400_000_000n,
  invoiceId,
  dueDate: 1_700_604_800n,
  memoHash,
} as const;

const ownerPropose = {
  chainId: 9800n,
  contract: gate,
  signer: owner,
  action: ACTION_PROPOSE,
  nonce: 0n,
  deadline: 1_700_003_600n,
  argsHash: proposeOpHash,
} as const;

const ownerApprove = {
  chainId: 9800n,
  contract: gate,
  signer: owner,
  action: ACTION_APPROVE,
  nonce: 1n,
  deadline: 1_700_007_200n,
  argsHash: approveHash,
} as const;

function jsonHex(value: bigint | Hex | string): string {
  return typeof value === "bigint" ? value.toString() : value;
}

const document = {
  gate,
  owner,
  vendor,
  payout,
  invoiceKey: invoiceKey(vendor, invoiceId),
  addVendor: {
    params: addVendorParams,
    opHash: proposeOpHash,
  },
  setPayout: {
    params: setPayoutParams,
    opHash: opHashOf(PayGateOp.SetPayout, setPayoutParams),
  },
  approve: {
    invoiceId,
    amount: "5000000000",
    argsHash: approveHash,
  },
  invoice: {
    chainId: jsonHex(invoice.chainId),
    gate: invoice.gate,
    vendor: invoice.vendor,
    payee: invoice.payee,
    token: invoice.token,
    amount: jsonHex(invoice.amount),
    invoiceId: invoice.invoiceId,
    dueDate: jsonHex(invoice.dueDate),
    memoHash: invoice.memoHash,
    message: encodePayGateInvoiceMessage(invoice),
  },
  ownerPropose: {
    chainId: jsonHex(ownerPropose.chainId),
    contract: ownerPropose.contract,
    signer: ownerPropose.signer,
    action: ownerPropose.action,
    nonce: jsonHex(ownerPropose.nonce),
    deadline: jsonHex(ownerPropose.deadline),
    argsHash: ownerPropose.argsHash,
    message: encodePayGateOwnerMessage(ownerPropose),
  },
  ownerApprove: {
    chainId: jsonHex(ownerApprove.chainId),
    contract: ownerApprove.contract,
    signer: ownerApprove.signer,
    action: ownerApprove.action,
    nonce: jsonHex(ownerApprove.nonce),
    deadline: jsonHex(ownerApprove.deadline),
    argsHash: ownerApprove.argsHash,
    message: encodePayGateOwnerMessage(ownerApprove),
  },
};

mkdirSync("vectors", { recursive: true });
writeFileSync("vectors/messages.json", `${JSON.stringify(document, null, 2)}\n`);
console.log("wrote vectors/messages.json");
