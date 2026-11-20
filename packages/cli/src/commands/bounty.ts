/** bounty — the remote Sealed Bounty, v2 stack and later: hunter (list, status, submit) and protocol
 *  (create, reports). The plaintext exploit leaves this machine only encrypted: cE to an enclave whose X25519 key is
 *  VERIFIED on-chain (SDK verifyEnclaveKeys: never the raw key from /pubkeys), cP to the protocol's X25519 key read
 *  on-chain. Payment in two steps: acceptClaim (reserves; cP stays off the transaction) then deliver (delivers and pays).
 *
 *  Hardened after an adversarial review: `bounty create` generates a fresh X25519 key PER BOUNTY (secrets.ts: file mode
 *  0600, named after the public key), instead of one key shared by all of a protocol's bounties; `reports` and `refute`
 *  find it through Bounty.protocolX25519. The predicate follows the SDK's rules P1–P4 (bounds and shape: predicate.ts). */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeAbiParameters, isHex, keccak256, pad, parseEventLogs, recoverTypedDataAddress, toBytes, toHex,
  type Address, type Hex,
} from "viem";
import {
  checkProvenClaim, claimTypes, deterministicOpen, generateX25519,
  networkDomain, predicateHash, sealExploitForEnclave, sealedBountyAbi, testnet, validatePredicate,
  type Predicate, type ProvenClaim, type SealedExploit,
} from "@arcvault/sdk";
import {
  CliError, type Command, big, fmtTime, info, isBytes32, nowS, opt, out, parseAddr, parseId, parseUsdc, parseWhen,
  readJson, req, usdc, warn,
} from "../cli";
import {
  EIP2935_WINDOW, ZERO, bountyFeesBps, confirm, contractName, fetchLogs, httpJson, isActiveAt,
  reader, readTiers, sameAddr, verifiedEnclave, writer, type Pub, type Tier, type Writer,
} from "../chain";
import { listBounties, stateLabel } from "./read";
import {
  BOUNTY_KEY_DIR, LEGACY_PROTOCOL_KEY, createBountyKey, findBountyKey, loadProtocolKey, recordBountyId, saveR, type ProtocolKey,
} from "../secrets";

/** The older shared key (still read for the bounties created with it); every new bounty has its own key. */
export const DEFAULT_PROTOCOL_KEY = LEGACY_PROTOCOL_KEY;
export { loadProtocolKey };

// ---------- predicate, tiers, bundle ----------

/** A file's predicate, under the SDK's rules P1–P4 (pure JSON, nesting ≤ 8, ≤ 256 fields, ≤ 16 KiB canonical, 1 to 8
 *  clauses of a known shape). A predicate outside the rules is refused HERE and never reaches createBounty (no enclave would prove it). */
export function loadPredicate(raw: unknown, label: string): Predicate {
  const p = raw as Predicate;
  try {
    validatePredicate(p);
  } catch (e) {
    throw new CliError(`${label}: invalid predicate (${(e as Error).message})`);
  }
  return p;
}

function parseTiers(v: string): Tier[] {
  const tiers = v.split(",").map((pair) => {
    const [loss, amount] = pair.split(":").map((x) => x.trim());
    if (!loss || !amount) throw new CliError(`--tiers: "${pair}" expected as loss:amount (e.g. 1:1,1000:50)`);
    return { minLoss: parseUsdc(loss, "--tiers (perte)"), amount: parseUsdc(amount, "--tiers (montant)") };
  });
  for (let i = 0; i < tiers.length; i++) {
    if ((tiers[i] as Tier).amount === 0n) throw new CliError("--tiers: each tier must pay more than 0");
    if (i > 0 && ((tiers[i] as Tier).minLoss <= (tiers[i - 1] as Tier).minLoss || (tiers[i] as Tier).amount <= (tiers[i - 1] as Tier).amount)) {
      throw new CliError("--tiers: loss thresholds AND amounts must strictly increase (the contract refuses otherwise: BadTiers)");
    }
  }
  return tiers;
}

function tiersText(tiers: Tier[]): string {
  return tiers.map((t, i) => `[${i}] perte ≥ ${usdc(t.minLoss)} → ${usdc(t.amount)}`).join(" ; ");
}

