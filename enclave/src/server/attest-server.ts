/**
 * attest-server.ts — les points d'accès communs du kit (O1), vus par l'opérateur et le public.
 *   POST /attest   (opérateur) : { operator, anchorR } -> { quote, eventLog, signer, x25519, mock }
 *   GET  /pubkeys  (public)    : { signer, x25519, lastQuote }
 *   GET  /health
 *
 * `sign`, `seal`, `open` et le mandataire RPC restent INTERNES (utilisés par les services O2/O3),
 * jamais exposés en HTTP.
 *
 * v2 — /attest ne lie plus l'enclave à n'importe quelle adresse (sinon un tiers obtient un quote à
 * SON nom pour l'enclave d'un autre, l'inscrit avant lui et encaisse son travail) :
 *  1. OPERATOR_ALLOWLIST (adresses séparées par des virgules) : toute autre adresse est refusée (403).
 *     v2 bis (revue adverse du 7/11) : on échoue FERMÉ — non définie ou vide, personne n'est autorisé (avant,
 *     une variable oubliée dans le compose ouvrait /attest à n'importe qui). Le mode développement (toute
 *     adresse, avec avertissement) se demande explicitement : OPERATOR_ALLOWLIST=*.
 *  2. Si la clé de cette enclave est déjà inscrite on-chain (EnclaveRegistry.enclaveOf(signer).operator
 *     ≠ 0, lu par le quorum RPC du kit) pour un AUTRE opérateur : refus (409). Lecture impossible : 503.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Address, getAddress, isAddress, zeroAddress } from "viem";
import { EnclaveKit, type EnclaveConfig } from "../kit/enclave-kit";
import { RpcQuorum } from "../kit/rpc-quorum";

export interface AttestServerOptions {
  /**
   * Opérateurs autorisés à recevoir un quote. `undefined` : lue dans OPERATOR_ALLOWLIST ;
   * `null` : mode développement EXPLICITE (toute adresse, avec avertissement) ; liste : seules ces
   * adresses (vide : personne).
   */
  operatorAllowlist?: readonly Address[] | null;
  /**
   * Opérateur sous lequel la clé de cette enclave est déjà inscrite on-chain (adresse nulle si
   * aucun), ou `null` si la chaîne n'est pas lisible ici. Défaut : `kit.registeredOperator()`
   * (EnclaveRegistry.enclaveOf via le quorum RPC du kit).
   */
  registeredOperator?: () => Promise<Address | null>;
  /** Journal des avertissements (défaut : console.warn). */
  warn?: (message: string) => void;
}

/**
 * Lit OPERATOR_ALLOWLIST. v2 bis, échoue fermé : variable absente ou vide → `[]` (personne) ;
 * `*` → `null` = mode développement explicite (toute adresse) ; sinon la liste des adresses.
 * Une adresse invalide arrête le démarrage.
 */
export function parseOperatorAllowlist(raw: string | undefined): Address[] | null {
  if (raw === undefined) return [];
  if (raw.trim() === "*") return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.map((p) => {
    if (!isAddress(p)) throw new Error(`OPERATOR_ALLOWLIST : adresse invalide « ${p} »`);
    return getAddress(p);
  });
}

