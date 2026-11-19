/** update-bounty-manifest.ts — product 2 (Sealed Bounty) pins the manifest of the arc-anvil image: the author proposes
 *  the update (hash of the served manifest, parameter = the replay engine), then applies it (timelock 0 on testnet).
 *  The parameter string below is hashed on-chain as it is, so it keeps its original wording. */
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
  console.log(`${fn}: ${h} (${r.status})`);
}
const manifest = readFileSync(new URL("web/public/manifests/sealed-bounty-v1.json", ROOT)); // the product's URL = "current manifest"
const hash = keccak256(manifest);
await send("proposeUpdate", [2n, hash, 0n, keccak256(toBytes("arc-anvil v0.8.0-4 (Arc Foundry), précompilés d'Arc natifs"))]);
await send("applyUpdate", [2n]);
const p = await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "getProduct", args: [2n] }) as any;
console.log(`product 2: manifestHash ${p.manifestHash} (expected ${hash}), version ${p.version}`);
