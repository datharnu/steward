# Kits and libraries

Every version is pinned exactly in `package.json` and `apps/web/package.json`.

## QoreChain kits

| Package | Version | Job here |
| --- | --- | --- |
| `@qorechain/sdk` | 0.14.0 | The unified eth-native account and `EthNativeSigner`. ML-DSA sign. Window, link and spending-rule messages. `fetchAuthNonce`, `evmAuthSignBytesV2` and `MsgExecuteEVM` for the agent key. The swap on pool 2 |
| `@qorechain/pqc` | 0.2.3 | ML-DSA-87 and ML-KEM-1024 underneath the SDK and QoreSeal |
| `@qorechain/qoreseal` | 0.1.0 | Seals the owner's mandate to the agent's ML-KEM-1024 key |
| `@qorechain/qoresign` | 0.1.0 | Signs the mandate. Sign In With QoreChain for the local pause and resume. `pqVerify` for receipts and for the vendor signature on the recorded pay, in Node and in the browser. Key generation and signing for the vendor page |
| `@qorechain/mcp` | 0.1.1 | `get_transaction` and `get_pq_status`, called in-process by `npm run evidence` and `npm run audit` |
| `@qorechain/qore-cli` | 0.1.1 | Installed for manual checks (`npx qore`). The scripts use MCP |
| `@qorechain/qorescan` | 0.1.0 | The CycloneDX CBOM (`npm run cbom`) and the data behind `npm run cbom:check` |
| `@qorechain/evm` | 0.14.0 | Installed. Its chain object is typed for a newer viem than 2.47.6, so chain id 9800 is defined in haven-pq-kit |
| `haven-pq-kit` | v0.1.0 (git tag) | `PqAuth` and `VendorSig` in Solidity. Invoice and owner-auth encoding, signing, windows and key reads in TypeScript. Our own library, written during the event |

## Other libraries

| Package | Version | Job here |
| --- | --- | --- |
| `viem` | 2.47.6 | ABI encoding that matches Solidity, the EVM client, and the owner's EVM-lane transactions. The site uses the same 2.47.6 to decode the recorded `pay` call |
| `@cosmjs/stargate` | 0.39.0 | Broadcast transport for `EthNativeSigner` |
| `@noble/hashes` | 2.4.0 | keccak-256 for the receipt hash and the invoice bytes in the browser |
| `forge-std` | v1.17.0 | Foundry test helpers |
| `vitest` | 3.2.4 | TypeScript tests |
| `tsx` | 4.19.4 | Runs the TypeScript scripts |
| `next` | 16.4.6 | The site in `apps/web` |
| `react`, `react-dom` | 19.1.1 | The site |
| `tailwindcss`, `@tailwindcss/postcss` | 4.1.17 | Styles |
| `@playwright/test` | 1.65.1 | The headless smoke test in CI |
| `@fontsource/familjen-grotesk`, `@fontsource/newsreader`, `@fontsource/fragment-mono` | 5.3.0 | Fonts, served from the site itself. All three are under the SIL Open Font License |

## Not used, and why

- `create-qorechain-dapp`. The site sends no transactions and connects no wallet, so the template's wallet and signing stack would be unused code. The site was written from an empty Next.js app.
- `@qorechain/wallet-adapter` and `@qorechain/qorex-types`. There is no wallet connection yet. See the deferred list in the README.

`npm audit` in the root reports an advisory in `ws`, which viem 2.47.6 depends on. Steward uses only HTTP transports.
