/**
 * bounty.ts — service de la Prime scellée (O3), v2.
 *
 * Flux : ouvre `cE` (bundle d'exploit chiffré vers l'enclave) -> recalcule `cP` (chiffré vers le
 * protocole, reproductible) -> lit la prime on-chain et vérifie le prédicat -> fixe le bloc N et
 * l'échéance -> rejoue le bundle dans un fork neuf -> évalue le prédicat avant/après -> calcule perte,
 * palier, empreinte -> signe la réclamation EIP-712 -> efface tout. Rien ne sort en clair.
 *
 * v2 :
 *  - PRIMES À k ENCLAVES : le chasseur peut fixer lui-même `blockN` et `deadline` dans le bundle
 *    chiffré, pour que k enclaves signent la MÊME réclamation (SealedBounty.claim exige k signatures
 *    sur un même digest au-delà de singleCap). Bornes : blockN dans [tête − 256, tête − 2], échéance
 *    dans ]maintenant, maintenant + 10 min]. Absents : N = tête − 2 et échéance = maintenant + TTL,
 *    comme avant. Présents mais hors bornes : refus explicite (jamais de repli silencieux, qui
 *    signerait une réclamation différente de celle des autres enclaves).
 *  - ANTI-ÉQUIVOCATION : deux réclamations DIFFÉRENTES de même (bountyId, empreinte) signées par la
 *    même enclave = saisie de toute la caution de l'opérateur (SealedBounty.reportEquivocation, moitié
 *    au rapporteur, qui peut être le chasseur lui-même). L'enclave mémorise donc la réclamation signée
 *    pour chaque (bountyId, empreinte) et n'en signe jamais une autre : une nouvelle soumission rend
 *    la MÊME réclamation (même signature) ou est refusée. Réservation synchrone avant la signature,
 *    donc sûre aussi pour des soumissions concurrentes.
 *
 * v2 bis (revue adverse du 7/11) :
 *  - EMPREINTE CANONIQUE, calculée ICI et non par le rejeu : keccak256(abi.encode(keccak256(code d'attaque),
 *    keccak256(tx) pour chaque tx)), sur les OCTETS. Le même exploit écrit autrement (hexadécimal en majuscules,
 *    autre JSON) a la même empreinte : SealedBounty ne le paie qu'une fois (et, on-chain, une prime ne paie de
 *    toute façon qu'une fois par palier et par armement). Les transactions doivent être de l'hexadécimal pair.
 *
 * Le rejeu (arc-anvil) et la dérivation déterministe de `cP` sont injectés (interfaces) : le cœur
 * reste testable hors VM, et la partie « fork » sera branchée au spike S3.
 *
 * v2.1 : RÉFUTATION d'une réclamation acceptée (SealedBounty.refute) — voir RefutationService, plus bas.
 *
 * v2.1 bis (revue adverse du 9/11) — RÈGLE D'OR : l'enclave ne signe JAMAIS (ni réclamation, ni réfutation) un résultat
 * qui dépend d'une erreur de réseau, de RPC, de délai ou d'environnement. En cas de doute : exception, HTTP 503, rien de
 * signé. Seules des règles DÉTERMINISTES, écrites et testées, donnent une « faute prouvée » :
 *  - prédicat : PredicateError (règles P1–P4, predicate.ts) ;
 *  - exploit : ReplayRuleError (règles du rejeu, ForkRunner.validate) ;
 *  - contenu de cP contredit par la réclamation (FAULT, plus bas).
 * Le rejeu échoue fermé (ReplayUnavailableError, anvil-fork.ts) ; toute autre exception (pile JavaScript épuisée,
 * erreur d'environnement) remonte : 503. Les messages renvoyés (raisons, notes) sont FIXES : jamais le message d'une
 * erreur de viem, d'un parseur ou du nœud (ils recopient des octets de l'exploit).
 *
 * v2.1 ter (vérification adverse du 9/11, preuves verif-failclosed e4, e7, e8) :
 *  - AUCUN catch sans tri : seules des erreurs DÉTERMINISTES identifiées (classes ou codes précis : HpkeError, SyntaxError
 *    de JSON.parse, TypeError ERR_ENCODING_INVALID_ENCODED_DATA, étiquette ChaCha20-Poly1305 invalide, BigInt d'une valeur
 *    JSON non entière, clé X25519 d'ordre faible, scellé trop court) deviennent un refus ou une faute ; toute autre exception
 *    remonte : 503, rien de signé, rien de mémorisé ;
 *  - /bounty/submit : déduplication par hachage du chiffré (une même soumission répétée rend le même résultat sans relire la
 *    chaîne ; les soumissions identiques simultanées partagent un seul traitement) ; jeton de débit (`admit`) pris après les
 *    contrôles locaux, avant toute lecture on-chain ;
 *  - /v1/refute : jeton de débit (`admit`) pris APRÈS la lecture bon marché de claimRecords (réclamation acceptée, non
 *    réfutée, dans la fenêtre), et seulement si aucun résultat n'est déjà mémorisé ou en cours pour cette réclamation ;
 *    file pleine (« busy », « refute_busy ») ou débit dépassé : jamais mémorisés comme un échec du rejeu.
 *
 * v2.1 quater (démonstration de la réfutation, 9/11) : faute VOLONTAIRE « inflate-loss » (BountyServiceConfig.demoFault),
 * pour la seule démonstration séparée et étiquetée (produit 5, enclave/phala/refute-demo-liar-v21.yml : DEMO_FAULT en clair,
 * donc MESURÉE dans l'empreinte d'image). La réclamation est signée avec une perte DOUBLÉE ; tout le reste est ce qu'une
 * enclave honnête signe (bloc N, prédicat, palier de la perte MESURÉE, empreinte, cPHash, échéance). Refusée pour le produit
 * 2 (ici, au constructeur, et au démarrage du serveur). Absente : rien ne change. Les réfutations (RefutationService) ne la
 * voient jamais : une enclave menteuse réfute honnêtement.
 */
import {
  type Address, type Hex, encodeAbiParameters, getAddress, hashTypedData, isAddress, isHex, keccak256, toBytes, toHex, zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HpkeError } from "@hpke/core";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes } from "@noble/hashes/utils";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { EnclaveKit } from "../kit/enclave-kit";
import { claimTypes, domain, type Claim } from "../kit/eip712";
import { deterministicSeal } from "../kit/deterministic-seal";
import {
  PREDICATE_MAX_DEPTH, PredicateError, evaluate, jsonDepthExceeds, predicateHash, validatePredicate,
  type EvalContext, type Predicate,
} from "./predicate";

export interface ExploitBundle {
  bountyId: bigint;
  payee: Address;
  capital: bigint; // capital déclaré (solde natif de l'attaquant dans le fork)
  predicate: Predicate;
  txs: Hex[]; // transactions de l'attaque (<= 10)
  attackCode?: Hex; // bytecode optionnel à déployer
  r: Hex; // aléa pour la dérivation de cP
  cP: Hex; // chiffré vers le protocole, fourni par le chasseur
  /** v2 (optionnel) : bloc N du rejeu, choisi par le chasseur (le même pour ses k enclaves). */
  blockN?: bigint;
  /** v2 (optionnel) : échéance de la réclamation (secondes Unix), la même pour ses k enclaves. */
  deadline?: bigint;
}

export interface BountyView {
  predicateHash: Hex;
  protocolX25519: Hex;
  tierMinLoss: bigint[]; // trié croissant
  deadline: bigint;
}

export interface BountyReader {
  getBounty(bountyId: bigint): Promise<BountyView>;
}

/** Recalcule le chiffré vers le protocole de façon reproductible (même r => même cP). */
export interface ProtocolCipher {
  recompute(bundle: ExploitBundle, protocolX25519: Hex): Promise<Hex>;
}

/**
 * Rejoue le bundle dans un fork au bloc N et rend de quoi évaluer le prédicat. v2 bis : l'empreinte éventuellement
 * rendue est IGNORÉE — le service calcule toujours l'empreinte canonique (`exploitFingerprint`).
 */
export interface ForkRunner {
  /**
   * v2.1 bis : rend des mesures DÉTERMINISTES, ou lève — ReplayRuleError (règle du rejeu violée) ou toute autre erreur
   * (panne : rien n'est signé). `expectedBlockHash` : le hash du bloc N de la réclamation ; un moteur qui le reçoit
   * vérifie que son RPC sert ce bloc-là (sinon : panne, rien n'est signé).
   */
  run(input: {
    blockN: bigint;
    bundle: ExploitBundle;
    expectedBlockHash?: Hex;
  }): Promise<{ ctx: EvalContext; fingerprint?: Hex }>;
  /**
   * v2.1 (facultatif) : les règles DÉTERMINISTES du moteur sur un bundle (nombre et forme des transactions, tailles,
   * capital), sans rien rejouer. Lève ReplayRuleError si le bundle est refusé (v2.1 bis : seule cette erreur compte
   * comme une règle ; toute autre exception est une panne). Une réfutation s'en sert pour distinguer « cet exploit ne
   * peut pas être rejoué » (aucune enclave honnête n'aurait signé : faute prouvée) d'une panne passagère du rejeu.
   */
  validate?(bundle: ExploitBundle): void;
}

