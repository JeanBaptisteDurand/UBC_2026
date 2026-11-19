/** operator — devenir fournisseur d'enclave (PLAN-BUILD §4.5) : identité ERC-8004, caution, inscription
 *  et réattestation d'enclave, règlement des reçus, état. */
import { encodeFunctionData, parseEventLogs, toFunctionSelector, type AbiFunction, type Address, type Hex } from "viem";
import {
  enclaveRegistryAbi, operatorBondAbi, sealedBountyAbi, sessionPayAbi, testnet, usdcAbi, x402Abi, type Receipt,
} from "@arcvault/sdk";
import {
  CliError, type Command, UsageError, check, fmtTime, info, nowS, opt, out, parseAddr, parseId, parseUsdc, readJson, req,
  usdc, warn,
} from "../cli";
import {
  ERC8004_IDENTITY_TESTNET, ZERO, bondExtraAbi, confirm, enclaveGraceBlocks, enclavePubkeys, explainError, identityAbi,
  reader, sameAddr, sessionExtraAbi, walletAddressIfAny, writeCall, writer, type Pub,
} from "../chain";
import { normalizeReceipt, stateFr } from "./read";

const readBond = (pub: Pub, fn: string, args: unknown[]) =>
  pub.readContract({ address: testnet.operatorBond, abi: [...operatorBondAbi, ...bondExtraAbi] as any, functionName: fn, args } as any);

