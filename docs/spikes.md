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

## Three refusals after the payment

19 November 2026. The policy refuses an injected payee before a transaction (`REFUSED_PAYEE_MISMATCH`). The same invoice was then submitted with the agent key, and PayGate reverted. A signature from the owner's ML-DSA key, and a replay of the paid invoice, also reverted. The chain event on each one is `execution reverted: evm transaction execution failed`.

| | Hash |
| --- | --- |
| Injected payee | `43309EEA26AA0B9BFEEAD6B3996C446417AE4BF5F8AB75CD94A6995BD9255B03` |
| Wrong ML-DSA key | `75FF835453F1A80F2F98D6F0ACD21EBC9D0F193D3FC8D4A2D3FDB91D9963D36D` |
| Replay | `27F14DE41D592DB0C9E3A60D81296C81FEE4C2BC644AF56E724EE5183D731BC0` |

The owner account then held 27,429 uqor, which was not enough to open an EVM window. After it was funded, 500,000 uqor bought 21,930 fUSD base units into the gate (`99700A69BF2AC71C0D997EE2ECE5682BA673543771C4A18B11403A13485D76A5`, `63F2352EE1104A5470D94AD4823EAE7B6F2177E166C2EC796FEBA90953819E53`). The agent queued a 25,000 invoice (`44331E7905651F0B8F49A787ECCADE4CD1F5FF5B51B9FD2AD92C29044F41443E`). The owner approved it (`0x26606a97330b87cba8d1efd683a56419a50c5e00cc7e105c8f78ef73197573ba`), paused the gate (`0x598cbc7bb5138e36512ced1f04a0950828bf1d774500f792846307640565e5c2`), and unpaused it (`0xd2e27f6bc29c76a64b4935601fe225296533a8e6824f392f2d57fe2354035f2c`).
