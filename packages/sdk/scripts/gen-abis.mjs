#!/usr/bin/env node
/**
 * gen-abis.mjs writes packages/sdk/src/abis.ts FROM THE COMPILED ARTIFACTS (contracts/out), never by hand.
 * It emits every function, event and error of each contract as a human-readable ABI (viem parseAbi), with named structs.
 *
 *   node packages/sdk/scripts/gen-abis.mjs           # rewrites src/abis.ts
 *   node packages/sdk/scripts/gen-abis.mjs --check   # checks that src/abis.ts is up to date (exit code 1 otherwise)
 *
 * Run it again after every contract rebuild (forge build).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT_DIR = fileURLToPath(new URL("../../../contracts/out/", import.meta.url));
const TARGET = fileURLToPath(new URL("../src/abis.ts", import.meta.url));

/** exported name → contract (contracts/out/<C>.sol/<C>.json) → label */
const CONTRACTS = [
  ["productRegistryAbi", "ProductRegistry", "ProductRegistry: the product marketplace"],
  ["operatorBondAbi", "OperatorBond", "OperatorBond: the operator bond"],
  ["enclaveRegistryAbi", "EnclaveRegistry", "EnclaveRegistry: enclave registration, verified by DCAP"],
  ["sessionPayAbi", "SessionPay", "SessionPay: prepaid sessions and their cumulative receipts"],
  ["sealedBountyAbi", "SealedBounty", "SealedBounty: the sealed bounty"],
  ["x402Abi", "X402Settler", "X402Settler: pay per call (x402)"],
  ["verdictLogAbi", "VerdictLog", "VerdictLog: verdicts written to the ERC-8004 validation registry"],
  ["tdxAttestationModuleAbi", "TdxAttestationModule", "TdxAttestationModule: the attestation module (Automata DCAP)"],
  ["demoVaultAbi", "DemoVault", "DemoVault: the disposable target of the sealed bounty demos"],
];

function structName(p) {
  const it = String(p.internalType ?? "");
  if (!it.startsWith("struct ")) return null;
  return it.slice(7).replace(/\[.*$/, "").split(".").pop();
}

function makeFormatter(contract) {
  const structs = new Map(); // name → definition
  const typeOf = (p) => {
    if (!p.type.startsWith("tuple")) return p.type;
    const suffix = p.type.slice("tuple".length); // "", "[]", "[2]"…
    const comps = p.components ?? [];
    const name = structName(p);
    if (!name) return `(${comps.map((c) => param(c, false)).join(", ")})${suffix}`;
    const def = `struct ${name} { ${comps.map((c) => `${typeOf(c)} ${c.name};`).join(" ")} }`;
    const prev = structs.get(name);
    if (prev !== undefined && prev !== def) {
      throw new Error(`${contract}: two different structs named "${name}":\n  ${prev}\n  ${def}`);
    }
    structs.set(name, def);
    return name + suffix;
  };
  const param = (p, withIndexed) => `${typeOf(p)}${withIndexed && p.indexed ? " indexed" : ""}${p.name ? ` ${p.name}` : ""}`;
  const params = (ps, withIndexed = false) => (ps ?? []).map((p) => param(p, withIndexed)).join(", ");
  const item = (it) => {
    switch (it.type) {
      case "function": {
        const sm = it.stateMutability === "view" || it.stateMutability === "pure" || it.stateMutability === "payable" ? ` ${it.stateMutability}` : "";
        const outs = it.outputs?.length ? ` returns (${params(it.outputs)})` : "";
        return `function ${it.name}(${params(it.inputs)})${sm}${outs}`;
      }
      case "event":
        return `event ${it.name}(${params(it.inputs, true)})${it.anonymous ? " anonymous" : ""}`;
      case "error":
        return `error ${it.name}(${params(it.inputs)})`;
      default:
        return null; // constructor, receive, fallback: irrelevant to a client
    }
  };
  return { structs, item };
}

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const q = (s) => JSON.stringify(s);

function generate() {
  const L = [];
  const errors = new Map(); // full signature → [contracts]
  L.push(
    "/**",
    " * abis.ts is a GENERATED FILE, written by packages/sdk/scripts/gen-abis.mjs from the compiled artifacts (contracts/out).",
    " * Do not edit it by hand: rebuild the contracts (forge build), then run `node packages/sdk/scripts/gen-abis.mjs`.",
    " * Each ABI holds every function, event and error of its contract, so viem decodes a revert by its name",
    " * (WrongEnclave, BadExpiry, TierAlreadyPaid…).",
    " */",
    'import { parseAbi } from "viem";',
    "",
    "/** Arc's USDC (an external contract, not in contracts/out): the subset the network uses. */",
    "export const usdcAbi = parseAbi([",
    '  "function balanceOf(address a) view returns (uint256)",',
    '  "function approve(address spender, uint256 value) returns (bool)",',
    '  "function allowance(address owner, address spender) view returns (uint256)",',
    '  "function name() view returns (string)",',
    '  "function version() view returns (string)",',
    "]);",
  );
  for (const [exportName, contract, label] of CONTRACTS) {
    const path = `${OUT_DIR}${contract}.sol/${contract}.json`;
    const abi = JSON.parse(readFileSync(path, "utf8")).abi;
    const { structs, item } = makeFormatter(contract);
    const lines = [];
    for (const it of abi) {
      const s = item(it);
      if (!s) continue;
      lines.push(s);
      if (it.type === "error") errors.set(s, [...(errors.get(s) ?? []), contract]);
    }
    const nf = abi.filter((x) => x.type === "function").length;
    const ne = abi.filter((x) => x.type === "event").length;
    const nr = abi.filter((x) => x.type === "error").length;
    L.push(
      "",
      `/** ${label}. Source: contracts/out/${contract}.sol/${contract}.json (ABI sha256 ${sha(JSON.stringify(abi))}), ` +
        `${nf} functions, ${ne} events, ${nr} errors. */`,
      `export const ${exportName} = parseAbi([`,
      ...[...structs.values()].map((s) => `  ${q(s)},`),
      ...lines.map((s) => `  ${q(s)},`),
      "]);",
    );
  }
  L.push(
    "",
    "/** Every error of the network's contracts, without duplicates: it names a revert raised inside a called contract",
    " *  (e.g. OperatorBond's TooMuchExposure during SessionPay.settle). */",
    "export const arcErrorsAbi = parseAbi([",
    ...[...errors.keys()].map((s) => `  ${q(s)},`),
    "]);",
    "",
  );
  return L.join("\n");
}

const text = generate();
if (process.argv.includes("--check")) {
  let cur = "";
  try { cur = readFileSync(TARGET, "utf8"); } catch { /* missing */ }
  if (cur !== text) {
    console.error("src/abis.ts is out of date with contracts/out: run node packages/sdk/scripts/gen-abis.mjs");
    process.exit(1);
  }
  console.log("src/abis.ts is up to date with contracts/out");
} else {
  writeFileSync(TARGET, text);
  console.log(`src/abis.ts generated (${text.split("\n").length} lines) from ${OUT_DIR}`);
}
