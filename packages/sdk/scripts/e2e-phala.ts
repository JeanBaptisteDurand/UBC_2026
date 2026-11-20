// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/e2e-phala.ts`.
/**
 * e2e-phala.ts — the inference product end to end against the REAL TDX enclave (Phala):
 *  1) (REGISTER=1 only) registration through the SDK: the enclave's /attest → a REAL quote bound to the operator,
 *     checked off-chain (no DEBUG, SEPT_VE_DISABLE, an image the product allows, the REPORTDATA binding), then
 *     registerEnclave: the chain verifies Intel's signature through DCAP (≈ 6.85 M gas, measured on v2.1). Nothing is
 *     simulated. The product's author must already allow the image (proposeWorkload → applyWorkload; see
 *     enclave/scripts/register-dcap.ts).
 *  2) the enclave's keys VERIFIED on-chain (registered X25519 key, active for the product), a session locked to it;
 *  3) real encrypted inference → a signed receipt, authenticated (request, answer) and payable by SessionPay.settle.
 * Usage: [ENCLAVE_URL=…] [REGISTER=1] npx tsx scripts/e2e-phala.ts   (operator key: .secrets/deployer.json)
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, createArcClient, createInferenceClient, explainArcError } from "../src/index";
import { PRODUCT_INFERENCE, V2_INFERENCE_URL } from "./demo-shared";

const ENCLAVE = V2_INFERENCE_URL;
const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });

async function main() {
  console.log(`enclave : ${ENCLAVE}`);
  if (process.env.REGISTER === "1") {
    console.log("[on-chain registration, DCAP verification]");
    const r = await arc.registerEnclave(PRODUCT_INFERENCE, ENCLAVE);
    const rc = await pub.waitForTransactionReceipt({ hash: r.tx });
    console.log(`  registerEnclave : ${rc.status} (gas ${rc.gasUsed}) https://explorer.testnet.arc.io/tx/${r.tx} ; signer ${r.signer}, workloadId ${r.workloadId}`);
  }

  console.log("[the enclave's keys checked against the chain]");
  const keys = await arc.verifyEnclaveKeys(ENCLAVE, PRODUCT_INFERENCE);
  console.log(`  ✓ signer ${keys.signer}, registered X25519 key ${keys.x25519.slice(0, 18)}…, operator ${keys.operator}, window ${keys.fromBlock}→${keys.untilBlock}`);

  console.log("[session + real inference]");
  const s = await arc.openSession({ productId: PRODUCT_INFERENCE, enclaveUrl: ENCLAVE, deposit: parseUnits("2", 6) });
  await pub.waitForTransactionReceipt({ hash: s.tx });
  console.log(`  session #${s.sessionId} opened, locked to ${s.enclave}`);
  const ai = createInferenceClient({ enclaveUrl: ENCLAVE, sessionId: s.sessionId, sessionKey: s.sessionKey, publicClient: pub as any });
  const out = await ai.chat.completions.create({ messages: [{ role: "user", content: "In one sentence: what is a TDX enclave?" }] });
  console.log(`  AI ANSWER: ${out.text}`);
  console.log(`  authenticated receipt, payable on-chain: ${out.verified}  (cumulative ${out.receipt.cumulativeUnits} units)`);
  console.log(out.verified ? "\n✅ end to end on a real TDX enclave: keys verified, real inference, payable receipt." : "\n⚠️ receipt not payable");
}
main().catch((e) => { console.error("FAILED:", explainArcError(e, "en")); process.exit(1); });