export interface ExploitFile {
  predicate: Predicate;
  txs: Hex[];
  capital: string;
  attackCode?: Hex;
}

export function loadExploit(path: string): ExploitFile {
  const j = readJson(path, "exploit bundle") as any;
  const predicate = loadPredicate(j?.predicate, path);
  const txs = j?.txs;
  if (!Array.isArray(txs) || txs.length < 1 || txs.length > 10 || !txs.every((t: unknown) => typeof t === "string" && isHex(t))) {
    throw new CliError(`${path}: "txs" must be a list of 1 to 10 hex transactions`);
  }
  const capital = j?.capital === undefined ? "0" : String(big(j.capital, `${path} : capital`));
  if (j?.attackCode !== undefined && !(typeof j.attackCode === "string" && isHex(j.attackCode))) {
    throw new CliError(`${path}: "attackCode" must be hex`);
  }
  return { predicate, txs, capital, attackCode: j?.attackCode };
}

// ---------- claim ----------

interface Claim {
  bountyId: bigint; payee: Address; blockN: bigint; blockHashN: Hex; predicateHash: Hex; loss: bigint;
  tier: number; fingerprint: Hex; cPHash: Hex; deadline: bigint;
}

function normalizeClaim(c: any): Claim {
  const b32 = (k: string): Hex => {
    if (!isBytes32(c?.[k])) throw new CliError(`claim: ${k} is not a bytes32`);
    return c[k];
  };
  const tier = Number(c?.tier);
  if (!Number.isInteger(tier) || tier < 0 || tier > 255) throw new CliError("claim: invalid tier");
  return {
    bountyId: big(c?.bountyId, "bountyId"), payee: parseAddr(String(c?.payee), "payee"), blockN: big(c?.blockN, "blockN"),
    blockHashN: b32("blockHashN"), predicateHash: b32("predicateHash"), loss: big(c?.loss, "loss"), tier,
    fingerprint: b32("fingerprint"), cPHash: b32("cPHash"), deadline: big(c?.deadline, "deadline"),
  };
}

const claimJson = (c: Claim) => ({
  ...c, bountyId: c.bountyId.toString(), blockN: c.blockN.toString(), loss: c.loss.toString(), deadline: c.deadline.toString(),
});

/** Saves the proven claim (without the plaintext exploit), so it can be claimed without submitting again. */
function saveClaim(path: string | undefined, data: object, bountyId: bigint, fingerprint: Hex): string {
  let p = path ?? `claim-b${bountyId}-${fingerprint.slice(2, 10)}.json`;
  if (!path) for (let i = 2; existsSync(p); i++) p = `claim-b${bountyId}-${fingerprint.slice(2, 10)}-${i}.json`;
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  return p;
}

/** Checks the claim the enclaves signed (the contract's checks, off-chain), then gets it paid: acceptClaim (reserves
 *  the payment; cP is not in the transaction), then deliver (delivers cP and pays). Resumes at deliver when the
 *  reservation already exists (--resume after a failure). */
