/**
 * anvil-fork.ts — le VRAI rejeu de la Prime scellée : un fork d'Arc au bloc N (anvil), l'exploit exécuté depuis
 * l'adresse du chasseur, puis le prédicat mesuré avant/après sur l'état réel du fork.
 *
 * Pourquoi un émulateur d'USDC : sur Arc, l'ERC-20 USDC (0x3600…) reflète le solde natif et ses transferts passent
 * par un précompilé système (0x1800…) qu'anvil n'a pas ; sans lui, tout transfert d'USDC échoue dans le fork.
 * Le rejeu remplace donc le code de 0x3600 DANS LE FORK par ArcUsdcShim (contracts/src/fork), qui garde la
 * sémantique d'Arc (solde = natif / 1e12 + transferts ERC-20, allocations réelles lues au bloc N).
 *
 * Déterminisme (k enclaves doivent trouver la même perte et la même empreinte) : même bloc N, gas à prix nul,
 * horodatages épinglés sur celui du bloc N (+1 s par transaction), aucun solde injecté hors du capital déclaré.
 *
 * Format d'une transaction de l'exploit (bundle.txs[i]) : abi.encode(address to, uint256 value, bytes data),
 * envoyée depuis bundle.payee (usurpée dans le fork seulement). bundle.attackCode, s'il existe, est déployé
 * d'abord depuis la même adresse (adresse du contrat = getContractAddress(payee, nonce au bloc N)).
 *
 * v2.1 bis (revue adverse du 9/11) — LE REJEU ÉCHOUE FERMÉ. Un rejeu rend soit des MESURES (déterministes : même état au
 * bloc N, même exploit), soit une exception typée, jamais une valeur inventée :
 *  - ReplayRuleError : une règle déterministe du rejeu est violée (validateBundle : nombre, taille et format des
 *    transactions, code d'attaque, capital) ; message fixe ;
 *  - ReplayUnavailableError : tout le reste — RPC du fork en erreur (même UNE lecture), délai dépassé, anvil arrêté,
 *    réponse illisible, file pleine, RPC du fork qui ne sert pas le bloc N de la réclamation (hash différent). Rien n'est
 *    signé (ni réclamation, ni réfutation : HTTP 503).
 *  Seul un revert DÉTERMINISTE de l'EVM (erreur JSON-RPC code 3 « execution reverted », EIP-1474) d'une lecture de clause
 *  VIEW_CHANGED / INVARIANT_BROKEN reste une valeur, selon la règle v0 : vue = 0, invariant non tenu. Un arrêt
 *  exceptionnel de l'EVM (OutOfGas, InvalidFEOpcode…) est rendu par anvil avec le MÊME code -32603 qu'une panne du RPC du
 *  fork (« failed to get storage … ») : indiscernables, ils échouent fermés (vérifié sur anvil 1.5.1, le 9/11).
 *  Les lectures de solde (ERC-20, natif) échouent fermées sur toute erreur, revert compris (inchangé).
 *
 * v2.1 ter (vérification adverse du 9/11, preuves verif-failclosed e1, matrices, e7) — RELAIS STRICT (rpc-relay.ts) : le
 * moteur ne parle plus au RPC du fork, mais à un relais local qui contrôle la forme de chaque réponse (bloc ≤ N jamais
 * null et rattaché à l'ancre, stockage de 32 octets, quantités canoniques…), refuse toute autre méthode et compte les
 * requêtes du rejeu (BUDGET, défaut DEFAULT_MAX_FORK_REQUESTS). La moindre réponse INVALIDE est mémorisée par le relais : le
 * rejeu échoue fermé (ReplayUnavailableError « relay » ou « budget »), même si le moteur a réessayé ensuite avec succès. Un
 * échec PASSAGER du RPC du fork (erreur JSON-RPC, HTTP 429/503, réseau) est rendu tel quel au moteur, qui échoue (échec
 * fermé, comme avant) ou réessaie (la réponse réessayée est contrôlée). Le hash du bloc N chargé par le moteur est comparé à
 * l'ancre. Le contrôle de démarrage (selfTest) vérifie aussi qu'un bloc rendu null et une réponse de stockage mal formée
 * remontent en erreur, et que les lectures saines passent (contrôle positif).
 *
 * v2.1 quater (vérification du relais, 9/11 au soir : preuves r3-1a, r2, r1-B, r1-E, r1-G) — RPC MENTEUR : le relais LIE le
 * contenu de chaque en-tête à son hash (politique « arc », défaut : 21 champs d'en-tête d'Arc exigés, keccak256(RLP) = hash) ;
 * avec l'ancre, l'horodatage, la base fee, PREVRANDAO, le mineur du bloc N et BLOCKHASH(N − k) sont ceux de la vraie chaîne
 * (avant : un bloc N au bon hash mais à l'horodatage décalé faisait signer une réclamation fausse). Il ne suit plus les
 * redirections, lit les réponses en flux bornées, et refuse une même lecture rendue avec deux valeurs. Au démarrage, le
 * contrôle du moteur exige que le bloc N du RPC du fork passe ce contrat (sinon le format des en-têtes a changé : refus de
 * démarrer, plutôt que des rejeux tous en 503).
 */
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import {
  BaseError, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, keccak256, numberToHex, pad, parseAbi, toBytes,
  type Address, type Hex,
} from "viem";
import type { EvalContext, Clause } from "./predicate";
import { ReplayRuleError, ReplayUnavailableError, type ExploitBundle, type ForkRunner } from "./bounty";
import { ARC_USDC_SHIM_RUNTIME } from "../fork/arc-usdc-shim";
import {
  DEFAULT_MAX_FORK_REQUESTS, MAX_RESPONSE_BYTES, RELAY_TIMEOUT_MS, RelayViolation, UpstreamFailure, readBodyBounded, startStrictRelay,
  type HeaderPolicy, type StrictRelay,
} from "./rpc-relay";

