# Spikes

19 November 2026, qorechain-diana. The owner is the funded spike account. The agent key is a separate account whose mnemonic is in `~/.haven/steward-agent.env`. It was linked to the owner; it was not funded and it holds no ML-DSA key.

| | |
| --- | --- |
| Owner | `qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl` / `0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396` |
| Agent | `0x9C3876f2033552D5293e6efcAdFED87BfEB7E6be` |
| PayStub | `0x500ccce41a3d219ea7751b89a59bc0248539f734` |

`PayStub.pay()` was the stand-in target for the spike. It holds no tokens and pays nobody. The live gate is PayGate, in the next section.

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

## PayGate, live

The testnet timelock is 60 seconds. The contract allows from one minute to 30 days, and 60 seconds is long enough to see the delay while still letting a demo finish in one sitting.

| | |
| --- | --- |
| PayGate | `0xb0c44d0a628c4593314a5c3c113d27f2d1842a05` |
| Deploy | `0xb423a91a69a3b3141f58d96ed360e62ce18570cffecc922f9cea5d960b8f7637` |
| Agent rule moved onto `pay` and `queue` | `E1796894B9AAF23D653758FB10E65BCE14968A8DBBEF4E127C3E95FB8F6AC9E4` |
| Swap 500,000 uqor for fUSD | `EB15376FB38D64F24CE20A23890186F8FB97F803C5EC23DFCA01A9C1AF84DC8A` |
| Convert 21,932 fUSD base units into the gate | `E54B40E1D584D1B6CAB4F4D6B1FA8EA350918D4C2A6D363241041BB62F5790E3` |
| Vendor | `qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv` / `0xf09cc23e992A4591A456836D7223655399D0BB90` |
| Vendor key | `1661304AA09E8C464D41C3B904E11AD20FFDECF538E08B6F17E34787D6F142A9` |
| First payment, 10,000 base units | `3DEB1D5B87F0BA09BA82E1A1042EA5A7508DF1305913CD451D8960B5C08B3F84` |

After that payment the gate holds 11,932 base units and the vendor holds 10,000. The full list is in `deployments/paygate.json`. The owner had no faucet fUSD, so the token was bought from pool 2 and converted directly to the gate.