export function createAttestServer(kit: EnclaveKit, opts: AttestServerOptions = {}): Hono {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const allowlist =
    opts.operatorAllowlist === undefined ? parseOperatorAllowlist(process.env.OPERATOR_ALLOWLIST) : opts.operatorAllowlist;
  const allowed = allowlist === null ? null : new Set(allowlist.map((a) => a.toLowerCase()));
  const registeredOperator = opts.registeredOperator ?? (() => kit.registeredOperator());

  if (allowed === null) {
    warn(
      "⚠️ OPERATOR_ALLOWLIST=* : mode développement, /attest atteste pour N'IMPORTE QUELLE adresse " +
        "d'opérateur. En production, la définir avec l'adresse de l'opérateur (celle qui a déposé la caution).",
    );
  } else if (allowed.size === 0) {
    warn(
      "⚠️ OPERATOR_ALLOWLIST non définie ou vide : /attest refusera tout opérateur (on échoue fermé). " +
        "La définir avec l'adresse de l'opérateur (ou * en développement).",
    );
  }

  const app = new Hono();
  // Appelée depuis n'importe quel site (le nôtre, celui d'un développeur) : CORS ouvert.
  // Sans risque : tout ce qui sort est public (clés publiques, quote) ou chiffré/signé (réponses, reçus).
  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/pubkeys", (c) => c.json(kit.pubkeys()));

  app.post("/attest", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.operator !== "string" || body.anchorR === undefined) {
      return c.json({ error: "attendu { operator, anchorR }" }, 400);
    }
    if (!isAddress(body.operator, { strict: false })) {
      return c.json({ error: `operator : adresse invalide « ${body.operator} »` }, 400);
    }
    const anchorR = parseBlockNumber(body.anchorR);
    if (anchorR === null) return c.json({ error: "anchorR : numéro de bloc invalide" }, 400);
    const operator = getAddress(body.operator.toLowerCase());

    // 1) liste blanche des opérateurs de CETTE enclave
    if (allowed !== null && !allowed.has(operator.toLowerCase())) {
      return c.json({ error: `opérateur ${operator} non autorisé sur cette enclave (OPERATOR_ALLOWLIST)` }, 403);
    }
    if (allowed === null) warn(`⚠️ /attest en mode développement (OPERATOR_ALLOWLIST=*) : quote pour l'opérateur ${operator}`);

    // 2) la clé de cette enclave appartient-elle déjà on-chain à un autre opérateur ?
    let onchain: Address | null;
    try {
      onchain = await registeredOperator();
    } catch (e) {
      return c.json(
        { error: `lecture on-chain de l'EnclaveRegistry impossible, attestation refusée : ${(e as Error).message}` },
        503,
      );
    }
    if (onchain === null) {
      warn("⚠️ /attest sans RPC : l'inscription on-chain de la clé de l'enclave n'a pas été vérifiée (développement)");
    } else if (onchain.toLowerCase() !== zeroAddress && onchain.toLowerCase() !== operator.toLowerCase()) {
      return c.json(
        {
          error: `la clé de cette enclave (${kit.keys.signer}) est déjà inscrite on-chain pour l'opérateur ${onchain} : quote refusé pour ${operator}`,
          registeredOperator: onchain,
        },
        409,
      );
    }

    try {
      const out = await kit.attest({ operator, anchorR });
      return c.json({
        quote: out.quote,
        eventLog: out.eventLog,
        signer: out.signer,
        x25519: out.x25519,
        mock: out.mock,
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  return app;
}

/** Numéro de bloc : entier ≥ 0 (nombre entier ou chaîne décimale/hexadécimale), sinon null. */
function parseBlockNumber(x: unknown): bigint | null {
  if (typeof x === "number" && !Number.isSafeInteger(x)) return null;
  if (typeof x !== "number" && typeof x !== "string" && typeof x !== "bigint") return null;
  if (typeof x === "string" && !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(x.trim())) return null;
  try {
    const v = BigInt(typeof x === "string" ? x.trim() : x);
    return v >= 0n && v < 2n ** 64n ? v : null;
  } catch {
    return null;
  }
}

/** Construit un kit depuis l'environnement (lancement direct dans la VM). */
export function kitFromEnv(): EnclaveKit {
  const cfg: EnclaveConfig = {
    productId: BigInt(process.env.PRODUCT_ID ?? "0"),
    chainId: Number(process.env.CHAIN_ID ?? "5042002"),
    registry: (process.env.REGISTRY ?? "0x0000000000000000000000000000000000000000") as Address,
    mockBlockHash: process.env.MOCK_BLOCKHASH === "1",
  };
  const rpcUrls = (process.env.RPC_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (rpcUrls.length > 0) cfg.rpc = new RpcQuorum(rpcUrls);
  return new EnclaveKit(cfg);
}
