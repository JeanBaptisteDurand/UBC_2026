/** bounty — the remote Sealed Bounty, v2 stack and later: hunter (list, status, submit) and protocol
 *  (create, reports). The plaintext exploit leaves this machine only encrypted: cE to an enclave whose X25519 key is
 *  VERIFIED on-chain (SDK verifyEnclaveKeys: never the raw key from /pubkeys), cP to the protocol's X25519 key read
 *  on-chain. Payment in two steps: acceptClaim (reserves; cP stays off the transaction) then deliver (delivers and pays).
 *
 *  Hardened after an adversarial review: `bounty create` generates a fresh X25519 key PER BOUNTY (secrets.ts: file mode
 *  0600, named after the public key), instead of one key shared by all of a protocol's bounties; `reports` and `refute`
 *  find it through Bounty.protocolX25519. The predicate follows the SDK's rules P1–P4 (bounds and shape: predicate.ts). */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeAbiParameters, isHex, keccak256, pad, parseEventLogs, recoverTypedDataAddress, toBytes, toHex,
  type Address, type Hex,
} from "viem";
import {
  checkProvenClaim, claimTypes, deterministicOpen, generateX25519,
  networkDomain, predicateHash, sealExploitForEnclave, sealedBountyAbi, testnet, validatePredicate,
  type Predicate, type ProvenClaim, type SealedExploit,
} from "@arcvault/sdk";
import {
  CliError, type Command, big, fmtTime, info, isBytes32, nowS, opt, out, parseAddr, parseId, parseUsdc, parseWhen,
  readJson, req, usdc, warn,
} from "../cli";
import {
  EIP2935_WINDOW, ZERO, bountyFeesBps, confirm, contractName, fetchLogs, httpJson, isActiveAt,
  reader, readTiers, sameAddr, verifiedEnclave, writer, type Pub, type Tier, type Writer,
} from "../chain";
import { listBounties, stateFr } from "./read";
import {
  BOUNTY_KEY_DIR, LEGACY_PROTOCOL_KEY, createBountyKey, findBountyKey, loadProtocolKey, recordBountyId, saveR, type ProtocolKey,
} from "../secrets";

/** v2.1 : l'ancienne clé partagée (encore lue pour les primes créées avec elle) ; les nouvelles primes ont chacune la leur. */
export const DEFAULT_PROTOCOL_KEY = LEGACY_PROTOCOL_KEY;
export { loadProtocolKey };

// ---------- prédicat, paliers, bundle ----------

/** Le prédicat d'un fichier : règles P1–P4 du SDK (JSON pur, imbrication ≤ 8, ≤ 256 champs, ≤ 16 Kio canonique, 1 à 8
 *  clauses de forme connue). Hors règles : refusé ICI, il n'atteint jamais createBounty (aucune enclave ne le prouverait). */
export function loadPredicate(raw: unknown, label: string): Predicate {
  const p = raw as Predicate;
  try {
    validatePredicate(p);
  } catch (e) {
    throw new CliError(`${label} : prédicat invalide (${(e as Error).message})`);
  }
  return p;
}

function parseTiers(v: string): Tier[] {
  const tiers = v.split(",").map((pair) => {
    const [loss, amount] = pair.split(":").map((x) => x.trim());
    if (!loss || !amount) throw new CliError(`--tiers : « ${pair} » attendu sous la forme perte:montant (ex. 1:1,1000:50)`);
    return { minLoss: parseUsdc(loss, "--tiers (perte)"), amount: parseUsdc(amount, "--tiers (montant)") };
  });
  for (let i = 0; i < tiers.length; i++) {
    if ((tiers[i] as Tier).amount === 0n) throw new CliError("--tiers : chaque palier doit payer plus de 0");
    if (i > 0 && ((tiers[i] as Tier).minLoss <= (tiers[i - 1] as Tier).minLoss || (tiers[i] as Tier).amount <= (tiers[i - 1] as Tier).amount)) {
      throw new CliError("--tiers : seuils de perte ET montants strictement croissants (le contrat v2 refuse sinon : BadTiers)");
    }
  }
  return tiers;
}

function tiersText(tiers: Tier[]): string {
  return tiers.map((t, i) => `[${i}] perte ≥ ${usdc(t.minLoss)} → ${usdc(t.amount)}`).join(" ; ");
}

export interface ExploitFile {
  predicate: Predicate;
  txs: Hex[];
  capital: string;
  attackCode?: Hex;
}

