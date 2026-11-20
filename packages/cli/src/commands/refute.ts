/** bounty refute — REFUTE an accepted claim of the Sealed Bounty (SealedBounty.refute, v2.1 stack).
 *
 *  Path: the claim and its operators read back on-chain (ClaimAccepted + claimRecords: not refuted, inside the 3-day
 *  window) → the exploit's source, checked here (it must give back the claim's cPHash) → the quorum, computed BEFORE any
 *  send (at least 2 distinct operators, more than the claim's, none of them) → a counter-replay by enclaves of OTHER
 *  operators (X25519 keys verified on-chain before encryption) → signatures verified and gathered → a refute
 *  simulation → a send ONLY after confirmation (a yes/no question, or --yes). The SDK does the work
 *  (packages/sdk/src/bounty.ts, refutation section); this command shows it and asks for consent.
 *
 *  The hunter's r is read from a 0600 file or from standard input (--r-file), never from an argument; the bounty's key
 *  is found through Bounty.protocolX25519 (one key per bounty); the --reveal-key warning says EXACTLY what the key
 *  opens (the on-chain bounties that have this public key). */
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

/** The target stack: --deployments, otherwise DEPLOYMENTS, otherwise the SDK's. */
function deploymentOf(path: string | undefined): { d: Deployment; source: string } {
  const p = path ?? process.env.DEPLOYMENTS;
  if (!p) return { d: testnet, source: "the SDK's stack" };
  try {
    return { d: deploymentFromJson(readJson(p, "deployment file")), source: p };
  } catch (e) {
    throw new CliError((e as Error).message);
  }
}

/** A yes/no question on the terminal; without a terminal, --yes is required (nothing is sent without explicit consent). */
async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new CliError("confirmation required and no terminal to ask for it: run again with --yes to send (nothing was sent)");
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^(o|oui|y|yes)$/i.test((await rl.question(`${question} [yes/no] `)).trim());
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
    `  bounty               #${c.bountyId}, payee ${c.payee}`,
    `  claimed result       loss ${c.loss}, tier ${c.tier}, block N ${c.blockN}`,
    `  fingerprint / cPHash ${c.fingerprint} / ${c.cPHash}`,
    `  operators            ${a.operators.join(", ")}`,
    `  accepted             ${fmtTime(a.acceptedAt)} (block ${a.block}, tx ${a.txHash}), ${usdc(a.amount)} reserved`,
    `  refutable until      ${fmtTime(a.refuteWindowEndsAt)}${a.refuted ? " (ALREADY REFUTED)" : a.windowOpen ? "" : " (WINDOW CLOSED)"}`,
  ];
}

function resultLine(r: RefuteEnclaveResult): string {
  const who = `${r.enclaveUrl}${r.operator ? ` (operator ${r.operator})` : ""}`;
  const rp = r.replay
    ? r.replay.replayed
      ? `, replay at block ${r.replay.blockN}: ${r.replay.satisfied ? `predicate satisfied, loss ${r.replay.loss}, tier ${r.replay.tier}` : "predicate NOT satisfied"}${r.replay.note ? ` (${r.replay.note})` : ""}`
      : `, no replay: ${r.replay.note ?? "fault established"}`
    : "";
  switch (r.status) {
    case "refuted":
      return `  ✗ refutes  ${who}: "${r.refutation!.proven ? `proven, loss ${r.refutation!.loss}, tier ${r.refutation!.tier}` : "not proven"}" signed${rp}`;
    case "confirmed":
      return `  ✓ confirms  ${who}${rp}`;
    case "refused":
      return `  · refuses   ${who}: ${r.reason} [${r.code}]`;
    case "excluded":
      return `  · skipped   ${who}: ${r.reason}`;
    case "unverified":
      return `  · not verified ${who}: ${r.reason} (nothing sent)`;
    case "skipped":
      return `  · not queried ${who}: ${r.reason}`;
    default:
      return `  ! error     ${who}: ${r.reason}`;
  }
}

