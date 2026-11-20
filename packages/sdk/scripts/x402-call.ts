// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/x402-call.ts`.
/**
 * x402-call.ts — pays N inference calls PER CALL (x402, "exact" scheme) to the REAL sealed-x402 enclave, the way an
 * agent does: the enclave's key verified on-chain, the 402 handled by the SDK, an EIP-3009 authorization signed (the
 * payer sends no transaction to pay), the answer decrypted, the receipt verified. Then:
 *  - SETTLE_NOW=1: the payer settles each call itself (X402Settler.settle, it pays the gas): payment + enclave
 *    proof + split in the same transaction;
 *  - otherwise: it waits (up to WAIT_S seconds) for the operator's registrar to settle (USDC.authorizationState).
 * Usage (from packages/sdk):
 *   DEPLOYMENTS=deployments.v21.testnet.json ENCLAVE_URL=https://…-8804.dstack-pha1-prod9.phala.network \
 *   [PRODUCT_ID=3] [N=3] [SETTLE_NOW=1] [WAIT_S=120] [PAYER_KEY_FILE=.secrets/deployer.json] npx tsx scripts/x402-call.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arcTestnet, createX402Client, deploymentFromJson, explainArcError, testnet, X402PaidCallError, type Deployment, type X402Completion,
} from "../src/index";

const ROOT = new URL("../../../", import.meta.url);
const D: Deployment = process.env.DEPLOYMENTS
  ? deploymentFromJson(JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS, ROOT), "utf8")))
  : testnet;
const ENCLAVE = process.env.ENCLAVE_URL ?? "";
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? String(D.products?.x402 ?? 0n));
const N = Number(process.env.N ?? "3");
const WAIT_S = Number(process.env.WAIT_S ?? "120");
if (!ENCLAVE || PRODUCT_ID === 0n) {
  console.error("ENCLAVE_URL and PRODUCT_ID are required (PRODUCT_ID: the product settled by X402Settler, e.g. 3 on v2.1)");
  process.exit(1);
}

const key = JSON.parse(readFileSync(new URL(process.env.PAYER_KEY_FILE ?? ".secrets/deployer.json", ROOT), "utf8")).privateKey as Hex;
const account = privateKeyToAccount(key);
const chain = { ...arcTestnet, id: D.chainId };
const pub = createPublicClient({ chain, transport: http(process.env.RPC_URL, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain, transport: http(process.env.RPC_URL) });
const Q = [
  "In one sentence: what is an Intel TDX enclave?",
  "In one sentence: why pay for an AI per call rather than by subscription?",
  "In one sentence: what does a receipt signed by an enclave prove?",
];

async function main() {
  const ai = createX402Client({ enclaveUrl: ENCLAVE, productId: PRODUCT_ID, walletClient: wallet as any, publicClient: pub as any, deployment: D });
  const p = await ai.product();
  console.log(`payer ${account.address} · product #${PRODUCT_ID} · ${Number(p.pricePerCall) / 1e6} USDC per call · X402Settler ${D.x402Settler}`);
  const done: X402Completion[] = [];
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    let r: X402Completion;
    try {
      r = await ai.chat.completions.create({ messages: [{ role: "user", content: Q[i % Q.length]! }] });
    } catch (e) {
      if (!(e instanceof X402PaidCallError)) throw e;
      // a PAID call with no verified answer: the SAME request is resumed (no second charge) after 10 s
      console.warn(`#${i + 1} ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 10_000));
      r = await ai.resume(e.pending);
      console.log(`#${i + 1} resumed: answer ${r.replay ? "kept by the enclave (replay)" : "served"}`);
    }
    done.push(r);
    console.log(
      `#${i + 1} ${Date.now() - t} ms · ${Number(r.amount) / 1e6} USDC authorized · receipt from ${r.signer} (block ${r.receipt.anchorBlock}, settleable: ${r.settleable}) · "${r.text.slice(0, 100).replace(/\s+/g, " ")}"`,
    );
  }
  if (process.env.SETTLE_NOW === "1") {
    for (const r of done) {
      const tx = await ai.settle(r);
      const rc = await pub.waitForTransactionReceipt({ hash: tx });
      console.log(`settled by the payer: ${tx} (status ${rc.status}, gas ${rc.gasUsed})`);
    }
    return;
  }
  const until = Date.now() + WAIT_S * 1000;
  for (;;) {
    const states = await Promise.all(done.map((r) => ai.isSettled(r)));
    const n = states.filter(Boolean).length;
    if (n === done.length) {
      console.log(`the ${n} calls are settled on-chain by the operator's registrar (X402Settler.settle)`);
      return;
    }
    if (Date.now() > until) {
      console.log(`${n}/${done.length} calls settled after ${WAIT_S} s: check the x402 registrar (its "x402:" log lines)`);
      return;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

main().catch((e) => {
  console.error("FAILED:", explainArcError(e));
  process.exit(1);
});
