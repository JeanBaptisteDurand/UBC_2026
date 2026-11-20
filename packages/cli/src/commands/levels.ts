/** levels — the TWO operator levels in the CLI:
 *   - operator: see your level, bind your enclave to its machine (the PPID from Intel's certificate), have your machine
 *     attested by the Proof of Cloud alliance (a co-signed token, verified on-chain by ProofOfCloudAuditor);
 *   - product author: set the policy (minimum level, accepted verifiers; ProductRegistry timelock);
 *   - verifier (anyone): attest or withdraw a machine in your own name. */
import type { Address, Hex } from "viem";
import {
  LEVEL_VERIFIED, PROOF_OF_CLOUD, describeLevel, findCurrentQuote, machineRegistryAbi, proofOfCloudAuditorAbi, quoteFromRegisterTx,
  readMachine, readPolicy, testnet,
} from "@arcvault/sdk";
import { CliError, type Command, UsageError, check, flag, fmtTime, info, opt, out, parseAddr, parseId, req } from "../cli";
import { confirm, reader, writeCall, writer } from "../chain";

export const LEVELS_TITLE = "operator levels: open (attestation + bond) or verified (machine attested in a known datacenter)";
export const AUDITOR_TITLE = "attest machines (PPID) in a known datacenter, in your own name";

const L = () => {
  if (!testnet.levels) throw new CliError("this deployment has no operator levels");
  return testnet.levels;
};
const ppidOf = (v: string): Hex => {
  const h = v.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{32}$/.test(h)) throw new UsageError("--ppid: 16 hex bytes expected (32 characters)");
  return `0x${h}` as Hex;
};

const level: Command = {
  path: ["operator", "level"],
  summary: "an enclave's level: bound machine, Proof of Cloud alliance attestation, a product's policy",
  usage: "operator level --signer <address> [--product <id>]",
  description: [
    "\"Open\" level: the enclave is attested by Intel and verified by the registry, and the operator has a bond.",
    "\"Verified\" level: in addition, its machine (the PPID read from Intel's certificate in the quote) is attested to be in",
    `a known datacenter by a verifier the product accepts (reference: the Proof of Cloud alliance, ${PROOF_OF_CLOUD.source}).`,
  ],
  options: [
    { name: "signer", value: "<address>", desc: "the enclave's key (the signer field of /pubkeys)" },
    { name: "product", value: "<id>", desc: "also shows this product's policy and whether the enclave meets it" },
  ],
  examples: ["arcvault operator level --signer 0x58a1… --product 2"],
  async run(ctx) {
    const signer = parseAddr(req(ctx, "signer"), "--signer");
    const productId = opt(ctx, "product") !== undefined ? parseId(opt(ctx, "product"), "--product") : undefined;
    const { pub } = reader(ctx.rpc);
    const r = await describeLevel(pub as any, testnet, signer, productId);
    out(`Enclave ${signer}`);
    out(`  ${check(!!r.machine.ppid)} machine: ${r.machine.ppid ?? "not bound (arcvault operator bind-machine)"}${r.machine.ppid ? (r.machine.current ? " (binding up to date)" : " (binding STALE: registered again since, bind again)") : ""}`);
    if (r.proofOfCloud) {
      out(`  ${check(!r.proofOfCloud.revoked && r.proofOfCloud.expiresAt * 1000 > Date.now())} Proof of Cloud alliance: attested until ${fmtTime(r.proofOfCloud.expiresAt)} (token of ${fmtTime(r.proofOfCloud.lastTokenAt)})${r.proofOfCloud.revoked ? ", WITHDRAWN" : ""}`);
    } else out(`  ${check(false)} Proof of Cloud alliance: no attestation (arcvault operator proof-of-cloud)`);
    out(`  → ${r.verifiedByProofOfCloud ? "VERIFIED (machine attested by the Proof of Cloud alliance, verified on-chain)" : "OPEN level"}`);
    if (r.product) {
      out(`Product #${r.product.productId}: requires the ${r.product.required === LEVEL_VERIFIED ? "verified" : "open"} level, ${r.product.meets ? `met${r.product.verifiedBy ? ` (verifier ${r.product.verifiedBy})` : ""}` : "NOT met: its settlement contracts ignore this enclave"}`);
    }
  },
};