export const ARC_USDC: Address = "0x3600000000000000000000000000000000000000";
/** Implémentation de l'USDC d'Arc testnet (si la trace, réussie, ne montre aucun DELEGATECALL). */
const ARC_USDC_IMPL_TESTNET: Address = "0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6";
const IMPL_SLOT = keccak256(toBytes("archive.fork.usdc.impl"));
export const MAX_TXS = 10;
export const MAX_TX_BYTES = 64 * 1024;
export const MAX_CODE_BYTES = 48 * 1024;
export const MAX_CAPITAL = 10n ** 15n;
export { DEFAULT_MAX_FORK_REQUESTS };
const TX_GAS = 15_000_000n;
/** Avance de gas du chasseur dans un fork arc-anvil (USDC, 6 décimales ; n'existe que dans le fork) : le nœud réserve
 *  gas × maxFee par transaction (15 M × 100 gwei = 1,5 USDC) ; 20 USDC couvrent les 11 transactions possibles. */
const GAS_ALLOWANCE_USDC6 = 20_000_000n;
const MAX_FEE_WEI = 100_000_000_000n; // 100 gwei : plafond (base fee d'Arc ≈ 20 gwei) ; le prix payé reste le base fee
/** Rejeux en attente au plus (file globale, partagée par /bounty/submit et /v1/refute) ; au-delà : 503, rien de signé. */
export const DEFAULT_MAX_QUEUED = 8;
/** Compte et cases sentinelles du contrôle du moteur au démarrage (selfTest) ; jamais lus par un rejeu. */
export const SELFTEST_ACCOUNT: Address = "0x5e1f7e5700000000000000000000000000005e1f";
export const SELFTEST_SLOT: Hex = keccak256(toBytes("archive.fork.selftest"));
const SELFTEST_SLOT_CALL: Hex = keccak256(toBytes("archive.fork.selftest.call"));
const SELFTEST_SLOT_TX: Hex = keccak256(toBytes("archive.fork.selftest.tx"));
/** v2.1 ter : case dont le RPC du fork (simulé) rend une réponse MAL FORMÉE (« 0x » au lieu de 32 octets). */
const SELFTEST_SLOT_MALFORMED: Hex = keccak256(toBytes("archive.fork.selftest.malformed"));
/** v2.1 ter : âge (sous N) du bloc que le RPC du fork (simulé) rend null au contrôle de démarrage. */
const SELFTEST_NULL_AGE = 2n;
/** Code du compte sentinelle : sans données, rend SLOAD(SLOT_CALL) ; avec données, SSTORE(1, SLOAD(SLOT_TX)). */
const SELFTEST_CODE = `0x3615602b577f${SELFTEST_SLOT_TX.slice(2)}54600155005b7f${SELFTEST_SLOT_CALL.slice(2)}5460005260206000f3` as Hex;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export const EXPLOIT_TX_PARAMS = [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
] as const;

/** Encode une transaction d'exploit au format attendu par le rejeu. */
export function encodeExploitTx(tx: { to: Address; value?: bigint; data: Hex }): Hex {
  return encodeAbiParameters(EXPLOIT_TX_PARAMS, [tx.to, tx.value ?? 0n, tx.data]);
}

/** Empreinte d'un exploit : son contenu (code d'attaque + transactions), indépendante du bloc N et du chasseur. */
export function exploitFingerprint(bundle: Pick<ExploitBundle, "txs" | "attackCode">): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32[]" }],
    [keccak256(bundle.attackCode ?? "0x"), bundle.txs.map((t) => keccak256(t))],
  ));
}

/** Code d'initialisation (eth_call sans destinataire) qui rend BLOCKHASH(n) sur 32 octets. */
function blockhashCallData(n: bigint): Hex {
  return `0x67${n.toString(16).padStart(16, "0")}4060005260206000f3` as Hex;
}

export interface AnvilForkOptions {
  /** RPC d'Arc à forker (lecture seule). */
  forkUrl: string;
  /** Binaire anvil (défaut : « anvil » dans le PATH). */
  anvilBin?: string;
  usdc?: Address;
  /** Délai maximal d'un rejeu (défaut 120 s). Dépassé : ReplayUnavailableError, rien n'est signé. */
  timeoutMs?: number;
  /** "arc" : binaire arc-anvil d'Arc Foundry (circlefin/arc-foundry), --network arc : les précompilés d'Arc (USDC natif,
   *  liste de blocage, journaux EIP-7708) tournent POUR DE VRAI, pas d'émulation ; le gas est payé au base fee d'Arc
   *  (non modifiable), sur une avance de gas donnée au chasseur et retirée du profit. "anvil" : anvil ordinaire +
   *  ArcUsdcShim (émulation de l'USDC d'Arc), gas à prix nul. Défaut : "arc" si le binaire s'appelle arc-anvil. */
  engine?: "arc" | "anvil";
  /** Rejeux en attente au plus (défaut DEFAULT_MAX_QUEUED). */
  maxQueued?: number;
  /** v2.1 ter : requêtes au RPC du fork par rejeu, relais compris (défaut DEFAULT_MAX_FORK_REQUESTS) ; au-delà : échec FERMÉ
   *  (ReplayUnavailableError « budget », 503), jamais « non prouvée » (le nombre de lectures dépend du moteur et de son
   *  cache : ce n'est pas une règle déterministe). */
  maxForkRequests?: number;
  /** v2.1 quater : contrat d'en-tête du relais strict (défaut « arc » : 21 champs d'en-tête d'Arc exigés, en-tête lié à son
   *  hash). « shape » : TESTS SEULEMENT (RPC du fork scripté à blocs synthétiques) : le contenu des en-têtes n'est plus lié
   *  à l'ancre (preuve r3-1a). */
  headerPolicy?: HeaderPolicy;
  /** 10/11 : RPC des PREUVES D'ÉTAT (eth_getProof au bloc N ; notre nœud d'Arc ou tout autre, non de confiance). Présent :
   *  chaque lecture d'état du rejeu est prouvée contre le stateRoot de l'en-tête N ancré (relais strict, option stateProofs) ;
   *  une preuve fausse fait échouer le rejeu (rien n'est signé), une preuve indisponible aussi (échec fermé). */
  stateProofsUrl?: string;
  /** Journal (défaut : console). Jamais de contenu de l'exploit (ni transactions, ni nombre de transactions). */
  log?: (msg: string) => void;
}

/** Un rejeu à la fois : chaque rejeu lance son propre anvil (mémoire, RPC), on les met en file. */
let queue: Promise<unknown> = Promise.resolve();
let queued = 0;

