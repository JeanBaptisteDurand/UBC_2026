/**
 * sealed-bounty/app.ts — l'application HTTP de la Prime scellée (O3), sans effet de bord (testable).
 *
 * v2 : UN SEUL BountyService pour toute la vie de l'enclave (sa mémoire anti-équivocation doit voir
 * toutes les soumissions) ; les paliers sont lus ON-CHAIN, jamais pris dans la requête du chasseur
 * (un faux palier ferait signer une réclamation inutilisable, et l'empreinte serait ensuite bloquée).
 *
 * v2.1 : POST /v1/refute — contre-rejeu d'une réclamation ACCEPTÉE (RefutationService, src/services/bounty.ts) :
 *   corps { claim, operators, enc, ciphertext } ; claim et operators tels qu'émis par ClaimAccepted, enc/ciphertext =
 *   HPKE vers la clé X25519 de cette enclave (aad refuteRequestAad(digest)). Réponse 200 :
 *   { status: "refuted", refutation, signature, signer, operator, replay } | { status: "confirmed", replay, reason } |
 *   { status: "refused", code, reason } ; 400 requête mal formée ; 503 lecture on-chain ou rejeu impossible (rien signé).
 *
 * v2.1 bis (revue adverse du 9/11) :
 *  - réponses d'erreur FIXES : jamais le message d'une exception (viem, parseur, nœud : ils recopient des octets de l'exploit) ;
 *  - corps borné (MAX_BODY_BYTES : 413) sur /bounty/submit et /v1/refute ;
 *  - /v1/refute : débit limité (seau à jetons global : 429), lecture bon marché de claimRecords d'abord (chainRefuteReader
 *    .record), concurrence bornée et échecs récents mémorisés (RefutationService) : 503 « occupée », rien de signé ;
 *  - paliers : la fin du tableau tierMinLoss n'est reconnue QUE sur un revert EVM (code JSON-RPC 3) ; une erreur interne du
 *    nœud (-32603, que viem range aussi en ContractFunctionRevertedError) tronquait les paliers en silence (palier faux
 *    signé) : elle remonte désormais (503).
 *
 * v2.1 ter (vérification adverse du 9/11, preuves verif-failclosed e4 D1, D2, e7) :
 *  - /v1/refute : le jeton du seau est pris APRÈS la validation de la forme du corps et la lecture bon marché de
 *    claimRecords (réclamation acceptée, non réfutée, dans la fenêtre), et seulement si aucun résultat n'est mémorisé ou en
 *    cours pour cette réclamation (RefutationService.refute, `admit`) : des corps vides ou des réclamations inventées ne
 *    vident plus le seau. Les corps INVALIDES ont leur propre limite bon marché, par IP vue (429), qui ne touche jamais aux
 *    demandes valides ;
 *  - /bounty/submit : débit limité (seau à jetons, 429) — jeton pris après les contrôles locaux (déchiffrement, format,
 *    prédicat, règles du rejeu), avant toute lecture on-chain ; même chiffré répété : même résultat sans relecture
 *    (BountyService) ; la prime (champs immuables fixés à createBounty) et ses paliers sont mis en cache par prime ;
 *  - 429 : en-tête Retry-After ; corps JSON illisible (SyntaxError) = 400, toute autre exception = 503.
 *
 * v2.1 quater (démonstration de la réfutation) : si le BountyService sert une faute de DÉMONSTRATION (DEMO_FAULT, voir
 * ./demo-fault.ts), /pubkeys et /health l'ANNONCENT (champs demoFault et demoFaultNote) ; sinon ces réponses sont exactement
 * celles du kit (attest-server).
 */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import {
  decodeFunctionResult, encodeFunctionData, getAddress, isAddress, isHex, parseAbi, toBytes, zeroAddress,
  type Address, type Hex, type PublicClient,
} from "viem";
import type { EnclaveKit } from "../../src/kit/enclave-kit";
import type { Claim } from "../../src/kit/eip712";
import type { RpcQuorum } from "../../src/kit/rpc-quorum";
import { createAttestServer, type AttestServerOptions } from "../../src/server/attest-server";
import {
  ReplayUnavailableError,
  type BountyReader, type BountyService, type BountyView, type DemoFault, type RefutationService, type RefuteReader, type RefuteRequest,
  type RefuteResult, type ReplayOutcome,
} from "../../src/services/bounty";
import { demoFaultNotice } from "./demo-fault";