const bind: Command = {
  path: ["operator", "bind-machine"],
  summary: "binds the enclave to its machine (PPID from Intel's certificate), from the quote of its current registration",
  usage: "operator bind-machine --signer <address> [--tx <registerEnclave hash>]",
  write: true,
  description: [
    "Redo it after each (re-)registration: ArcHive's registrar does it by itself. The quote is the one the registry",
    "verified through DCAP (keccak256 = Enclave.quoteHash); it is read from the given transaction, otherwise from the events.",
  ],
  options: [
    { name: "signer", value: "<address>", desc: "the enclave's key" },
    { name: "tx", value: "<hash>", desc: "registerEnclave transaction of the current registration (otherwise: a search)" },
  ],
  examples: ["arcvault operator bind-machine --signer 0x58a1…"],
  async run(ctx) {
    const signer = parseAddr(req(ctx, "signer"), "--signer");
    const w = await writer(ctx);
    const tx = opt(ctx, "tx");
    info("looking for the quote of the current registration…");
    const quote = tx ? await quoteFromRegisterTx(w.pub as any, tx as Hex) : await findCurrentQuote(w.pub as any, testnet, signer);
    const h = await writeCall(w, L().machineRegistry, machineRegistryAbi, "bindMachine", [signer, quote]);
    await confirm(w, "bindMachine", h);
    if (!w.dryRun) out(`machine bound: ${(await readMachine(w.pub as any, testnet, signer)).ppid}`);
  },
};

const proofOfCloud: Command = {
  path: ["operator", "proof-of-cloud"],
  summary: "has the Proof of Cloud alliance attest the machine (co-signed token, verified on-chain)",
  usage: "operator proof-of-cloud --signer <address>",
  write: true,
  description: [
    "Asks the alliance's three trust servers (Secret, Nillion, iExec) for a token for the quote of the current",
    "registration; they issue it only if the machine is on their list (a physical inspection in the datacenter) and not",
    "revoked. The token is verified here, then submitted to ProofOfCloudAuditor, which verifies it again on-chain (EdDSA)",
    "and attests the machine for 7 days. If your machine is not on the list, see proofofcloud.org (inspection ceremony).",
  ],
  options: [{ name: "signer", value: "<address>", desc: "the key of an enclave on the machine" }],
  examples: ["arcvault operator proof-of-cloud --signer 0x58a1…"],
  async run(ctx) {
    const signer = parseAddr(req(ctx, "signer"), "--signer");
    const w = await writer(ctx);
    const quote = await findCurrentQuote(w.pub as any, testnet, signer);
    // Node-only module (relative path: not exported by the SDK's index)
    const { requestAllianceToken } = await import("../../../sdk/src/proof-of-cloud");
    info("Proof of Cloud alliance token (three servers)…");
    const t = await requestAllianceToken(quote, { log: info });
    info(`co-signed token verified: machine ${t.machineId}, ${fmtTime(t.timestamp)}`);
    const h = await writeCall(w, L().proofOfCloudAuditor, proofOfCloudAuditorAbi, "submit", [t.header, t.payload, t.signature]);
    await confirm(w, "ProofOfCloudAuditor.submit", h);
  },
};

