/**
 * check-state-proofs.ts — does an Arc RPC serve verifiable state proofs?
 * 1) the header of a recent block N (N = head − AGE) is read from a public Arc RPC, and its hash is recomputed from its 21 fields;
 * 2) a proof (eth_getProof) of accounts and storage slots at block N is requested from the RPC under test (STATE_PROOF_RPC);
 * 3) it is verified by the enclave's own code (src/services/state-proof.ts) against block N's stateRoot;
 * 4) the proof window is probed (the oldest block still served).
 * Usage: cd enclave && STATE_PROOF_RPC=<an Arc RPC that serves eth_getProof> [AGE=50] npx tsx scripts/check-state-proofs.ts
 */
import { blockHeaderHash } from "../src/services/rpc-relay";
import { checkCode, checkProofResult, verifyAccountProof } from "../src/services/state-proof";
import type { Hex } from "viem";

const GATE = (process.env.STATE_PROOF_RPC ?? "https://archive.62-171-153-35.sslip.io/arc-rpc").replace(/\/$/, "");
const PUBLIC = process.env.PUBLIC_RPC ?? "https://rpc.blockdaemon.testnet.arc.io";
const AGE = BigInt(process.env.AGE ?? "50");
const ACCOUNTS: { address: Hex; slots: string[] }[] = [
  { address: "0x3600000000000000000000000000000000000000", slots: ["0x0", "0x1", "0x2"] }, // Arc's USDC
  { address: "0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d", slots: ["0x0"] }, // EnclaveRegistry v2.1
  { address: "0x00000000000000000000000000000000dEaDbeEF", slots: ["0x0"] }, // empty account: proof of absence
];

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(30_000) });
  const j = (await r.json()) as any;
  if (j.error) throw new Error(`${method}: ${j.error.message ?? JSON.stringify(j.error)}`);
  return j.result;
}

async function main() {
  const head = BigInt(await rpc(PUBLIC, "eth_blockNumber", []));
  const N = head - AGE;
  const tag = `0x${N.toString(16)}`;
  const block = await rpc(PUBLIC, "eth_getBlockByNumber", [tag, false]);
  if (blockHeaderHash(block) !== block.hash.toLowerCase()) throw new Error("public header: the hash does not recompute");
  console.log(`block N = ${N} (public head ${head}); hash ${block.hash} recomputed from its 21 fields; stateRoot ${block.stateRoot}`);
  const t0 = Date.now();
  for (const a of ACCOUNTS) {
    const p = await rpc(GATE, "eth_getProof", [a.address, a.slots.map((s) => `0x${BigInt(s).toString(16).padStart(64, "0")}`), tag]);
    const r = checkProofResult(block.stateRoot, a.address, a.slots, p);
    const vals = [...r.storage.values()].map((v) => (v === 0n ? "0" : `0x${v.toString(16).slice(0, 10)}…`)).join(", ");
    console.log(`  ✓ ${a.address}: ${r.account.exists ? `balance ${r.account.balance}, nonce ${r.account.nonce}` : "absent (proof of absence)"}; slots [${vals}] — proven against the stateRoot`);
  }
  const reg = ACCOUNTS[1]!;
  const acct = verifyAccountProof(block.stateRoot, reg.address, (await rpc(GATE, "eth_getProof", [reg.address, [], tag])).accountProof);
  checkCode(acct, await rpc(GATE, "eth_getCode", [reg.address, tag]));
  console.log(`  ✓ registry code: matches the proven code hash; ${Date.now() - t0} ms for ${ACCOUNTS.length + 1} proofs`);
  // window: the oldest block still provable (coarse bisection)
  let lo = 0n, hi = 50_000n;
  while (hi - lo > 200n) {
    const mid = (lo + hi) / 2n;
    try {
      await rpc(GATE, "eth_getProof", [ACCOUNTS[0]!.address, [], `0x${(head - mid).toString(16)}`]);
      lo = mid;
    } catch {
      hi = mid;
    }
  }
  console.log(`proof window of the RPC under test: ≈ ${lo} blocks (≈ ${Math.round(Number(lo) * 0.46 / 60)} min at ≈ 0.46 s per block)`);
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