export function loadExploit(path: string): ExploitFile {
  const j = readJson(path, "bundle d'exploit") as any;
  const predicate = loadPredicate(j?.predicate, path);
  const txs = j?.txs;
  if (!Array.isArray(txs) || txs.length < 1 || txs.length > 10 || !txs.every((t: unknown) => typeof t === "string" && isHex(t))) {
    throw new CliError(`${path} : « txs » doit être une liste de 1 à 10 transactions hexadécimales`);
  }
  const capital = j?.capital === undefined ? "0" : String(big(j.capital, `${path} : capital`));
  if (j?.attackCode !== undefined && !(typeof j.attackCode === "string" && isHex(j.attackCode))) {
    throw new CliError(`${path} : « attackCode » doit être hexadécimal`);
  }
  return { predicate, txs, capital, attackCode: j?.attackCode };
}

// ---------- réclamation ----------

interface Claim {
  bountyId: bigint; payee: Address; blockN: bigint; blockHashN: Hex; predicateHash: Hex; loss: bigint;
  tier: number; fingerprint: Hex; cPHash: Hex; deadline: bigint;
}

function normalizeClaim(c: any): Claim {
  const b32 = (k: string): Hex => {
    if (!isBytes32(c?.[k])) throw new CliError(`réclamation : ${k} n'est pas un bytes32`);
    return c[k];
  };
  const tier = Number(c?.tier);
  if (!Number.isInteger(tier) || tier < 0 || tier > 255) throw new CliError("réclamation : palier invalide");
  return {
    bountyId: big(c?.bountyId, "bountyId"), payee: parseAddr(String(c?.payee), "payee"), blockN: big(c?.blockN, "blockN"),
    blockHashN: b32("blockHashN"), predicateHash: b32("predicateHash"), loss: big(c?.loss, "loss"), tier,
    fingerprint: b32("fingerprint"), cPHash: b32("cPHash"), deadline: big(c?.deadline, "deadline"),
  };
}

const claimJson = (c: Claim) => ({
  ...c, bountyId: c.bountyId.toString(), blockN: c.blockN.toString(), loss: c.loss.toString(), deadline: c.deadline.toString(),
});

/** Sauvegarde la réclamation prouvée (sans l'exploit en clair) pour pouvoir la réclamer sans resoumettre. */
function saveClaim(path: string | undefined, data: object, bountyId: bigint, fingerprint: Hex): string {
  let p = path ?? `claim-b${bountyId}-${fingerprint.slice(2, 10)}.json`;
  if (!path) for (let i = 2; existsSync(p); i++) p = `claim-b${bountyId}-${fingerprint.slice(2, 10)}-${i}.json`;
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  return p;
}

/** Vérifie la réclamation signée par les enclaves (contrôles du contrat v2, hors chaîne), puis la fait payer :
 *  acceptClaim (réserve le paiement ; cP n'est pas dans la transaction) puis deliver (livre cP, paie). Reprend à
 *  deliver si la réservation existe déjà (--resume après un échec). */
