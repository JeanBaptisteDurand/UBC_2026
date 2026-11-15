/**
 * inference.ts — service d'inférence (O2), v2 bis.
 *
 * La passerelle, dans l'ordre : lit la session on-chain (clé de session, dépôt, plafond, prix), vérifie
 * que CETTE enclave doit la servir (v2 bis), que `seq` suit, refuse 402 si le cumul dépasse ce que le contrat
 * paiera, lance l'inférence locale, construit le reçu cumulatif, le signe par le kit, puis rend la réponse
 * (chiffrée par le serveur HTTP).
 *
 * v2 :
 *  - ATOMICITÉ PAR SESSION : la vérification de `seq`, l'appel au modèle, le calcul du cumul et la
 *    signature se font sous le verrou (file FIFO) de la session. Deux requêtes concurrentes ne peuvent
 *    donc jamais recevoir le même `seq` : l'enclave ne signe JAMAIS deux reçus pour le même
 *    (sessionId, seq). Sinon c'est une équivocation, et SessionPay.reportEquivocation saisit toute la
 *    caution de l'opérateur (moitié au rapporteur, moitié au propriétaire de la session).
 *    L'état d'une session n'est jamais oublié tant que le processus vit (l'oublier rouvrirait les
 *    anciens `seq`) ; un redémarrage régénère les clés, donc change le signataire.
 *  - UNITÉS : le cumul est tenu en JETONS (entrée, sortie). unités = ceil((entrée + OUT_WEIGHT × sortie)
 *    / UNIT_TOKENS), calculées sur le cumul (aucun arrondi par requête). `cumulativeUnits` est
 *    strictement croissant : un reçu vaut au moins une unité de plus que le précédent.
 *  - DERNIER REÇU gardé en mémoire par session (GET /v1/session/:id/receipt) : l'opérateur le règle.
 *
 * v2 bis (revue adverse du 7/11) :
 *  - UNE SESSION, UNE ENCLAVE : SessionPay lie chaque session à la clé d'UNE enclave (choisie à l'ouverture) et ne
 *    paie que ses reçus. AVANT tout appel au modèle, la passerelle refuse (403) une session d'un autre produit, liée
 *    à une autre enclave, d'un opérateur qui n'est pas le sien (OPERATOR_ALLOWLIST), au prix 0, d'un autre modèle ou
 *    d'une autre unité facturée que les siens : chacun de ses reçus serait impayable (WrongEnclave, WrongOperator,
 *    ModelMismatch…) et l'opérateur paierait le modèle pour rien.
 *  - ÉCHÉANCE : une session échue, ou à moins de `expiryMarginSeconds` (60 s) de son échéance, n'est plus servie
 *    (410) : son propriétaire la ferme dès l'échéance + 1 h, l'opérateur doit pouvoir régler avant.
 *  - 402 SANS REJEU AUX FRAIS DE L'OPÉRATEUR : une requête manifestement trop chère pour le solde (estimation basse,
 *    4 octets par jeton d'entrée) est refusée AVANT l'appel au modèle. Si le modèle a tourné et que le résultat
 *    dépasse le solde, la réponse est GARDÉE EN ATTENTE, ni signée ni livrée : tant que le solde ne la couvre pas,
 *    toute requête de la session reçoit 402 SANS appel au modèle ; la session rechargée, rejouer la MÊME requête
 *    (même seq) livre la réponse gardée, facturée normalement. Le modèle ne tourne jamais deux fois pour une requête
 *    impayée, et le client ne paie jamais une réponse qu'il n'a pas reçue.
 *
 * `llama-server` et la lecture de bloc sont injectés (interfaces) pour rester testables hors VM.
 */
import { type Address, type Hex, keccak256, toBytes, verifyMessage } from "viem";
import { EnclaveKit } from "../kit/enclave-kit";
import type { Receipt } from "../kit/eip712";
import { KeyedMutex } from "../kit/keyed-mutex";

