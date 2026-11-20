/**
 * sealed-x402/app.ts — the HTTP application of the "inference paid per call" product (x402), without side effects:
 * built from the kit and the gateway, so testable outside a VM.
 *
 *   POST /v1/chat/completions  body { enc, ciphertext, clientEphemeralPub } (HPKE, as in sealed-chat)
 *                              without X-PAYMENT: 402 + x402 requirements; with it: 200 + encrypted answer + signed CallReceipt
 *   GET  /v1/models            the model, the price of one call (read on-chain), the settlement
 *   GET  /x402/pending         served, unsettled calls: (receipt, signature, auth) = the arguments of X402Settler.settle;
 *                              public without risk: a settlement can pay only the enclave's operator (and the author,
 *                              the network); the published hashes are salted by the client. Evening of 9 Nov: in pages
 *                              (?limit=1..500&offset=N, `total` says how many there are); the payers' balances are read
 *                              again first (at most once every 10 s, bounded budget) and the COVERED calls come first
 *                              (`covered`), the "not covered" ones after
 *   POST /x402/settled         RESTRICTED TO THE OPERATOR (9 Nov): { enclave, productId, issuedAt, ackNonce, items: [{ payer,
 *                              nonce, settled }], signature } signed with EIP-712 by an address of OPERATOR_ALLOWLIST,
 *                              timestamped, single-use, rate-bounded (see src/services/x402-ack.ts); items deduplicated,
 *                              at most one on-chain read per pending key; the ones the chain says are consumed leave the
 *                              queue; only those the operator says were SETTLED through X402Settler (`settled` true) make
 *                              their payer "known". Without a valid signature: 401/403, nothing is read.
 *   + /attest, /pubkeys, /health (kit, src/server/attest-server.ts)
 * The rate of paid requests (evening of 9 Nov): the IP address SEEN by the enclave (the TCP peer) is passed to the
 * gateway for its per-IP cap; behind the Phala gateway it is the gateway's for everyone (approximate).
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
  /** Options of /attest (default: OPERATOR_ALLOWLIST read from the environment). */
  attest?: AttestServerOptions;
  /** Log of internal errors (default: console.error). Never any call content. */
  log?: (m: string) => void;
}

/** The TCP peer's IP address, as the enclave sees it (no header is trusted: nothing here authenticates a proxy);
 *  absent outside a Node server (tests). An IPv4 address written as IPv6 ("::ffff:a.b.c.d") is brought back to IPv4. */
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
  // hexadecimal body (×2) of the encrypted request + fields and margin
  const maxBody = 2 * (g.limits.maxRequestBytes + 16) + 8192;
  const tooLarge = bodyLimit({
    maxSize: maxBody,
    onError: (c) => c.json({ error: `request too large: at most ${g.limits.maxRequestBytes} bytes in clear`, code: "request_too_large" }, 413),
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log(`[sealed-x402] internal error: ${err?.name ?? "Error"}`);
    return c.json({ error: "internal enclave error: nothing was billed" }, 500);
  });

  app.get("/v1/models", async (c) => {
    let pricePerCall: string | null = null;
    let reason: string | undefined;
    try {
      pricePerCall = (await g.challenge(new URL("/v1/chat/completions", c.req.url).toString()))[0]!.maxAmountRequired;
    } catch (e) {
      reason = e instanceof X402Error ? e.message : "unreadable on-chain state";
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
            pricePerCall, // USDC, 6 decimals; null if the enclave cannot be paid right now
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
        // x402 v1 format: { x402Version, error, accepts }; `detail` explains the refusal in words
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
    // balances read again before the sorting (10 s cache, bounded budget, an outage changes nothing): covered calls first
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
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "at most 64 KiB", code: "request_too_large" }, 413) }),
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