async function verifyAndClaim(w: Writer, a: {
  claim: Claim; signatures: Hex[]; cP: Hex; enclaveSigners: Address[]; expectedPayee?: Address; savedAt: string;
}): Promise<void> {
  const { claim, signatures, cP } = a;
  const fail = (m: string): never => {
    throw new CliError(`réclamation refusée avant envoi : ${m} (réclamation sauvegardée : ${a.savedAt})`);
  };
  const b = await w.arc.getBounty(claim.bountyId);
  if (b.protocol === ZERO) fail(`prime #${claim.bountyId} inexistante`);
  const pending = await w.arc.pendingOf(claim.bountyId, claim.fingerprint);
  const reserved = pending.payee !== ZERO;
  if (reserved) {
    if (pending.cPHash.toLowerCase() !== keccak256(cP).toLowerCase()) fail("un paiement est réservé pour cette empreinte avec un autre cP");
    info(`paiement déjà réservé pour cette empreinte (${usdc(pending.amount)} à ${pending.payee}) : livraison seulement`);
  } else {
    const signers = await Promise.all(signatures.map((signature) => recoverTypedDataAddress({
      domain: networkDomain(testnet.sealedBounty, testnet.chainId) as any, types: claimTypes, primaryType: "Claim", message: claim, signature,
    })));
    signers.forEach((sg, i) => { if (!a.enclaveSigners.some((e) => sameAddr(e, sg))) fail(`signature ${i + 1} : signée par ${sg}, pas par une enclave vérifiée`); });
    if (a.expectedPayee && !sameAddr(claim.payee, a.expectedPayee)) fail(`bénéficiaire ${claim.payee} ≠ ${a.expectedPayee}`);
    if (claim.predicateHash.toLowerCase() !== String(b.predicateHash).toLowerCase()) fail("predicateHash différent de celui de la prime");
    if (keccak256(cP).toLowerCase() !== claim.cPHash.toLowerCase()) fail("keccak256(cP) ≠ cPHash");
    if (b.paused && claim.blockN >= b.pausedFromBlock) fail(`prime en pause pour les réclamations ancrées à partir du bloc ${b.pausedFromBlock}`);
    if (Number(b.deadline) < nowS()) fail("prime échue");
    if (Number(claim.deadline) < nowS()) fail(`échéance signée de la réclamation dépassée (${fmtTime(claim.deadline)}) : redemandez une preuve (ClaimExpired)`);
    const head = await w.pub.getBlockNumber();
    if (claim.blockN >= head || head - claim.blockN > EIP2935_WINDOW) fail(`bloc N ${claim.blockN} hors de la fenêtre EIP-2935 (tête ${head})`);
    if (claim.blockN <= b.lastPaidBlock) fail(`bloc N ${claim.blockN} au plus tard au dernier paiement ou réarmement (${b.lastPaidBlock}) : rejouez sur un bloc plus récent (AnchorBeforeLastPayout)`);
    for (const sg of signers) if (!(await isActiveAt(w.pub, sg, b.productId, claim.blockN))) fail(`l'enclave ${sg} n'était pas active au bloc N`);
    const paid = await w.pub.readContract({ address: testnet.sealedBounty, abi: sealedBountyAbi, functionName: "fingerprintPaid", args: [claim.bountyId, claim.fingerprint] });
    if (paid) fail("empreinte déjà payée : cet exploit a déjà été récompensé");
    const tiers = await readTiers(w.pub, claim.bountyId);
    const tier = tiers[claim.tier];
    if (!tier) fail(`palier ${claim.tier} inexistant`);
    if (claim.loss < (tier as Tier).minLoss) fail(`perte ${usdc(claim.loss)} sous le seuil du palier ${claim.tier}`);
    const tierAmount = (tier as Tier).amount;
    if (tierAmount <= b.paidAmount) fail(`palier ${claim.tier} (${usdc(tierAmount)}) déjà couvert : ${usdc(b.paidAmount)} déjà payé depuis le dernier armement (TierAlreadyPaid)`);
    const amount = tierAmount - b.paidAmount;
    if (tierAmount > b.singleCap) {
      const ops = new Set<string>();
      for (const sg of signers) ops.add(String((await w.arc.getEnclave(sg)).operator).toLowerCase());
      if (ops.size < b.k) fail(`palier ${usdc(tierAmount)} > plafond d'une seule enclave (${usdc(b.singleCap)}) : ${b.k} opérateurs distincts requis, ${ops.size} signent (--enclave url1,url2,…)`);
    }
    const fees = await bountyFeesBps(w.pub);
    const total = amount + (amount * BigInt(fees.network)) / 10_000n + (amount * BigInt(fees.operator)) / 10_000n;
    if (b.balance < total) fail(`solde de la prime ${usdc(b.balance)} < ${usdc(total)} (palier + frais)`);
    info(`5/6 · réservation on-chain (acceptClaim) : palier ${claim.tier} (${usdc(amount)}), bloc N ${claim.blockN}, empreinte ${claim.fingerprint}`);
    let hash: Hex;
    try {
      hash = await w.arc.acceptClaim(claim, signatures);
    } catch (e) {
      info(`échec de la réservation : ne resoumettez pas le bundle à l'enclave, rejouez « arcvault bounty submit --resume ${a.savedAt} »`);
      throw e;
    }
    const rcpt = await confirm(w, "acceptClaim", hash);
    if (!rcpt) return out(`[simulation] la réclamation serait acceptée : ${usdc(amount)} réservés pour ${claim.payee} ; deliver suivrait`);
  }
  info("6/6 · livraison du rapport chiffré et paiement (deliver)");
  let dh: Hex;
  try {
    dh = await w.arc.deliver(claim.bountyId, claim.fingerprint, cP);
  } catch (e) {
    info(`échec de la livraison : le paiement reste réservé 24 h ; rejouez « arcvault bounty submit --resume ${a.savedAt} »`);
    throw e;
  }
  const rcpt = await confirm(w, "deliver", dh);
  if (!rcpt) return out(`[simulation] le rapport serait livré et la prime payée à ${claim.payee}`);
  const ev = parseEventLogs({ abi: sealedBountyAbi, logs: rcpt.logs, eventName: "BountyPaid" })[0];
  out(`prime #${claim.bountyId} payée : ${usdc(ev ? ev.args.amount : 0n)} à ${claim.payee} (palier ${claim.tier}) — rapport livré au protocole`);
}