export interface SessionView {
  owner: Address;
  productId: bigint;
  operator: Address;
  sessionKey: Address;
  deposit: bigint;
  /** Plafond de dépense de la session (0 ou absent = le dépôt), comme SessionPay.settle. */
  cap?: bigint;
  price: bigint; // USDC (6 déc.) par unité, VERROUILLÉ à l'ouverture (SessionPay v2 : Session.price)
  paidUnits: bigint; // cumul déjà réglé on-chain
  expiresAt: bigint; // secondes Unix
  closed: boolean;
  /** v2 bis : la SEULE enclave dont les reçus paient cette session (Session.enclave). */
  enclave: Address;
  /** v2 bis : modèle verrouillé à l'ouverture (Session.param) ; absent = non vérifié. */
  param?: Hex;
  /** v2 bis : unité facturée verrouillée à l'ouverture (Session.unitTokens) ; absente = non vérifiée. */
  unitTokens?: bigint;
  /** v2 bis : poids d'un jeton de sortie verrouillé à l'ouverture (Session.outWeight) ; absent = non vérifié. */
  outWeight?: bigint;
}

export interface SessionReader {
  getSession(sessionId: bigint): Promise<SessionView>;
}

export interface LlamaClient {
  /** `signal` est déclenché quand la passerelle abandonne l'appel (délai dépassé). */
  infer(
    prompt: string,
    params: InferenceParams,
    signal?: AbortSignal,
  ): Promise<{ text: string; tokensIn: number; tokensOut: number }>;
}

export interface BlockSource {
  current(): Promise<bigint>;
}

export interface InferenceParams {
  temperature?: number;
  seed?: number;
  maxTokens?: number;
}

export interface InferenceOk {
  status: 200;
  text: string;
  receipt: Receipt;
  signature: Hex;
}

export interface InsufficientBalance {
  status: 402;
  error: "insufficient_session_balance";
  balance: bigint;
  /**
   * v2 bis : une réponse déjà calculée attend que le solde la couvre (`cost` en USDC, 6 déc.) : recharger la
   * session, puis rejouer la MÊME requête avec ce `seq` (le modèle ne tourne pas une 2e fois).
   */
  pending?: { seq: bigint; cost: bigint };
}

export type InferenceResult = InferenceOk | InsufficientBalance;

export interface SignedReceipt {
  receipt: Receipt;
  signature: Hex;
}

/** Erreur rendue au client avec un code HTTP (seq hors d'ordre, session fermée, modèle en défaut…). */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly httpStatus: 400 | 403 | 409 | 410 | 502 | 504,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface Billing {
  /** UNIT_TOKENS : jetons-équivalent-entrée par unité facturée (défaut 1 = comportement v1). */
  unitTokens: bigint;
  /** OUT_WEIGHT : un jeton de sortie compte pour OUT_WEIGHT jetons d'entrée (défaut 1 = v1). */
  outWeight: bigint;
}

export interface GatewayConfig {
  sessionPay: Address;
  modelHash: Hex; // = param du produit ; doit être égal pour le règlement
  /** v2 : jetons-équivalent-entrée par unité (UNIT_TOKENS, défaut 1). */
  unitTokens?: bigint;
  /** v2 : poids d'un jeton de sortie (OUT_WEIGHT, défaut 1). */
  outWeight?: bigint;
  /** v1, conservé pour compatibilité : multiplicateur d'unités par jeton (défaut 1). */
  unitPerToken?: bigint;
  /** Délai maximal d'un appel au modèle, en ms (défaut 120 000) : le verrou d'une session ne reste jamais pris. */
  inferTimeoutMs?: number;
  /** v2 bis : opérateurs dont cette enclave sert les sessions (OPERATOR_ALLOWLIST) ; absent = non vérifié. */
  operators?: readonly Address[];
  /** v2 bis : horloge en secondes Unix (défaut : celle du processus). */
  now?: () => bigint;
  /** v2 bis : une session n'est plus servie à moins de ce délai de son échéance (secondes, défaut 60). */
  expiryMarginSeconds?: bigint;
}

/** État d'une session dans CETTE enclave (jamais effacé tant que le processus vit). */
interface SessionState {
  lastSeq: bigint; // dernier seq signé
  tokensIn: bigint; // cumul des jetons d'entrée servis par cette enclave
  tokensOut: bigint; // cumul des jetons de sortie
  offset: bigint; // unités comptées hors de cette enclave (déjà réglées on-chain avant elle)
  units: bigint; // cumulativeUnits du dernier reçu signé (ou le plancher on-chain)
  last?: SignedReceipt;
  /** v2 bis : réponse calculée que le solde ne couvre pas encore (ni signée, ni livrée). */
  pending?: PendingResponse;
}

/** Réponse du modèle gardée tant que le solde de la session ne la couvre pas (v2 bis). */
interface PendingResponse {
  seq: bigint;
  requestHash: Hex;
  paramsHash: Hex;
  text: string;
  tokensIn: bigint;
  tokensOut: bigint;
}

