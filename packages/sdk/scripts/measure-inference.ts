// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/measure-inference.ts`.
/**
 * measure-inference.ts — measures the latency and throughput of private inference, end to end like a client:
 * a session opened on-chain, requests encrypted (HPKE) to the REAL Intel TDX enclave (Phala), receipts verified,
 * directly or through the site's HTTPS proxy (the enclave's keys are verified on-chain before any encryption, and the
 * session is locked to it). N sequential requests; median and p90 latency, tokens per second.
 * Usage: N=8 [ENCLAVE_URL=https://…-8802.dstack-pha1-prod9.phala.network] npx tsx scripts/measure-inference.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, createArcClient, createInferenceClient, explainArcError } from "../src/index";
import { PRODUCT_INFERENCE, V2_INFERENCE_URL } from "./demo-shared";

const ENCLAVE = V2_INFERENCE_URL;
const N = Number(process.env.N ?? "8");
const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });

const Q = [
  "In one sentence, what is an Intel TDX enclave?",
  "Why is a receipt signed by the enclave useful for paying per use?",
  "Give two uses of an AI whose questions nobody can read.",
  "What is USDC, in one sentence?",
];

async function main() {
  const t0 = Date.now();
  const s = await arc.openSession({ productId: PRODUCT_INFERENCE, enclaveUrl: ENCLAVE, deposit: parseUnits("1", 6) });
  await pub.waitForTransactionReceipt({ hash: s.tx });
  const openMs = Date.now() - t0;
  const ai = createInferenceClient({ enclaveUrl: ENCLAVE, sessionId: s.sessionId, sessionKey: s.sessionKey, publicClient: pub as any });
  const lat: number[] = []; let tokOut = 0, tokIn = 0, okReceipts = 0;
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    const out = await ai.chat.completions.create({ messages: [{ role: "user", content: Q[i % Q.length]! }] });
    lat.push(Date.now() - t);
    if (out.verified) okReceipts++;
    tokIn += Number(out.receipt?.tokensIn ?? 0); tokOut += Number(out.receipt?.tokensOut ?? 0);
  }
  lat.sort((a, b) => a - b);
  const med = lat[Math.floor(lat.length / 2)]!, p90 = lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.9))]!;
  const totalS = lat.reduce((a, b) => a + b, 0) / 1000;
  console.log(`session #${s.sessionId} opened and confirmed in ${openMs} ms`);
  console.log(`${N} encrypted requests to the TDX enclave: median latency ${med} ms, p90 ${p90} ms, min ${lat[0]} ms, max ${lat[lat.length - 1]} ms`);
  console.log(`tokens: ${tokIn} read, ${tokOut} written; output throughput ≈ ${(tokOut / totalS).toFixed(1)} tokens/s (end to end, encryption and verification included)`);
  console.log(`authenticated and payable receipts: ${okReceipts}/${N}`);
}
main().catch((e) => { console.error("FAILED:", explainArcError(e, "en")); process.exit(1); });