/** v2.1 bis : une règle DÉTERMINISTE du rejeu est violée par l'exploit. Message fixe (rien du contenu de l'exploit). */
export class ReplayRuleError extends Error {
  constructor(readonly rule: string, message: string) {
    super(message);
    this.name = "ReplayRuleError";
  }
}

/** v2.1 ter : « budget » (lectures du RPC du fork au-delà du budget du rejeu), « relay » (réponse du RPC du fork refusée
 *  par le relais strict), « rate_limited » (débit dépassé : HTTP 429), « internal » (exception inattendue pendant le rejeu,
 *  environnement compris : 503, jamais mémorisée). */
export type ReplayUnavailableReason =
  | "rpc" | "timeout" | "process" | "busy" | "anchor" | "recent_failure" | "refute_busy" | "budget" | "relay" | "rate_limited" | "internal";

/** v2.1 ter : raisons qui ne sont PAS un échec du rejeu (file pleine, débit, exception d'environnement) : jamais mémorisées. */
const NOT_A_REPLAY_FAILURE: ReadonlySet<ReplayUnavailableReason> = new Set(["busy", "refute_busy", "rate_limited", "recent_failure", "internal"]);

/** v2.1 ter : un échec MÉMORISABLE (ralentit les rejeux répétés) : un ReplayUnavailableError dont la raison est un vrai échec
 *  du rejeu. Toute autre exception (environnement, inattendue) n'est jamais mémorisée. */
export function isMemorizableFailure(e: unknown): e is ReplayUnavailableError {
  return e instanceof ReplayUnavailableError && !NOT_A_REPLAY_FAILURE.has(e.reason);
}

/** v2.1 bis : le rejeu (ou la réfutation) n'a pas abouti pour une raison qui n'est PAS une règle : jamais un verdict,
 *  rien n'est signé (HTTP 503). */
export class ReplayUnavailableError extends Error {
  constructor(readonly reason: ReplayUnavailableReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReplayUnavailableError";
  }
}

/**
 * v2 bis : l'empreinte CANONIQUE d'un exploit, sur les octets du code d'attaque et des transactions (la casse de
 * l'hexadécimal ou l'écriture JSON n'y changent rien). Même formule que `exploitFingerprint` du rejeu réel
 * (src/services/anvil-fork.ts), vérifié par les tests.
 */
export function exploitFingerprint(bundle: Pick<ExploitBundle, "txs" | "attackCode">): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32[]" }],
      [keccak256(bundle.attackCode ?? "0x"), bundle.txs.map((t) => keccak256(t))],
    ),
  );
}

export interface BlockSource {
  current(): Promise<bigint>;
  blockHash(n: bigint): Promise<Hex>;
}

export type SubmitResult =
  | { status: "proven"; claim: Claim; signature: Hex; cP: Hex }
  | { status: "not_proven"; reason: string };

/** v2.1 quater : faute VOLONTAIRE de démonstration (réfutation). « inflate-loss » : la perte signée est doublée. */
export type DemoFault = "inflate-loss";
export const DEMO_FAULTS: readonly DemoFault[] = ["inflate-loss"];
/** v2.1 quater : produits où une faute de démonstration est interdite (2 = la vraie Prime scellée de la pile v2.1). */
export const DEMO_FAULT_FORBIDDEN_PRODUCTS: readonly bigint[] = [2n];

export interface BountyServiceConfig {
  sealedBounty: Address;
  /** Échéance par défaut d'une réclamation (s, défaut 600). */
  claimTtlSeconds?: bigint;
  /** v2.1 quater : DÉMONSTRATION de la réfutation seulement (jamais le produit 2) : réclamations signées avec une perte
   *  doublée. Absente (cas normal) : rien ne change. */
  demoFault?: DemoFault;
  /** v2.1 ter : durée de la déduplication d'un résultat par hachage du chiffré (ms, défaut 60 000). */
  dedupTtlMs?: number;
  /** v2.1 ter : durée de la déduplication d'un ÉCHEC du rejeu (ms, défaut 15 000) ; file pleine et débit : jamais. */
  dedupFailureTtlMs?: number;
  /** Horloge (ms) ; tests. */
  nowMs?: () => number;
}

/** v2.1 ter : soumissions dédupliquées au plus (les plus anciennes sortent d'abord). */
export const MAX_DEDUP_ENTRIES = 1_024;

/** v2.1 ter : options d'une soumission. `admit` : prend un jeton de débit ; faux → ReplayUnavailableError("rate_limited"). */
export interface SubmitOptions {
  admit?: () => boolean;
}

interface DedupEntry {
  /** Fin de validité (ms) ; Infinity tant que le traitement est en cours. */
  until: number;
  result: Promise<SubmitResult>;
}

/** Bornes des valeurs fournies par le chasseur (v2). */
export const MIN_ANCHOR_AGE = 2n; // N ≤ tête − 2
export const MAX_ANCHOR_AGE = 256n; // N ≥ tête − 256
export const MAX_CLAIM_TTL_SECONDS = 600n; // échéance ≤ maintenant + 10 min

interface SignedClaim {
  claim: Claim;
  cP: Hex;
  signature: Promise<Hex>;
}

/** Résultat d'une soumission qui n'a pas pu être déchiffrée : jamais dédupliqué (rien d'utile à mémoriser). */
const UNDECRYPTABLE_REASON = "cE indéchiffrable par cette enclave (mauvaise clé X25519 ?)";

export class BountyService {
  /** Réclamations signées par cette enclave, par (bountyId, empreinte) : jamais deux différentes. */
  private signed = new Map<string, SignedClaim>();
  /** v2.1 ter : résultats récents par hachage du chiffré (enc ‖ ciphertext). */
  private dedup = new Map<string, DedupEntry>();

  constructor(
    private kit: EnclaveKit,
    private cfg: BountyServiceConfig,
    private reader: BountyReader,
    private protocolCipher: ProtocolCipher,
    private fork: ForkRunner,
    private blocks: BlockSource,
    private now: () => bigint,
  ) {
    // v2.1 quater : une faute de démonstration inconnue, ou sur un produit où elle est interdite, n'est jamais servie
    if (cfg.demoFault !== undefined) {
      if (!DEMO_FAULTS.includes(cfg.demoFault)) throw new Error(`faute de démonstration inconnue : « ${String(cfg.demoFault)} »`);
      if (DEMO_FAULT_FORBIDDEN_PRODUCTS.includes(kit.productId)) {
        throw new Error(`faute de démonstration refusée pour le produit ${kit.productId} (la vraie Prime scellée)`);
      }
    }
  }

  private nowMs(): number {
    return this.cfg.nowMs ? this.cfg.nowMs() : Date.now();
  }

  /** v2.1 quater : la faute de démonstration servie (annoncée sur /pubkeys et /health), undefined dans le cas normal. */
  get demoFault(): DemoFault | undefined {
    return this.cfg.demoFault;
  }