// ---------- commandes ----------

const list: Command = {
  path: ["bounty", "list"],
  summary: "lists the bounties (state, balance, expiry)",
  usage: "bounty list",
  run: listBounties,
};

const status: Command = {
  path: ["bounty", "status"],
  summary: "a bounty in detail: tiers, fees, single-enclave cap, protocol key, balance",
  usage: "bounty status <id>",
  args: [{ name: "id", desc: "identifiant de la prime" }],
  examples: ["arcvault bounty status 1"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const { arc, pub } = reader(ctx.rpc);
    const b = await arc.getBounty(id);
    if (b.protocol === ZERO) throw new CliError(`prime #${id} inexistante`);
    const tiers = await readTiers(pub, id);
    const fees = await bountyFeesBps(pub);
    const p = await arc.getProduct(b.productId);
    const top = tiers.length ? (tiers[tiers.length - 1] as Tier).amount : 0n;
    const topTotal = top + (top * BigInt(fees.network + fees.operator)) / 10_000n;
    out(`prime #${id}  ${b.paused ? "en pause" : Number(b.deadline) < nowS() ? "échue" : "ouverte"}`);
    out(`  protocole            ${b.protocol}`);
    out(`  produit              #${b.productId} (${p.deterministic ? "déterministe" : "non déterministe"}, règlement ${contractName(p.settlement)}, ${stateFr(p.state)})`);
    out(`  predicateHash        ${b.predicateHash}`);
    out(`  clé du protocole     ${b.protocolX25519} (X25519 : les rapports cP lui sont chiffrés)`);
    out(`  paliers              ${tiers.length ? tiersText(tiers) : "—"}`);
    out(`  frais en plus        réseau ${fees.network / 100} % + opérateurs ${fees.operator / 100} % (pris sur le solde)`);
    out(`  plafond 1 enclave    ${usdc(b.singleCap)} ; au-delà : ${b.k} opérateur(s) distinct(s)`);
    out(`  cible mise en pause  ${b.targetToPause === ZERO ? "aucune" : b.targetToPause}`);
    out(`  échéance             ${fmtTime(b.deadline)}`);
    out(`  déjà payé            ${b.paidAmount > 0n ? `${usdc(b.paidAmount)} depuis le dernier armement (un palier plus haut ne paie que la différence ; ancrage après le bloc ${b.lastPaidBlock})` : "rien depuis le dernier armement"}`);
    if (b.paused) out(`  pause                pour les réclamations ancrées à partir du bloc ${b.pausedFromBlock}`);
    out(`  solde                ${usdc(b.balance)}${topTotal > 0n ? ` (paie ${b.balance / topTotal} fois le plus haut palier, frais compris)` : ""}`);
  },
};

