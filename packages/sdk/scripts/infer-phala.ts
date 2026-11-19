// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/infer-phala.ts`.
/** infer-phala.ts — session + inférence réelle contre l'enclave TDX live (pile v2, déjà inscrite par DCAP).
 *  Les clés de l'enclave sont vérifiées on-chain avant tout chiffrement ; la session est verrouillée sur elle (son prix,
 *  son modèle et son unité aussi, lus au produit à l'ouverture).
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
  console.log(`produit #${p.id} : ${Number(p.price) / 1e6} USDC par unité (${p.unitTokens} jeton(s) par unité, sortie ×${p.outWeight})`);
  const s = await arc.openSession({ productId: PRODUCT_INFERENCE, enclaveUrl: V2_INFERENCE_URL, deposit: parseUnits("2", 6) });
  await pub.waitForTransactionReceipt({ hash: s.tx });
  console.log(`session #${s.sessionId} ouverte (dépôt 2 USDC), verrouillée sur l'enclave ${s.enclave}`);
  const ai = createInferenceClient({ enclaveUrl: V2_INFERENCE_URL, sessionId: s.sessionId, sessionKey: s.sessionKey, publicClient: pub as any });
  for (const q of ["En une phrase : qu'est-ce qu'une enclave Intel TDX ?", "Donne un exemple d'usage en 1 phrase."]) {
    const out = await ai.chat.completions.create({ messages: [{ role: "user", content: q }] });
    console.log(`\nQ: ${q}\nIA: ${out.text}\n   reçu authentifié, payable on-chain : ${out.verified} · cumul ${out.receipt.cumulativeUnits} unités`);
  }
  console.log("\n✅ bout-en-bout v2 : clés de l'enclave vérifiées on-chain, inférence chiffrée, reçus signés et authentifiés.");
}
main().catch((e) => { console.error("ERREUR:", explainArcError(e)); process.exit(1); });
