# Steward

**Steward lets an AI agent pay approved vendor invoices while blocking direct transfers and redirected payouts.**

Built for teams letting an autonomous agent handle accounts payable on QoreChain. Funds sit in `PayGate`, the agent's smart-account key can only call `pay` or `queue` on `PayGate` (never the token directly), and every payout requires a fresh ML-DSA-87 invoice signature from an owner-approved vendor inside per-invoice and daily caps.

A prompt-injected invoice memo tells the AI clerk to send `0.01 fUSD` to an attacker's address (`0x…00a1`). Steward's off-chain policy refuses it, and when the agent key tries to send it on chain anyway, `PayGate` reverts before checking the signature — **0.000000 fUSD moved**, while a legitimate vendor-signed invoice pays `0.010000 fUSD` once and blocks replay.

[Live demo](https://steward-amber.vercel.app) · [Watch the film (up to 3 min — not recorded yet)](#built-during-the-hackathon) · [Judge in 5 minutes](#judge-it-in-5-minutes) · [Run locally](#run-locally) · [What works today](#what-works-today)

<p align="center">
  <a href="https://steward-amber.vercel.app"><img src="docs/screen-home.png" width="880" alt="Steward home screen showing 'An AI clerk pays your invoices. It cannot be talked into paying anyone else' and the recorded PayGate refusal of a direct fUSD.transfer." /></a>
</p>

| What was tested on QoreChain Diana testnet | Measured result |
| --- | --- |
| Legitimate vendor-signed invoice (`steward-demo-1`) | Paid **10,000 fUSD base units** once; gate dropped `21,932 → 11,932` |
| Prompt-injected payee, forged owner stamp, or replayed invoice ID | **0 fUSD moved** — all three refused on chain by `PayGate` |
| Over-cap invoice (`25,000` vs. `20,000` per-invoice cap) | Queued with **0 transfer**; paid only after owner's ML-DSA-87 approval |
| Agent key attempts direct `fUSD.transfer` or native bank send | **0 fUSD moved** — refused by QoreChain's smart-account spending rule |

**Why not an ordinary hot wallet or off-chain agent guardrail?** Off-chain prompt filters fail against prompt injection, and a hot wallet key that can call `ERC20.transfer` can drain the treasury in one call. Steward enforces the boundary on chain at two layers: QoreChain's spending rule blocks token transfers outright, and `PayGate` verifies ML-DSA-87 vendor signatures, registered payouts, caps, and single-use invoice IDs.

**What is the biggest risk?** A stolen vendor ML-DSA-87 key can still sign invoices to that vendor's own registered payout up to the configured caps until the owner pauses `PayGate`. Also, Steward proves who was paid and that the vendor signed — it does not prove the billed work was actually delivered — and the deployed project agent session expired on 20 November 2026 (recorded hashes remain verifiable; new live agent sends require `npm run link`).

**How can a judge try it right now?** Open [steward-amber.vercel.app/gate](https://steward-amber.vercel.app/gate) and click **Check the receipt** and **Check this payment** to verify the vendor's ML-DSA-87 signature and live `PayGate` state in the browser with no wallet, or clone the repo and run `npm run evidence` (37 checks, 0 keys).

---

## Contents

1. [The problem](#the-problem)
2. [How it works](#how-it-works)
3. [Hardest technical decision](#hardest-technical-decision)
4. [Judge it in 5 minutes](#judge-it-in-5-minutes)
5. [Where each attack or failure stops](#where-each-attack-or-failure-stops)
6. [Rubric and track mapping](#rubric-and-track-mapping)
7. [What works today](#what-works-today)
8. [Known limits](#known-limits)
9. [Run locally](#run-locally)
10. [Repository map](#repository-map)
11. [Roadmap](#roadmap)
12. [Traction](#traction)
13. [Built during the hackathon](#built-during-the-hackathon)
14. [AI disclosure](#ai-disclosure)
15. [Evidence: testnet addresses](#evidence-testnet-addresses)
16. [Evidence: seven recorded testnet steps](#evidence-seven-recorded-testnet-steps)
17. [Evidence: design decisions and cost breakdown](#evidence-design-decisions-and-cost-breakdown)

---

## The problem

**76%** of US organizations experienced attempted or actual payments fraud in 2025, with **74%** targeted by business email compromise ([AFP Payments Fraud and Control Survey, Apr 2026](https://www.financialprofessionals.org/about/learn-more/press-releases/Details/over-75-percent-of-us-firms-experienced-payments-fraud-in-2025-while-ai-adoption-for-fraud-mitigation-lags)), and OWASP warns that *"it is unclear if there are fool-proof methods of prevention for prompt injection"* ([OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)).

When an AI agent reads vendor invoices from an inbox, an attacker can inject instructions directly into the memo field. If the agent holds a general-purpose wallet key, one fooled prompt drains the account. Steward moves funds into `PayGate` and restricts the agent's chain key to calling `PayGate.pay` and `PayGate.queue` only — so a fooled planner can propose anything, and the chain still refuses every unauthorized payout.

---

## How it works

```mermaid
flowchart LR
    V[Approved Vendor] -->|ML-DSA-87 signed invoice| P[AI Planner + Deterministic Policy]
    O[Owner] -->|QoreSign + QoreSeal mandate| P
    P -->|pay or queue only| SR[QoreChain Spending Rule: 1 uqor, 0 denoms]
    SR -->|allowed selectors only| PG[PayGate on QoreChain]
    PG -->|pqcVerify + caps + unused ID| V
    PG -->|over cap -> queue| O
    O -->|ML-DSA-87 approve / pause| PG
```

- **QoreChain smart-account spending rule:** The agent key (`0x9C3876…FEB7E6be`) is linked to the owner's account with a 1 uqor per-tx / 1 uqor daily cap, **zero allowed denoms**, and only two allowed selectors (`PayGate.pay` and `PayGate.queue`). Direct `fUSD.transfer` and native bank sends are rejected by the chain before touching `PayGate`.
- **`PayGate` (`src/PayGate.sol`):** Holds the fUSD treasury. Checks in strict order: token → amount → approved vendor → vendor's registered payout → unused invoice ID → vendor's current ML-DSA-87 signature (`pqcVerify` against `pqcKeyStatus`) → per-invoice and daily caps. Over-cap invoices can only be queued until the owner approves with ML-DSA-87. Registry/cap changes and `withdraw` (to owner only) wait a timelock; `pause` is immediate.
- **Sealed mandate & deterministic policy:** The owner signs and seals the budget, vendor list, and expiry to the agent via QoreSign + QoreSeal (`src/ts/mandate.ts`). The LLM planner (Claude via Anthropic/OpenRouter, with rule-based fallback) only proposes; `src/ts/policy.ts` clamps deterministically and treats invoice text strictly as data.
- **Signed agent receipts:** Every decision is logged in a hash-chained, ML-DSA-signed receipt store (`agent/receipt-store.ts`), cross-checked against chain transactions by `npm run audit`.

---

## Hardest technical decision

**Keeping invoice caps inside `PayGate` and listing zero denoms on QoreChain's spending rule.**

QoreChain's smart-account spending rule requires a bounded value limit in `uqor`. If we had listed `fUSD` as an allowed denom on the spending rule, the agent key could have called `fUSD.transfer` directly up to that limit without an invoice signature. Leaving the denom list empty and setting the rule cap to `1 uqor` means the chain rejects every direct token transfer and bank send outright, while `PayGate` enforces the real per-invoice (`0.020000 fUSD`) and daily (`2,500 fUSD`) caps.

---

## Judge it in 5 minutes

Everything below runs on QoreChain Diana (`qorechain-diana`, EVM chain ID `9800`) using test fUSD. The deployed project agent session expired on 20 November 2026 (recorded hashes, browser checks, and `npm run evidence` do not need a live session; see [Known limits](#known-limits)).

1. **Browser live gate & ML-DSA-87 signature check (no wallet, no setup).**
   Open [steward-amber.vercel.app/gate](https://steward-amber.vercel.app/gate) and click **Check the receipt** and **Check this payment** (verifies token, amount, vendor, payee, invoice ID, ML-DSA-87 signature, and caps in PayGate's exact order). Visit `/try` to inspect every refusal and `/vendor` to test signing with an unregistered browser key that `PayGate` refuses.
2. **One-command hash verification from a clone (no keys).**
   ```bash
   git clone --recurse-submodules https://github.com/datharnu/steward
   cd steward
   npm ci
   npm run evidence
   ```
   Checks every recorded transaction in `deployments/*.json` via `@qorechain/mcp` (expected: **37 passed, 0 failed**).
3. **Offline contract, agent, and cryptography tests (no chain, no keys).**
   ```bash
   forge test
   npm run test:ts
   npm run cbom:check
   ```
   Includes `test_lyingVerify_stillCannotRedirect`, `test_execute_refusesBeforeTheDelay`, and `test_pay_refusesAnExpiredAgent`.

---

## Where each attack or failure stops

- **Prompt-injected memo tells agent to pay attacker `0x…00a1`:** stopped off chain by `REFUSED_PAYEE_MISMATCH` in `policy.ts`, and if sent anyway, reverted on chain by `PayGate`'s payee check before signature verification.
- **Invoice stamped with owner's key instead of vendor's key:** reverted on chain by `PayGate` at `pqcVerify`.
- **Replayed invoice ID (`steward-demo-1` submitted twice):** reverted on chain (`Paid` status check).
- **Over-cap invoice (`25,000` vs. `20,000` per-invoice cap):** cannot call `pay`; queued with 0 transfer until owner signs ML-DSA-87 approval inside a scoped EVM window.
- **Compromised agent key calls `fUSD.transfer` directly:** refused by QoreChain's smart-account spending rule (0 denoms, only `PayGate.pay` / `PayGate.queue` allowed).
- **Compromised agent key attempts native bank send:** refused by the same spending rule.
- **Compromised precompile returns `true` for a bad recipient (`test_lyingVerify_stillCannotRedirect`):** still cannot redirect because `PayGate` only pays the vendor's registered payout.
- **Stolen vendor key:** owner triggers immediate `pause` with ML-DSA-87; payout registry changes require a timelock (`60s` on testnet).
- **Expired agent session or expired mandate:** refused by QoreChain session expiry and `PayGate` agent expiry.

---

## Rubric and track mapping

Built for **Build Before Q-Day** (`https://build.qorechain.io/`), category bounty **Post-Quantum AI Agents** ("Build an autonomous agent with spending and access limits enforced on chain"; example projects include *bill payer, treasury assistant*). Deadline: **2 December 2026 at 23:59 UTC**.

| Requirement (exact hackathon wording) | Where Steward proves it | Honest limit |
| --- | --- | --- |
| **Scoped EVM window** | Owner's approval (`0x26606a…7573ba`), pause (`0x598cbc…65e5c2`), and unpause (`0xd2e27f…4035f2c`) each ran in a hybrid-signed window aimed solely at `PayGate` with a value cap. | Window is opened by owner's ML-DSA-87 key; `PayGate` does not open windows. |
| **Transaction, value, duration and target limits** | **Transaction:** invoice ID paid once (`27F14DE4…3D731BC0`). **Value:** `25,000` queued against `20,000` per-invoice cap (`44331E79…4F41443E`). **Duration:** agent session expiry (`1795169194`), 60s registry timelock (`0xc256f8…` → `0xa9db70…`), signature deadlines. **Target:** registered vendor payout only (`43309EEA…9255B03`). | The `2,500 fUSD` daily cap is deployed but did not fire because `PayGate` holds less; the per-invoice cap is what fired on testnet. |
| **Smart-account spending rules** | Linked in `E1796894…8F6AC9E4`: `1 uqor`/tx, `1 uqor`/day, 0 denoms, only `PayGate.pay` and `PayGate.queue`; refused direct `fUSD.transfer` (`92854431…`) and bank send (`F8F7CD24…`). | Project agent session expired `20 Nov 2026 11:06 UTC+1` (24-hour session); new live sends need `npm run link`. |
| **Authenticated messaging** | Vendor ML-DSA-87 invoice signatures verified on chain via `pqcVerify` (`3DEB1D5B…`), wrong key refused (`75FF8354…`), mandate signed/sealed with QoreSign + QoreSeal, hash-chained ML-DSA agent receipts. | Invoices arrive as signed JSON files; `CourierInboxAdapter` is a placeholder (Courier is a separate repo). |
| **Public GitHub repository under MIT or Apache-2.0** | `https://github.com/datharnu/steward`, Apache-2.0 (`LICENSE`). | No QCAI dashboard audit (not required for Post-Quantum AI Agents). |
| **README, testnet addresses, and video (up to 3 min)** | This single-file `README.md` holds all addresses and hashes; shot list (2:50) in `docs/DEMO.md`. | **Film not recorded yet.** Must be recorded and linked before 2 December 2026. |

---

## What works today

### Observed

- **`PayGate` deployed on `qorechain-diana`** (`0xb0c44d0a628c4593314a5c3c113d27f2d1842a05`) with one registered vendor (`0.020000 fUSD` per-invoice cap, `2,500 fUSD` daily cap, 60s timelock).
- **Seven recorded testnet steps:** legitimate payment (`10,000`), injected payee refused, wrong-key stamp refused, replay refused, over-cap `25,000` queued then owner-approved, direct `fUSD.transfer` and bank send refused by spending rule, and owner pause + unpause.
- **Live web app (`https://steward-amber.vercel.app`):** Verified on 21 Nov 2026 at 390px and 1440px — **Check the receipt** and **Check this payment** on `/gate` passed, live read showed `0.008862 fUSD` held and gate open, 0 horizontal overflow.
- **Automated checks:** Foundry unit + invariant tests, Vitest agent/vector tests, `npm run cbom:check`, `npm run audit`, and `npm run evidence` (37 checks).

### Built, not observed

- **Daily cap trigger on testnet:** Enforced in `PayGate` and Foundry tests, not triggered in the live demo because treasury balance was below `2,500 fUSD`.
- **Guest browser link flow:** Planned design, not built yet; `/gate` and `/try` are read-only verification views.

### Deliberately absent

- **Courier live inbox integration:** `CourierInboxAdapter` is a placeholder; invoices are signed JSON files.
- **Proof of work completion:** Steward proves who was paid and that the vendor signed, not that the billed service was delivered.
- **QCAI dashboard audit & explorer deep links:** No dashboard audit; web UI provides a Copy button for hashes instead of unconfirmed explorer URLs.

---

## Known limits

- **Stolen vendor key:** Can sign invoices to that vendor's own registered payout up to caps until the owner pauses `PayGate` or removes the vendor.
- **24-hour agent session expiry:** The linked project authenticator expired `20 Nov 2026 11:06 UTC+1` (Unix `1795169194`). `PayGate` keeps the agent registered until `19 Dec 2026` (`1797682327`), and all recorded hashes + browser checks stay valid forever, but new live agent sends require the owner to run `npm run link`.
- **Single deployed vendor:** One vendor is onboarded in the recorded deploy; adding more uses the timelocked owner registry flow.
- **Opaque revert strings on reverted agent calls:** QoreChain emits `execution reverted: evm transaction execution failed` without Solidity error names on reverted `MsgExecuteEVM` calls; demo inputs isolate each check so the first failing guard is unambiguous.
- **Testnet only:** `PayGate` holds test fUSD with no monetary value.

---

## Run locally

Prerequisites: **Node 22** and **Foundry** (`forge`).

```bash
git clone --recurse-submodules https://github.com/datharnu/steward
cd steward
npm ci
forge test
npm run test:ts
npm run typecheck
npm run cbom:check
npm run evidence      # re-checks all 37 recorded testnet hashes (no keys)
```

Web app (`http://localhost:3000`):

```bash
cd apps/web
npm ci
npm run dev
npm run smoke         # Playwright smoke across 390, 768, and 1280 px
```

Live scripts (`npm run deploy`, `npm run link`, `npm run fund`, `npm run cli`, `scripts/demo-scenes.ts`, `scripts/finish-demo.ts`) require `~/.haven/<name>.env` keys (never committed).

---

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/PayGate.sol` | Holds fUSD; verifies vendor ML-DSA-87 invoices, caps, single-use IDs, queue/approve, timelocked registry/withdraw, immediate pause |
| `src/ts/mandate.ts` | QoreSign + QoreSeal sealed owner budget mandate |
| `src/ts/policy.ts` | Deterministic clamp treating invoice text strictly as data |
| `agent/` | Executor and ML-DSA hash-chained receipt store |
| `apps/web/` | Read-only Next.js verifier: `/` (rule & 7 steps), `/gate` (live gate & receipt check), `/try` (refusals), `/vendor` (ephemeral key test) |
| `scripts/` | Deploy, link, fund, 7 demo steps, `evidence.ts` (37 checks), `audit`, `cbom.ts` |
| `deployments/` | Recorded testnet JSON hashes read by `npm run evidence` |
| `test/` & `test-ts/` | Foundry unit/invariant tests (including lying verifier, timelock, expiry) and Vitest agent/vector tests |

---

## Roadmap

1. **Before 2 December 2026:** Record and publish the ≤3-minute demo film (`docs/DEMO.md`).
2. **Multi-vendor & live Courier inbox:** Connect `CourierInboxAdapter` to receive encrypted invoices from Courier and support multiple onboarded vendors.
3. **External audit & mainnet:** Audit `PayGate` and spending-rule integration before mainnet deployment.

---

## Traction

No external users or customers yet; all runs are our own testnet proofs on `qorechain-diana` — pilot next.

---

## Built during the hackathon

Built during **Build Before Q-Day** (November 2026; deadline 2 December 2026 at 23:59 UTC). First commit: `0b25e55` on **19 November 2026**. Licence: **Apache-2.0** (`LICENSE`).

**Credits:** `@qorechain/sdk` 0.14.0, `@qorechain/pqc` 0.2.3, `@qorechain/qoreseal` 0.1.0, `@qorechain/qoresign` 0.1.0, `@qorechain/mcp` 0.1.1, `@qorechain/qore-cli` 0.1.1, `@qorechain/qorescan` 0.1.0, `@qorechain/evm` 0.14.0; `haven-pq-kit` v0.1.0 (interface following `qore-pq-kit` by Adityaakr, Apache-2.0); rule lineage from the author's earlier NEAR project Meter (written fresh for QoreChain/ML-DSA-87); viem, `@cosmjs/stargate`, `@noble/hashes`, `forge-std`, Vitest, Next.js, React, Tailwind CSS, Playwright.

---

## AI disclosure

Written in a Cursor agent session (Claude) under human direction, with the human approving every network transaction, faucet claim, repository creation, and push; later README restructuring used Antigravity. Human decisions included the single PayGate invariant, running the spending-rule spike first, dropping a template homepage in favor of a custom product layout, funding and completing steps 5 and 7 rather than leaving them unrun, and finishing CI/docs before moving to Courier. Bugs caught and fixed included handling missing `abstractaccount_execution` events by reading on-chain invoice state, rerunning refusals with the standard fee after a 135,000 uqor under-gas failure, and fixing a mobile verdict bar animation transform.

---

## Evidence: testnet addresses

Network: `qorechain-diana` (EVM chain ID `9800`).

| Role / Contract | Address |
| --- | --- |
| `PayGate` | `0xb0c44d0a628c4593314a5c3c113d27f2d1842a05` |
| fUSD (ERC-20, 6 decimals) | `0x97143B771D34ddb9130b807b135Ae675A5a963CA` |
| Owner | `qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl` / `0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396` |
| Agent key (linked to owner, EVM calls only) | `0x9C3876f2033552D5293e6efcAdFED87BfEB7E6be` |
| Vendor | `qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv` / `0xf09cc23e992A4591A456836D7223655399D0BB90` |
| `PayStub` (spike target, no longer allowed) | `0x500ccce41a3d219ea7751b89a59bc0248539f734` |
| PQC precompiles | `pqcVerify` `0x0000000000000000000000000000000000000a01`, `pqcKeyStatus` `0x0000000000000000000000000000000000000a02` |

---

## Evidence: seven recorded testnet steps

**Plain-sentence summary of key outcomes:**
- A prompt-injected payee, a forged owner stamp, a replayed invoice, a direct `fUSD.transfer`, and a native bank send each moved **0 fUSD base units**.
- Legitimate vendor-signed invoice `steward-demo-1` moved **10,000 fUSD base units** once (`PayGate` balance `21,932 → 11,932`), and over-cap invoice `25,000` moved **0** on queue and **25,000** only after owner ML-DSA-87 approval.

| Step | What happened | Hash |
| --- | --- | --- |
| Setup | Smart-account spending rule linked (`1 uqor`/tx, `1 uqor`/day, 0 denoms, `PayGate.pay`/`queue` only) | `E1796894B9AAF23D653758FB10E65BCE14968A8DBBEF4E127C3E95FB8F6AC9E4` |
| Setup | Vendor proposed, then added after 60 s timelock | Propose `0xc256f81ea8e04778ddc2d6e038af7e75e02d0903ee4a301e015a6299a6ba829d` · Execute `0xa9db709361f1f40b5a5aa61f4e5c09497b8089947337db919b6e013410677395` |
| 1 | Vendor-signed invoice `steward-demo-1`, `10,000`, paid once | `3DEB1D5B87F0BA09BA82E1A1042EA5A7508DF1305913CD451D8960B5C08B3F84` |
| 2 | Prompt-injected payee (`0x…00a1`) refused off chain (`REFUSED_PAYEE_MISMATCH`) and reverted on chain | `43309EEA26AA0B9BFEEAD6B3996C446417AE4BF5F8AB75CD94A6995BD9255B03` |
| 3 | Invoice stamped with owner's ML-DSA key instead of vendor's — refused | `75FF835453F1A80F2F98D6F0ACD21EBC9D0F193D3FC8D4A2D3FDB91D9963D36D` |
| 4 | Replay of `steward-demo-1` — refused (already `Paid`) | `27F14DE41D592DB0C9E3A60D81296C81FEE4C2BC644AF56E724EE5183D731BC0` |
| 5 | `25,000` queued (cap `20,000`), then owner-approved inside scoped EVM window | Queue `44331E7905651F0B8F49A787ECCADE4CD1F5FF5B51B9FD2AD92C29044F41443E` · Open `02889290D115C1EEF5E4F98B2D3E00C4A3E8AE87013FE86D1E426C550EB90BE9` · Approve `0x26606a97330b87cba8d1efd683a56419a50c5e00cc7e105c8f78ef73197573ba` · Close `BA58A6DFC12349E430A1EC18B742C26A4B5AE581955729A5F06CB2E38EDAE060` |
| 6 | Agent calls `fUSD.transfer` directly — refused by spending rule | `92854431F2D83B45BD7E4D501E7595BC1B1DAF21C300CC7B99E8ECC3D7028789` |
| 6b | Agent attempts native bank send — refused by spending rule | `F8F7CD24C169D7E443055CD7DE8DED8DFA7F01518019B99DA654CE0282216AFA` |
| 7 | Owner pauses `PayGate`, then unpauses | Pause `0x598cbc7bb5138e36512ced1f04a0950828bf1d774500f792846307640565e5c2` · Unpause `0xd2e27f6bc29c76a64b4935601fe225296533a8e6824f392f2d57fe2354035f2c` |

---

## Evidence: design decisions and cost breakdown

| Decision | Why |
| --- | --- |
| Invoice caps in `PayGate`, zero denoms on spending rule | Spending rule caps are in `uqor`; listing `fUSD` would allow direct transfers without invoices |
| Zero-authority relayer | Relayer pays gas and submits, but `msg.sender` grants no payout authority |
| Payee checked before signature (and verified even against a lying precompile) | `test_lyingVerify_stillCannotRedirect` proves funds still reach only the registered payout |
| 60 s testnet timelock on registry changes, immediate pause | Payout changes wait for review; a compromised vendor key stops immediately |
| Read-only web verifier | Guest browser keys would need faucet QOR; live verification requires zero setup |

**Cost breakdown:** Steward charges **0 protocol fee**. Owner actions (approve, pause, unpause, registry changes) pay standard QoreChain hybrid-signed window open/close fees (`180,000 uqor` each) plus EVM execution gas; agent calls pay standard `MsgExecuteEVM` gas covered by the relayer.
