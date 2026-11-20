/** operator — become an enclave provider: ERC-8004 identity, bond, enclave registration
 *  and re-attestation, receipt settlement, state. */
import { encodeFunctionData, parseEventLogs, toFunctionSelector, type AbiFunction, type Address, type Hex } from "viem";
import {
  enclaveRegistryAbi, operatorBondAbi, sealedBountyAbi, sessionPayAbi, testnet, usdcAbi, x402Abi, type Receipt,
} from "@arcvault/sdk";
import {
  CliError, type Command, UsageError, check, fmtTime, info, nowS, opt, out, parseAddr, parseId, parseUsdc, readJson, req,
  usdc, warn,
} from "../cli";
import {
  ERC8004_IDENTITY_TESTNET, ZERO, bondExtraAbi, confirm, enclaveGraceBlocks, enclavePubkeys, explainError, identityAbi,
  reader, sameAddr, sessionExtraAbi, walletAddressIfAny, writeCall, writer, type Pub,
} from "../chain";
import { normalizeReceipt, stateLabel } from "./read";

const readBond = (pub: Pub, fn: string, args: unknown[]) =>
  pub.readContract({ address: testnet.operatorBond, abi: [...operatorBondAbi, ...bondExtraAbi] as any, functionName: fn, args } as any);

const init: Command = {
  path: ["operator", "init"],
  summary: "prepares the operator's ERC-8004 identity and the VerdictLog approval (transactions to sign)",
  usage: "operator init [--uri <agentURI>] [--agent-id <n>] [--address <address>]",
  description: [
    "Sends nothing: shows the steps, with the recipient and calldata of each transaction to sign in your",
    "wallet, and the address's current state (reads). Arc testnet's ERC-8004 identity registry:",
    `${ERC8004_IDENTITY_TESTNET} (VERIFIED ; contracts/src/interfaces/IERC8004.sol).`,
  ],
  options: [
    { name: "uri", value: "<agentURI>", desc: "URI of the operator's ERC-8004 agent card (for the register calldata)" },
    { name: "agent-id", value: "<n>", desc: "agentId obtained at step 1 (for the setAgentId calldata)" },
    { name: "address", value: "<address>", desc: "address whose state to show (default: the PRIVATE_KEY address)" },
  ],
  examples: ["arcvault operator init --uri https://exemple.org/agent.json", "arcvault operator init --agent-id 42"],
  async run(ctx) {
    const uri = opt(ctx, "uri");
    const agentId = opt(ctx, "agent-id") !== undefined ? parseId(opt(ctx, "agent-id"), "--agent-id") : undefined;
    const a = opt(ctx, "address");
    const op = a ? parseAddr(a, "--address") : walletAddressIfAny();
    const tx = (to: Address, sig: string, data: Hex | undefined, missing?: string) => {
      out(`     to       ${to}`);
      out(`     fonction ${sig}`);
      out(`     calldata ${data ?? `(run again with ${missing} to generate it)`}`);
    };
    out("Become an operator: the steps (this command sends nothing):");
    out("  1. Create the operator's ERC-8004 identity (an agent token; the agentId is in the receipt's Transfer event)");
    tx(ERC8004_IDENTITY_TESTNET, `register("${uri ?? "<agentURI>"}")`, uri ? encodeFunctionData({ abi: identityAbi, functionName: "register", args: [uri] }) : undefined, "--uri <agentURI>");
    out("  2. Link this agentId to the bond (your enclaves' ERC-8004 verdicts are credited to it)");
    tx(testnet.operatorBond, `setAgentId(${agentId ?? "<agentId>"})`, agentId !== undefined ? encodeFunctionData({ abi: operatorBondAbi, functionName: "setAgentId", args: [agentId] }) : undefined, "--agent-id <n>");
    out("  3. Allow VerdictLog to request validations on behalf of your identity");
    out("     (the approval is enough: this is how VerdictLog writes agent 897812's verdicts on Arc testnet)");
    tx(ERC8004_IDENTITY_TESTNET, `setApprovalForAll(${testnet.verdictLog}, true)`, encodeFunctionData({ abi: identityAbi, functionName: "setApprovalForAll", args: [testnet.verdictLog, true] }));
    out("  4. Deposit the bond (at least the minimum bond of the product served): arcvault operator bond --amount <usdc>");
    out("  5. Deploy the product's TDX VM, then register the enclave: arcvault operator register --vm <url> --product <id>");
    if (!op) return info("(--address or PRIVATE_KEY to show the address's state)");
    const { pub } = reader(ctx.rpc);
    const tryRead = async (f: () => Promise<unknown>) => {
      try {
        return await f();
      } catch {
        return undefined;
      }
    };
    const ids = (await tryRead(() => pub.readContract({ address: ERC8004_IDENTITY_TESTNET, abi: identityAbi, functionName: "balanceOf", args: [op] }))) as bigint | undefined;
    const linked = (await readBond(pub, "agentIdOf", [op])) as bigint;
    const approved = (await tryRead(() => pub.readContract({ address: ERC8004_IDENTITY_TESTNET, abi: identityAbi, functionName: "isApprovedForAll", args: [op, testnet.verdictLog] }))) as boolean | undefined;
    const bond = (await readBond(pub, "bondOf", [op])) as bigint;
    out("");
    out(`State of ${op}:`);
    out(`  ${ids === undefined ? "?" : check(ids > 0n)} 1. ERC-8004 identity: ${ids === undefined ? "unreadable" : `${ids} agent token(s)`}`);
    out(`  ${check(linked > 0n)} 2. agentId linked to the bond: ${linked > 0n ? linked : "none"}`);
    out(`  ${approved === undefined ? "?" : check(approved)} 3. VerdictLog approved: ${approved === undefined ? "unreadable" : approved ? "yes" : "no"}`);
    out(`  ${check(bond > 0n)} 4. caution : ${usdc(bond)}`);
  },
};

