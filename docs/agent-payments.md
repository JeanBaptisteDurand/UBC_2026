# How an AI agent pays on ArcHive

Back to the [README](../README.md). The agent's loop, its two ways to pay (x402 per call, prepaid sessions) and the limits that cap what it can lose.

## Agent decision loop and safety limits

An AI agent reads ArcHive through the API or the MCP server and calls a service through the SDK
([`packages/sdk`](../packages/sdk/)). The loop can stop at three points: before the request is encrypted, before a payment
is signed, and before the answer is used. Payments are signed by the agent's own wallet (for x402, a plain account, an
EOA, today) or by a person in theirs: one capped authorization per call, or one deposit per session (plus any top-up
its owner signs). The MCP server and AskHive only read and prepare, and a person signs what they prepare, in their
own wallet.

1. **Discover.** The agent reads the offer from [`/api/products`](https://arc-hive.xyz/api/products) and
   [`/api/enclaves`](https://arc-hive.xyz/api/enclaves), or from the MCP tools `arc_products`, `arc_pricing` and
   `arc_enclaves`: each product's price and unit, settlement contract, minimum bond and exposure cap, and the enclaves
   admitted to serve it. Today a call to product 3 costs 0.01 USDC, and product 1 costs 0.10 USDC per 1,000 tokens.
2. **Check the machine.** The SDK reads the enclave's keys from its `/pubkeys`, which may come through a relay (for
   product 3: `https://arc-hive.xyz/enclave/x402/pubkeys`). It trusts none of it until it has read `EnclaveRegistry`
   on Arc, at a single block (`verifyEnclaveKeys`). It stops if Arc holds no enclave for that key, if the enclave is
   registered for another product, if its X25519 key is not the registered one, or if it is not active. Arc admitted
   the key only after Intel's signature and an image fingerprint the product's author allowed (see
   [How Arc verifies an enclave](how-it-works.md#how-arc-verifies-an-enclave)). Only then is the request encrypted (HPKE), to the key
   Arc holds.
3. **Pay, within a cap.**
   - *Per call (x402, product 3).* The agent's wallet signs one EIP-3009 authorization for exactly the on-chain price,
     payable only to `X402Settler` and valid for one hour at most. Its nonce commits to this sealed request and this
     enclave, so it can pay for this call only, and only once. The SDK checks the enclave's 402 (payee, asset, amount)
     against Arc, and signs nothing above the agent's `maxAmount` or above the price read when the call began.
   - *Prepaid session (product 1).* One EIP-3009 deposit into `SessionPay`, topped up only by a new signature of its
     owner. The session is locked to one enclave, one operator, one model and one price. Settlements never pay more
     than the deposit, and what is not spent is refunded at close.
4. **Verify the answer.** The receipt must be signed by the enclave key Arc holds and must carry this request: the
   product, the payer and the payment's nonce for a call, or the session and the request's sequence number for a
   session, plus the hashes of the request sent and of the text received. Otherwise the SDK throws and returns no text.
5. **Settle.** The operator's registrar submits the receipt: `X402Settler.settle` for a call, `SessionPay.settle` on the
   last cumulative receipt for a session. The contract checks that the signer was an admitted enclave at the receipt's
   anchor block, moves the USDC, charges the amount to the operator's bond exposure, and splits it in the same
   transaction: 95 % to the operator and 5 % to the network on products 1 and 3. In
   [`0xeadad0b4…fbd0`](https://explorer.testnet.arc.io/tx/0xeadad0b46d51a733997777bccfedd3f05dc69a0a942620f7458c75e35c16fbd0),
   sent by the operator, 0.01 USDC leaves the payer: 0.0095 to the operator, 0.0005 to the network treasury.
6. **On a lie.** Two different signed answers to the same request (`SessionPay.reportEquivocation`), or a bounty claim
   refuted by the enclaves of at least two other operators within 3 days (`SealedBounty.refute`), seize the operator's
   whole bond and ban it, and `VerdictLog` writes 0 to the ERC-8004 validation registry on Arc. A session that was
   served and paid closes with a verdict of 100. The refutation demo ran on Arc (product 5 of the previous set), and sessions closed with a verdict of 100
   (see [the previous set's proofs](../docs/history.md#proofs-the-previous-set)).

Every payment in [the proofs](../docs/history.md#proofs-the-previous-set) came from our own testnet wallets.
[`packages/sdk/scripts/x402-call.ts`](../packages/sdk/scripts/x402-call.ts) is a buyer that runs this loop with the SDK.

**Safety limits**

| Limit | The rule today | Enforced in |
|---|---|---|
| Per-call cap | Nothing is signed above the agent's `maxAmount`, and a price that rises during a call needs a new consent. The authorization is for the exact price, to `X402Settler` only, valid 60 s to 1 h. The site and the console set `maxAmount` to the price they show, and their wallet guard refuses any other signature. | SDK ([`x402.ts`](../packages/sdk/src/x402.ts)); USDC's EIP-3009 fixes the amount and the payee |
| One payment, one call | The nonce commits to the sealed request, and an authorization re-signed after a price change keeps the same nonce. `X402Settler` collects only with an enclave receipt carrying that nonce, and USDC accepts a nonce once. | SDK, contract ([`X402Settler.sol`](../contracts/src/X402Settler.sol)) |
| Session budget | Settlements never pay more than the deposit, or a lower `cap`. Price and model are locked at opening, and the rest is refunded at close. | Contract ([`SessionPay.sol`](../contracts/src/SessionPay.sol): `settle`, `closeSession`) |
| Admitted enclaves only | The SDK encrypts only to a key Arc registered for this product and active now. Settlement pays only a signer that was active for the product at the receipt's anchor block (for a session, the enclave locked at opening). | SDK ([`enclave-keys.ts`](../packages/sdk/src/enclave-keys.ts)), contracts (`EnclaveRegistry.activeOperatorAt`) |
| Allowed images only | Admission requires an image fingerprint the product's author allowed. Once an image is retired, anyone can invalidate its enclaves at once, with no grace period (`invalidateRetiredWorkload`). | Contract ([`EnclaveRegistry.sol`](../contracts/src/EnclaveRegistry.sol), [`ProductRegistry.sol`](../contracts/src/ProductRegistry.sol)) |
| No signing tool | The MCP server holds no key, and none of its 16 tools sends a transaction. AskHive has no tool that spends. Both return operations that people sign in their own wallet. | MCP ([`services/mcp`](../services/mcp/)), AskHive ([`enclave-site.ts`](../services/copilot/src/enclave-site.ts)) |
| Bond exposure | What an operator's enclaves can release is capped, over any 24 hours, at half its bond (less any pending withdrawal) and at 10 USDC per product ([the rule](how-it-works.md#economic-design-and-risk-assumptions)). | Contract ([`OperatorBond.sol`](../contracts/src/OperatorBond.sol): `consumeExposure`) |
| Slashing | A proven fault seizes the whole bond and bans the operator ([who receives it](how-it-works.md#economic-design-and-risk-assumptions)). | Contract (`OperatorBond.slash`, called by `SessionPay` and `SealedBounty`) |

The most a dishonest enclave can take from an agent is what the agent signed: one call's price, or what it deposited in
a session. An attestation proves which code ran, not that an AI answer is right, so only provable faults are slashed
(see [Economic design and risk assumptions](how-it-works.md#economic-design-and-risk-assumptions)).
