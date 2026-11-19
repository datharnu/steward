/** The seven demo steps as they landed on qorechain-diana, 19 Nov 2026. Same hashes as docs/DEMO.md. */

export type LedgerState = "paid" | "refused" | "queued" | "paused";

export type LedgerRow = {
  step: number;
  title: string;
  detail: string;
  state: LedgerState;
  stateLabel: string;
  layer: string;
  hashes: { label: string; hash: string }[];
};

export const LEDGER: LedgerRow[] = [
  {
    step: 1,
    title: "A real invoice is paid",
    detail: "Vendor-signed, 0.010000 fUSD. The gate went from 0.021932 to 0.011932.",
    state: "paid",
    stateLabel: "Paid",
    layer: "PayGate",
    hashes: [{ label: "Pay", hash: "3DEB1D5B87F0BA09BA82E1A1042EA5A7508DF1305913CD451D8960B5C08B3F84" }],
  },
  {
    step: 2,
    title: "An email tells the agent to pay someone else",
    detail: "The policy refused before a transaction. Sent with the agent key anyway, PayGate refused the payee.",
    state: "refused",
    stateLabel: "Refused",
    layer: "Policy, then PayGate",
    hashes: [{ label: "Refusal", hash: "43309EEA26AA0B9BFEEAD6B3996C446417AE4BF5F8AB75CD94A6995BD9255B03" }],
  },
  {
    step: 3,
    title: "A forged invoice",
    detail: "The real vendor and payout, signed with another ML-DSA key. The signature did not check.",
    state: "refused",
    stateLabel: "Refused",
    layer: "PayGate",
    hashes: [{ label: "Refusal", hash: "75FF835453F1A80F2F98D6F0ACD21EBC9D0F193D3FC8D4A2D3FDB91D9963D36D" }],
  },
  {
    step: 4,
    title: "The paid invoice, sent again",
    detail: "The invoice was already marked paid.",
    state: "refused",
    stateLabel: "Refused",
    layer: "PayGate",
    hashes: [{ label: "Refusal", hash: "27F14DE41D592DB0C9E3A60D81296C81FEE4C2BC644AF56E724EE5183D731BC0" }],
  },
  {
    step: 5,
    title: "Over the cap, then the owner approves",
    detail: "0.025000 fUSD against a 0.020000 cap. Queued without moving fUSD, then paid on the owner’s ML-DSA approval.",
    state: "queued",
    stateLabel: "Queued, approved",
    layer: "PayGate and the owner",
    hashes: [
      { label: "Queue", hash: "44331E7905651F0B8F49A787ECCADE4CD1F5FF5B51B9FD2AD92C29044F41443E" },
      { label: "Approve", hash: "0x26606a97330b87cba8d1efd683a56419a50c5e00cc7e105c8f78ef73197573ba" },
    ],
  },
  {
    step: 6,
    title: "The agent calls the token directly",
    detail: "The agent key may call pay and queue on the gate, nothing else.",
    state: "refused",
    stateLabel: "Refused",
    layer: "Chain rule",
    hashes: [{ label: "Refusal", hash: "92854431F2D83B45BD7E4D501E7595BC1B1DAF21C300CC7B99E8ECC3D7028789" }],
  },
  {
    step: 7,
    title: "The owner pauses the gate",
    detail: "Paused with an ML-DSA signature, then unpaused. The gate is open now.",
    state: "paused",
    stateLabel: "Paused, resumed",
    layer: "The owner",
    hashes: [
      { label: "Pause", hash: "0x598cbc7bb5138e36512ced1f04a0950828bf1d774500f792846307640565e5c2" },
      { label: "Unpause", hash: "0xd2e27f6bc29c76a64b4935601fe225296533a8e6824f392f2d57fe2354035f2c" },
    ],
  },
];
