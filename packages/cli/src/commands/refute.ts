/** bounty refute — RÉFUTER une réclamation acceptée de la Prime scellée (SealedBounty.refute, pile v2.1).
 *
 *  Parcours : la réclamation et ses opérateurs relus on-chain (ClaimAccepted + claimRecords : non réfutée, dans la fenêtre
 *  de 3 jours) → la source de l'exploit, contrôlée ici (elle doit redonner le cPHash de la réclamation) → le quorum, calculé
 *  AVANT tout envoi (au moins 2 opérateurs distincts, plus que ceux de la réclamation, aucun d'eux) → contre-rejeu par des
 *  enclaves d'AUTRES opérateurs (clés X25519 vérifiées on-chain avant chiffrement) → signatures vérifiées et réunies →
 *  simulation de refute → envoi SEULEMENT après confirmation (question oui/non, ou --yes). Le SDK fait le travail
 *  (packages/sdk/src/bounty.ts, section v2.1) ; cette commande l'affiche et demande l'accord.
 *
 *  v2.1 bis (revue adverse du 9/11) : r (chasseur) se lit dans un fichier 0600 ou sur l'entrée standard (--r-file), jamais en
 *  argument ; la clé de la prime est retrouvée par Bounty.protocolX25519 (une clé par prime) ; l'avertissement de
 *  --reveal-key dit EXACTEMENT ce que la clé ouvre (les primes on-chain qui ont cette clé publique). */
import { createInterface } from "node:readline/promises";
import { parseEventLogs, type Address, type Hex } from "viem";
import {
  ARC_TESTNET_ID, RefuteError, arcErrorsAbi, checkRefuteSource, createArcClient, deploymentFromJson, findDeliveredReport,
  hunterRefuteSource, listAcceptedClaims, prepareRefuteCall, protocolRefuteSource, readAcceptedClaim, refuteQuorumPlan,
  requestRefutations, sealedBountyAbi, testnet,
  type AcceptedClaim, type Deployment, type RefuteEnclaveResult, type RefuteSource,
} from "@arcvault/sdk";
import { CliError, type Command, flag, fmtTime, info, isBytes32, opt, out, parseId, readJson, usdc, warn } from "../cli";
import { confirm, writer } from "../chain";
import { loadExploit } from "./bounty";
import { BOUNTY_KEY_DIR, LEGACY_PROTOCOL_KEY, findBountyKey, readR, revealKeyWarning } from "../secrets";

/** La pile visée : --deployments, sinon DEPLOYMENTS, sinon celle du SDK. */
function deploymentOf(path: string | undefined): { d: Deployment; source: string } {
  const p = path ?? process.env.DEPLOYMENTS;
  if (!p) return { d: testnet, source: "pile du SDK" };
  try {
    return { d: deploymentFromJson(readJson(p, "fichier de déploiement")), source: p };
  } catch (e) {
    throw new CliError((e as Error).message);
  }
}

/** Question oui/non sur le terminal ; sans terminal, --yes est exigé (rien n'est envoyé sans accord explicite). */
async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new CliError("confirmation requise et aucun terminal pour la demander : relancez avec --yes pour envoyer (rien n'a été envoyé)");
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^(o|oui|y|yes)$/i.test((await rl.question(`${question} [oui/non] `)).trim());
  } finally {
    rl.close();
  }
}

const sdkError = (e: unknown): never => {
  if (e instanceof RefuteError) throw new CliError(e.message);
  throw e;
};

function claimLines(a: AcceptedClaim): string[] {
  const c = a.claim;
  return [
    `  digest               ${a.claimDigest}`,
    `  prime                #${c.bountyId} — bénéficiaire ${c.payee}`,
    `  résultat réclamé     perte ${c.loss}, palier ${c.tier}, bloc N ${c.blockN}`,
    `  empreinte / cPHash   ${c.fingerprint} / ${c.cPHash}`,
    `  opérateurs           ${a.operators.join(", ")}`,
    `  acceptée             ${fmtTime(a.acceptedAt)} (bloc ${a.block}, tx ${a.txHash}) — ${usdc(a.amount)} réservés`,
    `  réfutable jusqu'au   ${fmtTime(a.refuteWindowEndsAt)}${a.refuted ? " — DÉJÀ RÉFUTÉE" : a.windowOpen ? "" : " — FENÊTRE CLOSE"}`,
  ];
}

