/**
 * levels-setup.ts — met en place les DEUX NIVEAUX d'opérateur sur la pile v2.1 (10/11/2026), sans rien
 * redéployer de l'existant :
 *   1. MachineRegistry       : liaison enclave → machine (PPID du certificat Intel), déclarations des vérificateurs,
 *                              politique de niveau de chaque produit ;
 *   2. Ed25519Verifier       : vérification Ed25519 (Smooth CryptoLib, auditée) ;
 *   3. ProofOfCloudAuditor   : vérificateur sans confiance : la signature de l'alliance Proof of Cloud, vérifiée on-chain ;
 *   4. PolicyEnclaves        : le registre vu à travers la politique de chaque produit (pour les contrats de règlement) ;
 *   5. SealedBounty (niveau vérifié) : le MÊME code que la Prime en service, branché sur PolicyEnclaves ; puis
 *      proposeSettlement (OperatorBond) et proposeCaller (VerdictLog) : il ne pourra saisir une caution et écrire un
 *      verdict qu'après le délai de 8 jours (applySettlement / applyCaller, ouverts à tous, à appeler ensuite).
 * Clé du déployeur (propriétaire), jamais affichée. Idempotent : ce qui est déjà déployé (section `levels` du fichier de
 * déploiement, code présent on-chain) n'est pas refait. DRY=1 : n'envoie rien, dit ce qui serait fait.
 * Usage : cd enclave && npx tsx scripts/levels-setup.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = new URL("../../", import.meta.url);
const DEPLOY_FILE = new URL(process.env.DEPLOYMENTS ?? "deployments.v21.testnet.json", ROOT);
const D = JSON.parse(readFileSync(DEPLOY_FILE, "utf8"));
const K = D.contracts as Record<string, Address>;
const X = D.external as Record<string, Address>;
const DRY = process.env.DRY === "1";
const RPC = process.env.RPC_URL ?? "https://rpc.testnet.arc.io";

const art = (file: string, name: string) => {
  const j = JSON.parse(readFileSync(new URL(`contracts/out/${file}.sol/${name}.json`, ROOT), "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};
const POC = JSON.parse(readFileSync(new URL("contracts/test/vectors/proof-of-cloud-token.json", ROOT), "utf8"));

const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const deployer = privateKeyToAccount(JSON.parse(readFileSync(new URL(".secrets/deployer.json", ROOT), "utf8")).privateKey as Hex);
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 6, retryDelay: 800 }) });
const wallet = createWalletClient({ account: deployer, chain, transport: http(RPC) });

const L: Record<string, any> = (D.levels ??= { txs: {} });
L.txs ??= {};

async function hasCode(a?: string) {
  return !!a && ((await pub.getCode({ address: a as Address })) ?? "0x") !== "0x";
}

async function deploy(key: string, file: string, name: string, args: unknown[]) {
  if (await hasCode(L[key])) {
    console.log(`${key} : déjà déployé ${L[key]}`);
    return L[key] as Address;
  }
  if (DRY) {
    console.log(`[DRY] déploierait ${name}(${args.map(String).join(", ")})`);
    return "0x0000000000000000000000000000000000000000" as Address;
  }
  const { abi, bytecode } = art(file, name);
  const hash = await wallet.deployContract({ abi, bytecode, args } as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`${name} : déploiement échoué`);
  L[key] = r.contractAddress;
  L.txs[key] = hash;
  save();
  console.log(`${key} : ${r.contractAddress} (tx ${hash}, gaz ${r.gasUsed})`);
  return r.contractAddress as Address;
}

async function send(label: string, address: Address, abi: Abi, fn: string, args: unknown[]) {
  if (DRY) {
    console.log(`[DRY] ${label}`);
    return;
  }
  const { request } = await pub.simulateContract({ account: deployer, address, abi, functionName: fn, args } as any);
  const hash = await wallet.writeContract(request as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} : échec`);
  L.txs[label] = hash;
  save();
  console.log(`${label} : tx ${hash}`);
}

function save() {
  if (!DRY) writeFileSync(DEPLOY_FILE, JSON.stringify(D, null, 2) + "\n");
}

async function main() {
  console.log(`déployeur ${deployer.address} ; registre ${K.EnclaveRegistry} ; produits ${K.ProductRegistry}`);
  const machines = await deploy("MachineRegistry", "MachineRegistry", "MachineRegistry", [K.EnclaveRegistry, K.ProductRegistry]);
  const ed = await deploy("Ed25519Verifier", "Ed25519Verifier", "Ed25519Verifier", []);
  const poc = await deploy("ProofOfCloudAuditor", "ProofOfCloudAuditor", "ProofOfCloudAuditor", [
    machines, ed, POC.allianceKey as Hex, BigInt(POC.keyX), BigInt(POC.keyY),
  ]);
  const view = await deploy("PolicyEnclaves", "PolicyEnclaves", "PolicyEnclaves", [K.EnclaveRegistry, machines]);

  const sb = art("SealedBounty", "SealedBounty").abi;
  const nb = (await pub.readContract({ address: K.SealedBounty!, abi: sb, functionName: "networkBountyBps" })) as number;
  const ob = (await pub.readContract({ address: K.SealedBounty!, abi: sb, functionName: "operatorBountyBps" })) as number;
  const treasury = D.treasury as Address;
  const bounty = await deploy("SealedBountyVerified", "SealedBounty", "SealedBounty", [
    X.USDC, K.ProductRegistry, view, K.OperatorBond, K.VerdictLog, treasury, nb, ob,
  ]);

  // un nouveau contrat de règlement : 8 jours avant de pouvoir saisir une caution ou écrire un verdict
  const bondAbi = art("OperatorBond", "OperatorBond").abi;
  const verdictAbi = art("VerdictLog", "VerdictLog").abi;
  if (!DRY) {
    const sApply = (await pub.readContract({ address: K.OperatorBond!, abi: bondAbi, functionName: "settlementApplyAt", args: [bounty] })) as bigint;
    const isS = (await pub.readContract({ address: K.OperatorBond!, abi: bondAbi, functionName: "isSettlement", args: [bounty] })) as boolean;
    if (!isS && sApply === 0n) await send("proposeSettlement", K.OperatorBond!, bondAbi, "proposeSettlement", [bounty]);
    const cApply = (await pub.readContract({ address: K.VerdictLog!, abi: verdictAbi, functionName: "callerApplyAt", args: [bounty] }).catch(() => 0n)) as bigint;
    const isC = (await pub.readContract({ address: K.VerdictLog!, abi: verdictAbi, functionName: "isCaller", args: [bounty] })) as boolean;
    if (!isC && cApply === 0n) await send("proposeCaller", K.VerdictLog!, verdictAbi, "proposeCaller", [bounty]);
    L.settlementApplyAt = Number(await pub.readContract({ address: K.OperatorBond!, abi: bondAbi, functionName: "settlementApplyAt", args: [bounty] }));
    L.callerApplyAt = Number(await pub.readContract({ address: K.VerdictLog!, abi: verdictAbi, functionName: "callerApplyAt", args: [bounty] }).catch(() => 0n));
  }
  L.allianceKey = POC.allianceKey;
  L.note = "Deux niveaux d'opérateur (10/11/2026) : MachineRegistry (liaison enclave → puce PPID, déclarations, politiques), " +
    "ProofOfCloudAuditor (jeton EdDSA de l'alliance Proof of Cloud vérifié on-chain), PolicyEnclaves (registre vu à travers la " +
    "politique du produit), SealedBountyVerified (même code que SealedBounty, branché sur PolicyEnclaves ; saisies et verdicts " +
    "après le délai de 8 jours de OperatorBond / VerdictLog).";
  save();
  console.log(`\nfait. Saisies possibles après ${L.settlementApplyAt ? new Date(L.settlementApplyAt * 1000).toISOString() : "?"} ; verdicts après ${L.callerApplyAt ? new Date(L.callerApplyAt * 1000).toISOString() : "?"}`);
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
