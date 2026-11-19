// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/measure-inference.ts`.
/**
 * measure-inference.ts — mesure la latence et le débit de l'IA privée, de bout en bout comme un client :
 * session ouverte on-chain, requêtes chiffrées (HPKE) vers la VRAIE enclave Intel TDX (Phala), reçus vérifiés,
 * en direct ou à travers le proxy HTTPS du site (pile v2 : les clés de l'enclave sont vérifiées on-chain avant tout
 * chiffrement, la session est verrouillée sur elle). N requêtes séquentielles ; latence médiane et p90, jetons par seconde.
 * Usage : N=8 [ENCLAVE_URL=https://…-8802.dstack-pha1-prod9.phala.network] npx tsx scripts/measure-inference.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, createArcClient, createInferenceClient, explainArcError } from "../src/index";
import { PRODUCT_INFERENCE, V2_INFERENCE_URL } from "./demo-shared";

const ENCLAVE = V2_INFERENCE_URL;
const N = Number(process.env.N ?? "8");
const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });

const Q = [
  "En une phrase, qu'est-ce qu'une enclave Intel TDX ?",
  "Pourquoi un reçu signé par l'enclave est-il utile pour payer à l'usage ?",
  "Donne deux usages d'une IA dont personne ne peut lire les questions.",
  "Qu'est-ce que l'USDC, en une phrase ?",
];

async function main() {
  const t0 = Date.now();
  const s = await arc.openSession({ productId: PRODUCT_INFERENCE, enclaveUrl: ENCLAVE, deposit: parseUnits("1", 6) });
  await pub.waitForTransactionReceipt({ hash: s.tx });
  const openMs = Date.now() - t0;
  const ai = createInferenceClient({ enclaveUrl: ENCLAVE, sessionId: s.sessionId, sessionKey: s.sessionKey, publicClient: pub as any });
  const lat: number[] = []; let tokOut = 0, tokIn = 0, okReceipts = 0;
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    const out = await ai.chat.completions.create({ messages: [{ role: "user", content: Q[i % Q.length]! }] });
    lat.push(Date.now() - t);
    if (out.verified) okReceipts++;
    tokIn += Number(out.receipt?.tokensIn ?? 0); tokOut += Number(out.receipt?.tokensOut ?? 0);
  }
  lat.sort((a, b) => a - b);
  const med = lat[Math.floor(lat.length / 2)]!, p90 = lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.9))]!;
  const totalS = lat.reduce((a, b) => a + b, 0) / 1000;
  console.log(`session #${s.sessionId} ouverte et confirmée en ${openMs} ms`);
  console.log(`${N} requêtes chiffrées vers l'enclave TDX : latence médiane ${med} ms, p90 ${p90} ms, min ${lat[0]} ms, max ${lat[lat.length - 1]} ms`);
  console.log(`jetons : ${tokIn} lus, ${tokOut} écrits ; débit de sortie ≈ ${(tokOut / totalS).toFixed(1)} jetons/s (de bout en bout, chiffrement et vérification compris)`);
  console.log(`reçus authentifiés et payables : ${okReceipts}/${N}`);
}
main().catch((e) => { console.error("ÉCHEC :", explainArcError(e)); process.exit(1); });
