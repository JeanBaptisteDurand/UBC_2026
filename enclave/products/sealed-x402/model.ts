/**
 * sealed-x402/model.ts — le modèle appelé par l'enclave : RedPill (compatible OpenAI, inférence confidentielle en TEE)
 * si une clé est fournie, sinon un modèle factice local (développement : son empreinte, keccak256("mock-echo-model"),
 * n'est celle d'aucun produit réel, donc l'enclave refuse alors tout appel payé sur la vraie chaîne).
 *
 * Les erreurs de l'amont ne remontent JAMAIS son corps (un fournisseur peut y recopier la clé, et les journaux d'une CVM
 * peuvent être publics) : seulement le code HTTP.
 */
import type { ChatModel, ChatModelRequest, ChatModelResult } from "../../src/services/x402-gateway";

export const MOCK_MODEL_ID = "mock-echo-model";

export function createRedpillModel(o: { baseUrl: string; model: string; apiKey: string; fetch?: typeof fetch }): ChatModel {
  const url = `${o.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const f = o.fetch ?? globalThis.fetch;
  return {
    async complete(r: ChatModelRequest, signal: AbortSignal): Promise<ChatModelResult> {
      const res = await f(url, {
        method: "POST",
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: o.model,
          messages: r.messages,
          temperature: r.temperature ?? 0.2,
          max_tokens: r.maxTokens,
          ...(r.seed !== undefined ? { seed: r.seed } : {}),
        }),
        signal,
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {}); // corps jamais lu ni journalisé
        throw new Error(`modèle amont : HTTP ${res.status}`);
      }
      const j = (await res.json().catch(() => null)) as any;
      if (!j) throw new Error("modèle amont : réponse illisible");
      const text = j.choices?.[0]?.message?.content;
      const u = j.usage ?? {};
      return {
        text: typeof text === "string" ? text : "",
        tokensIn: Number.isSafeInteger(u.prompt_tokens) ? u.prompt_tokens : undefined,
        tokensOut: Number.isSafeInteger(u.completion_tokens) ? u.completion_tokens : undefined,
      };
    },
  };
}

/** Modèle factice (développement hors VM, sans clé amont). */
export function createMockModel(): ChatModel {
  return {
    async complete(r: ChatModelRequest): Promise<ChatModelResult> {
      const last = [...r.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const text = `Réponse attestée (démo, enclave x402) — invite reçue : « ${last.slice(0, 120)} »`;
      const inBytes = r.messages.reduce((s, m) => s + new TextEncoder().encode(m.content).length, 0);
      return { text, tokensIn: Math.max(1, Math.ceil(inBytes / 4)), tokensOut: Math.ceil(text.length / 4) };
    },
  };
}
