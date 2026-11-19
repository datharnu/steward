# How this was written

19 November 2026.

## Workflow

One Cursor agent session (Claude), working from the shared Haven context block and the Steward prompt (Prompt 2). The human pasted both. The agent wrote the Solidity, the tests, the agent, the scripts, the site and these documents.

The human approved each step that touched the network or GitHub: deploying PayGate, funding it, linking the agent key, registering the vendor, sending each demo transaction, creating the public repository and every push. The human also claimed the faucet for the owner account so that demo steps 5 and 7 could run.

The agent checked SDK calls against the installed type declarations and against live answers from the testnet. It did not copy another entrant's repository.

## What the human decided

- The product and its one rule. An AI accounts-payable agent whose key cannot move funds. The only payment the chain allows is a vendor-signed invoice to an approved vendor, once, inside the caps.
- To run the spending-rule spike first and stop if it failed. It passed.
- To drop the first homepage, which had been built from a skill's template. The human asked the agent to design what suited the product instead.
- The site's structure: a homepage that shows the seven testnet steps, then separate pages for the live gate, the desk and vendors. The agent proposed three options and the human picked this one.
- To fund the owner account and finish steps 5 and 7, rather than leave them marked as not run.
- To finish the documents and CI before moving to Courier.

## What the agent chose, open to change

- PayGate's `agent` is the owner's own EVM address. `MsgExecuteEVM` runs as the owner's account, and the chain's spending rule is what limits the agent key.
- The spending rule sets per-transaction and daily limits of 1 uqor and lists no denoms. The chain requires a bounded rule, and fUSD moves inside PayGate, not from the owner.
- The testnet timelock is 60 seconds, so the demo fits one sitting.
- The over-cap invoice is 25,000 base units against the 20,000 cap. The demo pauses the gate, then always unpauses it.
- The site never sends a transaction. Examples on the desk are labelled. Where the chain already refused the same thing, the desk shows that hash.
- The site has no explorer links, because the testnet explorer's URL format for a transaction was not confirmed. Hashes have a Copy button instead.
- The vendor page uses a fresh key per tab and says that PayGate would refuse it.

## Mistakes the agent made and fixed

- The relayer treated a successful payment as failed, because this chain's successful `MsgExecuteEVM` often has no `abstractaccount_execution` event. The first receipt was saved as `failed_execution`, and `npm run audit` caught it. The relayer and executor now read the invoice's state on chain when the event is missing. The receipt was signed again with the agent's ML-DSA key, with the confirmed status.
- A first run of the refusal scenes used a lower fee. The chain gave the call less gas than the agent had signed for, and transaction `71590AF9E1189CC01E14E7BDD7FB480EE651036D2540FD1969A107D44DD99934` failed. It cost 135,000 uqor. It is not in `deployments/` because it proves nothing. The scenes were rerun with the standard fee.
- `foundry.toml` and `.gitignore` were overwritten by mistake during the work. Both were restored before anything was committed, so `agent-state/` was never added.
- The phone's fixed verdict bar scrolled with the page, because an entrance animation used `transform`. The animation now changes opacity only.
