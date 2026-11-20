/** server.ts — the Registrar (v2 and v2.1 stacks). It keeps ONE enclave registered and gets its operator paid.
 *
 *  Registration. The v2 registry counts an enclave's validity window in BLOCKS (VALIDITY_BLOCKS ≈ 24 h). Each pass
 *  reads the enclave's current signer, which changes at every restart because the keys live in memory. It then reads
 *  the on-chain state: activeOperatorAt at the head block, and the end of the window. When needed, it calls the SDK's
 *  registerEnclave: /attest, an off-chain quote check (a real quote, no DEBUG, SEPT_VE_DISABLE, an allowed image, the
 *  REPORTDATA binding), then registerEnclave, where the chain verifies Intel's signature through DCAP. A renewal with no
 *  gap extends the window, so receipts already issued stay settleable.
 *  After a restart, the previous key (served before by THIS URL) is retired. It signs nothing more, and its bond
 *  reserve is released; otherwise every restart would lock the minimum bond of a dead key.
 *  The registrar NEVER allows an image: the product's author does. The operator signs (ARC_PK).
 *
 *  Stack. DEPLOYMENTS selects it (a path to a deployments.*.json file, e.g. deployments.v21.testnet.json); without it,
 *  the SDK's default stack (`testnet`, v2.1) applies. No contract address is hard-coded here.
 *
 *  Settlement follows the settlement contract of the product served, read on-chain:
 *  - SessionPay: the latest receipt of each session is settled.
 *  - X402Settler (pay per call): every X402_CHECK_SECONDS (10 s by default, because payer authorizations are valid
 *    for 15 min), the calls served but not settled yet are fetched (GET /x402/pending) and settled
 *    (X402Settler.settle). There is NO DOUBLE SETTLEMENT and no duplicate: ONE queue (the SDK's
 *    X402SettlementQueue) runs one pass at a time, tracks each call once by (payer, nonce), checks on-chain before each
 *    send, and relies on the single-use EIP-3009 nonce. Settled calls are reported to the enclave by POST /x402/settled,
 *    SIGNED with the operator's key (EIP-712); the enclave refuses any signer outside its OPERATOR_ALLOWLIST and checks
 *    again on-chain. Fetched calls are kept here until they are settled, so an enclave restart does not lose them.
 *  - The whole queue is fetched, page by page. Calls that their payer's balance covers are settled first, and at most
 *    25 "uncovered" calls are re-checked per pass (X402_UNCOVERED_CHECKS). Each report says whether X402Settler SETTLED
 *    the call (the receipt of OUR transaction, or a CallSettled event) or whether it was consumed another way
 *    (cancelled). Only a settlement makes the payer "known" to the enclave. A failed report is sent again on the next pass.
 *
 *  Verified level (when the deployment has a levels section; LEVELS=0 turns it off). After each registration, the
 *  enclave is BOUND to its machine (MachineRegistry.bindMachine, with the transaction's quote: the PPID is read from
 *  Intel's certificate). A renewal changes the quote, and a stale binding takes the enclave back to the open level, so
 *  every pass redoes a missing or stale binding (the quote is found again in the events). When the Proof of Cloud
 *  alliance's attestation of the machine expires in less than LEVELS_POC_RENEW_DAYS (3) days, a new token is requested
 *  from the alliance, checked, then submitted to ProofOfCloudAuditor, which checks it again on-chain. */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arcTestnet, testnet, deploymentFromJson, createArcClient, createX402SettlementQueue, enclaveRegistryAbi, explainArcError, arcErrorOf,
  sessionPayAbi, normalizeReceipt, verifyReceiptOnChain, type Deployment,
  machineRegistryAbi, proofOfCloudAuditorAbi, readMachine, quoteFromRegisterTx, findCurrentQuote,
} from "@arcvault/sdk";
// Node-only module (not exported by the SDK's index, which the site imports); relative path: build.sh makes
// "@arcvault/sdk" an alias of the FILE index.ts, so a package subpath would not survive the build
import { requestAllianceToken } from "../../../packages/sdk/src/proof-of-cloud";

const D: Deployment = process.env.DEPLOYMENTS ? deploymentFromJson(JSON.parse(readFileSync(process.env.DEPLOYMENTS, "utf8"))) : testnet;
const ENCLAVE = (process.env.ENCLAVE_URL ?? "").replace(/\/$/, "");
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? String(D.products?.inference ?? 1n));
const INTERVAL_H = Number(process.env.INTERVAL_HOURS ?? "12");
const RETIRE_PREVIOUS = process.env.RETIRE_PREVIOUS !== "0";
const pk = process.env.ARC_PK as Hex;
if (!ENCLAVE || !pk) { console.error("ENCLAVE_URL and ARC_PK are required"); process.exit(1); }
if (D.attestation !== "dcap") { console.error("this registrar only serves DCAP-verified stacks (v2, v2.1)"); process.exit(1); }