const bond: Command = {
  path: ["operator", "bond"],
  summary: "deposits the bond in USDC (EIP-3009 in one call, or approve + bondFrom)",
  usage: "operator bond --amount <usdc> [--mode auth|allowance]",
  description: [
    "The bond caps what any one of your enclaves can charge over 24 h (half of the available bond),",
    "and it is slashed in full for a proven equivocation. Withdrawal: 7 days after the request.",
  ],
  options: [
    { name: "amount", value: "<usdc>", desc: "amount to deposit", required: true },
    { name: "mode", value: "<auth|allowance>", desc: "auth: an EIP-3009 authorization, one transaction (default); allowance: approve, then bondFrom" },
  ],
  write: true,
  examples: ["arcvault operator bond --amount 100"],
  async run(ctx) {
    const amount = parseUsdc(req(ctx, "amount"), "--amount");
    if (amount === 0n) throw new CliError("--amount must be > 0");
    const mode = opt(ctx, "mode") ?? "auth";
    if (mode !== "auth" && mode !== "allowance") throw new UsageError("--mode: auth or allowance", ctx.cmd);
    const w = await writer(ctx);
    const me = w.account.address;
    if ((await readBond(w.pub, "banned", [me])) as boolean) throw new CliError("address banned (slashed for equivocation): bond refused");
    const bal = await w.arc.usdcBalance(me);
    if (bal < amount) throw new CliError(`solde USDC insuffisant : ${usdc(bal)} < ${usdc(amount)}`);
    if (mode === "allowance") {
      await confirm(w, "approve", await writeCall(w, testnet.usdc, usdcAbi, "approve", [testnet.operatorBond, amount]));
      if (w.dryRun) return info("[dry run] bondFrom can only be simulated after a real approval");
      await confirm(w, "bondFrom", await writeCall(w, testnet.operatorBond, operatorBondAbi, "bondFrom", [amount]));
    } else {
      await confirm(w, "bond", await w.arc.bond(amount, "auth"));
    }
    if (w.dryRun) return out(`[dry run] a bond of ${usdc(amount)} would be accepted`);
    out(`bond deposited: ${usdc(amount)}, total ${usdc(await w.arc.bondOf(me))}, available ${usdc(await w.arc.availableBond(me))}`);
  },
};