const MAX_UINT64 = 2n ** 64n - 1n;

/** unités = ceil((entrée + outWeight × sortie) × unitPerToken / unitTokens), sur des cumuls. */
export function unitsForTokens(
  tokensIn: bigint,
  tokensOut: bigint,
  b: Billing & { unitPerToken?: bigint },
): bigint {
  const weighted = (tokensIn + b.outWeight * tokensOut) * (b.unitPerToken ?? 1n);
  return (weighted + b.unitTokens - 1n) / b.unitTokens;
}

/** Lit UNIT_TOKENS et OUT_WEIGHT (entiers ≥ 1, défaut 1). Une valeur invalide arrête le démarrage. */
export function billingFromEnv(env: Record<string, string | undefined> = process.env): Billing {
  return {
    unitTokens: positiveInteger(env.UNIT_TOKENS, "UNIT_TOKENS"),
    outWeight: positiveInteger(env.OUT_WEIGHT, "OUT_WEIGHT"),
  };
}

function positiveInteger(raw: string | undefined, name: string): bigint {
  if (raw === undefined) return 1n;
  const t = raw.trim();
  if (!/^[0-9]+$/.test(t) || BigInt(t) < 1n || BigInt(t) > MAX_UINT64) {
    throw new Error(`${name} doit être un entier ≥ 1 (reçu « ${raw} »)`);
  }
  return BigInt(t);
}

export class InferenceGateway {
  private sessions = new Map<string, SessionState>();
  private locks = new KeyedMutex();
  private unitPerToken: bigint;
  private operators: Set<string> | undefined;
  private now: () => bigint;
  private expiryMargin: bigint;
  readonly billing: Billing;

  constructor(
    private kit: EnclaveKit,
    private cfg: GatewayConfig,
    private reader: SessionReader,
    private llama: LlamaClient,
    private blocks: BlockSource,
  ) {
    this.unitPerToken = cfg.unitPerToken ?? 1n;
    this.billing = { unitTokens: cfg.unitTokens ?? 1n, outWeight: cfg.outWeight ?? 1n };
    if (this.billing.unitTokens < 1n) throw new Error("unitTokens (UNIT_TOKENS) doit être ≥ 1");
    if (this.billing.outWeight < 1n) throw new Error("outWeight (OUT_WEIGHT) doit être ≥ 1");
    if (this.unitPerToken < 1n) throw new Error("unitPerToken doit être ≥ 1");
    this.operators = cfg.operators ? new Set(cfg.operators.map((a) => a.toLowerCase())) : undefined;
    this.now = cfg.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
    this.expiryMargin = cfg.expiryMarginSeconds ?? 60n;
    if (this.expiryMargin < 0n) throw new Error("expiryMarginSeconds doit être ≥ 0");
  }

  /** Vérifie la signature de la clé de session sur l'enveloppe (hors chiffré). */
  static async verifyEnvelope(sessionKey: Address, envelopeDigest: Hex, signature: Hex): Promise<boolean> {
    try {
      return await verifyMessage({ address: sessionKey, message: { raw: envelopeDigest }, signature });
    } catch {
      return false;
    }
  }

  private key(sessionId: bigint): string {
    return sessionId.toString();
  }

  /** Le dernier reçu signé pour la session par cette enclave (depuis son démarrage), s'il existe. */
  lastReceipt(sessionId: bigint): SignedReceipt | undefined {
    return this.sessions.get(this.key(sessionId))?.last;
  }

  /**
   * Traite une requête déjà déchiffrée et authentifiée (clé de session vérifiée en amont).
   * Sérialisée par session : la réservation de `seq` et du cumul est atomique.
   */
  handle(sessionId: bigint, seq: bigint, prompt: string, params: InferenceParams): Promise<InferenceResult> {
    return this.locks.run(this.key(sessionId), () => this.handleLocked(sessionId, seq, prompt, params));
  }