async function verifyAndClaim(w: Writer, a: {
  claim: Claim; signatures: Hex[]; cP: Hex; enclaveSigners: Address[]; expectedPayee?: Address; savedAt: string;
}): Promise<void> {
  const { claim, signatures, cP } = a;
  const fail = (m: string): never => {
    throw new CliError(`claim refused before sending: ${m} (claim saved at: ${a.savedAt})`);
  };
  const b = await w.arc.getBounty(claim.bountyId);
  if (b.protocol === ZERO) fail(`bounty #${claim.bountyId} does not exist`);
  const pending = await w.arc.pendingOf(claim.bountyId, claim.fingerprint);
  const reserved = pending.payee !== ZERO;
  if (reserved) {
    if (pending.cPHash.toLowerCase() !== keccak256(cP).toLowerCase()) fail("a payment is reserved for this fingerprint with another cP");
    info(`payment already reserved for this fingerprint (${usdc(pending.amount)} to ${pending.payee}): delivery only`);
  } else {
    const signers = await Promise.all(signatures.map((signature) => recoverTypedDataAddress({
      domain: networkDomain(testnet.sealedBounty, testnet.chainId) as any, types: claimTypes, primaryType: "Claim", message: claim, signature,
    })));
    signers.forEach((sg, i) => { if (!a.enclaveSigners.some((e) => sameAddr(e, sg))) fail(`signature ${i + 1}: signed by ${sg}, not by a verified enclave`); });
    if (a.expectedPayee && !sameAddr(claim.payee, a.expectedPayee)) fail(`payee ${claim.payee} ≠ ${a.expectedPayee}`);
    if (claim.predicateHash.toLowerCase() !== String(b.predicateHash).toLowerCase()) fail("predicateHash differs from the bounty's");
    if (keccak256(cP).toLowerCase() !== claim.cPHash.toLowerCase()) fail("keccak256(cP) ≠ cPHash");
    if (b.paused && claim.blockN >= b.pausedFromBlock) fail(`bounty paused for claims anchored from block ${b.pausedFromBlock}`);
    if (Number(b.deadline) < nowS()) fail("bounty expired");
    if (Number(claim.deadline) < nowS()) fail(`the claim's signed deadline has passed (${fmtTime(claim.deadline)}): ask for a new proof (ClaimExpired)`);
    const head = await w.pub.getBlockNumber();
    if (claim.blockN >= head || head - claim.blockN > EIP2935_WINDOW) fail(`block N ${claim.blockN} outside the EIP-2935 window (head ${head})`);
    if (claim.blockN <= b.lastPaidBlock) fail(`block N ${claim.blockN} is at or before the last payout or re-arming (${b.lastPaidBlock}): replay on a more recent block (AnchorBeforeLastPayout)`);
    for (const sg of signers) if (!(await isActiveAt(w.pub, sg, b.productId, claim.blockN))) fail(`enclave ${sg} was not active at block N`);
    const paid = await w.pub.readContract({ address: testnet.sealedBounty, abi: sealedBountyAbi, functionName: "fingerprintPaid", args: [claim.bountyId, claim.fingerprint] });
    if (paid) fail("fingerprint already paid: this exploit was already rewarded");
    const tiers = await readTiers(w.pub, claim.bountyId);
    const tier = tiers[claim.tier];
    if (!tier) fail(`palier ${claim.tier} inexistant`);
    if (claim.loss < (tier as Tier).minLoss) fail(`loss ${usdc(claim.loss)} below the threshold of tier ${claim.tier}`);
    const tierAmount = (tier as Tier).amount;
    if (tierAmount <= b.paidAmount) fail(`tier ${claim.tier} (${usdc(tierAmount)}) already covered: ${usdc(b.paidAmount)} already paid since the last arming (TierAlreadyPaid)`);
    const amount = tierAmount - b.paidAmount;
    if (tierAmount > b.singleCap) {
      const ops = new Set<string>();
      for (const sg of signers) ops.add(String((await w.arc.getEnclave(sg)).operator).toLowerCase());
      if (ops.size < b.k) fail(`tier ${usdc(tierAmount)} > single-enclave cap (${usdc(b.singleCap)}): ${b.k} distinct operators required, ${ops.size} sign (--enclave url1,url2,…)`);
    }
    const fees = await bountyFeesBps(w.pub);
    const total = amount + (amount * BigInt(fees.network)) / 10_000n + (amount * BigInt(fees.operator)) / 10_000n;
    if (b.balance < total) fail(`bounty balance ${usdc(b.balance)} < ${usdc(total)} (tier + fees)`);
    info(`5/6 · on-chain reservation (acceptClaim): tier ${claim.tier} (${usdc(amount)}), block N ${claim.blockN}, fingerprint ${claim.fingerprint}`);
    let hash: Hex;
    try {
      hash = await w.arc.acceptClaim(claim, signatures);
    } catch (e) {
      info(`reservation failed: do not submit the bundle to the enclave again, run "arcvault bounty submit --resume ${a.savedAt}"`);
      throw e;
    }
    const rcpt = await confirm(w, "acceptClaim", hash);
    if (!rcpt) return out(`[dry run] the claim would be accepted: ${usdc(amount)} reserved for ${claim.payee}; deliver would follow`);
  }
  info("6/6 · delivery of the encrypted report and payment (deliver)");
  let dh: Hex;
  try {
    dh = await w.arc.deliver(claim.bountyId, claim.fingerprint, cP);
  } catch (e) {
    info(`delivery failed: the payment stays reserved for 24 h; run "arcvault bounty submit --resume ${a.savedAt}"`);
    throw e;
  }
  const rcpt = await confirm(w, "deliver", dh);
  if (!rcpt) return out(`[dry run] the report would be delivered and the bounty paid to ${claim.payee}`);
  const ev = parseEventLogs({ abi: sealedBountyAbi, logs: rcpt.logs, eventName: "BountyPaid" })[0];
  out(`bounty #${claim.bountyId} paid: ${usdc(ev ? ev.args.amount : 0n)} to ${claim.payee} (tier ${claim.tier}), report delivered to the protocol`);
}

