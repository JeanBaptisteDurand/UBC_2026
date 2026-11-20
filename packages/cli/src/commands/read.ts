/** Reads that need no key: products, enclaves, bounties, a receipt check; and the OpenAI-compatible proxy. */
import { formatUnits, isHex, type Address, type Hex } from "viem";
import { type ProductView, type Receipt } from "@arcvault/sdk";
import {
  CliError, type Command, type Ctx, big, check, fmtTime, info, nowS, opt, out, parseAddr, parseId, readJson, req, usdc,
} from "../cli";
import { ZERO, contractName, enclaveGraceBlocks, reader, sameAddr } from "../chain";

const STATE_LABEL: Record<string, string> = { None: "nonexistent", Proposed: "proposed", Active: "active", Retired: "retired" };
export const stateLabel = (s: string) => STATE_LABEL[s] ?? s;

export function productLine(p: ProductView): string {
  const pct = (b: number) => `${b / 100}`;
  const state = p.state === "Proposed" ? `proposed (can activate ${fmtTime(p.activatesAt)})` : STATE_LABEL[p.state] ?? p.state;
  return [
    `#${p.id}`,
    state,
    `${formatUnits(p.price, 6)} USDC/unit (${p.unitTokens} token${p.unitTokens > 1 ? "s" : ""}${p.outWeight > 1 ? `, output ×${p.outWeight}` : ""})`,
    p.deterministic ? "deterministic" : "not deterministic",
    `shares op/author/network ${pct(p.bpsOperator)}/${pct(p.bpsAuthor)}/${pct(p.bpsNetwork)} %`,
    `caution min ${usdc(p.minBond)}`,
    `settlement ${contractName(p.settlement)}`,
    `auteur ${p.author}`,
    ...(p.manifestURI ? [`manifeste ${p.manifestURI}`] : []),
  ].join("  ");
}

export async function listProducts(ctx: Ctx): Promise<void> {
  const { arc } = reader(ctx.rpc);
  const list = await arc.listProducts();
  if (!list.length) return out("no product");
  for (const p of list) out(productLine(p));
}

export async function listBounties(ctx: Ctx): Promise<void> {
  const { arc } = reader(ctx.rpc);
  const list = await arc.listBounties();
  if (!list.length) return out("no bounty");
  for (const b of list.sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const state = b.paused ? "paused" : Number(b.deadline) < nowS() ? "expired" : "open";
    out(
      `#${b.id}  ${state}  product #${b.productId}  balance ${usdc(b.balance)}  deadline ${fmtTime(b.deadline)}  protocol ${b.protocol}` +
        (b.paidAmount > 0n ? `  already paid ${usdc(b.paidAmount)}` : "") + (b.targetToPause !== ZERO ? `  target ${b.targetToPause}` : ""),
    );
  }
}

export const productsCmd: Command = {
  path: ["products"],
  summary: "lists the marketplace products (alias of \"product list\")",
  usage: "products",
  run: listProducts,
};

export const bountiesCmd: Command = {
  path: ["bounties"],
  summary: "lists the sealed bounties (alias of \"bounty list\")",
  usage: "bounties",
  run: listBounties,
};

export const enclavesCmd: Command = {
  path: ["enclaves"],
  summary: "lists the registered enclaves (the \"hive\") and their state",
  usage: "enclaves [--product <id>] [--operator <address>]",
  description: [
    "\"active\": the enclave can sign receipts now (the head block is inside its validity window);",
    "\"in grace\": the window has passed, and its receipts anchored inside it stay settleable during the grace period (in blocks);",
    "\"inactive\": killed, retired or too old. Validity is counted in blocks (≈ 24 h).",
  ],
  options: [
    { name: "product", value: "<id>", desc: "only this product" },
    { name: "operator", value: "<address>", desc: "only this operator" },
  ],
  examples: ["arcvault enclaves", "arcvault enclaves --product 1"],
  async run(ctx) {
    const product = opt(ctx, "product") !== undefined ? parseId(opt(ctx, "product"), "--product") : undefined;
    const operator = opt(ctx, "operator") !== undefined ? parseAddr(req(ctx, "operator"), "--operator") : undefined;
    const { arc, pub } = reader(ctx.rpc);
    const list = (await arc.listEnclaves()).filter(
      (e) => (product === undefined || e.productId === product) && (!operator || sameAddr(e.operator, operator)),
    );
    if (!list.length) return out("no enclave");
    const grace = await enclaveGraceBlocks(pub);
    for (const e of list) {
      const head = e.head ?? 0n;
      const state = e.active ? "⬡ active           " : head <= e.untilBlock + grace ? "◌ in grace         " : "· inactive         ";
      out(`${state}product #${e.productId}  signer ${e.signer}  operator ${e.operator}  TCB ${e.tcbStatus}  blocks ${e.fromBlock}→${e.untilBlock} (≈ ${fmtTime(e.expiresAt)})`);
    }
  },
};

