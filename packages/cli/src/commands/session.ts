/** session — prepaid SessionPay sessions and aek_ access keys. */
import { parseEventLogs, type Address } from "viem";
import { encodeAek, generateSessionKey, sessionCeiling, sessionPayAbi, testnet } from "@arcvault/sdk";
import {
  CliError, type Command, dur, fmtTime, info, nowS, opt, out, parseAddr, parseDurationS, parseId, parseUsdc, req, usdc, warn,
} from "../cli";
import {
  NET_TAG, RevertedOnChain, ZERO, confirm, contractName, reader, sameAddr, sessionExtraAbi, verifiedEnclave,
  walletAddressIfAny, writer, type Writer,
} from "../chain";
import { stateLabel } from "./read";

async function loadSession(arc: Writer["arc"], id: bigint) {
  const s = await arc.getSession(id);
  if (!s || s.owner === ZERO) throw new CliError(`session #${id} does not exist`);
  return s;
}

const open: Command = {
  path: ["session", "open"],
  summary: "opens a prepaid session LOCKED to one enclave (keys verified on-chain) and issues its aek_ access key",
  usage: "session open --product <id> --enclave <url> --deposit <usdc> [--operator <address>] [--cap <usdc>] [--expires 24h]",
  description: [
    "A session pays only the receipts of the enclave chosen at opening. The --enclave keys are checked against",
    "the chain BEFORE anything else (registered X25519 key, enclave active for the product); the operator follows from",
    "them (--operator must match if given). The product's price, model and unit are locked at opening.",
    "The session key is born on this machine; only its public address is registered on-chain.",
    "The aek_… access key is written ONCE to standard output (nothing else is written there):",
    "keep it as a secret. It cannot spend more than the deposit (or the cap).",
  ],
  options: [
    { name: "product", value: "<id>", desc: "a product settled by SessionPay (e.g. inference)", required: true },
    { name: "enclave", value: "<url>", desc: "URL of the enclave that will serve the session (its keys are verified on-chain)", required: true },
    { name: "deposit", value: "<usdc>", desc: "deposit in USDC", required: true },
    { name: "operator", value: "<address>", desc: "check: the expected operator of this enclave" },
    { name: "cap", value: "<usdc>", desc: "spending cap (default: the deposit)" },
    { name: "expires", value: "<duration>", desc: "the session's expiry (default 24h; between 12 min and 30 d)" },
  ],
  write: true,
  examples: [
    "arcvault session open --product 1 --enclave https://…-8802.dstack-pha1-prod9.phala.network --deposit 2 > my-key.txt",
    "arcvault session open --product 1 --enclave https://…-8802.dstack-pha1-prod9.phala.network --deposit 2 --dry-run",
  ],
  async run(ctx) {
    const productId = parseId(req(ctx, "product"), "--product");
    const enclaveUrl = req(ctx, "enclave").replace(/\/$/, "");
    const operator = opt(ctx, "operator") !== undefined ? parseAddr(req(ctx, "operator"), "--operator") : undefined;
    const deposit = parseUsdc(req(ctx, "deposit"), "--deposit");
    const cap = opt(ctx, "cap") !== undefined ? parseUsdc(req(ctx, "cap"), "--cap") : 0n;
    const expiresIn = parseDurationS(opt(ctx, "expires") ?? "24h", "--expires");
    if (deposit === 0n) throw new CliError("--deposit must be > 0");

    const w = await writer(ctx);
    const p = await w.arc.getProduct(productId);
    if (p.state !== "Active") throw new CliError(`product #${productId} not active (${stateLabel(p.state)})`);
    if (!sameAddr(p.settlement, testnet.sessionPay)) {
      throw new CliError(`product #${productId} settles through ${contractName(p.settlement)}, not SessionPay: no prepaid session`);
    }
    if (p.price === 0n) throw new CliError(`product #${productId} has a price of 0: SessionPay opens no session (ZeroPrice)`);
    const bal = await w.arc.usdcBalance(w.account.address);
    if (bal < deposit) throw new CliError(`USDC balance too low: ${usdc(bal)} < ${usdc(deposit)}`);
    const keys = await verifiedEnclave(w.pub, enclaveUrl, productId);
    if (operator && !sameAddr(operator, keys.operator)) {
      throw new CliError(`enclave ${keys.signer} is active for operator ${keys.operator}, not for ${operator}`);
    }
    info(`enclave verified on-chain: ${keys.signer} (operator ${keys.operator}, registered X25519 key, active at block ${keys.checkedAtBlock})`);
    info(`session: product #${productId} (${usdc(p.price)}/unit locked, unit ${p.unitTokens} token(s), output ×${p.outWeight}), deposit ${usdc(deposit)}${cap ? `, cap ${usdc(cap)}` : ""}, expires in ${dur(expiresIn)}`);
    const r = await w.arc.openSession({ productId, enclave: keys.signer, operator: keys.operator, deposit, cap, expiresInSeconds: expiresIn });
    if (w.dryRun) return info("[dry run] no access key issued: it is only worth something after the real transaction");

    let sessionId = r.sessionId; // simulated result; replaced by the SessionOpened event
    try {
      const rcpt = await confirm(w, "openSession", r.tx);
      const ev = rcpt && parseEventLogs({ abi: sessionPayAbi, logs: rcpt.logs, eventName: "SessionOpened" })[0];
      if (ev) sessionId = ev.args.sessionId;
    } catch (e) {
      if (e instanceof RevertedOnChain) throw e; // nothing opened: the key is worthless
      info(`confirmation failed; the key below assumes session #${sessionId} (check with: arcvault session status ${sessionId})`);
      out(encodeAek(NET_TAG, sessionId, r.sessionKey.privateKey));
      throw e;
    }
    info(`session #${sessionId} opened, locked to enclave ${r.enclave}. Access key (written once to standard output, keep it secret):`);
    out(encodeAek(NET_TAG, sessionId, r.sessionKey.privateKey));
    info(`→ ARC_AEK=<key> arcvault proxy --enclave ${enclaveUrl}`);
  },
};

