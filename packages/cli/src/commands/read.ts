/** Lectures sans clé : produits, enclaves, primes, vérification d'un reçu ; et le mandataire OpenAI. */
import { formatUnits, isHex, type Address, type Hex } from "viem";
import { type ProductView, type Receipt } from "@arcvault/sdk";
import {
  CliError, type Command, type Ctx, big, check, fmtTime, info, nowS, opt, out, parseAddr, parseId, readJson, req, usdc,
} from "../cli";
import { ZERO, contractName, enclaveGraceBlocks, reader, sameAddr } from "../chain";

const STATE_FR: Record<string, string> = { None: "inexistant", Proposed: "proposé", Active: "actif", Retired: "retiré" };
export const stateFr = (s: string) => STATE_FR[s] ?? s;

export function productLine(p: ProductView): string {
  const pct = (b: number) => `${b / 100}`;
  const state = p.state === "Proposed" ? `proposé (activable ${fmtTime(p.activatesAt)})` : STATE_FR[p.state] ?? p.state;
  return [
    `#${p.id}`,
    state,
    `${formatUnits(p.price, 6)} USDC/unité (${p.unitTokens} jeton${p.unitTokens > 1 ? "s" : ""}${p.outWeight > 1 ? `, sortie ×${p.outWeight}` : ""})`,
    p.deterministic ? "déterministe" : "non déterministe",
    `parts op/auteur/réseau ${pct(p.bpsOperator)}/${pct(p.bpsAuthor)}/${pct(p.bpsNetwork)} %`,
    `caution min ${usdc(p.minBond)}`,
    `règlement ${contractName(p.settlement)}`,
    `auteur ${p.author}`,
    ...(p.manifestURI ? [`manifeste ${p.manifestURI}`] : []),
  ].join("  ");
}

export async function listProducts(ctx: Ctx): Promise<void> {
  const { arc } = reader(ctx.rpc);
  const list = await arc.listProducts();
  if (!list.length) return out("aucun produit");
  for (const p of list) out(productLine(p));
}

export async function listBounties(ctx: Ctx): Promise<void> {
  const { arc } = reader(ctx.rpc);
  const list = await arc.listBounties();
  if (!list.length) return out("aucune prime");
  for (const b of list.sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const state = b.paused ? "en pause" : Number(b.deadline) < nowS() ? "échue" : "ouverte";
    out(
      `#${b.id}  ${state}  produit #${b.productId}  solde ${usdc(b.balance)}  échéance ${fmtTime(b.deadline)}  protocole ${b.protocol}` +
        (b.paidAmount > 0n ? `  déjà payé ${usdc(b.paidAmount)}` : "") + (b.targetToPause !== ZERO ? `  cible ${b.targetToPause}` : ""),
    );
  }
}

export const productsCmd: Command = {
  path: ["products"],
  summary: "liste les produits de la place de marché (alias de « product list »)",
  usage: "products",
  run: listProducts,
};

export const bountiesCmd: Command = {
  path: ["bounties"],
  summary: "liste les primes scellées (alias de « bounty list »)",
  usage: "bounties",
  run: listBounties,
};

export const enclavesCmd: Command = {
  path: ["enclaves"],
  summary: "liste les enclaves inscrites (la « hive ») et leur état",
  usage: "enclaves [--product <id>] [--operator <adresse>]",
  description: [
    "« active » : l'enclave peut signer des reçus maintenant (bloc de tête dans sa fenêtre de validité) ;",
    "« en grâce » : fenêtre écoulée, ses reçus ancrés dedans restent réglables pendant la grâce (en blocs) ;",
    "« inactive » : invalidée, retirée ou trop ancienne. Les validités se comptent en blocs (≈ 24 h).",
  ],
  options: [
    { name: "product", value: "<id>", desc: "seulement ce produit" },
    { name: "operator", value: "<adresse>", desc: "seulement cet opérateur" },
  ],
  examples: ["arcvault enclaves", "arcvault enclaves --product 1"],
  async run(ctx) {
    const product = opt(ctx, "product") !== undefined ? parseId(opt(ctx, "product"), "--product") : undefined;
    const operator = opt(ctx, "operator") !== undefined ? parseAddr(req(ctx, "operator"), "--operator") : undefined;
    const { arc, pub } = reader(ctx.rpc);
    const list = (await arc.listEnclaves()).filter(
      (e) => (product === undefined || e.productId === product) && (!operator || sameAddr(e.operator, operator)),
    );
    if (!list.length) return out("aucune enclave");
    const grace = await enclaveGraceBlocks(pub);
    for (const e of list) {
      const head = e.head ?? 0n;
      const state = e.active ? "⬡ active           " : head <= e.untilBlock + grace ? "◌ en grâce         " : "· inactive         ";
      out(`${state}produit #${e.productId}  signer ${e.signer}  opérateur ${e.operator}  TCB ${e.tcbStatus}  blocs ${e.fromBlock}→${e.untilBlock} (≈ ${fmtTime(e.expiresAt)})`);
    }
  },
};

