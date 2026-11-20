/** product — the marketplace: list, propose from a manifest, activate after the timelock. */
import { readFileSync } from "node:fs";
import { keccak256, parseEventLogs, type Address, type Hex } from "viem";
import { productRegistryAbi, testnet } from "@arcvault/sdk";
import {
  CliError, type Command, fmtTime, info, isBytes32, nowS, opt, out, parseAddr, parseId, parseUsdc, usdc, warn,
} from "../cli";
import { confirm, contractName, sameAddr, writer } from "../chain";
import { listProducts, productLine } from "./read";

const SETTLEMENTS: Record<string, Address> = {
  sessionpay: testnet.sessionPay,
  sealedbounty: testnet.sealedBounty,
  x402settler: testnet.x402Settler,
  x402: testnet.x402Settler,
};

interface Manifest {
  manifestURI?: string;
  workloadIds: Hex[];
  deterministic: boolean;
  price: bigint;
  bps: { operator: number; author: number; network: number };
  minBond: bigint;
  exposureCap: bigint;
  settlement: Address;
  param: Hex;
  advisoryIds: string[];
  /** Billed unit (input-equivalent tokens per unit) and the weight of an output token (default 1 and 1). */
  unitTokens: number;
  outWeight: number;
}

/** The on-chain part of the manifest (the rest, such as name, version, repository and images, is informative and hashed with it). */
function parseManifest(path: string): { m: Manifest; hash: Hex } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new CliError(`manifest not found: ${path}`);
  }
  let j: any;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new CliError(`manifest: invalid JSON (${(e as Error).message})`);
  }
  const bad = (m: string): never => {
    throw new CliError(`manifest ${path}: ${m}`);
  };
  if (j.workloadIds !== undefined && (!Array.isArray(j.workloadIds) || !j.workloadIds.every(isBytes32))) {
    bad("\"workloadIds\": a list of bytes32 (allowed image measurements, P5); empty = to allow later (proposeWorkload → applyWorkload)");
  }
  const intIn = (v: unknown, name: string): number => {
    if (v === undefined) return 1;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 4_294_967_295) bad(`"${name}": integer ≥ 1`);
    return n;
  };
  if (typeof j.deterministic !== "boolean") bad("\"deterministic\": true or false");
  const s = j.shares ?? {};
  const bps = { operator: Number(s.operator), author: Number(s.author), network: Number(s.network) };
  if (![bps.operator, bps.author, bps.network].every((x) => Number.isInteger(x) && x >= 0 && x <= 10_000)) {
    bad("\"shares\": { operator, author, network } in basis points");
  }
  if (bps.operator + bps.author + bps.network !== 10_000) bad("\"shares\": the sum must be 10,000 basis points");
  if (bps.author > 3_000) bad("\"shares\": the author's share is capped at 3,000 basis points (30 %, AuthorShareTooHigh)");
  if (bps.network < 500) bad("\"shares\": the network's share is at least 500 basis points (5 %, NetworkShareTooLow)");
  const settlementRaw = String(j.settlement ?? "");
  const settlement = SETTLEMENTS[settlementRaw.toLowerCase()] ?? (/^0x[0-9a-fA-F]{40}$/.test(settlementRaw) ? parseAddr(settlementRaw, "settlement") : bad("\"settlement\": SessionPay, SealedBounty, X402Settler or an address"));
  const param = j.param === undefined ? (`0x${"00".repeat(32)}` as Hex) : isBytes32(j.param) ? j.param : bad("\"param\": bytes32 (e.g. the model's hash)");
  const advisoryIds = j.advisoryIds ?? [];
  if (!Array.isArray(advisoryIds) || !advisoryIds.every((x: unknown) => typeof x === "string")) bad("\"advisoryIds\": a list of strings");
  const m: Manifest = {
    manifestURI: typeof j.manifestURI === "string" ? j.manifestURI : undefined,
    workloadIds: j.workloadIds ?? [],
    deterministic: j.deterministic,
    price: parseUsdc(String(j.price ?? ""), "manifest \"price\" (USDC per unit)"),
    bps,
    minBond: parseUsdc(String(j.minBond ?? ""), "manifest \"minBond\" (USDC)"),
    exposureCap: parseUsdc(String(j.exposureCap ?? ""), "manifest \"exposureCap\" (USDC per 24 h)"),
    settlement,
    param,
    advisoryIds,
    unitTokens: intIn(j.unitTokens, "unitTokens"),
    outWeight: intIn(j.outWeight, "outWeight"),
  };
  return { m, hash: keccak256(new TextEncoder().encode(text)) };
}