const account = privateKeyToAccount(pk);
const chain = D.chainId === arcTestnet.id ? arcTestnet : defineChain({ ...arcTestnet, id: D.chainId, name: `Arc (${D.chainId})` });
const pub = createPublicClient({ chain, transport: http(process.env.RPC_URL, { retryCount: 5, retryDelay: 800 }) });
const rawWallet = createWalletClient({ account, chain, transport: http(process.env.RPC_URL) });
// Two loops (registration and sessions every 10 min, pay per call every 10 s) send with the SAME key:
// sends go one after the other, otherwise two transactions would take the same account nonce.
let txQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(send: () => Promise<T>): Promise<T> {
  const p = txQueue.then(send, send);
  txQueue = p.catch(() => {});
  return p;
}
const wallet = { ...rawWallet, writeContract: ((args: any) => oneAtATime(() => rawWallet.writeContract(args))) as typeof rawWallet.writeContract };
const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account, deployment: D });

const CHECK_MIN = Number(process.env.CHECK_MINUTES ?? "10");
const RENEW_BEFORE_H = Number(process.env.RENEW_BEFORE_HOURS ?? String(Math.max(1, 24 - INTERVAL_H)));
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Signer last served by THIS URL (to retire a dead key after an enclave restart). */
let lastSigner: Address | undefined;

async function currentSigner(): Promise<Address> {
  // /pubkeys is read without trust: nothing is encrypted to this key, only its on-chain state is read
  const r = await fetch(`${ENCLAVE}/pubkeys`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`/pubkeys: HTTP ${r.status}`);
  const j = (await r.json()) as { signer?: string };
  if (!j.signer || !/^0x[0-9a-fA-F]{40}$/.test(j.signer)) throw new Error("/pubkeys: unreadable signer");
  return j.signer as Address;
}

/** Must the registration be redone? Yes if the CURRENT signer is not active for this product with this operator at the
 *  head block, or if its window ends in less than RENEW_BEFORE_H (converted to blocks). */
async function needsReattest(signer: Address): Promise<string | null> {
  const head = await pub.getBlockNumber();
  const op = await arc.activeOperatorAt(signer, PRODUCT_ID, head);
  if (op.toLowerCase() !== account.address.toLowerCase()) {
    return op === "0x0000000000000000000000000000000000000000" ? `signer ${signer} not active for product #${PRODUCT_ID}` : `signer ${signer} active for another operator (${op})`;
  }
  const e = await arc.getEnclave(signer);
  const blockMs = (await pub.readContract({ address: D.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "BLOCK_TIME_MS" })) as bigint;
  const renewBefore = BigInt(Math.ceil((RENEW_BEFORE_H * 3_600_000) / Number(blockMs)));
  const left = BigInt(e.untilBlock) - head;
  if (left < renewBefore) return `window ends in ${left} blocks (≈ ${Math.round((Number(left) * Number(blockMs)) / 60_000)} min)`;
  return null;
}

async function reattest(signer: Address): Promise<{ signer: Address; tx: Hex }> {
  const r = await arc.registerEnclave(PRODUCT_ID, ENCLAVE);
  const rc = await pub.waitForTransactionReceipt({ hash: r.tx, timeout: 180_000 });
  if (rc.status !== "success") throw new Error(`registerEnclave reverted on-chain (${r.tx})`);
  const e = await arc.getEnclave(r.signer);
  console.log(`[${now()}] re-attested by DCAP: signer ${r.signer}, blocks ${e.fromBlock}→${e.untilBlock}, gas ${rc.gasUsed}, tx ${r.tx}`);
  if (r.signer.toLowerCase() !== signer.toLowerCase()) console.warn(`[${now()}] the enclave changed its key during registration (${signer} → ${r.signer})`);
  return { signer: r.signer as Address, tx: r.tx as Hex };
}

// ---------------------------------------------------------------- verified level (machine binding, Proof of Cloud token)

const LEVELS = !!D.levels && process.env.LEVELS !== "0";
const POC_RENEW_S = Number(process.env.LEVELS_POC_RENEW_DAYS ?? "3") * 86_400;

