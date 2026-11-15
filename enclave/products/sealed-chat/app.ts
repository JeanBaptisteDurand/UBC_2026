/**
 * sealed-chat/app.ts — l'application HTTP du produit « inférence d'IA en enclave » (O2), sans effet de
 * bord : construite à partir du kit, de la passerelle et du lecteur de sessions, donc testable hors VM.
 * Routes compatibles OpenAI, plus le « dernier reçu » de la session (v2) que l'opérateur règle.
 * 9/11 (vérificateur) : toute erreur inattendue reçoit un message générique avec un code (onError) : upstream_model
 * (502 : le modèle amont a échoué ; son corps n'est jamais lu, voir model.ts ; aucun reçu signé) ou internal_error
 * (500). Au journal, seulement le code et le nom de l'erreur : jamais son message (il peut porter une URL de RPC à clé,
 * ou ce que l'amont a renvoyé), jamais le contenu d'une requête.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { encodeAbiParameters, isHex, keccak256, recoverMessageAddress, size, toBytes, toHex, type Hex } from "viem";
import type { EnclaveKit } from "../../src/kit/enclave-kit";
import type { Receipt } from "../../src/kit/eip712";
import { createAttestServer, type AttestServerOptions } from "../../src/server/attest-server";
import { GatewayError, type InferenceGateway, type SessionReader, type SessionView } from "../../src/services/inference";
import { UpstreamModelError } from "./model";

export interface SealedChatDeps {
  kit: EnclaveKit;
  gateway: InferenceGateway;
  reader: SessionReader;
  modelHash: Hex;
  /** Options de /attest (défaut : OPERATOR_ALLOWLIST lue dans l'environnement). */
  attest?: AttestServerOptions;
  /** Journal des erreurs internes (défaut : console.error). Seulement un code et un nom d'erreur. */
  log?: (m: string) => void;
}

const MAX_UINT64 = 2n ** 64n - 1n;
const MAX_UINT256 = 2n ** 256n - 1n;

