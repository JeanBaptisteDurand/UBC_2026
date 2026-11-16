/**
 * sealed-chat/model.ts — le modèle appelé par l'enclave d'inférence (produit B, sessions) : RedPill (compatible OpenAI,
 * inférence confidentielle en TEE) si une clé est fournie, sinon un modèle factice local (développement : son empreinte,
 * keccak256("mock-echo-model"), n'est celle d'aucun produit réel).
 *
 * 9/11 (vérificateur) : une erreur de l'amont ne remonte JAMAIS son corps. Un fournisseur peut y recopier la clé reçue
 * (« Invalid API key provided: … »), et le gestionnaire d'erreurs par défaut de Hono journalisait le message levé
 * (`redpill 401: <corps>`) dans les journaux de la CVM, qui peuvent être publics. Le corps est abandonné sans être lu ;
 * seul le code HTTP remonte (UpstreamModelError), et app.ts répond un message générique avec un code.
 */
import type { LlamaClient } from "../../src/services/inference";

export const MOCK_MODEL_ID = "mock-echo-model";

/** Le modèle amont a répondu en erreur (ou illisiblement) : seulement son statut HTTP, jamais son corps. */
export class UpstreamModelError extends Error {
  constructor(readonly upstreamStatus: number | null) {
    super(upstreamStatus === null ? "modèle amont : réponse illisible" : `modèle amont : HTTP ${upstreamStatus}`);
    this.name = "UpstreamModelError";
  }
}

export interface RedpillLlamaOptions {
  /** URL de base compatible OpenAI (ex. https://api.redpill.ai/v1). */
  baseUrl: string;
  model: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export function createRedpillLlama(o: RedpillLlamaOptions): LlamaClient {
  const url = `${o.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const f = o.fetch ?? globalThis.fetch;
  return {
    async infer(prompt, params, signal) {
      const r = await f(url, {
        method: "POST",
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: o.model,
          messages: [{ role: "user", content: prompt }],
          temperature: params?.temperature ?? 0.2,
          max_tokens: params?.maxTokens ?? 512,
          ...(params?.seed !== undefined ? { seed: params.seed } : {}),
        }),
        signal,
      });
      if (!r.ok) {
        await r.body?.cancel().catch(() => {}); // corps jamais lu ni journalisé : seul le statut remonte
        throw new UpstreamModelError(r.status);
      }
      const j = (await r.json().catch(() => null)) as any;
      if (!j || typeof j !== "object") throw new UpstreamModelError(null);
      const text = j.choices?.[0]?.message?.content;
      const out = typeof text === "string" ? text : "";
      const u = j.usage ?? {};
      return {
        text: out,
        tokensIn: u.prompt_tokens ?? Math.ceil(prompt.length / 4),
        tokensOut: u.completion_tokens ?? Math.ceil(out.length / 4),
      };
    },
  };
}

/** Modèle factice (développement hors VM, sans clé amont). */
export function createMockLlama(): LlamaClient {
  return {
    async infer(prompt) {
      const text = `Réponse attestée (démo, enclave) — invite reçue : « ${prompt.slice(0, 120)} »`;
      return { text, tokensIn: Math.max(1, Math.ceil(prompt.length / 4)), tokensOut: Math.ceil(text.length / 4) };
    },
  };
}
