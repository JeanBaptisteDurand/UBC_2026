/**
 * check-state-proofs.ts — notre nœud d'Arc sert-il des preuves d'état VÉRIFIABLES ? (11/11/2026)
 * 1) l'en-tête d'un bloc récent N (N = tête − AGE) est lu sur un RPC PUBLIC d'Arc, et son hash recalculé sur ses 21 champs ;
 * 2) une preuve (eth_getProof) de comptes et de cases au bloc N est demandée à la passerelle de NOTRE nœud (STATE_PROOF_RPC) ;
 * 3) elle est vérifiée par le code même de l'enclave (src/services/state-proof.ts) contre le stateRoot de l'en-tête N ;
 * 4) la fenêtre de preuves est sondée (plus vieux bloc encore servi).
 * Usage : cd enclave && [STATE_PROOF_RPC=https://archive.62-171-153-35.sslip.io/arc-rpc] [AGE=50] npx tsx scripts/check-state-proofs.ts
 */
import { blockHeaderHash } from "../src/services/rpc-relay";
import { checkCode, checkProofResult, verifyAccountProof } from "../src/services/state-proof";
import type { Hex } from "viem";

const GATE = (process.env.STATE_PROOF_RPC ?? "https://archive.62-171-153-35.sslip.io/arc-rpc").replace(/\/$/, "");
const PUBLIC = process.env.PUBLIC_RPC ?? "https://rpc.blockdaemon.testnet.arc.io";
const AGE = BigInt(process.env.AGE ?? "50");
const ACCOUNTS: { address: Hex; slots: string[] }[] = [
  { address: "0x3600000000000000000000000000000000000000", slots: ["0x0", "0x1", "0x2"] }, // USDC d'Arc
  { address: "0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d", slots: ["0x0"] }, // EnclaveRegistry v2.1
  { address: "0x00000000000000000000000000000000dEaDbeEF", slots: ["0x0"] }, // compte vide : preuve d'absence
];

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(30_000) });
  const j = (await r.json()) as any;
  if (j.error) throw new Error(`${method} : ${j.error.message ?? JSON.stringify(j.error)}`);
  return j.result;
}

async function main() {
  const head = BigInt(await rpc(PUBLIC, "eth_blockNumber", []));
  const N = head - AGE;
  const tag = `0x${N.toString(16)}`;
  const block = await rpc(PUBLIC, "eth_getBlockByNumber", [tag, false]);
  if (blockHeaderHash(block) !== block.hash.toLowerCase()) throw new Error("en-tête public : le hash ne se recalcule pas");
  console.log(`bloc N = ${N} (tête publique ${head}) ; hash ${block.hash} recalculé sur ses 21 champs ; stateRoot ${block.stateRoot}`);
  const t0 = Date.now();
  for (const a of ACCOUNTS) {
    const p = await rpc(GATE, "eth_getProof", [a.address, a.slots.map((s) => `0x${BigInt(s).toString(16).padStart(64, "0")}`), tag]);
    const r = checkProofResult(block.stateRoot, a.address, a.slots, p);
    const vals = [...r.storage.values()].map((v) => (v === 0n ? "0" : `0x${v.toString(16).slice(0, 10)}…`)).join(", ");
    console.log(`  ✓ ${a.address} : ${r.account.exists ? `solde ${r.account.balance}, nonce ${r.account.nonce}` : "ABSENT (preuve d'absence)"} ; cases [${vals}] — PROUVÉ contre le stateRoot`);
  }
  const reg = ACCOUNTS[1]!;
  const acct = verifyAccountProof(block.stateRoot, reg.address, (await rpc(GATE, "eth_getProof", [reg.address, [], tag])).accountProof);
  checkCode(acct, await rpc(GATE, "eth_getCode", [reg.address, tag]));
  console.log(`  ✓ code du registre : redonne le hash de code prouvé ; ${Date.now() - t0} ms pour ${ACCOUNTS.length + 1} preuves`);
  // fenêtre : le plus vieux bloc encore prouvable (dichotomie grossière)
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
  console.log(`fenêtre de preuves de notre nœud : ≈ ${lo} blocs (≈ ${Math.round(Number(lo) * 0.46 / 60)} min à ≈ 0,46 s par bloc)`);
}
main().catch((e) => { console.error("ÉCHEC :", e?.message ?? e); process.exit(1); });
