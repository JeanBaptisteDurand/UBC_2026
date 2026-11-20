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

/** Removes DEBUG from the environment (openai@4's debug log copies the key and the conversation); returns the removed
 *  value (undefined when there was none). */
export function stripProviderDebug(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(env, "DEBUG")) return undefined;
  const v = env.DEBUG;
  delete env.DEBUG;
  return v;
}

export interface OpenAiLlmOptions {
  apiKey: string;
  /** OpenAI-compatible base URL (e.g. https://api.redpill.ai/v1); default: OpenAI. */
  baseURL?: string;
  model: string;
  /** Timeout of a call, in ms (default 90,000). */
  timeoutMs?: number;
  /** The client's `fetch` (in an enclave: the pinned, verified one from model-attestation.ts). */
  fetch?: typeof fetch;
}

export function openAiLlm(o: OpenAiLlmOptions): Llm {
  stripProviderDebug();
  const client = new OpenAI({ apiKey: o.apiKey, baseURL: o.baseURL, maxRetries: 1, timeout: o.timeoutMs ?? 90_000, ...(o.fetch ? { fetch: o.fetch as any } : {}) });
  return async ({ messages, tools, tool_choice, max_tokens, signal }) => {
    stripProviderDebug(); // never a debug log, even if DEBUG came back into the environment
    return (await client.chat.completions.create({ model: o.model, messages, tools, tool_choice, max_tokens }, { signal })).choices[0]?.message ?? { content: "" };
  };
}
