/**
 * update-manifest-v21.ts — remet le manifeste on-chain d'un produit v2.1 en accord avec son fichier public
 * (web/public/manifests/<fichier>, régénéré par `v21-setup.ts --dry` depuis le compose mesuré). Si le hash diffère :
 * proposeUpdateWithURI(id, hash, même URL, même prix, même paramètre) puis applyUpdate (timelock 0 sur testnet), par
 * l'auteur (clé du déployeur, jamais affichée). Facultatif : RETIRE_WORKLOAD=0x… retire une ancienne empreinte d'image
 * et INVALIDATE_SIGNER=0x… éteint l'inscription d'une ancienne clé dont l'image est retirée.
 * Usage : cd enclave && DEPLOYMENTS=deployments.v21.testnet.json PRODUCT_ID=2 MANIFEST=sealed-bounty-v21.json npx tsx scripts/update-manifest-v21.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = new URL("../../", import.meta.url);
const D = JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS ?? "deployments.v21.testnet.json", ROOT), "utf8"));
const K = D.contracts as Record<string, Address>;
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? "0");
const MANIFEST = process.env.MANIFEST ?? "";
if (!PRODUCT_ID || !MANIFEST) { console.error("PRODUCT_ID et MANIFEST requis"); process.exit(1); }
const abi = (n: string): Abi => JSON.parse(readFileSync(new URL(`contracts/out/${n}.sol/${n}.json`, ROOT), "utf8")).abi;
const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const author = privateKeyToAccount(JSON.parse(readFileSync(new URL(".secrets/deployer.json", ROOT), "utf8")).privateKey as Hex);
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800 }) });
const wallet = createWalletClient({ account: author, chain, transport: http() });

async function send(address: Address, a: Abi, fn: string, args: unknown[], label: string) {
  const { request } = await pub.simulateContract({ account: author, address, abi: a, functionName: fn, args } as any);
  const hash = await wallet.writeContract(request as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${label} : ${hash} (statut ${r.status}, gas ${r.gasUsed})`);
  if (r.status !== "success") throw new Error(`${label} a échoué`);
}

async function main() {
  const pr = abi("ProductRegistry"), reg = abi("EnclaveRegistry");
  const body = readFileSync(new URL(`web/public/manifests/${MANIFEST}`, ROOT));
  const hash = keccak256(body);
  const p = (await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "getProduct", args: [PRODUCT_ID] })) as any;
  console.log(`produit ${PRODUCT_ID} : manifeste on-chain ${p.manifestHash}, fichier ${hash}`);
  if (p.manifestHash.toLowerCase() !== hash.toLowerCase()) {
    await send(K.ProductRegistry!, pr, "proposeUpdateWithURI", [PRODUCT_ID, hash, p.manifestURI, p.price, p.param], `mise à jour du manifeste proposée (produit ${PRODUCT_ID})`);
    await send(K.ProductRegistry!, pr, "applyUpdate", [PRODUCT_ID], `mise à jour appliquée (produit ${PRODUCT_ID})`);
  } else console.log("manifeste déjà à jour");
  const w = process.env.RETIRE_WORKLOAD as Hex | undefined;
  if (w && (await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "isWorkloadAllowed", args: [PRODUCT_ID, w] }))) {
    await send(K.ProductRegistry!, pr, "retireWorkload", [PRODUCT_ID, w], `ancienne empreinte ${w.slice(0, 10)}… retirée`);
  }
  const s = process.env.INVALIDATE_SIGNER as Address | undefined;
  if (s) {
    try { await send(K.EnclaveRegistry!, reg, "invalidateRetiredWorkload", [s], `ancienne clé ${s.slice(0, 10)}… éteinte`); }
    catch (e: any) { console.log(`ancienne clé ${s.slice(0, 10)}… : ${(e?.shortMessage ?? e?.message ?? String(e)).split("\n")[0]}`); }
  }
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