/** v2.1 ter : une violation du relais strict → ReplayUnavailableError (message fixe ; la violation en cause). */
export function relayFailure(v: RelayViolation, phase: "anchor" | "replay" = "replay"): ReplayUnavailableError {
  if (v.kind === "budget") {
    return new ReplayUnavailableError("budget", "rejeu : budget de lectures du RPC du fork dépassé : rien n'est signé", { cause: v });
  }
  if (phase === "anchor" && (v.kind === "chain" || v.kind === "null_block" || v.kind === "shape" || v.kind === "header")) {
    return new ReplayUnavailableError("anchor", "le RPC du fork ne sert pas le bloc N de la réclamation (hash différent ou absent) : rien n'est signé", { cause: v });
  }
  return new ReplayUnavailableError("relay", "réponse du RPC du fork refusée par le relais strict : rien n'est signé", { cause: v });
}

/** Les appels au moteur, gardés par le relais : une violation (même absorbée par le moteur) fait échouer l'appel. */
function guarded(rpc: Rpc, relay: StrictRelay): Rpc {
  return async (method, params) => {
    let out: unknown;
    try {
      out = await rpc(method, params);
    } catch (e) {
      if (relay.violation) throw relayFailure(relay.violation);
      throw e;
    }
    if (relay.violation) throw relayFailure(relay.violation);
    return out;
  };
}

export class AnvilForkRunner implements ForkRunner {
  private usdc: Address;
  private bin: string;
  private log: (msg: string) => void;
  constructor(private o: AnvilForkOptions) {
    this.usdc = (o.usdc ?? ARC_USDC).toLowerCase() as Address;
    this.bin = o.anvilBin ?? "anvil";
    this.log = o.log ?? ((m) => console.log(m));
    this.engine = o.engine ?? (/arc-anvil$/.test(this.bin) ? "arc" : "anvil");
  }
  readonly engine: "arc" | "anvil";

  /** v2.1 : les règles déterministes du rejeu sur un bundle (sans rien rejouer) ; lève ReplayRuleError si refusé. */
  validate(bundle: ExploitBundle): void {
    validateBundle(bundle);
  }

  run(input: { blockN: bigint; bundle: ExploitBundle; expectedBlockHash?: Hex }): Promise<{ ctx: EvalContext; fingerprint: Hex }> {
    if (queued >= (this.o.maxQueued ?? DEFAULT_MAX_QUEUED)) {
      return Promise.reject(new ReplayUnavailableError("busy", "file de rejeu pleine : réessayer plus tard (rien n'est signé)"));
    }
    queued++;
    const job = queue.then(() => this.runOnce(input)).finally(() => {
      queued--;
    });
    queue = job.catch(() => undefined);
    return job;
  }

  private async runOnce(input: { blockN: bigint; bundle: ExploitBundle; expectedBlockHash?: Hex }): Promise<{ ctx: EvalContext; fingerprint: Hex }> {
    validateBundle(input.bundle); // ReplayRuleError : règle déterministe
    try {
      return await this.replay(input);
    } catch (e) {
      if (e instanceof ReplayRuleError || e instanceof ReplayUnavailableError) throw e;
      // tout le reste est une panne : jamais une mesure, jamais une signature. v2.1 ter : une panne du moteur ou de son
      // transport est un échec du rejeu (« rpc », ralenti) ; toute autre exception (environnement, inattendue) : 503 sans
      // rien mémoriser (« internal »)
      this.log(`rejeu au bloc ${input.blockN} : échec (${describeFailure(e)}) — rien n'est signé`);
      throw new ReplayUnavailableError(isTransportFailure(e) ? "rpc" : "internal", "rejeu impossible (RPC du fork ou moteur en erreur) : rien n'est signé", { cause: e });
    }
  }