const create: Command = {
  path: ["bounty", "create"],
  summary: "creates and funds a sealed bounty (protocol)",
  usage: "bounty create --product <id> --predicate <prédicat.json> --tiers <perte:montant,…> --funding <usdc> [--cap <usdc>] [--k 2] [--pause <adresse>] [--deadline 7d] [--protocol-key <nouveau fichier>]",
  description: [
    "Le prédicat (JSON { combine, clauses }) décrit ce qui prouve l'exploit ; son hash canonique est épinglé",
    "on-chain : publiez le fichier pour les chasseurs. Les cibles sont les adresses des clauses. Bornes : imbrication",
    "≤ 8 niveaux, ≤ 256 champs, JSON canonique ≤ 16 Kio, 1 à 8 clauses (au-delà, aucune enclave ne le prouverait).",
    "Une clé X25519 NEUVE est créée pour CHAQUE prime (fichier 0600 dans ~/.arcvault/bounty-keys/, nommé par sa clé",
    "publique) : elle seule déchiffre les rapports de cette prime, et la révéler (bounty refute --reveal-key) n'ouvre que ceux-là.",
  ],
  options: [
    { name: "product", value: "<id>", desc: "produit « Prime scellée » (déterministe, réglé par SealedBounty)", required: true },
    { name: "predicate", value: "<fichier>", desc: "prédicat JSON v0 (1 à 8 clauses)", required: true },
    { name: "tiers", value: "<liste>", desc: "paliers perte:montant en USDC, seuils et montants croissants (ex. 1:1,1000:50)", required: true },
    { name: "funding", value: "<usdc>", desc: "financement initial du pool", required: true },
    { name: "cap", value: "<usdc>", desc: "plafond payable sur une seule enclave (défaut : le plus haut palier)" },
    { name: "k", value: "<n>", desc: "opérateurs distincts exigés au-delà du plafond (1 à 5, défaut 2)" },
    { name: "pause", value: "<adresse>", desc: "cible à mettre en pause (pause()) au paiement, si elle l'autorise" },
    { name: "deadline", value: "<quand>", desc: "échéance : durée (7d), horodatage Unix ou date ISO (défaut 7d)" },
    { name: "protocol-key", value: "<nouveau fichier>", desc: `où écrire la clé X25519 NEUVE de cette prime (défaut ${BOUNTY_KEY_DIR}/x25519-<clé publique>.json ; jamais un fichier existant)` },
  ],
  write: true,
  examples: [
    "arcvault bounty create --product 2 --predicate predicat.json --tiers 1:1 --funding 2 --pause 0xD4f4d2Bb6bf662e738cB8917b9Ade152c245F8a1",
  ],
  async run(ctx) {
    const productId = parseId(req(ctx, "product"), "--product");
    const predicatePath = req(ctx, "predicate");
    const predicate = loadPredicate(readJson(predicatePath, "prédicat"), predicatePath);
    const ph = predicateHash(predicate);
    const tiers = parseTiers(req(ctx, "tiers"));
    const funding = parseUsdc(req(ctx, "funding"), "--funding");
    const top = (tiers[tiers.length - 1] as Tier).amount;
    const singleCap = opt(ctx, "cap") !== undefined ? parseUsdc(req(ctx, "cap"), "--cap") : top;
    const k = opt(ctx, "k") !== undefined ? Number(parseId(opt(ctx, "k"), "--k")) : 2;
    if (k < 1 || k > 5) throw new CliError("--k : entre 1 et 5 (le contrat accepte au plus 5 signatures)");
    const target = opt(ctx, "pause") !== undefined ? parseAddr(req(ctx, "pause"), "--pause") : ZERO;
    const deadline = parseWhen(opt(ctx, "deadline") ?? "7d", "--deadline");
    if (Number(deadline) <= nowS()) throw new CliError("--deadline est dans le passé");
    const keyOut = opt(ctx, "protocol-key");
    if (keyOut !== undefined && existsSync(keyOut)) {
      throw new CliError(`--protocol-key : ${keyOut} existe déjà ; une clé X25519 par prime (elle ouvre tous les rapports chiffrés vers elle) : donnez un nouveau fichier`);
    }

    const w = await writer(ctx);
    const p = await w.arc.getProduct(productId);
    if (p.state !== "Active") throw new CliError(`produit #${productId} non actif (${stateFr(p.state)})`);
    if (!p.deterministic || !sameAddr(p.settlement, testnet.sealedBounty)) {
      throw new CliError(`le produit #${productId} n'est pas une Prime scellée (déterministe, réglé par SealedBounty)`);
    }
    const bal = await w.arc.usdcBalance(w.account.address);
    if (bal < funding) throw new CliError(`solde USDC insuffisant : ${usdc(bal)} < ${usdc(funding)}`);
    const fees = await bountyFeesBps(w.pub);
    const topTotal = top + (top * BigInt(fees.network + fees.operator)) / 10_000n;
    if (funding < topTotal) warn(`le financement (${usdc(funding)}) ne couvre pas le plus haut palier frais compris (${usdc(topTotal)})`);
    if (singleCap < top && k > 1) {
      warn(`les paliers au-dessus de ${usdc(singleCap)} exigent ${k} signatures d'opérateurs distincts : le chasseur devra faire prouver l'exploit par ${k} enclaves (arcvault bounty submit --enclave url1,url2,…)`);
    }

    // une clé X25519 NEUVE pour cette prime (jamais celle d'une autre prime : --reveal-key n'ouvrira que ses rapports)
    let key: ProtocolKey;
    let keyPath: string | undefined;
    if (w.dryRun) {
      const k2 = generateX25519();
      key = { publicKey: k2.publicKey, privateKey: k2.privateKey };
      info("[simulation] clé de la prime éphémère (aucun fichier écrit ; une clé neuve serait créée en 0600)");
    } else {
      ({ path: keyPath, key } = createBountyKey({ path: keyOut, sealedBounty: testnet.sealedBounty, chainId: testnet.chainId }));
      info(`clé de la prime créée : ${keyPath} (mode 0600, une clé par prime) — publique ${key.publicKey}`);
    }

    info(`prime : produit #${productId}, prédicat ${ph}, paliers ${tiersText(tiers)}, plafond 1 enclave ${usdc(singleCap)}, k = ${k}, échéance ${fmtTime(deadline)}`);
    const r = await w.arc.createBounty({
      productId, predicateHash: ph, protocolX25519: key.publicKey, tierMinLoss: tiers.map((t) => t.minLoss),
      tierAmount: tiers.map((t) => t.amount), singleCap, k, targetToPause: target, deadline, funding,
    });
    const rcpt = await confirm(w, "createBounty", r.tx);
    if (!rcpt) return out(`[simulation] prime #${r.bountyId} serait créée et financée (${usdc(funding)})`);
    const ev = parseEventLogs({ abi: sealedBountyAbi, logs: rcpt.logs, eventName: "BountyCreated" })[0];
    const id = ev ? ev.args.bountyId : r.bountyId;
    if (keyPath) recordBountyId(keyPath, id);
    out(`prime #${id} créée et financée (${usdc(funding)})`);
    info(`publiez ${predicatePath} pour les chasseurs (predicateHash ${ph}) ; rapports : arcvault bounty reports ${id} (clé : ${keyPath})`);
  },
};

