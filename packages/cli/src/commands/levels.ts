/** levels — les DEUX NIVEAUX d'opérateur (10/11/2026) dans la CLI :
 *   - opérateur : voir son niveau, lier son enclave à sa machine (PPID du certificat d'Intel), faire déclarer sa machine par
 *     l'alliance Proof of Cloud (jeton cosigné, vérifié on-chain par ProofOfCloudAuditor) ;
 *   - auteur de produit : fixer la politique (niveau minimum, vérificateurs acceptés ; timelock du ProductRegistry) ;
 *   - vérificateur (n'importe qui) : déclarer ou retirer une machine en son nom. */
import type { Address, Hex } from "viem";
import {
  LEVEL_VERIFIED, PROOF_OF_CLOUD, describeLevel, findCurrentQuote, machineRegistryAbi, proofOfCloudAuditorAbi, quoteFromRegisterTx,
  readMachine, readPolicy, testnet,
} from "@arcvault/sdk";
import { CliError, type Command, UsageError, check, flag, fmtTime, info, opt, out, parseAddr, parseId, req } from "../cli";
import { confirm, reader, writeCall, writer } from "../chain";

export const LEVELS_TITLE = "niveaux d'opérateur : ouvert (attestation + caution) ou vérifié (machine en datacenter déclarée)";
export const AUDITOR_TITLE = "vérificateur : déclarer des machines (PPID) en datacenter connu, en son propre nom";

const L = () => {
  if (!testnet.levels) throw new CliError("ce déploiement n'a pas les niveaux d'opérateur");
  return testnet.levels;
};
const ppidOf = (v: string): Hex => {
  const h = v.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{32}$/.test(h)) throw new UsageError("--ppid : 16 octets hexadécimaux attendus (32 caractères)");
  return `0x${h}` as Hex;
};

const level: Command = {
  path: ["operator", "level"],
  summary: "niveau d'une enclave : machine liée, déclaration de l'alliance Proof of Cloud, politique d'un produit",
  usage: "operator level --signer <adresse> [--product <id>]",
  description: [
    "Niveau « ouvert » : l'enclave est attestée par Intel, vérifiée par le registre, l'opérateur a une caution.",
    "Niveau « vérifié » : en plus, sa machine (PPID lu dans le certificat d'Intel du quote) est déclarée en datacenter",
    `connu par un vérificateur que le produit accepte (référence : l'alliance Proof of Cloud, ${PROOF_OF_CLOUD.source}).`,
  ],
  options: [
    { name: "signer", value: "<adresse>", desc: "clé de l'enclave (champ signer de /pubkeys)" },
    { name: "product", value: "<id>", desc: "montre aussi la politique de ce produit et si l'enclave la remplit" },
  ],
  examples: ["arcvault operator level --signer 0x58a1… --product 2"],
  async run(ctx) {
    const signer = parseAddr(req(ctx, "signer"), "--signer");
    const productId = opt(ctx, "product") !== undefined ? parseId(opt(ctx, "product"), "--product") : undefined;
    const { pub } = reader(ctx.rpc);
    const r = await describeLevel(pub as any, testnet, signer, productId);
    out(`Enclave ${signer}`);
    out(`  ${check(!!r.machine.ppid)} machine : ${r.machine.ppid ?? "non liée (arcvault operator bind-machine)"}${r.machine.ppid ? (r.machine.current ? " (liaison à jour)" : " (liaison PÉRIMÉE : réinscrite depuis, à relier)") : ""}`);
    if (r.proofOfCloud) {
      out(`  ${check(!r.proofOfCloud.revoked && r.proofOfCloud.expiresAt * 1000 > Date.now())} alliance Proof of Cloud : déclarée jusqu'au ${fmtTime(r.proofOfCloud.expiresAt)} (jeton du ${fmtTime(r.proofOfCloud.lastTokenAt)})${r.proofOfCloud.revoked ? ", RETIRÉE" : ""}`);
    } else out(`  ${check(false)} alliance Proof of Cloud : aucune déclaration (arcvault operator proof-of-cloud)`);
    out(`  → ${r.verifiedByProofOfCloud ? "VÉRIFIÉE (machine déclarée par l'alliance Proof of Cloud, vérifiée on-chain)" : "niveau OUVERT"}`);
    if (r.product) {
      out(`Produit #${r.product.productId} : exige le niveau ${r.product.required === LEVEL_VERIFIED ? "vérifié" : "ouvert"} — ${r.product.meets ? `rempli${r.product.verifiedBy ? ` (vérificateur ${r.product.verifiedBy})` : ""}` : "NON rempli : ses contrats de règlement ignorent cette enclave"}`);
    }
  },
};

