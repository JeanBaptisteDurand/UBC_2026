/** product — la place de marché (PLAN-BUILD §3.3) : lister, proposer depuis un manifeste, activer après le timelock. */
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
  /** v2 : unité facturée (jetons-équivalent-entrée par unité) et poids d'un jeton de sortie (défaut 1 et 1). */
  unitTokens: number;
  outWeight: number;
}

/** Partie on-chain du manifeste (le reste — nom, version, dépôt, images… — est informatif et haché avec). */
function parseManifest(path: string): { m: Manifest; hash: Hex } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new CliError(`manifeste introuvable : ${path}`);
  }
  let j: any;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new CliError(`manifeste : JSON invalide (${(e as Error).message})`);
  }
  const bad = (m: string): never => {
    throw new CliError(`manifeste ${path} : ${m}`);
  };
  if (j.workloadIds !== undefined && (!Array.isArray(j.workloadIds) || !j.workloadIds.every(isBytes32))) {
    bad("« workloadIds » : liste de bytes32 (mesures autorisées de l'image, P5) ; vide = à autoriser plus tard (proposeWorkload → applyWorkload)");
  }
  const intIn = (v: unknown, name: string): number => {
    if (v === undefined) return 1;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 4_294_967_295) bad(`« ${name} » : entier ≥ 1`);
    return n;
  };
  if (typeof j.deterministic !== "boolean") bad("« deterministic » : true ou false");
  const s = j.shares ?? {};
  const bps = { operator: Number(s.operator), author: Number(s.author), network: Number(s.network) };
  if (![bps.operator, bps.author, bps.network].every((x) => Number.isInteger(x) && x >= 0 && x <= 10_000)) {
    bad("« shares » : { operator, author, network } en points de base");
  }
  if (bps.operator + bps.author + bps.network !== 10_000) bad("« shares » : la somme doit faire 10 000 points de base");
  if (bps.author > 3_000) bad("« shares » : la part de l'auteur est plafonnée à 3 000 points de base (30 %, AuthorShareTooHigh)");
  if (bps.network < 500) bad("« shares » : la part du réseau est d'au moins 500 points de base (5 %, NetworkShareTooLow)");
  const settlementRaw = String(j.settlement ?? "");
  const settlement = SETTLEMENTS[settlementRaw.toLowerCase()] ?? (/^0x[0-9a-fA-F]{40}$/.test(settlementRaw) ? parseAddr(settlementRaw, "settlement") : bad("« settlement » : SessionPay, SealedBounty, X402Settler ou une adresse"));
  const param = j.param === undefined ? (`0x${"00".repeat(32)}` as Hex) : isBytes32(j.param) ? j.param : bad("« param » : bytes32 (ex. hash du modèle)");
  const advisoryIds = j.advisoryIds ?? [];
  if (!Array.isArray(advisoryIds) || !advisoryIds.every((x: unknown) => typeof x === "string")) bad("« advisoryIds » : liste de chaînes");
  const m: Manifest = {
    manifestURI: typeof j.manifestURI === "string" ? j.manifestURI : undefined,
    workloadIds: j.workloadIds ?? [],
    deterministic: j.deterministic,
    price: parseUsdc(String(j.price ?? ""), "manifeste « price » (USDC par unité)"),
    bps,
    minBond: parseUsdc(String(j.minBond ?? ""), "manifeste « minBond » (USDC)"),
    exposureCap: parseUsdc(String(j.exposureCap ?? ""), "manifeste « exposureCap » (USDC par 24 h)"),
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
  summary: "liste les produits : état, prix, parts, caution minimale, contrat de règlement",
  usage: "product list",
  run: listProducts,
};