  private async replay({ blockN, bundle, expectedBlockHash }: { blockN: bigint; bundle: ExploitBundle; expectedBlockHash?: Hex }): Promise<{ ctx: EvalContext; fingerprint: Hex }> {
    // v2.1 ter : le moteur ne parle qu'au relais strict (un par rejeu : son budget, son ancre, son verrou de violation)
    const relay = await startStrictRelay({
      upstream: this.o.forkUrl, blockN, anchorHash: expectedBlockHash, maxRequests: this.o.maxForkRequests, timeoutMs: RELAY_TIMEOUT_MS, failFast: true,
      headerPolicy: this.o.headerPolicy,
      ...(this.o.stateProofsUrl ? { stateProofs: { upstream: this.o.stateProofsUrl } } : {}),
      ...(this.engine === "arc" ? { expectedChainId: 5042002 } : {}), // 11/11 : CHAINID du rejeu pinné (Arc), pas celui d'un RPC menteur
    });
    let fork: Awaited<ReturnType<AnvilForkRunner["spawnFork"]>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // 0. le RPC du fork sert-il la chaîne de la réclamation ? hash du bloc N lu par le relais (forme contrôlée), comparé à
      //    l'ancre (vérifiée par le quorum pour une réclamation, par EIP-2935 on-chain pour une réclamation acceptée)
      if (expectedBlockHash !== undefined) {
        try {
          await relay.anchor();
        } catch (e) {
          if (e instanceof RelayViolation) throw relayFailure(e, "anchor");
          if (e instanceof UpstreamFailure) throw new ReplayUnavailableError("rpc", "RPC du fork en erreur (bloc N) : rien n'est signé", { cause: e });
          throw e;
        }
      }
      const arc = this.engine === "arc";
      fork = await this.spawnFork(relay.url, blockN);
      const { alive, stop, stderr } = fork;
      const rpc = guarded(fork.rpc, relay);
      const timeoutMs = this.o.timeoutMs ?? 120_000;
      const deadline = Date.now() + timeoutMs;
      timer = setTimeout(stop, timeoutMs + 5_000);
      await waitReady(rpc, alive, stderr, () => {
        if (relay.violation) throw relayFailure(relay.violation);
      });
      const head = BigInt(await rpc("eth_blockNumber", []) as string);
      if (head !== blockN) throw new ReplayUnavailableError("rpc", "fork au mauvais bloc : rien n'est signé");
      const blockAtN = (await rpc("eth_getBlockByNumber", [numberToHex(blockN), false])) as any;
      if (!blockAtN || typeof blockAtN.timestamp !== "string" || typeof blockAtN.hash !== "string") {
        throw new ReplayUnavailableError("rpc", "bloc N illisible dans le fork : rien n'est signé");
      }
      // v2.1 ter : le bloc N tel que le MOTEUR l'a chargé (heure, base fee…) est bien celui de l'ancre
      if (expectedBlockHash !== undefined && blockAtN.hash.toLowerCase() !== expectedBlockHash.toLowerCase()) {
        throw new ReplayUnavailableError("anchor", "le moteur n'a pas chargé le bloc N de la réclamation (hash différent) : rien n'est signé");
      }
      const tsN = BigInt(blockAtN.timestamp);

      // 1. l'USDC d'Arc : natif avec arc-anvil (vrais précompilés) ; émulé dans le fork seulement avec anvil ordinaire
      if (!arc) {
        const impl = await this.usdcImplementation(rpc);
        await rpc("anvil_setCode", [this.usdc, ARC_USDC_SHIM_RUNTIME]);
        await rpc("anvil_setStorageAt", [this.usdc, IMPL_SLOT, pad(impl, { size: 32 })]);
      }

      // 2. le capital déclaré devient le solde natif du chasseur ; avec arc-anvil, plus une avance de gas fixe (le base fee
      //    d'Arc n'est pas modifiable), retirée ensuite du profit : le profit mesuré est net de gas, comme sur la vraie chaîne
      const payee = bundle.payee.toLowerCase() as Address;
      const allowance = arc ? GAS_ALLOWANCE_USDC6 : 0n;
      await rpc("anvil_setBalance", [payee, numberToHex((bundle.capital + allowance) * 10n ** 12n)]);

      // 3. mesures avant
      const reads = plannedReads(bundle.predicate.clauses, payee, this.usdc);
      const before = await this.measure(rpc, reads);

      // 4. l'exploit : code d'attaque éventuel, puis les transactions, depuis le chasseur, horodatages épinglés
      let t = tsN;
      const send = async (tx: { to?: Address; value: bigint; data: Hex }) => {
        if (Date.now() > deadline) throw new ReplayUnavailableError("timeout", "rejeu trop long : rien n'est signé");
        t += 1n;
        await rpc("evm_setNextBlockTimestamp", [numberToHex(t)]);
        const hash = await rpc("eth_sendTransaction", [{
          from: payee, ...(tx.to ? { to: tx.to } : {}), value: numberToHex(tx.value), data: tx.data, gas: numberToHex(TX_GAS),
          // arc-anvil : EIP-1559 sans pourboire → prix payé = base fee d'Arc, déterministe d'une enclave à l'autre
          ...(arc ? { type: "0x2", maxFeePerGas: numberToHex(MAX_FEE_WEI), maxPriorityFeePerGas: "0x0" } : { gasPrice: "0x0", type: "0x0" }),
        }]) as Hex;
        // anvil répond avant d'avoir miné : on attend le reçu (sinon la mesure « après » dépendrait du hasard) ; une panne
        // du RPC du fork pendant la transaction la laisse non minée : échec fermé
        for (let i = 0; i < 200; i++) {
          const r = await rpc("eth_getTransactionReceipt", [hash]) as any;
          if (r) return r.status === "0x1";
          await new Promise((res) => setTimeout(res, 50));
        }
        throw new ReplayUnavailableError("rpc", "transaction du rejeu jamais minée : rien n'est signé");
      };
      if (bundle.attackCode && bundle.attackCode !== "0x") await send({ value: 0n, data: bundle.attackCode });
      for (const raw of bundle.txs) {
        const [to, value, data] = decodeAbiParameters(EXPLOIT_TX_PARAMS, raw);
        await send({ to, value, data });
      }

      // 5. mesures après
      const after = await this.measure(rpc, reads);
      // un rejeu qui a dépassé son délai, ou dont anvil a été arrêté, ne vaut rien (même complet) : échec fermé
      if (Date.now() > deadline) throw new ReplayUnavailableError("timeout", "rejeu trop long : rien n'est signé");
      if (!alive()) throw new ReplayUnavailableError("process", "anvil arrêté pendant le rejeu : rien n'est signé");
      // v2.1 ter : une seule réponse invalide du RPC du fork pendant tout le rejeu (même absorbée par le moteur) : rien n'est signé
      if (relay.violation) throw relayFailure(relay.violation);
      this.log(`rejeu au bloc ${blockN} (${arc ? "arc-anvil, précompilés d'Arc natifs" : "anvil + émulation de l'USDC"}) : terminé`);
      return { ctx: buildContext(before, after, bundle.capital + allowance, payee, this.usdc), fingerprint: exploitFingerprint(bundle) };
    } finally {
      if (timer) clearTimeout(timer);
      fork?.stop();
      await relay.close();
    }
  }

  /**
   * v2.1 bis : CONTRÔLE DU MOTEUR, à faire au démarrage (le binaire de l'image, arc-anvil, n'a pas été testé hors d'elle).
   * Chaîne : moteur → relais strict → mandataire de pannes → RPC du fork. Le mandataire REFUSE trois lectures de stockage d'un
   * compte sentinelle ; le moteur doit :
   *  1. rendre en ERREUR une lecture directe (eth_getStorageAt) ;
   *  2. rendre en ERREUR, et pas en revert (code 3), un eth_call dont l'exécution lit la case refusée ;
   *  3. ne JAMAIS miner une transaction dont l'exécution lit la case refusée (le rejeu l'attend, puis échoue fermé).
   * v2.1 ter : le mandataire rend aussi des réponses INVALIDES que le moteur prenait pour des valeurs (preuves e1, matrices) ;
   * le relais doit les refuser et le moteur les rendre en ERREUR :
   *  4. une case de stockage rendue « 0x » (pas 32 octets) : lecture directe ;
   *  5. un bloc récent rendu null : BLOCKHASH de ce bloc (eth_call) ;
   *  6. contrôle POSITIF : BLOCKHASH(N − 1) et le solde du mineur du bloc N, lus par le moteur, sont ceux du RPC du fork (le
   *     relais laisse passer les réponses saines ; sinon tout rejeu échouerait).
   * Une lecture refusée rendue comme une valeur, un revert ou une transaction minée = le moteur avale les pannes du RPC du
   * fork : tout rejeu pourrait être faux sans que rien ne le dise → lève (le service refuse de démarrer). Si une lecture
   * n'atteint pas le mandataire (cache du moteur), le point est « non concluant » (journal), sauf les lectures directes,
   * exigées. Rend aussi le code JSON-RPC d'un revert (attendu : 3). Tests : `simulateSwallow` (le mandataire rend une fausse
   * valeur bien formée pour les cases 1–3), `simulateLaxRelay` (relais transparent : les points 4 et 5 doivent échouer).
   */
  async selfTest(o: { simulateSwallow?: boolean; simulateLaxRelay?: boolean } = {}): Promise<{ blockN: bigint; revertCode: number | undefined; checks: string[] }> {
    const head = BigInt((await jsonRpc(this.o.forkUrl, RELAY_TIMEOUT_MS)("eth_blockNumber", [])) as string);
    const blockN = head > 2n ? head - 2n : head;
    const nullBlock = blockN > SELFTEST_NULL_AGE ? blockN - SELFTEST_NULL_AGE : undefined;
    const refused = [SELFTEST_SLOT, SELFTEST_SLOT_CALL, SELFTEST_SLOT_TX].map((x) => BigInt(x));
    const malformed = BigInt(SELFTEST_SLOT_MALFORMED);
    const seen = new Set<string>();
    const proxy = await faultProxy(this.o.forkUrl, (q) => {
      if (q?.method === "eth_getStorageAt" && String(q.params?.[0]).toLowerCase() === SELFTEST_ACCOUNT.toLowerCase() && typeof q.params?.[1] === "string") {
        const slot = BigInt(q.params[1]);
        if (refused.includes(slot)) {
          seen.add(`slot:${slot}`);
          return o.simulateSwallow
            ? { result: pad("0x2a", { size: 32 }) }
            : { error: { code: -32000, message: "missing trie node (contrôle du moteur)" } };
        }
        if (slot === malformed) {
          seen.add("malformed");
          return { result: "0x" };
        }
      }
      if (nullBlock !== undefined && q?.method === "eth_getBlockByNumber" && typeof q.params?.[0] === "string" && BigInt(q.params[0]) === nullBlock) {
        seen.add("null");
        return { result: null };
      }
      return undefined;
    });
    const relay = await startStrictRelay({
      upstream: proxy.url, blockN, maxRequests: this.o.maxForkRequests, timeoutMs: RELAY_TIMEOUT_MS, failFast: false, checks: !o.simulateLaxRelay,
      headerPolicy: this.o.headerPolicy,
    });
    let fork: Awaited<ReturnType<AnvilForkRunner["spawnFork"]>> | undefined;
    const swallowed = (what: string) =>
      new Error(`contrôle du moteur : ${what} — le moteur avale les pannes du RPC du fork, tout rejeu pourrait être faux : refus de démarrer`);
    const kinds = () => new Set(relay.violations.map((v) => v.kind));
    const checks: string[] = [];
    try {
      // v2.1 quater : le bloc N du RPC du fork passe-t-il le contrat d'en-tête du relais (politique « arc » : 21 champs
      // d'en-tête d'Arc, keccak256(RLP(en-tête)) = hash) ? Sinon le format des en-têtes a changé (nouveau champ ?) : tout
      // rejeu échouerait fermé (503) ; on le dit tout de suite, avec la raison, et on refuse de démarrer
      if (!o.simulateLaxRelay) {
        try {
          await relay.call("eth_getBlockByNumber", [numberToHex(blockN), false]);
        } catch (e) {
          if (!(e instanceof RelayViolation)) throw e;
          const why = e.kind === "header" || e.kind === "shape" ? " : format d'en-tête inattendu (nouveau champ ?)" : "";
          throw new Error(`contrôle du moteur : le bloc N du RPC du fork est refusé par le relais strict (${e.kind}${why}) : tout rejeu échouerait fermé : refus de démarrer`, { cause: e });
        }
      }
      fork = await this.spawnFork(relay.url, blockN);
      const { rpc, alive } = fork;
      await waitReady(rpc, alive, () => "");
      // 1. lecture directe (exigée)
      let ok1 = false;
      try {
        await rpc("eth_getStorageAt", [SELFTEST_ACCOUNT, SELFTEST_SLOT, "latest"]);
      } catch (e) {
        ok1 = !isEvmRevert(e);
      }
      if (!seen.has(`slot:${BigInt(SELFTEST_SLOT)}`)) throw new Error("contrôle du moteur : la lecture sentinelle n'a pas atteint le RPC du fork (cache inattendu) : refus de démarrer");
      if (!ok1) throw swallowed("une lecture REFUSÉE par le RPC du fork est rendue comme une valeur");
      checks.push("lecture directe : erreur");

      // 4. et 5. (v2.1 ter) : réponses invalides du RPC du fork ; tous les cas avalés sont dits ensemble
      const bad: string[] = [];
      let ok4 = false;
      try {
        await rpc("eth_getStorageAt", [SELFTEST_ACCOUNT, SELFTEST_SLOT_MALFORMED, "latest"]);
      } catch (e) {
        ok4 = !isEvmRevert(e);
      }
      if (!seen.has("malformed")) throw new Error("contrôle du moteur : la lecture « mal formée » n'a pas atteint le RPC du fork (cache inattendu) : refus de démarrer");
      if (!ok4) bad.push("une case de stockage MAL FORMÉE (« 0x ») est rendue comme une valeur");
      else if (!o.simulateLaxRelay && !kinds().has("shape")) throw new Error("contrôle du moteur : le relais strict n'a pas refusé une case de stockage mal formée : refus de démarrer");
      let nullChecked = false;
      if (nullBlock !== undefined) {
        let ok5 = false;
        try {
          await rpc("eth_call", [{ data: blockhashCallData(nullBlock) }, "latest"]);
        } catch (e) {
          ok5 = !isEvmRevert(e);
        }
        if (seen.has("null")) {
          nullChecked = true;
          if (!ok5) bad.push("un bloc rendu NULL par le RPC du fork donne un BLOCKHASH (keccak256(\"\") ou zéro) au lieu d'une erreur");
          else if (!o.simulateLaxRelay && !kinds().has("null_block")) throw new Error("contrôle du moteur : le relais strict n'a pas refusé un bloc rendu null : refus de démarrer");
        }
      }
      if (bad.length > 0) throw swallowed(bad.join(" ; "));
      checks.push("stockage mal formé : erreur (relais)");
      checks.push(nullChecked ? "bloc rendu null : erreur (relais)" : "bloc rendu null : non concluant (lecture non transmise)");

      // 6. contrôle POSITIF : des lectures saines passent le relais et donnent les valeurs du RPC du fork
      if (blockN > 0n) {
        const prev = await relay.call("eth_getBlockByNumber", [numberToHex(blockN - 1n), false]) as { hash: string };
        const word = await rpc("eth_call", [{ data: blockhashCallData(blockN - 1n) }, "latest"]);
        if (typeof word !== "string" || word.toLowerCase() !== prev.hash.toLowerCase()) {
          throw new Error("contrôle du moteur : BLOCKHASH(N − 1) lu par le moteur n'est pas celui du RPC du fork : refus de démarrer");
        }
      }
      const atN = await relay.call("eth_getBlockByNumber", [numberToHex(blockN), false]) as { miner: Address };
      const [viaEngine, direct] = [await rpc("eth_getBalance", [atN.miner, "latest"]), await relay.call("eth_getBalance", [atN.miner, numberToHex(blockN)])];
      if (typeof viaEngine !== "string" || typeof direct !== "string" || BigInt(viaEngine) !== BigInt(direct)) {
        throw new Error("contrôle du moteur : un solde lu par le moteur n'est pas celui du RPC du fork : refus de démarrer");
      }
      checks.push("contrôle positif : BLOCKHASH et solde identiques au RPC du fork");

      // 2. et 3. : le code du compte sentinelle lit une case refusée (vue : SLOT_CALL ; transaction : SLOT_TX)
      await rpc("anvil_setCode", [SELFTEST_ACCOUNT, SELFTEST_CODE]);
      let ok2: boolean;
      try {
        await rpc("eth_call", [{ to: SELFTEST_ACCOUNT, data: "0x" }, "latest"]);
        ok2 = false;
      } catch (e) {
        ok2 = !isEvmRevert(e);
      }
      if (seen.has(`slot:${BigInt(SELFTEST_SLOT_CALL)}`)) {
        if (!ok2) throw swallowed("un eth_call dont une lecture est REFUSÉE rend une valeur ou un revert");
        checks.push("exécution (eth_call) : erreur");
      } else checks.push("exécution (eth_call) : non concluant (lecture non transmise)");

      const arc = this.engine === "arc";
      const sender = "0x000000000000000000000000000000000005e1f7" as Address;
      await rpc("anvil_setBalance", [sender, numberToHex(GAS_ALLOWANCE_USDC6 * 10n ** 12n)]);
      const hash = await rpc("eth_sendTransaction", [{
        from: sender, to: SELFTEST_ACCOUNT, value: "0x0", data: "0x01", gas: numberToHex(TX_GAS),
        ...(arc ? { type: "0x2", maxFeePerGas: numberToHex(MAX_FEE_WEI), maxPriorityFeePerGas: "0x0" } : { gasPrice: "0x0", type: "0x0" }),
      }]);
      let mined = false;
      for (let i = 0; i < 40 && !mined; i++) {
        mined = !!(await rpc("eth_getTransactionReceipt", [hash]));
        if (!mined) await new Promise((r) => setTimeout(r, 50));
      }
      if (seen.has(`slot:${BigInt(SELFTEST_SLOT_TX)}`)) {
        if (mined) throw swallowed("une transaction dont une lecture est REFUSÉE est minée quand même");
        checks.push("transaction : jamais minée");
      } else checks.push("transaction : non concluant (lecture non transmise)");

      let revertCode: number | undefined;
      try {
        await rpc("eth_call", [{ data: "0x60006000fd" }, "latest"]); // création dont le code d'initialisation fait REVERT(0, 0)
      } catch (e) {
        revertCode = e instanceof RpcCallError ? e.code : undefined;
      }
      return { blockN, revertCode, checks };
    } finally {
      fork?.stop();
      await relay.close();
      await proxy.close();
    }
  }

  /** Lance un anvil forké (mêmes options que le rejeu). `forkUrl` : le relais strict. */
  private async spawnFork(forkUrl: string, blockN: bigint): Promise<{ rpc: Rpc; alive: () => boolean; stop: () => void; stderr: () => string }> {
    const port = await freePort();
    const arc = this.engine === "arc";
    const proc = spawn(this.bin, [
      ...(arc ? ["--network", "arc"] : ["--base-fee", "0", "--gas-price", "0"]),
      "--fork-url", forkUrl, "--fork-block-number", blockN.toString(), "--port", String(port), "--host", "127.0.0.1",
      "--auto-impersonate", "--no-storage-caching",
      "--retries", "8", "--fork-retry-backoff", "800", "--timeout", "45000", "--silent",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr = (stderr + String(d)).slice(-2000); });
    let spawnFailed = false;
    proc.on("error", () => { spawnFailed = true; }); // binaire absent : waitReady échoue fermé (sans planter le processus)
    return {
      rpc: jsonRpc(`http://127.0.0.1:${port}`),
      alive: () => !spawnFailed && proc.exitCode === null && proc.signalCode === null,
      stop: () => { proc.kill("SIGKILL"); },
      stderr: () => stderr,
    };
  }

  /** L'implémentation derrière le proxy USDC, lue par trace (callTracer) ; trace réussie sans DELEGATECALL : l'adresse
   *  connue du testnet. Une trace en ERREUR échoue fermée (avant : repli silencieux, qui pouvait différer d'une enclave à
   *  l'autre). Moteur « anvil » seulement. */
  private async usdcImplementation(rpc: Rpc): Promise<Address> {
    const tr = await rpc("debug_traceCall", [
      { to: this.usdc, data: encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [this.usdc] }) },
      "latest", { tracer: "callTracer" },
    ]) as any;
    const call = (tr?.calls ?? []).find((c: any) => String(c.type).toUpperCase() === "DELEGATECALL");
    if (call?.to) return call.to as Address;
    return ARC_USDC_IMPL_TESTNET;
  }

  /**
   * Les lectures du prédicat. Une erreur de transport, de RPC du fork, de nœud ou de délai n'est JAMAIS une valeur :
   * elle lève (ReplayUnavailableError, plus haut). Seul un revert EVM (code 3) d'une lecture de vue ou d'invariant donne
   * la valeur de la règle v0 (vue = 0, invariant non tenu) — et seulement si le relais n'a vu aucune violation (guarded).
   */
  private async measure(rpc: Rpc, reads: Read[]): Promise<Map<string, bigint | boolean>> {
    const out = new Map<string, bigint | boolean>();
    for (const r of reads) {
      if (r.kind === "erc20") {
        const v = await rpc("eth_call", [{ to: r.token, data: encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [r.holder] }) }, "latest"]);
        out.set(r.key, quantity(v, "solde ERC-20"));
      } else if (r.kind === "native") {
        out.set(r.key, quantity(await rpc("eth_getBalance", [r.holder, "latest"]), "solde natif"));
      } else {
        let v: unknown;
        try {
          v = await rpc("eth_call", [{ to: r.target, data: r.call }, "latest"]);
        } catch (e) {
          if (!isEvmRevert(e)) throw e; // panne, arrêt exceptionnel, délai, violation du relais : échec fermé
          out.set(r.key, r.kind === "view" ? 0n : false); // revert DÉTERMINISTE : règle v0 (vue nulle, invariant non tenu)
          continue;
        }
        if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) throw new ReplayUnavailableError("rpc", "réponse d'eth_call illisible : rien n'est signé");
        const word = v.length >= 66 ? BigInt(v.slice(0, 66)) : 0n;
        out.set(r.key, r.kind === "view" ? word : word !== 0n);
      }
    }
    return out;
  }
}

