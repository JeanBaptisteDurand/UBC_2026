/**
 * sealed-x402/app.ts — l'application HTTP du produit « inférence payée à l'appel » (x402), sans effet de bord : construite
 * à partir du kit et de la passerelle, donc testable hors VM.
 *
 *   POST /v1/chat/completions  corps { enc, ciphertext, clientEphemeralPub } (HPKE, comme sealed-chat)
 *                              sans X-PAYMENT : 402 + exigences x402 ; avec : 200 + réponse chiffrée + CallReceipt signé
 *   GET  /v1/models            modèle, prix d'un appel (lu on-chain), règlement
 *   GET  /x402/pending         appels servis non réglés : (receipt, signature, auth) = arguments de X402Settler.settle ;
 *                              public sans risque : un règlement ne peut payer que l'opérateur de l'enclave (et l'auteur,
 *                              le réseau) ; les hash publiés sont salés par le client. 9/11 au soir : par pages
 *                              (?limit=1..500&offset=N, `total` dit combien il y en a) ; les soldes des payeurs sont
 *                              relus d'abord (au plus une fois toutes les 10 s, budget borné) et les appels COUVERTS
 *                              viennent en tête (`covered`), les « non couverts » ensuite
 *   POST /x402/settled         RÉSERVÉ À L'OPÉRATEUR (9/11) : { enclave, productId, issuedAt, ackNonce, items: [{ payer,
 *                              nonce, settled }], signature } signé en EIP-712 par une adresse d'OPERATOR_ALLOWLIST,
 *                              horodaté, à usage unique, borné en débit (voir src/services/x402-ack.ts) ; items
 *                              dédoublonnés, une lecture on-chain par clé en attente au plus ; sortent de la file ceux que
 *                              la chaîne dit consommés ; seuls ceux que l'opérateur dit RÉGLÉS par X402Settler
 *                              (`settled` vrai) rendent leur payeur « connu ». Sans signature valide : 401/403, rien n'est lu.
 *   + /attest, /pubkeys, /health (kit, src/server/attest-server.ts)
 * Débit des requêtes payées (9/11 au soir) : l'adresse IP VUE par l'enclave (pair TCP) est passée à la passerelle pour
 * son plafond par IP ; derrière la passerelle Phala c'est celle de la passerelle pour tout le monde (approximatif).
 */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { EnclaveKit } from "../../src/kit/enclave-kit";
import { createAttestServer, type AttestServerOptions } from "../../src/server/attest-server";
import { X402Error, type X402Gateway } from "../../src/services/x402-gateway";
import { X402_UNITS_PER_CALL } from "../../src/services/x402";

export interface SealedX402Deps {
  kit: EnclaveKit;
  gateway: X402Gateway;
  /** Options de /attest (défaut : OPERATOR_ALLOWLIST lue dans l'environnement). */
  attest?: AttestServerOptions;
  /** Journal des erreurs internes (défaut : console.error). Jamais de contenu d'appel. */
  log?: (m: string) => void;
}

/** L'adresse IP du pair TCP, telle que l'enclave la voit (aucun en-tête n'est cru : rien ici n'authentifie un mandataire) ;
 *  absente hors serveur Node (tests). Une adresse IPv4 écrite en IPv6 (« ::ffff:a.b.c.d ») est ramenée à IPv4. */
export function seenIp(c: Context): string | undefined {
  try {
    const a = getConnInfo(c).remote.address;
    return typeof a === "string" && a ? a.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1") : undefined;
  } catch {
    return undefined;
  }
}

export function createSealedX402App(d: SealedX402Deps): Hono {
  const app = createAttestServer(d.kit, d.attest); // /attest, /pubkeys, /health, CORS
  const g = d.gateway;
  const log = d.log ?? ((m: string) => console.error(m));
  // corps hexadécimal (×2) de la requête chiffrée + champs et marge
  const maxBody = 2 * (g.limits.maxRequestBytes + 16) + 8192;
  const tooLarge = bodyLimit({
    maxSize: maxBody,
    onError: (c) => c.json({ error: `requête trop grande : au plus ${g.limits.maxRequestBytes} octets en clair`, code: "request_too_large" }, 413),
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log(`[sealed-x402] erreur interne : ${err?.name ?? "Error"}`);
    return c.json({ error: "erreur interne de l'enclave : rien n'a été facturé" }, 500);
  });

  app.get("/v1/models", async (c) => {
    let pricePerCall: string | null = null;
    let reason: string | undefined;
    try {
      pricePerCall = (await g.challenge(new URL("/v1/chat/completions", c.req.url).toString()))[0]!.maxAmountRequired;
    } catch (e) {
      reason = e instanceof X402Error ? e.message : "état on-chain illisible";
    }
    return c.json({
      object: "list",
      data: [
        {
          id: g.modelLabel,
          modelHash: g.modelHash,
          owned_by: "arc-enclave-network",
          billing: {
            scheme: "x402-exact",
            network: g.network,
            productId: g.productId.toString(),
            payTo: g.settler,
            asset: g.usdc,
            unitsPerCall: X402_UNITS_PER_CALL.toString(),
            pricePerCall, // USDC, 6 décimales ; null si l'enclave ne peut pas être payée maintenant
            payable: pricePerCall !== null,
            ...(reason ? { reason } : {}),
            maxOutputTokens: g.limits.maxOutputTokens,
            maxRequestBytes: g.limits.maxRequestBytes,
            authorization: { minValiditySeconds: g.limits.minSettleWindowSeconds, maxTimeoutSeconds: g.limits.announcedValiditySeconds },
          },
        },
      ],
    });
  });

  app.post("/v1/chat/completions", tooLarge, async (c) => {
    const body = await c.req.json().catch(() => null);
    try {
      const r = await g.handle({ envelope: body, xPayment: c.req.header("x-payment") ?? null, resource: c.req.url, clientIp: seenIp(c) });
      return c.json(r.replay ? { ...r.body, replay: true } : r.body, 200);
    } catch (e) {
      if (!(e instanceof X402Error)) throw e;
      if (e.httpStatus === 402) {
        // format x402 v1 : { x402Version, error, accepts } ; `detail` en français
        return c.json({ x402Version: 1, error: e.code, detail: e.message, accepts: e.accepts ?? [] }, 402);
      }
      return c.json({ error: e.message, code: e.code }, e.httpStatus);
    }
  });

  app.get("/x402/pending", async (c) => {
    const raw = c.req.query("limit");
    const n = raw && /^[0-9]{1,4}$/.test(raw) ? Number(raw) : 100;
    const rawOffset = c.req.query("offset");
    const offset = rawOffset && /^[0-9]{1,6}$/.test(rawOffset) ? Number(rawOffset) : 0;
    // soldes relus avant le classement (cache de 10 s, budget borné, une panne ne change rien) : couverts d'abord
    await g.refreshCoverage().catch(() => {});
    const limit = Math.min(Math.max(n, 1), 500);
    const p = g.pending(limit, offset);
    return c.json({
      enclave: g.enclave,
      productId: g.productId.toString(),
      chainId: g.chainId,
      settler: g.settler,
      total: p.total,
      offset,
      limit,
      items: p.items,
    });
  });

  app.post(
    "/x402/settled",
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "au plus 64 Kio", code: "request_too_large" }, 413) }),
    async (c) => {
      const b = await c.req.json().catch(() => null);
      try {
        return c.json(await g.acknowledgeSigned(b));
      } catch (e) {
        if (!(e instanceof X402Error)) throw e;
        return c.json({ error: e.message, code: e.code }, e.httpStatus);
      }
    },
  );

  return app;
}