const propose: Command = {
  path: ["product", "propose"],
  summary: "propose un produit depuis son manifeste JSON ; activable après le timelock",
  usage: "product propose <manifeste.json> [--uri <manifestURI>]",
  description: [
    "Champs lus : workloadIds (facultatif : sinon proposeWorkload → applyWorkload), deterministic, price (USDC/unité),",
    "shares { operator, author ≤ 3 000, network ≥ 500 } (points de base, somme 10 000), minBond, exposureCap (USDC),",
    "settlement (SessionPay | SealedBounty | X402Settler | 0x…), param (bytes32, ex. hash du modèle, facultatif),",
    "unitTokens et outWeight (v2, défaut 1 : unité facturée et poids d'un jeton de sortie), advisoryIds, manifestURI (ou --uri).",
    "Les autres champs (nom, version, dépôt, images, app-compose…) sont informatifs. manifestHash = keccak256",
    "des octets du fichier : publiez ce fichier tel quel à l'URI annoncée.",
  ],
  args: [{ name: "manifeste.json", desc: "manifeste du produit" }],
  options: [{ name: "uri", value: "<manifestURI>", desc: "où le manifeste est publié (sinon le champ manifestURI)" }],
  write: true,
  examples: ["arcvault product propose manifest.json --uri ipfs://bafy…", "arcvault product propose manifest.json --dry-run"],
  async run(ctx) {
    const path = ctx.args[0] as string;
    const { m, hash } = parseManifest(path);
    const manifestURI = opt(ctx, "uri") ?? m.manifestURI;
    if (!manifestURI) throw new CliError("URI du manifeste requise : --uri <manifestURI> ou champ manifestURI");
    if (m.deterministic !== sameAddr(m.settlement, testnet.sealedBounty)) {
      warn("un produit « Prime scellée » est déterministe et se règle par SealedBounty ; les autres non : vérifiez deterministic/settlement");
    }
    const w = await writer(ctx);
    const timelock = (await w.pub.readContract({
      address: testnet.productRegistry, abi: [{ type: "function", name: "timelock", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] }],
      functionName: "timelock",
    })) as bigint;
    info(`proposition : manifestHash ${hash}, ${m.workloadIds.length} image(s), ${usdc(m.price)}/unité, règlement ${contractName(m.settlement)}, timelock ${timelock} s`);
    const r = await w.arc.proposeProduct({
      manifestHash: hash, manifestURI, workloadIds: m.workloadIds, deterministic: m.deterministic, price: m.price,
      bpsOperator: m.bps.operator, bpsAuthor: m.bps.author, bpsNetwork: m.bps.network, minBond: m.minBond,
      exposureCap: m.exposureCap, settlement: m.settlement, param: m.param, advisoryIds: m.advisoryIds,
      unitTokens: m.unitTokens, outWeight: m.outWeight,
    });
    const rcpt = await confirm(w, "propose", r.tx);
    if (!rcpt) return out(`[simulation] produit #${r.productId} serait proposé (manifestHash ${hash})`);
    const ev = parseEventLogs({ abi: productRegistryAbi, logs: rcpt.logs, eventName: "ProductProposed" })[0];
    const id = ev ? ev.args.productId : r.productId;
    const at = ev ? ev.args.activatesAt : BigInt(nowS()) + timelock;
    out(`produit #${id} proposé (manifestHash ${hash}) ; activable ${fmtTime(at)} : arcvault product activate ${id}`);
  },
};

const activate: Command = {
  path: ["product", "activate"],
  summary: "active un produit proposé, une fois le timelock écoulé (ouvert à tous)",
  usage: "product activate <id>",
  args: [{ name: "id", desc: "identifiant du produit" }],
  write: true,
  examples: ["arcvault product activate 8"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const w = await writer(ctx);
    const p = await w.arc.getProduct(id);
    if (p.state === "None") throw new CliError(`produit #${id} inexistant`);
    if (p.state !== "Proposed") throw new CliError(`produit #${id} déjà ${p.state === "Active" ? "actif" : "retiré"}`);
    if (Number(p.activatesAt) > nowS()) throw new CliError(`timelock en cours : activable ${fmtTime(p.activatesAt)}`);
    await confirm(w, "activate", await w.arc.activateProduct(id));
    if (w.dryRun) return out(`[simulation] produit #${id} serait activé`);
    out(productLine(await w.arc.getProduct(id)));
  },
};

export const productCommands: Command[] = [list, propose, activate];
export const PRODUCT_TITLE = "la place de marché des produits (auteurs) : lister, proposer un manifeste, activer après le timelock";