/** Registration (or re-attestation): /attest on the VM, an off-chain quote check, then registerEnclave (SDK); the
 *  chain verifies Intel's signature through DCAP (≈ 6.85 M gas, measured on v2.1). */
async function registerFlow(ctx: Parameters<Command["run"]>[0], vm: string, productIdOpt: bigint | undefined, renew: boolean) {
  const w = await writer(ctx);
  const me = w.account.address;
  const pk = await enclavePubkeys(vm); // no trust needed: the chain verifies the quote, which binds these keys
  const e = await w.arc.getEnclave(pk.signer);
  const mine = sameAddr(e.operator, me);
  const readReg = (fn: string) => w.pub.readContract({ address: testnet.enclaveRegistry, abi: enclaveRegistryAbi, functionName: fn as any, args: [pk.signer] } as any);
  const [boundOp, boundPid, killed] = (await Promise.all([readReg("boundOperator"), readReg("boundProduct"), readReg("killed")])) as [string, bigint, boolean];
  if (killed) throw new CliError(`key ${pk.signer} was killed without grace (image withdrawn): it cannot register again (EnclaveKilled); restart the enclave (new keys)`);
  if (e.operator !== ZERO && !mine) {
    throw new CliError(`enclave ${pk.signer} is registered by another operator (${e.operator}): refusing to take it over`);
  }
  if (boundOp !== ZERO && !sameAddr(boundOp, me)) throw new CliError(`key ${pk.signer} is bound for life to operator ${boundOp} (SignerBoundElsewhere)`);
  if (renew && e.operator === ZERO) throw new CliError(`enclave ${pk.signer} is not registered: arcvault operator register --vm ${vm} --product <id>`);
  const productId = productIdOpt ?? (BigInt(e.productId) as bigint);
  if (boundOp !== ZERO && boundPid !== productId) throw new CliError(`key ${pk.signer} is bound for life to product #${boundPid}, not to #${productId} (SignerBoundElsewhere)`);
  const head = await w.pub.getBlockNumber();
  if (!renew && mine && e.active && head <= BigInt(e.untilBlock)) {
    throw new CliError(`enclave ${pk.signer} is already registered by you (window until block ${e.untilBlock}, ≈ ${fmtTime(e.expiresAt)}): arcvault operator renew --vm ${vm}`);
  }
  const p = await w.arc.getProduct(productId);
  if (p.state !== "Active") {
    throw new CliError(`product #${productId} not active (${stateLabel(p.state)}${p.state === "Proposed" ? `, can activate ${fmtTime(p.activatesAt)}` : ""})`);
  }
  const avail = await w.arc.availableBond(me);
  if (avail < p.minBond) {
    throw new CliError(`available bond ${usdc(avail)} < minimum bond of product #${productId} (${usdc(p.minBond)}): arcvault operator bond --amount …`);
  }
  if (e.operator === ZERO) {
    const free = await w.arc.freeBond(me);
    if (free < p.minBond) {
      throw new CliError(`free bond ${usdc(free)} < ${usdc(p.minBond)}: each registered key reserves its product's minimum bond; retire an old key (it releases its reserve) or raise the bond`);
    }
  }
  if (renew) info(`re-attesting ${pk.signer} (window until block ${e.untilBlock}): with no gap, the window is extended and receipts already issued stay settleable`);
  info(`${renew ? "re-attestation" : "registration"}: POST ${vm.replace(/\/$/, "")}/attest (quote bound to ${me}), quote check, then registerEnclave on product #${productId} (on-chain DCAP verification, ≈ 6.85 M gas, measured on v2.1)`);
  const r = await w.arc.registerEnclave(productId, vm);
  info(`  quote checked: image ${r.workloadId} allowed, no DEBUG`);
  const rcpt = await confirm(w, "registerEnclave", r.tx);
  if (!rcpt) return out(`[dry run] enclave ${r.signer} would be ${renew ? "re-attested" : "registered"} for product #${productId}`);
  const after = await w.arc.getEnclave(r.signer);
  out(`enclave ${r.signer} ${renew ? "re-attested" : "registered"}: product #${productId}, operator ${me}, blocks ${after.fromBlock}→${after.untilBlock} (≈ ${fmtTime(after.expiresAt)})`);
}