  /**
   * v2.1 ter : une même soumission (mêmes octets chiffrés) répétée pendant un court délai rend le MÊME résultat sans rien
   * relire ; des soumissions identiques simultanées partagent un seul traitement. Sont mémorisés : les résultats (prouvée,
   * non prouvée, sauf un chiffré indéchiffrable) et, plus brièvement, les échecs du rejeu (ReplayUnavailableError) ; jamais
   * une file pleine, un débit dépassé ni une exception d'environnement.
   */
  submit(encBundle: { enc: Uint8Array; ciphertext: Uint8Array }, o: SubmitOptions = {}): Promise<SubmitResult> {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, encBundle.enc.length);
    const key = bytesToHex(sha256(concatBytes(len, encBundle.enc, encBundle.ciphertext))); // longueur de enc : coupure sans ambiguïté
    const now = this.nowMs();
    const hit = this.dedup.get(key);
    if (hit && hit.until > now) return hit.result;
    if (hit) this.dedup.delete(key);
    const entry: DedupEntry = { until: Infinity, result: this.submitOnce(encBundle, o) };
    this.remember(key, entry);
    const forget = () => {
      if (this.dedup.get(key) === entry) this.dedup.delete(key); // jamais une entrée plus récente de même clé
    };
    entry.result.then(
      (r) => {
        if (r.status === "not_proven" && r.reason === UNDECRYPTABLE_REASON) forget();
        else entry.until = this.nowMs() + (this.cfg.dedupTtlMs ?? 60_000);
      },
      (e) => {
        if (isMemorizableFailure(e)) entry.until = this.nowMs() + (this.cfg.dedupFailureTtlMs ?? 15_000);
        else forget(); // file pleine, débit, environnement : rien n'est mémorisé
      },
    );
    return entry.result;
  }

  /** Mémorise une entrée de déduplication (bornée : les entrées échues, puis les plus anciennes, sortent). */
  private remember(key: string, entry: DedupEntry): void {
    if (this.dedup.size >= MAX_DEDUP_ENTRIES) {
      const now = this.nowMs();
      for (const [k, v] of this.dedup) if (v.until <= now) this.dedup.delete(k);
      for (const k of this.dedup.keys()) {
        if (this.dedup.size < MAX_DEDUP_ENTRIES) break;
        this.dedup.delete(k);
      }
    }
    this.dedup.set(key, entry);
  }

  private async submitOnce(encBundle: { enc: Uint8Array; ciphertext: Uint8Array }, o: SubmitOptions): Promise<SubmitResult> {
    // 1. ouvrir le bundle (chiffré vers l'enclave) ; v2.1 ter : seules les erreurs HPKE (déterministes) sont un refus
    let plain: Uint8Array;
    try {
      plain = await this.kit.open(encBundle.enc, encBundle.ciphertext);
    } catch (e) {
      if (!(e instanceof HpkeError)) throw e; // environnement : 503, rien de mémorisé
      return { status: "not_proven", reason: UNDECRYPTABLE_REASON };
    }

    try {
      let bundle: ExploitBundle;
      try {
        bundle = parseBundle(plain);
      } catch (e) {
        // v2.1 bis : message FIXE (un message de JSON.parse ou de BigInt recopie des octets du bundle) ; v2.1 ter : seule la
        // règle de format (BundleFormatError) est un refus, toute autre exception remonte
        if (!(e instanceof BundleFormatError)) throw e;
        return { status: "not_proven", reason: `bundle illisible : ${e.message}` };
      }

      // 2. règles déterministes, locales, AVANT toute lecture on-chain : le prédicat (P1–P4), puis celles du rejeu
      let ph: Hex;
      try {
        ph = predicateHash(bundle.predicate);
      } catch (e) {
        if (e instanceof PredicateError) return { status: "not_proven", reason: `prédicat hors règles : ${e.message}` };
        throw e;
      }
      try {
        this.fork.validate?.(bundle);
      } catch (e) {
        if (e instanceof ReplayRuleError) return { status: "not_proven", reason: `exploit refusé par les règles du rejeu : ${e.message}` };
        throw e;
      }

      // 2bis. v2.1 ter : débit — un jeton seulement pour une soumission qui a passé les contrôles locaux, avant toute lecture
      if (o.admit && !o.admit()) {
        throw new ReplayUnavailableError("rate_limited", "trop de soumissions : réessayer plus tard (rien n'est signé)");
      }

      // 3. prime on-chain : le prédicat doit être le sien
      const bounty = await this.reader.getBounty(bundle.bountyId);
      if (ph.toLowerCase() !== bounty.predicateHash.toLowerCase()) {
        return { status: "not_proven", reason: "predicateHash ne correspond pas à la prime" };
      }

      // 3bis. recalcul reproductible de cP (ce qui permet à deux enclaves de signer le même hash)
      const cP = await this.protocolCipher.recompute(bundle, bounty.protocolX25519);
      if (cP.toLowerCase() !== bundle.cP.toLowerCase()) {
        return { status: "not_proven", reason: "cP non reproductible" };
      }

      // 4. bloc N : celui du chasseur s'il est dans [tête − 256, tête − 2], sinon (absent) tête − 2
      const head = await this.blocks.current();
      const hi = head - MIN_ANCHOR_AGE;
      const lo = head > MAX_ANCHOR_AGE ? head - MAX_ANCHOR_AGE : 0n;
      if (bundle.blockN !== undefined && (bundle.blockN < lo || bundle.blockN > hi)) {
        return {
          status: "not_proven",
          reason: `bloc N ${bundle.blockN} refusé : il doit être dans [tête − ${MAX_ANCHOR_AGE}, tête − ${MIN_ANCHOR_AGE}] = [${lo}, ${hi}]`,
        };
      }
      const blockN = bundle.blockN ?? hi;

      // 4bis. échéance du chasseur dans ]maintenant, maintenant + 10 min]
      const t0 = this.now();
      if (bundle.deadline !== undefined && (bundle.deadline <= t0 || bundle.deadline > t0 + MAX_CLAIM_TTL_SECONDS)) {
        return {
          status: "not_proven",
          reason: `échéance ${bundle.deadline} refusée : elle doit être dans ]maintenant, maintenant + ${MAX_CLAIM_TTL_SECONDS} s] = ]${t0}, ${t0 + MAX_CLAIM_TTL_SECONDS}]`,
        };
      }

      const blockHashN = await this.blocks.blockHash(blockN);

      // 5–8. rejeu + évaluation + empreinte (v2 bis : canonique, calculée ici). v2.1 bis : le rejeu vérifie que son RPC sert
      // le bloc N ancré (blockHashN, lu en quorum) ; une panne du rejeu ou de l'évaluation remonte (503, rien de signé)
      let ctx: EvalContext;
      try {
        ({ ctx } = await this.fork.run({ blockN, bundle, expectedBlockHash: blockHashN }));
      } catch (e) {
        if (e instanceof ReplayRuleError) return { status: "not_proven", reason: `exploit refusé par les règles du rejeu : ${e.message}` };
        throw e;
      }
      const fingerprint = exploitFingerprint(bundle);
      const { satisfied, loss } = evaluate(bundle.predicate, ctx);
      if (!satisfied) return { status: "not_proven", reason: "prédicat non satisfait" };

      const tier = pickTier(bounty.tierMinLoss, loss);
      if (tier < 0) return { status: "not_proven", reason: "perte sous le plus bas palier" };

      // 9. la réclamation. v2.1 quater : faute de DÉMONSTRATION « inflate-loss » (jamais le produit 2, voir le constructeur) :
      //    perte signée DOUBLÉE, tout le reste identique (palier compris : celui de la perte mesurée) ; absente : la perte mesurée
      const deadline = bundle.deadline ?? this.now() + (this.cfg.claimTtlSeconds ?? 600n);
      const claim: Claim = {
        bountyId: bundle.bountyId,
        payee: bundle.payee,
        blockN,
        blockHashN,
        predicateHash: ph,
        loss: this.cfg.demoFault === "inflate-loss" ? loss * 2n : loss,
        tier,
        fingerprint,
        cPHash: keccak256(cP),
        deadline,
      };

      // 9bis. anti-équivocation : vérifier et réserver SANS `await` entre les deux (atomique)
      const key = `${claim.bountyId}:${claim.fingerprint.toLowerCase()}`;
      const prev = this.signed.get(key);
      if (prev) return this.resubmission(prev, claim, bundle);

      const signature = this.kit.signClaim(this.cfg.sealedBounty, claim);
      this.signed.set(key, { claim, cP, signature });
      try {
        return { status: "proven", claim, signature: await signature, cP };
      } catch (e) {
        this.signed.delete(key); // aucune signature n'est sortie : la réservation peut tomber
        throw e;
      }
    } finally {
      // 10. effacer le bundle en clair (meilleur effort)
      plain.fill(0);
    }
  }

  /** Une réclamation existe déjà pour (bountyId, empreinte) : la rendre telle quelle, ou refuser. */
  private async resubmission(prev: SignedClaim, claim: Claim, bundle: ExploitBundle): Promise<SubmitResult> {
    const p = prev.claim;
    const sameContent =
      p.payee.toLowerCase() === claim.payee.toLowerCase() &&
      p.cPHash.toLowerCase() === claim.cPHash.toLowerCase() &&
      p.predicateHash.toLowerCase() === claim.predicateHash.toLowerCase();
    if (!sameContent) {
      return {
        status: "not_proven",
        reason:
          "une autre réclamation a déjà été signée par cette enclave pour cette empreinte " +
          "(une enclave ne signe jamais deux réclamations différentes pour la même empreinte)",
      };
    }
    const sameAnchor =
      (bundle.blockN === undefined || bundle.blockN === p.blockN) &&
      (bundle.deadline === undefined || bundle.deadline === p.deadline);
    if (!sameAnchor) {
      return {
        status: "not_proven",
        reason:
          `réclamation déjà signée par cette enclave pour cette empreinte avec bloc N ${p.blockN} et échéance ` +
          `${p.deadline} : redemander avec ces valeurs (une enclave ne signe jamais deux réclamations différentes ` +
          "pour la même empreinte)",
      };
    }
    return { status: "proven", claim: p, signature: await prev.signature, cP: prev.cP };
  }
}