const submit: Command = {
  path: ["bounty", "submit"],
  summary: "hunter: proves an exploit in one or k enclaves (keys verified on-chain), then gets the bounty paid",
  usage: "bounty submit --bounty <id> --bundle <exploit.json> --enclave <url O3>[,<url O3>…] [--payee <adresse>] [--out <fichier>] [--save-r <nouveau fichier>] | --resume <fichier>",
  description: [
    "exploit.json : { predicate, txs: [0x…] (1 à 10), capital?: \"<entier>\", attackCode?: 0x… } ;",
    "le prédicat doit être celui de la prime (même hash). Étapes : lecture de la prime, contrôle que la clé de chaque",
    "enclave est celle INSCRITE on-chain et qu'elle est active pour le produit de la prime (sinon rien n'est chiffré),",
    "chiffrement de cP (vers le protocole) puis de cE (vers chaque enclave), preuve, contrôles de la réclamation signée,",
    "sauvegarde, puis paiement v2 en deux temps : acceptClaim (réserve) puis deliver (livre le rapport et paie).",
    "Plusieurs enclaves (k opérateurs distincts, au-delà du plafond d'une seule) : même bloc N et même échéance pour toutes.",
    "Une réclamation prouvée est sauvegardée (sans l'exploit en clair) : en cas d'échec, --resume la rejoue",
    "sans resoumettre le bundle. --dry-run fait prouver par les enclaves mais ne fait que simuler la réservation.",
  ],
  options: [
    { name: "bounty", value: "<id>", desc: "prime visée" },
    { name: "bundle", value: "<fichier>", desc: "bundle d'exploit JSON (reste sur cette machine, envoyé chiffré)" },
    { name: "enclave", value: "<url[,url…]>", desc: "URL du service Prime scellée (O3) d'une ou plusieurs enclaves inscrites" },
    { name: "payee", value: "<adresse>", desc: "bénéficiaire (défaut : l'adresse de PRIVATE_KEY)" },
    { name: "out", value: "<fichier>", desc: "où sauvegarder la réclamation prouvée (défaut claim-b<id>-<empreinte>.json)" },
    { name: "resume", value: "<fichier>", desc: "fait payer une réclamation déjà prouvée et sauvegardée" },
    { name: "save-r", value: "<nouveau fichier>", desc: "garde l'aléa r de cP dans ce fichier NEUF (0600) : de quoi réfuter plus tard (bounty refute --r-file) ; avec le cP public, r ouvre l'exploit" },
  ],
  write: true,
  examples: [
    "arcvault bounty submit --bounty 1 --bundle exploit.json --enclave https://…-8803.dstack-pha1-prod9.phala.network",
    "arcvault bounty submit --resume claim-b1-1a2b3c4d.json",
  ],
  async run(ctx) {
    const resume = opt(ctx, "resume");
    if (resume) {
      const j = readJson(resume, "réclamation sauvegardée") as any;
      if (j?.kind !== "arcvault-bounty-claim") throw new CliError(`${resume} n'est pas une réclamation sauvegardée par arcvault`);
      const w = await writer(ctx);
      const signatures: Hex[] = Array.isArray(j.signatures) ? j.signatures : [j.signature];
      const signers: string[] = Array.isArray(j.signers) ? j.signers : [j.signer];
      await verifyAndClaim(w, {
        claim: normalizeClaim(j.claim), signatures, cP: j.cP as Hex,
        enclaveSigners: signers.map((x) => parseAddr(String(x), "signer")), savedAt: resume,
      });
      return;
    }
    const id = parseId(req(ctx, "bounty"), "--bounty");
    const bundlePath = req(ctx, "bundle");
    const urls = req(ctx, "enclave").split(",").map((u) => u.trim().replace(/\/$/, "")).filter(Boolean);
    if (!urls.length || urls.length > 5) throw new CliError("--enclave : 1 à 5 URL séparées par des virgules (le contrat accepte au plus 5 signatures)");
    const exploit = loadExploit(bundlePath);
    const w = await writer(ctx);
    const payee = opt(ctx, "payee") !== undefined ? parseAddr(req(ctx, "payee"), "--payee") : w.account.address;

    info(`1/6 · prime #${id} : lecture on-chain`);
    const b = await w.arc.getBounty(id);
    if (b.protocol === ZERO) throw new CliError(`prime #${id} inexistante`);
    if (b.paused) warn(`prime #${id} en pause pour les réclamations ancrées à partir du bloc ${b.pausedFromBlock}`);
    if (Number(b.deadline) < nowS()) throw new CliError(`prime #${id} échue`);
    const ph = predicateHash(exploit.predicate);
    if (ph.toLowerCase() !== String(b.predicateHash).toLowerCase()) {
      throw new CliError(`le prédicat du bundle (${ph}) n'est pas celui de la prime (${b.predicateHash})`);
    }
    const tiers = await readTiers(w.pub, id);
    if (!tiers.length) throw new CliError(`prime #${id} sans palier`);

    info(`2/6 · enclave(s) : clé X25519 = celle inscrite on-chain, active pour le produit #${b.productId}`);
    const keys = [];
    for (const url of urls) {
      const k = await verifiedEnclave(w.pub, url, b.productId);
      info(`  ✓ ${url} → enclave ${k.signer} (opérateur ${k.operator})`);
      keys.push(k);
    }

    info("3/6 · chiffrement : cP vers la clé du protocole (lue on-chain), puis cE vers chaque enclave vérifiée (HPKE)");
    // plusieurs enclaves : le même aléa, le même bloc N et la même échéance, pour qu'elles signent la MÊME réclamation
    const multi = keys.length > 1;
    const head = await w.pub.getBlockNumber();
    const r = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const saveRPath = opt(ctx, "save-r");
    if (saveRPath !== undefined) {
      saveR(saveRPath, r);
      info(`  aléa r gardé dans ${saveRPath} (0600) : avec le cP public il ouvre l'exploit, gardez-le comme le bundle`);
    }
    const anchor = multi ? { blockN: head - 8n, deadline: BigInt(nowS() + 480) } : {};
    const sealed: SealedExploit[] = [];
    for (const k of keys) {
      sealed.push(await sealExploitForEnclave({
        bountyId: id, payee, exploit: { ...exploit, capital: exploit.capital }, protocolX25519: b.protocolX25519, enclave: k, r, ...anchor,
      }));
    }
    r.fill(0);

    info(`4/6 · preuve : ${keys.length} enclave(s) rejouent l'exploit et signent la réclamation si le prédicat est satisfait`);
    const proven: ProvenClaim[] = [];
    for (const sx of sealed) {
      const res = await httpJson(`${sx.enclave.enclaveUrl}/bounty/submit`, { body: sx.submitBody, timeoutMs: 180_000 });
      if (res?.status !== "proven") throw new CliError(`non prouvé par l'enclave ${sx.enclave.signer} : ${res?.reason ?? res?.error ?? JSON.stringify(res)}`);
      if (!isHex(res.signature) || !isHex(res.cP)) throw new CliError("réponse de l'enclave incomplète (signature, cP)");
      try {
        proven.push(await checkProvenClaim(sx, { claim: res.claim, signature: res.signature, cP: res.cP }, { sealedBounty: testnet.sealedBounty, chainId: testnet.chainId }));
      } catch (e) {
        throw new CliError((e as Error).message);
      }
    }
    const first = proven[0]!;
    const claim = normalizeClaim(claimJson(first.claim));
    const same = proven.every((p) => JSON.stringify(claimJson(p.claim)) === JSON.stringify(claimJson(first.claim)));
    if (!same) throw new CliError("les enclaves n'ont pas signé la même réclamation (bloc N ou échéance différents) : réessayez");
    const signatures = proven.map((p) => p.signature);
    const signers = proven.map((p) => p.signer);
    const savedAt = saveClaim(opt(ctx, "out"), {
      kind: "arcvault-bounty-claim", enclaves: urls, signers, signatures, claim: claimJson(claim), cP: first.cP,
    }, id, claim.fingerprint);
    info(`  réclamation prouvée${multi ? ` par ${signers.length} enclaves` : ""} et sauvegardée : ${savedAt}`);
    await verifyAndClaim(w, { claim, signatures, cP: first.cP, enclaveSigners: signers, expectedPayee: payee, savedAt });
  },
};

