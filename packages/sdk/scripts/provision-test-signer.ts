/**
 * provision-test-signer.ts — MODE TEST : crée (une fois) le wallet serveur de test et son jeton, puis l'approvisionne
 * en USDC testnet depuis le wallet de déploiement. Écrit .secrets/test-signer.json (droits 0600) ; n'affiche que l'adresse.
 * Usage : npx tsx scripts/provision-test-signer.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arcTestnet, testnet } from "../src/index";

const FILE = new URL("../../../.secrets/test-signer.json", import.meta.url);
const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const deployer = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account: deployer, chain: arcTestnet, transport: http() });
const erc20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

async function main() {
  if (!existsSync(FILE)) {
    writeFileSync(FILE, JSON.stringify({ privateKey: generatePrivateKey(), token: randomBytes(32).toString("hex") }), { mode: 0o600 });
    console.log("wallet de test et jeton créés dans .secrets/test-signer.json");
  }
  const t = JSON.parse(readFileSync(FILE, "utf8"));
  const acct = privateKeyToAccount(t.privateKey as Hex);
  console.log("adresse du wallet de test :", acct.address);
  const bal = await pub.readContract({ address: testnet.usdc, abi: erc20, functionName: "balanceOf", args: [acct.address] }) as bigint;
  console.log(`solde : ${Number(bal) / 1e6} USDC`);
  if (bal < 10_000_000n) {
    const hash = await wallet.writeContract({ address: testnet.usdc, abi: erc20, functionName: "transfer", args: [acct.address, 15_000_000n] });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`approvisionné : +15 USDC  tx ${hash}`);
  }
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
