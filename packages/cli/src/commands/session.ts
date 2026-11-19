/** session — sessions prépayées SessionPay et clés d'accès aek_. */
import { parseEventLogs, type Address } from "viem";
import { encodeAek, generateSessionKey, sessionCeiling, sessionPayAbi, testnet } from "@arcvault/sdk";
import {
  CliError, type Command, dur, fmtTime, info, nowS, opt, out, parseAddr, parseDurationS, parseId, parseUsdc, req, usdc, warn,
} from "../cli";
import {
  NET_TAG, RevertedOnChain, ZERO, confirm, contractName, reader, sameAddr, sessionExtraAbi, verifiedEnclave,
  walletAddressIfAny, writer, type Writer,
} from "../chain";
import { stateFr } from "./read";

async function loadSession(arc: Writer["arc"], id: bigint) {
  const s = await arc.getSession(id);
  if (!s || s.owner === ZERO) throw new CliError(`session #${id} inexistante`);
  return s;
}

const open: Command = {
  path: ["session", "open"],
  summary: "ouvre une session prépayée VERROUILLÉE sur une enclave (clés vérifiées on-chain) et émet sa clé d'accès aek_",
  usage: "session open --product <id> --enclave <url> --deposit <usdc> [--operator <adresse>] [--cap <usdc>] [--expires 24h]",
  description: [
    "v2 : une session ne paie que les reçus de l'enclave choisie à l'ouverture. Les clés de --enclave sont confrontées",
    "à la chaîne AVANT tout (clé X25519 inscrite, enclave active pour le produit) ; l'opérateur en est déduit (--operator",
    "doit être le même s'il est donné). Prix, modèle et unité du produit sont verrouillés à l'ouverture.",
    "La clé de session naît sur cette machine ; seule son adresse publique est inscrite on-chain.",
    "La clé d'accès aek_… est écrite UNE fois sur la sortie standard (rien d'autre n'y est écrit) :",
    "conservez-la comme un secret. Elle ne peut pas dépenser plus que le dépôt (ou le plafond).",
  ],
  options: [
    { name: "product", value: "<id>", desc: "produit réglé par SessionPay (ex. l'inférence)", required: true },
    { name: "enclave", value: "<url>", desc: "URL de l'enclave qui servira la session (ses clés sont vérifiées on-chain)", required: true },
    { name: "deposit", value: "<usdc>", desc: "dépôt en USDC", required: true },
    { name: "operator", value: "<adresse>", desc: "contrôle : l'opérateur attendu de cette enclave" },
    { name: "cap", value: "<usdc>", desc: "plafond de dépense (défaut : le dépôt)" },
    { name: "expires", value: "<durée>", desc: "échéance de la session (défaut 24h ; entre 12 min et 30 j)" },
  ],
  write: true,
  examples: [
    "arcvault session open --product 1 --enclave https://…-8802.dstack-pha1-prod9.phala.network --deposit 2 > ma-cle.txt",
    "arcvault session open --product 1 --enclave https://…-8802.dstack-pha1-prod9.phala.network --deposit 2 --dry-run",
  ],
  async run(ctx) {
    const productId = parseId(req(ctx, "product"), "--product");
    const enclaveUrl = req(ctx, "enclave").replace(/\/$/, "");
    const operator = opt(ctx, "operator") !== undefined ? parseAddr(req(ctx, "operator"), "--operator") : undefined;
    const deposit = parseUsdc(req(ctx, "deposit"), "--deposit");
    const cap = opt(ctx, "cap") !== undefined ? parseUsdc(req(ctx, "cap"), "--cap") : 0n;
    const expiresIn = parseDurationS(opt(ctx, "expires") ?? "24h", "--expires");
    if (deposit === 0n) throw new CliError("--deposit doit être > 0");

    const w = await writer(ctx);
    const p = await w.arc.getProduct(productId);
    if (p.state !== "Active") throw new CliError(`produit #${productId} non actif (${stateFr(p.state)})`);
    if (!sameAddr(p.settlement, testnet.sessionPay)) {
      throw new CliError(`le produit #${productId} se règle par ${contractName(p.settlement)}, pas par SessionPay : pas de session prépayée`);
    }
    if (p.price === 0n) throw new CliError(`le produit #${productId} est au prix 0 : SessionPay n'ouvre pas de session (ZeroPrice)`);
    const bal = await w.arc.usdcBalance(w.account.address);
    if (bal < deposit) throw new CliError(`solde USDC insuffisant : ${usdc(bal)} < ${usdc(deposit)}`);
    const keys = await verifiedEnclave(w.pub, enclaveUrl, productId);
    if (operator && !sameAddr(operator, keys.operator)) {
      throw new CliError(`l'enclave ${keys.signer} est active pour l'opérateur ${keys.operator}, pas pour ${operator}`);
    }
    info(`enclave vérifiée on-chain : ${keys.signer} (opérateur ${keys.operator}, clé X25519 inscrite, active au bloc ${keys.checkedAtBlock})`);
    info(`session : produit #${productId} (${usdc(p.price)}/unité verrouillé, unité ${p.unitTokens} jeton(s), sortie ×${p.outWeight}), dépôt ${usdc(deposit)}${cap ? `, plafond ${usdc(cap)}` : ""}, échéance dans ${dur(expiresIn)}`);
    const r = await w.arc.openSession({ productId, enclave: keys.signer, operator: keys.operator, deposit, cap, expiresInSeconds: expiresIn });
    if (w.dryRun) return info("[simulation] aucune clé d'accès émise : elle ne vaut qu'après la transaction réelle");

    let sessionId = r.sessionId; // résultat simulé ; remplacé par l'événement SessionOpened
    try {
      const rcpt = await confirm(w, "openSession", r.tx);
      const ev = rcpt && parseEventLogs({ abi: sessionPayAbi, logs: rcpt.logs, eventName: "SessionOpened" })[0];
      if (ev) sessionId = ev.args.sessionId;
    } catch (e) {
      if (e instanceof RevertedOnChain) throw e; // rien d'ouvert : la clé ne vaut rien
      info(`confirmation impossible ; la clé ci-dessous suppose la session #${sessionId} (vérifiez avec : arcvault session status ${sessionId})`);
      out(encodeAek(NET_TAG, sessionId, r.sessionKey.privateKey));
      throw e;
    }
    info(`session #${sessionId} ouverte, verrouillée sur l'enclave ${r.enclave}. Clé d'accès (écrite une seule fois sur la sortie standard, à garder secrète) :`);
    out(encodeAek(NET_TAG, sessionId, r.sessionKey.privateKey));
    info(`→ ARC_AEK=<clé> arcvault proxy --enclave ${enclaveUrl}`);
  },
};

