// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/hunt-demo.ts`.
/**
 * hunt-demo.ts — le geste n° 3 de la démo (pile v2), joué de bout en bout comme le ferait le navigateur :
 *  0) la prime est lue ON-CHAIN (produit, clé X25519 du protocole) et les clés de l'enclave O3 sont VÉRIFIÉES on-chain
 *     (verifyEnclaveKeys : clé X25519 = celle inscrite, enclave active pour le produit de la prime) — sinon rien n'est
 *     chiffré : celui qui sert /pubkeys (mandataire) ne doit jamais pouvoir lire l'exploit ;
 *  1) le chasseur chiffre son exploit (cP pour le protocole, cE pour l'enclave vérifiée) et l'envoie à l'enclave ;
 *  2) l'enclave rejoue sur un fork d'Arc, prouve la perte et signe une réclamation ; on la contrôle (signataire, cP…) ;
 *  3) la MÊME réclamation modifiée d'un octet est refusée par le contrat (simulation de acceptClaim : rien n'est dépensé) ;
 *  4) v2 : acceptClaim réserve le paiement (cP hors transaction), puis deliver livre le rapport et paie ;
 *  5) le protocole déchiffre le rapport avec sa clé.
 * Usage : BOUNTY=1 [O3=https://…-8803.dstack-pha1-prod9.phala.network] npx tsx scripts/hunt-demo.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEventLogs, parseAbi, toBytes, encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arcTestnet, testnet, createArcClient, deterministicOpen, sealedBountyAbi, arcErrorsAbi, encodeExploitTx, explainArcError,
} from "../src/index";
import { DEMO_PREDICATE, V2_BOUNTY_URL } from "./demo-shared";

if (!process.env.BOUNTY) { console.error("BOUNTY=<id de la prime> requis (pile v2 : arcvault bounty list)"); process.exit(1); }
const BOUNTY = BigInt(process.env.BOUNTY);
const O3 = V2_BOUNTY_URL.replace(/\/$/, "");
const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const PROTO = JSON.parse(readFileSync(new URL("../../../.secrets/demo-protocol-x25519.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });
const evAbi = parseAbi([
  "event BountyPaid(uint256 indexed bountyId, address indexed payee, uint256 amount, uint8 tier)",
  "event ExploitDelivered(uint256 indexed bountyId, bytes cP)",
]);

async function main() {
  const bounty = await arc.getBounty(BOUNTY);
  if (bounty.protocol === "0x0000000000000000000000000000000000000000") throw new Error(`prime #${BOUNTY} inexistante`);
  console.log(`prime #${BOUNTY} : produit #${bounty.productId}, pool ${Number(bounty.balance) / 1e6} USDC`);

  // l'exploit RÉEL : la faille volontaire du coffre de démo (migrate sans contrôle d'accès), rejouée sur un fork d'Arc
  const payee = account.address;
  const txs = [encodeExploitTx({ to: testnet.demoVault, data: encodeFunctionData({ abi: parseAbi(["function migrate(address to)"]), functionName: "migrate", args: [payee] }) })];

  // 0-1) clés de l'enclave VÉRIFIÉES on-chain pour le produit de la prime, puis chiffrement (cP vers le protocole lu on-chain)
  const sealed = await arc.prepareExploit({ bountyId: BOUNTY, enclaveUrl: O3, exploit: { predicate: DEMO_PREDICATE, txs, capital: 0n }, payee });
  console.log(`0) enclave O3 vérifiée on-chain : ${sealed.enclave.signer} (opérateur ${sealed.enclave.operator}, clé X25519 inscrite, active au bloc ${sealed.enclave.checkedAtBlock})`);

  const t0 = Date.now();
  const proven = await arc.proveExploit(sealed);
  console.log(`1-2) l'enclave a prouvé la perte (${Number(proven.claim.loss) / 1e6} USDC, palier ${proven.claim.tier}) et signé la réclamation en ${Date.now() - t0} ms`);

  // 3) la même réclamation, modifiée d'un octet (la perte +1) : le contrat doit refuser
  const tampered = { ...proven.claim, loss: proven.claim.loss + 1n };
  try {
    await pub.simulateContract({ account, address: testnet.sealedBounty, abi: [...sealedBountyAbi, ...arcErrorsAbi], functionName: "acceptClaim", args: [tampered, [proven.signature]] });
    console.log("3) ✗ la réclamation modifiée N'A PAS été refusée");
  } catch (e) {
    console.log(`3) ✓ réclamation modifiée d'un octet REFUSÉE par le contrat (${explainArcError(e).slice(0, 110)})`);
  }

  // 4) v2 : réservation (acceptClaim) puis livraison et paiement (deliver)
  const { acceptTx, deliverTx } = await arc.acceptAndDeliver(proven.claim, [proven.signature], proven.cP);
  const rc = await pub.waitForTransactionReceipt({ hash: deliverTx });
  const logs = parseEventLogs({ abi: evAbi, logs: rc.logs });
  const paid = logs.find((l: any) => l.eventName === "BountyPaid") as any;
  const delivered = logs.find((l: any) => l.eventName === "ExploitDelivered") as any;
  console.log(`4) ✓ réservée (${acceptTx}) puis payée au bloc ${rc.blockNumber} : ${Number(paid?.args.amount ?? 0n) / 1e6} USDC au chasseur ; rapport livré : ${delivered ? "oui" : "non"}  tx ${deliverTx}`);

  // 5) le protocole déchiffre le rapport
  if (delivered) {
    const report = new TextDecoder().decode(deterministicOpen(toBytes(PROTO.privateKey as Hex), delivered.args.cP as Hex));
    const j = JSON.parse(report);
    console.log(`5) ✓ le protocole a déchiffré le rapport : chasseur ${j.payee}, capital ${Number(j.capital) / 1e6} USDC, prédicat ${j.predicate.clauses[0].type}`);
  }
}
main().catch((e) => { console.error("ÉCHEC :", explainArcError(e)); process.exit(1); });
