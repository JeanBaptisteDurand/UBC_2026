/**
 * sealed-bounty/server.ts — the Sealed Bounty (O3) as an HTTP service (see ./app.ts).
 * The enclave opens the encrypted exploit bundle (cE), replays it in a fork (arc-anvil at block N in a real VM),
 * evaluates the predicate, and signs the EIP-712 claim if the exploit is proven.
 *
 * v2: the hunter can set blockN and the deadline in the bundle (k enclaves sign the same claim); one service for the
 * process's whole life (anti-equivocation memory); tiers read on-chain. Variables: OPERATOR_ALLOWLIST, RPC_URLS (the
 * quorum, default RPC_URL).
 *
 * v2.1: POST /v1/refute, the counter-replay of an accepted claim (same engine, same replay queue); an EIP-712
 * refutation is signed only if the result differs; on-chain reads at the same block through the quorum (claimRecords,
 * REFUTE_WINDOW, the bounty, this enclave's activeOperatorAt on REGISTRY).
 *
 * v2.1 bis (adversarial review of 9 Nov): the replay fails closed (never a signature on an outage of the fork's RPC). At
 * start-up, an ENGINE CHECK (AnvilForkRunner.selfTest): a read refused by the fork's RPC must surface as an error,
 * otherwise the machine refuses to start. REFUTE_ACCEPTED_FROM (optional, Unix seconds, measured in the compose file):
 * claims accepted before it are not judged (an image with different replay rules may have signed them).
 *
 * v2.1 ter (adversarial verification of 9 Nov): the engine talks to the fork's RPC through a STRICT RELAY
 * (src/services/rpc-relay.ts: the shape of each answer, a block ≤ N that is never null and is tied to the anchor, a
 * request budget per replay). The engine check also covers a block returned as null, a malformed storage slot and
 * healthy reads. The rate of /bounty/submit and /v1/refute is limited (tokens taken after the cheap checks); a bounty
 * is read once (shared cache).
 *
 * v2.1 quater (refutation demo, product 5): DEMO_FAULT=inflate-loss (in clear in the compose file, so measured) makes
 * the enclave sign its claims with a DOUBLED loss (honest refutations). It is checked BEFORE everything else
 * (./demo-fault.ts): product 2, an absent PRODUCT_ID, OPERATOR_ALLOWLIST=* or one with the main operator, an unknown
 * value → stop. One log line at start-up; /pubkeys and /health announce it. When absent, nothing changes.
 */
import { serve } from "@hono/node-server";
import { type Address } from "viem";
import { EnclaveKit } from "../../src/kit/enclave-kit";
import { RpcQuorum } from "../../src/kit/rpc-quorum";
import { parseOperatorAllowlist } from "../../src/server/attest-server";
import { createDstackClient } from "../../src/kit/dstack";
import { BountyService, DeterministicProtocolCipher, RefutationService, type BlockSource } from "../../src/services/bounty";
import { AnvilForkRunner } from "../../src/services/anvil-fork";
import { spawnSync } from "node:child_process";
import { BountyCache, chainBountyReader, chainRefuteReader, createSealedBountyApp } from "./app";
import { DemoFaultConfigError, demoFaultStartupLine, parseDemoFault } from "./demo-fault";

const RPC = process.env.RPC_URL ?? "https://rpc.testnet.arc.io";
const RPC_URLS = (process.env.RPC_URLS ?? RPC).split(",").map((s) => s.trim()).filter(Boolean);
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "5042002");
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? "0");
/** A required contract address (set and measured by the enclave's compose file): without it, stop. */
function requiredAddress(name: string): Address {
  const v = process.env[name];
  if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    console.error(`${name} required (the contract's address on Arc): stopping.`);
    process.exit(1);
  }
  return v as Address;
}
const SEALED = requiredAddress("SEALEDBOUNTY");
const REGISTRY = requiredAddress("REGISTRY");
const PORT = Number(process.env.PORT ?? "8803");

// v2.1 quater: the DEMO fault is checked before everything else (refused → stop, nothing is served)
const DEMO_FAULT = demoFaultOrExit();

function demoFaultOrExit() {
  try {
    const f = parseDemoFault({ DEMO_FAULT: process.env.DEMO_FAULT, OPERATOR_ALLOWLIST: process.env.OPERATOR_ALLOWLIST }, PRODUCT_ID);
    if (f) console.warn(demoFaultStartupLine(f, PRODUCT_ID));
    return f;
  } catch (e) {
    console.error(`${e instanceof DemoFaultConfigError ? e.message : "DEMO_FAULT unreadable"}: stopping.`);
    process.exit(1);
  }
}