/** Palier le plus haut dont le seuil de perte est atteint ; −1 si aucun. */
export function pickTier(tierMinLoss: bigint[], loss: bigint): number {
  let tier = -1;
  for (let i = 0; i < tierMinLoss.length; i++) {
    if (loss >= tierMinLoss[i]!) tier = i;
  }
  return tier;
}

/**
 * Implémentation de référence du chiffrement vers le protocole : scellé DÉTERMINISTE à partir de `r`.
 * Deux enclaves honnêtes qui ouvrent le même bundle recalculent le même cP (donc signent le même hash).
 * Le chasseur doit produire son cP exactement ainsi (représentation canonique du bundle, sans `cP`,
 * ni `r`, ni `blockN`/`deadline`).
 */
export class DeterministicProtocolCipher implements ProtocolCipher {
  async recompute(bundle: ExploitBundle, protocolX25519: Hex): Promise<Hex> {
    const canonical = canonicalProtocolPlaintext(bundle);
    return deterministicSeal(toBytes(protocolX25519), new TextEncoder().encode(canonical), toBytes(bundle.r));
  }
}

/** Le clair de cP : la forme canonique du bundle (mêmes clés, même ordre ; sans r, cP, blockN ni échéance). */
export function canonicalProtocolPlaintext(
  b: Pick<ExploitBundle, "bountyId" | "payee" | "capital" | "predicate" | "txs" | "attackCode">,
): string {
  return JSON.stringify({
    bountyId: b.bountyId.toString(),
    payee: b.payee,
    capital: b.capital.toString(),
    predicate: b.predicate,
    txs: b.txs,
    attackCode: b.attackCode ?? null,
  });
}

/** v2.1 bis : bundle mal formé ; le message est FIXE (nom du champ seulement, jamais sa valeur). */
class BundleFormatError extends Error {}

function parseBundle(plain: Uint8Array): ExploitBundle {
  let obj: any;
  try {
    obj = JSON.parse(new TextDecoder().decode(plain)); // décodage non fatal : seul JSON.parse peut refuser (SyntaxError)
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e; // v2.1 ter : environnement → 503
    throw new BundleFormatError("JSON attendu");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new BundleFormatError("objet JSON attendu");
  const txs: unknown = obj.txs ?? [];
  if (!Array.isArray(txs) || !txs.every(isEvenHex)) throw new BundleFormatError("txs : tableau d'hexadécimal pair attendu");
  if (obj.attackCode !== undefined && obj.attackCode !== null && !isEvenHex(obj.attackCode)) {
    throw new BundleFormatError("attackCode : hexadécimal pair attendu");
  }
  // v2.1 bis : le bénéficiaire est une adresse (la réclamation EIP-712 n'en signe pas d'autre ; casse mixte : EIP-55) ;
  // r et cP de l'hexadécimal (comme /v1/refute les lit) : une forme refusée ici l'est sans exception (jamais un 503)
  if (typeof obj.payee !== "string" || !isAddress(obj.payee)) throw new BundleFormatError("payee : adresse attendue (EIP-55 si casse mixte)");
  if (typeof obj.r !== "string" || !isHex(obj.r, { strict: true })) throw new BundleFormatError("r : hexadécimal attendu");
  if (typeof obj.cP !== "string" || !isHex(obj.cP, { strict: true })) throw new BundleFormatError("cP : hexadécimal attendu");
  const big = (x: unknown, name: string): bigint => {
    const v = jsonBigInt(x); // v2.1 ter : seuls les refus déterministes de BigInt ; le reste remonte
    if (v === undefined) throw new BundleFormatError(`${name} : entier attendu`);
    return v;
  };
  return {
    bountyId: big(obj.bountyId, "bountyId"),
    payee: obj.payee,
    capital: big(obj.capital, "capital"),
    predicate: obj.predicate,
    txs: txs as Hex[],
    attackCode: obj.attackCode ?? undefined,
    r: obj.r,
    cP: obj.cP,
    blockN: optionalUint(obj.blockN, "blockN"),
    deadline: optionalUint(obj.deadline, "deadline"),
  };
}

/** Hexadécimal strict de longueur paire (des octets, sans ambiguïté). */
function isEvenHex(x: unknown): x is Hex {
  return typeof x === "string" && isHex(x, { strict: true }) && x.length % 2 === 0;
}

// ---------- v2.1 ter : erreurs DÉTERMINISTES identifiées (tout le reste remonte : 503, rien de signé, rien de mémorisé) ----------

/**
 * BigInt(x) pour une valeur issue de JSON ; undefined si la conversion échoue de façon DÉTERMINISTE : nombre non entier
 * (RangeError de BigInt, écartée ici AVANT l'appel), chaîne qui n'est pas un entier (SyntaxError), null ou autre valeur non
 * convertible (TypeError). Toute autre exception (pile épuisée, mémoire) remonte.
 */
export function jsonBigInt(x: unknown): bigint | undefined {
  if (typeof x === "number" && !Number.isInteger(x)) return undefined;
  try {
    return BigInt(x as any);
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof TypeError) return undefined;
    throw e;
  }
}

/** Octets qui ne sont pas de l'UTF-8 (TextDecoder fatal de Node : TypeError ERR_ENCODING_INVALID_ENCODED_DATA). */
export function isInvalidUtf8Error(e: unknown): boolean {
  return e instanceof TypeError && (e as { code?: unknown }).code === "ERR_ENCODING_INVALID_ENCODED_DATA";
}

/** Étiquette ChaCha20-Poly1305 invalide (@noble/ciphers : Error exactement, message « invalid tag »). */
export function isInvalidTagError(e: unknown): boolean {
  return e instanceof Error && e.constructor === Error && e.message === "invalid tag";
}

const P25519 = (1n << 255n) - 19n;
/** Coordonnées u (mod p) des points d'ordre faible de Curve25519 et de sa tordue (ordre 1, 2, 4 ou 8) : X25519 d'un tel
 *  point par une clé bornée (multiple de 8) donne 0, que @noble/curves refuse. Liste complète (vérifiée le 9/11). */
const X25519_SMALL_ORDER = new Set<bigint>([
  0n, 1n, P25519 - 1n,
  325606250916557431795983626356110631294008115727848805560023387167927233504n,
  39382357235489614581723060781553021112529911719440698176882885853963445705823n,
]);

/** Vrai si `u` (32 octets) est une clé publique X25519 d'ordre faible (décodage RFC 7748 : bit de poids fort masqué, mod p). */
export function isSmallOrderX25519(u: Uint8Array): boolean {
  if (u.length !== 32) return false;
  let n = 0n;
  for (let i = 31; i >= 0; i--) n = (n << 8n) | BigInt(i === 31 ? u[i]! & 0x7f : u[i]!);
  return X25519_SMALL_ORDER.has(n % P25519);
}

/** Champ optionnel : entier ≥ 0 (nombre entier ou chaîne décimale), sinon erreur. */
function optionalUint(x: unknown, name: string): bigint | undefined {
  if (x === undefined || x === null) return undefined;
  if (typeof x === "number" && Number.isSafeInteger(x) && x >= 0) return BigInt(x);
  if (typeof x === "string" && /^[0-9]{1,20}$/.test(x)) return BigInt(x);
  throw new BundleFormatError(`${name} invalide (entier ≥ 0 attendu)`);
}