export const refuteCmd: Command = {
  path: ["bounty", "refute"],
  summary: "refutes an accepted claim: counter-replay by other operators' enclaves, then refute (with confirmation)",
  usage:
    "bounty refute (--claim <digest> | --bounty <id>) --enclave <url[,url…]> ([--protocol-key <file>] [--reveal-key] [--cp <0x…>] | --bundle <exploit.json> --r-file <0600 file | ->) [--deployments <file>] [--yes] [--dry-run]",
  description: [
    "An accepted claim can be refuted for 3 days if enclaves of DISTINCT operators, at least 2 and more numerous than",
    "the claim's (none of them), replay the exploit at the same block N and find another result (not proven, another",
    "loss, another tier). Effect: the claim's operators are slashed (50 % to you, 50 % to the protocol) and the",
    "payment, if not delivered yet, returns to the pool. The enclaves sign NOTHING if the counter-replay gives the",
    "claim back. If the quorum is out of reach (a single operator on the network, for example), nothing is sent.",
    "The exploit is given in clear, encrypted to each enclave verified on-chain:",
    "  protocol (after deliver): the bounty's key (found by its public key, or --protocol-key); the cP report is",
    "    read from ExploitDelivered (or --cp) and only the X25519 secret of THIS report is passed on; --reveal-key passes",
    "    the bounty's key (needed if the report is unreadable: it is the only proof that it is not one): it opens EVERY",
    "    report encrypted to its public key, this bounty's and those of any bounty that shares it (the command names",
    "    them; a bounty created by \"bounty create\" has its own key);",
    "  hunter: --bundle exploit.json and --r-file, the random r cP was sealed with, in a 0600 file (bounty submit",
    "    --save-r) or on standard input (--r-file -): never as an argument (with the public cP, r opens the exploit).",
    "The refute transaction is sent only after a simulation and a confirmation (a yes/no question, or --yes).",
  ],
  options: [
    { name: "claim", value: "<digest>", desc: "EIP-712 digest of the accepted claim (ClaimAccepted event)" },
    { name: "bounty", value: "<id>", desc: "without --claim: the only claim of this bounty that is still refutable" },
    { name: "enclave", value: "<url[,url…]>", desc: "Sealed Bounty enclaves of OTHER operators (1 to 10; keys verified on-chain)", required: true },
    { name: "protocol-key", value: "<file>", desc: `protocol: the bounty's X25519 key (default: found by its public key in ${BOUNTY_KEY_DIR}, otherwise ${LEGACY_PROTOCOL_KEY})` },
    { name: "reveal-key", desc: "protocol: passes the bounty's key instead of this one report's secret (unreadable report); it opens every report encrypted to it" },
    { name: "cp", value: "<0x…>", desc: "protocol: the cP report (default: read from the ExploitDelivered event)" },
    { name: "bundle", value: "<file>", desc: "hunter: JSON exploit bundle { predicate, txs, capital?, attackCode? }" },
    { name: "r-file", value: "<file | ->", desc: "hunter: the random r (0x + 64 hex characters) in a 0600 file, or \"-\" for redirected standard input" },
    { name: "deployments", value: "<file>", desc: "target stack (e.g. deployments.v21.testnet.json; default: DEPLOYMENTS, otherwise the SDK's)" },
    { name: "yes", desc: "sends refute without asking (after a successful simulation)" },
  ],
  write: true,
  examples: [
    "arcvault bounty refute --claim 0x… --enclave https://op-b.example/enclave/bounty,https://op-c.example/enclave/bounty --deployments deployments.v21.testnet.json",
    "arcvault bounty refute --bounty 3 --enclave https://…,https://… --reveal-key --dry-run",
    "arcvault bounty refute --claim 0x… --enclave https://…,https://… --bundle exploit.json --r-file r-b3.hex",
  ],
  async run(ctx) {
    const { d: D, source: dSource } = deploymentOf(opt(ctx, "deployments"));
    if (D.chainId !== ARC_TESTNET_ID) throw new CliError(`the stack ${dSource} is on chain ${D.chainId}, this CLI signs on Arc testnet (${ARC_TESTNET_ID})`);
    const urls = String(opt(ctx, "enclave")).split(",").map((u) => u.trim().replace(/\/+$/, "")).filter(Boolean);
    if (!urls.length || urls.length > 10) throw new CliError("--enclave: 1 to 10 comma-separated URLs");
    const hunter = opt(ctx, "bundle") !== undefined;
    if (hunter && (opt(ctx, "protocol-key") !== undefined || flag(ctx, "reveal-key") || opt(ctx, "cp") !== undefined)) {
      throw new CliError("choose ONE source: --bundle/--r-file (hunter) or [--protocol-key] [--reveal-key] [--cp] (protocol)");
    }
    if (!hunter && opt(ctx, "r-file") !== undefined) throw new CliError("--r-file goes with --bundle (the hunter's source)");
    if (hunter && opt(ctx, "r-file") === undefined) {
      throw new CliError("--bundle requires --r-file (the random r cP was sealed with, in a 0600 file or on standard input: --r-file -)");
    }
    // r is read BEFORE any network call: a file readable by others is refused
    const rHex = hunter ? await readR(String(opt(ctx, "r-file"))) : undefined;
    const w = await writer(ctx); // PRIVATE_KEY and chain checked before anything else
    const pub = w.pub as any;
    const arc = createArcClient({ publicClient: pub, deployment: D });
    info(`stack: ${dSource}, SealedBounty ${D.sealedBounty}`);

    // 1. the accepted claim
    info("1/5 · accepted claim (ClaimAccepted + claimRecords)");
    let accepted: AcceptedClaim;
    const claimOpt = opt(ctx, "claim");
    if (claimOpt !== undefined) {
      if (!isBytes32(claimOpt)) throw new CliError("--claim: bytes32 digest expected (0x + 64 hex characters)");
      accepted = await readAcceptedClaim(pub, { claimDigest: claimOpt, deployment: D }).catch(sdkError);
    } else {
      if (opt(ctx, "bounty") === undefined) throw new CliError("give --claim <digest> or --bounty <id>");
      const id = parseId(opt(ctx, "bounty"), "--bounty");
      const all = await listAcceptedClaims(pub, { bountyId: id, deployment: D }).catch(sdkError);
      const open = all.filter((c) => c.windowOpen);
      if (open.length !== 1) {
        for (const c of all) info(`  ${c.claimDigest} loss ${c.claim.loss} tier ${c.claim.tier}, ${c.refuted ? "refuted" : c.windowOpen ? "refutable" : "window closed"}`);
        throw new CliError(open.length === 0
          ? `no refutable claim for bounty #${id} (${all.length} accepted)`
          : `${open.length} refutable claims for bounty #${id}: choose with --claim <digest>`);
      }
      accepted = open[0]!;
    }
    for (const l of claimLines(accepted)) info(l);
    if (accepted.refuted) throw new CliError("claim already refuted: nothing to do");
    if (!accepted.windowOpen) throw new CliError(`refutation window closed since ${fmtTime(accepted.refuteWindowEndsAt)}: the contract would refuse (RefuteWindowOver)`);
    const b = await arc.getBounty(accepted.claim.bountyId);

    // 2. the exploit's source, checked here
    info("2/5 · exploit to replay, tied to the claim (cPHash) before any send");
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
      info(`  bounty key: ${keyPath}${shared ? " (the older key shared by the protocol's bounties)" : ""}`);
      let cP = opt(ctx, "cp") as Hex | undefined;
      if (cP === undefined) {
        const found = await findDeliveredReport(pub, { bountyId: accepted.claim.bountyId, cPHash: accepted.claim.cPHash, deployment: D, fromBlock: accepted.block });
        if (!found) {
          throw new CliError("this claim's cP report is not delivered yet (deliver): the protocol cannot read it yet; the hunter can refute with --bundle and --r");
        }
        info(`  report delivered at block ${found.block} (tx ${found.txHash})`);
        cP = found.cP;
      }
      try {
        source = protocolRefuteSource({ cP, protocolPrivateKey: key.privateKey, revealKey: flag(ctx, "reveal-key") });
      } catch (e) {
        return sdkError(e);
      }
      if (flag(ctx, "reveal-key")) {
        // EXACTLY what the key opens: every on-chain bounty whose Bounty.protocolX25519 is this public key
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
      info(`  ✓ the source gives back the claim's cPHash (${chk.mode}); ${chk.note}`);
    } catch (e) {
      sdkError(e);
    }

    // 3. the quorum, first on the network (reading the registered enclaves; best effort), then on the enclaves given
    info("3/5 · quorum: distinct operators, none of them a signer of the claim");
    try {
      const net = (await arc.listEnclaves()).filter((e) => e.productId === b.productId && e.active).map((e) => e.operator);
      const plan = refuteQuorumPlan({ claimOperators: accepted.operators, candidateOperators: net, scope: "network" });
      info(`  network: ${new Set(net.map((o) => o.toLowerCase())).size} active operator(s) for product #${b.productId}; ${plan.message}`);
      if (!plan.reachable) throw new CliError(`${plan.message}: nothing is sent`);
    } catch (e) {
      if (e instanceof CliError) throw e;
      info(`  (network enclaves unreadable: ${(e as Error).message.slice(0, 120)}; only the quorum of the enclaves given will be checked)`);
    }

    // 4. contre-rejeu
    info(`4/5 · counter-replay at block ${accepted.claim.blockN} by ${urls.length} enclave(s) (keys verified on-chain before encryption)`);
    const round = await requestRefutations({
      accepted, source, enclaveUrls: urls, productId: b.productId, protocolX25519: b.protocolX25519, publicClient: pub, deployment: D,
    }).catch(sdkError);
    for (const r of round.results) info(resultLine(r));
    if (round.status !== "ready") throw new CliError(round.message);
    info(`  ${round.message}`);
    if (round.disagreement) warn("verified enclaves disagree with each other: check before sending");

    // 5. simulation, confirmation, envoi
    info("5/5 · refute: simulation, then a send after confirmation");
    const call = prepareRefuteCall(accepted, round, D);
    const abi = [...sealedBountyAbi, ...arcErrorsAbi] as any;
    const pending = await arc.pendingOf(accepted.claim.bountyId, accepted.claim.fingerprint);
    const stillReserved = pending.payee !== "0x0000000000000000000000000000000000000000" && pending.claimDigest.toLowerCase() === accepted.claimDigest.toLowerCase();
    const bonds: string[] = [];
    for (const op of accepted.operators) bonds.push(`${op} (bond ${usdc(await arc.bondOf(op as Address))})`);
    info(`  effects: slashing of ${bonds.join(", ")}, 50 % to ${w.account.address}, 50 % to the protocol;`);
    info(`           ${stillReserved ? `${usdc(pending.amount + pending.netFee + pending.opFee)} reserved return to the pool` : "payment already delivered (nothing returns to the pool)"}; ERC-8004 verdict "refuted"`);
    const { request } = await w.pub.simulateContract({ account: w.account, address: call.address, abi, functionName: "refute", args: call.args } as any);
    info("  simulation (eth_call): accepted by the contract");
    if (w.dryRun) return out(`[dry run] claim ${accepted.claimDigest} would be refuted ("${round.refutation!.proven ? `proven, loss ${round.refutation!.loss}, tier ${round.refutation!.tier}` : "not proven"}", ${round.refuters!.length} operators); nothing is sent`);
    if (!flag(ctx, "yes") && !(await askYesNo("Send the refutation on-chain (a transaction signed by PRIVATE_KEY)?"))) {
      return out("nothing is sent");
    }
    const gas = await w.pub.estimateContractGas({ account: w.account, address: call.address, abi, functionName: "refute", args: call.args } as any);
    const hash = await w.wallet.writeContract({ ...(request as any), gas: gas + gas / 4n }); // margin: VERDICT_GAS is required before the verdict
    const rcpt = await confirm(w, "refute", hash);
    if (!rcpt) return;
    const ev = parseEventLogs({ abi: sealedBountyAbi, logs: rcpt.logs, eventName: "ClaimRefuted" })[0];
    out(ev ? `claim ${ev.args.claimDigest} refuted (bounty #${ev.args.bountyId}), tx ${hash}` : `refute confirmed, tx ${hash}`);
  },
};
