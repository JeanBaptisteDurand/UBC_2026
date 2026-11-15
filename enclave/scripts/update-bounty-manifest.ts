/** update-bounty-manifest.ts — le produit 2 (Prime scellée) épingle le manifeste de l'image arc-anvil : l'auteur propose
 *  la mise à jour (hash du manifeste servi, paramètre = moteur de rejeu), puis l'applique (timelock 0 sur testnet). */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const ROOT = new URL("../../", import.meta.url);
const K = JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS ?? "deployments.v2.testnet.json", ROOT), "utf8")).contracts as Record<string, Address>;
const pr = JSON.parse(readFileSync(new URL("contracts/out/ProductRegistry.sol/ProductRegistry.json", ROOT), "utf8")).abi as Abi;
const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const account = privateKeyToAccount(JSON.parse(readFileSync(new URL(".secrets/deployer.json", ROOT), "utf8")).privateKey as Hex);
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain, transport: http() });
async function send(fn: string, args: unknown[]) {
  const { request } = await pub.simulateContract({ account, address: K.ProductRegistry!, abi: pr, functionName: fn, args } as any);
  const h = await wallet.writeContract(request as any); const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log(`${fn} : ${h} (${r.status})`);
}
const manifest = readFileSync(new URL("web/public/manifests/sealed-bounty-v1.json", ROOT)); // URL du produit = « manifeste courant »
const hash = keccak256(manifest);
await send("proposeUpdate", [2n, hash, 0n, keccak256(toBytes("arc-anvil v0.8.0-4 (Arc Foundry), précompilés d'Arc natifs"))]);
await send("applyUpdate", [2n]);
const p = await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "getProduct", args: [2n] }) as any;
console.log(`produit 2 : manifestHash ${p.manifestHash} (attendu ${hash}), version ${p.version}`);
