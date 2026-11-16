/**
 * demo-bounty.ts — publie une prime de démonstration ouverte (pile v2 : produit « Prime scellée » #2, cible DemoVault, testnet).
 * Le « protocole » reçoit une VRAIE paire X25519 : sa clé privée est écrite dans .secrets/demo-protocol-x25519.json
 * (jamais affichée), pour pouvoir déchiffrer le rapport livré (ExploitDelivered) pendant la démo.
 * Prédicat identique à celui du site (Bounty.tsx) : le solde USDC de DemoVault baisse d'au moins 1 USDC.
 * Usage : npx tsx scripts/demo-bounty.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x25519 } from "@noble/curves/ed25519";
import { arcTestnet, testnet, createArcClient, predicateHash, explainArcError } from "../src/index";
import { DEMO_PREDICATE, PRODUCT_BOUNTY } from "./demo-shared";

const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });

async function main() {
  const priv = x25519.utils.randomPrivateKey();
  const pubKey = x25519.getPublicKey(priv);
  const keyFile = new URL("../../../.secrets/demo-protocol-x25519.json", import.meta.url);
  writeFileSync(keyFile, JSON.stringify({ privateKey: toHex(priv), publicKey: toHex(pubKey) }), { mode: 0o600 });

  const bal = await arc.usdcBalance(account.address);
  console.log(`solde USDC du protocole de démo : ${Number(bal) / 1e6}`);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 24 * 3600); // 10 jours
  const r = await arc.createBounty({
    productId: PRODUCT_BOUNTY, predicateHash: predicateHash(DEMO_PREDICATE), protocolX25519: toHex(pubKey),
    tierMinLoss: [1_000_000n], tierAmount: [500_000n], // perte prouvée ≥ 1 USDC → 0,5 USDC au chasseur (+15 % de frais)
    singleCap: 1_000_000n, k: 1, targetToPause: testnet.demoVault, deadline, funding: 3_000_000n,
  });
  await pub.waitForTransactionReceipt({ hash: r.tx });
  console.log(`prime #${r.bountyId} publiée et financée (3 USDC), échéance ${new Date(Number(deadline) * 1000).toISOString()}  tx ${r.tx}`);
  console.log(`clé X25519 du protocole : publique ${toHex(pubKey).slice(0, 18)}…, privée dans .secrets/demo-protocol-x25519.json`);
}
main().catch((e) => { console.error("ÉCHEC :", explainArcError(e)); process.exit(1); });