const list: Command = {
  path: ["session", "list"],
  summary: "lists an owner's sessions",
  usage: "session list [--owner <address>]",
  options: [{ name: "owner", value: "<address>", desc: "owner (default: the PRIVATE_KEY address)" }],
  examples: ["arcvault session list --owner 0x5724d89D610c3017b8DC161c025248341556f6Ab"],
  async run(ctx) {
    const o = opt(ctx, "owner");
    const owner = o ? parseAddr(o, "--owner") : walletAddressIfAny();
    if (!owner) throw new CliError("--owner <address> required (or PRIVATE_KEY set)");
    const { arc } = reader(ctx.rpc);
    const rows = await arc.listMySessions(owner as Address);
    if (!rows.length) return out(`no session for ${owner}`);
    for (const s of rows) {
      out(`#${s.id}  ${s.closed ? "closed " : "open   "}  product #${s.productId}  enclave ${s.enclave}  deposit ${usdc(s.deposit)}  settled ${usdc(s.paid)}  (${usdc(s.price)}/unit)`);
    }
  },
};

const status: Command = {
  path: ["session", "status"],
  summary: "a session's state: locked enclave, deposit, settled, available, current key, expiry, closing",
  usage: "session status <id>",
  args: [{ name: "id", desc: "the session's id" }],
  examples: ["arcvault session status 12"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const { arc } = reader(ctx.rpc);
    const s = await loadSession(arc, id);
    const ceiling = sessionCeiling(s);
    const left = ceiling > s.paid ? ceiling - s.paid : 0n;
    const c = await arc.sessionClosability(id);
    out(`session #${id}  ${s.closed ? "closed" : Number(s.expiresAt) < nowS() ? "expired (not closed)" : "open"}`);
    out(`  owner            ${s.owner}`);
    out(`  product          #${s.productId}, locked at opening: ${usdc(s.price)}/unit, unit ${s.unitTokens} token(s), output ×${s.outWeight}, model ${s.param}`);
    out(`  enclave          ${s.enclave} (only its receipts pay this session)`);
    out(`  operator         ${s.operator}`);
    out(`  session key      ${s.sessionKey} (public address of the current key; the enclave serves only this one)`);
    out(`  deposit          ${usdc(s.deposit)}${s.cap === 0n ? "" : `  cap ${usdc(s.cap)}`}`);
    out(`  settled          ${usdc(s.paid)} (${s.paidUnits} units)`);
    if (s.closed) out(`  refunded         ${usdc(s.deposit - s.paid)} to the owner at closing`);
    else out(`  available        ${usdc(left)}${s.price > 0n ? ` (≈ ${left / s.price} units)` : ""}`);
    out(`  expiry           ${fmtTime(s.expiresAt)}`);
    if (!s.closed) {
      out(`  closing          ${c.closableNow ? "possible now" : `possible ${fmtTime(c.atTime)} (expiry + 1 h), or from block ${c.afterBlock + 1n} if the enclave can no longer settle anything (head ${c.head})`}`);
    }
    out(`  ERC-8004 verdict ${s.verdictWritten ? "written" : "pending"}`);
  },
};

