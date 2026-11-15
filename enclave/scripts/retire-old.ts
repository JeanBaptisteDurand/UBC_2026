/** retire-old.ts — retire les inscriptions v2 dont la clé est morte (VM redémarrées après le changement d'opérateur)
 *  et les empreintes de ces instances : l'opérateur d'origine (déployeur) retire ses enclaves, l'auteur ses workloads. */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const ROOT = new URL("../../", import.meta.url);
const K = JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS ?? "deployments.v2.testnet.json", ROOT), "utf8")).contracts as Record<string, Address>;
const abi = (n: string): Abi => JSON.parse(readFileSync(new URL(`contracts/out/${n}.sol/${n}.json`, ROOT), "utf8")).abi;
const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const account = privateKeyToAccount(JSON.parse(readFileSync(new URL(".secrets/deployer.json", ROOT), "utf8")).privateKey as Hex);
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain, transport: http() });
async function send(address: Address, a: Abi, fn: string, args: unknown[], label: string) {
  try {
    const { request } = await pub.simulateContract({ account, address, abi: a, functionName: fn, args } as any);
    const hash = await wallet.writeContract(request as any); const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`${label} : ${hash} (${r.status})`);
  } catch (e: any) { console.log(`${label} : ignoré (${e?.shortMessage ?? e?.message})`); }
}
const OLD = [
  { signer: "0x05a1F10043e8C24aA183BFf31f92FC791F66100B" as Address, product: 1n, workload: "0x7f6b228dc5883909caf52d4011e376acb565e1f8e1eabc1b53280c766d0e9da8" as Hex },
  { signer: "0x7afCdd68A199D61636Af6f5f137327D3Ca8930cE" as Address, product: 2n, workload: "0x398db0586aeda260efc6f88cd2b586d5194229e204ed8e146380a77ca32e81fc" as Hex },
];
for (const o of OLD) {
  await send(K.EnclaveRegistry!, abi("EnclaveRegistry"), "retire", [o.signer], `enclave ${o.signer.slice(0, 10)}… retirée`);
  await send(K.ProductRegistry!, abi("ProductRegistry"), "retireWorkload", [o.product, o.workload], `workload ${o.workload.slice(0, 10)}… retiré du produit ${o.product}`);
}
