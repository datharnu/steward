# Steward

An accounts-payable agent for QoreChain. The agent key cannot move funds. The only payment the chain will let it make is a vendor-signed invoice through the gate, to a vendor the owner approved, once, inside the caps.

Nothing here is audited. PayGate is deployed on qorechain-diana and one vendor invoice has been paid. The public repo is https://github.com/datharnu/steward. The site is one desk in `apps/web` (`npm install` and `npm run dev` there): the paid invoice, then what the clerk does if the invoice changes. It reads the gate and does not send a transaction. The rest of the demo scenes are not done. See `docs/spikes.md` and `deployments/paygate.json`.

Apache-2.0.