  private async handleLocked(
    sessionId: bigint,
    seq: bigint,
    prompt: string,
    params: InferenceParams,
  ): Promise<InferenceResult> {
    const s = await this.reader.getSession(sessionId);
    if (s.closed) throw new GatewayError("session fermée", 410);
    this.assertServes(s); // v2 bis : 403 / 410 avant tout appel au modèle

    const key = this.key(sessionId);
    const st: SessionState = this.sessions.get(key) ?? {
      lastSeq: 0n,
      tokensIn: 0n,
      tokensOut: 0n,
      offset: s.paidUnits, // reprise : ce qui est déjà réglé on-chain est déjà compté
      units: s.paidUnits,
    };

    // Défense : si la chaîne a déjà réglé plus que notre dernier reçu, on décale pour que le prochain reçu reste
    // réglable (> paidUnits). (v2 bis : la session est liée à cette enclave, cela ne devrait plus arriver.)
    let offset = st.offset;
    let floor = st.units;
    if (s.paidUnits > floor) {
      offset += s.paidUnits - floor;
      floor = s.paidUnits;
    }

    // Ce que le contrat paiera au plus : le dépôt, ou le plafond s'il est plus bas (SessionPay.settle).
    const ceiling = s.cap !== undefined && s.cap > 0n && s.cap < s.deposit ? s.cap : s.deposit;
    const requestHash = keccak256(toBytes(prompt));
    const paramsHash = keccak256(toBytes(JSON.stringify(params ?? {})));

    // v2 bis : une réponse déjà calculée attend que le solde la couvre — jamais de 2e appel au modèle
    if (st.pending) {
      const p = st.pending;
      const units = this.unitsAfter(st, offset, floor, p.tokensIn, p.tokensOut);
      if (units * s.price > ceiling) {
        return insufficient(ceiling, floor, s.price, { seq: p.seq, cost: (units - floor) * s.price });
      }
      if (seq !== p.seq || requestHash !== p.requestHash || paramsHash !== p.paramsHash) {
        throw new GatewayError(
          `seq attendu ${p.seq} : la réponse déjà calculée pour cette requête attend ; la rejouer à l'identique`,
          409,
          { expectedSeq: p.seq.toString() },
        );
      }
      return this.commit(key, s, st, sessionId, offset, units, p);
    }

    if (seq !== st.lastSeq + 1n) {
      throw new GatewayError(`seq attendu ${st.lastSeq + 1n}, reçu ${seq}`, 409, {
        expectedSeq: (st.lastSeq + 1n).toString(),
      });
    }

    // Avant de payer le modèle : la session doit pouvoir payer au moins une unité de plus, et au moins l'entrée
    // estimée de cette requête (estimation BASSE : 4 octets par jeton ; rien n'est réservé).
    const estimate = this.unitsAfter(st, offset, floor, estimateInputTokens(prompt), 0n);
    if (estimate * s.price > ceiling) return insufficient(ceiling, floor, s.price);

    const out = await this.infer(prompt, params);
    const result: PendingResponse = {
      seq,
      requestHash,
      paramsHash,
      text: out.text,
      tokensIn: tokenCount(out.tokensIn, "d'entrée"),
      tokensOut: tokenCount(out.tokensOut, "de sortie"),
    };

    // Unités sur le cumul (pas d'arrondi par requête), strictement croissantes.
    const units = this.unitsAfter(st, offset, floor, result.tokensIn, result.tokensOut);

    // v2 bis : le modèle a tourné mais le cumul dépasse ce que le contrat paiera : la réponse est GARDÉE (ni
    // signée ni livrée, seq réservé) ; seule la même requête la reçoit, une fois le solde suffisant.
    if (units * s.price > ceiling) {
      this.sessions.set(key, { ...st, pending: result });
      return insufficient(ceiling, floor, s.price, { seq, cost: (units - floor) * s.price });
    }
    return this.commit(key, s, st, sessionId, offset, units, result);
  }

  /** Cumul d'unités si l'on ajoute ces jetons, strictement au-dessus du plancher (au moins +1 unité). */
  private unitsAfter(st: SessionState, offset: bigint, floor: bigint, addIn: bigint, addOut: bigint): bigint {
    const units =
      offset + unitsForTokens(st.tokensIn + addIn, st.tokensOut + addOut, { ...this.billing, unitPerToken: this.unitPerToken });
    return units <= floor ? floor + 1n : units;
  }