export interface SealedBountyDeps {
  kit: EnclaveKit;
  service: BountyService;
  /** v2.1 : le contre-rejeu des réclamations acceptées (absent : /v1/refute répond 501). */
  refuter?: RefutationService;
  /** Options de /attest (défaut : OPERATOR_ALLOWLIST lue dans l'environnement). */
  attest?: AttestServerOptions;
  /** v2.1 bis : débit de /v1/refute (seau à jetons global ; défaut 20 demandes, 20 par minute) ; false : aucune limite.
   *  v2.1 ter : le jeton n'est pris qu'après la forme du corps et claimRecords (réclamation vivante, sans résultat mémorisé). */
  refuteRateLimit?: { burst: number; perMinute: number } | false;
  /** v2.1 ter : corps INVALIDES de /v1/refute, par IP vue (défaut 30, 30 par minute) ; au-delà : 429 pour ces corps seulement. */
  refuteBadBodyLimit?: { burst: number; perMinute: number } | false;
  /** v2.1 ter : débit de /bounty/submit (seau à jetons global ; défaut 8, 8 par minute) ; false : aucune limite. */
  submitRateLimit?: { burst: number; perMinute: number } | false;
  /** Horloge (ms) des limiteurs ; tests. */
  nowMs?: () => number;
}

/** v2.1 bis : taille maximale d'un corps de requête (un bundle de 10 transactions de 64 Kio, en hexadécimal, chiffré). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** v2.1 bis : réponses 503 FIXES (rien de l'exception d'origine). */
export const UNAVAILABLE = {
  submit: "lecture on-chain ou rejeu impossible : rien n'est signé, réessayez plus tard",
  refute: "lecture on-chain ou contre-rejeu impossible, rien n'est signé : réessayez plus tard",
  busy: "enclave occupée (file de rejeu ou réfutations en cours) : rien n'est signé, réessayez plus tard",
  recent: "le contre-rejeu de cette réclamation a échoué il y a peu : rien n'est signé, réessayez dans une minute",
} as const;

/** v2.1 ter : réponses 429 FIXES. */
export const RATE_LIMITED = {
  submit: "trop de soumissions : réessayez dans quelques secondes (rien n'est signé)",
  refute: "trop de demandes de réfutation : réessayez dans quelques secondes (rien n'est signé)",
  badBody: "trop de corps invalides depuis cette adresse : réessayez plus tard",
} as const;

/** Seau à jetons (débit d'une route) : `burst` demandes d'affilée, puis `perMinute` par minute. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(private burst: number, private perMinute: number, private now: () => number = Date.now) {
    this.tokens = burst;
    this.last = now();
  }
  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 60_000) * this.perMinute);
    this.last = t;
  }
  take(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  /** v2.1 ter : secondes avant le prochain jeton (en-tête Retry-After). */
  retryAfterSeconds(): number {
    this.refill();
    if (this.tokens >= 1 || this.perMinute <= 0) return this.perMinute <= 0 ? 60 : 0;
    return Math.max(1, Math.ceil(((1 - this.tokens) / this.perMinute) * 60));
  }
}