const topup: Command = {
  path: ["session", "topup"],
  summary: "tops up a session (EIP-3009, a single call)",
  usage: "session topup <id> --amount <usdc>",
  args: [{ name: "id", desc: "the session's id" }],
  options: [{ name: "amount", value: "<usdc>", desc: "amount to add to the deposit", required: true }],
  write: true,
  examples: ["arcvault session topup 12 --amount 5"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const amount = parseUsdc(req(ctx, "amount"), "--amount");
    if (amount === 0n) throw new CliError("--amount must be > 0");
    const w = await writer(ctx);
    const s = await loadSession(w.arc, id);
    if (s.closed) throw new CliError(`session #${id} closed: no top-up possible`);
    if (!sameAddr(s.owner, w.account.address)) warn(`you are topping up another owner's session (${s.owner})`);
    const bal = await w.arc.usdcBalance(w.account.address);
    if (bal < amount) throw new CliError(`USDC balance too low: ${usdc(bal)} < ${usdc(amount)}`);
    const hash = await w.arc.topUp(id, amount);
    await confirm(w, "topUp", hash);
    out(`${w.dryRun ? "[dry run] " : ""}session #${id} topped up by ${usdc(amount)} (deposit ${usdc(s.deposit + amount)})`);
  },
};

const close: Command = {
  path: ["session", "close"],
  summary: "closes an expired session: refunds the rest to the owner, writes the ERC-8004 verdict",
  usage: "session close <id>",
  description: [
    "Possible from the expiry + 1 h (time left to the operator for its last settlement), or earlier as soon as",
    "the bound enclave can no longer settle anything (window and grace over, or killed). The ERC-8004 verdict needs its gas:",
    "the transaction leaves with a margin over the estimate.",
  ],
  args: [{ name: "id", desc: "the session's id" }],
  write: true,
  examples: ["arcvault session close 12"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const w = await writer(ctx);
    const s = await loadSession(w.arc, id);
    if (!sameAddr(s.owner, w.account.address)) throw new CliError(`only the owner (${s.owner}) can close session #${id}`);
    if (s.closed) throw new CliError(`session #${id} already closed`);
    const c = await w.arc.sessionClosability(id);
    if (!c.closableNow) {
      throw new CliError(`too early: closing possible ${fmtTime(c.atTime)} (expiry + 1 h), or from block ${c.afterBlock + 1n} (head ${c.head})`);
    }
    const hash = await w.arc.closeSession(id);
    const rcpt = await confirm(w, "closeSession", hash);
    const ev = rcpt && parseEventLogs({ abi: sessionExtraAbi, logs: rcpt.logs, eventName: "SessionClosed" })[0];
    const refund: bigint = ev ? ev.args.refund : s.deposit - s.paid;
    out(`${w.dryRun ? "[dry run] " : ""}session #${id} closed; refund of ${usdc(refund)} to ${s.owner}`);
  },
};

const rotate: Command = {
  path: ["session", "rotate"],
  summary: "rotates the session key: a new aek_ key created here, the old one revoked on-chain",
  usage: "session rotate <id>",
  description: [
    "Generates a new key locally, registers its address (rotateKey), then writes the new aek_ key",
    "ONCE to standard output (the only thing written to stdout; nothing is logged anywhere else).",
    "The enclave reads the current key on-chain at every request: the old one stops being served.",
  ],
  args: [{ name: "id", desc: "the session's id" }],
  write: true,
  examples: ["arcvault session rotate 12 > nouvelle-cle.txt"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const w = await writer(ctx);
    const s = await loadSession(w.arc, id);
    if (!sameAddr(s.owner, w.account.address)) throw new CliError(`only the owner (${s.owner}) can rotate the key of session #${id}`);
    if (s.closed) throw new CliError(`session #${id} closed`);
    const k = generateSessionKey();
    const hash = await w.arc.rotateKey(id, k.address as Address);
    if (w.dryRun) return info("[dry run] no new key issued");
    info(`rotation sent (${hash}). New access key, written only once:`);
    out(encodeAek(NET_TAG, id, k.privateKey)); // from the send on: never lose a key already registered
    try {
      await confirm(w, "rotateKey", hash);
    } catch (e) {
      info(e instanceof RevertedOnChain
        ? "FAILED: the key above is NOT active; the old key stays the session's key."
        : `confirmation failed: check "arcvault session status ${id}" (current key = ${k.address} if the rotation went through)`);
      throw e;
    }
    info(`current key: ${k.address}; the old one (${s.sessionKey}) is revoked.`);
  },
};

export const sessionCommands: Command[] = [open, list, status, topup, close, rotate];
export const SESSION_TITLE = "prepaid sessions (SessionPay) and aek_ access keys: open, follow, top up, close, rotate the key";
