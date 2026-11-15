/**
 * register-dcap.ts — inscrit une VRAIE enclave Intel TDX dans le registre v2, vérifiée par DCAP sur la chaîne :
 *  1) quote frais demandé à l'enclave (/attest), lié à la chaîne, au registre, au produit, à l'opérateur et à un bloc récent ;
 *  2) mesures obtenues en simulant le module DCAP (exactement ce que le contrat calculera), d'où le workloadId ;
 *  3) l'auteur du produit autorise ce workloadId (proposeWorkload puis applyWorkload ; délai = timelock, 0 sur testnet) ;
 *  4) registerEnclave : le registre appelle TdxAttestationModule → Automata DCAP, qui vérifie la signature d'Intel.
 * Rôles séparés : l'AUTEUR du produit (clé du déployeur) autorise l'image ; l'OPÉRATEUR (.secrets/operator.json) inscrit.
 * v2.1 (si le registre expose replayEventLog) : le journal RTMR3 de dstack est encodé (FORMAT_V1) et rejoué hors chaîne
 * PUIS par le registre lui-même ; l'image autorisée est l'EMPREINTE D'IMAGE (compose-hash + os-image-hash, sans
 * instance-id) : un redémarrage de la VM ne demande plus de nouvelle autorisation. Sur la v2, chemin d'origine.
 * Usage : ENCLAVE_URL=https://…-8802.dstack-pha1-prod9.phala.network PRODUCT_ID=1 npx tsx scripts/register-dcap.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodePacked, http, keccak256, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { dstackImageFromAttest } from "../../packages/sdk/src/dstack-eventlog";
import { parseTdxQuote } from "../../packages/sdk/src/quote";

const ROOT = new URL("../../", import.meta.url);
const D = JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS ?? "deployments.v2.testnet.json", ROOT), "utf8"));
const K = D.contracts as Record<string, Address>;
const abi = (name: string, dir = name): Abi => JSON.parse(readFileSync(new URL(`contracts/out/${dir}.sol/${name}.json`, ROOT), "utf8")).abi;
const ENCLAVE = (process.env.ENCLAVE_URL ?? "").replace(/\/$/, "");
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? "0");
if (!ENCLAVE || !PRODUCT_ID) { console.error("ENCLAVE_URL et PRODUCT_ID requis"); process.exit(1); }

const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const key = (f: string) => privateKeyToAccount(JSON.parse(readFileSync(new URL(`.secrets/${f}`, ROOT), "utf8")).privateKey as Hex);
const account = key(process.env.OPERATOR_KEY_FILE ?? "operator.json"); // l'opérateur : il inscrit l'enclave
const author = key(process.env.AUTHOR_KEY_FILE ?? "deployer.json"); // l'auteur du produit : il autorise l'image
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain, transport: http() });
const authorWallet = createWalletClient({ account: author, chain, transport: http() });

async function send(address: Address, a: Abi, functionName: string, args: unknown[], label: string, w = wallet) {
  const { request } = await pub.simulateContract({ account: w.account!, address, abi: a, functionName, args } as any);
  const hash = await w.writeContract(request as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  const price = r.effectiveGasPrice ?? 0n;
  console.log(`${label} : ${hash} (statut ${r.status}, gas ${r.gasUsed}, ${(Number(r.gasUsed * price) / 1e18).toFixed(4)} USDC)`);
  if (r.status !== "success") throw new Error(`${label} a échoué`);
  return r;
}

async function main() {
  const reg = abi("EnclaveRegistry"), pr = abi("ProductRegistry"), mod = abi("TdxAttestationModule");
  const anchorR = (await pub.getBlockNumber()) - 10n;
  const res = await fetch(`${ENCLAVE}/attest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator: account.address, anchorR: anchorR.toString() }) });
  const a = await res.json() as { quote: Hex; signer: Address; x25519: Hex; eventLog?: Hex; mock?: boolean; error?: string };
  if (!res.ok || a.error) throw new Error(`/attest : ${res.status} ${a.error ?? ""}`);
  if (a.mock) throw new Error("quote simulé : cette machine n'a pas Intel TDX, inscription refusée");
  let eventLog = (a.eventLog ?? "0x") as Hex;
  console.log(`quote TDX reçu : ${(a.quote.length - 2) / 2} octets, signataire ${a.signer}, ancré au bloc ${anchorR}`);
  // v2.1 ? (le registre sait rejouer le journal RTMR3)
  const img = dstackImageFromAttest(a.quote, a.eventLog);
  let v21 = false;
  if (img.eventLog) {
    try {
      const [rtmr3, known, compose, os] = await pub.readContract({ address: K.EnclaveRegistry!, abi: reg, functionName: "replayEventLog", args: [img.eventLog] }) as [Hex, boolean, Hex, Hex];
      v21 = true;
      if (!img.rtmr3Matches) throw new Error("le journal RTMR3 ne redonne pas le RTMR3 du quote (rejeu local)");
      if (rtmr3.toLowerCase() !== parseTdxQuote(a.quote).rtmr3.toLowerCase()) throw new Error("le rejeu du registre ne redonne pas le RTMR3 du quote");
      if (!known || compose.toLowerCase() !== img.composeHash?.toLowerCase() || os.toLowerCase() !== img.osImageHash?.toLowerCase())
        throw new Error(`rejeu du registre différent du rejeu local (image connue ${known}, compose ${compose}, os ${os})`);
      eventLog = img.eventLog;
      console.log(`v2.1 : journal RTMR3 rejoué (hors chaîne et par le registre) : compose-hash ${compose}, os-image-hash ${os}`);
    } catch (e) {
      if (v21) throw e;
      console.log("registre v2 (pas de replayEventLog) : empreinte complète, journal brut");
    }
  }

  // ce que le contrat va calculer : la vérification DCAP simulée renvoie les mesures
  const { result: m } = await pub.simulateContract({ account, address: K.TdxAttestationModule!, abi: mod, functionName: "verify", args: [a.quote, eventLog] } as any) as { result: any };
  if (!m.ok) throw new Error("vérification DCAP simulée : échec");
  const workloadId = keccak256(encodePacked(
    ["bytes", "bytes", "bytes", "bytes", "bytes", "bytes", "bytes8", "bytes8"],
    [m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, m.rtmr3, m.mrConfigId, m.xfam, m.tdAttributes],
  ));
  console.log(`DCAP (simulé) : version ${m.version}, TCB ${m.tcbStatus}, FMSPC ${m.fmspc}, attributs ${m.tdAttributes}, workloadId ${workloadId}`);
  if (workloadId.toLowerCase() !== img.workloadId.toLowerCase()) throw new Error("empreinte complète : SDK et module DCAP en désaccord");

  let allowId = workloadId;
  if (v21) {
    const onchain = await pub.readContract({ address: K.EnclaveRegistry!, abi: reg, functionName: "imageIdOf", args: [m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, img.composeHash, img.osImageHash, m.xfam, m.tdAttributes] }) as Hex;
    if (onchain.toLowerCase() !== img.imageId?.toLowerCase()) throw new Error(`empreinte d'image : registre ${onchain}, SDK ${img.imageId}`);
    allowId = onchain;
    console.log(`empreinte d'IMAGE (stable d'un redémarrage à l'autre) : ${allowId}`);
  }
  if (!(await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "isWorkloadAllowed", args: [PRODUCT_ID, allowId] }))) {
    await send(K.ProductRegistry!, pr, "proposeWorkload", [PRODUCT_ID, allowId], `image proposée (produit ${PRODUCT_ID}, par l'auteur)`, authorWallet);
    await send(K.ProductRegistry!, pr, "applyWorkload", [PRODUCT_ID, allowId], "image autorisée (par l'auteur)", authorWallet);
  }
  const r = await send(K.EnclaveRegistry!, reg, "registerEnclave", [PRODUCT_ID, a.quote, anchorR, a.signer, a.x25519, eventLog], "registerEnclave (vérification DCAP on-chain)");
  const e = await pub.readContract({ address: K.EnclaveRegistry!, abi: reg, functionName: "enclaveOf", args: [a.signer] }) as any;
  const head = await pub.getBlockNumber();
  const op = await pub.readContract({ address: K.EnclaveRegistry!, abi: reg, functionName: "activeOperatorAt", args: [a.signer, PRODUCT_ID, head] });
  console.log(`inscrite : produit ${e.productId}, opérateur ${e.operator}, TCB ${e.tcbStatus}, FMSPC ${e.fmspc}, workload ${e.workloadId}, blocs ${e.fromBlock}→${e.untilBlock} ; opérateur actif au bloc ${head} : ${op}`);
  console.log(`tx d'inscription : ${r.transactionHash}`);
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
