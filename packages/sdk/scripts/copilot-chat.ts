/**
 * copilot-chat.ts — talks to the ATTESTED copilot (AskHive) the way the site does: the copilot's key verified on Arc
 * (registered for its product, a matching X25519 key, an active enclave, an image still allowed, an operator not
 * banned), the conversation encrypted (HPKE) to that key, the sealed answer opened. Read only: no transaction, no
 * private key. A copilot whose quote is simulated (outside TDX) is not registered: the script refuses it and sends nothing.
 * COPILOT_URL: the site's address (…/enclave/copilot). The copilot in its enclave answers POST /chat only through the
 * site's proxy (a COPILOT_PROXY_TOKEN set by nginx): its direct Phala URL verifies the key (/pubkeys is public) but
 * refuses the conversation (403 proxy_required, a plaintext refusal: not authenticated).
 * Usage (from packages/sdk):
 *   DEPLOYMENTS=deployments.v21.testnet.json COPILOT_URL=https://archive.62-171-153-35.sslip.io/enclave/copilot \
 *   PRODUCT_ID=4 [COPILOT_LANG=en|fr] [QUESTION="Are you running in an enclave?"] [OPERATOR=0x…] npx tsx scripts/copilot-chat.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, defineChain, http } from "viem";
import {
  arcTestnet, createAttestedCopilotClient, deploymentFromJson, testnet, EnclaveKeyMismatchError, CopilotResponseError,
  type CopilotLang, type Deployment,
} from "../src/index";

const ROOT = new URL("../../../", import.meta.url);
const D: Deployment = process.env.DEPLOYMENTS
  ? deploymentFromJson(JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS, ROOT), "utf8")))
  : testnet;
const URL_ = process.env.COPILOT_URL ?? "";
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? "0");
const LANG: CopilotLang = process.env.COPILOT_LANG === "fr" ? "fr" : "en";
const QUESTION = process.env.QUESTION ?? "Where are you running, and who can read this conversation?";
if (!URL_ || PRODUCT_ID === 0n) {
  console.error("COPILOT_URL and PRODUCT_ID are required (PRODUCT_ID: the attested copilot product, e.g. 4 on v2.1)");
  process.exit(1);
}
const chain = D.chainId === arcTestnet.id ? arcTestnet : defineChain({ ...arcTestnet, id: D.chainId, name: `Arc (${D.chainId})` });
const publicClient = createPublicClient({ chain, transport: http(process.env.RPC_URL, { retryCount: 5, retryDelay: 600 }) });

async function main() {
  const copilot = createAttestedCopilotClient({
    copilotUrl: URL_, productId: PRODUCT_ID, publicClient: publicClient as any, deployment: D, lang: LANG,
    ...(process.env.OPERATOR ? { expectedOperator: process.env.OPERATOR as `0x${string}` } : {}),
  });
  const k = await copilot.verifiedKeys();
  console.log(
    `copilot verified on Arc at block ${k.checkedAtBlock}: signer ${k.signer}, product #${k.productId}, operator ${k.operator}, ` +
      `image ${k.workloadId}, TCB ${k.tcbStatus}, window ${k.fromBlock}→${k.untilBlock}, pinned model ${k.productParam}`,
  );
  const r = await copilot.chat({ messages: [{ role: "user", content: QUESTION }] });
  if (r.authenticated) {
    console.log(`answer sealed by the verified enclave ${r.enclave.signer} (operator ${r.enclave.operator}): HTTP ${r.status}`);
  } else {
    // a plaintext refusal: not authenticated (a relay can write it); the local text comes from the code
    console.log(`PLAINTEXT refusal from before decryption, NOT authenticated: HTTP ${r.status}, code ${r.reply.code ?? "?"}`);
  }
  console.log(r.reply.text);
  if (r.reply.navigate) console.log(`(page: ${r.reply.navigate})`);
  if (!r.authenticated) process.exit(2);
}

main().catch((e) => {
  if (e instanceof EnclaveKeyMismatchError) console.error(`REFUSED, nothing was sent (${e.reason}): ${e.message}`);
  else if (e instanceof CopilotResponseError) console.error(`ANSWER REFUSED: ${e.message}`);
  else console.error("FAILED:", (e as Error)?.message ?? e);
  process.exit(1);
});
