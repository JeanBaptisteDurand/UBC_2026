/**
 * sealed-bounty/server.ts — Produit A : la Prime scellée (O3), en service HTTP (voir ./app.ts).
 * L'enclave ouvre le bundle d'exploit chiffré (cE), rejoue dans un fork (simulé en local ;
 * arc-anvil au bloc N en vraie VM), évalue le prédicat, et signe la réclamation EIP-712 si c'est prouvé.
 *
 * v2 : le chasseur peut fixer blockN et l'échéance dans le bundle (k enclaves signent la même
 * réclamation) ; un seul service pour toute la vie du processus (mémoire anti-équivocation) ; paliers
 * lus on-chain. Variables : OPERATOR_ALLOWLIST, RPC_URLS (quorum, défaut RPC_URL).
 *
 * v2.1 : POST /v1/refute — contre-rejeu d'une réclamation acceptée (même moteur, même file de rejeu), réfutation
 * EIP-712 signée seulement si le résultat diffère ; lectures on-chain au même bloc par le quorum (claimRecords,
 * REFUTE_WINDOW, prime, activeOperatorAt de cette enclave sur REGISTRY).
 *
 * v2.1 bis (revue adverse du 9/11) : le rejeu échoue fermé (jamais de signature sur une panne du RPC du fork) ; au démarrage,
 * CONTRÔLE DU MOTEUR (AnvilForkRunner.selfTest) : une lecture refusée par le RPC du fork doit remonter en erreur, sinon la
 * machine refuse de démarrer ; REFUTE_ACCEPTED_FROM (facultatif, secondes Unix, mesuré dans le compose) : les réclamations
 * acceptées avant ne sont pas jugées (elles ont pu être signées par une image aux règles de rejeu différentes).
 *
 * v2.1 ter (vérification adverse du 9/11) : le moteur parle au RPC du fork à travers un RELAIS STRICT (src/services/
 * rpc-relay.ts : forme de chaque réponse, bloc ≤ N jamais null et rattaché à l'ancre, budget de requêtes par rejeu) ; le
 * contrôle du moteur vérifie aussi un bloc rendu null, une case de stockage mal formée et des lectures saines ; débit de
 * /bounty/submit et de /v1/refute (jetons pris après les contrôles bon marché) ; une prime lue une fois (cache partagé).
 *
 * v2.1 quater (démonstration de la réfutation, produit 5) : DEMO_FAULT=inflate-loss (en clair dans le compose, donc mesurée)
 * fait signer les réclamations avec une perte DOUBLÉE (réfutations honnêtes). Contrôlée AVANT tout le reste (./demo-fault.ts) :
 * produit 2, PRODUCT_ID absent, OPERATOR_ALLOWLIST=* ou contenant l'opérateur principal, valeur inconnue → arrêt. Une ligne de
 * journal au démarrage ; /pubkeys et /health l'annoncent. Absente : rien ne change.
 */
import { serve } from "@hono/node-server";
import { type Address } from "viem";
import { EnclaveKit } from "../../src/kit/enclave-kit";
import { RpcQuorum } from "../../src/kit/rpc-quorum";
import { parseOperatorAllowlist } from "../../src/server/attest-server";
import { createDstackClient } from "../../src/kit/dstack";
import { BountyService, DeterministicProtocolCipher, RefutationService, type BlockSource } from "../../src/services/bounty";
import { AnvilForkRunner } from "../../src/services/anvil-fork";
import { spawnSync } from "node:child_process";
import { BountyCache, chainBountyReader, chainRefuteReader, createSealedBountyApp } from "./app";
import { DemoFaultConfigError, demoFaultStartupLine, parseDemoFault } from "./demo-fault";

const RPC = process.env.RPC_URL ?? "https://rpc.testnet.arc.io";
const RPC_URLS = (process.env.RPC_URLS ?? RPC).split(",").map((s) => s.trim()).filter(Boolean);
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "5042002");
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? "0");
/** Adresse de contrat requise (posée et mesurée par le compose de l'enclave) : sans elle, arrêt. */
function requiredAddress(name: string): Address {
  const v = process.env[name];
  if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    console.error(`${name} requis (adresse du contrat sur Arc) : arrêt.`);
    process.exit(1);
  }
  return v as Address;
}
const SEALED = requiredAddress("SEALEDBOUNTY");
const REGISTRY = requiredAddress("REGISTRY");
const PORT = Number(process.env.PORT ?? "8803");

// v2.1 quater : la faute de DÉMONSTRATION est contrôlée avant tout le reste (refusée → arrêt, rien n'est servi)
const DEMO_FAULT = demoFaultOrExit();

function demoFaultOrExit() {
  try {
    const f = parseDemoFault({ DEMO_FAULT: process.env.DEMO_FAULT, OPERATOR_ALLOWLIST: process.env.OPERATOR_ALLOWLIST }, PRODUCT_ID);
    if (f) console.warn(demoFaultStartupLine(f, PRODUCT_ID));
    return f;
  } catch (e) {
    console.error(`${e instanceof DemoFaultConfigError ? e.message : "DEMO_FAULT illisible"} : arrêt.`);
    process.exit(1);
  }
}