  /** Signe le reçu de la réponse et engage l'état de la session (seq consommé pour toujours). */
  private async commit(
    key: string,
    s: SessionView,
    st: SessionState,
    sessionId: bigint,
    offset: bigint,
    units: bigint,
    r: PendingResponse,
  ): Promise<InferenceOk> {
    const anchorBlock = await this.blocks.current();
    const receipt: Receipt = {
      productId: s.productId,
      sessionId,
      seq: r.seq,
      modelHash: this.cfg.modelHash,
      paramsHash: r.paramsHash,
      requestHash: r.requestHash,
      responseHash: keccak256(toBytes(r.text)),
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      cumulativeUnits: units,
      anchorBlock,
    };
    const signature = await this.kit.signReceipt(this.cfg.sessionPay, receipt);

    // Engagement, synchrone et juste après la signature : ce seq est consommé pour toujours (plus de réponse en
    // attente).
    this.sessions.set(key, {
      lastSeq: r.seq,
      tokensIn: st.tokensIn + r.tokensIn,
      tokensOut: st.tokensOut + r.tokensOut,
      offset,
      units,
      last: { receipt, signature },
    });
    return { status: 200, text: r.text, receipt, signature };
  }

  /**
   * v2 bis : cette enclave doit-elle servir la session ? Sinon GatewayError (403, ou 410 si échue), AVANT tout appel
   * au modèle : chaque reçu serait refusé par SessionPay.settle, l'opérateur paierait l'amont pour rien.
   */
  private assertServes(s: SessionView): void {
    const me = this.kit.keys.signer;
    if (s.productId !== this.kit.productId) {
      throw new GatewayError(`session du produit ${s.productId} : cette enclave sert le produit ${this.kit.productId}`, 403);
    }
    if (!s.enclave || s.enclave.toLowerCase() !== me.toLowerCase()) {
      throw new GatewayError(
        `session liée à l'enclave ${s.enclave ?? "(aucune)"}, pas à celle-ci (${me}) : ses reçus ne seraient pas payés (WrongEnclave)`,
        403,
      );
    }
    if (this.operators && !this.operators.has(s.operator.toLowerCase())) {
      throw new GatewayError(
        `session de l'opérateur ${s.operator}, qui n'est pas celui de cette enclave : ses reçus ne seraient pas payés (WrongOperator)`,
        403,
      );
    }
    if (s.price <= 0n) throw new GatewayError("session au prix 0 : aucun reçu ne serait payé", 403);
    if (s.param !== undefined && s.param.toLowerCase() !== this.cfg.modelHash.toLowerCase()) {
      throw new GatewayError(
        `session ouverte pour le modèle ${s.param}, cette enclave sert ${this.cfg.modelHash} (ModelMismatch)`,
        403,
      );
    }
    if (
      (s.unitTokens !== undefined && s.unitTokens !== this.billing.unitTokens) ||
      (s.outWeight !== undefined && s.outWeight !== this.billing.outWeight)
    ) {
      throw new GatewayError(
        `unité facturée de la session (UNIT_TOKENS=${s.unitTokens ?? "?"}, OUT_WEIGHT=${s.outWeight ?? "?"}) ≠ celle de ` +
          `cette enclave (${this.billing.unitTokens}, ${this.billing.outWeight})`,
        403,
      );
    }
    const now = this.now();
    if (now + this.expiryMargin >= s.expiresAt) {
      throw new GatewayError(
        `session échue ou sur le point de l'être (échéance ${s.expiresAt}, maintenant ${now}, marge ${this.expiryMargin} s) : ` +
          "son propriétaire pourrait la fermer avant le règlement",
        410,
      );
    }
  }

  /** Appel au modèle borné dans le temps (le verrou de la session est tenu pendant l'appel). */
  private async infer(prompt: string, params: InferenceParams) {
    const ms = this.cfg.inferTimeoutMs ?? 120_000;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new GatewayError(`le modèle n'a pas répondu en ${ms} ms`, 504));
      }, ms);
    });
    try {
      return await Promise.race([this.llama.infer(prompt, params, abort.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function insufficient(
  ceiling: bigint,
  units: bigint,
  price: bigint,
  pending?: { seq: bigint; cost: bigint },
): InsufficientBalance {
  const alreadyOwed = units * price;
  return {
    status: 402,
    error: "insufficient_session_balance",
    balance: ceiling > alreadyOwed ? ceiling - alreadyOwed : 0n,
    ...(pending ? { pending } : {}),
  };
}

/** Estimation BASSE des jetons d'entrée d'une invite (≈ 4 octets UTF-8 par jeton), pour refuser avant le modèle. */
export function estimateInputTokens(prompt: string): bigint {
  return BigInt(Math.ceil(new TextEncoder().encode(prompt).length / 4));
}

function tokenCount(n: number, what: string): bigint {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new GatewayError(`nombre de jetons ${what} invalide renvoyé par le modèle : ${n}`, 502);
  }
  return BigInt(n);
}