const list: Command = {
  path: ["product", "list"],
  summary: "lists the products: state, price, shares, minimum bond, settlement contract",
  usage: "product list",
  run: listProducts,
};

const propose: Command = {
  path: ["product", "propose"],
  summary: "proposes a product from its JSON manifest; it can be activated after the timelock",
  usage: "product propose <manifest.json> [--uri <manifestURI>]",
  description: [
    "Fields read: workloadIds (optional: otherwise proposeWorkload → applyWorkload), deterministic, price (USDC/unit),",
    "shares { operator, author ≤ 3,000, network ≥ 500 } (basis points, sum 10,000), minBond, exposureCap (USDC),",
    "settlement (SessionPay | SealedBounty | X402Settler | 0x…), param (bytes32, e.g. the model's hash, optional),",
    "unitTokens and outWeight (default 1: billed unit and weight of an output token), advisoryIds, manifestURI (or --uri).",
    "The other fields (name, version, repository, images, app-compose…) are informative. manifestHash = keccak256",
    "of the file's bytes: publish this file as is at the announced URI.",
  ],
  args: [{ name: "manifest.json", desc: "the product's manifest" }],
  options: [{ name: "uri", value: "<manifestURI>", desc: "where the manifest is published (otherwise the manifestURI field)" }],
  write: true,
  examples: ["arcvault product propose manifest.json --uri ipfs://bafy…", "arcvault product propose manifest.json --dry-run"],
  async run(ctx) {
    const path = ctx.args[0] as string;
    const { m, hash } = parseManifest(path);
    const manifestURI = opt(ctx, "uri") ?? m.manifestURI;
    if (!manifestURI) throw new CliError("manifest URI required: --uri <manifestURI> or the manifestURI field");
    if (m.deterministic !== sameAddr(m.settlement, testnet.sealedBounty)) {
      warn("a Sealed Bounty product is deterministic and settles through SealedBounty; the others are not: check deterministic/settlement");
    }
    const w = await writer(ctx);
    const timelock = (await w.pub.readContract({
      address: testnet.productRegistry, abi: [{ type: "function", name: "timelock", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] }],
      functionName: "timelock",
    })) as bigint;
    info(`proposal: manifestHash ${hash}, ${m.workloadIds.length} image(s), ${usdc(m.price)}/unit, settlement ${contractName(m.settlement)}, timelock ${timelock} s`);
    const r = await w.arc.proposeProduct({
      manifestHash: hash, manifestURI, workloadIds: m.workloadIds, deterministic: m.deterministic, price: m.price,
      bpsOperator: m.bps.operator, bpsAuthor: m.bps.author, bpsNetwork: m.bps.network, minBond: m.minBond,
      exposureCap: m.exposureCap, settlement: m.settlement, param: m.param, advisoryIds: m.advisoryIds,
      unitTokens: m.unitTokens, outWeight: m.outWeight,
    });
    const rcpt = await confirm(w, "propose", r.tx);
    if (!rcpt) return out(`[dry run] product #${r.productId} would be proposed (manifestHash ${hash})`);
    const ev = parseEventLogs({ abi: productRegistryAbi, logs: rcpt.logs, eventName: "ProductProposed" })[0];
    const id = ev ? ev.args.productId : r.productId;
    const at = ev ? ev.args.activatesAt : BigInt(nowS()) + timelock;
    out(`product #${id} proposed (manifestHash ${hash}); can activate ${fmtTime(at)}: arcvault product activate ${id}`);
  },
};

const activate: Command = {
  path: ["product", "activate"],
  summary: "activates a proposed product once the timelock has passed (open to anyone)",
  usage: "product activate <id>",
  args: [{ name: "id", desc: "the product's id" }],
  write: true,
  examples: ["arcvault product activate 8"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const w = await writer(ctx);
    const p = await w.arc.getProduct(id);
    if (p.state === "None") throw new CliError(`product #${id} does not exist`);
    if (p.state !== "Proposed") throw new CliError(`product #${id} already ${p.state === "Active" ? "active" : "retired"}`);
    if (Number(p.activatesAt) > nowS()) throw new CliError(`timelock running: can activate ${fmtTime(p.activatesAt)}`);
    await confirm(w, "activate", await w.arc.activateProduct(id));
    if (w.dryRun) return out(`[dry run] product #${id} would be activated`);
    out(productLine(await w.arc.getProduct(id)));
  },
};

export const productCommands: Command[] = [list, propose, activate];
export const PRODUCT_TITLE = "the product marketplace (authors): list, propose a manifest, activate after the timelock";
