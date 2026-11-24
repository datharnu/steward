# Steward: project page text (build.qorechain.io)

Paste-ready text for the project page. Every address and hash below is copied from `README.md` and `deployments/` (`paygate.json`, `spikes.json`).

## About

An AI clerk pays your vendor invoices on QoreChain, and it cannot be talked into paying anyone else. A real LLM reads each invoice and proposes pay, queue, skip or flag. It is allowed to be wrong: a deterministic policy checks every proposal, the agent's key can only call `PayGate.pay` or `PayGate.queue` (QoreChain's smart-account spending rule blocks direct token transfers), and `PayGate` pays only a vendor's registered payout, only with that vendor's fresh ML-DSA-87 invoice signature, within per-invoice and daily caps. On Diana testnet (23 November 2026) we fed the same prompt-injected invoice to three models: Claude Opus 5.5 and NVIDIA Nemotron caught it, a 1.7B model was fooled, and `PayGate` still moved 0 fUSD on chain. Claude and Nemotron each then planned and paid a real vendor invoice.

Video (2:52): https://drive.google.com/file/d/1mUh-dda2ASZyrWBwMMkpk_qW5mIdrAT5/view · Live demo: https://steward-amber.vercel.app (try `/jailbreak` to attack the real AI clerk yourself, then `/gate`; no wallet) · Code: https://github.com/datharnu/steward (Apache-2.0)

## Contracts and accounts (`qorechain-diana`, EVM chain ID 9800)

| Role | Address |
| --- | --- |
| `PayGate` | [`0xb0c44d0a628c4593314a5c3c113d27f2d1842a05`](https://explore.qore.network/address/0xb0c44d0a628c4593314a5c3c113d27f2d1842a05) |
| fUSD (ERC-20) | `0x97143B771D34ddb9130b807b135Ae675A5a963CA` |
| Agent key (EVM calls to `PayGate` only) | `0x9C3876f2033552D5293e6efcAdFED87BfEB7E6be` |
| Vendor | `0xf09cc23e992A4591A456836D7223655399D0BB90` |

## Key transactions

| What | Hash |
| --- | --- |
| Spending rule linked: 0 denoms, only `PayGate.pay` / `queue` | `E1796894B9AAF23D653758FB10E65BCE14968A8DBBEF4E127C3E95FB8F6AC9E4` |
| Agent key calls `fUSD.transfer` directly: refused by the chain | `92854431F2D83B45BD7E4D501E7595BC1B1DAF21C300CC7B99E8ECC3D7028789` |
| Fooled LLM's payment to the attacker: refused by `PayGate`, 0 moved | `807954AAFAE5A847F504C9F97FF56EBA0F1CA071CAEF34C125CE4F54E0EEC186` |
| Invoice planned and paid by Claude Opus 5.5 | `F49A3DFC756722AF6C65FF32A80C617FD54E0C26196134E095A2E92C54963340` |
| Invoice planned and paid by NVIDIA Nemotron 3.5 Super | `695DD3E8184A25C59897EA58718352A5C54CEC0F6DCD61CEEAB821B461D86A91` |

Explorer: https://explore.qore.network (select **Testnet**). These are Cosmos transaction hashes; search them on the explorer. `npm run evidence` re-checks all 41 recorded hashes with no keys.

## Honest notes

- Testnet only; fUSD has no value.
- The one fooled result needed the model's guard deliberately removed (a simulated jailbreak); the README labels it as such.
- Steward proves who was paid and that the vendor signed, not that the billed work was delivered.
