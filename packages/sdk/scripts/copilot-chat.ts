/**
 * copilot-chat.ts — parle au copilote ATTESTÉ comme le fera le site : clé du copilote vérifiée sur Arc (inscrite pour son
 * produit, clé X25519 conforme, enclave active, image encore autorisée, opérateur non radié), conversation chiffrée
 * (HPKE) vers cette clé, réponse scellée ouverte. Lecture seule : aucune transaction, aucune clé privée.
 * Un copilote dont le quote est simulé (hors TDX) n'est pas inscrit : le script le refuse sans rien envoyer.
 * COPILOT_URL : l'adresse du site (…/enclave/copilot). Le copilote en enclave ne répond à POST /chat qu'au travers du
 * mandataire du site (jeton COPILOT_PROXY_TOKEN posé par nginx) : son URL Phala directe vérifie la clé (/pubkeys est
 * public) mais refuse la conversation (403 proxy_required, refus en clair : non authentifié).
 * Usage (depuis packages/sdk) :
 *   DEPLOYMENTS=deployments.v21.testnet.json COPILOT_URL=https://archive.62-171-153-35.sslip.io/enclave/copilot \
 *   PRODUCT_ID=4 [COPILOT_LANG=en|fr] [QUESTION="Are you running in an enclave?"] [OPERATOR=0x…] npx tsx scripts/copilot-chat.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http } from "viem";
import {
  arcTestnet, createAttestedCopilotClient, deploymentFromJson, testnet, EnclaveKeyMismatchError, CopilotResponseError,
  type CopilotLang, type Deployment,
} from "../src/index";

const ROOT = new URL("../../../", import.meta.url);
const D: Deployment = process.env.DEPLOYMENTS
  ? deploymentFromJson(JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS, ROOT), "utf8")))
  : testnet;
const URL_ = process.env.COPILOT_URL ?? "";
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? "0");
const LANG: CopilotLang = process.env.COPILOT_LANG === "fr" ? "fr" : "en";
const QUESTION = process.env.QUESTION ?? "Where are you running, and who can read this conversation?";
if (!URL_ || PRODUCT_ID === 0n) {
  console.error("COPILOT_URL et PRODUCT_ID requis (PRODUCT_ID : le produit « copilote attesté », ex. 4 sur la v2.1)");
  process.exit(1);
}
const chain = D.chainId === arcTestnet.id ? arcTestnet : defineChain({ ...arcTestnet, id: D.chainId, name: `Arc (${D.chainId})` });
const publicClient = createPublicClient({ chain, transport: http(process.env.RPC_URL, { retryCount: 5, retryDelay: 600 }) });

async function main() {
  const copilot = createAttestedCopilotClient({
    copilotUrl: URL_, productId: PRODUCT_ID, publicClient: publicClient as any, deployment: D, lang: LANG,
    ...(process.env.OPERATOR ? { expectedOperator: process.env.OPERATOR as `0x${string}` } : {}),
  });
  const k = await copilot.verifiedKeys();
  console.log(
    `copilote vérifié sur Arc au bloc ${k.checkedAtBlock} : signataire ${k.signer}, produit #${k.productId}, opérateur ${k.operator}, ` +
      `image ${k.workloadId}, TCB ${k.tcbStatus}, fenêtre ${k.fromBlock}→${k.untilBlock}, modèle épinglé ${k.productParam}`,
  );
  const r = await copilot.chat({ messages: [{ role: "user", content: QUESTION }] });
  if (r.authenticated) {
    console.log(`réponse scellée par l'enclave vérifiée ${r.enclave.signer} (opérateur ${r.enclave.operator}) : HTTP ${r.status}`);
  } else {
    // refus en clair : non authentifié (un relais peut l'écrire) ; texte local tiré du code
    console.log(`refus EN CLAIR d'avant le déchiffrement, NON authentifié : HTTP ${r.status}, code ${r.reply.code ?? "?"}`);
  }
  console.log(r.reply.text);
  if (r.reply.navigate) console.log(`(page : ${r.reply.navigate})`);
  if (!r.authenticated) process.exit(2);
}

main().catch((e) => {
  if (e instanceof EnclaveKeyMismatchError) console.error(`REFUSÉ, rien n'a été envoyé (${e.reason}) : ${e.message}`);
  else if (e instanceof CopilotResponseError) console.error(`RÉPONSE REFUSÉE : ${e.message}`);
  else console.error("ÉCHEC :", (e as Error)?.message ?? e);
  process.exit(1);
});