async function sendTx(address: Address, abi: any, functionName: string, args: unknown[]): Promise<Hex> {
  const { request } = await pub.simulateContract({ account, address, abi, functionName, args } as any);
  const hash = await wallet.writeContract(request as any);
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (rc.status !== "success") throw new Error(`${functionName} reverted on-chain (${hash})`);
  return hash;
}

/** Keeps the enclave at the verified level: an up-to-date machine binding, then the alliance's attestation renewed before
 *  it expires. `quote`: the quote of the current registration when known (otherwise found again in the events). */
async function keepVerified(signer: Address, quote?: Hex) {
  if (!LEVELS) return;
  const L = D.levels!;
  let m = await readMachine(pub as any, D, signer);
  if (!m.current) {
    const e = await arc.getEnclave(signer);
    if (!e.active || String(e.operator).toLowerCase() !== account.address.toLowerCase()) return;
    const q = quote ?? (await findCurrentQuote(pub as any, D, signer));
    const tx = await sendTx(L.machineRegistry, machineRegistryAbi, "bindMachine", [signer, q]);
    m = await readMachine(pub as any, D, signer);
    console.log(`[${now()}] verified level: enclave ${signer} bound to its machine ${m.ppid} (Intel certificate), tx ${tx}`);
    quote = q;
  }
  if (!m.ppid || process.env.LEVELS_PROOF_OF_CLOUD === "0") return;
  const [exp] = (await pub.readContract({ address: L.machineRegistry, abi: machineRegistryAbi, functionName: "auditOf", args: [L.proofOfCloudAuditor, m.ppid] })) as readonly [bigint, boolean];
  if (Number(exp) - Date.now() / 1000 > POC_RENEW_S) return;
  const q = quote ?? (await findCurrentQuote(pub as any, D, signer));
  const t = await requestAllianceToken(q, { log: (s) => console.warn(`[${now()}] ${s}`) });
  if (`0x${t.machineId}` !== m.ppid.toLowerCase()) throw new Error(`Proof of Cloud token issued for another machine (${t.machineId})`);
  const tx = await sendTx(L.proofOfCloudAuditor, proofOfCloudAuditorAbi, "submit", [t.header, t.payload, t.signature]);
  console.log(`[${now()}] verified level: machine ${m.ppid} attested by the Proof of Cloud alliance (token of ${new Date(t.timestamp * 1000).toISOString()}), tx ${tx}`);
}

/** Retires the key this URL served before a restart, if it is still ours and on this product. */
async function retirePrevious(current: Address) {
  const prev = lastSigner;
  if (!RETIRE_PREVIOUS || !prev || prev.toLowerCase() === current.toLowerCase()) return;
  const e = await arc.getEnclave(prev);
  if (!e.active || String(e.operator).toLowerCase() !== account.address.toLowerCase() || BigInt(e.productId) !== PRODUCT_ID) return;
  const tx = await arc.retireEnclave(prev);
  await pub.waitForTransactionReceipt({ hash: tx, timeout: 180_000 });
  console.log(`[${now()}] old key ${prev} retired (enclave restarted): bond reserve released; receipts already anchored stay settleable during the grace period; tx ${tx}`);
}

// ---------- which settlement for the product served? (read on-chain: Product.settlement)
type SettlementKind = "session" | "x402" | "other";
let kind: SettlementKind | undefined;
async function settlementKind(): Promise<SettlementKind> {
  if (kind) return kind;
  const p = await arc.getProduct(PRODUCT_ID);
  const s = p.settlement.toLowerCase();
  kind = s === D.sessionPay.toLowerCase() ? "session" : s === D.x402Settler.toLowerCase() ? "x402" : "other";
  return kind;
}

// ---------- automatic settlement: the operator is paid without depending on the client ----------
// Signed receipts go to the client; the v2 enclave keeps the last one of each session (GET /v1/session/:id/receipt).
// The registrar, which already holds the operator's key, settles by itself: when the amount due amply covers the gas
// (SETTLE_MIN), or when the session nears its end (the last settlement is possible until expiry plus the grace period).
const SETTLE = process.env.SETTLE !== "0";
const SETTLE_MIN = BigInt(process.env.SETTLE_MIN_MICRO_USDC ?? "20000"); // 0.02 USDC; a settlement costs ≈ 0.005 USDC of gas
const SETTLE_BEFORE_END_S = BigInt(process.env.SETTLE_BEFORE_END_S ?? "1800");
const opened = parseAbiItem("event SessionOpened(uint256 indexed sessionId, address indexed owner, uint256 indexed productId, uint256 deposit)");
const sessionIds = new Set<bigint>();
// The session scan starts at the enclave's window, not at the deployment block: a scan from the deployment (≈ 1.46 M
// blocks, ≈ 300 getLogs calls in a row) runs into the public Arc RPC's rate limit (HTTP 429). A session only pays receipts
// from the enclave bound when it was opened, then active: nothing the enclave served here can settle was opened before the
// start of its window (fromBlock, kept by gap-free renewals). So the scan starts there (SESSION_SCAN_FROM_BLOCK forces
// another start; never before the deployment), without bursts (SESSION_SCAN_PAUSE_MS between two pages); progress is kept.
let scannedTo: bigint | undefined;
const SCAN_PAUSE_MS = Number(process.env.SESSION_SCAN_PAUSE_MS ?? "300");

