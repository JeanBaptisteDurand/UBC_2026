/** server.ts — copilote RAG agentique (OpenAI-compatible : OpenAI/DeepSeek/RedPill), servi tel quel (VPS). Boucle d'outils :
 *  répond en citant, prépare des actions à signer. Clé + modèle par variables d'env (.env).
 *  Le copilote (invite, outils, modèle, garde-fous) est monté par copilot.ts ; l'application HTTP et ses garde-fous
 *  (origines, débit par IP, bornes, plafonds d'outils et de coût, filtre de secrets, erreurs du modèle génériques,
 *  langue) sont dans app.ts. Dans une enclave Intel TDX, c'est enclave-server.ts qui sert le MÊME copilote, avec le kit
 *  d'enclave (clés en mémoire, /attest, /pubkeys, conversation chiffrée). Variables : voir copilot.ts.
 *  DEBUG est retiré de l'environnement AVANT de monter le client du modèle (llm.ts : openai@4 journaliserait sinon la clé
 *  du modèle et toute la conversation). */
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