const list: Command = {
  path: ["session", "list"],
  summary: "liste les sessions d'un propriétaire",
  usage: "session list [--owner <adresse>]",
  options: [{ name: "owner", value: "<adresse>", desc: "propriétaire (défaut : l'adresse de PRIVATE_KEY)" }],
  examples: ["arcvault session list --owner 0x5724d89D610c3017b8DC161c025248341556f6Ab"],
  async run(ctx) {
    const o = opt(ctx, "owner");
    const owner = o ? parseAddr(o, "--owner") : walletAddressIfAny();
    if (!owner) throw new CliError("--owner <adresse> requis (ou PRIVATE_KEY définie)");
    const { arc } = reader(ctx.rpc);
    const rows = await arc.listMySessions(owner as Address);
    if (!rows.length) return out(`aucune session pour ${owner}`);
    for (const s of rows) {
      out(`#${s.id}  ${s.closed ? "close  " : "ouverte"}  produit #${s.productId}  enclave ${s.enclave}  dépôt ${usdc(s.deposit)}  réglé ${usdc(s.paid)}  (${usdc(s.price)}/unité)`);
    }
  },
};

const status: Command = {
  path: ["session", "status"],
  summary: "état d'une session : enclave verrouillée, dépôt, réglé, disponible, clé en cours, échéance, clôture",
  usage: "session status <id>",
  args: [{ name: "id", desc: "identifiant de la session" }],
  examples: ["arcvault session status 12"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const { arc } = reader(ctx.rpc);
    const s = await loadSession(arc, id);
    const ceiling = sessionCeiling(s);
    const left = ceiling > s.paid ? ceiling - s.paid : 0n;
    const c = await arc.sessionClosability(id);
    out(`session #${id}  ${s.closed ? "close" : Number(s.expiresAt) < nowS() ? "échue (non close)" : "ouverte"}`);
    out(`  propriétaire     ${s.owner}`);
    out(`  produit          #${s.productId} — verrouillé à l'ouverture : ${usdc(s.price)}/unité, unité ${s.unitTokens} jeton(s), sortie ×${s.outWeight}, modèle ${s.param}`);
    out(`  enclave          ${s.enclave} (seuls ses reçus paient cette session)`);
    out(`  opérateur        ${s.operator}`);
    out(`  clé de session   ${s.sessionKey} (adresse publique de la clé en cours ; l'enclave ne sert qu'elle)`);
    out(`  dépôt            ${usdc(s.deposit)}${s.cap === 0n ? "" : `  plafond ${usdc(s.cap)}`}`);
    out(`  réglé            ${usdc(s.paid)} (${s.paidUnits} unités)`);
    if (s.closed) out(`  remboursé        ${usdc(s.deposit - s.paid)} au propriétaire à la clôture`);
    else out(`  disponible       ${usdc(left)}${s.price > 0n ? ` (≈ ${left / s.price} unités)` : ""}`);
    out(`  échéance         ${fmtTime(s.expiresAt)}`);
    if (!s.closed) {
      out(`  clôture          ${c.closableNow ? "possible maintenant" : `possible ${fmtTime(c.atTime)} (échéance + 1 h), ou dès le bloc ${c.afterBlock + 1n} si l'enclave ne peut plus rien régler (tête ${c.head})`}`);
    }
    out(`  verdict ERC-8004 ${s.verdictWritten ? "écrit" : "pas encore"}`);
  },
};

const topup: Command = {
  path: ["session", "topup"],
  summary: "recharge une session (EIP-3009, un seul appel)",
  usage: "session topup <id> --amount <usdc>",
  args: [{ name: "id", desc: "identifiant de la session" }],
  options: [{ name: "amount", value: "<usdc>", desc: "montant à ajouter au dépôt", required: true }],
  write: true,
  examples: ["arcvault session topup 12 --amount 5"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const amount = parseUsdc(req(ctx, "amount"), "--amount");
    if (amount === 0n) throw new CliError("--amount doit être > 0");
    const w = await writer(ctx);
    const s = await loadSession(w.arc, id);
    if (s.closed) throw new CliError(`session #${id} close : recharge impossible`);
    if (!sameAddr(s.owner, w.account.address)) warn(`vous rechargez la session d'un autre propriétaire (${s.owner})`);
    const bal = await w.arc.usdcBalance(w.account.address);
    if (bal < amount) throw new CliError(`solde USDC insuffisant : ${usdc(bal)} < ${usdc(amount)}`);
    const hash = await w.arc.topUp(id, amount);
    await confirm(w, "topUp", hash);
    out(`${w.dryRun ? "[simulation] " : ""}session #${id} rechargée de ${usdc(amount)} (dépôt ${usdc(s.deposit + amount)})`);
  },
};

const close: Command = {
  path: ["session", "close"],
  summary: "ferme une session échue : rembourse le reste au propriétaire, écrit le verdict ERC-8004",
  usage: "session close <id>",
  description: [
    "Possible à partir de l'échéance + 1 h (délai laissé à l'opérateur pour son dernier règlement), ou plus tôt dès que",
    "l'enclave liée ne peut plus rien régler (fenêtre et grâce écoulées, ou invalidée). Le verdict ERC-8004 exige son gaz :",
    "la transaction part avec une marge sur l'estimation.",
  ],
  args: [{ name: "id", desc: "identifiant de la session" }],
  write: true,
  examples: ["arcvault session close 12"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const w = await writer(ctx);
    const s = await loadSession(w.arc, id);
    if (!sameAddr(s.owner, w.account.address)) throw new CliError(`seul le propriétaire (${s.owner}) peut fermer la session #${id}`);
    if (s.closed) throw new CliError(`session #${id} déjà close`);
    const c = await w.arc.sessionClosability(id);
    if (!c.closableNow) {
      throw new CliError(`trop tôt : clôture possible ${fmtTime(c.atTime)} (échéance + 1 h), ou dès le bloc ${c.afterBlock + 1n} (tête ${c.head})`);
    }
    const hash = await w.arc.closeSession(id);
    const rcpt = await confirm(w, "closeSession", hash);
    const ev = rcpt && parseEventLogs({ abi: sessionExtraAbi, logs: rcpt.logs, eventName: "SessionClosed" })[0];
    const refund: bigint = ev ? ev.args.refund : s.deposit - s.paid;
    out(`${w.dryRun ? "[simulation] " : ""}session #${id} close ; remboursement ${usdc(refund)} à ${s.owner}`);
  },
};

const rotate: Command = {
  path: ["session", "rotate"],
  summary: "tourne la clé de session : nouvelle clé aek_ créée ici, l'ancienne est révoquée on-chain",
  usage: "session rotate <id>",
  description: [
    "Génère localement une nouvelle clé, inscrit son adresse (rotateKey), puis écrit la nouvelle clé aek_",
    "UNE fois sur la sortie standard (seule chose écrite sur stdout ; rien n'est journalisé ailleurs).",
    "L'enclave lit la clé en cours on-chain à chaque requête : l'ancienne cesse d'être servie.",
  ],
  args: [{ name: "id", desc: "identifiant de la session" }],
  write: true,
  examples: ["arcvault session rotate 12 > nouvelle-cle.txt"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const w = await writer(ctx);
    const s = await loadSession(w.arc, id);
    if (!sameAddr(s.owner, w.account.address)) throw new CliError(`seul le propriétaire (${s.owner}) peut tourner la clé de la session #${id}`);
    if (s.closed) throw new CliError(`session #${id} close`);
    const k = generateSessionKey();
    const hash = await w.arc.rotateKey(id, k.address as Address);
    if (w.dryRun) return info("[simulation] aucune nouvelle clé émise");
    info(`rotation envoyée (${hash}). Nouvelle clé d'accès, écrite une seule fois :`);
    out(encodeAek(NET_TAG, id, k.privateKey)); // dès l'envoi : ne jamais perdre une clé déjà inscrite
    try {
      await confirm(w, "rotateKey", hash);
    } catch (e) {
      info(e instanceof RevertedOnChain
        ? "ÉCHEC : la clé ci-dessus n'est PAS active ; l'ancienne clé reste celle de la session."
        : `confirmation impossible : vérifiez « arcvault session status ${id} » (clé en cours = ${k.address} si la rotation est passée)`);
      throw e;
    }
    info(`clé en cours : ${k.address} ; l'ancienne (${s.sessionKey}) est révoquée.`);
  },
};

export const sessionCommands: Command[] = [open, list, status, topup, close, rotate];
export const SESSION_TITLE = "sessions prépayées (SessionPay) et clés d'accès aek_ : ouvrir, suivre, recharger, fermer, tourner la clé";