// Le VRAI rejeu : un fork d'Arc au bloc N (anvil), l'exploit exécuté depuis l'adresse du chasseur, le prédicat mesuré
// avant/après sur l'état du fork (USDC d'Arc émulé fidèlement, cf. src/services/anvil-fork.ts). Aucun rejeu simulé :
// sans anvil, la machine refuse de démarrer (elle échoue fermée).
const FORK_RPC = process.env.FORK_RPC_URL ?? RPC_URLS[0]!;
const ANVIL_BIN = process.env.ANVIL_BIN ?? "anvil";
// 10/11 : PREUVES D'ÉTAT. STATE_PROOF_RPC_URL (variable MESURÉE du compose) : chaque lecture d'état du rejeu est prouvée
// (eth_getProof vérifié contre le stateRoot de l'en-tête N ancré) ; aucun RPC n'est alors de confiance pour l'état.
// Absente : l'ancien contrat (en-têtes liés à l'ancre, état non prouvé), dit au démarrage.
const STATE_PROOF_RPC = process.env.STATE_PROOF_RPC_URL?.trim() || undefined;
if (STATE_PROOF_RPC !== undefined && !/^https:\/\/[^\s]+$/.test(STATE_PROOF_RPC)) {
  console.error("STATE_PROOF_RPC_URL invalide (https:// attendu) : arrêt.");
  process.exit(1);
}
console.log(STATE_PROOF_RPC ? `rejeu : état PROUVÉ (eth_getProof) via ${new URL(STATE_PROOF_RPC).host}` : "rejeu : en-têtes liés à l'ancre, état NON prouvé (STATE_PROOF_RPC_URL absente)");
const fork = new AnvilForkRunner({ forkUrl: FORK_RPC, anvilBin: ANVIL_BIN, stateProofsUrl: STATE_PROOF_RPC });

/** REFUTE_ACCEPTED_FROM : entier décimal (s Unix) ; invalide → arrêt (jamais de repli silencieux). */
function acceptedFrom(): bigint | undefined {
  const v = process.env.REFUTE_ACCEPTED_FROM?.trim();
  if (!v) return undefined;
  if (!/^[0-9]{1,12}$/.test(v)) {
    console.error("REFUTE_ACCEPTED_FROM invalide (secondes Unix attendues) : arrêt.");
    process.exit(1);
  }
  return BigInt(v);
}

function requireAnvil() {
  const r = spawnSync(ANVIL_BIN, ["--version"], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`anvil introuvable (${ANVIL_BIN}) : la Prime scellée ne rejoue que pour de vrai, arrêt.`);
    process.exit(1);
  }
  console.log(`rejeu réel : ${String(r.stdout).split("\n")[0]} (fork de ${FORK_RPC})`);
}

async function main() {
  requireAnvil();
  // contrôle du moteur : une panne du RPC du fork doit remonter en erreur (sinon : arrêt, rien ne sera signé)
  const st = await fork.selfTest();
  console.log(`contrôle du moteur (bloc ${st.blockN}) : ${st.checks.join(" ; ")} ; revert EVM : code ${st.revertCode ?? "?"}${st.revertCode === 3 ? "" : " (inattendu : les lectures de vue qui revert échoueront fermées)"}`);
  const from = acceptedFrom();
  const operatorAllowlist = parseOperatorAllowlist(process.env.OPERATOR_ALLOWLIST); // invalide => arrêt
  const dstack = await createDstackClient();
  const rpc = new RpcQuorum(RPC_URLS);
  // tête et hash du bloc N lus en quorum (au même bloc chez tous les fournisseurs)
  const blocks: BlockSource = { current: () => rpc.commonHead(), blockHash: (n: bigint) => rpc.blockHash(n) };
  const kit = new EnclaveKit({ productId: PRODUCT_ID, chainId: CHAIN_ID, registry: REGISTRY, rpc, dstack: dstack ?? undefined });
  console.log(dstack ? "quote: dstack TDX réel" : "quote: mock (hors VM TDX)");

  // v2.1 ter : champs immuables des primes (prédicat, clé, paliers) lus une fois, partagés par la soumission et la réfutation
  const bounties = new BountyCache();
  const service = new BountyService(
    kit, { sealedBounty: SEALED, ...(DEMO_FAULT ? { demoFault: DEMO_FAULT } : {}) }, chainBountyReader(rpc, SEALED, bounties),
    new DeterministicProtocolCipher(), fork, blocks, () => BigInt(Math.floor(Date.now() / 1000)),
  );
  // contre-rejeu des réclamations acceptées : même moteur (et même file de rejeu) que les réclamations
  const refuter = new RefutationService(kit, { sealedBounty: SEALED, acceptedFrom: from }, chainRefuteReader(rpc, SEALED, REGISTRY, bounties), new DeterministicProtocolCipher(), fork);
  if (from !== undefined) console.log(`réfutation : réclamations acceptées à partir de ${from} (REFUTE_ACCEPTED_FROM)`);
  const app = createSealedBountyApp({ kit, service, refuter, attest: { operatorAllowlist } });

  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
  console.log(`sealed-bounty (O3) sur http://localhost:${PORT}  signer=${kit.keys.signer}  quorum=${RPC_URLS.length} RPC${DEMO_FAULT ? `  DEMO_FAULT=${DEMO_FAULT} (démonstration)` : ""}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
