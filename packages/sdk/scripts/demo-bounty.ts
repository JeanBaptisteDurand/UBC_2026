// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/demo-bounty.ts`.
/**
 * demo-bounty.ts — publishes an open demo bounty (the Sealed Bounty product, target DemoVault, testnet).
 * The "protocol" gets a REAL X25519 pair: its private key is written to .secrets/demo-protocol-x25519.json
 * (never shown), so the delivered report (ExploitDelivered) can be decrypted during the demo.
 * The predicate is the site's (Bounty.tsx): DemoVault's USDC balance drops by at least 1 USDC.
 * Usage: npx tsx scripts/demo-bounty.ts
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
  console.log(`USDC balance of the demo protocol: ${Number(bal) / 1e6}`);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 10 * 24 * 3600); // 10 jours
  const r = await arc.createBounty({
    productId: PRODUCT_BOUNTY, predicateHash: predicateHash(DEMO_PREDICATE), protocolX25519: toHex(pubKey),
    tierMinLoss: [1_000_000n], tierAmount: [500_000n], // proven loss ≥ 1 USDC → 0.5 USDC to the hunter (+15 % fees)
    singleCap: 1_000_000n, k: 1, targetToPause: testnet.demoVault, deadline, funding: 3_000_000n,
  });
  await pub.waitForTransactionReceipt({ hash: r.tx });
  console.log(`bounty #${r.bountyId} published and funded (3 USDC), deadline ${new Date(Number(deadline) * 1000).toISOString()}  tx ${r.tx}`);
  console.log(`the protocol's X25519 key: public ${toHex(pubKey).slice(0, 18)}…, private in .secrets/demo-protocol-x25519.json`);
}
main().catch((e) => { console.error("FAILED:", explainArcError(e, "en")); process.exit(1); });