/** v2.1 ter : un seau par clé (IP vue), bornés en nombre (les clés les moins récentes sortent). */
export class KeyedTokenBuckets {
  private buckets = new Map<string, TokenBucket>();
  constructor(private burst: number, private perMinute: number, private now: () => number = Date.now, private maxKeys = 4_096) {}
  private bucket(key: string): TokenBucket {
    let b = this.buckets.get(key);
    if (b) {
      this.buckets.delete(key); // le plus récent en dernier
    } else {
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      b = new TokenBucket(this.burst, this.perMinute, this.now);
    }
    this.buckets.set(key, b);
    return b;
  }
  take(key: string): boolean {
    return this.bucket(key).take();
  }
  retryAfterSeconds(key: string): number {
    return this.bucket(key).retryAfterSeconds();
  }
}

const tooLarge = (c: Context) => c.json({ error: `corps de plus de ${MAX_BODY_BYTES} octets` }, 413);

function unavailable(e: unknown, which: "submit" | "refute"): string {
  if (e instanceof ReplayUnavailableError) {
    if (e.reason === "busy" || e.reason === "refute_busy") return UNAVAILABLE.busy;
    if (e.reason === "recent_failure") return UNAVAILABLE.recent;
  }
  return UNAVAILABLE[which];
}

/** v2.1 ter : l'adresse IP vue par le serveur (pair TCP ; derrière une passerelle, celle de la passerelle). */
function seenIp(c: Context): string {
  const a = (c.env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined)?.incoming?.socket?.remoteAddress;
  return typeof a === "string" && a !== "" ? a : "inconnue";
}

/** v2.1 ter : le corps JSON ; `undefined` s'il n'est pas du JSON (SyntaxError). Toute autre exception remonte (503). */
async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof SyntaxError) return undefined;
    throw e;
  }
}

const isRateLimited = (e: unknown) => e instanceof ReplayUnavailableError && e.reason === "rate_limited";

/**
 * /attest, /pubkeys, /health (attest-server). v2.1 quater : une enclave de DÉMONSTRATION fautive l'annonce sur /pubkeys et
 * /health (routes posées AVANT celles du kit, CORS compris) ; sans faute, ce sont exactement les routes du kit.
 */
function attestRoutes(kit: EnclaveKit, attest: AttestServerOptions | undefined, fault: DemoFault | undefined): Hono {
  const base = createAttestServer(kit, attest);
  if (fault === undefined) return base;
  const notice = demoFaultNotice(fault);
  const app = new Hono();
  app.use("*", cors());
  app.get("/health", (c) => c.json({ ok: true, ...notice }));
  app.get("/pubkeys", (c) => c.json({ ...kit.pubkeys(), ...notice }));
  app.route("/", base);
  return app;
}