/** Une quantité JSON-RPC (0x…) ; toute autre réponse (dont « 0x » d'un compte sans code) échoue fermée, comme avant. */
function quantity(v: unknown, what: string): bigint {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]+$/.test(v)) throw new ReplayUnavailableError("rpc", `${what} illisible : rien n'est signé`);
  return BigInt(v);
}

// ---------- lectures planifiées à partir du prédicat ----------

type Read =
  | { kind: "erc20"; key: string; token: Address; holder: Address }
  | { kind: "native"; key: string; holder: Address }
  | { kind: "view" | "invariant"; key: string; target: Address; call: Hex };

const kErc20 = (token: string, holder: string) => `erc20:${token.toLowerCase()}:${holder.toLowerCase()}`;
const kNative = (holder: string) => `native:${holder.toLowerCase()}`;
const kCall = (kind: string, target: string, call: string) => `${kind}:${target.toLowerCase()}:${call.toLowerCase()}`;

function plannedReads(clauses: Clause[], payee: Address, usdc: Address): Read[] {
  const m = new Map<string, Read>();
  // le solde USDC du chasseur est toujours mesuré (profit affiché dans le journal et pour ATTACKER_PROFIT)
  m.set(kErc20(usdc, payee), { kind: "erc20", key: kErc20(usdc, payee), token: usdc, holder: payee });
  for (const c of clauses) {
    if (c.type === "ERC20_DROP") m.set(kErc20(c.token, c.holder), { kind: "erc20", key: kErc20(c.token, c.holder), token: c.token, holder: c.holder });
    else if (c.type === "NATIVE_DROP") m.set(kNative(c.holder), { kind: "native", key: kNative(c.holder), holder: c.holder });
    else if (c.type === "ATTACKER_PROFIT") {
      const tok = c.token.toLowerCase() === usdc ? usdc : c.token;
      m.set(kErc20(tok, payee), { kind: "erc20", key: kErc20(tok, payee), token: tok as Address, holder: payee });
    } else if (c.type === "VIEW_CHANGED") m.set(kCall("view", c.target, c.call), { kind: "view", key: kCall("view", c.target, c.call), target: c.target, call: c.call });
    else if (c.type === "INVARIANT_BROKEN") m.set(kCall("invariant", c.target, c.call), { kind: "invariant", key: kCall("invariant", c.target, c.call), target: c.target, call: c.call });
  }
  return [...m.values()];
}

