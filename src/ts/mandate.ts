import { open, seal, envelopeFromText, envelopeToText, type SealKeyPair } from "@qorechain/qoreseal";
import {
  signMessage,
  verifyMessage,
  type ClassicalKey,
  type MessageSignature,
} from "@qorechain/qoresign";
import { type Address } from "viem";

export const MANDATE_PURPOSE = "steward-mandate";

export type MandateRefusalCode =
  | "MANDATE_INVALID_ENVELOPE"
  | "MANDATE_MALFORMED"
  | "MANDATE_UNSIGNED"
  | "MANDATE_BAD_SIGNATURE"
  | "MANDATE_EXPIRED"
  | "MANDATE_NOT_YET_VALID"
  | "MANDATE_WRONG_AGENT"
  | "MANDATE_WRONG_OWNER"
  | "MANDATE_WRONG_GATE"
  | "MANDATE_WRONG_CHAIN"
  | "MANDATE_REPLAYED";

export class MandateRefusedError extends Error {
  readonly code: MandateRefusalCode;
  constructor(code: MandateRefusalCode, message: string) {
    super(message);
    this.name = "MandateRefusedError";
    this.code = code;
  }
}

export type MandatePayload = {
  version: 1;
  mandateId: string;
  chainId: string;
  gate: Address;
  ownerCosmos: string;
  ownerEvm: Address;
  agentCosmos: string;
  agentReceiptPubkeyHex?: string;
  budgetTotal: string;
  maxPerInvoice: string;
  allowedVendors: Address[];
  payBeforeDueHours: number;
  allowPastDue: boolean;
  issuedAt: number;
  expiresAt: number;
};

export type SignedMandateEnvelopeInner = {
  payload: MandatePayload;
  signature: MessageSignature;
};

export type SealedMandate = {
  version: 1;
  chainId: string;
  gate: Address;
  sender: string;
  recipient: string;
  aad: string;
  envelope: string;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function mandateAad(chainId: string, gate: Address, agentCosmos: string): string {
  return `steward-mandate-v1|${chainId}|${gate.toLowerCase()}|${agentCosmos}`;
}

export function createSealedMandate(args: {
  payload: MandatePayload;
  ownerClassicalKey: ClassicalKey;
  ownerPqSecretKey: Uint8Array;
  agentRecipient: { mlkemPublicKey: Uint8Array; x25519PublicKey?: Uint8Array };
}): SealedMandate {
  const data = canonicalJson(args.payload);
  const signature = signMessage({
    chainId: args.payload.chainId,
    signer: args.payload.ownerCosmos,
    data,
    classicalKey: args.ownerClassicalKey,
    pqKey: { secretKey: args.ownerPqSecretKey },
  });
  const inner: SignedMandateEnvelopeInner = { payload: args.payload, signature };
  const aad = mandateAad(args.payload.chainId, args.payload.gate, args.payload.agentCosmos);
  const bytes = seal({
    chainId: args.payload.chainId,
    purpose: MANDATE_PURPOSE,
    recipients: [args.agentRecipient],
    plaintext: new TextEncoder().encode(JSON.stringify(inner)),
    aad: new TextEncoder().encode(aad),
    mode: args.agentRecipient.x25519PublicKey ? "hybrid" : "mlkem",
  });
  return {
    version: 1,
    chainId: args.payload.chainId,
    gate: args.payload.gate,
    sender: args.payload.ownerCosmos,
    recipient: args.payload.agentCosmos,
    aad,
    envelope: envelopeToText(bytes),
  };
}

export function openAndVerifyMandate(args: {
  sealed: SealedMandate;
  agentSealKeys: SealKeyPair;
  expectedChainId: string;
  expectedGate: Address;
  expectedOwnerCosmos: string;
  expectedAgentCosmos: string;
  ownerPqPublicKey: Uint8Array;
  replayedIds?: ReadonlySet<string>;
  nowUnix?: number;
}): MandatePayload {
  const expectedAad = mandateAad(args.expectedChainId, args.expectedGate, args.expectedAgentCosmos);
  let plaintext: Uint8Array;
  try {
    const raw = envelopeFromText(args.sealed.envelope);
    plaintext = open({
      chainId: args.expectedChainId,
      purpose: MANDATE_PURPOSE,
      envelope: raw,
      keys: args.agentSealKeys,
      aad: new TextEncoder().encode(expectedAad),
    });
  } catch (err) {
    throw new MandateRefusedError(
      "MANDATE_INVALID_ENVELOPE",
      `could not open sealed mandate: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: Partial<SignedMandateEnvelopeInner>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<SignedMandateEnvelopeInner>;
  } catch {
    throw new MandateRefusedError("MANDATE_MALFORMED", "mandate plaintext is not valid JSON");
  }

  if (!parsed.payload || typeof parsed.payload !== "object") {
    throw new MandateRefusedError("MANDATE_MALFORMED", "mandate payload missing");
  }
  if (!parsed.signature) {
    throw new MandateRefusedError("MANDATE_UNSIGNED", "mandate is missing QoreSign signature");
  }

  const p = parsed.payload;
  if (p.version !== 1 || typeof p.mandateId !== "string" || p.mandateId.length === 0) {
    throw new MandateRefusedError("MANDATE_MALFORMED", "invalid mandate version or id");
  }
  if (p.chainId !== args.expectedChainId) {
    throw new MandateRefusedError("MANDATE_WRONG_CHAIN", `expected chain ${args.expectedChainId}, got ${p.chainId}`);
  }
  if (p.gate.toLowerCase() !== args.expectedGate.toLowerCase()) {
    throw new MandateRefusedError("MANDATE_WRONG_GATE", `expected gate ${args.expectedGate}, got ${p.gate}`);
  }
  if (p.agentCosmos !== args.expectedAgentCosmos) {
    throw new MandateRefusedError("MANDATE_WRONG_AGENT", `mandate meant for ${p.agentCosmos}, not ${args.expectedAgentCosmos}`);
  }
  if (p.ownerCosmos !== args.expectedOwnerCosmos) {
    throw new MandateRefusedError("MANDATE_WRONG_OWNER", `mandate sender ${p.ownerCosmos} != ${args.expectedOwnerCosmos}`);
  }

  const now = args.nowUnix ?? Math.floor(Date.now() / 1000);
  if (now < p.issuedAt) {
    throw new MandateRefusedError("MANDATE_NOT_YET_VALID", `mandate valid from ${p.issuedAt}, now=${now}`);
  }
  if (now > p.expiresAt) {
    throw new MandateRefusedError("MANDATE_EXPIRED", `mandate expired at ${p.expiresAt}, now=${now}`);
  }
  if (args.replayedIds?.has(p.mandateId)) {
    throw new MandateRefusedError("MANDATE_REPLAYED", `mandate id ${p.mandateId} was already consumed or superseded`);
  }

  try {
    verifyMessage({
      chainId: args.expectedChainId,
      signer: args.expectedOwnerCosmos,
      data: canonicalJson(p),
      signature: parsed.signature,
      pqPublicKey: args.ownerPqPublicKey,
      requirePq: true,
    });
  } catch (err) {
    throw new MandateRefusedError(
      "MANDATE_BAD_SIGNATURE",
      `mandate signature invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return p;
}
