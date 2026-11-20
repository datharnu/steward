import type { CSSProperties } from "react";
import { Ban, Check, Clock, FileCheck2, FileKey2, Lock, ShieldCheck, Wallet } from "lucide-react";
import { StewardMark } from "./brand-mark";
import styles from "./steward-preview.module.css";

type PreviewRow = {
  name: string;
  sub: string;
  state: "Paid" | "Refused" | "Queued";
  active?: boolean;
};

const GROUPS: { label: string; rows: PreviewRow[] }[] = [
  {
    label: "qorechain-diana · 19 Nov",
    rows: [
      { name: "mandate-first-payment", sub: "0.010000 fUSD · 3DEB1D5B87", state: "Paid", active: true },
      { name: "Redirected payee", sub: "WrongPayee · 43309EEA26", state: "Refused" },
      { name: "Forged ML-DSA stamp", sub: "BadSignature · 75FF835453", state: "Refused" },
      { name: "Replayed invoice id", sub: "InvoiceUsed · 27F14DE41D", state: "Refused" },
    ],
  },
  {
    label: "Caps & spending rule",
    rows: [
      { name: "0.025000 fUSD over cap", sub: "Queued · owner approved", state: "Queued" },
      { name: "Direct fUSD.transfer", sub: "Chain rule · 92854431F2", state: "Refused" },
    ],
  },
];

type NodeSpec = {
  n: number;
  title: string;
  sub: string;
  foot: string;
  refused?: boolean;
};

const NODES: Record<string, NodeSpec> = {
  a: { n: 1, title: "Sealed mandate", sub: "Owner budget & vendor list", foot: "QoreSeal" },
  b: { n: 2, title: "Vendor ML-DSA-87", sub: "Invoice signed by vendor key", foot: "pqcVerify 0x…0a01" },
  c: { n: 3, title: "Chain spending rule", sub: "pay & queue only · 1 uqor", foot: "QoreChain" },
  d: { n: 4, title: "PayGate checks", sub: "Payout, unused id, caps", foot: "0xb0c4…2a05" },
  e: { n: 5, title: "Paid 0.010000 fUSD", sub: "To 0xf09c…BB90 · OK_PAY", foot: "tx 3DEB1D5B87" },
  f: { n: 6, title: "Redirect refused", sub: "WrongPayee · 0 moved", foot: "tx 43309EEA26", refused: true },
  g: { n: 7, title: "Token call refused", sub: "fUSD.transfer blocked", foot: "tx 92854431F2", refused: true },
};

const COLS = ["2.5%", "37%", "71.5%"];
const ROWS_EM = [1.4, 11.4, 21.4, 31.4];
const PLACED: [keyof typeof NODES, number, number][] = [
  ["a", 0, 0],
  ["b", 1, 0],
  ["c", 2, 0],
  ["d", 1, 1],
  ["e", 2, 1],
  ["f", 2, 2],
  ["g", 2, 3],
];
const MID = 3.0;
const WIRES: { v?: boolean; x: string; y: number; w?: string; len?: number; dashed?: boolean }[] = [
  { x: "28.5%", y: 1.4 + MID, w: "8.5%" },
  { x: "63%", y: 1.4 + MID, w: "8.5%" },
  { x: "63%", y: 11.4 + MID, w: "8.5%" },
  { x: "28.5%", y: 11.4 + MID, w: "8.5%", dashed: true },
  { v: true, x: "50%", y: 9.0, len: 2.4 },
  { v: true, x: "84.5%", y: 9.0, len: 2.4 },
  { v: true, x: "84.5%", y: 19.0, len: 2.4 },
  { v: true, x: "84.5%", y: 29.0, len: 2.4 },
];

const CAPS: [string, string][] = [
  ["Per-invoice", "0.020000 fUSD"],
  ["Daily cap", "2,500 fUSD"],
  ["Gate left", "0.011932 fUSD"],
  ["Payout", "0xf09c…BB90"],
];

const RECEIPT_INSIGHTS = [
  {
    tone: "ok" as const,
    title: "OK_PAY · Receipt #0",
    text: "0.010000 fUSD paid to registered vendor. Hash 0xa3d3e6…9f5d signed with ML-DSA-87.",
    hash: "tx 3DEB1D5B87…8B3F84",
  },
  {
    tone: "refuse" as const,
    title: "WrongPayee refused",
    text: "Prompt-injected payout rejected by policy and by PayGate on chain.",
    hash: "tx 43309EEA26…255B03",
  },
  {
    tone: "refuse" as const,
    title: "fUSD.transfer refused",
    text: "Spending rule allows PayGate.pay and queue only. Direct token calls fail.",
    hash: "tx 92854431F2…028789",
  },
];

function NodeCard({ node, style }: { node: NodeSpec; style: CSSProperties }) {
  return (
    <div className={`${styles.node} ${node.refused ? styles.nodeRefused : ""}`} style={style}>
      <div className={styles.nodeHead}>
        <span className={styles.nodeIcon}>
          {node.refused ? <Ban className={styles.ic} /> : <ShieldCheck className={styles.ic} />}
        </span>
        <span className={styles.nodeNum}>{node.n}</span>
        <span className={styles.nodeState}>
          {node.refused ? <Ban className={styles.ic} /> : <Check className={styles.ic} />}
        </span>
      </div>
      <div className={styles.nodeBody}>
        <div className={styles.nodeTitle}>{node.title}</div>
        <div className={styles.nodeSub}>{node.sub}</div>
      </div>
      <div className={styles.nodeFoot}>{node.foot}</div>
    </div>
  );
}