const reports: Command = {
  path: ["bounty", "reports"],
  summary: "protocol: decrypts the delivered exploit reports (ExploitDelivered events) with its key",
  usage: "bounty reports <id> [--key <fichier>] [--out <dossier>]",
  description: [
    "Chaque réclamation payée livre cP (chiffré vers la clé X25519 du protocole) dans l'événement ExploitDelivered.",
    "Le rapport déchiffré (bénéficiaire, capital, prédicat, transactions, code d'attaque) est écrit sur stdout.",
  ],
  args: [{ name: "id", desc: "identifiant de la prime" }],
  options: [
    { name: "key", value: "<fichier>", desc: `clé X25519 de la prime (défaut : retrouvée par sa clé publique dans ${BOUNTY_KEY_DIR}, sinon ${LEGACY_PROTOCOL_KEY})` },
    { name: "out", value: "<dossier>", desc: "écrit aussi chaque rapport déchiffré dans ce dossier (fichiers 0600)" },
  ],
  examples: ["arcvault bounty reports 3", "arcvault bounty reports 3 --key ./protocole.json --out ./rapports"],
  async run(ctx) {
    const id = parseId(ctx.args[0], "<id>");
    const outDir = opt(ctx, "out");
    const { arc, pub } = reader(ctx.rpc);
    const b = await arc.getBounty(id);
    if (b.protocol === ZERO) throw new CliError(`prime #${id} inexistante`);
    const { key, path: keyPath } = findBountyKey(b.protocolX25519, { path: opt(ctx, "key") });
    info(`clé de la prime : ${keyPath}`);
    const logs = await deliveredReports(pub, id);
    if (!logs.length) return out(`aucun rapport livré pour la prime #${id}`);
    if (outDir) mkdirSync(outDir, { recursive: true, mode: 0o700 });
    let n = 0;
    for (const log of logs) {
      n++;
      const [cP] = decodeAbiParameters([{ type: "bytes" }], log.data) as [Hex];
      out(`rapport ${n} · bloc ${log.blockNumber} · tx ${log.txHash}`);
      let report: any;
      try {
        report = JSON.parse(new TextDecoder().decode(deterministicOpen(key.privateKey, cP)));
      } catch {
        out("  illisible : chiffré pour une autre clé, ou cP non conforme au format arcvault");
        continue;
      }
      out(JSON.stringify(report, null, 2).split("\n").map((l) => `  ${l}`).join("\n"));
      if (outDir) {
        const f = join(outDir, `report-b${id}-${n}.json`);
        writeFileSync(f, `${JSON.stringify({ bountyId: id.toString(), block: log.blockNumber.toString(), tx: log.txHash, report }, null, 2)}\n`, { mode: 0o600 });
        info(`  → ${f}`);
      }
    }
  },
};

async function deliveredReports(pub: Pub, id: bigint) {
  const topic0 = keccak256(toBytes("ExploitDelivered(uint256,bytes)"));
  return fetchLogs(pub, testnet.sealedBounty, topic0, pad(toHex(id), { size: 32 }));
}

export const bountyCommands: Command[] = [list, status, create, submit, reports];
export const BOUNTY_TITLE = "the Sealed Bounty: bounties, exploit proof in an enclave, claim paid in the block, encrypted reports";