const register: Command = {
  path: ["operator", "register"],
  summary: "registers an enclave: reads /attest on the VM (quote + event log), picks the anchor block, registerEnclave",
  usage: "operator register --vm <url> --product <id>",
  description: [
    "Checks before sending: product active, available and free bond ≥ minimum bond, key not bound elsewhere,",
    "a real quote (not simulated), no DEBUG, SEPT_VE_DISABLE if required, image (workloadId) allowed by the product,",
    "REPORTDATA bound to your address. Then the chain verifies Intel's signature through DCAP, and the policy (P1–P12).",
  ],
  options: [
    { name: "vm", value: "<url>", desc: "the enclave's URL (enclave kit: /pubkeys, /attest)", required: true },
    { name: "product", value: "<id>", desc: "the product the enclave serves", required: true },
  ],
  write: true,
  examples: ["arcvault operator register --vm https://…-8802.dstack-pha1-prod9.phala.network --product 1"],
  async run(ctx) {
    await registerFlow(ctx, req(ctx, "vm"), parseId(req(ctx, "product"), "--product"), false);
  },
};

const renew: Command = {
  path: ["operator", "renew"],
  summary: "re-attests an enclave already registered (every 24 h): new quote, new expiry",
  usage: "operator renew --vm <url> [--product <id>]",
  description: [
    "The same path as register, for an enclave you registered. The Registrar service also does it on a schedule.",
    "Renewed with no gap, the validity window is EXTENDED; receipts anchored before stay settleable.",
  ],
  options: [
    { name: "vm", value: "<url>", desc: "the enclave's URL", required: true },
    { name: "product", value: "<id>", desc: "product (default: the one of the current registration)" },
  ],
  write: true,
  examples: ["arcvault operator renew --vm https://…-8802.dstack-pha1-prod9.phala.network"],
  async run(ctx) {
    const p = opt(ctx, "product");
    await registerFlow(ctx, req(ctx, "vm"), p !== undefined ? parseId(p, "--product") : undefined, true);
  },
};

const retire: Command = {
  path: ["operator", "retire"],
  summary: "retires one of your enclaves: nothing anchors after that, its bond reserve is released",
  usage: "operator retire --signer <address>",
  description: [
    "Each registered key reserves its product's minimum bond. A restarted enclave has new keys:",
    "retire the old one to release its reserve. Receipts and claims anchored BEFORE the retirement stay settleable",
    "during the grace period. A retired key can register again only with the same operator and for the same product.",
  ],
  options: [{ name: "signer", value: "<address>", desc: "signer of the enclave to retire", required: true }],
  write: true,
  examples: ["arcvault operator retire --signer 0x05a1F10043e8C24aA183BFf31f92FC791F66100B"],
  async run(ctx) {
    const signer = parseAddr(req(ctx, "signer"), "--signer");
    const w = await writer(ctx);
    const e = await w.arc.getEnclave(signer);
    if (e.signer === ZERO) throw new CliError(`no enclave registered for ${signer}`);
    if (!sameAddr(e.operator, w.account.address)) throw new CliError(`enclave ${signer} belongs to operator ${e.operator}, not to you`);
    if (!e.active) throw new CliError(`enclave ${signer} is already retired or killed`);
    await confirm(w, "retire", await w.arc.retireEnclave(signer));
    if (w.dryRun) return out(`[dry run] enclave ${signer} would be retired`);
    out(`enclave ${signer} retired; free bond: ${usdc(await w.arc.freeBond(w.account.address))}`);
  },
};