// ======================================================================================================================
// v2.1 — RÉFUTATION d'une réclamation ACCEPTÉE (SealedBounty.refute)
// ======================================================================================================================
//
// Ce que l'enclave réfutante peut réellement rejouer. La réclamation ne porte que des hachés : fingerprint =
// keccak256(abi.encode(keccak256(code d'attaque), keccak256(tx)[])) et cPHash = keccak256(cP), où cP est le scellé
// DÉTERMINISTE (aléa r) du bundle canonique vers la clé X25519 du PROTOCOLE. L'enclave ne peut pas ouvrir cP : quelqu'un doit
// lui apporter l'exploit EN CLAIR, chiffré vers SA clé X25519 (HPKE, aad liée au digest de la réclamation), et elle le relie
// à la réclamation AVANT tout rejeu :
//  - le CHASSEUR (bundle + r) : l'enclave recalcule cP = scellé(r, bundle canonique, clé de la prime lue on-chain) et exige
//    keccak256(cP) = cPHash : à r fixé, le scellé est injectif, la liaison est complète ;
//  - le PROTOCOLE (après deliver il a cP et sa clé, pas r) envoie cP et, au choix :
//     · le SECRET PARTAGÉ X25519 de ce seul rapport (X25519(clé privée de la prime, clé éphémère en tête de cP)) : il n'ouvre
//       que ce rapport, mais l'enclave ne peut pas le vérifier, et ChaCha20-Poly1305 n'engage pas sa clé. Le clair n'est
//       donc admis que s'il est EXACTEMENT un bundle canonique : un faux secret qui « ouvrirait » cP vers un autre bundle
//       canonique exigerait que deux flux ChaCha20 coïncident sur tout le préfixe fixe {"bountyId":"…","payee":"0x…
//       (des dizaines d'octets), hors de portée. Illisible ou non canonique : REFUS (rien n'est prouvé) ;
//     · la CLÉ PRIVÉE X25519 de la prime : l'enclave vérifie qu'elle redonne Bounty.protocolX25519 (lue on-chain) ; le
//       déchiffrement est alors certain, et un cP illisible ou non canonique PROUVE que les signataires de la réclamation
//       ont signé un rapport qui n'en est pas un. Cette clé ouvre TOUT rapport chiffré vers Bounty.protocolX25519 : ceux
//       de cette prime, et ceux de toute autre prime créée avec la même clé (la CLI en crée une par prime depuis la
//       v2.1 bis). Elle ne sort pas d'ici et elle est effacée de la mémoire après usage.
// Une fois le contenu de cP établi, tout écart avec la réclamation (prime, bénéficiaire, prédicat, empreinte) ou avec les
// règles du rejeu PROUVE la faute (une enclave honnête dérive tout cela du même bundle) : réfutation « non prouvée » sans
// rejeu (« cP n'est pas l'exploit annoncé », SealedBounty.Refutation). Sinon : rejeu au MÊME bloc N, même prédicat, paliers
// lus on-chain ; signature SEULEMENT si le résultat diffère (non prouvée, autre perte ou autre palier). Résultat identique :
// « confirmée », rien n'est signé (le contrat refuserait : NotARefutation).
// Refus avant tout déchiffrement (le contrat refuserait aussi) : réclamation inconnue, déjà réfutée, hors fenêtre, opérateurs
// qui ne sont pas ceux de ClaimAccepted, enclave inactive pour le produit de la prime, ou opérateur de CETTE enclave parmi
// les signataires de la réclamation. Le résultat est mémorisé par réclamation : jamais deux réfutations différentes.
//
// v2.1 bis (revue adverse du 9/11) :
//  - DÉNI DE SERVICE : claimRecords est lu SEUL d'abord (RefuteReader.record : une lecture par fournisseur, plus la tête) ;
//    réclamation inconnue, réfutée ou (fenêtre connue) hors fenêtre → arrêt avant toute autre lecture. Contre-rejeu en
//    échec mémorisé `failureTtlMs` (pas de rejeux complets répétés) ; au plus `maxInFlight` réfutations en cours ; le
//    débit est limité par l'application HTTP (app.ts) ;
//  - ÉCHEC FERMÉ : seules les fautes des règles déterministes listées (FAULT, PredicateError, ReplayRuleError) donnent
//    une réfutation sans rejeu ; une exception du rejeu ou de l'évaluation n'est jamais un verdict : 503, rien de signé ;
//  - un rapport imbriqué sur plus de MAX_REPORT_DEPTH niveaux n'est jamais sérialisé (JSON.stringify récursif) : avec la
//    clé de la prime c'est une faute (aucune enclave honnête ne l'aurait signé), sinon un refus ;
//  - ÉPOQUE DES RÈGLES (`acceptedFrom`, facultative) : une réclamation acceptée AVANT n'est pas jugée (refus
//    « rules_epoch »), car elle a pu être signée par une image aux règles de rejeu différentes.

/** Types EIP-712 de la réfutation : SealedBounty.REFUTATION_TYPEHASH = keccak256("Refutation(bytes32 claimDigest,bool proven,uint256 loss,uint8 tier)"). */
export const refutationTypes = {
  Refutation: [
    { name: "claimDigest", type: "bytes32" },
    { name: "proven", type: "bool" },
    { name: "loss", type: "uint256" },
    { name: "tier", type: "uint8" },
  ],
} as const;

/** SealedBounty.Refutation. `proven` faux : forme canonique { loss: 0, tier: 0 }, la même pour toutes les enclaves. */
export interface Refutation {
  claimDigest: Hex;
  proven: boolean;
  loss: bigint;
  tier: number;
}

/** aad HPKE d'une demande de réfutation : un chiffré préparé pour une réclamation ne sert pas pour une autre (ni pour /bounty/submit). */
export const REFUTE_AAD_LABEL = "arc-sealed-bounty/refute/v1";
export function refuteRequestAad(claimDigest: Hex): Uint8Array {
  return new TextEncoder().encode(`${REFUTE_AAD_LABEL}:${claimDigest.toLowerCase()}`);
}

/** Digest EIP-712 d'une réclamation (= SealedBounty.claimDigest) : clé de claimRecords, porté par la réfutation. Mêmes
 *  paramètres, dans le même ordre, que claimDigestOf du SDK. */
export function claimDigestOf(sealedBounty: Address, claim: Claim, chainId: number): Hex {
  return hashTypedData({ domain: domain({ chainId, verifyingContract: sealedBounty }), types: claimTypes, primaryType: "Claim", message: claim });
}

/** keccak256(abi.encode(operators)) : ClaimRecord.opsHash (même ordre que ClaimAccepted). */
export function claimOperatorsHash(operators: readonly Address[]): Hex {
  return keccak256(encodeAbiParameters([{ type: "address[]" }], [operators as Address[]]));
}

/** Ce que la chaîne dit de la réclamation et de la prime, lu AU MÊME BLOC (quorum RPC). */
export interface RefuteChainView {
  block: bigint;
  blockTimestamp: bigint;
  /** SealedBounty.claimRecords(digest) : acceptedAt = 0 si jamais acceptée. */
  record: { acceptedAt: bigint; refuted: boolean; opsHash: Hex };
  /** SealedBounty.REFUTE_WINDOW (s). */
  refuteWindow: bigint;
  bounty: BountyView & { productId: bigint };
  /** EnclaveRegistry.activeOperatorAt(signataire de CETTE enclave, produit de la prime, bloc) : 0 si inactive. */
  myOperator: Address;
}

export interface RefuteReader {
  read(q: { claimDigest: Hex; bountyId: bigint; signer: Address }): Promise<RefuteChainView>;
  /**
   * v2.1 bis (facultatif) : la lecture BON MARCHÉ faite d'abord — SealedBounty.claimRecords(digest) seul, au même bloc chez
   * tous les fournisseurs. Une réclamation inconnue, réfutée ou hors fenêtre s'arrête là, avant toute autre lecture.
   */
  record?(q: { claimDigest: Hex }): Promise<{ block: bigint; record: { acceptedAt: bigint; refuted: boolean; opsHash: Hex } }>;
}

export interface RefuteRequest {
  /** La réclamation acceptée, telle qu'émise par ClaimAccepted. */
  claim: Claim;
  /** Ses opérateurs, tels qu'émis par ClaimAccepted (même ordre). */
  operators: Address[];
  /** HPKE vers la clé X25519 de cette enclave, aad = refuteRequestAad(digest) ; clair : voir RefutationService. */
  enc: Uint8Array;
  ciphertext: Uint8Array;
}

/** Le contre-rejeu (ou la faute prouvée sans rejeu, `replayed` faux). */
export interface ReplayOutcome {
  blockN: bigint;
  replayed: boolean;
  satisfied: boolean;
  /** Perte mesurée par le prédicat (0 si non satisfait). */
  loss: bigint;
  /** Palier le plus haut atteint, −1 si aucun. */
  tier: number;
  /** satisfied et palier ≥ 0 : ce qu'une enclave honnête aurait signé. */
  proven: boolean;
  /** Pourquoi la réclamation est fautive sans rejeu, ou pourquoi le prédicat n'a pas pu être évalué. */
  note?: string;
}

export type RefuseCode =
  | "unknown_claim" | "already_refuted" | "window_over" | "bad_ops" | "wrong_product" | "inactive" | "claim_operator"
  | "undecryptable" | "bad_request" | "exploit_mismatch" | "rules_epoch";

export type RefuteResult =
  | { status: "refuted"; refutation: Refutation; signature: Hex; signer: Address; operator: Address; replay: ReplayOutcome }
  | { status: "confirmed"; claimDigest: Hex; replay: ReplayOutcome; reason: string }
  | { status: "refused"; code: RefuseCode; reason: string };

type Decided = Exclude<RefuteResult, { status: "refused" }>;

class RefuseError extends Error {
  constructor(readonly code: RefuseCode, message: string) {
    super(message);
  }
}

