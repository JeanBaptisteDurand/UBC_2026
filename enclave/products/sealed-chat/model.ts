/**
 * sealed-chat/model.ts — the model the inference enclave calls (product 1, prepaid sessions): RedPill (OpenAI-compatible,
 * confidential inference in a TEE) if a key is given, otherwise a local fake model (development: its fingerprint,
 * keccak256("mock-echo-model"), is no real product's).
 *
 * 9 Nov (verifier): an upstream error NEVER surfaces its body. A provider can copy the key it received into it
 * ("Invalid API key provided: …"), and Hono's default error handler logged the thrown message (`redpill 401: <body>`)
 * into the CVM's logs, which can be public. The body is dropped without being read; only the HTTP code surfaces
 * (UpstreamModelError), and app.ts answers with a generic message and a code.
 */
import type { LlamaClient } from "../../src/services/inference";

export const MOCK_MODEL_ID = "mock-echo-model";

/** The upstream model answered with an error (or unreadably): only its HTTP status, never its body. */
export class UpstreamModelError extends Error {
  constructor(readonly upstreamStatus: number | null) {
    super(upstreamStatus === null ? "upstream model: unreadable answer" : `upstream model: HTTP ${upstreamStatus}`);
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
        await r.body?.cancel().catch(() => {}); // the body is never read nor logged: only the status surfaces
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

/** A fake model (development outside a VM, without an upstream key). */
export function createMockLlama(): LlamaClient {
  return {
    async infer(prompt) {
      const text = `Attested answer (demo, enclave): prompt received: "${prompt.slice(0, 120)}"`;
      return { text, tokensIn: Math.max(1, Math.ceil(prompt.length / 4)), tokensOut: Math.ceil(text.length / 4) };
    },
  };
}
