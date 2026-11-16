/**
 * e2e-phala.ts — bout-en-bout du produit d'inférence contre l'enclave TDX RÉELLE (Phala), pile v2 :
 *  1) (REGISTER=1 seulement) inscription par le SDK : /attest de l'enclave → VRAI quote lié à l'opérateur, contrôlé hors
 *     chaîne (pas de DEBUG, SEPT_VE_DISABLE, image autorisée par le produit, liaison REPORTDATA), puis registerEnclave :
 *     la chaîne vérifie la signature d'Intel par DCAP (≈ 5,7 M gas). Rien n'est simulé. L'image doit déjà être autorisée
 *     par l'auteur du produit (proposeWorkload → applyWorkload ; voir enclave/scripts/register-dcap.ts).
 *  2) clés de l'enclave VÉRIFIÉES on-chain (clé X25519 inscrite, active pour le produit), session verrouillée sur elle ;
 *  3) inférence réelle chiffrée → reçu signé, authentifié (requête, réponse) et payable par SessionPay.settle.
 * Usage : [ENCLAVE_URL=…] [REGISTER=1] npx tsx scripts/e2e-phala.ts   (clé d'opérateur : .secrets/deployer.json)
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, createArcClient, createInferenceClient, explainArcError } from "../src/index";
import { PRODUCT_INFERENCE, V2_INFERENCE_URL } from "./demo-shared";

const ENCLAVE = V2_INFERENCE_URL;
const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });

async function main() {
  console.log(`enclave : ${ENCLAVE}`);
  if (process.env.REGISTER === "1") {
    console.log("[inscription on-chain, vérification DCAP]");
    const r = await arc.registerEnclave(PRODUCT_INFERENCE, ENCLAVE);
    const rc = await pub.waitForTransactionReceipt({ hash: r.tx });
    console.log(`  registerEnclave : ${rc.status} (gas ${rc.gasUsed}) https://explorer.testnet.arc.io/tx/${r.tx} ; signer ${r.signer}, workloadId ${r.workloadId}`);
  }

  console.log("[clés de l'enclave confrontées à la chaîne]");
  const keys = await arc.verifyEnclaveKeys(ENCLAVE, PRODUCT_INFERENCE);
  console.log(`  ✓ signer ${keys.signer}, clé X25519 inscrite ${keys.x25519.slice(0, 18)}…, opérateur ${keys.operator}, fenêtre ${keys.fromBlock}→${keys.untilBlock}`);

  console.log("[session + inférence réelle]");
  const s = await arc.openSession({ productId: PRODUCT_INFERENCE, enclaveUrl: ENCLAVE, deposit: parseUnits("2", 6) });
  await pub.waitForTransactionReceipt({ hash: s.tx });
  console.log(`  session #${s.sessionId} ouverte, verrouillée sur ${s.enclave}`);
  const ai = createInferenceClient({ enclaveUrl: ENCLAVE, sessionId: s.sessionId, sessionKey: s.sessionKey, publicClient: pub as any });
  const out = await ai.chat.completions.create({ messages: [{ role: "user", content: "En une phrase : qu'est-ce qu'une enclave TDX ?" }] });
  console.log(`  RÉPONSE IA : ${out.text}`);
  console.log(`  reçu authentifié, payable on-chain : ${out.verified}  (cumul ${out.receipt.cumulativeUnits} unités)`);
  console.log(out.verified ? "\n✅ bout-en-bout v2 sur enclave TDX réelle : clés vérifiées, inférence réelle, reçu payable." : "\n⚠️ reçu non payable");
}
main().catch((e) => { console.error("ERREUR:", explainArcError(e)); process.exit(1); });