export function createSealedBountyApp(d: SealedBountyDeps): Hono {
  // /attest, /pubkeys, /health ; la faute de démonstration vient du service lui-même (une seule source : sa configuration)
  const app = attestRoutes(d.kit, d.attest, (d.service as BountyService | undefined)?.demoFault);
  const limit = d.refuteRateLimit === false ? undefined : new TokenBucket(d.refuteRateLimit?.burst ?? 20, d.refuteRateLimit?.perMinute ?? 20, d.nowMs);
  const badBodies = d.refuteBadBodyLimit === false
    ? undefined : new KeyedTokenBuckets(d.refuteBadBodyLimit?.burst ?? 30, d.refuteBadBodyLimit?.perMinute ?? 30, d.nowMs);
  const submitLimit = d.submitRateLimit === false ? undefined : new TokenBucket(d.submitRateLimit?.burst ?? 8, d.submitRateLimit?.perMinute ?? 8, d.nowMs);

  app.post("/bounty/submit", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }), async (c) => {
    let body: any;
    try {
      body = await readJson(c);
    } catch {
      return c.json({ error: UNAVAILABLE.submit }, 503);
    }
    if (!body?.enc || !body?.ciphertext) return c.json({ error: "cE manquant" }, 400);
    if (!isHex(body.enc) || !isHex(body.ciphertext)) return c.json({ error: "cE invalide (hexadécimal attendu)" }, 400);
    // body.tierMinLoss (v1) est ignoré : les paliers viennent de la chaîne.
    let res: Awaited<ReturnType<BountyService["submit"]>>;
    try {
      res = await d.service.submit(
        { enc: toBytes(body.enc as Hex), ciphertext: toBytes(body.ciphertext as Hex) },
        { admit: submitLimit ? () => submitLimit.take() : undefined },
      );
    } catch (e) {
      if (isRateLimited(e)) {
        c.header("Retry-After", String(submitLimit?.retryAfterSeconds() ?? 60));
        return c.json({ error: RATE_LIMITED.submit }, 429);
      }
      return c.json({ error: unavailable(e, "submit") }, 503);
    }
    if (res.status === "not_proven") return c.json({ status: "not_proven", reason: res.reason }, 200);
    return c.json({
      status: "proven",
      cP: res.cP,
      signature: res.signature,
      claim: {
        bountyId: res.claim.bountyId.toString(),
        payee: res.claim.payee,
        blockN: res.claim.blockN.toString(),
        blockHashN: res.claim.blockHashN,
        predicateHash: res.claim.predicateHash,
        loss: res.claim.loss.toString(),
        tier: res.claim.tier,
        fingerprint: res.claim.fingerprint,
        cPHash: res.claim.cPHash,
        deadline: res.claim.deadline.toString(),
      },
    });
  });

  app.post("/v1/refute", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }), async (c) => {
    if (!d.refuter) return c.json({ error: "réfutation non disponible sur cette enclave" }, 501);
    let req: RefuteRequest;
    try {
      req = parseRefuteBody(await readJson(c));
    } catch (e) {
      if (!(e instanceof RefuteBodyError)) return c.json({ error: UNAVAILABLE.refute }, 503); // environnement
      // v2.1 ter : un corps invalide ne coûte rien et ne prend AUCUN jeton du seau des demandes valides ; sa propre limite,
      // par IP vue, ne s'applique qu'aux corps invalides
      const ip = seenIp(c);
      if (badBodies && !badBodies.take(ip)) {
        c.header("Retry-After", String(badBodies.retryAfterSeconds(ip)));
        return c.json({ error: RATE_LIMITED.badBody }, 429);
      }
      return c.json({ error: e.message }, 400);
    }
    let res: RefuteResult;
    try {
      // le jeton est pris par le service APRÈS la lecture bon marché de claimRecords (réclamation vivante)
      res = await d.refuter.refute(req, { admit: limit ? () => limit.take() : undefined });
    } catch (e) {
      if (isRateLimited(e)) {
        c.header("Retry-After", String(limit?.retryAfterSeconds() ?? 60));
        return c.json({ error: RATE_LIMITED.refute }, 429);
      }
      return c.json({ error: unavailable(e, "refute") }, 503);
    }
    return c.json(refuteResultJson(res), 200);
  });

  return app;
}

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

/** v2.1 bis : corps de /v1/refute mal formé ; message FIXE (nom du champ, jamais sa valeur). */
export class RefuteBodyError extends Error {}

/** Corps de POST /v1/refute → RefuteRequest ; lève RefuteBodyError (message en français, fixe) si mal formé. */
export function parseRefuteBody(body: any): RefuteRequest {
  if (!body || typeof body !== "object") throw new RefuteBodyError("corps JSON attendu : { claim, operators, enc, ciphertext }");
  const claim = parseClaimJson(body.claim);
  const ops = body.operators;
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > 5 || !ops.every((o: unknown) => typeof o === "string" && isAddress(o, { strict: false }))) {
    throw new RefuteBodyError("operators : 1 à 5 adresses (celles de ClaimAccepted, même ordre)");
  }
  if (typeof body.enc !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.enc)) throw new RefuteBodyError("enc : clé encapsulée HPKE de 32 octets attendue");
  if (typeof body.ciphertext !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(body.ciphertext)) throw new RefuteBodyError("ciphertext : hexadécimal pair attendu");
  return {
    claim,
    operators: ops.map((o: string) => getAddress(o.toLowerCase())),
    enc: toBytes(body.enc as Hex),
    ciphertext: toBytes(body.ciphertext as Hex),
  };
}

