/** tools.ts — the tools of the ArcHive MCP server (reads, and PREPARED actions only), kept apart from server.ts (the
 *  stdio transport) so they can be tested. The logic is shared with the copilot (services/copilot/src/arc-actions.ts):
 *  - the LISTS (products, enclaves, bounties, an account's sessions, activity) come from the ArcHive API's index
 *    (ARCHIVE_API, 8 s timeout); when the API does not answer, the tool says "list temporarily unavailable", never falls
 *    back to the explorer and never presents a partial list as complete;
 *  - everything sent to the agent (and so to its LLM) goes through the secrets filter;
 *  - enclave URLs (/attest, /pubkeys) get the SAME network guards as the copilot: https, port 443, fixed path, public
 *    address resolved once, no redirect followed, error body never returned. MCP_ALLOW_PRIVATE_URLS=1 (local
 *    development: a VM on the local network) allows private networks, http and any port, with the other guards kept. */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createPublicClient, http, formatUnits, parseUnits } from "viem";
import { arcTestnet, createArcClient, normalizeReceipt, testnet, deploymentFromJson, type ArcClient, type Deployment } from "@arcvault/sdk";
import {
  enclaveStatus, sessionStatus, prepareBountyCreate, operatorPlan, prepareBond, prepareRegister,
  productScaffold, machinesList, machineDiagnostics, enclavesList, productsList, sessionsList, activityList, scrubSecrets, railOf,
  type ActionCtx,
} from "../../copilot/src/arc-actions";
import { archiveBase, freshness, ListUnavailableError } from "../../copilot/src/archive-api";
import { parsePrefixes } from "../../copilot/src/net-guard";
import { englishValue, englishOutput } from "./english";

/** The deployment file each stack came from (its name only), for the SDK calls the tools write (stackSdkCall). */
const DEPLOYMENT_FILES = new WeakMap<Deployment, string>();

/** The stack the tools read, WITH the levels (levels: SealedBountyVerified, the verified Sealed Bounty: product 5 on v3,
 *  product 7 on v2.1). DEPLOYMENTS (path to a deployments.*.json, e.g. deployments.v3.testnet.json) when given,
 *  otherwise the SDK's built-in stack (`testnet`, v2.1, levels included), like the copilot
 *  (services/copilot/src/copilot.ts). The levels let the tools recognise the verified level's settlement contract and
 *  prepare its bounties on SealedBountyVerified (verified level), not on SealedBounty (open level). */
export function mcpDeployment(env: NodeJS.ProcessEnv = process.env): Deployment {
  const p = env.DEPLOYMENTS?.trim();
  const d = p ? deploymentFromJson(JSON.parse(readFileSync(p, "utf8"))) : testnet;
  if (!d.levels?.sealedBountyVerified) console.warn("[mcp] stack without levels: the verified level (SealedBountyVerified) will not be recognised");
  if (p) {
    // said once at start, on stderr (stdout carries the stdio transport): which stack this process reads
    console.error(`[mcp] stack ${p}: EnclaveRegistry ${d.enclaveRegistry}, SealedBounty ${d.sealedBounty}, SealedBountyVerified ${d.levels?.sealedBountyVerified ?? "none"}`);
    DEPLOYMENT_FILES.set(d, basename(p));
  }
  return d;
}

/** The former SealedBountyVerified (product 6), superseded by 0x36a8… (product 7): it no longer settles anything. */
const SUPERSEDED_SBV = new Set(["0x242ca1c4d0a5a6fe5a806f215ca5f127422364d2"]);
/** v2.1's SealedBounty, whose product 5 is the refutation demo (10 Nov 2026). On v3, product 5 is the verified level. */
const REFUTATION_DEMO_SB = "0x182871d34438ab37a7fd4d8689f3e0812e447a9b";

/** A product's settlement label, as the agent should read it: the verified level apart from the open one (product 5 on
 *  v3, product 7 on v2.1) and, on v2.1 only, product 5 (the refutation demo) and product 6 (neutralized) spelled out. */
export function productRail(arc: ArcClient, id: string, settlement: string): string {
  const s = String(settlement).toLowerCase();
  if (arc.d.levels && s === arc.d.levels.sealedBountyVerified.toLowerCase()) return "SealedBountyVerified (Sealed Bounty, verified operator level)";
  if (SUPERSEDED_SBV.has(s)) return "neutralized, replaced by #7 (the former SealedBountyVerified, replaced on 11 Nov 2026: it settles nothing; the verified Sealed Bounty is product 7)";
  if (id === "5" && s === REFUTATION_DEMO_SB) return "SealedBounty (Sealed Bounty, open level): refutation demo (a lying enclave refuted, its bond slashed, 10 Nov 2026)";
  if (s === arc.d.sealedBounty.toLowerCase()) return "SealedBounty (Sealed Bounty, open level)";
  // the copilot's French rail label (arc-actions.ts, railOf), in English (english.ts)
  return englishValue(railOf(arc, settlement));
}

/** The products each Sealed Bounty level settles, read from the API's product list (the active products whose
 *  settlement is that level's contract): " (product 2)", " (products 2 and 5)", or "" if the list is unavailable. On v3:
 *  open = product 2, verified = product 5; on v2.1: open = products 2 and 5 (the refutation demo), verified = product 7. */
