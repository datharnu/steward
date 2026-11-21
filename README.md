# Steward

**The agent key cannot move funds. The only payment the chain will let it make is a vendor-signed invoice, through the gate, to a vendor the owner approved, once, inside the caps.**

Track: Post-Quantum AI Agents, [Build Before Q-Day](https://build.qorechain.io/). Repository: https://github.com/datharnu/steward. Licence: Apache-2.0.

Network `qorechain-diana`, EVM chain id 9800. PayGate holds test fUSD. Nothing here is on mainnet, and nothing here has been through the dashboard audit. The site reads the chain and sends no transaction. It is not deployed to a public URL.

Steward proves who was paid and that the vendor signed. It does not prove the work was done.

## Judge it without our keys

1. Read the seven rows in [What was measured](#what-was-measured). Each refusal was built so that PayGate's first failing check is the one named there.
2. Re-check the hashes. No key:

```bash
git clone --recurse-submodules https://github.com/datharnu/steward
cd steward
npm ci
npm run evidence
```

`npm run evidence` reads `deployments/*.json` and checks each hash on `qorechain-diana` through `@qorechain/mcp`. The shot list in [docs/DEMO.md](docs/DEMO.md) expected the line `37 passed, 0 failed`. Re-run the command. The number on a later day is the one that counts.

3. `forge test` and `npm run test:ts` need no chain. They use a mock of the precompiles. A passing test is not a testnet receipt.
4. The site, still with no key:

```bash
cd apps/web
npm ci
npm run dev
```

Open http://localhost:3000. `/` is the rule and the seven steps. `/gate` reads PayGate live and checks the agent's receipt in the browser. `/try` shows each refusal and its hash. `/vendor` signs with a key made in the tab. That key is not saved and not registered. PayGate refuses a file it signs.

The agent link deployed with this repo expires at Unix time 1795169194, which is 20 November 2026, 11:06 UTC+1. After that the agent cannot send a new transaction until the owner runs `npm run link`. The recorded hashes, `npm run evidence`, the tests, and the site do not need a live link. A new payment does.

## What was measured

PayGate is `0xb0c44d0a628c4593314a5c3c113d27f2d1842a05`. Amounts are fUSD base units. 10,000 is 0.01 fUSD. The full notes are in [docs/DEMO.md](docs/DEMO.md).

| What was measured | Result | Where |
| --- | --- | --- |
| A vendor-signed invoice | Paid once. The gate went from 21,932 to 11,932. The vendor holds 10,000 | `3DEB1D5B87F0BA09BA82E1A1042EA5A7508DF1305913CD451D8960B5C08B3F84` |
| An injected payee | The policy returned `REFUSED_PAYEE_MISMATCH` and did not need the chain. The same invoice, sent with the agent key anyway, reverted in PayGate. The payee check runs before the signature | `43309EEA26AA0B9BFEEAD6B3996C446417AE4BF5F8AB75CD94A6995BD9255B03` |
| A stamp from the owner's key, not the vendor's | Refused | `75FF835453F1A80F2F98D6F0ACD21EBC9D0F193D3FC8D4A2D3FDB91D9963D36D` |
| The paid invoice again | Refused. The id is already Paid | `27F14DE41D592DB0C9E3A60D81296C81FEE4C2BC644AF56E724EE5183D731BC0` |
| 25,000 against a 20,000 per-invoice cap | Queued, no transfer. The owner then approved with ML-DSA. The gate paid 25,000 | Queue `44331E7905651F0B8F49A787ECCADE4CD1F5FF5B51B9FD2AD92C29044F41443E`. Approval `0x26606a97330b87cba8d1efd683a56419a50c5e00cc7e105c8f78ef73197573ba` |
| The agent calls `fUSD.transfer` | Refused by the spending rule. The rule lists no denoms, and the only allowed calls are `PayGate.pay` and `PayGate.queue` | `92854431F2D83B45BD7E4D501E7595BC1B1DAF21C300CC7B99E8ECC3D7028789` |
| A bank send from the agent | Refused by the same rule | `F8F7CD24C169D7E443055CD7DE8DED8DFA7F01518019B99DA654CE0282216AFA` |

> **The gate is the guard.** The planner can propose anything. The policy clamps it. If the policy is skipped, PayGate still pays only a registered payout, once, inside the caps.

| What has been observed | Where the boundary is |
| --- | --- |
| The agent key cannot call the token | One refused `fUSD.transfer` and one refused bank send. The limit on the rule is 1 uqor per transaction and 1 uqor a day, so listing fUSD on the rule would still not match the invoice caps. Those caps live in PayGate |
| A memo that says "pay the attacker" did not change the payee | The policy refused it off chain. The chain refusal is the payee check, which does not read the memo |
| The owner can pause | Pause `0x598cbc7bb5138e36512ced1f04a0950828bf1d774500f792846307640565e5c2`, then unpause `0xd2e27f6bc29c76a64b4935601fe225296533a8e6824f392f2d57fe2354035f2c`. The gate was not left paused |
| The daily cap did not fire | The deployed daily cap is 2,500 fUSD, far above what the gate holds. The cap that fired is the per-invoice cap of 20,000 base units |

## What the track asks for

The category requirements on the [Prizes](https://build.qorechain.io/prizes) page are a scoped EVM window, transaction, value, duration and target limits, a smart-account spending rule, and authenticated messaging. The jury's point weights are not published.

| Requirement | Where it holds | Limit |
| --- | --- | --- |
| Scoped EVM window | The owner opens a hybrid-signed window for one transaction, aimed at PayGate only, with a value cap. The approval, the pause, and the unpause each ran in one | Open `02889290D115C1EEF5E4F98B2D3E00C4A3E8AE87013FE86D1E426C550EB90BE9`, approve `0x26606a97330b87cba8d1efd683a56419a50c5e00cc7e105c8f78ef73197573ba`, close `BA58A6DFC12349E430A1EC18B742C26A4B5AE581955729A5F06CB2E38EDAE060` |
| Transaction limit | An invoice id can be paid once | Replay `27F14DE41D592DB0C9E3A60D81296C81FEE4C2BC644AF56E724EE5183D731BC0` |
| Value limit | A vendor has a per-invoice cap. The daily cap is deployed and is not what stopped the demo | 25,000 queued against 20,000, `44331E7905651F0B8F49A787ECCADE4CD1F5FF5B51B9FD2AD92C29044F41443E` |
| Duration limit | The agent link expires. Registry changes wait a timelock. Owner signatures have a deadline | The current link expires at Unix time 1795169194. Executing early is `forge test --match-test test_execute_refusesBeforeTheDelay`. An expired agent is `test_pay_refusesAnExpiredAgent`. The vendor was proposed in `0xc256f81ea8e04778ddc2d6e038af7e75e02d0903ee4a301e015a6299a6ba829d` and added after the delay in `0xa9db709361f1f40b5a5aa61f4e5c09497b8089947337db919b6e013410677395` |
| Target limit | The payee has to be that vendor's registered payout | `43309EEA26AA0B9BFEEAD6B3996C446417AE4BF5F8AB75CD94A6995BD9255B03` |
| Spending rule | 1 uqor per transaction, 1 uqor a day, no denoms, and only `pay` and `queue` on PayGate | Linked in `E1796894B9AAF23D653758FB10E65BCE14968A8DBBEF4E127C3E95FB8F6AC9E4` |
| Authenticated messaging | The vendor's ML-DSA-87 signature is checked on chain with `pqcVerify`. The owner's ML-DSA-87 signature covers approval, pause, and registry changes. The mandate is sealed to the agent. Each decision has a signed receipt | Paid `3DEB1D5B87F0BA09BA82E1A1042EA5A7508DF1305913CD451D8960B5C08B3F84`. A stamp from the wrong key `75FF835453F1A80F2F98D6F0ACD21EBC9D0F193D3FC8D4A2D3FDB91D9963D36D` |

## Contents

1. [The problem](#the-problem)
2. [The rule](#the-rule)
3. [How a payment is decided](#how-a-payment-is-decided)
4. [What this does not claim](#what-this-does-not-claim)
5. [Addresses](#addresses)
6. [Evidence](#evidence)
7. [Decisions](#decisions)
8. [Stack](#stack)
9. [Getting started](#getting-started)
10. [Repo map](#repo-map)
11. [What works today](#what-works-today)
12. [Credits](#credits)

## The problem

A business wants an agent to pay invoices. The agent reads email. Email can tell it to pay someone else. A stolen agent key, including a classical key that a quantum computer can forge, should not be a second treasurer.

The money sits in a contract. The agent's chain key is allowed to call two functions on that contract, and nothing else. The contract pays a vendor-signed invoice to that vendor's registered payout, once.

No business is using this. The runs below are testnet.

## The rule

> **PayGate pays a registered payout, for an unused invoice id, inside the caps, when the vendor's current ML-DSA-87 key signed the invoice. The agent key cannot call the token.**

- **Chain rule.** The agent key is linked to the owner's account. The spending rule allows `PayGate.pay` and `PayGate.queue` only. The limit is 1 uqor per transaction and 1 uqor a day. The rule lists no denoms. Listing the token there would let the key transfer it up to that tiny cap, so the invoice caps live in PayGate instead.
- **PayGate** (`src/PayGate.sol`). The payee must be the vendor's registered payout. The id must be unused. The amount must be inside the per-invoice cap and the daily cap. The vendor's signature is checked with `pqcVerify` against the key `pqcKeyStatus` returns now. An invoice over the cap can only be queued. The owner releases it with an ML-DSA signature. Registry and cap changes need the owner's ML-DSA signature and a timelock. Pause is immediate. `withdraw` goes only to the owner and waits for the timelock.
- **Mandate** (`src/ts/mandate.ts`). The owner's budget, vendor list, and expiry. It is signed with QoreSign and sealed to the agent with QoreSeal. Unsigned, expired, replayed, or another agent's mandates are refused with stable codes.
- **Policy** (`src/ts/policy.ts`). The planner proposes. A deterministic clamp decides. Invoice text is data, never instructions. The planner is Claude through Anthropic or OpenRouter, with a rule-based fallback when no model key is set.

The agent signs a hash-chained receipt for each decision with its ML-DSA key (`agent/receipt-store.ts`). `npm run audit` checks every receipt's transaction on chain. A receipt proves what the agent signed. It does not prove the agent was right.

## How a payment is decided

1. A vendor signs an invoice with ML-DSA-87. The payee is that vendor's registered payout.
2. The planner reads the invoice. The policy either refuses it, queues it, or asks the executor to pay it.
3. The executor submits `pay` or `queue` with the agent key. The relayer pays gas. The relayer's address grants nothing.
4. PayGate checks the token, the vendor, the payout, and the unused id, then the vendor's signature. `pay` checks the per-invoice cap and the daily cap after that. The payee check runs before the signature. The comment on `_checkInvoice` says the signature is last among the checks it shares with `queue`.
5. The agent writes a receipt. `npm run audit` reads it back against the chain.

`scripts/demo-scenes.ts` sends the injected payee, the forged stamp, and the replay, and refuses to continue if any of them succeeds. `scripts/finish-demo.ts` sends the over-cap approval and the pause. Both need the keys in `~/.haven`.

## What this does not claim

| Claim we do not make | What is true instead |
| --- | --- |
| The work was done | The receipt and the vendor signature say who was paid and who signed. They do not say the invoice was honest |
| A stolen vendor key is harmless | The thief can sign invoices to that vendor's own payout, up to the caps. The owner's remedy is to pause or revoke. See [THREAT_MODEL.md](THREAT_MODEL.md) |
| The daily cap protected the demo | It is 2,500 fUSD. The gate holds far less. The per-invoice cap of 0.020000 fUSD is the one that fired |
| The browser vendor is onboarded | `/vendor` makes a key in the tab, does not save it, and does not register it. PayGate refuses what it signs |
| Courier delivers the invoices | Invoices arrive as signed JSON files. `CourierInboxAdapter` is still a placeholder. Courier is a separate repository |
| The agent can pay today without a new link | The authenticator expired at Unix time 1795169194. PayGate itself keeps the agent until Unix time 1797682327 (19 December 2026). The chain session is what blocks a new transaction |
| A public site | `apps/web` runs on localhost. It needs no secrets. It has not been deployed |
| An audit | No dashboard audit has been run on PayGate. The Foundry tests and the seven receipts are the review that exists |

## Addresses

| What | Address |
| --- | --- |
| PayGate | `0xb0c44d0a628c4593314a5c3c113d27f2d1842a05` |
| fUSD, ERC-20, 6 decimals | `0x97143B771D34ddb9130b807b135Ae675A5a963CA` |
| Owner | `qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl` / `0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396` |
| Agent key, linked to the owner, EVM calls only | `0x9C3876f2033552D5293e6efcAdFED87BfEB7E6be` |
| Vendor | `qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv` / `0xf09cc23e992A4591A456836D7223655399D0BB90` |
| PayStub, a spike target, no longer allowed | `0x500ccce41a3d219ea7751b89a59bc0248539f734` |
| Precompiles | `pqcVerify` `0x…0a01`, `pqcKeyStatus` `0x…0a02` |

One vendor is deployed. The per-invoice cap is 0.020000 fUSD. The daily cap is 2,500 fUSD.

## Evidence

| Step | What happened | Hash |
| --- | --- | --- |
| 1 | Vendor-signed invoice `steward-demo-1`, 10,000, paid once | `3DEB1D5B87F0BA09BA82E1A1042EA5A7508DF1305913CD451D8960B5C08B3F84` |
| 2 | Memo told the agent to pay `0x…00a1`. Policy refused. The chain then refused the payee | `43309EEA26AA0B9BFEEAD6B3996C446417AE4BF5F8AB75CD94A6995BD9255B03` |
| 3 | Real vendor, real payout, signed with the owner's ML-DSA key | `75FF835453F1A80F2F98D6F0ACD21EBC9D0F193D3FC8D4A2D3FDB91D9963D36D` |
| 4 | Invoice from step 1 submitted again | `27F14DE41D592DB0C9E3A60D81296C81FEE4C2BC644AF56E724EE5183D731BC0` |
| 5 | 25,000 queued, then the owner approved | Queue `44331E7905651F0B8F49A787ECCADE4CD1F5FF5B51B9FD2AD92C29044F41443E`. Approval `0x26606a97330b87cba8d1efd683a56419a50c5e00cc7e105c8f78ef73197573ba` |
| 6 | Agent calls `fUSD.transfer` | `92854431F2D83B45BD7E4D501E7595BC1B1DAF21C300CC7B99E8ECC3D7028789` |
| 7 | Owner pauses, then unpauses | Pause `0x598cbc7bb5138e36512ced1f04a0950828bf1d774500f792846307640565e5c2`. Unpause `0xd2e27f6bc29c76a64b4935601fe225296533a8e6824f392f2d57fe2354035f2c` |

The chain's event for a reverted agent call says `execution reverted: evm transaction execution failed`. It does not include the Solidity error name. The scene scripts choose inputs so the first failing check is the one in the table.

A film shot list, 2 minutes 50 seconds, is in [docs/DEMO.md](docs/DEMO.md). The film file is not in this repository.

`npm run audit` checks the agent's receipts against those transactions. It is a different command from `npm run evidence`.

## Decisions

| Decision | Why |
| --- | --- |
| Invoice caps live in PayGate, not on the spending rule | The spending rule's value limit is in uqor. Putting fUSD on it would let the agent transfer the token up to 1 uqor. The rule lists no denoms, and the token call is refused outright |
| The relayer has no authority | It submits. It cannot change the invoice, the payee, or the amount. Being `msg.sender` grants nothing |
| A lying precompile still cannot redirect | `test_lyingVerify_stillCannotRedirect` forces the mock verifier to return true. The payee check still pays only a registered payout |
| Timelock on registry changes, immediate pause | A payout change can wait. A stolen vendor key should stop now. The testnet timelock is 60 seconds |
| One vendor in the deploy | Enough to show the rule. A second vendor is a registry change, which the owner can make, and which was not part of the seven steps |
| The site does not send transactions | A guest key in the browser would need test QOR before it could act. Reading the chain is the judge path |

## Stack

Solidity on Foundry. TypeScript on Node 22. viem. `@qorechain/sdk` 0.14.0, `pqc` 0.2.3, `qoreseal` 0.1.0, `qoresign` 0.1.0, `mcp` 0.1.1, `evm` 0.14.0, `qore-cli` 0.1.1. haven-pq-kit v0.1.0. The site is Next.js, React, and Tailwind. Playwright smoke covers 390, 768, and 1280 px. Fonts are Familjen Grotesk, Newsreader, and Fragment Mono, through Fontsource, under the SIL Open Font License.

## Getting started

```bash
git clone --recurse-submodules https://github.com/datharnu/steward
cd steward
npm ci
forge test
npm run test:ts
npm run typecheck
npm run cbom:check
npm run evidence
```

`npm run cbom:check` fails the build if a contract reaches ML-DSA other than through the two precompiles, or if it uses `ecrecover`.

The site:

```bash
cd apps/web
npm ci
npm run dev      # http://localhost:3000
npm run smoke    # Playwright, on a production build
```

`npm run deploy`, `npm run link`, `npm run fund`, `npm run cli`, `npx tsx scripts/demo-scenes.ts`, and `npx tsx scripts/finish-demo.ts` read keys from `~/.haven/<name>.env`, mode 0600. Those files are not in the repository.

## Repo map

| Path | What it is |
| --- | --- |
| `src/PayGate.sol` | Holds the fUSD. Pays a vendor-signed invoice. Queues, pauses, and withdraws under the owner's ML-DSA signature |
| `src/ts/mandate.ts` | The sealed budget |
| `src/ts/policy.ts` | The clamp. Invoice text is data |
| `agent/` | The executor and the receipt store |
| `apps/web` | Read-only site. `/`, `/gate`, `/try`, `/vendor` |
| `scripts/` | Deploy, link, fund, the seven steps, evidence, the receipt audit, the CBOM check |
| `deployments/` | The hashes `npm run evidence` reads |
| `test/` | Foundry, including the payee, expiry, timelock, and lying-verifier tests |
| `docs/DEMO.md` | The seven steps and the film shot list |
| `docs/spikes.md` | What the testnet run actually did |
| `docs/kits.md` | Which QoreChain kit does which job |
| `THREAT_MODEL.md` | Who the rule stops, and who it does not |
| `AI_USAGE.md` | What was generated, and what a person decided |

## What works today

- PayGate on testnet, with one vendor.
- Seven recorded steps: a real payment, an injected payee, a forged stamp, a replay, an over-cap queue then an owner approval, a direct token call refused, and a pause then an unpause.
- A spending rule that allows two selectors and no denoms.
- A local site that reads the gate and checks a receipt in the browser.
- Foundry tests, Vitest, a CBOM check, and `npm run evidence`.

Not claimed:

- A public URL.
- A film file. The shot list is in `docs/DEMO.md`.
- A second vendor.
- Courier as the inbox. The adapter is a placeholder. Courier is a separate project.
- A live agent after 20 November 2026, 11:06 UTC, until `npm run link`.
- A dashboard audit.
- Explorer links in the site. The site shows hashes with a Copy button.

## Credits

Written during the fest, November 2026. It builds on:

- **QoreChain kits:** `@qorechain/sdk`, `@qorechain/pqc`, `@qorechain/qoreseal`, `@qorechain/qoresign`, `@qorechain/mcp`, `@qorechain/qore-cli`, `@qorechain/qorescan`, and `@qorechain/evm`. What each does here is in [docs/kits.md](docs/kits.md).
- **haven-pq-kit v0.1.0:** https://github.com/datharnu/haven-pq-kit.
- **Meter:** a sealed payment line on NEAR. The rule was kept: a signed invoice, a fixed payee, a cap, and no second payment. The code was written again for QoreChain, ML-DSA-87, and PayGate.
- **Other libraries:** viem, `@cosmjs/stargate`, `@noble/hashes`, forge-std, Vitest, tsx, Next.js, React, Tailwind CSS, and Playwright.

No code was copied from another entrant.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