function buildContext(before: Map<string, bigint | boolean>, after: Map<string, bigint | boolean>, capital: bigint, payee: Address, usdc: Address): EvalContext {
  const big = (m: Map<string, bigint | boolean>, k: string) => (typeof m.get(k) === "bigint" ? (m.get(k) as bigint) : 0n);
  return {
    erc20Drop: (token, holder) => big(before, kErc20(token, holder)) - big(after, kErc20(token, holder)),
    nativeDrop: (holder) => big(before, kNative(holder)) - big(after, kNative(holder)),
    // USDC : solde final − capital déclaré (le capital est le seul solde injecté) ; autre jeton : final − initial
    attackerProfit: (token) => token.toLowerCase() === usdc
      ? big(after, kErc20(usdc, payee)) - capital
      : big(after, kErc20(token, payee)) - big(before, kErc20(token, payee)),
    viewValue: (target, call, when) => big(when === "before" ? before : after, kCall("view", target, call)),
    invariantHeld: (target, call, when) => (when === "before" ? before : after).get(kCall("invariant", target, call)) === true,
  };
}

/**
 * Les règles DÉTERMINISTES du rejeu (inchangées depuis la v2 ; messages fixes depuis la v2.1 bis : jamais le contenu de
 * l'exploit, ni un message de viem) : 1 à MAX_TXS transactions, chacune de l'hexadécimal d'au plus MAX_TX_BYTES octets au
 * format abi.encode(address, uint256, bytes) ; code d'attaque d'au plus MAX_CODE_BYTES octets ; capital dans [0, 10^15].
 */