export function createSealedChatApp(d: SealedChatDeps): Hono {
  const app = createAttestServer(d.kit, d.attest); // /attest, /pubkeys, /health
  const log = d.log ?? ((m: string) => console.error(m));

  // erreurs inattendues : message générique + code ; jamais le message de l'erreur (ni au client, ni au journal)
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof UpstreamModelError) {
      log(`[sealed-chat] upstream_model : HTTP ${err.upstreamStatus ?? "réponse illisible"}`);
      return c.json(
        {
          error: "le modèle amont n'a pas répondu correctement : aucun reçu n'a été signé, rejouez la même requête (même seq)",
          code: "upstream_model",
          ...(err.upstreamStatus !== null ? { upstreamStatus: err.upstreamStatus } : {}),
        },
        502,
      );
    }
    log(`[sealed-chat] internal_error : ${err instanceof Error ? err.name : "erreur"}`);
    return c.json({ error: "erreur interne de l'enclave", code: "internal_error" }, 500);
  });

  app.get("/v1/models", (c) =>
    c.json({
      object: "list",
      data: [
        {
          id: "arc-sealed-chat",
          modelHash: d.modelHash,
          owned_by: "arc-enclave-network",
          // v2 : comment l'enclave compte les unités facturées (mesuré dans l'image, donc dans le workloadId)
          billing: {
            unitTokens: d.gateway.billing.unitTokens.toString(),
            outWeight: d.gateway.billing.outWeight.toString(),
            formula: "unités = ceil((cumul jetons d'entrée + outWeight × cumul jetons de sortie) / unitTokens)",
          },
        },
      ],
    }),
  );

  app.post("/v1/chat/completions", async (c) => {
    const body = (await c.req.json().catch(() => null)) as any;
    if (!body?.sessionId || !body?.ciphertext || !body?.signature || !body?.enc || !body?.clientEphemeralPub) {
      return c.json({ error: "enveloppe invalide" }, 400);
    }
    if (![body.ciphertext, body.signature, body.enc, body.clientEphemeralPub].every((x) => isHex(x))) {
      return c.json({ error: "enveloppe invalide (champs hexadécimaux attendus)" }, 400);
    }
    if (size(body.clientEphemeralPub as Hex) !== 32) {
      return c.json({ error: "enveloppe invalide (clientEphemeralPub : 32 octets attendus)" }, 400);
    }
    const sessionId = parseUint(body.sessionId, MAX_UINT256);
    const seq = parseUint(body.seq, MAX_UINT64);
    if (sessionId === null || seq === null || seq === 0n) return c.json({ error: "sessionId ou seq invalide" }, 400);

    try {
      // 1) authentifier la clé de session (signature sur le digest d'enveloppe)
      const s = await d.reader.getSession(sessionId);
      const digest = envelopeDigest(sessionId, seq, body.ciphertext as Hex, body.clientEphemeralPub as Hex);
      const signer = await recoverMessageAddress({ message: { raw: digest }, signature: body.signature as Hex }).catch(
        () => null,
      );
      if (!signer || signer.toLowerCase() !== s.sessionKey.toLowerCase()) {
        return c.json({ error: "signature de session invalide" }, 401);
      }

      // 2) déchiffrer la requête (HPKE vers l'enclave)
      let prompt: string;
      try {
        prompt = new TextDecoder().decode(await d.kit.open(toBytes(body.enc as Hex), toBytes(body.ciphertext as Hex)));
      } catch {
        return c.json({ error: "requête indéchiffrable par cette enclave (mauvaise clé X25519 ?)" }, 400);
      }

      // 3) inférence + reçu signé (seq et cumul réservés atomiquement par la passerelle)
      const res = await d.gateway.handle(sessionId, seq, prompt, body.params ?? {});
      if (res.status === 402) {
        return c.json(
          {
            error: "insufficient_session_balance",
            balance: res.balance.toString(),
            // v2 bis : une réponse calculée attend que le solde la couvre ; recharger puis rejouer ce seq à l'identique
            ...(res.pending ? { pendingSeq: res.pending.seq.toString(), pendingCost: res.pending.cost.toString() } : {}),
          },
          402,
        );
      }

      // 4) chiffrer la réponse vers la clé éphémère du client
      const sealed = await d.kit.seal(toBytes(body.clientEphemeralPub as Hex), new TextEncoder().encode(res.text));
      return c.json({
        enc: toHex(sealed.enc),
        ciphertext: toHex(sealed.ciphertext),
        receipt: serializeReceipt(res.receipt),
        signature: res.signature,
      });
    } catch (e) {
      if (e instanceof GatewayError) return c.json({ error: e.message, ...e.details }, e.httpStatus);
      throw e;
    }
  });

  app.get("/v1/session/:id", async (c) => {
    const id = parseUint(c.req.param("id"), MAX_UINT256);
    if (id === null) return c.json({ error: "identifiant de session invalide" }, 400);
    const s: SessionView = await d.reader.getSession(id);
    return c.json({
      owner: s.owner,
      productId: s.productId.toString(),
      deposit: s.deposit.toString(),
      paidUnits: s.paidUnits.toString(),
      price: s.price.toString(),
      closed: s.closed,
    });
  });

  // v2 — le dernier reçu émis pour la session (gardé en mémoire), pour que l'opérateur le règle
  // (SessionPay.settle). Même format que la réponse de /v1/chat/completions.
  app.get("/v1/session/:id/receipt", (c) => {
    const id = parseUint(c.req.param("id"), MAX_UINT256);
    if (id === null) return c.json({ error: "identifiant de session invalide" }, 400);
    const last = d.gateway.lastReceipt(id);
    if (!last) return c.json({ error: "aucun reçu émis pour cette session par cette enclave depuis son démarrage" }, 404);
    return c.json({ receipt: serializeReceipt(last.receipt), signature: last.signature });
  });

  return app;
}

/** Réplique du digest d'enveloppe du SDK (signé par la clé de session). */
export function envelopeDigest(sessionId: bigint, seq: bigint, ciphertext: Hex, clientEphemeralPub: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }],
      [sessionId, seq, keccak256(ciphertext), clientEphemeralPub],
    ),
  );
}

export function serializeReceipt(r: Receipt) {
  return {
    productId: r.productId.toString(),
    sessionId: r.sessionId.toString(),
    seq: r.seq.toString(),
    modelHash: r.modelHash,
    paramsHash: r.paramsHash,
    requestHash: r.requestHash,
    responseHash: r.responseHash,
    tokensIn: r.tokensIn.toString(),
    tokensOut: r.tokensOut.toString(),
    cumulativeUnits: r.cumulativeUnits.toString(),
    anchorBlock: r.anchorBlock.toString(),
  };
}

/** Entier décimal ≥ 0 et ≤ max (chaîne ou nombre entier), sinon null. */
function parseUint(x: unknown, max: bigint): bigint | null {
  if (typeof x === "number") {
    if (!Number.isSafeInteger(x) || x < 0) return null;
    return BigInt(x) <= max ? BigInt(x) : null;
  }
  if (typeof x !== "string" || !/^[0-9]{1,78}$/.test(x)) return null;
  const v = BigInt(x);
  return v <= max ? v : null;
}
