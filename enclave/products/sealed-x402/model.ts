/**
 * sealed-x402/model.ts — the model the enclave calls: RedPill (OpenAI-compatible, confidential inference in a TEE) if a
 * key is given, otherwise a local fake model (development: its fingerprint, keccak256("mock-echo-model"), is no real
 * product's, so the enclave then refuses every paid call on the real chain).
 *
 * Upstream errors NEVER surface its body (a provider can copy the key into it, and a CVM's logs can be public): only
 * the HTTP code.
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
        await res.body?.cancel().catch(() => {}); // the body is never read nor logged
        throw new Error(`upstream model: HTTP ${res.status}`);
      }
      const j = (await res.json().catch(() => null)) as any;
      if (!j) throw new Error("upstream model: unreadable answer");
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

/** A fake model (development outside a VM, without an upstream key). */
export function createMockModel(): ChatModel {
  return {
    async complete(r: ChatModelRequest): Promise<ChatModelResult> {
      const last = [...r.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const text = `Attested answer (demo, x402 enclave): prompt received: "${last.slice(0, 120)}"`;
      const inBytes = r.messages.reduce((s, m) => s + new TextEncoder().encode(m.content).length, 0);
      return { text, tokensIn: Math.max(1, Math.ceil(inBytes / 4)), tokensOut: Math.ceil(text.length / 4) };
    },
  };
}
