// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/infer-phala.ts`.
/** infer-phala.ts — a session + real inference against a live TDX enclave (already registered through DCAP).
 *  The enclave's keys are verified on-chain before any encryption; the session is locked to it (and so are its price,
 *  model and unit, read from the product at opening).
 *  Usage : [ENCLAVE_URL=…] npx tsx scripts/infer-phala.ts */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, createArcClient, createInferenceClient, explainArcError } from "../src/index";
import { PRODUCT_INFERENCE, V2_INFERENCE_URL } from "./demo-shared";

const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });

async function main() {
  const p = await arc.getProduct(PRODUCT_INFERENCE);
  console.log(`product #${p.id}: ${Number(p.price) / 1e6} USDC per unit (${p.unitTokens} token(s) per unit, output ×${p.outWeight})`);
  const s = await arc.openSession({ productId: PRODUCT_INFERENCE, enclaveUrl: V2_INFERENCE_URL, deposit: parseUnits("2", 6) });
  await pub.waitForTransactionReceipt({ hash: s.tx });
  console.log(`session #${s.sessionId} opened (deposit 2 USDC), locked to enclave ${s.enclave}`);
  const ai = createInferenceClient({ enclaveUrl: V2_INFERENCE_URL, sessionId: s.sessionId, sessionKey: s.sessionKey, publicClient: pub as any });
  for (const q of ["In one sentence: what is an Intel TDX enclave?", "Give one example of a use in 1 sentence."]) {
    const out = await ai.chat.completions.create({ messages: [{ role: "user", content: q }] });
    console.log(`\nQ: ${q}\nAI: ${out.text}\n   authenticated receipt, payable on-chain: ${out.verified} · cumulative ${out.receipt.cumulativeUnits} units`);
  }
  console.log("\n✅ end to end: the enclave's keys verified on-chain, encrypted inference, signed and authenticated receipts.");
}
main().catch((e) => { console.error("FAILED:", explainArcError(e, "en")); process.exit(1); });