const settle: Command = {
  path: ["operator", "settle"],
  summary: "settles the latest cumulative receipts of the sessions served (one transaction per session)",
  usage: "operator settle --receipts <file.json>",
  description: [
    "File: an object or a list of { receipt, signature } (receipts signed by the enclave). For each session,",
    "only the receipt with the highest cumulative total is settled: it pays everything not paid yet, at the price",
    "LOCKED at opening. Each receipt is checked before sending, as SessionPay.settle will check it (the session's",
    "locked enclave, active at the anchor block with its operator, locked model, increasing cumulative total).",
    "The payment always goes to the session's operator; anyone can pay the settlement's gas.",
  ],
  options: [{ name: "receipts", value: "<file>", desc: "JSON receipts", required: true }],
  write: true,
  examples: ["arcvault operator settle --receipts receipts.json", "arcvault operator settle --receipts receipts.json --dry-run"],
  async run(ctx) {
    const path = req(ctx, "receipts");
    const raw = readJson(path, "receipts") as any;
    const items: any[] = Array.isArray(raw) ? raw : [raw];
    if (!items.length) throw new CliError(`${path}: no receipt`);
    const latest = new Map<string, { receipt: Receipt; signature: Hex }>();
    for (const it of items) {
      const receipt = normalizeReceipt(it?.receipt ?? it);
      const signature = (it?.signature ?? it?.receipt?.signature) as Hex | undefined;
      if (!signature) throw new CliError(`${path}: receipt of session #${receipt.sessionId} without a signature`);
      const k = receipt.sessionId.toString();
      const prev = latest.get(k);
      if (!prev || receipt.cumulativeUnits > prev.receipt.cumulativeUnits) latest.set(k, { receipt, signature });
    }
    const w = await writer(ctx);
    let total = 0n;
    let failures = 0;
    for (const { receipt: r, signature } of latest.values()) {
      const tag = `session #${r.sessionId}`;
      const v = await w.arc.verifyReceipt(r, signature);
      const bad = v.checks.filter((c) => !c.ok);
      if (bad.length) { info(`${tag}: skipped (${bad.map((c) => c.fr).join("; ")})`); continue; }
      const s = v.session!;
      if (!sameAddr(w.account.address, s.operator)) info(`${tag}: you pay the gas, the payment goes to ${s.operator}`);
      try {
        const rcpt = await confirm(w, `settle ${tag}`, await w.arc.settle(r, signature));
        const ev = rcpt && parseEventLogs({ abi: sessionExtraAbi, logs: rcpt.logs, eventName: "Settled" })[0];
        const paid = ev ? ev.args.paidDelta : v.payableNow;
        total += paid;
        out(`${w.dryRun ? "[dry run] " : ""}${tag} settled: +${usdc(paid)} (cumulative ${r.cumulativeUnits} units at the locked price of ${usdc(s.price)}/unit)`);
      } catch (err) {
        failures++;
        info(`${tag}: failed (${explainError(err)})`);
      }
    }
    out(`${w.dryRun ? "[dry run] " : ""}total settled: ${usdc(total)}${failures ? `; ${failures} failure(s)` : ""}`);
    if (failures) process.exitCode = 1;
  },
};

