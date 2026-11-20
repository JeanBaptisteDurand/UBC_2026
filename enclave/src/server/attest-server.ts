/**
 * attest-server.ts — the kit's common endpoints (O1), as the operator and the public see them.
 *   POST /attest   (operator): { operator, anchorR } -> { quote, eventLog, signer, x25519, mock }
 *   GET  /pubkeys  (public)  : { signer, x25519, lastQuote }
 *   GET  /health
 *
 * `sign`, `seal`, `open` and the RPC proxy stay INTERNAL (used by the O2/O3 services), never exposed over HTTP.
 *
 * v2: /attest no longer binds the enclave to any address (otherwise a third party could get a quote in ITS name for
 * someone else's enclave, register it first and collect the work):
 *  1. OPERATOR_ALLOWLIST (comma-separated addresses): any other address is refused (403).
 *     v2 bis (adversarial review of 7 Nov): it fails CLOSED. Unset or empty, nobody is authorized (before, a variable
 *     forgotten in the compose file opened /attest to anyone). Development mode (any address, with a warning) is
 *     requested explicitly: OPERATOR_ALLOWLIST=*.
 *  2. If this enclave's key is already registered on-chain (EnclaveRegistry.enclaveOf(signer).operator ≠ 0, read
 *     through the kit's RPC quorum) for ANOTHER operator: refused (409). If the read fails: 503.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Address, getAddress, isAddress, zeroAddress } from "viem";
import { EnclaveKit, type EnclaveConfig } from "../kit/enclave-kit";
import { RpcQuorum } from "../kit/rpc-quorum";

export interface AttestServerOptions {
  /**
   * Operators allowed to receive a quote. `undefined`: read from OPERATOR_ALLOWLIST; `null`: EXPLICIT development
   * mode (any address, with a warning); a list: only these addresses (empty: nobody).
   */
  operatorAllowlist?: readonly Address[] | null;
  /**
   * The operator under which this enclave's key is already registered on-chain (the zero address if none), or `null`
   * if the chain cannot be read here. Default: `kit.registeredOperator()` (EnclaveRegistry.enclaveOf through the
   * kit's RPC quorum).
   */
  registeredOperator?: () => Promise<Address | null>;
  /** Warning log (default: console.warn). */
  warn?: (message: string) => void;
}

/**
 * Reads OPERATOR_ALLOWLIST. v2 bis, it fails closed: a missing or empty variable → `[]` (nobody); `*` → `null` =
 * explicit development mode (any address); otherwise the list of addresses.
 * An invalid address stops the start-up.
 */
export function parseOperatorAllowlist(raw: string | undefined): Address[] | null {
  if (raw === undefined) return [];
  if (raw.trim() === "*") return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.map((p) => {
    if (!isAddress(p)) throw new Error(`OPERATOR_ALLOWLIST: invalid address "${p}"`);
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
      "⚠️ OPERATOR_ALLOWLIST=*: development mode, /attest attests for ANY operator address. " +
        "In production, set it to the operator's address (the one that deposited the bond).",
    );
  } else if (allowed.size === 0) {
    warn(
      "⚠️ OPERATOR_ALLOWLIST unset or empty: /attest will refuse every operator (it fails closed). " +
        "Set it to the operator's address (or * in development).",
    );
  }

  const app = new Hono();
  // Called from any site (ours, a developer's): open CORS.
  // No risk: everything that leaves is public (public keys, quote) or encrypted and signed (replies, receipts).
  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/pubkeys", (c) => c.json(kit.pubkeys()));

  app.post("/attest", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.operator !== "string" || body.anchorR === undefined) {
      return c.json({ error: "expected { operator, anchorR }" }, 400);
    }
    if (!isAddress(body.operator, { strict: false })) {
      return c.json({ error: `operator: invalid address "${body.operator}"` }, 400);
    }
    const anchorR = parseBlockNumber(body.anchorR);
    if (anchorR === null) return c.json({ error: "anchorR: invalid block number" }, 400);
    const operator = getAddress(body.operator.toLowerCase());

    // 1) the allowlist of THIS enclave's operators
    if (allowed !== null && !allowed.has(operator.toLowerCase())) {
      return c.json({ error: `operator ${operator} not authorized on this enclave (OPERATOR_ALLOWLIST)` }, 403);
    }
    if (allowed === null) warn(`⚠️ /attest in development mode (OPERATOR_ALLOWLIST=*): quote for operator ${operator}`);

    // 2) does this enclave's key already belong on-chain to another operator?
    let onchain: Address | null;
    try {
      onchain = await registeredOperator();
    } catch (e) {
      return c.json(
        { error: `the on-chain read of the EnclaveRegistry failed, attestation refused: ${(e as Error).message}` },
        503,
      );
    }
    if (onchain === null) {
      warn("⚠️ /attest without RPC: the on-chain registration of the enclave's key was not checked (development)");
    } else if (onchain.toLowerCase() !== zeroAddress && onchain.toLowerCase() !== operator.toLowerCase()) {
      return c.json(
        {
          error: `this enclave's key (${kit.keys.signer}) is already registered on-chain for operator ${onchain}: quote refused for ${operator}`,
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

/** A block number: an integer ≥ 0 (an integer number or a decimal or hexadecimal string), otherwise null. */
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

/** Builds a kit from the environment (direct launch in the VM). */
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