const bind: Command = {
  path: ["operator", "bind-machine"],
  summary: "lie l'enclave à sa machine (PPID du certificat d'Intel), d'après le quote de son inscription en cours",
  usage: "operator bind-machine --signer <adresse> [--tx <hash de registerEnclave>]",
  write: true,
  description: [
    "À refaire après chaque (ré)inscription : le registrar d'ArcHive le fait seul. Le quote est celui que le registre a",
    "vérifié par DCAP (keccak256 = Enclave.quoteHash) ; il est lu dans la transaction donnée, sinon dans les événements.",
  ],
  options: [
    { name: "signer", value: "<adresse>", desc: "clé de l'enclave" },
    { name: "tx", value: "<hash>", desc: "transaction registerEnclave de l'inscription en cours (sinon : recherche)" },
  ],
  examples: ["arcvault operator bind-machine --signer 0x58a1…"],
  async run(ctx) {
    const signer = parseAddr(req(ctx, "signer"), "--signer");
    const w = await writer(ctx);
    const tx = opt(ctx, "tx");
    info("recherche du quote de l'inscription en cours…");
    const quote = tx ? await quoteFromRegisterTx(w.pub as any, tx as Hex) : await findCurrentQuote(w.pub as any, testnet, signer);
    const h = await writeCall(w, L().machineRegistry, machineRegistryAbi, "bindMachine", [signer, quote]);
    await confirm(w, "bindMachine", h);
    if (!w.dryRun) out(`machine liée : ${(await readMachine(w.pub as any, testnet, signer)).ppid}`);
  },
};

const proofOfCloud: Command = {
  path: ["operator", "proof-of-cloud"],
  summary: "fait déclarer la machine par l'alliance Proof of Cloud (jeton cosigné, vérifié on-chain)",
  usage: "operator proof-of-cloud --signer <adresse>",
  write: true,
  description: [
    "Demande un jeton aux trois serveurs de confiance de l'alliance (Secret, Nillion, iExec) pour le quote de l'inscription",
    "en cours ; ils ne le délivrent que si la machine est sur leur liste (inspection physique en datacenter) et non",
    "révoquée. Le jeton est vérifié ici, puis soumis à ProofOfCloudAuditor, qui le revérifie on-chain (EdDSA) et déclare",
    "la machine 7 jours. Votre machine n'est pas sur la liste : voyez proofofcloud.org (cérémonie d'inspection).",
  ],
  options: [{ name: "signer", value: "<adresse>", desc: "clé d'une enclave de la machine" }],
  examples: ["arcvault operator proof-of-cloud --signer 0x58a1…"],
  async run(ctx) {
    const signer = parseAddr(req(ctx, "signer"), "--signer");
    const w = await writer(ctx);
    const quote = await findCurrentQuote(w.pub as any, testnet, signer);
    // module Node seulement (chemin relatif : non exporté par l'index du SDK)
    const { requestAllianceToken } = await import("../../../sdk/src/proof-of-cloud");
    info("jeton de l'alliance Proof of Cloud (trois serveurs)…");
    const t = await requestAllianceToken(quote, { log: info });
    info(`jeton cosigné vérifié : machine ${t.machineId}, ${fmtTime(t.timestamp)}`);
    const h = await writeCall(w, L().proofOfCloudAuditor, proofOfCloudAuditorAbi, "submit", [t.header, t.payload, t.signature]);
    await confirm(w, "ProofOfCloudAuditor.submit", h);
  },
};