const init: Command = {
  path: ["operator", "init"],
  summary: "prépare l'identité ERC-8004 de l'opérateur et l'approbation de VerdictLog (transactions à signer)",
  usage: "operator init [--uri <agentURI>] [--agent-id <n>] [--address <adresse>]",
  description: [
    "N'envoie rien : affiche les étapes, avec destinataire et calldata de chaque transaction à signer dans votre",
    "portefeuille, et l'état actuel de l'adresse (lectures). Registre d'identité ERC-8004 d'Arc testnet :",
    `${ERC8004_IDENTITY_TESTNET} (VERIFIED, SPEC-TECH §0 ; contracts/src/interfaces/IERC8004.sol).`,
  ],
  options: [
    { name: "uri", value: "<agentURI>", desc: "URI de la fiche d'agent ERC-8004 de l'opérateur (pour la calldata de register)" },
    { name: "agent-id", value: "<n>", desc: "agentId obtenu à l'étape 1 (pour la calldata de setAgentId)" },
    { name: "address", value: "<adresse>", desc: "adresse dont afficher l'état (défaut : celle de PRIVATE_KEY)" },
  ],
  examples: ["arcvault operator init --uri https://exemple.org/agent.json", "arcvault operator init --agent-id 42"],
  async run(ctx) {
    const uri = opt(ctx, "uri");
    const agentId = opt(ctx, "agent-id") !== undefined ? parseId(opt(ctx, "agent-id"), "--agent-id") : undefined;
    const a = opt(ctx, "address");
    const op = a ? parseAddr(a, "--address") : walletAddressIfAny();
    const tx = (to: Address, sig: string, data: Hex | undefined, missing?: string) => {
      out(`     à        ${to}`);
      out(`     fonction ${sig}`);
      out(`     calldata ${data ?? `(relancez avec ${missing} pour la générer)`}`);
    };
    out("Devenir opérateur — étapes (rien n'est envoyé par cette commande) :");
    out("  1. Créer l'identité ERC-8004 de l'opérateur (jeton d'agent ; l'agentId est dans l'événement Transfer du reçu)");
    tx(ERC8004_IDENTITY_TESTNET, `register("${uri ?? "<agentURI>"}")`, uri ? encodeFunctionData({ abi: identityAbi, functionName: "register", args: [uri] }) : undefined, "--uri <agentURI>");
    out("  2. Lier cet agentId à la caution (les verdicts ERC-8004 de vos enclaves lui sont attribués)");
    tx(testnet.operatorBond, `setAgentId(${agentId ?? "<agentId>"})`, agentId !== undefined ? encodeFunctionData({ abi: operatorBondAbi, functionName: "setAgentId", args: [agentId] }) : undefined, "--agent-id <n>");
    out("  3. Autoriser VerdictLog à demander les validations au nom de votre identité");
    out("     (l'approbation suffit : c'est ainsi que VerdictLog écrit sur Arc testnet les verdicts de l'agent 897812)");
    tx(ERC8004_IDENTITY_TESTNET, `setApprovalForAll(${testnet.verdictLog}, true)`, encodeFunctionData({ abi: identityAbi, functionName: "setApprovalForAll", args: [testnet.verdictLog, true] }));
    out("  4. Déposer la caution (au moins la caution minimale du produit servi) : arcvault operator bond --amount <usdc>");
    out("  5. Déployer la VM TDX du produit, puis inscrire l'enclave : arcvault operator register --vm <url> --product <id>");
    if (!op) return info("(--address ou PRIVATE_KEY pour afficher l'état de l'adresse)");
    const { pub } = reader(ctx.rpc);
    const tryRead = async (f: () => Promise<unknown>) => {
      try {
        return await f();
      } catch {
        return undefined;
      }
    };
    const ids = (await tryRead(() => pub.readContract({ address: ERC8004_IDENTITY_TESTNET, abi: identityAbi, functionName: "balanceOf", args: [op] }))) as bigint | undefined;
    const linked = (await readBond(pub, "agentIdOf", [op])) as bigint;
    const approved = (await tryRead(() => pub.readContract({ address: ERC8004_IDENTITY_TESTNET, abi: identityAbi, functionName: "isApprovedForAll", args: [op, testnet.verdictLog] }))) as boolean | undefined;
    const bond = (await readBond(pub, "bondOf", [op])) as bigint;
    out("");
    out(`État de ${op} :`);
    out(`  ${ids === undefined ? "?" : check(ids > 0n)} 1. identité ERC-8004 : ${ids === undefined ? "lecture impossible" : `${ids} jeton(s) d'agent`}`);
    out(`  ${check(linked > 0n)} 2. agentId lié à la caution : ${linked > 0n ? linked : "aucun"}`);
    out(`  ${approved === undefined ? "?" : check(approved)} 3. VerdictLog approuvé : ${approved === undefined ? "lecture impossible" : approved ? "oui" : "non"}`);
    out(`  ${check(bond > 0n)} 4. caution : ${usdc(bond)}`);
  },
};

const bond: Command = {
  path: ["operator", "bond"],
  summary: "dépose la caution en USDC (EIP-3009 en un appel, ou approve + bondFrom)",
  usage: "operator bond --amount <usdc> [--mode auth|allowance]",
  description: [
    "La caution borne ce qu'une seule de vos enclaves peut faire payer sur 24 h (la moitié de la caution",
    "disponible) et est saisie entière en cas d'équivocation prouvée. Retrait : 7 jours après la demande.",
  ],
  options: [
    { name: "amount", value: "<usdc>", desc: "montant à déposer", required: true },
    { name: "mode", value: "<auth|allowance>", desc: "auth : autorisation EIP-3009, une transaction (défaut) ; allowance : approve puis bondFrom" },
  ],
  write: true,
  examples: ["arcvault operator bond --amount 100"],
  async run(ctx) {
    const amount = parseUsdc(req(ctx, "amount"), "--amount");
    if (amount === 0n) throw new CliError("--amount doit être > 0");
    const mode = opt(ctx, "mode") ?? "auth";
    if (mode !== "auth" && mode !== "allowance") throw new UsageError("--mode : auth ou allowance", ctx.cmd);
    const w = await writer(ctx);
    const me = w.account.address;
    if ((await readBond(w.pub, "banned", [me])) as boolean) throw new CliError("adresse bannie (saisie pour équivocation) : caution refusée");
    const bal = await w.arc.usdcBalance(me);
    if (bal < amount) throw new CliError(`solde USDC insuffisant : ${usdc(bal)} < ${usdc(amount)}`);
    if (mode === "allowance") {
      await confirm(w, "approve", await writeCall(w, testnet.usdc, usdcAbi, "approve", [testnet.operatorBond, amount]));
      if (w.dryRun) return info("[simulation] bondFrom ne se simule qu'après une approbation réelle");
      await confirm(w, "bondFrom", await writeCall(w, testnet.operatorBond, operatorBondAbi, "bondFrom", [amount]));
    } else {
      await confirm(w, "bond", await w.arc.bond(amount, "auth"));
    }
    if (w.dryRun) return out(`[simulation] caution de ${usdc(amount)} acceptée`);
    out(`caution déposée : ${usdc(amount)} — total ${usdc(await w.arc.bondOf(me))}, disponible ${usdc(await w.arc.availableBond(me))}`);
  },
};

/** Inscription (ou réattestation) : /attest sur la VM, contrôle du quote hors chaîne, puis registerEnclave (SDK) ; la
 *  chaîne vérifie la signature d'Intel par DCAP (≈ 5,7 M gas). */
async function registerFlow(ctx: Parameters<Command["run"]>[0], vm: string, productIdOpt: bigint | undefined, renew: boolean) {
  const w = await writer(ctx);
  const me = w.account.address;
  const pk = await enclavePubkeys(vm); // sans confiance : la chaîne vérifie le quote, qui lie ces clés
  const e = await w.arc.getEnclave(pk.signer);
  const mine = sameAddr(e.operator, me);
  const readReg = (fn: string) => w.pub.readContract({ address: testnet.enclaveRegistry, abi: enclaveRegistryAbi, functionName: fn as any, args: [pk.signer] } as any);
  const [boundOp, boundPid, killed] = (await Promise.all([readReg("boundOperator"), readReg("boundProduct"), readReg("killed")])) as [string, bigint, boolean];
  if (killed) throw new CliError(`la clé ${pk.signer} a été invalidée sans grâce (image retirée) : elle ne se réinscrit plus (EnclaveKilled) ; redémarrez l'enclave (nouvelles clés)`);
  if (e.operator !== ZERO && !mine) {
    throw new CliError(`l'enclave ${pk.signer} est inscrite par un autre opérateur (${e.operator}) : refus de se l'approprier`);
  }
  if (boundOp !== ZERO && !sameAddr(boundOp, me)) throw new CliError(`la clé ${pk.signer} est liée à vie à l'opérateur ${boundOp} (SignerBoundElsewhere)`);
  if (renew && e.operator === ZERO) throw new CliError(`l'enclave ${pk.signer} n'est pas inscrite : arcvault operator register --vm ${vm} --product <id>`);
  const productId = productIdOpt ?? (BigInt(e.productId) as bigint);
  if (boundOp !== ZERO && boundPid !== productId) throw new CliError(`la clé ${pk.signer} est liée à vie au produit #${boundPid}, pas au #${productId} (SignerBoundElsewhere)`);
  const head = await w.pub.getBlockNumber();
  if (!renew && mine && e.active && head <= BigInt(e.untilBlock)) {
    throw new CliError(`l'enclave ${pk.signer} est déjà inscrite par vous (fenêtre jusqu'au bloc ${e.untilBlock}, ≈ ${fmtTime(e.expiresAt)}) : arcvault operator renew --vm ${vm}`);
  }
  const p = await w.arc.getProduct(productId);
  if (p.state !== "Active") {
    throw new CliError(`produit #${productId} non actif (${stateFr(p.state)}${p.state === "Proposed" ? `, activable ${fmtTime(p.activatesAt)}` : ""})`);
  }
  const avail = await w.arc.availableBond(me);
  if (avail < p.minBond) {
    throw new CliError(`caution disponible ${usdc(avail)} < caution minimale du produit #${productId} (${usdc(p.minBond)}) : arcvault operator bond --amount …`);
  }
  if (e.operator === ZERO) {
    const free = await w.arc.freeBond(me);
    if (free < p.minBond) {
      throw new CliError(`caution libre ${usdc(free)} < ${usdc(p.minBond)} : chaque clé inscrite réserve la caution minimale de son produit ; retirez une ancienne clé (elle libère sa réserve) ou augmentez la caution`);
    }
  }
  if (renew) info(`réattestation de ${pk.signer} (fenêtre jusqu'au bloc ${e.untilBlock}) : sans trou, la fenêtre est prolongée et les reçus déjà émis restent réglables`);
  info(`${renew ? "réattestation" : "inscription"} : POST ${vm.replace(/\/$/, "")}/attest (quote lié à ${me}), contrôle du quote, puis registerEnclave sur le produit #${productId} (vérification DCAP on-chain, ≈ 5,7 M gas)`);
  const r = await w.arc.registerEnclave(productId, vm);
  info(`  quote contrôlé : image ${r.workloadId} autorisée, pas de DEBUG`);
  const rcpt = await confirm(w, "registerEnclave", r.tx);
  if (!rcpt) return out(`[simulation] l'enclave ${r.signer} serait ${renew ? "réattestée" : "inscrite"} pour le produit #${productId}`);
  const after = await w.arc.getEnclave(r.signer);
  out(`enclave ${r.signer} ${renew ? "réattestée" : "inscrite"} : produit #${productId}, opérateur ${me}, blocs ${after.fromBlock}→${after.untilBlock} (≈ ${fmtTime(after.expiresAt)})`);
}

const register: Command = {
  path: ["operator", "register"],
  summary: "inscrit une enclave : lit /attest sur la VM (quote + journal), choisit le bloc d'ancrage, registerEnclave",
  usage: "operator register --vm <url> --product <id>",
  description: [
    "Contrôles avant envoi : produit actif, caution disponible et libre ≥ caution minimale, clé pas liée ailleurs,",
    "quote réel (pas simulé), pas de DEBUG, SEPT_VE_DISABLE si exigé, image (workloadId) autorisée par le produit,",
    "REPORTDATA lié à votre adresse. Puis la chaîne vérifie la signature d'Intel par DCAP et la politique (P1–P12).",
  ],
  options: [
    { name: "vm", value: "<url>", desc: "URL de l'enclave (kit O1 : /pubkeys, /attest)", required: true },
    { name: "product", value: "<id>", desc: "produit servi par l'enclave", required: true },
  ],
  write: true,
  examples: ["arcvault operator register --vm https://…-8802.dstack-pha1-prod9.phala.network --product 1"],
  async run(ctx) {
    await registerFlow(ctx, req(ctx, "vm"), parseId(req(ctx, "product"), "--product"), false);
  },
};

const renew: Command = {
  path: ["operator", "renew"],
  summary: "réatteste une enclave déjà inscrite (toutes les 24 h) : nouveau quote, nouvelle échéance",
  usage: "operator renew --vm <url> [--product <id>]",
  description: [
    "Même chemin que register, pour une enclave inscrite par vous. Le service Registrar (O4) le fait aussi en tâche planifiée.",
    "v2 : renouvelée sans trou, la fenêtre de validité est PROLONGÉE ; les reçus ancrés avant restent réglables.",
  ],
  options: [
    { name: "vm", value: "<url>", desc: "URL de l'enclave", required: true },
    { name: "product", value: "<id>", desc: "produit (défaut : celui de l'inscription en cours)" },
  ],
  write: true,
  examples: ["arcvault operator renew --vm https://…-8802.dstack-pha1-prod9.phala.network"],
  async run(ctx) {
    const p = opt(ctx, "product");
    await registerFlow(ctx, req(ctx, "vm"), p !== undefined ? parseId(p, "--product") : undefined, true);
  },
};

const retire: Command = {
  path: ["operator", "retire"],
  summary: "retire une de vos enclaves : plus rien ne s'ancre après, sa réserve de caution est libérée",
  usage: "operator retire --signer <adresse>",
  description: [
    "v2 : chaque clé inscrite réserve la caution minimale de son produit. Une enclave redémarrée a de nouvelles clés :",
    "retirez l'ancienne pour libérer sa réserve. Les reçus et réclamations ancrés AVANT le retrait restent réglables",
    "pendant la grâce. Une clé retirée ne se réinscrit que chez le même opérateur et pour le même produit.",
  ],
  options: [{ name: "signer", value: "<adresse>", desc: "signataire de l'enclave à retirer", required: true }],
  write: true,
  examples: ["arcvault operator retire --signer 0x05a1F10043e8C24aA183BFf31f92FC791F66100B"],
  async run(ctx) {
    const signer = parseAddr(req(ctx, "signer"), "--signer");
    const w = await writer(ctx);
    const e = await w.arc.getEnclave(signer);
    if (e.signer === ZERO) throw new CliError(`aucune enclave inscrite pour ${signer}`);
    if (!sameAddr(e.operator, w.account.address)) throw new CliError(`l'enclave ${signer} appartient à l'opérateur ${e.operator}, pas à vous`);
    if (!e.active) throw new CliError(`l'enclave ${signer} est déjà retirée ou invalidée`);
    await confirm(w, "retire", await w.arc.retireEnclave(signer));
    if (w.dryRun) return out(`[simulation] l'enclave ${signer} serait retirée`);
    out(`enclave ${signer} retirée ; caution libre : ${usdc(await w.arc.freeBond(w.account.address))}`);
  },
};

const settle: Command = {
  path: ["operator", "settle"],
  summary: "règle les derniers reçus cumulatifs des sessions servies (une transaction par session)",
  usage: "operator settle --receipts <fichier.json>",
  description: [
    "Fichier : un objet ou une liste de { receipt, signature } (reçus signés par l'enclave). Pour chaque session,",
    "seul le reçu au plus grand cumul est réglé : il paie tout ce qui ne l'est pas encore, au prix VERROUILLÉ à",
    "l'ouverture. Chaque reçu est vérifié avant envoi comme le fera SessionPay.settle (enclave verrouillée de la",
    "session, active au bloc d'ancrage chez son opérateur, modèle verrouillé, cumul croissant).",
    "Le paiement va toujours à l'opérateur de la session ; n'importe qui peut payer le gas du règlement.",
  ],
  options: [{ name: "receipts", value: "<fichier>", desc: "reçus JSON", required: true }],
  write: true,
  examples: ["arcvault operator settle --receipts recus.json", "arcvault operator settle --receipts recus.json --dry-run"],
  async run(ctx) {
    const path = req(ctx, "receipts");
    const raw = readJson(path, "reçus") as any;
    const items: any[] = Array.isArray(raw) ? raw : [raw];
    if (!items.length) throw new CliError(`${path} : aucun reçu`);
    const latest = new Map<string, { receipt: Receipt; signature: Hex }>();
    for (const it of items) {
      const receipt = normalizeReceipt(it?.receipt ?? it);
      const signature = (it?.signature ?? it?.receipt?.signature) as Hex | undefined;
      if (!signature) throw new CliError(`${path} : reçu de la session #${receipt.sessionId} sans signature`);
      const k = receipt.sessionId.toString();
      const prev = latest.get(k);
      if (!prev || receipt.cumulativeUnits > prev.receipt.cumulativeUnits) latest.set(k, { receipt, signature });
    }
    const w = await writer(ctx);
    let total = 0n;
    let failures = 0;
    for (const { receipt: r, signature } of latest.values()) {
      const tag = `session #${r.sessionId}`;
      const v = await w.arc.verifyReceipt(r, signature);
      const bad = v.checks.filter((c) => !c.ok);
      if (bad.length) { info(`${tag} : ignorée — ${bad.map((c) => c.fr).join(" ; ")}`); continue; }
      const s = v.session!;
      if (!sameAddr(w.account.address, s.operator)) info(`${tag} : vous payez le gas, le paiement va à ${s.operator}`);
      try {
        const rcpt = await confirm(w, `settle ${tag}`, await w.arc.settle(r, signature));
        const ev = rcpt && parseEventLogs({ abi: sessionExtraAbi, logs: rcpt.logs, eventName: "Settled" })[0];
        const paid = ev ? ev.args.paidDelta : v.payableNow;
        total += paid;
        out(`${w.dryRun ? "[simulation] " : ""}${tag} réglée : +${usdc(paid)} (cumul ${r.cumulativeUnits} unités au prix verrouillé ${usdc(s.price)}/unité)`);
      } catch (err) {
        failures++;
        info(`${tag} : échec — ${explainError(err)}`);
      }
    }
    out(`${w.dryRun ? "[simulation] " : ""}total réglé : ${usdc(total)}${failures ? ` ; ${failures} échec(s)` : ""}`);
    if (failures) process.exitCode = 1;
  },
};

const status: Command = {
  path: ["operator", "status"],
  summary: "état d'un opérateur : caution, exposition sur 24 h, enclaves et échéances, gains, identité",
  usage: "operator status [<adresse>]",
  args: [{ name: "adresse", desc: "opérateur (défaut : l'adresse de PRIVATE_KEY)", optional: true }],
  examples: ["arcvault operator status 0x5724d89D610c3017b8DC161c025248341556f6Ab"],
  async run(ctx) {
    const op = ctx.args[0] ? parseAddr(ctx.args[0], "<adresse>") : walletAddressIfAny();
    if (!op) throw new UsageError("<adresse> requise (ou PRIVATE_KEY définie)", ctx.cmd);
    const { arc, pub } = reader(ctx.rpc);
    const bal = await arc.usdcBalance(op);
    const bondTotal = await arc.bondOf(op);
    const avail = await arc.availableBond(op);
    const banned = (await readBond(pub, "banned", [op])) as boolean;
    const agentId = (await readBond(pub, "agentIdOf", [op])) as bigint;
    const unlock = (await readBond(pub, "unbondableAt", [op])) as bigint;
    const free = await arc.freeBond(op);
    const enclaves = (await arc.listEnclaves()).filter((e) => sameAddr(e.operator, op));
    const grace = await enclaveGraceBlocks(pub);
    out(`opérateur ${op}${banned ? "  — BANNI (caution saisie)" : ""}`);
    out(`  solde USDC        ${usdc(bal)}`);
    out(`  caution           ${usdc(bondTotal)} (disponible ${usdc(avail)}${bondTotal > avail ? `, ${usdc(bondTotal - avail)} en retrait, débloqué ${fmtTime(unlock)}` : ""})`);
    out(`  caution libre     ${usdc(free)} (chaque clé inscrite réserve la caution minimale de son produit)`);
    out(`  identité ERC-8004 ${agentId > 0n ? `agentId ${agentId}` : "aucun agentId lié (arcvault operator init)"}`);
    const pids = [...new Set(enclaves.map((e) => e.productId.toString()))].map(BigInt);
    for (const pid of pids) {
      const used = (await readBond(pub, "exposureOf", [op, pid])) as bigint;
      out(`  exposition 24 h   produit #${pid} : ${usdc(used)} / ${usdc(avail / 2n)} (moitié de la caution disponible)`);
    }
    out(`  gains             ${await earnings(op)}`);
    out(`  enclaves (${enclaves.length})${enclaves.length ? "" : " : aucune"}`);
    for (const e of enclaves) {
      const head = e.head ?? 0n;
      const state = e.active ? "⬡ active          " : head <= e.untilBlock + grace ? "◌ en grâce        " : "· inactive        ";
      out(`    ${state}produit #${e.productId}  signer ${e.signer}  TCB ${e.tcbStatus}  blocs ${e.fromBlock}→${e.untilBlock} (≈ ${fmtTime(e.expiresAt)})`);
    }
  },
};

/** Sélecteurs des appels qui PAIENT un opérateur (Blockscout ne nomme pas les méthodes des contrats non vérifiés). */
const fnSel = (abi: readonly unknown[], name: string) =>
  toFunctionSelector(abi.find((x: any) => x.type === "function" && x.name === name) as AbiFunction).toLowerCase();
const PAYING_CALLS = new Set([
  "settle", "claim", "deliver", fnSel(sessionPayAbi, "settle"), fnSel(sealedBountyAbi, "claim"), fnSel(sealedBountyAbi, "deliver"), fnSel(x402Abi, "settle"),
]);

/** USDC reçus des contrats de règlement par settle/claim/deliver (part d'opérateur ; et parts d'auteur ou de réseau si c'est
 *  la même adresse), d'après l'indexeur Blockscout de l'explorateur. Les remboursements (closeSession) sont exclus. */
async function earnings(op: Address): Promise<string> {
  const from = new Set([testnet.sessionPay, testnet.sealedBounty, testnet.x402Settler].map((a) => a.toLowerCase()));
  try {
    let sum = 0n;
    let n = 0;
    let query = "";
    for (let page = 0; page < 20; page++) {
      const url = `${testnet.blockscoutUrl}/api/v2/addresses/${op}/token-transfers?type=ERC-20&filter=to${query ? `&${query}` : ""}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { items?: any[]; next_page_params?: Record<string, unknown> | null };
      for (const it of j.items ?? []) {
        const token = String(it?.token?.address_hash ?? it?.token?.address ?? "").toLowerCase();
        if (token !== testnet.usdc.toLowerCase() || !from.has(String(it?.from?.hash ?? "").toLowerCase())) continue;
        if (!PAYING_CALLS.has(String(it?.method ?? "").toLowerCase())) continue;
        sum += BigInt(it?.total?.value ?? 0);
        n++;
      }
      if (!j.next_page_params) break;
      query = new URLSearchParams(Object.entries(j.next_page_params).map(([k, v]) => [k, String(v)])).toString();
    }
    return `${usdc(sum)} reçus en ${n} versement(s) par settle/claim/deliver (SessionPay, SealedBounty, X402Settler ; d'après l'indexeur ; inclut les parts d'auteur ou de réseau si c'est la même adresse)`;
  } catch {
    return "indisponibles (indexeur injoignable)";
  }
}

export const operatorCommands: Command[] = [init, bond, register, renew, retire, settle, status];
export const OPERATOR_TITLE = "devenir fournisseur d'enclave : identité ERC-8004, caution, inscription, réattestation, retrait, règlements, état";