/** Lit un reçu depuis un fichier : { receipt, signature } ou le reçu à plat (+ signature). */
export function loadReceiptFile(path: string, sigOpt?: string): { receipt: Receipt; signature: Hex } {
  const j = readJson(path, "reçu") as any;
  const r = j?.receipt ?? j;
  const signature = (sigOpt ?? j?.signature ?? r?.signature) as Hex | undefined;
  if (!signature || !isHex(signature)) throw new CliError("signature du reçu absente : --sig 0x… ou champ « signature » du fichier");
  return { receipt: normalizeReceipt(r), signature };
}

export function normalizeReceipt(r: any): Receipt {
  const h = (k: string) => {
    if (!isHex(r?.[k]) || r[k].length !== 66) throw new CliError(`reçu : ${k} doit être un bytes32 (0x + 64 hex)`);
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
  summary: "vérifie un reçu d'inférence comme SessionPay.settle : enclave verrouillée, active, opérateur, modèle, cumul",
  usage: "verify --receipt <fichier.json> [--sig 0x…]",
  description: [
    "Le fichier contient { receipt, signature } (tel que rendu par l'enclave) ou le reçu à plat.",
    "Mêmes contrôles que le contrat au règlement (lectures seulement). Code de sortie 0 si le reçu est réglable, 1 sinon.",
  ],
  options: [
    { name: "receipt", value: "<fichier>", desc: "reçu JSON", required: true },
    { name: "sig", value: "<0x…>", desc: "signature EIP-712 du reçu, si absente du fichier" },
  ],
  examples: ["arcvault verify --receipt recu.json"],
  async run(ctx) {
    const { receipt, signature } = loadReceiptFile(req(ctx, "receipt"), opt(ctx, "sig"));
    const { arc } = reader(ctx.rpc);
    const v = await arc.verifyReceipt(receipt, signature);
    out(`signataire ${v.signer} — opérateur actif au bloc d'ancrage : ${v.activeOperatorAtAnchor === ZERO ? "aucun" : v.activeOperatorAtAnchor}`);
    for (const c of v.checks) out(`  ${check(c.ok)} ${c.fr}`);
    out(`  cumul ${receipt.cumulativeUnits} unités — seq ${receipt.seq}${v.settleable ? ` — settle verserait ${usdc(v.payableNow)}` : ""}`);
    if (!v.settleable) {
      info("reçu NON réglable");
      process.exitCode = 1;
    }
  },
};

export const proxyCmd: Command = {
  path: ["proxy"],
  summary: "mandataire local compatible OpenAI : chiffre, signe avec la clé aek_, vérifie chaque reçu",
  usage: "proxy --key <aek_…> --enclave <url> [--port 8787]",
  description: [
    "Tout programme qui parle à OpenAI marche en changeant son URL de base vers http://localhost:<port>/v1.",
    "Seul ce mandataire, sur votre machine, voit le clair. Préférez ARC_AEK=… à --key (historique du shell).",
    "Avant tout envoi, les clés de --enclave sont confrontées à la chaîne (clé X25519 inscrite, enclave active,",
    "enclave verrouillée de la session) : une URL qui sert une autre clé est refusée.",
  ],
  options: [
    { name: "key", value: "<aek_…>", desc: "clé d'accès de la session (sinon variable d'environnement ARC_AEK)" },
    { name: "enclave", value: "<url>", desc: "URL de l'enclave d'inférence (O2)", required: true },
    { name: "port", value: "<port>", desc: "port local (défaut 8787)" },
  ],
  examples: ["ARC_AEK=aek_arctest_12_… arcvault proxy --enclave https://…-8802.dstack-pha1-prod9.phala.network"],
  async run(ctx) {
    const aek = opt(ctx, "key") ?? process.env.ARC_AEK;
    if (!aek) throw new CliError("clé d'accès requise : --key aek_… ou variable d'environnement ARC_AEK");
    const port = opt(ctx, "port") !== undefined ? Number(parseId(opt(ctx, "port"), "--port")) : undefined;
    const { startProxy } = await import("../proxy"); // chargé à la demande (serveur HTTP)
    await startProxy({ aek, enclaveUrl: req(ctx, "enclave"), port, rpcUrl: ctx.rpc }); // refuse de démarrer si les clés ne sont pas celles inscrites
    await new Promise(() => {}); // reste ouvert
  },
};