function validateBundle(b: ExploitBundle) {
  if (!Array.isArray(b.txs) || b.txs.length === 0) throw new ReplayRuleError("txs_empty", "exploit vide : au moins une transaction");
  if (b.txs.length > MAX_TXS) throw new ReplayRuleError("txs_count", `au plus ${MAX_TXS} transactions`);
  for (const t of b.txs) {
    if (typeof t !== "string" || !/^0x[0-9a-fA-F]*$/.test(t) || (t.length - 2) / 2 > MAX_TX_BYTES) {
      throw new ReplayRuleError("tx_size", `transaction mal formée ou de plus de ${MAX_TX_BYTES} octets`);
    }
    try {
      decodeAbiParameters(EXPLOIT_TX_PARAMS, t);
    } catch (e) {
      // seules les erreurs de décodage de viem (déterministes : mêmes octets, même verdict) sont la règle ; toute autre
      // exception (pile, mémoire) n'en est pas une et remonte (503, rien de signé)
      if (!(e instanceof BaseError)) throw e;
      throw new ReplayRuleError("tx_format", "transaction qui n'est pas abi.encode(address to, uint256 value, bytes data)");
    }
  }
  if (b.attackCode && (b.attackCode.length - 2) / 2 > MAX_CODE_BYTES) throw new ReplayRuleError("code_size", `code d'attaque de plus de ${MAX_CODE_BYTES} octets`);
  if (typeof b.capital !== "bigint" || b.capital < 0n || b.capital > MAX_CAPITAL) throw new ReplayRuleError("capital", "capital hors bornes [0, 10^15]");
}