/** Reads a receipt from a file: { receipt, signature }, or the flat receipt (+ signature). */
export function loadReceiptFile(path: string, sigOpt?: string): { receipt: Receipt; signature: Hex } {
  const j = readJson(path, "receipt") as any;
  const r = j?.receipt ?? j;
  const signature = (sigOpt ?? j?.signature ?? r?.signature) as Hex | undefined;
  if (!signature || !isHex(signature)) throw new CliError("receipt signature missing: --sig 0x… or a \"signature\" field in the file");
  return { receipt: normalizeReceipt(r), signature };
}

export function normalizeReceipt(r: any): Receipt {
  const h = (k: string) => {
    if (!isHex(r?.[k]) || r[k].length !== 66) throw new CliError(`receipt: ${k} must be a bytes32 (0x + 64 hex)`);
    return r[k] as Hex;
  };
  return {
    productId: big(r?.productId, "productId"), sessionId: big(r?.sessionId, "sessionId"), seq: big(r?.seq, "seq"),
    modelHash: h("modelHash"), paramsHash: h("paramsHash"), requestHash: h("requestHash"), responseHash: h("responseHash"),
    tokensIn: big(r?.tokensIn, "tokensIn"), tokensOut: big(r?.tokensOut, "tokensOut"),
    cumulativeUnits: big(r?.cumulativeUnits, "cumulativeUnits"), anchorBlock: big(r?.anchorBlock, "anchorBlock"),
  };
}

export const verifyCmd: Command = {
  path: ["verify"],
  summary: "verifies an inference receipt like SessionPay.settle: locked enclave, active, operator, model, total",
  usage: "verify --receipt <fichier.json> [--sig 0x…]",
  description: [
    "The file holds { receipt, signature } (as the enclave returns it) or the flat receipt.",
    "The same checks as the contract at settlement (reads only). Exit code 0 if the receipt is settleable, 1 otherwise.",
  ],
  options: [
    { name: "receipt", value: "<file>", desc: "JSON receipt", required: true },
    { name: "sig", value: "<0x…>", desc: "the receipt's EIP-712 signature, if the file lacks it" },
  ],
  examples: ["arcvault verify --receipt recu.json"],
  async run(ctx) {
    const { receipt, signature } = loadReceiptFile(req(ctx, "receipt"), opt(ctx, "sig"));
    const { arc } = reader(ctx.rpc);
    const v = await arc.verifyReceipt(receipt, signature);
    out(`signer ${v.signer}, active operator at the anchor block: ${v.activeOperatorAtAnchor === ZERO ? "none" : v.activeOperatorAtAnchor}`);
    for (const c of v.checks) out(`  ${check(c.ok)} ${c.fr}`);
    out(`  cumulative ${receipt.cumulativeUnits} units, seq ${receipt.seq}${v.settleable ? `, settle would pay ${usdc(v.payableNow)}` : ""}`);
    if (!v.settleable) {
      info("receipt NOT settleable");
      process.exitCode = 1;
    }
  },
};

export const proxyCmd: Command = {
  path: ["proxy"],
  summary: "local OpenAI-compatible proxy: encrypts, signs with the aek_ key, verifies every receipt",
  usage: "proxy --key <aek_…> --enclave <url> [--port 8787]",
  description: [
    "Any program that talks to OpenAI works once its base URL points to http://localhost:<port>/v1.",
    "Only this proxy, on your machine, sees the plaintext. Prefer ARC_AEK=… to --key (shell history).",
    "Before any send, the --enclave keys are checked against the chain (registered X25519 key, active enclave,",
    "the session's locked enclave): a URL that serves another key is refused.",
  ],
  options: [
    { name: "key", value: "<aek_…>", desc: "the session's access key (otherwise the ARC_AEK environment variable)" },
    { name: "enclave", value: "<url>", desc: "URL of the inference enclave", required: true },
    { name: "port", value: "<port>", desc: "local port (default 8787)" },
  ],
  examples: ["ARC_AEK=aek_arctest_12_… arcvault proxy --enclave https://…-8802.dstack-pha1-prod9.phala.network"],
  async run(ctx) {
    const aek = opt(ctx, "key") ?? process.env.ARC_AEK;
    if (!aek) throw new CliError("access key required: --key aek_… or the ARC_AEK environment variable");
    const port = opt(ctx, "port") !== undefined ? Number(parseId(opt(ctx, "port"), "--port")) : undefined;
    const { startProxy } = await import("../proxy"); // loaded on demand (HTTP server)
    await startProxy({ aek, enclaveUrl: req(ctx, "enclave"), port, rpcUrl: ctx.rpc }); // refuses to start if the keys are not the registered ones
    await new Promise(() => {}); // reste ouvert
  },
};