// ---------- commandes ----------

const list: Command = {
  path: ["bounty", "list"],
  summary: "lists the bounties (state, balance, expiry)",
  usage: "bounty list",
  run: listBounties,
};

const status: Command = {
  path: ["bounty", "status"],
  summary: "a bounty in detail: tiers, fees, single-enclave cap, protocol key, balance",
  usage: "bounty status <id>",
  args: [{ name: "id", desc: "the bounty's id" }],
  examples: ["arcvault bounty status 1"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const { arc, pub } = reader(ctx.rpc);
    const b = await arc.getBounty(id);
    if (b.protocol === ZERO) throw new CliError(`bounty #${id} does not exist`);
    const tiers = await readTiers(pub, id);
    const fees = await bountyFeesBps(pub);
    const p = await arc.getProduct(b.productId);
    const top = tiers.length ? (tiers[tiers.length - 1] as Tier).amount : 0n;
    const topTotal = top + (top * BigInt(fees.network + fees.operator)) / 10_000n;
    out(`bounty #${id}  ${b.paused ? "paused" : Number(b.deadline) < nowS() ? "expired" : "open"}`);
    out(`  protocole            ${b.protocol}`);
    out(`  product              #${b.productId} (${p.deterministic ? "deterministic" : "not deterministic"}, settlement ${contractName(p.settlement)}, ${stateLabel(p.state)})`);
    out(`  predicateHash        ${b.predicateHash}`);
    out(`  protocol key         ${b.protocolX25519} (X25519: the cP reports are encrypted to it)`);
    out(`  paliers              ${tiers.length ? tiersText(tiers) : "—"}`);
    out(`  extra fees           network ${fees.network / 100} % + operators ${fees.operator / 100} % (taken from the balance)`);
    out(`  single-enclave cap   ${usdc(b.singleCap)}; above it: ${b.k} distinct operator(s)`);
    out(`  target to pause      ${b.targetToPause === ZERO ? "none" : b.targetToPause}`);
    out(`  deadline             ${fmtTime(b.deadline)}`);
    out(`  already paid         ${b.paidAmount > 0n ? `${usdc(b.paidAmount)} since the last arming (a higher tier pays only the difference; anchors after block ${b.lastPaidBlock})` : "nothing since the last arming"}`);
    if (b.paused) out(`  pause                for claims anchored from block ${b.pausedFromBlock}`);
    out(`  balance              ${usdc(b.balance)}${topTotal > 0n ? ` (pays the highest tier ${b.balance / topTotal} time(s), fees included)` : ""}`);
  },
};