/** Contenu de cP établi (lié à la réclamation) ; `fault` : ce contenu prouve à lui seul la faute (pas de rejeu). */
interface Established {
  bundle?: ExploitBundle;
  fault?: string;
}

/** v2.1 bis : imbrication maximale d'un rapport (racine + prédicat) : au-delà, aucune enclave honnête ne l'a produit. */
export const MAX_REPORT_DEPTH = 1 + PREDICATE_MAX_DEPTH;

/**
 * v2.1 bis : les fautes PROUVÉES sans rejeu — règles déterministes, notes FIXES (rien du contenu de cP : la réponse HTTP
 * est lisible par tout intermédiaire qui termine le TLS).
 */
export const FAULT = {
  bounty: "le rapport vise une autre prime que la réclamation",
  payee: "le rapport paie un autre bénéficiaire que la réclamation",
  txs: "transactions qui ne sont pas de l'hexadécimal pair : aucune enclave honnête ne les aurait rejouées",
  attackCode: "code d'attaque qui n'est pas de l'hexadécimal pair",
  fingerprint: "l'empreinte de l'exploit de cP n'est pas celle de la réclamation : cP n'est pas l'exploit annoncé",
  predicate: "prédicat du rapport hors règles : aucune enclave honnête ne l'aurait signé",
  predicateHash: "le prédicat du rapport n'est pas celui de la réclamation",
  replayRules: "exploit refusé par les règles du rejeu : aucune enclave honnête n'aurait signé",
  ephemeralKey: "cP ne s'ouvre pas avec la clé de la prime (clé éphémère invalide) : ce n'est pas un rapport",
  unreadable: "cP ne s'ouvre pas avec la clé de la prime : les signataires ont signé un rapport illisible",
  notCanonical: "le rapport déchiffré n'est pas un bundle canonique : aucune enclave honnête ne l'aurait produit",
  tooDeep: "le rapport déchiffré est imbriqué au-delà des bornes : aucune enclave honnête ne l'aurait produit",
} as const;

export interface RefutationConfig {
  sealedBounty: Address;
  /** Réfutations en cours au plus (défaut 4) ; au-delà : ReplayUnavailableError("refute_busy"), 503, rien de signé. */
  maxInFlight?: number;
  /** Un contre-rejeu en échec n'est pas relancé pour la même réclamation pendant ce délai (ms, défaut 60 000). */
  failureTtlMs?: number;
  /** Époque des règles (s Unix) : une réclamation acceptée avant n'est pas jugée (refus « rules_epoch »). */
  acceptedFrom?: bigint;
  /** Horloge (ms) ; tests. */
  nowMs?: () => number;
}

/**
 * Le contre-rejeu d'une réclamation acceptée. Clair attendu (JSON, chiffré vers cette enclave) :
 *  - { "from": "hunter", bountyId, payee, capital, predicate, txs, attackCode?, r } : le bundle du chasseur et son aléa r ;
 *  - { "from": "protocol", cP, sharedSecret } : le rapport livré et le secret X25519 de CE rapport ;
 *  - { "from": "protocol", cP, protocolPrivateKey } : le rapport livré et la clé privée X25519 de la prime.
 */
export class RefutationService {
  /** Résultat par réclamation (digest) : rejoué une fois, jamais deux réfutations différentes ; un échec du rejeu s'efface. */
  private outcomes = new Map<string, Promise<Decided>>();
  /** v2.1 bis : contre-rejeux en échec récent, par réclamation (digest → fin du délai, ms). */
  private failures = new Map<string, number>();
  private inFlight = 0;
  /** REFUTE_WINDOW (constante du contrat), connue après la première lecture complète. */
  private window: bigint | undefined;

  constructor(
    private kit: EnclaveKit,
    private cfg: RefutationConfig,
    private reader: RefuteReader,
    private protocolCipher: ProtocolCipher,
    private fork: ForkRunner,
  ) {}

  private nowMs(): number {
    return this.cfg.nowMs ? this.cfg.nowMs() : Date.now();
  }

  /**
   * `o.admit` (v2.1 ter) : prend un jeton de débit ; il n'est demandé qu'APRÈS la lecture bon marché de claimRecords
   * (réclamation acceptée, non réfutée, dans la fenêtre si elle est connue), et seulement si aucun résultat n'est déjà
   * mémorisé ou en cours pour cette réclamation (une demande de plus ne coûte alors aucun rejeu). Faux →
   * ReplayUnavailableError("rate_limited") : HTTP 429, rien de signé, rien de mémorisé.
   */
  async refute(req: RefuteRequest, o: { admit?: () => boolean } = {}): Promise<RefuteResult> {
    const { claim } = req;
    const digest = claimDigestOf(this.cfg.sealedBounty, claim, this.kit.binding.chainId);
    const key = digest.toLowerCase();
    const refuse = (code: RefuseCode, reason: string): RefuteResult => ({ status: "refused", code, reason });

    // 0. un contre-rejeu de cette réclamation vient d'échouer : pas de nouveau rejeu complet avant la fin du délai
    const until = this.failures.get(key);
    if (until !== undefined) {
      if (this.nowMs() < until) {
        throw new ReplayUnavailableError("recent_failure", "contre-rejeu de cette réclamation en échec récent : réessayer plus tard (rien n'est signé)");
      }
      this.failures.delete(key);
    }

    // 1a. lecture BON MARCHÉ d'abord : claimRecords seul ; inconnue, réfutée ou hors fenêtre → arrêt, rien d'autre n'est lu
    if (this.reader.record) {
      const pre = await this.reader.record({ claimDigest: digest });
      const early = this.recordRefusal(digest, pre.record, undefined);
      if (early) return early;
    }

    // 1a bis. v2.1 ter : débit, APRÈS la lecture bon marché (un corps invalide ou une réclamation inventée ne prend aucun
    //         jeton) ; une réclamation dont le résultat est mémorisé ou en cours n'en prend pas non plus
    if (o.admit && !this.outcomes.has(key) && !o.admit()) {
      throw new ReplayUnavailableError("rate_limited", "trop de demandes de réfutation : réessayer plus tard (rien n'est signé)");
    }

    // 1b. concurrence bornée (le contre-rejeu passe par la file globale du moteur, partagée avec /bounty/submit)
    if (this.inFlight >= (this.cfg.maxInFlight ?? 4)) {
      throw new ReplayUnavailableError("refute_busy", "trop de réfutations en cours : réessayer plus tard (rien n'est signé)");
    }
    this.inFlight++;
    try {
      return await this.refuteChecked(req, digest, key, refuse);
    } finally {
      this.inFlight--;
    }
  }

  /** Refus tiré de claimRecords seul (inconnue, réfutée, hors fenêtre si la fenêtre et l'heure sont connues). */
  private recordRefusal(
    digest: Hex, rec: { acceptedAt: bigint; refuted: boolean }, at: { block: bigint; timestamp: bigint } | undefined,
  ): RefuteResult | undefined {
    if (rec.acceptedAt === 0n) return { status: "refused", code: "unknown_claim", reason: `réclamation ${digest} inconnue de SealedBounty (jamais acceptée) : rien à réfuter` };
    if (rec.refuted) return { status: "refused", code: "already_refuted", reason: `réclamation ${digest} déjà réfutée` };
    if (this.cfg.acceptedFrom !== undefined && rec.acceptedAt < this.cfg.acceptedFrom) {
      return {
        status: "refused", code: "rules_epoch",
        reason: `réclamation acceptée à ${rec.acceptedAt}, avant l'époque des règles de rejeu de cette enclave (${this.cfg.acceptedFrom}) : elle a pu être signée par une image aux règles différentes, cette enclave ne la juge pas`,
      };
    }
    if (this.window !== undefined) {
      const end = rec.acceptedAt + this.window;
      // lecture bon marché : l'heure locale (marge de 5 min ; seul un refus en sort) ; lecture complète : celle du bloc
      const now = at ? at.timestamp : BigInt(Math.floor(this.nowMs() / 1000)) - 300n;
      if (now > end) {
        return {
          status: "refused", code: "window_over",
          reason: `fenêtre de réfutation close : acceptée à ${rec.acceptedAt}, réfutable jusqu'à ${end}, il est ${now}${at ? ` (bloc ${at.block})` : ""}`,
        };
      }
    }
    return undefined;
  }

