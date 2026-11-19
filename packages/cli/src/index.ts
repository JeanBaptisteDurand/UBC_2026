#!/usr/bin/env tsx
/** arcvault — command-line client for ArcHive, the network of verified enclaves on Arc. Reads need no key; writes are
 *  signed with PRIVATE_KEY (an environment variable, never printed). Network: Arc testnet (chainId 5042002). */
import { CliError, type Command, UsageError, info, out, parseArgs, renderGroupHelp, renderHelp } from "./cli";
import { explainError } from "./chain";
import { bountiesCmd, enclavesCmd, productsCmd, proxyCmd, verifyCmd } from "./commands/read";
import { SESSION_TITLE, sessionCommands } from "./commands/session";
import { BOUNTY_TITLE, bountyCommands } from "./commands/bounty";
import { refuteCmd } from "./commands/refute";
import { OPERATOR_TITLE, operatorCommands } from "./commands/operator";
import { PRODUCT_TITLE, productCommands } from "./commands/product";
import { AUDITOR_TITLE, auditorCommands, levelOperatorCommands, levelProductCommands } from "./commands/levels";

const GROUPS: Record<string, { title: string; cmds: Command[] }> = {
  session: { title: SESSION_TITLE, cmds: sessionCommands },
  bounty: { title: BOUNTY_TITLE, cmds: [...bountyCommands, refuteCmd] },
  operator: { title: OPERATOR_TITLE, cmds: [...operatorCommands, ...levelOperatorCommands] },
  product: { title: PRODUCT_TITLE, cmds: [...productCommands, ...levelProductCommands] },
  auditor: { title: AUDITOR_TITLE, cmds: auditorCommands },
};
const TOP: Command[] = [productsCmd, enclavesCmd, bountiesCmd, verifyCmd, proxyCmd];
const ALL: Command[] = [...TOP, ...Object.values(GROUPS).flatMap((g) => g.cmds)];

function globalHelp(): string {
  const line = (c: Command) => `  ${c.path.join(" ").padEnd(20)}${c.summary}${c.write ? " [signe]" : ""}`;
  const group = (name: string) => [`${name} — ${GROUPS[name]?.title}`, ...(GROUPS[name]?.cmds ?? []).map(line)];
  return [
    "arcvault — CLI d'ArcHive : enclaves Intel TDX vérifiées par les contrats d'Arc, payées en USDC",
    "",
    "Usage : arcvault <commande> [sous-commande] [arguments] [options]",
    "",
    "Lectures et outils :",
    ...TOP.map(line),
    "",
    ...group("session"),
    "",
    ...group("bounty"),
    "",
    ...group("operator"),
    "",
    ...group("product"),
    "",
    ...group("auditor"),
    "",
    "Portefeuille : les commandes [signe] utilisent PRIVATE_KEY (variable d'environnement, jamais affichée) ;",
    "  --dry-run les simule sans rien envoyer. Réseau : Arc testnet (5042002), RPC https://rpc.testnet.arc.io (--rpc).",
    "Aide détaillée : arcvault <commande> [sous-commande] --help",
  ].join("\n");
}

let current: Command | undefined; // commande en cours (pour pointer vers son aide en cas d'erreur)

async function main(argv: string[]): Promise<void> {
  const head = argv[0];
  if (!head || head === "--help" || head === "-h" || head === "help") return out(globalHelp());
  let cmd: Command | undefined;
  for (const c of ALL) {
    if (c.path.every((p, i) => argv[i] === p) && (!cmd || c.path.length > cmd.path.length)) cmd = c;
  }
  if (!cmd) {
    const g = GROUPS[head];
    if (!g) throw new UsageError(`commande inconnue : ${head}`);
    const sub = argv[1];
    if (!sub || sub === "--help" || sub === "-h") return out(renderGroupHelp(head, g.title, g.cmds));
    throw new UsageError(`sous-commande inconnue : ${head} ${sub} (voir arcvault ${head} --help)`);
  }
  current = cmd;
  const rest = argv.slice(cmd.path.length);
  if (rest.includes("--help") || rest.includes("-h")) return out(renderHelp(cmd));
  await cmd.run(parseArgs(rest, cmd));
}

main(process.argv.slice(2)).catch((e) => {
  if (e instanceof UsageError) {
    info(`erreur : ${e.message}`);
    const c = e.command ?? current;
    info(c ? `→ arcvault ${c.path.join(" ")} --help` : "→ arcvault --help");
    process.exit(2);
  }
  info(`erreur : ${e instanceof CliError ? e.message : explainError(e)}`);
  process.exit(1);
});