const create: Command = {
  path: ["bounty", "create"],
  summary: "creates and funds a Sealed Bounty (protocol)",
  usage: "bounty create --product <id> --predicate <predicate.json> --tiers <loss:amount,…> --funding <usdc> [--cap <usdc>] [--k 2] [--pause <address>] [--deadline 7d] [--protocol-key <new file>]",
  description: [
    "The predicate (JSON { combine, clauses }) describes what proves the exploit; its canonical hash is pinned",
    "on-chain: publish the file for the hunters. The targets are the clauses' addresses. Bounds: nesting",
    "≤ 8 levels, ≤ 256 fields, canonical JSON ≤ 16 KiB, 1 to 8 clauses (beyond that, no enclave would prove it).",
    "A NEW X25519 key is created for EACH bounty (a 0600 file in ~/.arcvault/bounty-keys/, named by its public",
    "key): only it decrypts this bounty's reports, and revealing it (bounty refute --reveal-key) opens only those.",
  ],
  options: [
    { name: "product", value: "<id>", desc: "a Sealed Bounty product (deterministic, settled by SealedBounty)", required: true },
    { name: "predicate", value: "<file>", desc: "JSON predicate v0 (1 to 8 clauses)", required: true },
    { name: "tiers", value: "<list>", desc: "loss:amount tiers in USDC, with increasing thresholds and amounts (e.g. 1:1,1000:50)", required: true },
    { name: "funding", value: "<usdc>", desc: "initial funding of the pool", required: true },
    { name: "cap", value: "<usdc>", desc: "amount payable on a single enclave (default: the highest tier)" },
    { name: "k", value: "<n>", desc: "distinct operators required above the cap (1 to 5, default 2)" },
    { name: "pause", value: "<address>", desc: "target to pause (pause()) at payout, if it allows it" },
    { name: "deadline", value: "<when>", desc: "deadline: a duration (7d), a Unix timestamp or an ISO date (default 7d)" },
    { name: "protocol-key", value: "<new file>", desc: `where to write this bounty's NEW X25519 key (default ${BOUNTY_KEY_DIR}/x25519-<public key>.json; never an existing file)` },
  ],
  write: true,
  examples: [
    "arcvault bounty create --product 2 --predicate predicat.json --tiers 1:1 --funding 2 --pause 0xD4f4d2Bb6bf662e738cB8917b9Ade152c245F8a1",
  ],
  async run(ctx) {
    const productId = parseId(req(ctx, "product"), "--product");
    const predicatePath = req(ctx, "predicate");
    const predicate = loadPredicate(readJson(predicatePath, "predicate"), predicatePath);
    const ph = predicateHash(predicate);
    const tiers = parseTiers(req(ctx, "tiers"));
    const funding = parseUsdc(req(ctx, "funding"), "--funding");
    const top = (tiers[tiers.length - 1] as Tier).amount;
    const singleCap = opt(ctx, "cap") !== undefined ? parseUsdc(req(ctx, "cap"), "--cap") : top;
    const k = opt(ctx, "k") !== undefined ? Number(parseId(opt(ctx, "k"), "--k")) : 2;
    if (k < 1 || k > 5) throw new CliError("--k: between 1 and 5 (the contract accepts at most 5 signatures)");
    const target = opt(ctx, "pause") !== undefined ? parseAddr(req(ctx, "pause"), "--pause") : ZERO;
    const deadline = parseWhen(opt(ctx, "deadline") ?? "7d", "--deadline");
    if (Number(deadline) <= nowS()) throw new CliError("--deadline is in the past");
    const keyOut = opt(ctx, "protocol-key");
    if (keyOut !== undefined && existsSync(keyOut)) {
      throw new CliError(`--protocol-key: ${keyOut} already exists; one X25519 key per bounty (it opens every report encrypted to it): give a new file`);
    }

    const w = await writer(ctx);
    const p = await w.arc.getProduct(productId);
    if (p.state !== "Active") throw new CliError(`product #${productId} not active (${stateLabel(p.state)})`);
    if (!p.deterministic || !sameAddr(p.settlement, testnet.sealedBounty)) {
      throw new CliError(`product #${productId} is not a Sealed Bounty (deterministic, settled by SealedBounty)`);
    }
    const bal = await w.arc.usdcBalance(w.account.address);
    if (bal < funding) throw new CliError(`solde USDC insuffisant : ${usdc(bal)} < ${usdc(funding)}`);
    const fees = await bountyFeesBps(w.pub);
    const topTotal = top + (top * BigInt(fees.network + fees.operator)) / 10_000n;
    if (funding < topTotal) warn(`the funding (${usdc(funding)}) does not cover the highest tier with fees (${usdc(topTotal)})`);
    if (singleCap < top && k > 1) {
      warn(`tiers above ${usdc(singleCap)} require ${k} signatures from distinct operators: the hunter will need ${k} enclaves to prove the exploit (arcvault bounty submit --enclave url1,url2,…)`);
    }

    // a NEW X25519 key for this bounty (never another bounty's: --reveal-key will open only its reports)
    let key: ProtocolKey;
    let keyPath: string | undefined;
    if (w.dryRun) {
      const k2 = generateX25519();
      key = { publicKey: k2.publicKey, privateKey: k2.privateKey };
      info("[dry run] ephemeral bounty key (no file written; a new key would be created in 0600)");
    } else {
      ({ path: keyPath, key } = createBountyKey({ path: keyOut, sealedBounty: testnet.sealedBounty, chainId: testnet.chainId }));
      info(`bounty key created: ${keyPath} (mode 0600, one key per bounty), public ${key.publicKey}`);
    }

    info(`bounty: product #${productId}, predicate ${ph}, tiers ${tiersText(tiers)}, single-enclave cap ${usdc(singleCap)}, k = ${k}, deadline ${fmtTime(deadline)}`);
    const r = await w.arc.createBounty({
      productId, predicateHash: ph, protocolX25519: key.publicKey, tierMinLoss: tiers.map((t) => t.minLoss),
      tierAmount: tiers.map((t) => t.amount), singleCap, k, targetToPause: target, deadline, funding,
    });
    const rcpt = await confirm(w, "createBounty", r.tx);
    if (!rcpt) return out(`[dry run] bounty #${r.bountyId} would be created and funded (${usdc(funding)})`);
    const ev = parseEventLogs({ abi: sealedBountyAbi, logs: rcpt.logs, eventName: "BountyCreated" })[0];
    const id = ev ? ev.args.bountyId : r.bountyId;
    if (keyPath) recordBountyId(keyPath, id);
    out(`bounty #${id} created and funded (${usdc(funding)})`);
    info(`publish ${predicatePath} for the hunters (predicateHash ${ph}); reports: arcvault bounty reports ${id} (key: ${keyPath})`);
  },
};

