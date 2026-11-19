# Threat model

Steward lets an AI agent pay invoices from a business's fUSD. The question is what happens when the agent is wrong, tricked, or stolen.

## What is protected

The owner's fUSD sits in PayGate, not in the account the agent acts for. It leaves PayGate in two ways only:

- `pay`, with a vendor-signed invoice. The vendor must be registered and active, and the payee must be that vendor's registered payout. The ML-DSA-87 signature must verify through `pqcVerify`, against the key `pqcKeyStatus` returns now. The invoice id must be unused. The amount must be within the vendor's per-invoice cap and the day's cap.
- `approveQueued` or `withdraw`, which need the owner's ML-DSA-87 signature. Withdraw goes only to the owner and waits for the timelock.

## Who it protects against

- **A prompt-injected planner.** Invoice memos and email bodies are data, never instructions. Whatever the model asks for, the policy clamps it to the mandate. If the policy were bypassed, PayGate still refuses any payee that is not the registered payout (demo step 2).
- **A stolen agent key.** That includes a classical key broken after Q-Day. The chain's spending rule lets the key make two calls only, `PayGate.pay` and `PayGate.queue`. It cannot call fUSD or send bank coins (demo step 6). The holder can submit invoices a vendor has already signed, and only once each. They cannot write a new one.
- **A forged or replayed invoice.** The signature is checked on chain, and a paid id is refused (demo steps 3 and 4).
- **The relayer that pays gas.** It holds no authority. It refuses any other account, target or selector, any value, and any gas over its limit. Being `msg.sender` grants nothing.
- **Someone holding only the owner's classical key.** Every owner action needs an ML-DSA-87 signature bound to chain, contract, signer, action, nonce, deadline and the argument hash. That includes adding a vendor, changing a payout or cap, moving the agent, revoking, approving, pausing and withdrawing. Every EVM window is opened by a hybrid-signed native message.
- **A rushed registry change.** Vendor, payout, cap, agent and withdraw changes wait a timelock (60 seconds on this testnet deploy). Changing a payout voids that vendor's queued invoices.

## Not protected

- **A stolen vendor ML-DSA key.** The thief can sign invoices to that vendor's registered payout, up to the caps. The money still goes to the vendor's own payout, but the owner pays for work never done. The per-invoice cap, the daily cap and the mandate's budget bound the loss. The owner's remedy is to pause or revoke.
- **A daily cap set too high.** The testnet deploy uses 2,500 fUSD per day, far above what the gate holds, so the demo is not limited by it. A real deploy should set it to what one bad day may cost.
- **The owner's mnemonic.** `~/.haven/<name>.env`, mode 0600, holds the classical key and the ML-DSA and ML-KEM keys. It is not a hardware signer or a second device.
- **Classical owner transactions.** The owner's EVM-lane calls, such as `approveQueued` and `pause`, are secp256k1 transactions. They are bounded by a window the ML-DSA key opened for one transaction to PayGate only. PayGate also checks the owner's ML-DSA signature on each call.
- **The off-chain layers.** The mandate and the policy run on the agent's machine. If that machine is fully compromised they can be skipped. The chain rule and PayGate still hold.
- **Receipts.** A receipt proves what the agent signed with its ML-DSA key, and `npm run audit` checks each one against the chain. It does not prove the agent's reasoning was right.
- **A precompile that returns true for a bad signature.** Steward trusts the chain's verifier. The Foundry mock has a lying mode, and `test_lyingVerify_stillCannotRedirect` shows that even then money goes only to a registered payout.
- **Expiry of the agent's link.** The chain's session is 24 hours. After that the agent cannot act until the owner runs `npm run link`, which revokes the authenticator and registers a new one. That fails closed, and it stops new payments. The recorded transactions stay valid.
- **The vendor page in the browser.** It makes a new key in the tab and does not save or register it. A file it signs is refused by PayGate. It shows how signing works. It is not onboarding.
- Nothing here has been audited.