async function scanStart(signer: Address): Promise<bigint> {
  const forced = process.env.SESSION_SCAN_FROM_BLOCK;
  const from = forced ? BigInt(forced) : BigInt((await arc.getEnclave(signer))?.fromBlock ?? 0);
  return from > D.deployBlock ? from : D.deployBlock;
}

async function scanSessions(signer: Address) {
  let at: bigint;
  if (scannedTo === undefined) {
    const start = await scanStart(signer);
    console.log(`[${now()}] sessions: scanning session openings since block ${start}`);
    at = start - 1n;
  } else at = scannedTo;
  const head = await pub.getBlockNumber();
  while (at < head) {
    const from = at + 1n, to = from + 4_999n > head ? head : from + 4_999n;
    const logs = await pub.getLogs({ address: D.sessionPay, event: opened, args: { productId: PRODUCT_ID }, fromBlock: from, toBlock: to });
    for (const l of logs) sessionIds.add(l.args.sessionId!);
    at = to;
    scannedTo = at;
    if (at < head && SCAN_PAUSE_MS > 0) await sleep(SCAN_PAUSE_MS);
  }
  scannedTo = at;
}

async function settleSessions(signer: Address) {
  await scanSessions(signer);
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  for (const id of [...sessionIds]) {
    const s = await arc.getSession(id) as any;
    if (s.closed) { sessionIds.delete(id); continue; }
    if (String(s.operator).toLowerCase() !== account.address.toLowerCase()) { sessionIds.delete(id); continue; }
    const res = await fetch(`${ENCLAVE}/v1/session/${id}/receipt`).catch(() => null);
    if (!res?.ok) continue; // no receipt at this enclave (not served yet, or served before a restart)
    const j = await res.json() as { receipt: any; signature: Hex };
    const r = normalizeReceipt(j.receipt);
    const v = await verifyReceiptOnChain(pub as any, r, j.signature, D);
    if (!v.settleable || v.payableNow === 0n) continue;
    const ending = BigInt(s.expiresAt) - nowS < SETTLE_BEFORE_END_S;
    if (v.payableNow < SETTLE_MIN && !ending) continue;
    const { request } = await pub.simulateContract({ account, address: D.sessionPay, abi: sessionPayAbi, functionName: "settle", args: [r, j.signature] } as any);
    const tx = await wallet.writeContract(request as any);
    const rc = await pub.waitForTransactionReceipt({ hash: tx });
    console.log(`[${now()}] session #${id} settled: +${Number(v.payableNow) / 1e6} USDC (${r.cumulativeUnits} units in total${ending ? ", end of session" : ""}): ${tx} (status ${rc.status}, gas ${rc.gasUsed})`);
  }
}

// ---------- pay per call (x402): each served call is settled on its own, fast (the payer's authorization expires in 15 min)
// ONE queue for this process: passes run in series (x402Loop waits for a pass to end before the next one; runOnce
// shares a pass in progress), calls are tracked by (payer, nonce), signed reports are never duplicated.
const X402_EVERY_S = Number(process.env.X402_CHECK_SECONDS ?? "10");
if (!Number.isFinite(X402_EVERY_S) || X402_EVERY_S < 5) { console.error("X402_CHECK_SECONDS: at least 5"); process.exit(1); }
const X402_UNCOVERED_CHECKS = Number(process.env.X402_UNCOVERED_CHECKS ?? "25");
if (!Number.isSafeInteger(X402_UNCOVERED_CHECKS) || X402_UNCOVERED_CHECKS < 0) { console.error("X402_UNCOVERED_CHECKS: an integer ≥ 0"); process.exit(1); }
const x402Queue = createX402SettlementQueue({
  enclaveUrl: ENCLAVE, publicClient: pub as any, walletClient: wallet as any, account, deployment: D,
  maxUncoveredChecks: X402_UNCOVERED_CHECKS,
  log: (m) => console.log(`[${now()}] x402: ${m}`),
});
let lastWaitingLog = 0;