const submit: Command = {
  path: ["bounty", "submit"],
  summary: "hunter: proves an exploit in one or k enclaves (keys verified on-chain), then gets the bounty paid",
  usage: "bounty submit --bounty <id> --bundle <exploit.json> --enclave <url>[,<url>…] [--payee <address>] [--out <file>] [--save-r <new file>] | --resume <file>",
  description: [
    "exploit.json: { predicate, txs: [0x…] (1 to 10), capital?: \"<integer>\", attackCode?: 0x… };",
    "the predicate must be the bounty's (same hash). Steps: read the bounty, check that each enclave's key is the one",
    "REGISTERED on-chain and that it is active for the bounty's product (otherwise nothing is encrypted), encrypt cP",
    "(to the protocol), then cE (to each enclave), prove, check the signed claim, save it, then pay in two steps:",
    "acceptClaim (reserves), then deliver (delivers the report and pays).",
    "Several enclaves (k distinct operators, above the single-enclave cap): the same block N and deadline for all.",
    "A proven claim is saved (without the plaintext exploit): after a failure, --resume replays it",
    "without submitting the bundle again. --dry-run has the enclaves prove the exploit but only simulates the reservation.",
  ],
  options: [
    { name: "bounty", value: "<id>", desc: "the target bounty" },
    { name: "bundle", value: "<file>", desc: "JSON exploit bundle (stays on this machine, sent encrypted)" },
    { name: "enclave", value: "<url[,url…]>", desc: "URL of the Sealed Bounty service of one or more registered enclaves" },
    { name: "payee", value: "<address>", desc: "payee (default: the PRIVATE_KEY address)" },
    { name: "out", value: "<file>", desc: "where to save the proven claim (default claim-b<id>-<fingerprint>.json)" },
    { name: "resume", value: "<file>", desc: "gets an already proven and saved claim paid" },
    { name: "save-r", value: "<new file>", desc: "keeps cP's random r in this NEW file (0600): enough to refute later (bounty refute --r-file); with the public cP, r opens the exploit" },
  ],
  write: true,
  examples: [
    "arcvault bounty submit --bounty 1 --bundle exploit.json --enclave https://…-8803.dstack-pha1-prod9.phala.network",
    "arcvault bounty submit --resume claim-b1-1a2b3c4d.json",
  ],
  async run(ctx) {
    const resume = opt(ctx, "resume");
    if (resume) {
      const j = readJson(resume, "saved claim") as any;
      if (j?.kind !== "arcvault-bounty-claim") throw new CliError(`${resume} is not a claim saved by arcvault`);
      const w = await writer(ctx);
      const signatures: Hex[] = Array.isArray(j.signatures) ? j.signatures : [j.signature];
      const signers: string[] = Array.isArray(j.signers) ? j.signers : [j.signer];
      await verifyAndClaim(w, {
        claim: normalizeClaim(j.claim), signatures, cP: j.cP as Hex,
        enclaveSigners: signers.map((x) => parseAddr(String(x), "signer")), savedAt: resume,
      });
      return;
    }
    const id = parseId(req(ctx, "bounty"), "--bounty");
    const bundlePath = req(ctx, "bundle");
    const urls = req(ctx, "enclave").split(",").map((u) => u.trim().replace(/\/$/, "")).filter(Boolean);
    if (!urls.length || urls.length > 5) throw new CliError("--enclave: 1 to 5 comma-separated URLs (the contract accepts at most 5 signatures)");
    const exploit = loadExploit(bundlePath);
    const w = await writer(ctx);
    const payee = opt(ctx, "payee") !== undefined ? parseAddr(req(ctx, "payee"), "--payee") : w.account.address;

    info(`1/6 · bounty #${id}: on-chain read`);
    const b = await w.arc.getBounty(id);
    if (b.protocol === ZERO) throw new CliError(`bounty #${id} does not exist`);
    if (b.paused) warn(`bounty #${id} paused for claims anchored from block ${b.pausedFromBlock}`);
    if (Number(b.deadline) < nowS()) throw new CliError(`bounty #${id} expired`);
    const ph = predicateHash(exploit.predicate);
    if (ph.toLowerCase() !== String(b.predicateHash).toLowerCase()) {
      throw new CliError(`the bundle's predicate (${ph}) is not the bounty's (${b.predicateHash})`);
    }
    const tiers = await readTiers(w.pub, id);
    if (!tiers.length) throw new CliError(`bounty #${id} has no tier`);

    info(`2/6 · enclave(s): X25519 key = the one registered on-chain, active for product #${b.productId}`);
    const keys = [];
    for (const url of urls) {
      const k = await verifiedEnclave(w.pub, url, b.productId);
      info(`  ✓ ${url} → enclave ${k.signer} (operator ${k.operator})`);
      keys.push(k);
    }

    info("3/6 · encryption: cP to the protocol key (read on-chain), then cE to each verified enclave (HPKE)");
    // several enclaves: the same random r, block N and deadline, so that they sign the SAME claim
    const multi = keys.length > 1;
    const head = await w.pub.getBlockNumber();
    const r = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const saveRPath = opt(ctx, "save-r");
    if (saveRPath !== undefined) {
      saveR(saveRPath, r);
      info(`  random r kept in ${saveRPath} (0600): with the public cP it opens the exploit, so guard it like the bundle`);
    }
    const anchor = multi ? { blockN: head - 8n, deadline: BigInt(nowS() + 480) } : {};
    const sealed: SealedExploit[] = [];
    for (const k of keys) {
      sealed.push(await sealExploitForEnclave({
        bountyId: id, payee, exploit: { ...exploit, capital: exploit.capital }, protocolX25519: b.protocolX25519, enclave: k, r, ...anchor,
      }));
    }
    r.fill(0);

    info(`4/6 · proof: ${keys.length} enclave(s) replay the exploit and sign the claim if the predicate is satisfied`);
    const proven: ProvenClaim[] = [];
    for (const sx of sealed) {
      const res = await httpJson(`${sx.enclave.enclaveUrl}/bounty/submit`, { body: sx.submitBody, timeoutMs: 180_000 });
      if (res?.status !== "proven") throw new CliError(`not proven by enclave ${sx.enclave.signer}: ${res?.reason ?? res?.error ?? JSON.stringify(res)}`);
      if (!isHex(res.signature) || !isHex(res.cP)) throw new CliError("incomplete enclave answer (signature, cP)");
      try {
        proven.push(await checkProvenClaim(sx, { claim: res.claim, signature: res.signature, cP: res.cP }, { sealedBounty: testnet.sealedBounty, chainId: testnet.chainId }));
      } catch (e) {
        throw new CliError((e as Error).message);
      }
    }
    const first = proven[0]!;
    const claim = normalizeClaim(claimJson(first.claim));
    const same = proven.every((p) => JSON.stringify(claimJson(p.claim)) === JSON.stringify(claimJson(first.claim)));
    if (!same) throw new CliError("the enclaves did not sign the same claim (different block N or deadline): try again");
    const signatures = proven.map((p) => p.signature);
    const signers = proven.map((p) => p.signer);
    const savedAt = saveClaim(opt(ctx, "out"), {
      kind: "arcvault-bounty-claim", enclaves: urls, signers, signatures, claim: claimJson(claim), cP: first.cP,
    }, id, claim.fingerprint);
    info(`  claim proven${multi ? ` by ${signers.length} enclaves` : ""} and saved: ${savedAt}`);
    await verifyAndClaim(w, { claim, signatures, cP: first.cP, enclaveSigners: signers, expectedPayee: payee, savedAt });
  },
};