// The REAL replay: a fork of Arc at block N (anvil), the exploit run from the hunter's address, the predicate measured
// before and after on the fork's state (Arc's USDC emulated faithfully, see src/services/anvil-fork.ts). No simulated
// replay: without anvil, the machine refuses to start (it fails closed).
const FORK_RPC = process.env.FORK_RPC_URL ?? RPC_URLS[0]!;
const ANVIL_BIN = process.env.ANVIL_BIN ?? "anvil";
// 10 Nov: STATE PROOFS. STATE_PROOF_RPC_URL (a MEASURED variable of the compose file): each state read of the replay is
// proven (eth_getProof checked against the stateRoot of the anchored header N); no RPC is then trusted for the state.
// When absent: the earlier contract (headers tied to the anchor, state not proven), stated at start-up.
const STATE_PROOF_RPC = process.env.STATE_PROOF_RPC_URL?.trim() || undefined;
if (STATE_PROOF_RPC !== undefined && !/^https:\/\/[^\s]+$/.test(STATE_PROOF_RPC)) {
  console.error("STATE_PROOF_RPC_URL invalid (https:// expected): stopping.");
  process.exit(1);
}
console.log(STATE_PROOF_RPC ? `replay: state PROVEN (eth_getProof) via ${new URL(STATE_PROOF_RPC).host}` : "replay: headers tied to the anchor, state NOT proven (STATE_PROOF_RPC_URL absent)");
const fork = new AnvilForkRunner({ forkUrl: FORK_RPC, anvilBin: ANVIL_BIN, stateProofsUrl: STATE_PROOF_RPC });

/** REFUTE_ACCEPTED_FROM: a decimal integer (Unix seconds); invalid → stop (never a silent fallback). */
function acceptedFrom(): bigint | undefined {
  const v = process.env.REFUTE_ACCEPTED_FROM?.trim();
  if (!v) return undefined;
  if (!/^[0-9]{1,12}$/.test(v)) {
    console.error("REFUTE_ACCEPTED_FROM invalid (Unix seconds expected): stopping.");
    process.exit(1);
  }
  return BigInt(v);
}

function requireAnvil() {
  const r = spawnSync(ANVIL_BIN, ["--version"], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`anvil not found (${ANVIL_BIN}): the Sealed Bounty only replays for real, stopping.`);
    process.exit(1);
  }
  console.log(`real replay: ${String(r.stdout).split("\n")[0]} (fork of ${FORK_RPC})`);
}

async function main() {
  requireAnvil();
  // engine check: an outage of the fork's RPC must surface as an error (otherwise: stop, nothing will be signed)
  const st = await fork.selfTest();
  console.log(`engine check (block ${st.blockN}): ${st.checks.join("; ")}; EVM revert: code ${st.revertCode ?? "?"}${st.revertCode === 3 ? "" : " (unexpected: view reads that revert will fail closed)"}`);
  const from = acceptedFrom();
  const operatorAllowlist = parseOperatorAllowlist(process.env.OPERATOR_ALLOWLIST); // invalid => stop
  const dstack = await createDstackClient();
  const rpc = new RpcQuorum(RPC_URLS);
  // head and hash of block N read through the quorum (at the same block on every provider)
  const blocks: BlockSource = { current: () => rpc.commonHead(), blockHash: (n: bigint) => rpc.blockHash(n) };
  const kit = new EnclaveKit({ productId: PRODUCT_ID, chainId: CHAIN_ID, registry: REGISTRY, rpc, dstack: dstack ?? undefined });
  console.log(dstack ? "quote: real dstack TDX" : "quote: mock (outside a TDX VM)");

  // v2.1 ter: the immutable fields of bounties (predicate, key, tiers) are read once, shared by submission and refutation
  const bounties = new BountyCache();
  const service = new BountyService(
    kit, { sealedBounty: SEALED, ...(DEMO_FAULT ? { demoFault: DEMO_FAULT } : {}) }, chainBountyReader(rpc, SEALED, bounties),
    new DeterministicProtocolCipher(), fork, blocks, () => BigInt(Math.floor(Date.now() / 1000)),
  );
  // counter-replay of accepted claims: the same engine (and the same replay queue) as the claims
  const refuter = new RefutationService(kit, { sealedBounty: SEALED, acceptedFrom: from }, chainRefuteReader(rpc, SEALED, REGISTRY, bounties), new DeterministicProtocolCipher(), fork);
  if (from !== undefined) console.log(`refutation: claims accepted from ${from} on (REFUTE_ACCEPTED_FROM)`);
  const app = createSealedBountyApp({ kit, service, refuter, attest: { operatorAllowlist } });

  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
  console.log(`sealed-bounty (O3) on http://localhost:${PORT}  signer=${kit.keys.signer}  quorum=${RPC_URLS.length} RPC${DEMO_FAULT ? `  DEMO_FAULT=${DEMO_FAULT} (demo)` : ""}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
