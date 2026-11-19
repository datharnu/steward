# Steward

An accounts-payable agent for QoreChain. The agent key cannot move funds. The only payment the chain will let it make is a vendor-signed invoice through the gate, to a vendor the owner approved, once, inside the caps.

Nothing here is audited. PayGate is deployed on qorechain-diana, and all seven demo steps have run there. One invoice was paid. An injected payee, a signature from the wrong ML-DSA key, and a replay were refused. An over-cap invoice was queued and then approved by the owner. The agent was refused when it called the token directly. The gate was paused and unpaused. See `docs/DEMO.md`.

Public repository: https://github.com/datharnu/steward. Category: Post-Quantum AI Agents.

## Testnet addresses

Network `qorechain-diana`, EVM chain id 9800.

| What | Address |
| --- | --- |
| PayGate | `0xb0c44d0a628c4593314a5c3c113d27f2d1842a05` |
| fUSD (ERC-20, 6 decimals) | `0x97143B771D34ddb9130b807b135Ae675A5a963CA` |
| Owner account | `qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl` / `0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396` |
| Agent key (linked to the owner, EVM calls only) | `0x9C3876f2033552D5293e6efcAdFED87BfEB7E6be` |
| Vendor | `qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv` / `0xf09cc23e992A4591A456836D7223655399D0BB90` |
| PayStub (spike only, no longer allowed) | `0x500ccce41a3d219ea7751b89a59bc0248539f734` |
| Precompiles | `pqcVerify` `0x…0a01`, `pqcKeyStatus` `0x…0a02` |

## How it holds

- **Chain rule.** The agent key is linked to the owner's account with a spending rule whose only allowed calls are `PayGate.pay` and `PayGate.queue`. It lists no denoms. The spike in `docs/spikes.md` shows the key refused on `fUSD.transfer` and on a bank send.
- **PayGate** (`src/PayGate.sol`). It holds the fUSD and pays only a vendor-signed invoice. The payee must be the vendor's registered payout, the id must be unused, and the amount must be inside the per-invoice and daily caps. The vendor's ML-DSA-87 signature is checked on chain with `pqcVerify`. An invoice over the cap can only be queued, and the owner releases it with an ML-DSA signature. Registry and cap changes need the owner's ML-DSA signature and a timelock. Pause is immediate.
- **Mandate** (`src/ts/mandate.ts`). The owner's budget, vendor list and expiry. It is signed with QoreSign and sealed to the agent with QoreSeal. Unsigned, expired, replayed, or another agent's mandates are refused with stable codes.
- **Policy** (`src/ts/policy.ts`). The planner, Claude through Anthropic or OpenRouter with a rule-based fallback, proposes. A deterministic clamp decides. Invoice text is data, never instructions.

The agent signs a hash-chained receipt for each decision with its ML-DSA key (`agent/receipt-store.ts`). `npm run audit` checks every receipt's transaction on chain.

## Run it

Node 22 and Foundry.

```bash
git clone --recurse-submodules https://github.com/datharnu/steward
cd steward
npm ci
forge test                # unit, fuzz, invariant and byte-vector tests
npm run test:ts           # agent, mandate, policy, executor
npm run typecheck
npm run cbom:check        # contracts reach ML-DSA only through the precompiles, no ecrecover
npm run evidence          # re-checks every recorded testnet hash through @qorechain/mcp
```

The site, which reads the chain and sends no transaction:

```bash
cd apps/web
npm ci
npm run dev               # http://localhost:3000
npm run smoke             # Playwright, on a production build, at 390, 768 and 1280 px
```

`/` shows the rule and the seven testnet steps. `/gate` reads PayGate live and checks the agent's receipt signature in the browser. `/try` lets you change an invoice and see what is refused. `/vendor` signs an invoice with a key made in the tab.

The scripts that send transactions read keys from `~/.haven/<name>.env` (mode 0600), never from the repository: `npm run deploy`, `npm run link`, `npm run fund`, `npm run cli`, `npx tsx scripts/demo-scenes.ts`, and `npx tsx scripts/finish-demo.ts`.

More: `docs/DEMO.md` (the steps and the video), `docs/spikes.md` (what the testnet actually did), `THREAT_MODEL.md`, `docs/kits.md`, `AI_USAGE.md`.

## Deferred and known limits

- **The agent link expires.** The authenticator expires after the chain's session lifetime, at Unix time 1795169194 for the current link. After that the agent cannot act until the owner runs `npm run link` again.
- **No guest, QoreX or MetaMask sign-in on the site.** The site reads the chain only. A guest key made in the browser would need testnet QOR before it could act.
- **Vendor onboarding stops at signing.** Registering a vendor's ML-DSA key and adding it to PayGate are transactions, and they run from the CLI. The browser key is not saved or registered, and the page says so.
- **Courier.** Invoices arrive as signed JSON files. `CourierInboxAdapter` is a placeholder until Courier exists.
- **One vendor.** The deploy has one vendor, with a per-invoice cap of 0.020000 fUSD. The daily cap of 2,500 fUSD is far above what the gate holds.
- **No explorer links.** The site shows hashes with a Copy button.
- **Not deployed to a public URL yet.** The site needs no secrets.

## Credits

Written during the event, November 2026. It builds on:

- **QoreChain kits:** `@qorechain/sdk`, `@qorechain/pqc`, `@qorechain/qoreseal`, `@qorechain/qoresign`, `@qorechain/mcp`, `@qorechain/qore-cli`, `@qorechain/qorescan` and `@qorechain/evm`. What each does here is in `docs/kits.md`.
- **haven-pq-kit v0.1.0:** https://github.com/datharnu/haven-pq-kit, our shared library from this event.
- **Other libraries:** viem, `@cosmjs/stargate`, `@noble/hashes`, forge-std, Vitest, tsx, Next.js, React, Tailwind CSS and Playwright.
- **Fonts:** Familjen Grotesk, Newsreader and Fragment Mono, through Fontsource, under the SIL Open Font License.

No code was copied from another entrant.

## Prior work

The payment rule comes from my earlier project Meter, a sealed invoice line on NEAR. The rule is a signed invoice, a fixed payee, a cap, and no second payment. The rules were ported, and the code was rewritten during this event for QoreChain, ML-DSA-87, and PayGate.

## Licence

Apache-2.0.