const reports: Command = {
  path: ["bounty", "reports"],
  summary: "protocol: decrypts the delivered exploit reports (ExploitDelivered events) with its key",
  usage: "bounty reports <id> [--key <fichier>] [--out <dossier>]",
  description: [
    "Each paid claim delivers cP (encrypted to the protocol's X25519 key) in the ExploitDelivered event.",
    "The decrypted report (payee, capital, predicate, transactions, attack code) is written to stdout.",
  ],
  args: [{ name: "id", desc: "the bounty's id" }],
  options: [
    { name: "key", value: "<file>", desc: `the bounty's X25519 key (default: found by its public key in ${BOUNTY_KEY_DIR}, otherwise ${LEGACY_PROTOCOL_KEY})` },
    { name: "out", value: "<folder>", desc: "also writes each decrypted report to this folder (0600 files)" },
  ],
  examples: ["arcvault bounty reports 3", "arcvault bounty reports 3 --key ./protocole.json --out ./rapports"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const outDir = opt(ctx, "out");
    const { arc, pub } = reader(ctx.rpc);
    const b = await arc.getBounty(id);
    if (b.protocol === ZERO) throw new CliError(`bounty #${id} does not exist`);
    const { key, path: keyPath } = findBountyKey(b.protocolX25519, { path: opt(ctx, "key") });
    info(`bounty key: ${keyPath}`);
    const logs = await deliveredReports(pub, id);
    if (!logs.length) return out(`no report delivered for bounty #${id}`);
    if (outDir) mkdirSync(outDir, { recursive: true, mode: 0o700 });
    let n = 0;
    for (const log of logs) {
      n++;
      const [cP] = decodeAbiParameters([{ type: "bytes" }], log.data) as [Hex];
      out(`rapport ${n} · bloc ${log.blockNumber} · tx ${log.txHash}`);
      let report: any;
      try {
        report = JSON.parse(new TextDecoder().decode(deterministicOpen(key.privateKey, cP)));
      } catch {
        out("  unreadable: encrypted to another key, or cP not in the arcvault format");
        continue;
      }
      out(JSON.stringify(report, null, 2).split("\n").map((l) => `  ${l}`).join("\n"));
      if (outDir) {
        const f = join(outDir, `report-b${id}-${n}.json`);
        writeFileSync(f, `${JSON.stringify({ bountyId: id.toString(), block: log.blockNumber.toString(), tx: log.txHash, report }, null, 2)}\n`, { mode: 0o600 });
        info(`  → ${f}`);
      }
    }
  },
};

async function deliveredReports(pub: Pub, id: bigint) {
  const topic0 = keccak256(toBytes("ExploitDelivered(uint256,bytes)"));
  return fetchLogs(pub, testnet.sealedBounty, topic0, pad(toHex(id), { size: 32 }));
}

export const bountyCommands: Command[] = [list, status, create, submit, reports];
export const BOUNTY_TITLE = "the Sealed Bounty: bounties, exploit proof in an enclave, claim paid in the block, encrypted reports";
