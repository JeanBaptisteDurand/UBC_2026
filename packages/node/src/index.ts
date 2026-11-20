/** index.ts — archive-node: ArcHive's operator agent. The entry point and the command dispatch. */
import { runUp, type UpFlags } from "./agent";
import { parseCommand, parseCount, parsePort, str, type OptionSpec, type Values } from "./args";
import { loadConfig, resolveApi } from "./config";
import { DEFAULT_PORT } from "./constants";
import { inspectContainer } from "./docker";
import { doctorJson, printDoctor, runDoctor } from "./doctor";
import { CliError, UsageError, errMsg } from "./errors";
import { HELP } from "./help";
import { logsCommand } from "./logs";
import { pairCommand } from "./pair";
import { serviceInstall, serviceUninstall } from "./service";
import { statusCommand } from "./status";
import { upCommand } from "./system";
import { dim, err, flush, out, red } from "./ui";
import { VERSION } from "./version";

const API: OptionSpec = { api: { type: "string" } };
const UP: OptionSpec = {
  ...API,
  product: { type: "string" },
  port: { type: "string" },
  image: { type: "string" },
  demo: { type: "boolean" },
  // --key is read in order to refuse it with an explanation (the key goes through --key-file or ARCHIVE_KEY)
  key: { type: "string" },
  "key-file": { type: "string" },
  "public-url": { type: "string" },
  tunnel: { type: "boolean" },
};

const upFlags = (v: Values): UpFlags => ({
  product: str(v.product),
  port: str(v.port),
  image: str(v.image),
  demo: v.demo === true,
  key: str(v.key),
  keyFile: str(v["key-file"]),
  publicUrl: str(v["public-url"]),
  tunnel: v.tunnel === true,
  api: str(v.api),
});

function noPositionals(p: string[], cmd: string): void {
  if (p.length) throw new UsageError(`unexpected argument “${p[0]}” (see: archive-node ${cmd} --help).`);
}

const COMMANDS = ["doctor", "pair", "up", "status", "logs", "service", "help"];

function help(text: string | undefined): number {
  out(text ?? HELP.main);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    err(`archive-node needs Node.js 20 or later (you have ${process.version}): https://nodejs.org (or: nvm install 22).`);
    return 1;
  }
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") return help(HELP.main);
  if (cmd === "-V" || cmd === "--version" || cmd === "version") {
    out(VERSION);
    return 0;
  }
  if (cmd === "help") return help(HELP[rest[0] ?? "main"]);

  switch (cmd) {
    case "doctor": {
      const { values: v, positionals } = parseCommand(rest, { ...API, json: { type: "boolean" }, port: { type: "string" }, demo: { type: "boolean" } }, cmd);
      if (v.help) return help(HELP.doctor);
      noPositionals(positionals, cmd);
      const cfg = loadConfig();
      const api = resolveApi(str(v.api), cfg);
      const c = str(v.port) ? null : await inspectContainer();
      const port = str(v.port) ? parsePort(str(v.port)!) : c?.hostPort ?? DEFAULT_PORT;
      const demo = v.demo === true || c?.labels["io.archive.mode"] === "demo";
      const r = await runDoctor({ api, port, demo });
      if (v.json) out(JSON.stringify(doctorJson(r), null, 2));
      else {
        let next: string | null = null;
        if (process.env.ARCHIVE_INSTALLING) next = null; // install.sh shows the next step itself
        else if (r.ok && !cfg) next = "archive-node pair";
        else if (r.ok && !r.facts.container?.running) next = upCommand(r.mode);
        printDoctor(r, next);
      }
      return r.ok ? 0 : 1;
    }
    case "pair": {
      const { values: v, positionals } = parseCommand(rest, { ...API, force: { type: "boolean" }, yes: { type: "boolean", short: "y" }, operator: { type: "string" } }, cmd);
      if (v.help) return help(HELP.pair);
      noPositionals(positionals, cmd);
      return pairCommand({ api: str(v.api), force: v.force === true, yes: v.yes === true, operator: str(v.operator) });
    }
    case "up": {
      const { values: v, positionals } = parseCommand(rest, UP, cmd);
      if (v.help) return help(HELP.up);
      noPositionals(positionals, cmd);
      return runUp(upFlags(v));
    }
    case "status": {
      const { values: v, positionals } = parseCommand(rest, { ...API, json: { type: "boolean" }, port: { type: "string" } }, cmd);
      if (v.help) return help(HELP.status);
      noPositionals(positionals, cmd);
      return statusCommand({ api: str(v.api), port: str(v.port), json: v.json === true });
    }
    case "logs": {
      const { values: v, positionals } = parseCommand(rest, { follow: { type: "boolean", short: "f" }, tail: { type: "string", short: "n" } }, cmd);
      if (v.help) return help(HELP.logs);
      noPositionals(positionals, cmd);
      return logsCommand({ follow: v.follow === true, tail: str(v.tail) ? parseCount(str(v.tail)!, "--tail", 100_000) : undefined });
    }
    case "service": {
      const [sub, ...more] = rest;
      if (!sub || sub === "-h" || sub === "--help" || sub === "help") return help(HELP.service);
      if (sub === "install") {
        const { values: v, positionals } = parseCommand(more, UP, "service");
        if (v.help) return help(HELP.service);
        noPositionals(positionals, "service");
        return serviceInstall(upFlags(v));
      }
      if (sub === "uninstall") {
        const { values: v, positionals } = parseCommand(more, {}, "service");
        if (v.help) return help(HELP.service);
        noPositionals(positionals, "service");
        return serviceUninstall();
      }
      throw new UsageError(`unknown subcommand “service ${sub}”: install or uninstall.`);
    }
  }
  const guess = COMMANDS.find((c) => c.startsWith(cmd.slice(0, 2).toLowerCase()));
  throw new UsageError(`unknown command “${cmd}”${guess ? ` (did you mean “${guess}”?)` : ""}. See: archive-node --help`);
}

main(process.argv.slice(2)).then(
  async (code) => {
    await flush();
    process.exit(code);
  },
  async (e: unknown) => {
    if (e instanceof CliError) {
      err(e.exitCode === 130 ? e.message : `${red("Error")}: ${e.message}`);
      await flush();
      process.exit(e.exitCode);
    }
    err(`${red("Unexpected error")}: ${errMsg(e)}`);
    if (process.env.ARCHIVE_DEBUG) err(String((e as Error)?.stack ?? e));
    else err(dim("Run again with ARCHIVE_DEBUG=1 for the technical details."));
    await flush();
    process.exit(1);
  },
);