/** Réclamation en JSON (chaînes décimales, comme la rend /bounty/submit) → Claim, bornes des types Solidity comprises. */
export function parseClaimJson(c: any): Claim {
  if (!c || typeof c !== "object") throw new RefuteBodyError("claim : objet attendu (la réclamation de ClaimAccepted)");
  const uint = (k: string, max: bigint): bigint => {
    const v = c[k];
    const s = typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : v;
    if (typeof s !== "string" || !/^[0-9]{1,78}$/.test(s) || BigInt(s) > max) throw new RefuteBodyError(`claim.${k} : entier décimal attendu`);
    return BigInt(s);
  };
  const b32 = (k: string): Hex => {
    if (typeof c[k] !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(c[k])) throw new RefuteBodyError(`claim.${k} : bytes32 attendu`);
    return c[k] as Hex;
  };
  const tier = typeof c.tier === "string" && /^[0-9]{1,3}$/.test(c.tier) ? Number(c.tier) : c.tier;
  if (!Number.isInteger(tier) || tier < 0 || tier > 255) throw new RefuteBodyError("claim.tier : entier de 0 à 255 attendu");
  if (typeof c.payee !== "string" || !isAddress(c.payee, { strict: false })) throw new RefuteBodyError("claim.payee : adresse attendue");
  return {
    bountyId: uint("bountyId", UINT256_MAX),
    payee: getAddress(c.payee.toLowerCase()),
    blockN: uint("blockN", UINT64_MAX),
    blockHashN: b32("blockHashN"),
    predicateHash: b32("predicateHash"),
    loss: uint("loss", UINT256_MAX),
    tier,
    fingerprint: b32("fingerprint"),
    cPHash: b32("cPHash"),
    deadline: uint("deadline", UINT64_MAX),
  };
}

function replayJson(x: ReplayOutcome) {
  return {
    blockN: x.blockN.toString(), replayed: x.replayed, satisfied: x.satisfied, loss: x.loss.toString(), tier: x.tier, proven: x.proven,
    ...(x.note ? { note: x.note } : {}),
  };
}

/** RefuteResult → JSON (montants en chaînes décimales). */
export function refuteResultJson(r: RefuteResult) {
  switch (r.status) {
    case "refuted":
      return {
        status: r.status,
        refutation: { claimDigest: r.refutation.claimDigest, proven: r.refutation.proven, loss: r.refutation.loss.toString(), tier: r.refutation.tier },
        signature: r.signature,
        signer: r.signer,
        operator: r.operator,
        replay: replayJson(r.replay),
      };
    case "confirmed":
      return { status: r.status, claimDigest: r.claimDigest, replay: replayJson(r.replay), reason: r.reason };
    case "refused":
      return { status: r.status, code: r.code, reason: r.reason };
  }
}

const SEALED_BOUNTY_READ_ABI = parseAbi([
  "struct Bounty { address protocol; uint256 productId; bytes32 predicateHash; bytes32 protocolX25519; uint256 singleCap; uint8 k; address targetToPause; uint64 deadline; uint256 balance; bool paused; }",
  "function getBounty(uint256 id) view returns (Bounty)",
  "function tierMinLoss(uint256 bountyId, uint256 index) view returns (uint256)",
  "function claimRecords(bytes32) view returns (uint64 acceptedAt, bool refuted, bytes32 opsHash)",
  "function REFUTE_WINDOW() view returns (uint64)",
]);

const ENCLAVE_REGISTRY_ACTIVE_ABI = parseAbi([
  "function activeOperatorAt(address signer, uint256 productId, uint256 blockNumber) view returns (address)",
]);