  private async refuteChecked(
    req: RefuteRequest, digest: Hex, key: string, refuse: (code: RefuseCode, reason: string) => RefuteResult,
  ): Promise<RefuteResult> {
    const { claim } = req;
    // 1. la réclamation relue on-chain (un seul bloc) : acceptée, non réfutée, dans la fenêtre, ces opérateurs-là
    const v = await this.reader.read({ claimDigest: digest, bountyId: claim.bountyId, signer: this.kit.keys.signer });
    this.window = v.refuteWindow;
    const { opsHash } = v.record;
    const stop = this.recordRefusal(digest, v.record, { block: v.block, timestamp: v.blockTimestamp });
    if (stop) return stop;
    if (claimOperatorsHash(req.operators).toLowerCase() !== opsHash.toLowerCase()) {
      return refuse("bad_ops", "ces opérateurs ne sont pas ceux de la réclamation (événement ClaimAccepted, même ordre) : le contrat refuserait (BadOps)");
    }
    if (v.bounty.productId !== this.kit.productId) {
      return refuse("wrong_product", `la prime #${claim.bountyId} est du produit #${v.bounty.productId}, cette enclave sert le produit #${this.kit.productId}`);
    }
    const me = v.myOperator.toLowerCase();
    if (me === zeroAddress) {
      return refuse("inactive", `cette enclave n'est pas active pour le produit #${v.bounty.productId} au bloc ${v.block} : sa signature serait refusée (NoValidSigner)`);
    }
    if (req.operators.some((o) => o.toLowerCase() === me)) {
      return refuse("claim_operator", `l'opérateur de cette enclave (${getAddress(me)}) a signé la réclamation : il ne peut pas la réfuter (RefuterIsClaimOperator)`);
    }

    // 2. l'exploit, chiffré vers CETTE enclave pour CETTE réclamation ; v2.1 ter : seules les erreurs HPKE sont un refus
    let plain: Uint8Array;
    try {
      plain = await this.kit.open(req.enc, req.ciphertext, refuteRequestAad(digest));
    } catch (e) {
      if (!(e instanceof HpkeError)) throw e; // environnement : 503, rien de mémorisé
      return refuse("undecryptable", "demande indéchiffrable par cette enclave (autre clé X25519, ou chiffrée pour une autre réclamation)");
    }
    try {
      let est: Established;
      try {
        est = await this.establish(plain, claim, v.bounty);
      } catch (e) {
        if (e instanceof RefuseError) return refuse(e.code, e.message);
        throw e;
      }
      // 3. contre-rejeu, une fois par réclamation (les requêtes concurrentes attendent le même résultat) ; un échec est
      //    mémorisé `failureTtlMs` (v2.1 bis) puis s'efface : jamais de verdict, jamais de rejeu complet répété.
      //    v2.1 ter : une file pleine (« busy ») ou un débit dépassé n'est PAS un échec du rejeu (preuves D3, D4) ; une
      //    exception d'environnement non plus : rien n'est mémorisé, la demande suivante peut rejouer aussitôt
      let p = this.outcomes.get(key);
      if (!p) {
        p = this.decide(claim, digest, est, v);
        this.outcomes.set(key, p);
        p.catch((e) => {
          this.outcomes.delete(key);
          if (!isMemorizableFailure(e)) return;
          this.failures.set(key, this.nowMs() + (this.cfg.failureTtlMs ?? 60_000));
          for (const [k, t] of this.failures) if (t <= this.nowMs()) this.failures.delete(k); // ménage
        });
      }
      return await p;
    } finally {
      plain.fill(0); // meilleur effort
    }
  }

  /** Relie le clair à la réclamation (cPHash d'abord) ; RefuseError si rien n'est établi. */
  private async establish(plain: Uint8Array, claim: Claim, bounty: BountyView): Promise<Established> {
    let msg: any;
    try {
      msg = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
    } catch (e) {
      // v2.1 ter : UTF-8 invalide ou JSON illisible, rien d'autre (environnement : 503)
      if (!isInvalidUtf8Error(e) && !(e instanceof SyntaxError)) throw e;
      throw new RefuseError("bad_request", "demande illisible (JSON attendu)");
    }
    if (msg?.from === "hunter") return this.fromHunter(msg, claim, bounty);
    if (msg?.from === "protocol") return this.fromProtocol(msg, claim, bounty);
    throw new RefuseError("bad_request", "« from » attendu : \"hunter\" (bundle + r) ou \"protocol\" (cP + sharedSecret ou protocolPrivateKey)");
  }

  private async fromHunter(msg: any, claim: Claim, bounty: BountyView): Promise<Established> {
    // v2.1 bis : imbrication bornée AVANT toute sérialisation (JSON.stringify est récursif : son échec dépendrait de la pile)
    if (jsonDepthExceeds(msg, MAX_REPORT_DEPTH)) {
      throw new RefuseError("bad_request", "bundle imbriqué au-delà des bornes du prédicat : il ne peut pas être relié sans risque à la réclamation, rien n'est rejoué");
    }
    // lu comme le lit /bounty/submit (BigInt, valeurs brutes), pour recalculer exactement le même cP ; v2.1 ter : seuls les
    // refus déterministes de BigInt (jsonBigInt), le reste remonte
    const bountyId = jsonBigInt(msg.bountyId);
    const capital = jsonBigInt(msg.capital);
    if (bountyId === undefined || capital === undefined) throw new RefuseError("bad_request", "bundle : bountyId et capital entiers attendus");
    if (typeof msg.r !== "string" || !isHex(msg.r)) throw new RefuseError("bad_request", "bundle : r (hexadécimal) attendu");
    const bundle: ExploitBundle = {
      bountyId, payee: msg.payee, capital, predicate: msg.predicate, txs: msg.txs ?? [], attackCode: msg.attackCode ?? undefined,
      r: msg.r as Hex, cP: "0x",
    };
    // v2.1 ter : le seul échec DÉTERMINISTE du recalcul (valeurs JSON d'imbrication bornée, r hexadécimal) : une clé X25519
    // de la prime d'ordre faible (aucun scellé possible vers elle). Il est écarté ici ; toute exception du recalcul remonte (503)
    if (isSmallOrderX25519(toBytes(bounty.protocolX25519))) {
      throw new RefuseError("bad_request", "bundle : cP non recalculable (clé X25519 de la prime d'ordre faible)");
    }
    const cP = await this.protocolCipher.recompute(bundle, bounty.protocolX25519);
    if (keccak256(cP).toLowerCase() !== claim.cPHash.toLowerCase()) {
      throw new RefuseError(
        "exploit_mismatch",
        "ce bundle et cet aléa r ne redonnent pas le cPHash de la réclamation : ce n'est pas l'exploit réclamé, rien n'est rejoué",
      );
    }
    bundle.cP = cP;
    return { bundle, fault: this.faultOf(bundle, claim) };
  }

