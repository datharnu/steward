"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import styles from "./research-band.module.css";

type ReferenceDoc = {
  id: string;
  host: string;
  product: string;
  finding: string;
  who: string;
  venue: string;
  href: string;
  pubLabel: string;
  docTitle: string;
  docAbstract: string;
  tags: string[];
};

const DOCS: ReferenceDoc[] = [
  {
    id: "fips-204",
    host: "csrc.nist.gov/pubs/fips/204/final",
    product: "PayGate pqcVerify",
    finding: "Module-lattice digital signatures stay unforgeable against quantum attackers.",
    who: "NIST",
    venue: "FIPS 204 · ML-DSA (Dilithium), Aug 2024",
    href: "https://csrc.nist.gov/pubs/fips/204/final",
    pubLabel: "Federal Information Processing Standard · FIPS 204",
    docTitle: "Module-Lattice-Based Digital Signature Standard (ML-DSA)",
    docAbstract:
      "Specifies ML-DSA-87 (NIST Security Category 5) for post-quantum authentication. Steward verifies vendor and owner ML-DSA-87 signatures on chain through QoreChain’s pqcVerify precompile (0x…0a01), with zero ecrecover calls.",
    tags: ["ML-DSA-87", "pqcVerify 0x…0a01", "Zero ecrecover"],
  },
  {
    id: "owasp-agentic",
    host: "genai.owasp.org/resource/owasp-top-10-for-agentic-applications",
    product: "Chain rule & policy clamp",
    finding: "Prompt injection turns untrusted invoice text into instructions unless authority lives outside the model.",
    who: "OWASP GenAI Security Project",
    venue: "Top 10 for Agentic Applications · 2025–2026",
    href: "https://genai.owasp.org/",
    pubLabel: "OWASP GenAI Security · ASI01 & ASI03",
    docTitle: "Agent Goal Hijack & Privilege Abuse Mitigations",
    docAbstract:
      "Assumes any LLM planner reading external invoices can be steered. Steward treats invoice memos as untrusted data, clamps proposals locally, and enforces least-privilege spending rules and payout locks on chain.",
    tags: ["ASI01 Goal Hijack", "ASI03 Privilege Abuse", "Least privilege"],
  },
  {
    id: "fips-203",
    host: "csrc.nist.gov/pubs/fips/203/final",
    product: "Sealed mandates (QoreSeal)",
    finding: "Post-quantum key encapsulation seals owner budgets directly to the agent’s key.",
    who: "NIST",
    venue: "FIPS 203 · ML-KEM (Kyber), Aug 2024",
    href: "https://csrc.nist.gov/pubs/fips/203/final",
    pubLabel: "Federal Information Processing Standard · FIPS 203",
    docTitle: "Module-Lattice-Based Key-Encapsulation Mechanism (ML-KEM)",
    docAbstract:
      "Underpins QoreSeal envelope encryption for Steward’s owner mandates. Unsigned, expired, replayed, or another agent’s mandates are refused before a transaction is built.",
    tags: ["ML-KEM", "QoreSeal", "Replay refusal"],
  },
];

export function ResearchBand() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const [active, setActive] = useState(0);
  const [hold, setHold] = useState(false);
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    if (active !== 0) setMoved(true);
  }, [active]);

  useEffect(() => {
    if (reduce || !inView || hold) return;
    const t = window.setTimeout(() => setActive((a) => (a + 1) % DOCS.length), 4600);
    return () => window.clearTimeout(t);
  }, [active, reduce, inView, hold]);

  return (
    <section ref={ref} id="research" className="mx-auto max-w-[1040px] scroll-mt-20 py-16 md:py-20" aria-labelledby="research-heading">
      <div className="max-w-[660px]">
        <div className="inline-flex items-center gap-2 text-[13px] font-medium text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          <span>Research & standards</span>
        </div>
        <h2 id="research-heading" className="mt-2 text-[30px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[38px]">
          The standards behind the gate.
        </h2>
      </div>

      <div className={`${styles.layout} mt-9`}>
        {/* ul (not ol) so main ol.last() remains the 7-step testnet ledger */}
        <ul className={styles.list} onMouseLeave={() => setHold(false)}>
          {DOCS.map((doc, i) => (
            <li
              key={doc.id}
              className={`${styles.item} ${i === active ? styles.itemOn : ""}`}
              onMouseEnter={() => {
                setActive(i);
                setHold(true);
              }}
              onClick={() => {
                setActive(i);
                setHold(true);
              }}
            >
              <span className={styles.num}>0{i + 1}</span>
              <div className={styles.itemBody}>
                <span className={styles.informs}>Informs {doc.product}</span>
                <p className={styles.finding}>{doc.finding}</p>
                <p className={styles.who}>
                  {doc.who} · {doc.venue} ·{" "}
                  <a
                    className={styles.sourceLink}
                    href={doc.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Source
                  </a>
                </p>
              </div>
            </li>
          ))}
        </ul>

        {/* 3D stacked browser deck */}
        <div className={styles.deck} aria-label="Standards and references informing Steward">
          {DOCS.map((doc, i) => {
            const k = (i - active + DOCS.length) % DOCS.length;
            return (
              <a
                key={`${doc.id}-${k === DOCS.length - 1 ? active : "s"}`}
                href={doc.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${doc.who}, ${doc.venue} (opens source)`}
                tabIndex={k === 0 ? 0 : -1}
                onMouseEnter={() => {
                  if (k !== 0) {
                    setActive(i);
                    setHold(true);
                  }
                }}
                className={`${styles.paper} ${styles["k" + k]} ${k === DOCS.length - 1 && moved ? styles.out : ""}`}
              >
                <span className={styles.chrome}>
                  <span className={styles.dots}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className={styles.url}>{doc.host}</span>
                </span>

                <div className={styles.docBody}>
                  <span className={styles.docPub}>{doc.pubLabel}</span>
                  <p className={styles.docTitle}>{doc.docTitle}</p>
                  <p className={styles.docAbstract}>{doc.docAbstract}</p>
                  <div className={styles.docMeta}>
                    {doc.tags.map((tag) => (
                      <span key={tag} className={styles.docTag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <span className={styles.chip}>
                  <span>Informs {doc.product}</span>
                  <ExternalLink className="h-3 w-3 opacity-80" />
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
