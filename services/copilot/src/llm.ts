/** llm.ts — the call to the OpenAI-compatible model (OpenAI, DeepSeek, RedPill…), kept apart from server.ts so it can be
 *  tested against a fake local provider. max_tokens is sent with EVERY call (bounded cost); one retry at most; the
 *  request's signal cuts the call at the global timeout. Provider errors go up to app.ts as they are, which never
 *  returns them to the visitor (generic message + code).
 *  DEBUG: with DEBUG=true, openai@4 (core.js, debug()) logs (console.log) the URL, the headers (including
 *  "authorization: Bearer <model key>") and the body (the whole conversation) of every request and response, outside
 *  any filter. It rereads process.env.DEBUG at every call, so DEBUG is removed from the environment when both entry
 *  points start (server.ts, enclave-server.ts, before the client is built), when the client is built here, and again
 *  before every call. The client therefore never logs headers or bodies. */
import OpenAI from "openai";
import type { Llm } from "./app";

/** Retire DEBUG de l'environnement (le journal de débogage d'openai@4 recopie la clé et la conversation) ; rend la valeur
 *  retirée (undefined s'il n'y en avait pas). */
export function stripProviderDebug(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(env, "DEBUG")) return undefined;
  const v = env.DEBUG;
  delete env.DEBUG;
  return v;
}

export interface OpenAiLlmOptions {
  apiKey: string;
  /** URL de base compatible OpenAI (ex. https://api.redpill.ai/v1) ; défaut : OpenAI. */
  baseURL?: string;
  model: string;
  /** Délai d'un appel, en ms (défaut 90 000). */
  timeoutMs?: number;
  /** 11/11 : `fetch` du client (dans une enclave : celui, épinglé et vérifié, de model-attestation.ts). */
  fetch?: typeof fetch;
}

export function openAiLlm(o: OpenAiLlmOptions): Llm {
  stripProviderDebug();
  const client = new OpenAI({ apiKey: o.apiKey, baseURL: o.baseURL, maxRetries: 1, timeout: o.timeoutMs ?? 90_000, ...(o.fetch ? { fetch: o.fetch as any } : {}) });
  return async ({ messages, tools, tool_choice, max_tokens, signal }) => {
    stripProviderDebug(); // jamais de journal de débogage, même si DEBUG revenait dans l'environnement
    return (await client.chat.completions.create({ model: o.model, messages, tools, tool_choice, max_tokens }, { signal })).choices[0]?.message ?? { content: "" };
  };
}
