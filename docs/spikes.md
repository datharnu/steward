# Spikes

19 November 2026, qorechain-diana. The owner is the funded spike account. The agent key is a separate account whose mnemonic is in `~/.haven/steward-agent.env`. It was linked to the owner; it was not funded and it holds no ML-DSA key.

| | |
| --- | --- |
| Owner | `qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl` / `0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396` |
| Agent | `0x9C3876f2033552D5293e6efcAdFED87BfEB7E6be` |
| PayStub | `0x500ccce41a3d219ea7751b89a59bc0248539f734` |

`PayStub.pay()` is a stand-in target. It holds no tokens and pays nobody. The real gate is not written yet.

## What was linked

One account-wide rule, id `agent`, and one authenticator. The authenticator has the `evm` permission only, so it cannot bank-send. The chain requires an `evm` key to sit under a rule that bounds every denom, so the rule has `per_tx_limit = 1` and `daily_limit = 1`. It lists no denoms. Its only allowed call is `PayStub.pay` (`0x1b9265b8`).

The link is `7319091B553DA90E758C2393F6A2354CD6138EBA5C1A4938BE8F561894CC9CB5`. The stub was deployed in an unscoped window: open `99E56C9142616508F895382F501447D577F0DA8707D5B291FA5EEB14602CDEAE`, create `0xfe6e50a2d27c2834a7130a187335af43be832bb3968a81f45e9e5ac82f0b1fd7`, close `2E95D43ED1B58880799BE0D1311B1B531C62737D282439E737243E2A318B5C72`.

## The three attempts, made with the agent key

| Attempt | Result | Hash |
| --- | --- | --- |
| (a) `fUSD.transfer` of 1 base unit, from the owner, to the owner | Refused. Code 0, and `abstractaccount_execution_failed`. The call never reached the token. | `92854431F2D83B45BD7E4D501E7595BC1B1DAF21C300CC7B99E8ECC3D7028789` |
| (b) bank send of `1uqor` | Refused before execution. Code 10: the key lacks the `send` permission. | `F8F7CD24C169D7E443055CD7DE8DED8DFA7F01518019B99DA654CE0282216AFA` |
| (c) `PayStub.pay()` | Allowed. Code 0. The `MsgExecuteEVM` response is `success = true`, inner gas 22,299, no vm error. | `6042BA446BAAC174ED4CEAD7F3D7A9C3C285CD528EA83632FB94CE8FD04B1212` |

The chain's own refusal for (a) names the hole this project has to keep shut:

> a linked key with a spending rule may call the token with data only if the rule lists the call in `allowed_evm_calls`, or lists the token as `erc20/<address>` for a transfer or approval.

An empty denom list does not grant that. Listing `erc20/0x97143B771D34ddb9130b807b135Ae675A5a963CA` would. Steward's rule must never list fUSD, and fUSD must sit in the gate contract rather than in the account the agent acts for.
