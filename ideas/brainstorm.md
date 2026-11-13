# Brainstorm

Raw list, no filtering yet. Anything goes; we score in `scoring.md`.

## Payments / agents

- **Pay-per-call APIs for agents**: an agent pays in USDC per request (HTTP 402 style), settles onchain.
- **Private AI inference**: a model runs in a hardware enclave, the user pays per answer and gets a proof of where it ran.
- **Agent with a spending policy**: limits, allowlists and a kill switch enforced by a contract, not by the agent.

## DeFi / onchain apps

- **Real yield vs displayed yield**: measure what a vault actually paid (share price over time) against the APY it shows.
- **Fake token guard**: flag look-alike tokens and impostor contracts before the user signs.
- **Sealed bug bounty**: a hacker proves an exploit works without revealing it; the bounty pays out automatically.
- **Verifiable compute marketplace**: operators run jobs in attested enclaves, a contract checks the attestation and pays them.

## Consumer

- **Rent deposit escrow**: the deposit sits in USDC under clear rules instead of in the landlord's account.
- **Shared expenses with stablecoins** for student housing.
- **Prediction market companion**: a simple mobile view on prediction markets (Gemini bounty).

## Questions to keep in mind

- Who is the user, by name?
- What does the judge see in the first 20 seconds of the demo?
- Why does it need a chain at all?
