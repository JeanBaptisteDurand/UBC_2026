#!/usr/bin/env node
/**
 * gen-abis.mjs — génère packages/sdk/src/abis.ts À PARTIR DES ARTEFACTS COMPILÉS (contracts/out), jamais à la main :
 * chaque fonction, événement et erreur de chaque contrat, en ABI lisible (viem parseAbi) avec structures nommées.
 *
 *   node packages/sdk/scripts/gen-abis.mjs           # réécrit src/abis.ts
 *   node packages/sdk/scripts/gen-abis.mjs --check   # vérifie que src/abis.ts est à jour (code 1 sinon)
 *
 * À relancer après toute recompilation des contrats (forge build).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT_DIR = fileURLToPath(new URL("../../../contracts/out/", import.meta.url));
const TARGET = fileURLToPath(new URL("../src/abis.ts", import.meta.url));

/** nom exporté → contrat (contracts/out/<C>.sol/<C>.json) */
const CONTRACTS = [
  ["productRegistryAbi", "ProductRegistry", "ProductRegistry : la place de marché des produits (C3)"],
  ["operatorBondAbi", "OperatorBond", "OperatorBond : la caution des opérateurs (C4)"],
  ["enclaveRegistryAbi", "EnclaveRegistry", "EnclaveRegistry : l'inscription des enclaves vérifiées par DCAP (C2)"],
  ["sessionPayAbi", "SessionPay", "SessionPay : les sessions prépayées et leurs reçus cumulatifs (C5)"],
  ["sealedBountyAbi", "SealedBounty", "SealedBounty : la Prime scellée (C6)"],
  ["x402Abi", "X402Settler", "X402Settler : le paiement à l'appel (x402)"],
  ["verdictLogAbi", "VerdictLog", "VerdictLog : les verdicts écrits dans le registre de validation ERC-8004"],
  ["tdxAttestationModuleAbi", "TdxAttestationModule", "TdxAttestationModule : le module d'attestation (DCAP d'Automata)"],
  ["demoVaultAbi", "DemoVault", "DemoVault : la cible jetable des démonstrations de la Prime scellée"],
];

function structName(p) {
  const it = String(p.internalType ?? "");
  if (!it.startsWith("struct ")) return null;
  return it.slice(7).replace(/\[.*$/, "").split(".").pop();
}

function makeFormatter(contract) {
  const structs = new Map(); // nom → définition
  const typeOf = (p) => {
    if (!p.type.startsWith("tuple")) return p.type;
    const suffix = p.type.slice("tuple".length); // "", "[]", "[2]"…
    const comps = p.components ?? [];
    const name = structName(p);
    if (!name) return `(${comps.map((c) => param(c, false)).join(", ")})${suffix}`;
    const def = `struct ${name} { ${comps.map((c) => `${typeOf(c)} ${c.name};`).join(" ")} }`;
    const prev = structs.get(name);
    if (prev !== undefined && prev !== def) {
      throw new Error(`${contract} : deux structures « ${name} » différentes :\n  ${prev}\n  ${def}`);
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
        return null; // constructor, receive, fallback : sans objet pour un client
    }
  };
  return { structs, item };
}

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const q = (s) => JSON.stringify(s);

function generate() {
  const L = [];
  const errors = new Map(); // signature complète → [contrats]
  L.push(
    "/**",
    " * abis.ts — FICHIER GÉNÉRÉ par packages/sdk/scripts/gen-abis.mjs depuis les artefacts compilés (contracts/out).",
    " * Ne pas modifier à la main : recompiler les contrats (forge build), puis `node packages/sdk/scripts/gen-abis.mjs`.",
    " * Chaque ABI contient TOUTES les fonctions, tous les événements et toutes les erreurs du contrat (pile v2) : viem",
    " * décode donc les refus par leur nom (WrongEnclave, BadExpiry, TierAlreadyPaid…).",
    " */",
    'import { parseAbi } from "viem";',
    "",
    "/** USDC d'Arc (contrat externe, pas dans contracts/out) : le sous-ensemble utilisé par le réseau. */",
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
      `/** ${label}. Source : contracts/out/${contract}.sol/${contract}.json (ABI sha256 ${sha(JSON.stringify(abi))}) — ` +
        `${nf} fonctions, ${ne} événements, ${nr} erreurs. */`,
      `export const ${exportName} = parseAbi([`,
      ...[...structs.values()].map((s) => `  ${q(s)},`),
      ...lines.map((s) => `  ${q(s)},`),
      "]);",
    );
  }
  L.push(
    "",
    "/** Toutes les erreurs des contrats du réseau, sans doublon : pour nommer un refus remonté d'un contrat appelé",
    " *  (ex. TooMuchExposure d'OperatorBond pendant SessionPay.settle). */",
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
  try { cur = readFileSync(TARGET, "utf8"); } catch { /* absent */ }
  if (cur !== text) {
    console.error("src/abis.ts n'est pas à jour avec contracts/out : node packages/sdk/scripts/gen-abis.mjs");
    process.exit(1);
  }
  console.log("src/abis.ts est à jour avec contracts/out");
} else {
  writeFileSync(TARGET, text);
  console.log(`src/abis.ts généré (${text.split("\n").length} lignes) depuis ${OUT_DIR}`);
}
