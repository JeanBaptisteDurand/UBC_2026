/**
 * e2e-bounty-v2.ts — la Prime scellée de bout en bout, entièrement réelle, sur la pile v2 d'Arc testnet :
 *  1) le protocole dote un coffre (DemoVault, faille volontaire) et publie une prime : « le solde USDC du coffre baisse
 *     d'au moins 1 USDC » ; le pool est en USDC, la prime pointe la machine du produit 2 ;
 *  2) le chasseur vérifie SUR LA CHAÎNE la clé de l'enclave (inscrite par DCAP, active pour le produit), puis lui envoie
 *     son exploit chiffré (DemoVault.migrate(chasseur)) ;
 *  3) l'enclave (VM Intel TDX chez Phala) REJOUE l'exploit sur un fork d'Arc au bloc N (anvil) et signe la réclamation ;
 *  4) le chasseur la fait accepter (acceptClaim), puis livre le rapport chiffré au protocole (deliver) : il est payé,
 *     le coffre est mis en pause ; le protocole déchiffre le rapport.
 * Rien ne bouge sur la vraie chaîne côté coffre : l'exploit n'a été exécuté que dans le fork.
 * Clés : protocole = déployeur ; chasseur = .secrets/hunter.json (créée au besoin). Usage : cd enclave && npx tsx scripts/e2e-bounty-v2.ts
 * 10/11 — PRODUIT 6 (niveau vérifié, état prouvé) : PRODUCT_ID=6 (contrat SealedBountyVerified, enclave 6, contrôle du niveau
 * par PolicyEnclaves avant l'envoi) ; tant que la Prime vérifiée n'est pas encore autorisée par la caution (délai de 8 jours),
 * le script s'arrête après la réclamation SIGNÉE par l'enclave et dit pourquoi acceptClaim serait refusé.
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import {
  createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, parseEther, parseEventLogs, toBytes, toHex,
  type Abi, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { predicateHash, type Predicate } from "../src/services/predicate";
import { DeterministicProtocolCipher } from "../src/services/bounty";
import { encodeExploitTx, ARC_USDC } from "../src/services/anvil-fork";
import { seal } from "../src/kit/hpke";
import { deterministicOpen } from "../src/kit/deterministic-seal";

const ROOT = new URL("../../", import.meta.url);
const D = JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS ?? "deployments.v2.testnet.json", ROOT), "utf8"));
const K = D.contracts as Record<string, Address>;
const PRODUCT = BigInt(process.env.PRODUCT_ID ?? "2");
const VERIFIED = PRODUCT === 7n;
const BOUNTY_CONTRACT = (VERIFIED ? D.levels.SealedBountyVerified : K.SealedBounty) as Address;
const BOUNTY_ENCLAVE = (process.env.ENCLAVE_URL ?? D.enclaves[PRODUCT.toString()].url).replace(/\/$/, "");
const abi = (n: string): Abi => JSON.parse(readFileSync(new URL(`contracts/out/${n}.sol/${n}.json`, ROOT), "utf8")).abi;
const sb = abi("SealedBounty"), reg = abi("EnclaveRegistry");
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const vaultAbi = parseAbi(["function migrate(address to)", "function paused() view returns (bool)"]);
const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800, timeout: 60_000 }) });
const sec = (f: string) => JSON.parse(readFileSync(new URL(`.secrets/${f}`, ROOT), "utf8"));
const protocol = privateKeyToAccount(sec("deployer.json").privateKey as Hex);
const PROTO_X = sec("demo-protocol-x25519.json") as { privateKey: Hex; publicKey: Hex };
const HF = new URL(".secrets/hunter.json", ROOT);
if (!existsSync(HF)) { const pk = generatePrivateKey(); writeFileSync(HF, JSON.stringify({ address: privateKeyToAccount(pk).address, privateKey: pk, role: "chasseur de démonstration" }, null, 2)); chmodSync(HF, 0o600); }
const hunter = privateKeyToAccount(JSON.parse(readFileSync(HF, "utf8")).privateKey as Hex);
const asProtocol = createWalletClient({ account: protocol, chain, transport: http() });
const asHunter = createWalletClient({ account: hunter, chain, transport: http() });
const usd = (x: bigint) => `${Number(x) / 1e6} USDC`;

async function send(w: typeof asHunter, address: Address, a: Abi, fn: string, args: unknown[], label: string) {
  const { request, result } = await pub.simulateContract({ account: w.account!, address, abi: a, functionName: fn, args } as any);
  const hash = await w.writeContract(request as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${label} : ${hash} (statut ${r.status}, gas ${r.gasUsed})`);
  if (r.status !== "success") throw new Error(`${label} a échoué`);
  return { r, result };
}

async function main() {
  const vault = K.DemoVault!;
  console.log(`protocole ${protocol.address} ; chasseur ${hunter.address} ; coffre ${vault}`);
  // gas du chasseur (le jeton natif d'Arc est l'USDC)
  if ((await pub.getBalance({ address: hunter.address })) < parseEther("0.3")) {
    const h = await asProtocol.sendTransaction({ to: hunter.address, value: parseEther("0.5") });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`chasseur doté pour le gas : ${h}`);
  }
  // 1. le coffre de démonstration est doté (vraie faille, vrais fonds)
  if ((await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [vault] })) < 1_000_000n) {
    const h = await asProtocol.writeContract({ address: ARC_USDC, abi: usdcAbi, functionName: "transfer", args: [vault, 1_000_000n] });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`coffre doté de 1 USDC : ${h}`);
  }
  const vaultBefore = await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [vault] });

  // 2. la prime
  const predicate: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: ARC_USDC, holder: vault, min: "1000000" }] };
  const funding = 1_000_000n;
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await asProtocol.signTypedData({
    account: protocol, domain: { name: "USDC", version: "2", chainId: chain.id, verifyingContract: ARC_USDC },
    types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "ReceiveWithAuthorization", message: { from: protocol.address, to: BOUNTY_CONTRACT, value: funding, validAfter: 0n, validBefore, nonce },
  });
  const q = {
    productId: PRODUCT, predicateHash: predicateHash(predicate), protocolX25519: PROTO_X.publicKey,
    tierMinLoss: [1_000_000n], tierAmount: [500_000n], singleCap: 500_000n, k: 1, targetToPause: vault,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 86400), funding, auth: { validAfter: 0n, validBefore, nonce, signature },
  };
  // BOUNTY_ID : reprendre une prime déjà publiée (ex. après une coupure réseau) au lieu d'en créer une
  const bountyId = process.env.BOUNTY_ID ? BigInt(process.env.BOUNTY_ID)
    : (await send(asProtocol, BOUNTY_CONTRACT, sb, "createBounty", [q], "prime publiée (pool 1 USDC, palier 0,5 USDC pour une perte ≥ 1 USDC)")).result as bigint;
  console.log(`prime n° ${bountyId}`);

  // 3. le chasseur vérifie la clé de l'enclave SUR LA CHAÎNE avant d'envoyer quoi que ce soit
  const pk = await (await fetch(`${BOUNTY_ENCLAVE}/pubkeys`)).json() as { signer: Address; x25519: Hex };
  const e = await pub.readContract({ address: K.EnclaveRegistry!, abi: reg, functionName: "enclaveOf", args: [pk.signer] }) as any;
  const head = await pub.getBlockNumber();
  // produit 6 : lu À TRAVERS PolicyEnclaves (comme le contrat de règlement) : l'enclave compte-t-elle au niveau vérifié ?
  const op = await pub.readContract({ address: (VERIFIED ? D.levels.PolicyEnclaves : K.EnclaveRegistry!) as Address, abi: reg, functionName: "activeOperatorAt", args: [pk.signer, PRODUCT, head] }) as Address;
  if (String(e.x25519).toLowerCase() !== pk.x25519.toLowerCase()) throw new Error("la clé de l'enclave ne correspond pas à celle inscrite sur Arc : envoi refusé");
  if (/^0x0+$/.test(op)) throw new Error("l'enclave n'est pas active pour la Prime scellée : envoi refusé");
  console.log(`clé de l'enclave vérifiée sur Arc : signataire ${pk.signer}, opérateur ${op}, workload ${e.workloadId}`);

  // 4. l'exploit (vrai) chiffré pour l'enclave ; cP chiffré pour le protocole, reproductible par l'enclave
  const txs = [encodeExploitTx({ to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "migrate", args: [hunter.address] }) })];
  const r = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const bundle = { bountyId, payee: hunter.address, capital: 0n, predicate, txs, r, cP: "0x" as Hex };
  bundle.cP = await new DeterministicProtocolCipher().recompute(bundle as any, PROTO_X.publicKey);
  const wire = JSON.stringify({ ...bundle, bountyId: bountyId.toString(), capital: "0" });
  const cE = await seal(toBytes(pk.x25519), new TextEncoder().encode(wire));
  const t0 = Date.now();
  const resp = await fetch(`${BOUNTY_ENCLAVE}/bounty/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enc: toHex(cE.enc), ciphertext: toHex(cE.ciphertext) }), signal: AbortSignal.timeout(600_000) })
    .catch((e) => { throw new Error(`envoi à l'enclave coupé après ${Date.now() - t0} ms : ${e?.cause?.code ?? e?.cause?.message ?? e?.message}`); });
  if (!resp.ok && resp.status !== 200) throw new Error(`enclave : HTTP ${resp.status} après ${Date.now() - t0} ms : ${(await resp.text()).slice(0, 200)}`);
  const res = await resp.json() as any;
  if (res.status !== "proven") throw new Error(`non prouvé : ${res.reason ?? JSON.stringify(res).slice(0, 200)}`);
  console.log(`enclave : exploit REJOUÉ sur un fork d'Arc au bloc ${res.claim.blockN} et prouvé en ${Date.now() - t0} ms (perte ${usd(BigInt(res.claim.loss))}, palier ${res.claim.tier}, empreinte ${res.claim.fingerprint.slice(0, 18)}…)`);

  // 5. réclamation acceptée puis rapport livré : paiement
  const claim = { ...res.claim, bountyId: BigInt(res.claim.bountyId), blockN: BigInt(res.claim.blockN), loss: BigInt(res.claim.loss), deadline: BigInt(res.claim.deadline), tier: Number(res.claim.tier) };
  if (VERIFIED) {
    const bondAbi = parseAbi(["function isSettlement(address) view returns (bool)", "function settlementApplyAt(address) view returns (uint64)"]);
    const ok = await pub.readContract({ address: K.OperatorBond!, abi: bondAbi, functionName: "isSettlement", args: [BOUNTY_CONTRACT] });
    if (!ok) {
      const at = await pub.readContract({ address: K.OperatorBond!, abi: bondAbi, functionName: "settlementApplyAt", args: [BOUNTY_CONTRACT] });
      console.log(`réclamation SIGNÉE par l'enclave du niveau vérifié (signature ${String(res.signature).slice(0, 18)}…) ; acceptClaim attend l'autorisation de la Prime vérifiée par la caution (applySettlement possible à partir du ${new Date(Number(at) * 1000).toISOString()} : délai de 8 jours pour tout nouveau contrat de règlement). Arrêt ici.`);
      return;
    }
  }
  const before = await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [hunter.address] });
  await send(asHunter, BOUNTY_CONTRACT, sb, "acceptClaim", [claim, [res.signature]], "réclamation acceptée (signature de l'enclave vérifiée par le contrat)");
  const d = await send(asHunter, BOUNTY_CONTRACT, sb, "deliver", [bountyId, claim.fingerprint, res.cP], "rapport livré au protocole → paiement");
  const after = await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [hunter.address] });
  const names = parseEventLogs({ abi: sb, logs: d.r.logs }).map((l: any) => l.eventName);
  console.log(`événements : ${names.join(", ")}`);
  console.log(`chasseur : +${usd(after - before)} (net du gas qu'il a payé, en USDC sur Arc) ; coffre en pause : ${await pub.readContract({ address: vault, abi: vaultAbi, functionName: "paused" })} ; coffre sur la vraie chaîne : ${usd(vaultBefore)} → ${usd(await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [vault] }))}`);

  // 6. le protocole lit le rapport (et lui seul le peut)
  const report = JSON.parse(new TextDecoder().decode(deterministicOpen(toBytes(PROTO_X.privateKey), res.cP)));
  console.log(`le protocole déchiffre le rapport : chasseur ${report.payee}, ${report.txs.length} transaction(s) d'exploit, prédicat ${report.predicate.clauses[0].type}`);
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
