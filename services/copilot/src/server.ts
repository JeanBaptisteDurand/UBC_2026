/** server.ts — the agentic RAG copilot (OpenAI-compatible API: OpenAI, DeepSeek, RedPill), served as is (on the server).
 *  Tool loop: it answers with citations and prepares actions to sign. Key and model come from environment variables (.env).
 *  The copilot (prompt, tools, model, guards) is assembled by copilot.ts; the HTTP app and its guards (origins, per-IP
 *  rate, limits, tool and cost caps, secrets filter, generic model errors, language) are in app.ts. In an Intel TDX
 *  enclave, enclave-server.ts serves the SAME copilot, with the enclave kit (keys in memory, /attest, /pubkeys,
 *  encrypted conversation). Variables: see copilot.ts.
 *  DEBUG is removed from the environment BEFORE the model client is built (llm.ts: openai@4 would otherwise log the
 *  model key and the whole conversation). */
import { serve } from "@hono/node-server";
import { createCopilotApp } from "./app";
import { copilotFromEnv } from "./copilot";
import { stripProviderDebug } from "./llm";

if (stripProviderDebug() !== undefined) {
  console.warn("[copilote] DEBUG retiré de l'environnement : le client du modèle journaliserait sa clé et la conversation");
}
const c = copilotFromEnv();
const app = createCopilotApp(c.options);

serve({ fetch: app.fetch, port: c.port });
console.log(`copilote (OpenAI) sur http://localhost:${c.port}  ${c.banner}`);