const policy: Command = {
  path: ["product", "policy"],
  summary: "politique de niveau d'un produit : lire, proposer (auteur), appliquer après le timelock",
  usage: "product policy --product <id> [--level 0|1 --auditors <a,b,…>] [--apply]",
  write: true,
  description: [
    "Sans option : affiche la politique en vigueur et celle en attente. --level/--auditors : l'AUTEUR du produit propose",
    "(niveau 1 : au moins un vérificateur ; référence : ProofOfCloudAuditor). --apply : applique après le timelock.",
    "Les contrats de règlement branchés sur PolicyEnclaves l'appliquent ; le prix reste libre (aucun péage).",
  ],
  options: [
    { name: "product", value: "<id>", desc: "identifiant du produit" },
    { name: "level", value: "0|1", desc: "niveau minimum : 0 ouvert, 1 vérifié" },
    { name: "auditors", value: "<a,b,…>", desc: "vérificateurs acceptés (adresses, séparées par des virgules) ; « proof-of-cloud » = l'alliance" },
    { name: "apply", desc: "applique la politique en attente (timelock écoulé)" },
  ],
  examples: ["arcvault product policy --product 6 --level 1 --auditors proof-of-cloud", "arcvault product policy --product 6 --apply"],
  async run(ctx) {
    const productId = parseId(req(ctx, "product"), "--product");
    const lvl = opt(ctx, "level");
    if (lvl !== undefined || flag(ctx, "apply")) {
      const w = await writer(ctx);
      if (lvl !== undefined) {
        if (lvl !== "0" && lvl !== "1") throw new UsageError("--level : 0 ou 1");
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
    out(`Produit #${productId} : niveau ${p.minLevel === LEVEL_VERIFIED ? "VÉRIFIÉ" : "ouvert"}${p.auditors.length ? `, vérificateurs : ${p.auditors.map(name).join(", ")}` : ""}`);
    if (p.pending) out(`  en attente : niveau ${p.pending.minLevel}, ${p.pending.auditors.map(name).join(", ") || "aucun vérificateur"}, applicable le ${fmtTime(p.pending.applyAt)}`);
  },
};

const attest: Command = {
  path: ["auditor", "attest"],
  summary: "déclare, en votre nom, une machine (PPID) en datacenter connu jusqu'à une date",
  usage: "auditor attest --ppid <32 hex> --days <n> --site <texte> [--evidence <url ou hash>]",
  write: true,
  description: [
    "N'importe qui peut être vérificateur : votre adresse est votre identité, et seuls les produits qui vous acceptent",
    "(politique de l'auteur) tiennent compte de vos déclarations. Le PPID d'une enclave : arcvault operator level.",
  ],
  options: [
    { name: "ppid", value: "<32 hex>", desc: "PPID de la machine (certificat PCK d'Intel)" },
    { name: "days", value: "<n>", desc: "durée de la déclaration, en jours" },
    { name: "site", value: "<texte>", desc: "lieu (datacenter, ville)" },
    { name: "evidence", value: "<url|hash>", desc: "preuve : rapport d'inspection, photo, contrat…" },
  ],
  examples: ['arcvault auditor attest --ppid 62d54040cb9dfc08bb13006fa75ece56 --days 30 --site "OVH Roubaix" --evidence https://…'],
  async run(ctx) {
    const ppid = ppidOf(req(ctx, "ppid"));
    const days = Number(req(ctx, "days"));
    if (!Number.isFinite(days) || days <= 0 || days > 400) throw new UsageError("--days : entre 1 et 400");
    const until = BigInt(Math.floor(Date.now() / 1000 + days * 86_400));
    const w = await writer(ctx);
    const h = await writeCall(w, L().machineRegistry, machineRegistryAbi, "attestMachine", [ppid, until, req(ctx, "site"), opt(ctx, "evidence") ?? ""]);
    await confirm(w, "attestMachine", h);
  },
};

const revoke: Command = {
  path: ["auditor", "revoke"],
  summary: "retire, tout de suite, votre déclaration sur une machine",
  usage: "auditor revoke --ppid <32 hex> --reason <texte>",
  write: true,
  options: [
    { name: "ppid", value: "<32 hex>", desc: "PPID de la machine" },
    { name: "reason", value: "<texte>", desc: "raison (publique, dans l'événement)" },
  ],
  examples: ['arcvault auditor revoke --ppid 62d54040cb9dfc08bb13006fa75ece56 --reason "machine déplacée"'],
  async run(ctx) {
    const w = await writer(ctx);
    const h = await writeCall(w, L().machineRegistry, machineRegistryAbi, "revokeMachine", [ppidOf(req(ctx, "ppid")), req(ctx, "reason")]);
    await confirm(w, "revokeMachine", h);
  },
};

export const levelOperatorCommands: Command[] = [level, bind, proofOfCloud];
export const levelProductCommands: Command[] = [policy];
export const auditorCommands: Command[] = [attest, revoke];