const policy: Command = {
  path: ["product", "policy"],
  summary: "a product's level policy: read, propose (author), apply after the timelock",
  usage: "product policy --product <id> [--level 0|1 --auditors <a,b,…>] [--apply]",
  write: true,
  description: [
    "With no option: shows the policy in force and the pending one. --level/--auditors: the product's AUTHOR proposes",
    "(level 1: at least one verifier; reference: ProofOfCloudAuditor). --apply: applies it after the timelock.",
    "The settlement contracts wired to PolicyEnclaves enforce it; the price stays free (no toll).",
  ],
  options: [
    { name: "product", value: "<id>", desc: "the product's id" },
    { name: "level", value: "0|1", desc: "minimum level: 0 open, 1 verified" },
    { name: "auditors", value: "<a,b,…>", desc: "accepted verifiers (comma-separated addresses); \"proof-of-cloud\" = the alliance" },
    { name: "apply", desc: "applies the pending policy (timelock over)" },
  ],
  examples: ["arcvault product policy --product 6 --level 1 --auditors proof-of-cloud", "arcvault product policy --product 6 --apply"],
  async run(ctx) {
    const productId = parseId(req(ctx, "product"), "--product");
    const lvl = opt(ctx, "level");
    if (lvl !== undefined || flag(ctx, "apply")) {
      const w = await writer(ctx);
      if (lvl !== undefined) {
        if (lvl !== "0" && lvl !== "1") throw new UsageError("--level: 0 or 1");
        const auditors = (opt(ctx, "auditors") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
          .map((a) => (a === "proof-of-cloud" ? L().proofOfCloudAuditor : parseAddr(a, "--auditors")));
        const h = await writeCall(w, L().machineRegistry, machineRegistryAbi, "proposePolicy", [productId, Number(lvl), auditors as Address[]]);
        await confirm(w, "proposePolicy", h);
      } else {
        const h = await writeCall(w, L().machineRegistry, machineRegistryAbi, "applyPolicy", [productId]);
        await confirm(w, "applyPolicy", h);
      }
    }
    const { pub } = reader(ctx.rpc);
    const p = await readPolicy(pub as any, testnet, productId);
    const name = (a: Address) => (a.toLowerCase() === L().proofOfCloudAuditor.toLowerCase() ? `${a} (alliance Proof of Cloud)` : a);
    out(`Product #${productId}: ${p.minLevel === LEVEL_VERIFIED ? "VERIFIED" : "open"} level${p.auditors.length ? `, verifiers: ${p.auditors.map(name).join(", ")}` : ""}`);
    if (p.pending) out(`  pending: level ${p.pending.minLevel}, ${p.pending.auditors.map(name).join(", ") || "no verifier"}, applicable on ${fmtTime(p.pending.applyAt)}`);
  },
};

const attest: Command = {
  path: ["auditor", "attest"],
  summary: "attests, in your name, a machine (PPID) in a known datacenter until a date",
  usage: "auditor attest --ppid <32 hex> --days <n> --site <text> [--evidence <url or hash>]",
  write: true,
  description: [
    "Anyone can be a verifier: your address is your identity, and only the products that accept you",
    "(the author's policy) take your attestations into account. An enclave's PPID: arcvault operator level.",
  ],
  options: [
    { name: "ppid", value: "<32 hex>", desc: "the machine's PPID (Intel's PCK certificate)" },
    { name: "days", value: "<n>", desc: "length of the attestation, in days" },
    { name: "site", value: "<text>", desc: "place (datacenter, city)" },
    { name: "evidence", value: "<url|hash>", desc: "evidence: inspection report, photo, contract…" },
  ],
  examples: ['arcvault auditor attest --ppid 62d54040cb9dfc08bb13006fa75ece56 --days 30 --site "OVH Roubaix" --evidence https://…'],
  async run(ctx) {
    const ppid = ppidOf(req(ctx, "ppid"));
    const days = Number(req(ctx, "days"));
    if (!Number.isFinite(days) || days <= 0 || days > 400) throw new UsageError("--days: between 1 and 400");
    const until = BigInt(Math.floor(Date.now() / 1000 + days * 86_400));
    const w = await writer(ctx);
    const h = await writeCall(w, L().machineRegistry, machineRegistryAbi, "attestMachine", [ppid, until, req(ctx, "site"), opt(ctx, "evidence") ?? ""]);
    await confirm(w, "attestMachine", h);
  },
};

const revoke: Command = {
  path: ["auditor", "revoke"],
  summary: "withdraws your attestation of a machine, immediately",
  usage: "auditor revoke --ppid <32 hex> --reason <text>",
  write: true,
  options: [
    { name: "ppid", value: "<32 hex>", desc: "the machine's PPID" },
    { name: "reason", value: "<text>", desc: "reason (public, in the event)" },
  ],
  examples: ['arcvault auditor revoke --ppid 62d54040cb9dfc08bb13006fa75ece56 --reason "machine moved"'],
  async run(ctx) {
    const w = await writer(ctx);
    const h = await writeCall(w, L().machineRegistry, machineRegistryAbi, "revokeMachine", [ppidOf(req(ctx, "ppid")), req(ctx, "reason")]);
    await confirm(w, "revokeMachine", h);
  },
};

export const levelOperatorCommands: Command[] = [level, bind, proofOfCloud];
export const levelProductCommands: Command[] = [policy];
export const auditorCommands: Command[] = [attest, revoke];