// ---------- plomberie ----------

type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

/** Erreur JSON-RPC (le nœud a répondu une erreur) ou de transport (HTTP, JSON illisible). */
export class RpcCallError extends Error {
  constructor(readonly method: string, readonly code: number | undefined, readonly rpcMessage: string) {
    super(`${method} : erreur JSON-RPC${code === undefined ? "" : ` ${code}`}`);
    this.name = "RpcCallError";
  }
}

/** Revert DÉTERMINISTE de l'EVM : code 3 « execution reverted » (EIP-1474). Rien d'autre (ni -32603, ni -32000). */
export function isEvmRevert(e: unknown): boolean {
  return e instanceof RpcCallError && e.code === 3 && /^execution reverted/.test(e.rpcMessage);
}

function jsonRpc(url: string, timeoutMs?: number): Rpc {
  let id = 0;
  return async (method, params) => {
    const res = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      redirect: "error", // v2.1 quater : jamais suivie (lecture de la tête du RPC du fork au contrôle de démarrage, moteur local)
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    if (!res.ok) throw new RpcCallError(method, undefined, `HTTP ${res.status}`);
    let j: { result?: unknown; error?: { code?: unknown; message?: unknown } };
    try {
      j = (await res.json()) as typeof j;
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e; // v2.1 ter : corps coupé (TypeError) ou environnement : remonte tel quel
      throw new RpcCallError(method, undefined, "réponse non JSON");
    }
    if (j.error) throw new RpcCallError(method, typeof j.error.code === "number" ? j.error.code : undefined, String(j.error.message ?? ""));
    return j.result;
  };
}

/** v2.1 ter : panne du moteur ou de son transport (erreur JSON-RPC ou HTTP du moteur, fetch impossible ou coupé, délai). */
function isTransportFailure(e: unknown): boolean {
  if (e instanceof RpcCallError) return true;
  if (e instanceof TypeError && (e.message === "fetch failed" || e.message === "terminated")) return true;
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

/** Pour le journal : la méthode et le code d'une erreur, jamais son message (qui peut recopier des octets de l'exploit). */
function describeFailure(e: unknown): string {
  if (e instanceof RpcCallError) return `${e.method}${e.code === undefined ? "" : `, code ${e.code}`}`;
  return e instanceof Error ? e.name : "erreur";
}

/** Attend que le moteur réponde ; `check` (v2.1 ter) lève si le relais a déjà vu une violation (échec fermé immédiat). */
async function waitReady(rpc: Rpc, alive: () => boolean, err: () => string, check: () => void = () => {}) {
  const t0 = Date.now();
  for (;;) {
    check();
    if (!alive()) {
      throw new ReplayUnavailableError("process", `anvil s'est arrêté au démarrage : rien n'est signé`, { cause: new Error(err().slice(-300)) });
    }
    try {
      await rpc("eth_chainId", []);
      return;
    } catch (e) {
      if (e instanceof ReplayUnavailableError) throw e; // violation du relais (rpc gardé) : inutile d'attendre
      /* pas encore prêt */
    }
    if (Date.now() - t0 > 30_000) throw new ReplayUnavailableError("process", "anvil n'a pas démarré en 30 s : rien n'est signé");
    await new Promise((r) => setTimeout(r, 250));
  }
}

type Fault = { error: { code: number; message: string } } | { result: unknown };

/**
 * Mandataire JSON-RPC local devant `target` (contrôle de démarrage) : relaie tout, sauf les requêtes pour lesquelles
 * `fault(q)` rend une panne — erreur JSON-RPC, ou résultat forgé (fausse valeur, réponse mal formée, null). Lots compris.
 */
async function faultProxy(target: string, fault: (q: any) => Fault | undefined) {
  const one = async (q: any): Promise<unknown> => {
    const f = fault(q);
    if (f) return "error" in f ? { jsonrpc: "2.0", id: q.id, error: f.error } : { jsonrpc: "2.0", id: q.id, result: f.result };
    // v2.1 quater : comme le relais strict : aucune redirection suivie, réponse lue en flux bornée (sinon : 502)
    const r = await fetch(target, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(q), redirect: "error", signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    const text = await readBodyBounded(r, MAX_RESPONSE_BYTES);
    if (text === undefined) throw new Error("réponse du RPC du fork trop grosse");
    return JSON.parse(text);
  };
  const server = createHttpServer((rq, rs) => {
    let body = "";
    rq.on("data", (d) => { body += d; });
    rq.on("end", async () => {
      try {
        const j = JSON.parse(body);
        const out = Array.isArray(j) ? await Promise.all(j.map(one)) : await one(j);
        rs.writeHead(200, { "content-type": "application/json" });
        rs.end(JSON.stringify(out));
      } catch {
        rs.writeHead(502);
        rs.end();
      }
    });
  });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => (typeof a === "object" && a ? resolve(a.port) : reject(new Error("port"))));
    });
  });
}
