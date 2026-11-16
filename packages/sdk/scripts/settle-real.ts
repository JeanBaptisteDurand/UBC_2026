/**
 * settle-real.ts — preuve de bout en bout du paiement sur la VRAIE enclave Intel TDX (Phala), pile v2 :
 * clés de l'enclave vérifiées on-chain → session ouverte et VERROUILLÉE sur cette enclave → requêtes chiffrées → dernier
 * reçu signé par l'enclave → settle() on-chain (l'USDC part à l'opérateur) → closeSession() (reste remboursé, verdict
 * ERC-8004 écrit ; la v2 exige le gaz du verdict, le SDK ajoute la marge).
 * En v2, la clôture n'est permise qu'à l'échéance (au moins 10 min) + 1 h de grâce : le script attend donc ≈ 70 min.
 * Usage : [ENCLAVE_URL=…] [EXPIRES=660] npx tsx scripts/settle-real.ts
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
  const EXPIRES = Number(process.env.EXPIRES ?? "720"); // v2 : au moins 10 min (+ marge de 2 min du SDK)
  const s = await arc.openSession({ productId: PRODUCT_INFERENCE, enclaveUrl: V2_INFERENCE_URL, deposit: parseUnits("1", 6), expiresInSeconds: EXPIRES });
  await pub.waitForTransactionReceipt({ hash: s.tx });
  console.log(`session #${s.sessionId} ouverte, verrouillée sur l'enclave ${s.enclave} (opérateur ${s.operator}) : ${s.tx}`);
  const ai = createInferenceClient({ enclaveUrl: V2_INFERENCE_URL, sessionId: s.sessionId, sessionKey: s.sessionKey, publicClient: pub as any });
  let last;
  for (const q of ["En une phrase, qu'est-ce qu'une enclave Intel TDX ?", "Et pourquoi signer chaque réponse ?"]) {
    last = await ai.chat.completions.create({ messages: [{ role: "user", content: q }] });
    console.log(`réponse (${last.receipt.tokensIn}+${last.receipt.tokensOut} jetons, cumul ${last.receipt.cumulativeUnits} unités, signée par ${last.signer}, payable ${last.verified}) : ${last.text.slice(0, 90)}…`);
  }
  const check = await arc.verifyReceipt(last!.receipt, last!.signature);
  if (!check.settleable) throw new Error(`reçu non réglable : ${check.checks.filter((c) => !c.ok).map((c) => c.fr).join(" ; ")}`);
  const stx = await arc.settle(last!.receipt, last!.signature);
  const sr = await pub.waitForTransactionReceipt({ hash: stx });
  const st = parseEventLogs({ abi: sessionPayAbi, logs: sr.logs, eventName: "Settled" })[0];
  console.log(`settle : ${stx} (statut ${sr.status}, gas ${sr.gasUsed}) → payé ${formatUnits(st?.args.paidDelta ?? 0n, 6)} USDC pour ${st?.args.cumulativeUnits} unités`);

  // clôture : à l'échéance + SETTLE_GRACE, ou dès que l'enclave liée ne peut plus rien régler (lu sur la chaîne)
  for (;;) {
    const c = await arc.sessionClosability(s.sessionId);
    if (c.closableNow) break;
    const left = Number(c.atTime - c.now);
    console.log(`clôture possible dans ${left} s…`);
    await new Promise((r) => setTimeout(r, Math.min(Math.max(left, 5), 300) * 1000));
  }
  const ctx = await arc.closeSession(s.sessionId);
  const cr = await pub.waitForTransactionReceipt({ hash: ctx });
  const cl = parseEventLogs({ abi: sessionPayAbi, logs: cr.logs, eventName: "SessionClosed" })[0];
  const after = await arc.getSession(s.sessionId);
  console.log(`close : ${ctx} (statut ${cr.status}, gas ${cr.gasUsed}) → remboursé ${formatUnits(cl?.args.refund ?? 0n, 6)} USDC ; verdict ERC-8004 écrit : ${after.verdictWritten ? "oui" : "NON"}`);
}
main().catch((e) => { console.error("ÉCHEC :", explainArcError(e)); process.exit(1); });