/** Paliers lus au plus (le contrat n'en borne pas le nombre ; au-delà, refus plutôt que troncature). */
export const MAX_TIERS = 16;

/** v2.1 ter : primes gardées en cache au plus (les plus anciennes sortent). */
export const MAX_CACHED_BOUNTIES = 256;

type BountyAt = BountyView & { productId: bigint };

/**
 * v2.1 ter : cache par prime de ses champs IMMUABLES (SealedBounty.createBounty les fixe une fois pour toutes : productId,
 * predicateHash, protocolX25519, deadline, tierMinLoss) : une soumission ou une réfutation de plus ne relit pas 17 paliers.
 * Seule une prime qui EXISTE (protocol ≠ 0) est gardée : un identifiant pas encore créé n'est jamais figé.
 */
export class BountyCache {
  private m = new Map<string, BountyAt>();
  constructor(private max = MAX_CACHED_BOUNTIES) {}
  get(bountyId: bigint): BountyAt | undefined {
    return this.m.get(bountyId.toString());
  }
  put(bountyId: bigint, v: BountyAt): void {
    if (!this.m.has(bountyId.toString()) && this.m.size >= this.max) {
      const oldest = this.m.keys().next().value;
      if (oldest !== undefined) this.m.delete(oldest);
    }
    this.m.set(bountyId.toString(), v);
  }
  get size(): number {
    return this.m.size;
  }
}

/** Une prime et ses paliers, lus au bloc donné (un fournisseur du quorum) ; `exists` : protocol ≠ 0 (prime créée). */
async function readBountyAt(c: PublicClient, sealedBounty: Address, bountyId: bigint, blockNumber: bigint): Promise<BountyAt & { exists: boolean }> {
  const b = await c.readContract({
    address: sealedBounty, abi: SEALED_BOUNTY_READ_ABI, functionName: "getBounty", args: [bountyId], blockNumber,
  });
  const tierMinLoss: bigint[] = [];
  for (let i = 0; ; i++) {
    let minLoss: bigint;
    try {
      // c.call (et non readContract) : l'erreur garde le code JSON-RPC du nœud (readContract range -32603 en « revert »)
      const { data } = await c.call({
        to: sealedBounty, data: encodeFunctionData({ abi: SEALED_BOUNTY_READ_ABI, functionName: "tierMinLoss", args: [bountyId, BigInt(i)] }), blockNumber,
      });
      if (data === undefined) throw new Error("tierMinLoss : réponse vide");
      minLoss = decodeFunctionResult({ abi: SEALED_BOUNTY_READ_ABI, functionName: "tierMinLoss", data });
    } catch (e) {
      if (isJsonRpcRevert(e)) break; // fin du tableau : revert EVM (Panic 0x32 ; le RPC public d'Arc n'en rend pas les données)
      throw e; // erreur réseau ou interne du nœud : ne jamais tronquer les paliers en silence
    }
    if (i === MAX_TIERS) throw new Error(`prime #${bountyId} : plus de ${MAX_TIERS} paliers, non pris en charge`);
    tierMinLoss.push(minLoss);
  }
  return {
    predicateHash: b.predicateHash, protocolX25519: b.protocolX25519, tierMinLoss, deadline: b.deadline, productId: b.productId,
    exists: b.protocol.toLowerCase() !== zeroAddress,
  };
}

/** La prime sans le drapeau `exists`, mise en cache si elle existe. */
function keepBounty(cache: BountyCache, bountyId: bigint, v: BountyAt & { exists: boolean }): BountyAt {
  const { exists, ...view } = v;
  if (exists) cache.put(bountyId, view);
  return view;
}

/** v2.1 bis : vrai si l'erreur vient d'un revert EVM — code JSON-RPC 3 (EIP-1474) quelque part dans la chaîne des causes.
 *  Une erreur -32603 (interne), -32000 ou de transport n'en est pas un. */
export function isJsonRpcRevert(e: unknown): boolean {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) {
    if (x.code === 3) return true;
  }
  return false;
}

