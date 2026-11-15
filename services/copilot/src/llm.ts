/** llm.ts — l'appel au modèle compatible OpenAI (OpenAI, DeepSeek, RedPill…), séparé de server.ts pour être testé contre
 *  un faux fournisseur local. max_tokens part à CHAQUE appel (coût borné) ; une seule nouvelle tentative ; le signal de
 *  la requête coupe l'appel au délai global. Les erreurs du fournisseur remontent telles quelles à app.ts, qui ne les
 *  renvoie jamais au visiteur (message générique + code).
 *  9/11 (vérificateur, DEBUG) : avec DEBUG=true, openai@4 (core.js, debug()) écrit au journal (console.log) l'URL, les
 *  en-têtes (dont « authorization: Bearer <clé du modèle> ») et le corps (toute la conversation) de chaque requête et de
 *  chaque réponse, hors de tout filtre. Il relit process.env.DEBUG à chaque appel : DEBUG est donc retiré de
 *  l'environnement au démarrage des deux points d'entrée (server.ts, enclave-server.ts, avant de monter le client), à la
 *  construction du client ici, et encore avant chaque appel. Le client ne journalise ainsi jamais ni en-têtes ni corps. */
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