  private async fromProtocol(msg: any, claim: Claim, bounty: BountyView): Promise<Established> {
    const cP = msg.cP;
    // pas de longueur minimale ici : un cP trop court pour être un scellé se PROUVE avec la clé de la prime (plus bas)
    if (!isEvenHex(cP)) throw new RefuseError("bad_request", "cP : hexadécimal pair (clé éphémère ‖ chiffré) attendu");
    if (keccak256(cP).toLowerCase() !== claim.cPHash.toLowerCase()) {
      throw new RefuseError("exploit_mismatch", "keccak256(cP) ≠ cPHash de la réclamation : ce n'est pas le rapport de cette réclamation, rien n'est rejoué");
    }
    const hasSecret = msg.sharedSecret !== undefined;
    const hasKey = msg.protocolPrivateKey !== undefined;
    if (hasSecret === hasKey) throw new RefuseError("bad_request", "donner sharedSecret OU protocolPrivateKey (32 octets), pas les deux");
    const secret = hasKey ? msg.protocolPrivateKey : msg.sharedSecret;
    if (!isBytes32(secret)) throw new RefuseError("bad_request", `${hasKey ? "protocolPrivateKey" : "sharedSecret"} : 32 octets attendus`);
    const raw = toBytes(secret);
    const sealed = toBytes(cP);
    const ephPub = sealed.slice(0, 32);
    let shared: Uint8Array;
    try {
      if (hasKey) {
        if (toHex(x25519.getPublicKey(raw)).toLowerCase() !== bounty.protocolX25519.toLowerCase()) {
          throw new RefuseError("exploit_mismatch", "cette clé privée ne redonne pas la clé X25519 de la prime (Bounty.protocolX25519)");
        }
        // v2.1 ter : clé éphémère trop courte ou d'ordre faible : faute DÉTERMINISTE (contrôlée avant, sans exception) ;
        // toute exception de X25519 remonte (503)
        if (ephPub.length !== 32 || isSmallOrderX25519(ephPub)) return { fault: FAULT.ephemeralKey };
        shared = x25519.getSharedSecret(raw, ephPub);
      } else {
        shared = raw.slice();
      }
    } finally {
      raw.fill(0);
    }
    const verified = hasKey; // déchiffrement certain seulement avec la clé vérifiée on-chain
    let text: string | undefined;
    try {
      // v2.1 ter : seuls trois échecs sont DÉTERMINISTES — scellé trop court, étiquette invalide, UTF-8 invalide ; toute
      // autre exception (mémoire, environnement) remonte : 503, rien de signé, rien de mémorisé (preuve e8)
      const opened = openSealedChecked(sealed, shared);
      if (opened !== undefined) {
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(opened);
        } catch (e) {
          if (!isInvalidUtf8Error(e)) throw e;
        }
      }
    } finally {
      shared.fill(0);
    }
    if (text === undefined) {
      if (verified) return { fault: FAULT.unreadable };
      throw new RefuseError(
        "exploit_mismatch",
        "cP ne s'ouvre pas avec ce secret partagé ; si le rapport est réellement illisible, seule la clé privée de la prime (protocolPrivateKey) permet de le prouver",
      );
    }
    const content = canonicalContent(text);
    if (content === "too_deep") {
      if (verified) return { fault: FAULT.tooDeep };
      throw new RefuseError(
        "exploit_mismatch",
        "le clair est imbriqué au-delà des bornes (secret faux, ou rapport forgé : la clé privée de la prime permettrait de le prouver)",
      );
    }
    if (!content) {
      if (verified) return { fault: FAULT.notCanonical };
      throw new RefuseError(
        "exploit_mismatch",
        "le clair n'est pas un bundle canonique (secret faux, ou rapport forgé : la clé privée de la prime permettrait de le prouver)",
      );
    }
    const bundle: ExploitBundle = { ...content, r: "0x", cP };
    return { bundle, fault: this.faultOf(bundle, claim) };
  }

  /**
   * Le contenu établi de cP contredit-il la réclamation, ou une règle déterministe ? (une enclave honnête n'aurait rien
   * signé). v2.1 bis : seules les règles listées comptent (FAULT, PredicateError, ReplayRuleError), avec des notes fixes ;
   * toute autre exception remonte (503, rien de signé).
   */
  private faultOf(b: ExploitBundle, claim: Claim): string | undefined {
    if (b.bountyId !== claim.bountyId) return FAULT.bounty;
    if (typeof b.payee !== "string" || b.payee.toLowerCase() !== claim.payee.toLowerCase()) return FAULT.payee;
    if (!Array.isArray(b.txs) || !b.txs.every(isEvenHex)) return FAULT.txs;
    if (b.attackCode !== undefined && !isEvenHex(b.attackCode)) return FAULT.attackCode;
    if (exploitFingerprint(b).toLowerCase() !== claim.fingerprint.toLowerCase()) return FAULT.fingerprint;
    try {
      validatePredicate(b.predicate); // règles P1–P4, itératives : jamais une pile épuisée
    } catch (e) {
      if (e instanceof PredicateError) return `${FAULT.predicate} (${e.message})`;
      throw e;
    }
    if (predicateHash(b.predicate).toLowerCase() !== claim.predicateHash.toLowerCase()) return FAULT.predicateHash;
    try {
      this.fork.validate?.(b);
    } catch (e) {
      if (e instanceof ReplayRuleError) return `${FAULT.replayRules} (${e.message})`;
      throw e;
    }
    return undefined;
  }

  private async decide(claim: Claim, digest: Hex, est: Established, v: RefuteChainView): Promise<Decided> {
    let replay: ReplayOutcome;
    if (est.fault !== undefined || !est.bundle) {
      replay = { blockN: claim.blockN, replayed: false, satisfied: false, loss: 0n, tier: -1, proven: false, note: est.fault };
    } else {
      const bundle = est.bundle;
      // v2.1 bis : le rejeu échoue fermé (et vérifie que son RPC sert le bloc N ancré) ; le prédicat a passé les règles
      // (faultOf) : une exception de l'évaluation est une panne, jamais un verdict → elle remonte (503, rien de signé)
      const { ctx } = await this.fork.run({ blockN: claim.blockN, bundle, expectedBlockHash: claim.blockHashN });
      const ev = evaluate(bundle.predicate, ctx);
      const tier = ev.satisfied ? pickTier(v.bounty.tierMinLoss, ev.loss) : -1;
      replay = { blockN: claim.blockN, replayed: true, satisfied: ev.satisfied, loss: ev.loss, tier, proven: ev.satisfied && tier >= 0 };
    }

    if (replay.proven && replay.loss === claim.loss && replay.tier === claim.tier) {
      return {
        status: "confirmed",
        claimDigest: digest,
        replay,
        reason: `le contre-rejeu au bloc ${claim.blockN} redonne la réclamation (perte ${claim.loss}, palier ${claim.tier}) : aucune réfutation signée`,
      };
    }
    const refutation: Refutation = replay.proven
      ? { claimDigest: digest, proven: true, loss: replay.loss, tier: replay.tier }
      : { claimDigest: digest, proven: false, loss: 0n, tier: 0 };
    // garde : jamais de signature sur un résultat identique (le contrat refuserait : NotARefutation)
    if (refutation.proven && refutation.loss === claim.loss && refutation.tier === claim.tier) {
      throw new Error("réfutation identique à la réclamation : non signée");
    }
    const signature = await privateKeyToAccount(this.kit.keys.signerPrivateKey).signTypedData({
      domain: domain({ chainId: this.kit.binding.chainId, verifyingContract: this.cfg.sealedBounty }),
      types: refutationTypes,
      primaryType: "Refutation",
      message: refutation,
    });
    return { status: "refuted", refutation, signature, signer: this.kit.keys.signer, operator: getAddress(v.myOperator), replay };
  }
}

/** Le clair d'un rapport, s'il est EXACTEMENT un bundle canonique (canonicalProtocolPlaintext) ; sinon undefined.
 *  v2.1 bis : "too_deep" s'il est imbriqué au-delà de MAX_REPORT_DEPTH (jamais sérialisé : JSON.stringify est récursif). */
function canonicalContent(text: string): Omit<ExploitBundle, "r" | "cP"> | "too_deep" | undefined {
  let o: any;
  try {
    o = JSON.parse(text); // itératif dans V8 : sûr quelle que soit l'imbrication
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e; // v2.1 ter : environnement → 503, jamais FAULT.notCanonical
    return undefined;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  if (jsonDepthExceeds(o, MAX_REPORT_DEPTH)) return "too_deep";
  // v2.1 ter : seuls les refus déterministes de BigInt (imbrication déjà bornée : toString d'un tableau sans risque de pile)
  const bountyId = jsonBigInt(o.bountyId);
  const capital = jsonBigInt(o.capital);
  if (bountyId === undefined || capital === undefined) return undefined;
  const c = { bountyId, payee: o.payee, capital, predicate: o.predicate, txs: o.txs, attackCode: o.attackCode ?? undefined };
  return canonicalProtocolPlaintext(c) === text ? c : undefined;
}

const SEAL_INFO_KEY = new TextEncoder().encode("arc-sealed-key-v1");
const SEAL_INFO_NONCE = new TextEncoder().encode("arc-sealed-nonce-v1");
/** Plus petit scellé : clé éphémère (32) + étiquette ChaCha20-Poly1305 (16). */
const MIN_SEALED_BYTES = 32 + 16;

/**
 * v2.1 ter : ouvre un scellé déterministe avec le SECRET PARTAGÉ X25519 ; undefined pour les deux échecs DÉTERMINISTES (scellé
 * de moins de 48 octets, étiquette invalide) ; toute autre exception remonte.
 */
function openSealedChecked(bytes: Uint8Array, shared: Uint8Array): Uint8Array | undefined {
  if (bytes.length < MIN_SEALED_BYTES) return undefined;
  const ephPub = bytes.slice(0, 32);
  const key = hkdf(sha256, shared, ephPub, SEAL_INFO_KEY, 32);
  const nonce = hkdf(sha256, ephPub, new Uint8Array(), SEAL_INFO_NONCE, 12);
  try {
    return chacha20poly1305(key, nonce).decrypt(bytes.slice(32));
  } catch (e) {
    if (isInvalidTagError(e)) return undefined;
    throw e;
  }
}

/**
 * Ouvre un scellé déterministe (cP = clé éphémère ‖ chiffré, kit/deterministic-seal.ts) avec le SECRET PARTAGÉ X25519 au
 * lieu de la clé privée du destinataire. Lève si le chiffré ne s'authentifie pas avec ce secret.
 */
export function openSealedWithSharedSecret(sealed: Hex, shared: Uint8Array): Uint8Array {
  const out = openSealedChecked(toBytes(sealed), shared);
  if (out === undefined) throw new Error("scellé trop court ou qui ne s'authentifie pas avec ce secret");
  return out;
}

function isBytes32(x: unknown): x is Hex {
  return typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
}
