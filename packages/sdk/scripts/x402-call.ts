/**
 * x402-call.ts — paie N appels d'inférence À L'APPEL (x402, schéma « exact ») à la VRAIE enclave sealed-x402, comme un
 * agent : clé de l'enclave vérifiée on-chain, 402 géré par le SDK, autorisation EIP-3009 signée (le payeur n'envoie
 * aucune transaction pour payer), réponse déchiffrée, reçu vérifié. Ensuite :
 *  - SETTLE_NOW=1 : le payeur règle lui-même chaque appel (X402Settler.settle, il paie le gaz) : paiement + preuve
 *    d'enclave + partage dans la même transaction ;
 *  - sinon : on attend (jusqu'à WAIT_S secondes) que le registrar de l'opérateur règle (USDC.authorizationState).
 * Usage (depuis packages/sdk) :
 *   DEPLOYMENTS=deployments.v21.testnet.json ENCLAVE_URL=https://…-8804.dstack-pha1-prod9.phala.network \
 *   [PRODUCT_ID=3] [N=3] [SETTLE_NOW=1] [WAIT_S=120] [PAYER_KEY_FILE=.secrets/deployer.json] npx tsx scripts/x402-call.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arcTestnet, createX402Client, deploymentFromJson, explainArcError, testnet, X402PaidCallError, type Deployment, type X402Completion,
} from "../src/index";

const ROOT = new URL("../../../", import.meta.url);
const D: Deployment = process.env.DEPLOYMENTS
  ? deploymentFromJson(JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS, ROOT), "utf8")))
  : testnet;
const ENCLAVE = process.env.ENCLAVE_URL ?? "";
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? String(D.products?.x402 ?? 0n));
const N = Number(process.env.N ?? "3");
const WAIT_S = Number(process.env.WAIT_S ?? "120");
if (!ENCLAVE || PRODUCT_ID === 0n) {
  console.error("ENCLAVE_URL et PRODUCT_ID requis (PRODUCT_ID : le produit réglé par X402Settler, ex. 3 sur la v2.1)");
  process.exit(1);
}

const key = JSON.parse(readFileSync(new URL(process.env.PAYER_KEY_FILE ?? ".secrets/deployer.json", ROOT), "utf8")).privateKey as Hex;
const account = privateKeyToAccount(key);
const chain = { ...arcTestnet, id: D.chainId };
const pub = createPublicClient({ chain, transport: http(process.env.RPC_URL, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain, transport: http(process.env.RPC_URL) });
const Q = [
  "En une phrase : qu'est-ce qu'une enclave Intel TDX ?",
  "En une phrase : pourquoi payer une IA à l'appel plutôt qu'à l'abonnement ?",
  "En une phrase : que prouve un reçu signé par une enclave ?",
];

async function main() {
  const ai = createX402Client({ enclaveUrl: ENCLAVE, productId: PRODUCT_ID, walletClient: wallet as any, publicClient: pub as any, deployment: D });
  const p = await ai.product();
  console.log(`payeur ${account.address} · produit #${PRODUCT_ID} · ${Number(p.pricePerCall) / 1e6} USDC par appel · X402Settler ${D.x402Settler}`);
  const done: X402Completion[] = [];
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    let r: X402Completion;
    try {
      r = await ai.chat.completions.create({ messages: [{ role: "user", content: Q[i % Q.length]! }] });
    } catch (e) {
      if (!(e instanceof X402PaidCallError)) throw e;
      // appel PAYÉ sans réponse vérifiée : on reprend la MÊME requête (aucune 2e facturation) après 10 s
      console.warn(`#${i + 1} ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 10_000));
      r = await ai.resume(e.pending);
      console.log(`#${i + 1} repris : réponse ${r.replay ? "gardée par l'enclave (replay)" : "servie"}`);
    }
    done.push(r);
    console.log(
      `#${i + 1} ${Date.now() - t} ms · ${Number(r.amount) / 1e6} USDC autorisés · reçu de ${r.signer} (bloc ${r.receipt.anchorBlock}, réglable : ${r.settleable}) · « ${r.text.slice(0, 100).replace(/\s+/g, " ")} »`,
    );
  }
  if (process.env.SETTLE_NOW === "1") {
    for (const r of done) {
      const tx = await ai.settle(r);
      const rc = await pub.waitForTransactionReceipt({ hash: tx });
      console.log(`réglé par le payeur : ${tx} (statut ${rc.status}, gas ${rc.gasUsed})`);
    }
    return;
  }
  const until = Date.now() + WAIT_S * 1000;
  for (;;) {
    const states = await Promise.all(done.map((r) => ai.isSettled(r)));
    const n = states.filter(Boolean).length;
    if (n === done.length) {
      console.log(`les ${n} appels sont réglés on-chain par le registrar de l'opérateur (X402Settler.settle)`);
      return;
    }
    if (Date.now() > until) {
      console.log(`${n}/${done.length} appels réglés après ${WAIT_S} s : vérifier le registrar x402 (journal « x402 : »)`);
      return;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

main().catch((e) => {
  console.error("ÉCHEC :", explainArcError(e));
  process.exit(1);
});
