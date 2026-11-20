/** proxy.ts — a local OpenAI-compatible proxy. Any program that talks to OpenAI works once its base URL points to
 *  http://localhost:8787/v1 and it passes the aek_ key as its token.
 *  The proxy encrypts each request for the enclave, signs it with the session key, then verifies and decrypts each
 *  answer and its receipt. Only this proxy, on the developer's machine, sees the plaintext.
 *  At start, then at intervals, the enclave's keys are checked against the chain (registered X25519 key, active
 *  enclave, the session's locked enclave); an answer it did not sign is refused. */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createPublicClient, http } from "viem";
import {
  arcTestnet, createInferenceClient, decodeAek, EnclaveKeyMismatchError, InferenceClient, InsufficientSessionBalance,
  ReceiptMismatchError, SessionExpiredError,
} from "@arcvault/sdk";

export interface ProxyOpts { aek: string; enclaveUrl: string; port?: number; rpcUrl?: string; }

export async function startProxy(o: ProxyOpts) {
  const { sessionId, sessionPrivateKey } = decodeAek(o.aek);
  const pub = createPublicClient({ chain: arcTestnet, transport: http(o.rpcUrl) });
  const ic: InferenceClient = createInferenceClient({
    enclaveUrl: o.enclaveUrl, sessionId, publicClient: pub as any,
    sessionKey: { privateKey: sessionPrivateKey, address: "0x0000000000000000000000000000000000000000" },
  });
  const port = o.port ?? 8787;
  // before listening: the enclave's keys must be the ones registered on-chain for THIS session
  const keys = await ic.verifiedKeys();
  const app = new Hono();

  app.get("/v1/models", async (c) => c.json((await ic.models.list()) as any));

  app.post("/v1/chat/completions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const res = await ic.chat.completions.create({ messages: body.messages ?? [], temperature: body.temperature, max_tokens: body.max_tokens, seed: body.seed });
      return c.json({
        id: `arc-${res.receipt.sessionId}-${res.receipt.seq}`,
        object: "chat.completion",
        model: body.model ?? "arc-sealed-chat",
        choices: [{ index: 0, message: { role: "assistant", content: res.text }, finish_reason: "stop" }],
        usage: { prompt_tokens: Number(res.receipt.tokensIn), completion_tokens: Number(res.receipt.tokensOut), total_tokens: Number(res.receipt.tokensIn + res.receipt.tokensOut) },
        x_arc: { verified: res.verified, cumulativeUnits: res.receipt.cumulativeUnits.toString(), anchorBlock: res.receipt.anchorBlock.toString() },
      });
    } catch (e) {
      if (e instanceof InsufficientSessionBalance) {
        return c.json({ error: { message: e.message, balance: e.balance.toString(), ...(e.pending ? { pendingSeq: e.pending.seq.toString(), pendingCost: e.pending.cost.toString() } : {}) } }, 402);
      }
      if (e instanceof SessionExpiredError) return c.json({ error: { message: e.message } }, 410);
      if (e instanceof EnclaveKeyMismatchError || e instanceof ReceiptMismatchError) return c.json({ error: { message: e instanceof EnclaveKeyMismatchError ? e.en : e.message } }, 502);
      return c.json({ error: { message: String((e as any)?.message ?? e) } }, 500);
    }
  });

  // listens on the machine itself only. Without a hostname, Node would listen on every interface, and anyone on the
  // same network could spend the session (the proxy has no password).
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
  console.log(`local OpenAI proxy: http://localhost:${port}/v1  (session #${sessionId} → ${o.enclaveUrl})`);
  console.log(`enclave verified on-chain: ${keys.signer} (operator ${keys.operator}, registered X25519 key, active at block ${keys.checkedAtBlock})`);
  console.log(`Example: openai.base_url = "http://localhost:${port}/v1"; call /chat/completions in a loop.`);
}