function resultLine(r: RefuteEnclaveResult): string {
  const who = `${r.enclaveUrl}${r.operator ? ` (opérateur ${r.operator})` : ""}`;
  const rp = r.replay
    ? r.replay.replayed
      ? ` — rejeu au bloc ${r.replay.blockN} : ${r.replay.satisfied ? `prédicat satisfait, perte ${r.replay.loss}, palier ${r.replay.tier}` : "prédicat NON satisfait"}${r.replay.note ? ` (${r.replay.note})` : ""}`
      : ` — sans rejeu : ${r.replay.note ?? "faute établie"}`
    : "";
  switch (r.status) {
    case "refuted":
      return `  ✗ réfute    ${who} : « ${r.refutation!.proven ? `prouvée, perte ${r.refutation!.loss}, palier ${r.refutation!.tier}` : "non prouvée"} » signée${rp}`;
    case "confirmed":
      return `  ✓ confirme  ${who}${rp}`;
    case "refused":
      return `  · refuse    ${who} : ${r.reason} [${r.code}]`;
    case "excluded":
      return `  · écartée   ${who} : ${r.reason}`;
    case "unverified":
      return `  · non vérifiée ${who} : ${r.reason} (rien envoyé)`;
    case "skipped":
      return `  · non interrogée ${who} : ${r.reason}`;
    default:
      return `  ! erreur    ${who} : ${r.reason}`;
  }
}