async function levelProducts(arc: ArcClient, actx: ActionCtx): Promise<{ open: string; verified: string }> {
  let ps: Array<{ id: string; state: string; settlement: string }> = [];
  try { ps = (await productsList(arc, { all: true }, actx)).produits; } catch { /* list unavailable: the levels without their numbers */ }
  const of = (contract: string | undefined) => {
    const ids = contract ? ps.filter((p) => p.state === "Active" && String(p.settlement).toLowerCase() === contract.toLowerCase()).map((p) => p.id) : [];
    return ids.length === 0 ? "" : ids.length === 1 ? ` (product ${ids[0]})` : ` (products ${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]})`;
  };
  return { open: of(arc.d.sealedBounty), verified: of(arc.d.levels?.sealedBountyVerified) };
}

/** The bounties of BOTH levels, read from the API's index (/bounties?level=all): open level (SealedBounty) and verified
 *  level (SealedBountyVerified), with the products each level settles (levelProducts). A number alone does not identify
 *  a bounty (each contract has its own #1, #2…), so each row gives its level, its contract and its address. No API
 *  answer = list unavailable. */
async function bountiesAllLevels(arc: ArcClient, actx: ActionCtx, onlyOpen: boolean) {
  const base = archiveBase(actx.apiBase);
  let j: unknown;
  try {
    const res = await fetch(`${base}/bounties?level=all`, { signal: AbortSignal.timeout(8_000), redirect: "error" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    j = await res.json();
  } catch (e: any) {
    throw new ListUnavailableError("primes", e?.name === "TimeoutError" ? "the ArcHive API did not answer in time" : `the ArcHive API is not answering (${String(e?.message ?? e).slice(0, 80)})`);
  }
  if (!Array.isArray(j)) throw new ListUnavailableError("primes", "unexpected ArcHive API response (array expected)");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const rows = j.map((x: any, i: number) => {
    const big = (v: unknown, f: string): bigint => {
      try { if (v === undefined || v === null || v === "") throw new Error(); return BigInt(String(v)); }
      catch { throw new ListUnavailableError("primes", `unreadable ArcHive API response (bounty ${i}, ${f})`); }
    };
    if (!x || typeof x !== "object") throw new ListUnavailableError("primes", `unreadable ArcHive API response (bounty ${i})`);
    const level = x.level === "verified" ? "verified" : "open";
    const contract = typeof x.contract === "string" ? x.contract : level === "verified" ? "SealedBountyVerified" : "SealedBounty";
    const address = typeof x.address === "string" ? x.address : level === "verified" ? (arc.d.levels?.sealedBountyVerified ?? null) : arc.d.sealedBounty;
    const id = big(x.id, "id"), balance = big(x.balance, "balance"), deadline = big(x.deadline, "deadline");
    const paused = x.paused === true || x.paused === "true";
    const expired = now > deadline;
    return {
      ref: `${contract} #${id}`, id: id.toString(), level, contract, address, protocol: x.protocol ?? null,
      productId: x.productId === undefined ? null : String(x.productId), balance: `${formatUnits(balance, 6)} USDC`,
      deadline: new Date(Number(deadline) * 1000).toISOString(), paused, expired, open: !paused && !expired && balance > 0n,
    };
  });
  const lv = await levelProducts(arc, actx);
  return {
    total: rows.length,
    ouvertes: rows.filter((r) => r.open).length,
    parNiveau: {
      open: { contrat: "SealedBounty", adresse: arc.d.sealedBounty, total: rows.filter((r) => r.level === "open").length, ouvertes: rows.filter((r) => r.level === "open" && r.open).length },
      verified: { contrat: "SealedBountyVerified", adresse: arc.d.levels?.sealedBountyVerified ?? null, total: rows.filter((r) => r.level === "verified").length, ouvertes: rows.filter((r) => r.level === "verified" && r.open).length },
    },
    luA: new Date(Number(now) * 1000).toISOString(),
    lecture: `Two levels: open = SealedBounty${lv.open}, verified = SealedBountyVerified${lv.verified}. A number alone does not name a bounty: read contract + id (ref).`,
    liste: await freshness({ base: actx.apiBase }),
    primes: onlyOpen ? rows.filter((r) => r.open) : rows,
    source: `ArcHive API ${base}/bounties?level=all (index of the BountyCreated events of both contracts + getBounty)`,
  };
}

/** The fields of an inference receipt (EIP-712, SessionPay.settle): decimal integers and bytes32. */
const RECEIPT_UINTS = ["productId", "sessionId", "seq", "tokensIn", "tokensOut", "cumulativeUnits", "anchorBlock"] as const;
const RECEIPT_HASHES = ["modelHash", "paramsHash", "requestHash", "responseHash"] as const;
const RECEIPT_SCHEMA = {
  type: "object",
  description: "the receipt signed by the enclave, as it returns it (fields as decimal and hex strings)",
  properties: {
    ...Object.fromEntries(RECEIPT_UINTS.map((k) => [k, { type: "string", description: "decimal integer ≥ 0 (uint256), e.g. \"12\"" }])),
    ...Object.fromEntries(RECEIPT_HASHES.map((k) => [k, { type: "string", description: "bytes32: 0x + 64 hex characters" }])),
  },
  required: [...RECEIPT_UINTS, ...RECEIPT_HASHES],
};

/** Checks a receipt's shape before any computation: one error per field (instead of "Cannot convert undefined to a BigInt"). */
export function receiptErrors(r: unknown, sig: unknown): string[] {
  const errs: string[] = [];
  if (!r || typeof r !== "object" || Array.isArray(r)) errs.push("receipt: object expected");
  else {
    const o = r as Record<string, unknown>;
    for (const k of RECEIPT_UINTS) {
      const v = o[k];
      if (v === undefined || v === null || v === "") errs.push(`receipt.${k}: missing`);
      else if (!((typeof v === "string" && /^\d{1,78}$/.test(v)) || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0)))
        errs.push(`receipt.${k}: unsigned decimal integer expected`);
    }
    for (const k of RECEIPT_HASHES) {
      const v = o[k];
      if (v === undefined || v === null || v === "") errs.push(`receipt.${k}: missing`);
      else if (!(typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v))) errs.push(`receipt.${k}: bytes32 expected (0x + 64 hex)`);
    }
  }
  if (!(typeof sig === "string" && /^0x([0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(sig))) errs.push("signature: 65-byte signature expected (0x + 130 hex)");
  return errs;
}

const PREP = "PREPARES only: signs and sends nothing, returns the data the user signs in their wallet.";
const LIST = "Read from the ArcHive API index; if the list is briefly unavailable, the tool says so (never a partial list).";

export const TOOLS = [
  { name: "arc_products", description: `Lists the products of Arc's enclave network (price with its unit, shares, settlement, minimum bond, state). ${LIST}`, inputSchema: { type: "object", properties: { onlyActive: { type: "boolean", description: "true = only the active products" } } } },
  { name: "arc_enclaves", description: `Lists the enclaves (the hive): operator, product, TCB, active or not at the head block, validity window in blocks, registered X25519 key. ${LIST}`, inputSchema: { type: "object", properties: { onlyActive: { type: "boolean", description: "true = only the active enclaves" } } } },
  { name: "arc_bounties", description: `Lists the sealed bounties of BOTH levels (open: SealedBounty; verified: SealedBountyVerified, where only enclaves on a chip declared by a Proof of Cloud auditor count) and the products each level settles: level, contract, protocol, product, balance, deadline, pause, open or not. ${LIST}`, inputSchema: { type: "object", properties: { onlyOpen: { type: "boolean", description: "true = only the open bounties" } } } },
  { name: "arc_sessions", description: `Lists the SessionPay sessions opened by an account: product, deposit, already settled, remainder, closed, expiry. ${LIST}`, inputSchema: { type: "object", properties: { owner: { type: "string", description: "0x… address of the account" } }, required: ["owner"] } },
  { name: "arc_activity", description: `Recent on-chain activity of the network's contracts (enclave registrations, sessions, settlements, bounties, verdicts), newest first. ${LIST}`, inputSchema: { type: "object", properties: { limit: { type: "number", description: "number of events (1 to 50, default 10)" } } } },
  { name: "arc_pricing", description: "Cost of a use: units × the product's price, with a readable line giving the unit (per token for a prepaid session, per call for x402, free, or paid by a bounty's pool).", inputSchema: { type: "object", properties: { productId: { type: "string" }, units: { type: "string" } }, required: ["productId", "units"] } },
  { name: "arc_verify_receipt", description: "Checks an inference receipt the way SessionPay.settle does: the session's locked enclave, active at the anchor block under its operator, locked model, growing cumulative total; and what the settlement would pay.", inputSchema: { type: "object", properties: { receipt: RECEIPT_SCHEMA, signature: { type: "string", description: "the enclave's EIP-712 signature: 0x + 130 hex (65 bytes)" } }, required: ["receipt", "signature"] } },
  { name: "arc_enclave_status", description: "State of ONE enclave by its signer: operator, product, TCB, expiry, active or not, the operator's bond (total, available, 24 h exposure on this product).", inputSchema: { type: "object", properties: { signer: { type: "string", description: "0x… address of the enclave's signer" } }, required: ["signer"] } },
  { name: "arc_session_status", description: "State of a SessionPay session: owner, product, operator, deposit, already paid, remainder, expiry, closed.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] } },
  { name: "arc_bounty_prepare_create", description: `Creates a sealed bounty, with a predicate helper ("the USDC balance of the target contract drops by at least minDrop" → ERC20_DROP clause), tiers, fees read on-chain, createBounty parameters and an EIP-3009 authorization. ${PREP}`, inputSchema: { type: "object", properties: {
    from: { type: "string", description: "the protocol's wallet, which funds and signs" },
    target: { type: "string", description: "watched contract (e.g. the protocol's vault)" },
    minDrop: { type: "string", description: "minimum drop that proves the exploit, in USDC" },
    reward: { type: "string", description: "the hunter's reward in USDC (one tier)" },
    tiers: { type: "array", description: "several tiers [{ minLoss, amount }] in USDC", items: { type: "object", properties: { minLoss: { type: "string" }, amount: { type: "string" } } } },
    funding: { type: "string", description: "initial funding in USDC (default: one payment of the highest tier, fees included)" },
    clauseType: { type: "string", enum: ["ERC20_DROP", "NATIVE_DROP", "ATTACKER_PROFIT"] },
    token: { type: "string" }, predicate: { type: "object", description: "full predicate { combine, clauses } (advanced)" },
    deadlineDays: { type: "number" }, k: { type: "number" }, singleCap: { type: "string" }, targetToPause: { type: "string" },
    protocolX25519: { type: "string", description: "the protocol's PUBLIC X25519 key (never the private one)" },
    productId: { type: "string", description: "the Sealed Bounty product (default: the open level's); arc_bounties names the products of each level" },
  } } },
  { name: "arc_operator_plan", description: "Step-by-step plan to become an operator: Intel TDX VM (Phala), app-compose, /attest, bond, registerEnclave, renewal; the bond rules with the figures read on-chain.", inputSchema: { type: "object", properties: { operator: { type: "string" }, productId: { type: "string" } } } },
  { name: "arc_operator_prepare_bond", description: `Operator bond deposit: EIP-3009 authorization for bond(), or encoded approve + bondFrom; checks balance, ban and minimum bond. ${PREP}`, inputSchema: { type: "object", properties: { operator: { type: "string" }, amount: { type: "string", description: "amount in USDC" }, productId: { type: "string" } } } },
  { name: "arc_operator_prepare_register", description: `Enclave registration: anchor block, reading the VM's /attest (if enclaveUrl and operator are given), encoded registerEnclave transaction. ${PREP}`, inputSchema: { type: "object", properties: { productId: { type: "string" }, operator: { type: "string" }, enclaveUrl: { type: "string" }, includeCalldata: { type: "boolean", description: "full calldata (default: yes)" } }, required: ["productId"] } },
  { name: "arc_product_scaffold", description: "Skeleton of a third-party product: container + enclave kit, app-compose, manifest, propose() parameters, then timelock and activate (bpsOperator + bpsAuthor + bpsNetwork = 10,000).", inputSchema: { type: "object", properties: {
    name: { type: "string" }, description: { type: "string" }, rail: { type: "string", enum: ["session", "x402"] }, deterministic: { type: "boolean" },
    price: { type: "string", description: "price per unit in USDC" }, bpsOperator: { type: "number" }, bpsAuthor: { type: "number" }, bpsNetwork: { type: "number" },
    minBond: { type: "string" }, exposureCap: { type: "string" }, modelId: { type: "string" }, image: { type: "string" },
  } } },
  { name: "arc_machines_list", description: "An operator's machines (nodes) from the ArcHive API: mode (tdx, dstack, demo), online, last heartbeat, product, enclave URL and signer, diagnostics OK, registered. Read only.", inputSchema: { type: "object", properties: { operator: { type: "string", description: "0x… address of the operator" } }, required: ["operator"] } },
  { name: "arc_machine_diagnostics", description: "Diagnostics of an operator's machine (ArcHive API): failed checks with the fix to apply, normal failures for the mode, recent log, attestation, on-chain registration. Read only.", inputSchema: { type: "object", properties: { machineId: { type: "string" } }, required: ["machineId"] } },
];

/** The Arc client and the action context of a local MCP process (stdio). */
export function createMcpContext(env: NodeJS.ProcessEnv = process.env): { arc: ArcClient; actx: ActionCtx } {
  // Arc's public RPC answers 429 to bursts: viem retries with a growing delay
  // the stack WITH the levels (SealedBountyVerified: product 5 on v3, product 7 on v2.1), like the copilot
  const arc = createArcClient({ publicClient: createPublicClient({ chain: arcTestnet, transport: http(env.RPC_URL, { retryCount: 5, retryDelay: 400 }) }) as any, deployment: mcpDeployment(env) });
  // Local process (stdio): it returns the full calldata (an agent can pass it as is to the user's wallet, which signs).
  // A malicious enclave URL must not make it read the user's network: same guards as the copilot, except with
  // MCP_ALLOW_PRIVATE_URLS=1 (reading the /attest of a VM on the local network, in development).
  const actx: ActionCtx = {
    allowPrivateUrls: env.MCP_ALLOW_PRIVATE_URLS === "1",
    enclavePathPrefixes: parsePrefixes(env.ENCLAVE_PATH_PREFIXES),
    includeCalldata: true,
    enclaveUrl: env.ENCLAVE_URL,
    apiBase: env.ARCHIVE_API,
  };
  return { arc, actx };
}

/** The action texts shared with the copilot (services/copilot/src/arc-actions.ts) name the copilot's own tools,
 *  the site's old page names and the API's address inside the server: on this MCP server the tools are the arc_* ones,
 *  the pages are the site's current ones and the API is the public one. */
const PUBLIC_API = (process.env.PUBLIC_API_URL || "https://archive.62-171-153-35.sslip.io/api").replace(/\/+$/, "");
const TOOL_RENAMES: Record<string, string> = {
  operator_prepare_bond: "arc_operator_prepare_bond", operator_prepare_register: "arc_operator_prepare_register",
  operator_plan: "arc_operator_plan", session_status: "arc_session_status", enclaves_list: "arc_enclaves",
  machine_diagnostics: "arc_machine_diagnostics", machines_list: "arc_machines_list",
};
export function publicText(s: string): string {
  return s
    .replace(/(?<![\w-])(operator_prepare_bond|operator_prepare_register|operator_plan|session_status|enclaves_list|machine_diagnostics|machines_list)(?![\w-])/g, (m) => TOOL_RENAMES[m] ?? m)
    .split("la page Primes du site (« Publier une prime »)").join("My space › Bounties (space.html?tab=bounties)")
    .split("« Louer sa puissance »").join("Network › Rent (network.html?focus=rent)")
    .split("On-ramp").join("Bridge (bridge.html)")
    .replace(/http:\/\/api:8809\/?/g, (m) => (m.endsWith("/") ? PUBLIC_API + "/" : PUBLIC_API));
}

/** A closed session has nothing left to use: its remainder is 0, and what it refunded at closing is shown as paid. */
function closedSessions(v: any): any {
  if (Array.isArray(v)) return v.map(closedSessions);
  if (!v || typeof v !== "object") return v;
  const o: any = {};
  for (const [k, x] of Object.entries(v)) o[k] = closedSessions(x);
  if (o.fermee === true) {
    if ("resteUtilisable" in o) o.resteUtilisable = "0 USDC";
    if ("unitesRestantes" in o) o.unitesRestantes = "0";
    if ("remboursableALaFermeture" in o) { o.rembourseALaFermeture = o.remboursableALaFermeture; delete o.remboursableALaFermeture; }
    if ("reste" in o && "dejaRegle" in o) { o.rembourseALaFermeture = o.reste; o.reste = "0 USDC"; }
  }
  return o;
}

/** A readable price with its unit, never a bare "0.0001 USDC": per token (session), per call (x402), free, or paid from a bounty's pool. */
function usdc2(x: bigint): string { const s = formatUnits(x, 6); const [i, f] = s.split("."); return f === undefined || f.length >= 2 ? s : `${i}.${f}0`; }
export function readablePrice(arc: ArcClient, id: string, price: bigint, settlement: string, unitTokens = 1, outWeight = 1): string {
  const s = String(settlement).toLowerCase();
  if (/^0x0{40}$/.test(s)) return price === 0n ? "free: no payment contract, nothing is billed" : `${formatUnits(price, 6)} USDC per use`;
  const rail = productRail(arc, id, settlement);
  if (/neutralized/i.test(rail)) return "none: neutralized, replaced by product 7 (this contract settles nothing)";
  if (/x402/i.test(rail)) return `${usdc2(price)} USDC per call (one x402 payment per call; the settlement's gas, about 0.005 USDC at 25 gwei, is paid by the operator)`;
  if (/sessionpay/i.test(rail)) {
    const ut = BigInt(Math.max(1, Math.floor(Number(unitTokens) || 1)));
    const w = Number(outWeight) === 1 ? "a question or answer token" : `a question token; an answer token counts ${outWeight}`;
    return `${formatUnits(price, 6)} USDC per unit, 1 unit = ${ut === 1n ? "1 token" : `${ut} tokens`} (${w}): ${usdc2((price * 1000n) / ut)} USDC per 1,000 tokens, ${usdc2((price * 1_000_000n) / ut)} USDC per million tokens`;
  }
  if (price === 0n) return "0 USDC per use: the bounty's poster funds the pool, which pays the hunter the tier, plus 10% to the network and 5% to the signing operators";
  return `${formatUnits(price, 6)} USDC per unit`;
}
function readableOfListed(arc: ArcClient, p: any): string | undefined {
  try { return readablePrice(arc, String(p.id), parseUnits(String(p.pricePerUnit).replace(/\s*USDC\s*$/, ""), 6), String(p.settlement), Number(p.unitTokens ?? 1), Number(p.outWeight ?? 1)); } catch { return undefined; }
}

/** The price as a person reads it, first and plain ("0.10 USDC per 1,000 tokens (100 USDC per million tokens)",
 *  "0.01 USDC per call", "free", "paid from the poster's pool"); the on-chain value goes in pricePerUnitRaw, with its unit. */
export function plainPrice(arc: ArcClient, id: string, price: bigint, settlement: string, unitTokens = 1): string {
  const s = String(settlement).toLowerCase();
  if (/^0x0{40}$/.test(s)) return price === 0n ? "free" : `${usdc2(price)} USDC per use`;
  const rail = productRail(arc, id, settlement);
  if (/neutralized/i.test(rail)) return "none (neutralized, replaced by product 7)";
  if (/x402/i.test(rail)) return `${usdc2(price)} USDC per call`;
  if (/sessionpay/i.test(rail)) {
    const ut = BigInt(Math.max(1, Math.floor(Number(unitTokens) || 1)));
    return `${usdc2((price * 1000n) / ut)} USDC per 1,000 tokens (${usdc2((price * 1_000_000n) / ut)} USDC per million tokens)`;
  }
  if (price === 0n) return "paid from the poster's pool";
  return `${usdc2(price)} USDC per unit`;
}
export function rawPrice(arc: ArcClient, id: string, price: bigint, settlement: string, unitTokens = 1): string {
  const rail = productRail(arc, id, settlement);
  const ut = Math.max(1, Math.floor(Number(unitTokens) || 1));
  const unit = /x402/i.test(rail) ? "1 unit = 1 call" : /sessionpay/i.test(rail) ? `1 unit = ${ut === 1 ? "1 token" : `${ut} tokens`}` : "";
  return `${formatUnits(price, 6)} USDC per unit${unit ? ` (${unit})` : ""}: the product's on-chain price`;
}
function listedPrice(arc: ArcClient, p: any): { price?: string; pricePerUnitRaw?: string } {
  try {
    const v = parseUnits(String(p.pricePerUnit).replace(/\s*USDC\s*$/, ""), 6);
    return { price: plainPrice(arc, String(p.id), v, String(p.settlement), Number(p.unitTokens ?? 1)), pricePerUnitRaw: rawPrice(arc, String(p.id), v, String(p.settlement), Number(p.unitTokens ?? 1)) };
  } catch { return { pricePerUnitRaw: p.pricePerUnit === undefined ? undefined : `${p.pricePerUnit} per unit: the product's on-chain price` }; }
}

async function pricing(arc: ArcClient, a: any) {
  const rawId = String(a.productId ?? "").trim(), rawUnits = String(a.units ?? "1").trim();
  if (!/^\d{1,12}$/.test(rawId)) throw new Error("bad_param: productId must be a product number (e.g. \"1\")");
  if (!/^\d{1,18}$/.test(rawUnits)) throw new Error("bad_param: units must be a whole number of units (e.g. \"1000\")");
  const id = BigInt(rawId), u = BigInt(rawUnits);
  let p: Awaited<ReturnType<ArcClient["getProduct"]>> | null = null;
  try { p = id >= 1n ? await arc.getProduct(id) : null; } catch { p = null; }
  if (!p || p.state === "None" || /^0x0{40}$/i.test(String(p.author))) throw new Error(`unknown_product: no product #${rawId}`);
  const ut = Number((p as any).unitTokens ?? 1);
  return {
    price: plainPrice(arc, id.toString(), p.price, String(p.settlement), ut), productId: id.toString(), units: u.toString(), total: formatUnits(p.price * u, 6) + " USDC",
    pricePerUnitRaw: rawPrice(arc, id.toString(), p.price, String(p.settlement), ut),
    priceDetails: readablePrice(arc, id.toString(), p.price, String(p.settlement), ut, Number((p as any).outWeight ?? 1)),
  };
}

/** The SDK call prepareBountyCreate writes (appelSdk) uses the SDK's built-in stack (`testnet`). On another stack (read
 *  from DEPLOYMENTS, e.g. v3), the call loads that deployment file, so the bounty is created on the contracts this server
 *  reads: the ones its EIP-3009 authorization is signed for. */
export function stackSdkCall<T>(arc: ArcClient, v: T): T {
  const call = (v as { appelSdk?: unknown } | null)?.appelSdk;
  if (typeof call !== "string" || arc.d.enclaveRegistry.toLowerCase() === testnet.enclaveRegistry.toLowerCase()) return v;
  const file = DEPLOYMENT_FILES.get(arc.d) ?? "deployments.<stack>.testnet.json";
  const load = [
    `import deploymentsJson from "./${file}" with { type: "json" }; // the repository's ${file}: the stack this server reads, not the SDK's built-in testnet`,
    "const stack = deploymentFromJson(deploymentsJson); // @arcvault/sdk",
  ];
  let loaded = false;
  const lines = call.split("\n").flatMap((l) => {
    if (!l.includes("createArcClient(")) return [l];
    const out = l
      .replace("deployment: { ...testnet, sealedBounty: testnet.levels!.sealedBountyVerified }", "deployment: { ...stack, sealedBounty: stack.levels!.sealedBountyVerified }")
      .replace("createArcClient({ publicClient, walletClient })", "createArcClient({ publicClient, walletClient, deployment: stack })");
    const first = !loaded;
    loaded = true;
    return first ? [...load, out] : [out];
  });
  return { ...(v as object), appelSdk: lines.join("\n") } as T;
}

async function run(arc: ArcClient, actx: ActionCtx, name: string, a: any): Promise<unknown> {
  switch (name) {
    case "arc_products": {
      const v = await productsList(arc, { all: a.onlyActive !== true }, actx);
      return { ...v, produits: v.produits.map((p) => { const { pricePerUnit: _raw, ...rest } = p as any; return { id: p.id, ...listedPrice(arc, p), ...rest, rail: productRail(arc, p.id, p.settlement), priceDetails: readableOfListed(arc, p) }; }) };
    }
    case "arc_enclaves": return enclavesList(arc, { onlyActive: a.onlyActive }, actx);
    case "arc_bounties": return bountiesAllLevels(arc, actx, a.onlyOpen === true || String(a.onlyOpen) === "true");
    case "arc_sessions": return sessionsList(arc, { owner: a.owner }, { ...actx, user: undefined });
    case "arc_activity": return activityList(arc, { limit: a.limit }, actx);
    case "arc_pricing": return pricing(arc, a);
    case "arc_verify_receipt": {
      let receipt: unknown = a.receipt;
      if (typeof receipt === "string") { try { receipt = JSON.parse(receipt); } catch { /* reported below */ } }
      const errs = receiptErrors(receipt, a.signature);
      if (errs.length) throw new Error(`invalid receipt: ${errs.join("; ")}`);
      const v = await arc.verifyReceipt(normalizeReceipt(receipt), a.signature);
      return { signer: v.signer, settleable: v.settleable, payableNow: formatUnits(v.payableNow, 6) + " USDC", activeOperatorAtAnchor: v.activeOperatorAtAnchor, checks: v.checks.map((c) => ({ ok: c.ok, quoi: (c as { en?: string }).en ?? c.fr })) };
    }
    case "arc_enclave_status": return enclaveStatus(arc, a.signer);
    case "arc_session_status": return sessionStatus(arc, a.sessionId);
    case "arc_bounty_prepare_create": return stackSdkCall(arc, await prepareBountyCreate(arc, a, actx));
    case "arc_operator_plan": return operatorPlan(arc, a, actx);
    case "arc_operator_prepare_bond": return prepareBond(arc, a, actx);
    case "arc_operator_prepare_register": return prepareRegister(arc, a, actx);
    case "arc_product_scaffold": return productScaffold(arc, { ...a, name: String(a.name ?? "").trim() || "my-service" });
    case "arc_machines_list": return machinesList(a, actx);
    case "arc_machine_diagnostics": return machineDiagnostics(arc, a, actx);
    default: throw new Error(`unknown tool: ${name}`);
  }
}

/** The output in English: keys here, values in english.ts. The shared copilot code (arc-actions.ts) names its keys in
 *  French; the keys of EIP-712 typed data, files and contract parameters (already English) are kept as they are, and so
 *  is a key whose English name is already taken in the same object. Every string value goes through englishValue
 *  (english.ts), which leaves the values read from the chain unchanged. */
const KEYS_EN: Record<string, string> = {
  aBloc: "toBlock", aCompleter: "toFill", aEnvoyerAvantLeBloc: "sendBeforeBlock", aRegarder: "toCheck", accepte: "accepted",
  actifs: "activeCount", actives: "activeCount", activeMaintenant: "activeNow", adresse: "address", appelSdk: "sdkCall", apres: "after",
  autorisationEIP3009: "eip3009Authorization", avant: "before", avertissements: "warnings", banni: "banned", bloc: "block",
  blocDAncrage: "anchorBlock", caution: "bond", cautionDeLOperateur: "operatorBond", cautionMinimale: "minimumBond", chasseur: "hunter",
  cleDuProtocole: "protocolKey", clePubliqueDeSession: "sessionPublicKey", clePubliqueX25519: "x25519PublicKey", commande: "command",
  compte: "account", conseil: "advice", contrat: "contract", couvreLaCautionMinimale: "coversMinimumBond", deBloc: "fromBlock",
  dejaRegle: "alreadySettled", depot: "deposit", deterministe: "deterministic", diagnosticOk: "diagnosticsOk", disponible: "available",
  avertissement: "warning", echeance: "deadlineAt", economie: "economics", enCoursDeRetrait: "withdrawing", enLigne: "online", etape: "step", etapes: "steps",
  etat: "state", evenement: "event", evenements: "events", expireLe: "expiresAt", exposition: "exposure",
  expositionSur24hPourCeProduit: "exposure24hThisProduct", fenetreDeValidite: "validityWindow", fermee: "closed", fermeture: "closing",
  fichiers: "files", financement: "fundingPlan", fonction: "function", gazEstime: "estimatedGas", indexAJourAuBloc: "indexUpToBlock",
  inscriteLe: "registeredAt", inscrites: "registered", laChaineVerifie: "chainChecks", lecture: "howToRead", libre: "free",
  liste: "index", luA: "readAt", lueAuBloc: "readAtBlock", manifestHashBrouillon: "draftManifestHash", manifeste: "manifest",
  margeRestante: "remainingMargin", modele: "model", niveau: "level", montant: "amountUsdc", nom: "label", nombre: "count", noteImages: "imagesNote",
  noteManifeste: "manifestNote", operateur: "operator", operateurs: "operators", origine: "origin", ouSigner: "whereToSign",
  outil: "tool", ouvertes: "openCount", paiementsDuPlusHautPalierCouverts: "topTierPaymentsCovered", palier: "tier", paliers: "tiers",
  parNiveau: "byLevel", partOperateur: "operatorShare", perteMinimale: "minimumLoss", plafond: "cap", plafondDExposition: "exposureCapUsdc",
  plafondDExpositionSur24hParProduit: "exposureCap24hPerProduct", plafondSur24hParProduit: "cap24hPerProduct", poidsSortie: "outputWeight",
  pourquoi: "why", pourquoiCeDelai: "whyThisDelay", predicat: "predicate", predicatCanonique: "canonicalPredicate", pret: "ready",
  primes: "bounties", prixDuProduitAujourdHui: "productPriceToday", prixParUnite: "unitPrice", produit: "product", produits: "products",
  proprietaire: "owner", publierLePredicat: "publishPredicate", quoi: "what", reglableJusquAuBloc: "settleableUntilBlock", regle: "rule",
  reglesDeLaCaution: "bondRules", rembourseALaFermeture: "refundedAtClosing", remboursableALaFermeture: "refundableAtClosing",
  repartitionDeLaSaisie: "slashSplit", reseau: "network", restant: "remaining", reste: "remaining", resteUtilisable: "usableRemainder",
  retardDeLIndexEnBlocs: "indexLagBlocks", retrait: "withdrawal", signataire: "signer", signatureRequise: "signatureRequired",
  somme: "sum", statut: "status", titre: "title", totalPrisDuPool: "totalTakenFromPool", totale: "total", trouvee: "found",
  uniteJetons: "unitTokens", unitesReglees: "unitsSettled", unitesRestantes: "unitsRemaining", verdictEcrit: "verdictWritten",
  verifications: "checks", verrouilleALOuverture: "lockedAtOpening", voieA_uneTransaction: "pathA_oneTransaction",
  voieB_deuxTransactions: "pathB_twoTransactions",
  soldeUSDC: "usdcBalance", cautionDisponible: "availableBond", cautionLibre: "freeBond", cautionsMinimales: "minimumBonds",
  rienANSigner: "nothingToSign", enclavesDeCetOperateur: "operatorEnclaves", erreur: "error", echue: "expired",
  vueDerniereFois: "lastSeenAgo", depuis: "ago", verification: "check", correction: "fix", quand: "when", inscrite: "registered",
  fenetre: "window", diagnostic: "diagnostics", enEchec: "failing", attendusSelonLeMode: "expectedForMode", reussies: "passed",
  resume: "summary", aCorriger: "toFix", attendus: "expected", inscriptionOnChain: "onChainRegistration", journal: "log",
  lignes: "lines", erreurs: "errors", dernieres: "latest", simule: "simulated", quoteOctets: "quoteBytes",
  eventLogOctets: "eventLogBytes", dataOctets: "dataBytes",
  soldeActuelDeLaCible: "targetCurrentBalance", miseEnPause: "pause", cibleMiseEnPause: "targetToPause",
  clePubliqueX25519DuProtocole: "protocolX25519PublicKey", dejaPaye: "alreadyPaid", dejaPayeDepuisLArmement: "paidSinceArming",
  echeanceRelative: "deadlineIn", enPause: "paused", ouverte: "open", pauseDepuisLeBloc: "pausedFromBlock", protocole: "protocol",
  regleV2: "v2Rule", solde: "balance", produitDemande: "requestedProduct", securite: "security",
  unitesCouvertesParLeDepot: "unitsCoveredByDeposit", fenetreJusquAuBloc: "windowUntilBlock", enclavesActives: "activeEnclaves",
  executeCoteServeur: "executedServerSide", codeSdk: "sdkCode", codeMandataireLocal: "localProxyCode",
  cleX25519ConformeALaChaine: "x25519MatchesChain", refusee: "refused", raison: "reason", vue: "view", indisponible: "unavailable",
};
const KEEP_KEYS = new Set(["types", "message", "domain", "files", "fichiers", "createBountyParams", "proposeParams", "args"]);

export function englishKeys(v: any, depth = 0, keepKeys = false): any {
  if (typeof v === "string") return englishValue(v);
  if (Array.isArray(v)) return v.map((x) => englishKeys(x, depth + 1, keepKeys));
  if (!v || typeof v !== "object" || depth > 40) return v;
  const o: any = {};
  for (const [k, x] of Object.entries(v)) {
    const nk = !keepKeys && KEYS_EN[k] && !(KEYS_EN[k] in v) && !(KEYS_EN[k] in o) ? KEYS_EN[k] : k;
    // typed data, files and contract parameters keep their keys; their texts (placeholders, comments) become English
    o[nk] = englishKeys(x, depth + 1, keepKeys || KEEP_KEYS.has(k));
  }
  return o;
}

/** Product 6 (the former SealedBountyVerified) is an unknown contract to the shared copilot code (railOf): where a tool
 *  gives that label to a product, it gets the label arc_products and arc_pricing give it (productRail). */
const UNKNOWN_RAIL = "contrat de règlement inconnu";
async function knownRails(arc: ArcClient, actx: ActionCtx, v: any): Promise<any> {
  if (!JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))?.includes(UNKNOWN_RAIL)) return v;
  let ps: Array<{ id: unknown; settlement: unknown }> = [];
  try { ps = (await productsList(arc, { all: true }, actx)).produits as any; } catch { return v; }
  const settlementOf = new Map(ps.map((p) => [String(p.id), String(p.settlement)]));
  const walk = (x: any, depth: number): any => {
    if (Array.isArray(x)) return x.map((y) => walk(y, depth + 1));
    if (!x || typeof x !== "object" || depth > 40) return x;
    const o: any = {};
    for (const [k, y] of Object.entries(x)) o[k] = walk(y, depth + 1);
    const id = typeof o.produit === "string" ? o.produit : typeof o.id === "string" ? o.id : undefined;
    const s = id === undefined ? undefined : settlementOf.get(id);
    if (o.rail === UNKNOWN_RAIL && s && SUPERSEDED_SBV.has(s.toLowerCase())) o.rail = productRail(arc, id!, s);
    return o;
  };
  return walk(v, 0);
}

/** Public keys read from the chain or from an enclave: the secrets filter reads "x25519PublicKey" as "x25519Public Key"
 *  and would mask it like a private key, so these values are set aside while it runs and put back after it. */
const PUBLIC_KEY_FIELDS = new Set(["x25519PublicKey", "protocolX25519PublicKey"]);
const PUBLIC_KEY_HEX = /^0x[0-9a-fA-F]{64}$/;
function setPublicKeysAside(v: any, kept: string[], depth = 0): any {
  if (Array.isArray(v)) return v.map((x) => setPublicKeysAside(x, kept, depth + 1));
  if (!v || typeof v !== "object" || depth > 40) return v;
  const o: any = {};
  for (const [k, x] of Object.entries(v)) {
    if (PUBLIC_KEY_FIELDS.has(k) && typeof x === "string" && PUBLIC_KEY_HEX.test(x)) { o[k] = `@@public-key-${kept.length}@@`; kept.push(x); }
    else o[k] = setPublicKeysAside(x, kept, depth + 1);
  }
  return o;
}

/** A tool's result as the agent reads it: indented JSON, secrets masked (public keys in clear), in English. */
export function outputText(result: unknown): string {
  const kept: string[] = [];
  const text = JSON.stringify(setPublicKeysAside(result, kept), (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) ?? "null";
  return englishOutput(publicText(scrubSecrets(text))).replace(/@@public-key-(\d+)@@/g, (m, i: string) => kept[Number(i)] ?? m);
}

export type ToolOutput = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** Runs a tool and returns its MCP output: readable JSON, secrets masked; an error is returned to the agent (isError)
 *  without bringing the server down. */
export async function callTool(arc: ArcClient, actx: ActionCtx, name: string, args: unknown): Promise<ToolOutput> {
  const a = (args && typeof args === "object" ? args : {}) as any;
  try {
    const result = englishKeys(closedSessions(await knownRails(arc, actx, await run(arc, actx, name, a))));
    return { content: [{ type: "text", text: outputText(result) }] };
  } catch (e: any) {
    const msg = englishValue(String(e?.shortMessage ?? e?.message ?? String(e)));
    return { content: [{ type: "text", text: englishOutput(publicText(scrubSecrets(`Error: ${msg}`))) }], isError: true };
  }
}