/** Lecteur on-chain d'une prime ET de ses paliers, par le quorum RPC (lectures au même bloc). v2.1 ter : une prime qui
 *  existe est lue UNE fois (champs immuables, BountyCache) ; `cache` peut être partagé avec chainRefuteReader. */
export function chainBountyReader(rpc: RpcQuorum, sealedBounty: Address, cache: BountyCache = new BountyCache()): BountyReader {
  return {
    getBounty: async (bountyId: bigint) => {
      const hit = cache.get(bountyId);
      if (hit) return hit;
      return keepBounty(cache, bountyId, await rpc.readAtCommonHead((c, blockNumber) => readBountyAt(c, sealedBounty, bountyId, blockNumber)));
    },
  };
}

/**
 * v2.1 : lecteur on-chain d'une réclamation à réfuter, par le quorum RPC, TOUT au même bloc : claimRecords(digest),
 * REFUTE_WINDOW, la prime (produit, prédicat, clé du protocole, paliers), l'opérateur actif de CETTE enclave pour le
 * produit de la prime (EnclaveRegistry.activeOperatorAt) et l'horodatage du bloc (la fenêtre se compte comme le contrat).
 * v2.1 ter : REFUTE_WINDOW (constante du contrat) et la prime (champs immuables) ne sont lus qu'une fois (BountyCache).
 */
export function chainRefuteReader(rpc: RpcQuorum, sealedBounty: Address, registry: Address, cache: BountyCache = new BountyCache()): RefuteReader {
  let window: bigint | undefined; // SealedBounty.REFUTE_WINDOW : constante
  return {
    // v2.1 bis : la lecture bon marché faite d'abord (tête commune + claimRecords, une lecture par fournisseur)
    record: ({ claimDigest }) =>
      rpc.readAtCommonHead(async (c, blockNumber) => {
        const [acceptedAt, refuted, opsHash] = await c.readContract({
          address: sealedBounty, abi: SEALED_BOUNTY_READ_ABI, functionName: "claimRecords", args: [claimDigest], blockNumber,
        });
        return { block: blockNumber, record: { acceptedAt: BigInt(acceptedAt), refuted, opsHash } };
      }),
    read: async ({ claimDigest, bountyId, signer }) => {
      const cached = cache.get(bountyId);
      const knownWindow = window;
      const v = await rpc.readAtCommonHead(async (c, blockNumber) => {
        const [acceptedAt, refuted, opsHash] = await c.readContract({
          address: sealedBounty, abi: SEALED_BOUNTY_READ_ABI, functionName: "claimRecords", args: [claimDigest], blockNumber,
        });
        const refuteWindow = knownWindow
          ?? BigInt(await c.readContract({ address: sealedBounty, abi: SEALED_BOUNTY_READ_ABI, functionName: "REFUTE_WINDOW", blockNumber }));
        const bounty = cached ? { ...cached, exists: true } : await readBountyAt(c, sealedBounty, bountyId, blockNumber);
        const myOperator = await c.readContract({
          address: registry, abi: ENCLAVE_REGISTRY_ACTIVE_ABI, functionName: "activeOperatorAt", args: [signer, bounty.productId, blockNumber], blockNumber,
        });
        const block = await c.getBlock({ blockNumber, includeTransactions: false });
        return {
          block: blockNumber,
          blockTimestamp: block.timestamp,
          record: { acceptedAt: BigInt(acceptedAt), refuted, opsHash },
          refuteWindow,
          bounty,
          myOperator,
        };
      });
      window = v.refuteWindow; // lu en quorum : la constante du contrat
      return { ...v, bounty: keepBounty(cache, bountyId, v.bounty) };
    },
  };
}

/** Retiré en v2.1 bis : il rangeait une erreur interne du nœud (-32603) parmi les reverts. Voir isJsonRpcRevert. */
export const isRevert = isJsonRpcRevert;
