/**
 * demo-product.ts — crée le produit « Inférence privée : machines de démo (testnet) ».
 * Il autorise l'empreinte « démo » (mesures à zéro, déclarées par le site au module d'attestation de TEST)
 * pour que n'importe qui puisse brancher une machine sans TDX et suivre tout le parcours opérateur sur testnet.
 * Sur mainnet, ce produit n'existe pas : seule une vraie attestation Intel TDX vérifiée par DCAP passe.
 * PILE v1 SEULEMENT (historique) : en v2, le registre vérifie chaque quote par DCAP ; une empreinte « démo » à zéro ne
 * peut correspondre à aucun quote signé par Intel. Le script refuse donc de tourner sur la v2.
 * Usage : npx tsx scripts/demo-product.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, encodePacked, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, testnet, createArcClient } from "../src/index";

const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });

const Z48 = ("0x" + "00".repeat(48)) as Hex;
const Z8 = ("0x" + "00".repeat(8)) as Hex;
export const DEMO_WORKLOAD = keccak256(encodePacked(
  ["bytes", "bytes", "bytes", "bytes", "bytes", "bytes", "bytes8", "bytes8"], [Z48, Z48, Z48, Z48, Z48, Z48, Z8, Z8],
));

async function main() {
  if (testnet.attestation === "dcap") {
    throw new Error("obsolète en v2 : le registre vérifie chaque quote par DCAP (Intel) ; une machine sans TDX ne s'inscrit pas, il n'y a plus de produit « démo »");
  }
  const p6 = await arc.getProduct(6n);
  console.log("empreinte démo :", DEMO_WORKLOAD);
  console.log("param (modèle épinglé) repris du produit 6 :", p6.param);
  const r = await arc.proposeProduct({
    manifestHash: keccak256(encodePacked(["string"], ["archive/demo-machines/v1"])),
    manifestURI: "http://62.171.153.35:8900/#/developpeurs",
    workloadIds: [DEMO_WORKLOAD], deterministic: false, price: p6.price,
    bpsOperator: 8000, bpsAuthor: 1000, bpsNetwork: 1000,
    minBond: 1_000_000n, exposureCap: 1_000_000_000_000n, settlement: testnet.sessionPay, param: p6.param, advisoryIds: [],
  });
  await pub.waitForTransactionReceipt({ hash: r.tx });
  console.log(`produit #${r.productId} proposé  tx ${r.tx}`);
  const a = await arc.activateProduct(r.productId);
  await pub.waitForTransactionReceipt({ hash: a });
  console.log(`produit #${r.productId} activé  tx ${a}`);
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
