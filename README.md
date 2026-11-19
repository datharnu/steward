# Steward

An accounts-payable agent for QoreChain. The agent key cannot move funds. The only payment the chain will let it make is a vendor-signed invoice through the gate, to a vendor the owner approved, once, inside the caps.

Nothing here is audited. PayGate is deployed on qorechain-diana and one vendor invoice has been paid. Three further agent calls were refused on testnet: an injected payee, a signature from the wrong ML-DSA key, and a replay. See `docs/DEMO.md`. The over-cap approval and the on-chain pause have not been sent: the owner account no longer has enough QOR for an EVM window, and the gate does not hold enough fUSD to pay an invoice over the cap.

The public repo is https://github.com/datharnu/steward. The site is one desk in `apps/web` (`npm install` and `npm run dev` there). It reads the gate and does not send a transaction.

## Prior work

The payment rule — a signed invoice, a fixed payee, a cap, and no second payment — comes from my earlier project Meter (a sealed invoice line on NEAR). The rules were ported. The code was rewritten during this event for QoreChain, ML-DSA-87, and PayGate.

Apache-2.0.
