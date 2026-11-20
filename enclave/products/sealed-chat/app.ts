/**
 * sealed-chat/app.ts — the HTTP application of the "AI inference in an enclave" product (O2), without side effects:
 * built from the kit, the gateway and the session reader, so testable outside a VM.
 * OpenAI-compatible routes, plus the session's "last receipt" (v2) that the operator settles.
 * 9 Nov (verifier): any unexpected error gets a generic message with a code (onError): upstream_model (502: the
 * upstream model failed; its body is never read, see model.ts; no receipt signed) or internal_error (500). The log
 * gets only the code and the error's name: never its message (it can carry an RPC URL with a key, or what upstream
 * returned), never the content of a request.
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
  /** Options of /attest (default: OPERATOR_ALLOWLIST read from the environment). */
  attest?: AttestServerOptions;
  /** Log of internal errors (default: console.error). Only a code and an error name. */
  log?: (m: string) => void;
}

const MAX_UINT64 = 2n ** 64n - 1n;
const MAX_UINT256 = 2n ** 256n - 1n;

export function createSealedChatApp(d: SealedChatDeps): Hono {
  const app = createAttestServer(d.kit, d.attest); // /attest, /pubkeys, /health
  const log = d.log ?? ((m: string) => console.error(m));

  // unexpected errors: a generic message + a code; never the error's message (neither to the client nor to the log)
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof UpstreamModelError) {
      log(`[sealed-chat] upstream_model: HTTP ${err.upstreamStatus ?? "unreadable answer"}`);
      return c.json(
        {
          error: "the upstream model did not answer correctly: no receipt was signed, replay the same request (same seq)",
          code: "upstream_model",
          ...(err.upstreamStatus !== null ? { upstreamStatus: err.upstreamStatus } : {}),
        },
        502,
      );
    }
    log(`[sealed-chat] internal_error: ${err instanceof Error ? err.name : "error"}`);
    return c.json({ error: "internal enclave error", code: "internal_error" }, 500);
  });

  app.get("/v1/models", (c) =>
    c.json({
      object: "list",
      data: [
        {
          id: "arc-sealed-chat",
          modelHash: d.modelHash,
          owned_by: "arc-enclave-network",
          // v2: how the enclave counts the billed units (measured in the image, so in the workloadId)
          billing: {
            unitTokens: d.gateway.billing.unitTokens.toString(),
            outWeight: d.gateway.billing.outWeight.toString(),
            formula: "units = ceil((running input tokens + outWeight × running output tokens) / unitTokens)",
          },
        },
      ],
    }),
  );

  app.post("/v1/chat/completions", async (c) => {
    const body = (await c.req.json().catch(() => null)) as any;
    if (!body?.sessionId || !body?.ciphertext || !body?.signature || !body?.enc || !body?.clientEphemeralPub) {
      return c.json({ error: "invalid envelope" }, 400);
    }
    if (![body.ciphertext, body.signature, body.enc, body.clientEphemeralPub].every((x) => isHex(x))) {
      return c.json({ error: "invalid envelope (hexadecimal fields expected)" }, 400);
    }
    if (size(body.clientEphemeralPub as Hex) !== 32) {
      return c.json({ error: "invalid envelope (clientEphemeralPub: 32 bytes expected)" }, 400);
    }
    const sessionId = parseUint(body.sessionId, MAX_UINT256);
    const seq = parseUint(body.seq, MAX_UINT64);
    if (sessionId === null || seq === null || seq === 0n) return c.json({ error: "invalid sessionId or seq" }, 400);

    try {
      // 1) authenticate the session key (signature on the envelope digest)
      const s = await d.reader.getSession(sessionId);
      const digest = envelopeDigest(sessionId, seq, body.ciphertext as Hex, body.clientEphemeralPub as Hex);
      const signer = await recoverMessageAddress({ message: { raw: digest }, signature: body.signature as Hex }).catch(
        () => null,
      );
      if (!signer || signer.toLowerCase() !== s.sessionKey.toLowerCase()) {
        return c.json({ error: "invalid session signature" }, 401);
      }

      // 2) decrypt the request (HPKE to the enclave)
      let prompt: string;
      try {
        prompt = new TextDecoder().decode(await d.kit.open(toBytes(body.enc as Hex), toBytes(body.ciphertext as Hex)));
      } catch {
        return c.json({ error: "request cannot be decrypted by this enclave (wrong X25519 key?)" }, 400);
      }

      // 3) inference + signed receipt (seq and running total reserved atomically by the gateway)
      const res = await d.gateway.handle(sessionId, seq, prompt, body.params ?? {});
      if (res.status === 402) {
        return c.json(
          {
            error: "insufficient_session_balance",
            balance: res.balance.toString(),
            // v2 bis: a computed answer waits for the balance to cover it; top up, then replay this seq unchanged
            ...(res.pending ? { pendingSeq: res.pending.seq.toString(), pendingCost: res.pending.cost.toString() } : {}),
          },
          402,
        );
      }

      // 4) encrypt the answer to the client's ephemeral key
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
    if (id === null) return c.json({ error: "invalid session id" }, 400);
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

  // v2: the last receipt issued for the session (kept in memory), so that the operator settles it
  // (SessionPay.settle). The same format as the answer of /v1/chat/completions.
  app.get("/v1/session/:id/receipt", (c) => {
    const id = parseUint(c.req.param("id"), MAX_UINT256);
    if (id === null) return c.json({ error: "invalid session id" }, 400);
    const last = d.gateway.lastReceipt(id);
    if (!last) return c.json({ error: "no receipt issued for this session by this enclave since it started" }, 404);
    return c.json({ receipt: serializeReceipt(last.receipt), signature: last.signature });
  });

  return app;
}

/** A copy of the SDK's envelope digest (signed by the session key). */
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

/** A decimal integer ≥ 0 and ≤ max (a string or an integer number), otherwise null. */
function parseUint(x: unknown, max: bigint): bigint | null {
  if (typeof x === "number") {
    if (!Number.isSafeInteger(x) || x < 0) return null;
    return BigInt(x) <= max ? BigInt(x) : null;
  }
  if (typeof x !== "string" || !/^[0-9]{1,78}$/.test(x)) return null;
  const v = BigInt(x);
  return v <= max ? v : null;
}