export const refuteCmd: Command = {
  path: ["bounty", "refute"],
  summary: "refutes an accepted claim: counter-replay by other operators' enclaves, then refute (with confirmation)",
  usage:
    "bounty refute (--claim <digest> | --bounty <id>) --enclave <url[,url…]> ([--protocol-key <fichier>] [--reveal-key] [--cp <0x…>] | --bundle <exploit.json> --r-file <fichier 0600 | ->) [--deployments <fichier>] [--yes] [--dry-run]",
  description: [
    "Une réclamation acceptée se réfute pendant 3 jours si des enclaves d'opérateurs DISTINCTS, au moins 2 et plus nombreux",
    "que ceux de la réclamation (aucun d'eux), rejouent l'exploit au même bloc N et trouvent un autre résultat (non prouvée,",
    "autre perte, autre palier). Effet : les opérateurs de la réclamation sont saisis (50 % à vous, 50 % au protocole) et le",
    "paiement, s'il n'est pas encore livré, retourne au pool. Les enclaves ne signent RIEN si le contre-rejeu redonne la",
    "réclamation. Si le quorum n'est pas atteignable (un seul opérateur sur le réseau, par exemple), rien n'est envoyé.",
    "L'exploit est fourni en clair, chiffré vers chaque enclave vérifiée on-chain :",
    "  protocole (après deliver) : la clé de la prime (retrouvée par sa clé publique, ou --protocol-key) ; le rapport cP est",
    "    lu dans ExploitDelivered (ou --cp) et seul le secret X25519 de CE rapport est transmis ; --reveal-key transmet la clé",
    "    de la prime (nécessaire si le rapport est illisible : c'est la seule preuve qu'il n'en est pas un) : elle ouvre TOUS",
    "    les rapports chiffrés vers sa clé publique, ceux de cette prime et de toute prime qui la partage (la commande les",
    "    nomme ; une prime créée par « bounty create » v2.1 bis a sa propre clé) ;",
    "  chasseur : --bundle exploit.json et --r-file, l'aléa avec lequel cP a été scellé, dans un fichier 0600 (bounty submit",
    "    --save-r) ou sur l'entrée standard (--r-file -) : jamais en argument (avec le cP public, r ouvre l'exploit).",
    "La transaction refute n'est envoyée qu'après simulation et confirmation (question oui/non, ou --yes).",
  ],
  options: [
    { name: "claim", value: "<digest>", desc: "digest EIP-712 de la réclamation acceptée (événement ClaimAccepted)" },
    { name: "bounty", value: "<id>", desc: "à défaut de --claim : la seule réclamation encore réfutable de cette prime" },
    { name: "enclave", value: "<url[,url…]>", desc: "enclaves Prime scellée d'AUTRES opérateurs (1 à 10 ; clés vérifiées on-chain)", required: true },
    { name: "protocol-key", value: "<fichier>", desc: `protocole : clé X25519 de la prime (défaut : retrouvée par sa clé publique dans ${BOUNTY_KEY_DIR}, sinon ${LEGACY_PROTOCOL_KEY})` },
    { name: "reveal-key", desc: "protocole : transmet la clé de la prime au lieu du secret de ce seul rapport (rapport illisible) ; elle ouvre tous les rapports chiffrés vers elle" },
    { name: "cp", value: "<0x…>", desc: "protocole : le rapport cP (défaut : lu dans l'événement ExploitDelivered)" },
    { name: "bundle", value: "<fichier>", desc: "chasseur : bundle d'exploit JSON { predicate, txs, capital?, attackCode? }" },
    { name: "r-file", value: "<fichier | ->", desc: "chasseur : l'aléa r (0x + 64 hexadécimaux) dans un fichier 0600, ou « - » pour l'entrée standard redirigée" },
    { name: "deployments", value: "<fichier>", desc: "pile visée (ex. deployments.v21.testnet.json ; défaut : DEPLOYMENTS, sinon celle du SDK)" },
    { name: "yes", desc: "envoie refute sans poser la question (après simulation réussie)" },
  ],
  write: true,
  examples: [
    "arcvault bounty refute --claim 0x… --enclave https://op-b.example/enclave/bounty,https://op-c.example/enclave/bounty --deployments deployments.v21.testnet.json",
    "arcvault bounty refute --bounty 3 --enclave https://…,https://… --reveal-key --dry-run",
    "arcvault bounty refute --claim 0x… --enclave https://…,https://… --bundle exploit.json --r-file r-b3.hex",
  ],
  async run(ctx) {
    const { d: D, source: dSource } = deploymentOf(opt(ctx, "deployments"));
    if (D.chainId !== ARC_TESTNET_ID) throw new CliError(`la pile ${dSource} est sur la chaîne ${D.chainId}, cette CLI signe sur Arc testnet (${ARC_TESTNET_ID})`);
    const urls = String(opt(ctx, "enclave")).split(",").map((u) => u.trim().replace(/\/+$/, "")).filter(Boolean);
    if (!urls.length || urls.length > 10) throw new CliError("--enclave : 1 à 10 URL séparées par des virgules");
    const hunter = opt(ctx, "bundle") !== undefined;
    if (hunter && (opt(ctx, "protocol-key") !== undefined || flag(ctx, "reveal-key") || opt(ctx, "cp") !== undefined)) {
      throw new CliError("choisir UNE source : --bundle/--r-file (chasseur) ou [--protocol-key] [--reveal-key] [--cp] (protocole)");
    }
    if (!hunter && opt(ctx, "r-file") !== undefined) throw new CliError("--r-file va avec --bundle (source du chasseur)");
    if (hunter && opt(ctx, "r-file") === undefined) {
      throw new CliError("--bundle exige --r-file (l'aléa avec lequel cP a été scellé, dans un fichier 0600 ou sur l'entrée standard : --r-file -)");
    }
    // r lu AVANT tout appel réseau : un fichier lisible par d'autres est refusé
    const rHex = hunter ? await readR(String(opt(ctx, "r-file"))) : undefined;
    const w = await writer(ctx); // PRIVATE_KEY et chaîne vérifiées avant tout le reste
    const pub = w.pub as any;
    const arc = createArcClient({ publicClient: pub, deployment: D });
    info(`pile : ${dSource} — SealedBounty ${D.sealedBounty}`);

    // 1. la réclamation acceptée
    info("1/5 · réclamation acceptée (ClaimAccepted + claimRecords)");
    let accepted: AcceptedClaim;
    const claimOpt = opt(ctx, "claim");
    if (claimOpt !== undefined) {
      if (!isBytes32(claimOpt)) throw new CliError("--claim : digest bytes32 attendu (0x + 64 caractères hexadécimaux)");
      accepted = await readAcceptedClaim(pub, { claimDigest: claimOpt, deployment: D }).catch(sdkError);
    } else {
      if (opt(ctx, "bounty") === undefined) throw new CliError("donner --claim <digest> ou --bounty <id>");
      const id = parseId(opt(ctx, "bounty"), "--bounty");
      const all = await listAcceptedClaims(pub, { bountyId: id, deployment: D }).catch(sdkError);
      const open = all.filter((c) => c.windowOpen);
      if (open.length !== 1) {
        for (const c of all) info(`  ${c.claimDigest} perte ${c.claim.loss} palier ${c.claim.tier} — ${c.refuted ? "réfutée" : c.windowOpen ? "réfutable" : "fenêtre close"}`);
        throw new CliError(open.length === 0
          ? `aucune réclamation réfutable pour la prime #${id} (${all.length} acceptée(s))`
          : `${open.length} réclamations réfutables pour la prime #${id} : choisir avec --claim <digest>`);
      }
      accepted = open[0]!;
    }
    for (const l of claimLines(accepted)) info(l);
    if (accepted.refuted) throw new CliError("réclamation déjà réfutée : rien à faire");
    if (!accepted.windowOpen) throw new CliError(`fenêtre de réfutation close depuis ${fmtTime(accepted.refuteWindowEndsAt)} : le contrat refuserait (RefuteWindowOver)`);
    const b = await arc.getBounty(accepted.claim.bountyId);

    // 2. la source de l'exploit, contrôlée ici
    info("2/5 · exploit à rejouer, relié à la réclamation (cPHash) avant tout envoi");
    let source: RefuteSource;
    if (hunter) {
      const ex = loadExploit(String(opt(ctx, "bundle")));
      source = (() => {
        try {
          return hunterRefuteSource({
            bountyId: accepted.claim.bountyId, payee: accepted.claim.payee,
            exploit: { predicate: ex.predicate, txs: ex.txs, capital: ex.capital, attackCode: ex.attackCode }, r: rHex as Hex,
          });
        } catch (e) {
          return sdkError(e);
        }
      })();
    } else {
      const { key, path: keyPath, shared } = findBountyKey(b.protocolX25519, { path: opt(ctx, "protocol-key") });
      info(`  clé de la prime : ${keyPath}${shared ? " (ancienne clé partagée par les primes du protocole)" : ""}`);
      let cP = opt(ctx, "cp") as Hex | undefined;
      if (cP === undefined) {
        const found = await findDeliveredReport(pub, { bountyId: accepted.claim.bountyId, cPHash: accepted.claim.cPHash, deployment: D, fromBlock: accepted.block });
        if (!found) {
          throw new CliError("le rapport cP de cette réclamation n'est pas encore livré (deliver) : le protocole ne peut pas encore le lire ; le chasseur peut réfuter avec --bundle et --r");
        }
        info(`  rapport livré au bloc ${found.block} (tx ${found.txHash})`);
        cP = found.cP;
      }
      try {
        source = protocolRefuteSource({ cP, protocolPrivateKey: key.privateKey, revealKey: flag(ctx, "reveal-key") });
      } catch (e) {
        return sdkError(e);
      }
      if (flag(ctx, "reveal-key")) {
        // EXACTEMENT ce que la clé ouvre : toutes les primes on-chain dont Bounty.protocolX25519 est cette clé publique
        let sharing: bigint[] | undefined;
        try {
          sharing = (await arc.listBounties()).filter((x) => String(x.protocolX25519).toLowerCase() === key.publicKey).map((x) => x.id);
        } catch {
          sharing = undefined;
        }
        warn(revealKeyWarning({ publicKey: key.publicKey, bountyId: accepted.claim.bountyId, sharing }));
      }
    }
    try {
      const chk = checkRefuteSource(source, accepted.claim, b.protocolX25519);
      info(`  ✓ la source redonne le cPHash de la réclamation (${chk.mode}) ; ${chk.note}`);
    } catch (e) {
      sdkError(e);
    }

    // 3. le quorum, d'abord sur le réseau (lecture des enclaves inscrites ; au mieux), puis sur les enclaves données
    info("3/5 · quorum : opérateurs distincts, hors signataires de la réclamation");
    try {
      const net = (await arc.listEnclaves()).filter((e) => e.productId === b.productId && e.active).map((e) => e.operator);
      const plan = refuteQuorumPlan({ claimOperators: accepted.operators, candidateOperators: net, scope: "network" });
      info(`  réseau : ${new Set(net.map((o) => o.toLowerCase())).size} opérateur(s) actif(s) pour le produit #${b.productId} — ${plan.message}`);
      if (!plan.reachable) throw new CliError(`${plan.message} : rien n'est envoyé`);
    } catch (e) {
      if (e instanceof CliError) throw e;
      info(`  (enclaves du réseau illisibles : ${(e as Error).message.slice(0, 120)} ; seul le quorum des enclaves données sera contrôlé)`);
    }

    // 4. contre-rejeu
    info(`4/5 · contre-rejeu au bloc ${accepted.claim.blockN} par ${urls.length} enclave(s) (clés vérifiées on-chain avant chiffrement)`);
    const round = await requestRefutations({
      accepted, source, enclaveUrls: urls, productId: b.productId, protocolX25519: b.protocolX25519, publicClient: pub, deployment: D,
    }).catch(sdkError);
    for (const r of round.results) info(resultLine(r));
    if (round.status !== "ready") throw new CliError(round.message);
    info(`  ${round.message}`);
    if (round.disagreement) warn("des enclaves vérifiées ne sont pas d'accord entre elles : vérifiez avant d'envoyer");

    // 5. simulation, confirmation, envoi
    info("5/5 · refute : simulation puis envoi après confirmation");
    const call = prepareRefuteCall(accepted, round, D);
    const abi = [...sealedBountyAbi, ...arcErrorsAbi] as any;
    const pending = await arc.pendingOf(accepted.claim.bountyId, accepted.claim.fingerprint);
    const stillReserved = pending.payee !== "0x0000000000000000000000000000000000000000" && pending.claimDigest.toLowerCase() === accepted.claimDigest.toLowerCase();
    const bonds: string[] = [];
    for (const op of accepted.operators) bonds.push(`${op} (caution ${usdc(await arc.bondOf(op as Address))})`);
    info(`  effets : saisie de ${bonds.join(", ")} — 50 % à ${w.account.address}, 50 % au protocole ;`);
    info(`           ${stillReserved ? `${usdc(pending.amount + pending.netFee + pending.opFee)} réservés retournent au pool` : "paiement déjà livré (rien ne retourne au pool)"} ; verdict ERC-8004 « refuted »`);
    const { request } = await w.pub.simulateContract({ account: w.account, address: call.address, abi, functionName: "refute", args: call.args } as any);
    info("  simulation (eth_call) : acceptée par le contrat");
    if (w.dryRun) return out(`[simulation] la réclamation ${accepted.claimDigest} serait réfutée (« ${round.refutation!.proven ? `prouvée, perte ${round.refutation!.loss}, palier ${round.refutation!.tier}` : "non prouvée"} », ${round.refuters!.length} opérateurs) ; rien n'est envoyé`);
    if (!flag(ctx, "yes") && !(await askYesNo("Envoyer la réfutation on-chain (transaction signée par PRIVATE_KEY) ?"))) {
      return out("rien n'est envoyé");
    }
    const gas = await w.pub.estimateContractGas({ account: w.account, address: call.address, abi, functionName: "refute", args: call.args } as any);
    const hash = await w.wallet.writeContract({ ...(request as any), gas: gas + gas / 4n }); // marge : VERDICT_GAS exigé avant le verdict
    const rcpt = await confirm(w, "refute", hash);
    if (!rcpt) return;
    const ev = parseEventLogs({ abi: sealedBountyAbi, logs: rcpt.logs, eventName: "ClaimRefuted" })[0];
    out(ev ? `réclamation ${ev.args.claimDigest} réfutée (prime #${ev.args.bountyId}) — tx ${hash}` : `refute confirmée — tx ${hash}`);
  },
};