export function StewardPreview() {
  return (
    <div
      className={styles.stage}
      role="img"
      aria-label="Steward PayGate console showing the recorded qorechain-diana testnet run: mandate-first-payment settled for 0.010000 fUSD to vendor 0xf09c…BB90, while payee redirects, forged ML-DSA stamps, replayed invoices, and direct fUSD.transfer calls were refused on chain."
    >
      <span className={styles.sheet2} aria-hidden="true" />
      <span className={styles.sheet1} aria-hidden="true" />
      <div className={styles.window}>
        {/* Rail */}
        <aside className={styles.rail}>
          <span className={styles.logo}>
            <StewardMark size={16} className={styles.ic} />
          </span>
          <span className={`${styles.railBtn} ${styles.railOn}`}>
            <ShieldCheck className={styles.ic} />
          </span>
          <span className={styles.railBtn}>
            <FileCheck2 className={styles.ic} />
          </span>
          <span className={styles.railBtn}>
            <FileKey2 className={styles.ic} />
          </span>
          <span className={styles.railBtn}>
            <Wallet className={styles.ic} />
          </span>
          <span className={`${styles.railBtn} ${styles.railBottom}`}>
            <Lock className={styles.ic} />
          </span>
        </aside>

        {/* Left pane: Invoices & events */}
        <section className={styles.list}>
          <header className={styles.listHead}>
            <b>
              PayGate log <span className={styles.count}>7</span>
            </b>
          </header>
          <div className={styles.chips}>
            <span className={styles.chip}>qorechain-diana</span>
            <span className={styles.chip}>fUSD</span>
          </div>
          {GROUPS.map((g) => (
            <div key={g.label} className={styles.group}>
              <div className={styles.groupLabel}>{g.label}</div>
              {g.rows.map((r) => (
                <div key={r.name} className={`${styles.row} ${r.active ? styles.rowOn : ""}`}>
                  <span className={styles.rowIcon}>
                    {r.state === "Paid" ? (
                      <Check className={styles.ic} />
                    ) : r.state === "Queued" ? (
                      <Clock className={styles.ic} />
                    ) : (
                      <Ban className={styles.ic} />
                    )}
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{r.name}</span>
                    <span className={styles.rowSub}>{r.sub}</span>
                  </span>
                  <span className={`${styles.state} ${styles["st" + r.state]}`}>
                    <span className={styles.stDot} />
                    {r.state}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </section>

        {/* Center: PayGate execution canvas */}
        <section className={styles.main}>
          <header className={styles.mainHead}>
            <span className={styles.mainTitle}>PayGate · 0xb0c4…2a05</span>
            <span className={styles.tag}>ML-DSA-87</span>
            <span className={styles.grow} />
            <span className={styles.btnGhost}>Verify receipt</span>
            <span className={styles.btnDark}>Try sandbox</span>
          </header>
          <div className={styles.toolbar}>
            <span className={styles.btnSmall}>
              <Lock className={styles.ic} /> EVM 9800
            </span>
            <span className={styles.sep} />
            <span>7 recorded steps</span>
            <span>·</span>
            <span className={styles.metaLive}>Gate open</span>
            <span className={styles.grow} />
            <span className={styles.dim}>qorechain-diana · fUSD</span>
          </div>
          <div className={styles.canvas}>
            {WIRES.map((w, i) => (
              <span
                key={i}
                className={`${w.v ? styles.wireV : styles.wireH} ${w.dashed ? styles.dashed : ""}`}
                style={
                  w.v
                    ? { left: w.x, top: `${w.y}em`, height: `${w.len}em` }
                    : { left: w.x, top: `${w.y}em`, width: w.w }
                }
              />
            ))}
            {PLACED.map(([k, col, row]) => (
              <NodeCard key={k} node={NODES[k]} style={{ left: COLS[col], top: `${ROWS_EM[row]}em` }} />
            ))}
            <div className={styles.caps} style={{ left: COLS[0], top: `${ROWS_EM[1]}em` }}>
              <div className={styles.capsHead}>
                <FileKey2 className={styles.ic} /> Registered limits
              </div>
              {CAPS.map(([k, v]) => (
                <div key={k} className={styles.capRow}>
                  <span>{k}</span>
                  <code>{v}</code>
                </div>
              ))}
              <div className={styles.capsFoot}>60s timelock · owner ML-DSA</div>
            </div>
          </div>
        </section>

        {/* Right: Receipt & verification */}
        <section className={styles.side}>
          <header className={styles.sideHead}>
            <span className={styles.sideMark}>
              <FileCheck2 className={styles.ic} />
            </span>
            <b>Signed receipts</b>
          </header>
          {RECEIPT_INSIGHTS.map((item) => (
            <div key={item.title} className={styles.insight}>
              <span className={`${styles.insightIcon} ${styles[item.tone]}`}>
                {item.tone === "ok" ? <Check className={styles.ic} /> : <Ban className={styles.ic} />}
              </span>
              <div className={styles.insightBody}>
                <div className={styles.insightTitle}>{item.title}</div>
                <div className={styles.insightText}>{item.text}</div>
                <div className={styles.insightHash}>{item.hash}</div>
              </div>
            </div>
          ))}
          <div className={styles.label}>Receipt #0 (public/receipt.json)</div>
          <div className={styles.event}>
            <span>bodyHash</span>
            <span className={styles.ago}>0xa3d3e6…9f5d</span>
          </div>
          <div className={styles.event}>
            <span>invoiceKey</span>
            <span className={styles.ago}>0xfb17c7…75a3</span>
          </div>
          <div className={styles.event}>
            <span>txStatus</span>
            <span className={styles.ago}>confirmed</span>
          </div>
        </section>
      </div>
    </div>
  );
}
