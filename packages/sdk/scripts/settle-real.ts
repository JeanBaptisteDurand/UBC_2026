// Operator script for Arc testnet: it reads its funded testnet key from .secrets/ at the repository root (git-ignored,
// never committed). Run it from packages/sdk with `npx tsx scripts/settle-real.ts`.
/**
 * settle-real.ts — an end-to-end proof of payment on the REAL Intel TDX enclave (Phala):
 * the enclave's keys verified on-chain → a session opened and LOCKED to this enclave → encrypted requests → the latest
 * receipt signed by the enclave → settle() on-chain (the USDC goes to the operator) → closeSession() (the rest refunded,
 * an ERC-8004 verdict written; the verdict needs its gas, and the SDK adds the margin).
 * Closing is allowed only at the expiry (at least 10 min) + 1 h of grace, so the script waits ≈ 70 min.
 * Usage: [ENCLAVE_URL=…] [EXPIRES=660] npx tsx scripts/settle-real.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, createArcClient, createInferenceClient, sessionPayAbi, explainArcError } from "../src/index";
import { PRODUCT_INFERENCE, V2_INFERENCE_URL } from "./demo-shared";

const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });

async function main() {
  const EXPIRES = Number(process.env.EXPIRES ?? "720"); // at least 10 min (+ the SDK's 2-minute margin)
  const s = await arc.openSession({ productId: PRODUCT_INFERENCE, enclaveUrl: V2_INFERENCE_URL, deposit: parseUnits("1", 6), expiresInSeconds: EXPIRES });
  await pub.waitForTransactionReceipt({ hash: s.tx });
  console.log(`session #${s.sessionId} opened, locked to enclave ${s.enclave} (operator ${s.operator}): ${s.tx}`);
  const ai = createInferenceClient({ enclaveUrl: V2_INFERENCE_URL, sessionId: s.sessionId, sessionKey: s.sessionKey, publicClient: pub as any });
  let last;
  for (const q of ["In one sentence, what is an Intel TDX enclave?", "And why sign each answer?"]) {
    last = await ai.chat.completions.create({ messages: [{ role: "user", content: q }] });
    console.log(`answer (${last.receipt.tokensIn}+${last.receipt.tokensOut} tokens, cumulative ${last.receipt.cumulativeUnits} units, signed by ${last.signer}, payable ${last.verified}): ${last.text.slice(0, 90)}…`);
  }
  const check = await arc.verifyReceipt(last!.receipt, last!.signature);
  if (!check.settleable) throw new Error(`receipt not settleable: ${check.checks.filter((c) => !c.ok).map((c) => c.fr).join("; ")}`);
  const stx = await arc.settle(last!.receipt, last!.signature);
  const sr = await pub.waitForTransactionReceipt({ hash: stx });
  const st = parseEventLogs({ abi: sessionPayAbi, logs: sr.logs, eventName: "Settled" })[0];
  console.log(`settle: ${stx} (status ${sr.status}, gas ${sr.gasUsed}) → paid ${formatUnits(st?.args.paidDelta ?? 0n, 6)} USDC for ${st?.args.cumulativeUnits} units`);

  // closing: at the expiry + SETTLE_GRACE, or as soon as the bound enclave can no longer settle anything (read on-chain)
  for (;;) {
    const c = await arc.sessionClosability(s.sessionId);
    if (c.closableNow) break;
    const left = Number(c.atTime - c.now);
    console.log(`closing possible in ${left} s…`);
    await new Promise((r) => setTimeout(r, Math.min(Math.max(left, 5), 300) * 1000));
  }
  const ctx = await arc.closeSession(s.sessionId);
  const cr = await pub.waitForTransactionReceipt({ hash: ctx });
  const cl = parseEventLogs({ abi: sessionPayAbi, logs: cr.logs, eventName: "SessionClosed" })[0];
  const after = await arc.getSession(s.sessionId);
  console.log(`close: ${ctx} (status ${cr.status}, gas ${cr.gasUsed}) → refunded ${formatUnits(cl?.args.refund ?? 0n, 6)} USDC; ERC-8004 verdict written: ${after.verdictWritten ? "yes" : "NO"}`);
}
main().catch((e) => { console.error("FAILED:", explainArcError(e)); process.exit(1); });