const status: Command = {
  path: ["operator", "status"],
  summary: "an operator's state: bond, 24 h exposure, enclaves and expiries, earnings, identity",
  usage: "operator status [<address>]",
  args: [{ name: "address", desc: "operator (default: the PRIVATE_KEY address)", optional: true }],
  examples: ["arcvault operator status 0x5724d89D610c3017b8DC161c025248341556f6Ab"],
  async run(ctx) {
    const op = ctx.args[0] ? parseAddr(ctx.args[0], "<address>") : walletAddressIfAny();
    if (!op) throw new UsageError("<address> required (or PRIVATE_KEY set)", ctx.cmd);
    const { arc, pub } = reader(ctx.rpc);
    const bal = await arc.usdcBalance(op);
    const bondTotal = await arc.bondOf(op);
    const avail = await arc.availableBond(op);
    const banned = (await readBond(pub, "banned", [op])) as boolean;
    const agentId = (await readBond(pub, "agentIdOf", [op])) as bigint;
    const unlock = (await readBond(pub, "unbondableAt", [op])) as bigint;
    const free = await arc.freeBond(op);
    const enclaves = (await arc.listEnclaves()).filter((e) => sameAddr(e.operator, op));
    const grace = await enclaveGraceBlocks(pub);
    out(`operator ${op}${banned ? "  (BANNED: bond slashed)" : ""}`);
    out(`  USDC balance      ${usdc(bal)}`);
    out(`  bond              ${usdc(bondTotal)} (available ${usdc(avail)}${bondTotal > avail ? `, ${usdc(bondTotal - avail)} being withdrawn, unlocked ${fmtTime(unlock)}` : ""})`);
    out(`  free bond         ${usdc(free)} (each registered key reserves its product's minimum bond)`);
    out(`  ERC-8004 identity ${agentId > 0n ? `agentId ${agentId}` : "no agentId linked (arcvault operator init)"}`);
    const pids = [...new Set(enclaves.map((e) => e.productId.toString()))].map(BigInt);
    for (const pid of pids) {
      const used = (await readBond(pub, "exposureOf", [op, pid])) as bigint;
      out(`  24 h exposure     product #${pid}: ${usdc(used)} / ${usdc(avail / 2n)} (half of the available bond)`);
    }
    out(`  earnings          ${await earnings(op)}`);
    out(`  enclaves (${enclaves.length})${enclaves.length ? "" : ": none"}`);
    for (const e of enclaves) {
      const head = e.head ?? 0n;
      const state = e.active ? "⬡ active          " : head <= e.untilBlock + grace ? "◌ in grace        " : "· inactive        ";
      out(`    ${state}product #${e.productId}  signer ${e.signer}  TCB ${e.tcbStatus}  blocks ${e.fromBlock}→${e.untilBlock} (≈ ${fmtTime(e.expiresAt)})`);
    }
  },
};

/** Selectors of the calls that PAY an operator (Blockscout does not name the methods of unverified contracts). */
const fnSel = (abi: readonly unknown[], name: string) =>
  toFunctionSelector(abi.find((x: any) => x.type === "function" && x.name === name) as AbiFunction).toLowerCase();
const PAYING_CALLS = new Set([
  "settle", "claim", "deliver", fnSel(sessionPayAbi, "settle"), fnSel(sealedBountyAbi, "claim"), fnSel(sealedBountyAbi, "deliver"), fnSel(x402Abi, "settle"),
]);

/** USDC received from the settlement contracts through settle/claim/deliver (the operator's share; and the author's or
 *  network's shares when it is the same address), from the explorer's Blockscout indexer. Refunds (closeSession) are excluded. */
async function earnings(op: Address): Promise<string> {
  const from = new Set([testnet.sessionPay, testnet.sealedBounty, testnet.x402Settler].map((a) => a.toLowerCase()));
  try {
    let sum = 0n;
    let n = 0;
    let query = "";
    for (let page = 0; page < 20; page++) {
      const url = `${testnet.blockscoutUrl}/api/v2/addresses/${op}/token-transfers?type=ERC-20&filter=to${query ? `&${query}` : ""}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { items?: any[]; next_page_params?: Record<string, unknown> | null };
      for (const it of j.items ?? []) {
        const token = String(it?.token?.address_hash ?? it?.token?.address ?? "").toLowerCase();
        if (token !== testnet.usdc.toLowerCase() || !from.has(String(it?.from?.hash ?? "").toLowerCase())) continue;
        if (!PAYING_CALLS.has(String(it?.method ?? "").toLowerCase())) continue;
        sum += BigInt(it?.total?.value ?? 0);
        n++;
      }
      if (!j.next_page_params) break;
      query = new URLSearchParams(Object.entries(j.next_page_params).map(([k, v]) => [k, String(v)])).toString();
    }
    return `${usdc(sum)} received in ${n} payment(s) through settle/claim/deliver (SessionPay, SealedBounty, X402Settler; from the indexer; includes the author's or network's shares when it is the same address)`;
  } catch {
    return "unavailable (indexer unreachable)";
  }
}

export const operatorCommands: Command[] = [init, bond, register, renew, retire, settle, status];
export const OPERATOR_TITLE = "become an enclave provider: ERC-8004 identity, bond, registration, re-attestation, retirement, settlements, state";
