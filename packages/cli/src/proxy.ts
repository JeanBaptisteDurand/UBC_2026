/** proxy.ts — mandataire local compatible OpenAI. Tout programme qui parle à OpenAI marche en
 *  changeant l'URL de base vers http://localhost:8787/v1 et en donnant la clé aek_ comme token.
 *  Le mandataire chiffre chaque requête pour l'enclave, la signe avec la clé de session, vérifie
 *  et déchiffre chaque réponse et son reçu. Seul ce mandataire, sur la machine du dev, voit le clair.
 *  v2 : au démarrage puis régulièrement, les clés de l'enclave sont confrontées à la chaîne (clé X25519 inscrite,
 *  enclave active, enclave verrouillée de la session) ; une réponse non signée par elle est refusée. */
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
  // avant d'écouter : les clés de l'enclave doivent être celles inscrites on-chain pour CETTE session
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
      if (e instanceof EnclaveKeyMismatchError || e instanceof ReceiptMismatchError) return c.json({ error: { message: e.message } }, 502);
      return c.json({ error: { message: String((e as any)?.message ?? e) } }, 500);
    }
  });

  serve({ fetch: app.fetch, port });
  console.log(`proxy OpenAI local : http://localhost:${port}/v1  (session #${sessionId} → ${o.enclaveUrl})`);
  console.log(`enclave vérifiée on-chain : ${keys.signer} (opérateur ${keys.operator}, clé X25519 inscrite, active au bloc ${keys.checkedAtBlock})`);
  console.log(`Exemple : openai.base_url = "http://localhost:${port}/v1" ; appelle /chat/completions en boucle.`);
}