async function settleX402Once() {
  const r = await x402Queue.runOnce();
  for (const s of r.settled) {
    console.log(`[${now()}] x402: call ${s.nonce.slice(0, 10)}… from ${s.payer} settled: +${Number(s.amount) / 1e6} USDC (X402Settler.settle ${s.tx}, gas ${s.gasUsed ?? "?"})`);
  }
  if (r.alreadySettled) {
    const elsewhere = r.consumedElsewhere ? ` (${r.consumedElsewhere} of them with no visible X402Settler settlement: cancelled by the payer?)` : "";
    console.log(`[${now()}] x402: ${r.alreadySettled} call(s) already consumed on-chain${elsewhere}, reported to the enclave`);
  }
  if (r.expired) console.warn(`[${now()}] x402: ${r.expired} call(s) expired before settlement (lost)`);
  if (r.dropped) console.warn(`[${now()}] x402: ${r.dropped} call(s) skipped (they would not pay this operator)`);
  for (const f of r.failed) console.error(`[${now()}] x402: settlement of ${f.nonce.slice(0, 10)}… failed: ${f.error}`);
  if (r.fetchError) console.error(`[${now()}] x402: could not fetch /x402/pending: ${r.fetchError} (${r.known} call(s) already fetched are still tracked)`);
  if (r.waiting.length && Date.now() - lastWaitingLog > 10 * 60_000) {
    lastWaitingLog = Date.now();
    console.log(`[${now()}] x402: ${r.waiting.length} call(s) waiting (e.g. ${r.waiting[0]!.reasons.join("; ")})`);
  }
}

async function x402Loop() {
  for (;;) {
    try {
      const k = await settlementKind();
      if (k !== "x402") return; // this product is not paid per call
      await settleX402Once();
    } catch (e) {
      console.error(`[${now()}] x402: pass failed:`, explainArcError(e));
    }
    if (process.env.ONCE === "1") return;
    await sleep(X402_EVERY_S * 1000);
  }
}

async function loop() {
  for (;;) {
    try {
      const signer = await currentSigner();
      const why = await needsReattest(signer);
      let fresh: { signer: Address; tx: Hex } | undefined;
      if (why) { console.log(`[${now()}] re-attestation: ${why}`); fresh = await reattest(signer); }
      // verified level: the new registration changes the quote; the machine binding is redone right away
      const q = fresh ? await quoteFromRegisterTx(pub as any, fresh.tx).catch(() => undefined) : undefined;
      await keepVerified(fresh?.signer ?? signer, q).catch((e) => console.error(`[${now()}] verified level: upkeep failed:`, explainArcError(e)));
      await retirePrevious(signer).catch((e) => console.error(`[${now()}] could not retire the old key:`, explainArcError(e)));
      if (SETTLE) {
        const k = await settlementKind().catch(() => undefined);
        if (k === "session") await settleSessions(fresh?.signer ?? signer).catch((e) => console.error(`[${now()}] automatic settlement failed:`, explainArcError(e)));
      }
      lastSigner = signer;
    } catch (e) {
      console.error(`[${now()}] registrar error:`, explainArcError(e));
      if (arcErrorOf(e)?.name === "OperatorUnderbonded") {
        console.error(`[${now()}] → free bond too low: an old key still reserves the minimum bond. Run "arcvault operator status ${account.address}", then "arcvault operator retire --signer <old key>", or top up the bond.`);
      }
    }
    if (process.env.ONCE === "1") return; // single pass (a trial, or a run from a scheduled job)
    await sleep(CHECK_MIN * 60_000);
  }
}

console.log(`Registrar (stack ${process.env.DEPLOYMENTS ?? "SDK default, v2.1"}, DCAP): enclave ${ENCLAVE}, product ${PRODUCT_ID}, operator ${account.address}, checks every ${CHECK_MIN} min, renews ${RENEW_BEFORE_H} h before the window ends${RETIRE_PREVIOUS ? ", retires the old key after a restart" : ""}${LEVELS ? ", keeps the verified level (machine binding, Proof of Cloud token)" : ""}${SETTLE ? `, settles what the enclave served (sessions: from ${Number(SETTLE_MIN) / 1e6} USDC due or at the end of the session; x402 pay per call: every ${X402_EVERY_S} s)` : ""}`);
void Promise.all([loop(), SETTLE ? x402Loop() : Promise.resolve()]);
