/**
 * retire-v2.ts — met la pile v2 (deployments.v2.testnet.json) au repos après la bascule sur la v2.1 (9/11) :
 *  1) l'OPÉRATEUR retire ses enclaves v2 encore inscrites (plus rien ne s'y ancre ; la caution qu'elles réservaient est
 *     libérée ; les reçus ancrés avant restent réglables pendant la grâce) ;
 *  2) l'AUTEUR des produits retire leurs empreintes (aucune autre instance de ces images ne peut s'inscrire) ;
 *  3) l'opérateur demande le retrait de sa caution v2 (récupérable après OperatorBond.UNBOND_DELAY = 7 jours, par withdraw).
 * Idempotent : une étape déjà faite est sautée. Clés lues dans .secrets/ (jamais affichées).
 * Usage : cd enclave && npx tsx scripts/retire-v2.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = new URL("../../", import.meta.url);
const D = JSON.parse(readFileSync(new URL("deployments.v2.testnet.json", ROOT), "utf8"));
const K = D.contracts as Record<string, Address>;
const abi = (n: string): Abi => JSON.parse(readFileSync(new URL(`contracts/out/${n}.sol/${n}.json`, ROOT), "utf8")).abi;
const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const key = (f: string) => privateKeyToAccount(JSON.parse(readFileSync(new URL(`.secrets/${f}`, ROOT), "utf8")).privateKey as Hex);
const operator = key("operator.json");
const author = key("deployer.json");
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800 }) });

async function send(acct: typeof operator, address: Address, a: Abi, fn: string, args: unknown[], label: string) {
  const wallet = createWalletClient({ account: acct, chain, transport: http() });
  try {
    const { request } = await pub.simulateContract({ account: acct, address, abi: a, functionName: fn, args } as any);
    const hash = await wallet.writeContract(request as any);
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`${label} : ${hash} (${r.status}, gas ${r.gasUsed})`);
  } catch (e: any) {
    console.log(`${label} : sauté (${(e?.shortMessage ?? e?.message ?? String(e)).split("\n")[0]})`);
  }
}

// enclaves v2 de l'opérateur 0x344f… (inscriptions du 7–8/11) et leurs empreintes complètes (RTMR3 de l'instance)
const V2 = [
  { signer: "0x6AFc62deC6C33DdFff75f95cBf1b8D9d18296DA6" as Address, product: 1n, workload: "0x9b21399b827e42da3a6753340f938b946bf635d7e96496896dbe9753e67e5d06" as Hex },
  { signer: "0x951cC6556a47acD0B3c9bD6F126B4952AEf48f00" as Address, product: 2n, workload: "0xf9c1e729864ffc4bd9734d7aa8dd6290fbe93651d73536a53ff1d5a58ecdc0e1" as Hex },
];

async function main() {
  const reg = abi("EnclaveRegistry"), pr = abi("ProductRegistry"), ob = abi("OperatorBond");
  for (const o of V2) {
    // les ABI de contracts/out sont celles de la v2.1 : on ne décode pas la structure Enclave de la v2 ; retire() est
    // simulé d'abord et sauté s'il échoue (déjà retirée, inconnue)
    await send(operator, K.EnclaveRegistry!, reg, "retire", [o.signer], `enclave v2 ${o.signer.slice(0, 10)}… (produit ${o.product}) retirée par l'opérateur`);
    if (await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "isWorkloadAllowed", args: [o.product, o.workload] })) {
      await send(author, K.ProductRegistry!, pr, "retireWorkload", [o.product, o.workload], `empreinte v2 ${o.workload.slice(0, 10)}… retirée par l'auteur`);
    } else console.log(`empreinte v2 ${o.workload.slice(0, 10)}… : déjà retirée`);
  }
  const bond = (await pub.readContract({ address: K.OperatorBond!, abi: ob, functionName: "bondOf", args: [operator.address] })) as bigint;
  if (bond > 0n) await send(operator, K.OperatorBond!, ob, "requestUnbond", [bond], `retrait de la caution v2 demandé (${Number(bond) / 1e6} USDC, disponible dans 7 jours)`);
  else console.log("caution v2 : rien à retirer");
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
