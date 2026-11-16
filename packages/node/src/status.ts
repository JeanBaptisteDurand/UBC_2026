/** status.ts — « archive-node status » : le diagnostic résumé, le conteneur, l'agent, et ce que le site sait de la machine. */
import { loadConfig, loadState, resolveApi } from "./config";
import { DEFAULT_PORT, DEFAULT_WEB } from "./constants";
import { dockerState, inspectContainer } from "./docker";
import { doctorJson, runDoctor } from "./doctor";
import { parsePort } from "./args";
import { apiError, netError, request } from "./net";
import { isAgentAlive, modeLabel, upCommand, type Mode } from "./system";
import { ARROW, KO, OK, WARN, ago, bold, dim, keyIdOf, maskKey, out, plural, short } from "./ui";
import { VERSION } from "./version";

export interface StatusFlags {
  api?: string;
  port?: string;
  json?: boolean;
}

type Remote = { ok: true; machine: any } | { ok: false; error: string; gone?: boolean; refused?: boolean };

/** Ce que l'API sait de CETTE machine. Avec sa clé (Authorization), l'API rend la vue de l'opérateur (adresse
 *  d'enclave, diagnostic) ; sans, une vue publique réduite (durcissement du 7/11, faille n° 9). */
async function fetchMachine(api: string, id: string, key: string | null): Promise<Remote> {
  try {
    const r = await request(`${api}/machines/${encodeURIComponent(id)}`, { timeoutMs: 8000, headers: key ? { authorization: `Bearer ${key}` } : undefined });
    if (r.ok && r.json && typeof r.json === "object") return { ok: true, machine: r.json };
    return { ok: false, error: apiError(r), gone: r.status === 404, refused: r.status === 401 || r.status === 403 };
  } catch (e) {
    return { ok: false, error: netError(e, 8000) };
  }
}

export async function statusCommand(f: StatusFlags): Promise<number> {
  const cfg = loadConfig();
  const st = loadState();
  const api = resolveApi(f.api, cfg);
  const docker = await dockerState();
  const c = docker.ok ? await inspectContainer() : null;
  const port = f.port ? parsePort(f.port) : c?.hostPort ?? st?.port ?? DEFAULT_PORT;
  const lastMode = (c?.labels["io.archive.mode"] ?? st?.mode) as Mode | undefined;
  const [report, remote, agentAlive] = await Promise.all([
    runDoctor({ api, port, demo: lastMode === "demo" }),
    // la clé ne part que vers l'API qui l'a délivrée (une autre --api reçoit une lecture anonyme)
    cfg?.machineId ? fetchMachine(api, cfg.machineId, cfg.api === api ? cfg.key : null) : Promise.resolve(null),
    isAgentAlive(st?.pid ?? null),
  ]);
  const mode = report.mode;

  if (f.json) {
    out(JSON.stringify({
      version: VERSION,
      paired: !!cfg,
      api,
      machineId: cfg?.machineId ?? null,
      operator: cfg?.operator ?? null,
      key: cfg ? maskKey(cfg.key) : null,
      agent: { alive: agentAlive, pid: agentAlive ? st?.pid ?? null : null, lastStatus: st?.status ?? null, enclaveUrl: st?.enclaveUrl ?? null, lastHeartbeatAt: st?.lastHeartbeatAt ?? null },
      container: c ? { state: c.state, running: c.running, startedAt: c.startedAt, exitCode: c.exitCode, image: c.image, port: c.hostPort, product: c.labels["io.archive.product"] ?? null, mode: c.labels["io.archive.mode"] ?? null } : null,
      remote: remote ? (remote.ok ? remote.machine : { error: remote.error }) : null,
      doctor: doctorJson(report),
    }, null, 2));
    return report.ok ? 0 : 1;
  }

  out(`${bold("archive-node")} ${VERSION} · status of “${report.hostname}”`);
  out();
  const row = (label: string, text: string) => out(`  ${label.padEnd(12)} ${text}`);

  // appairage
  if (cfg) {
    const kid = keyIdOf(cfg.key);
    row("Pairing", `${OK} account ${short(cfg.operator)} · machine ${short(cfg.machineId, 8, 4)} · key ${maskKey(cfg.key)}${kid ? ` (#${kid})` : ""}`);
  } else row("Pairing", `${KO} not paired yet`);

  // ce que le site (l'API) sait
  if (!cfg) row("Site", dim("—"));
  else if (!cfg.machineId) row("Site", `${WARN} machine id unknown: it arrives with the first heartbeat (archive-node up)`);
  else if (!remote || !remote.ok) {
    row("Site", remote && remote.gone
      ? `${KO} machine unknown to the API (removed from the site?): archive-node pair --force`
      : remote && remote.refused
        ? `${KO} the API refuses this machine's key (${remote.error}): archive-node pair --force`
        : `${WARN} API unreachable (${remote?.error ?? "?"}): ${api}`);
  } else {
    const m = remote.machine;
    const seen = typeof m.lastSeen === "number" ? `last heartbeat ${ago(Date.now() - m.lastSeen)} ago` : "never seen";
    row("Site", `${m.online ? `${OK} online` : `${KO} offline`} · ${seen} · status “${m.status ?? "?"}”`);
    row("", `registered on Arc: ${m.registered ? "yes" : "no"} · diagnostics seen by the site: ${m.doctorOk === true ? "OK" : m.doctorOk === false ? "to fix" : "pending"}${m.enclaveUrl ? ` · ${m.enclaveUrl}` : ""}`);
  }

  // conteneur
  if (!docker.ok) row("Enclave", `${KO} ${docker.detail}`);
  else if (!c) row("Enclave", `${KO} no archive-enclave container`);
  else {
    const since = c.running && c.startedAt ? ` for ${ago(Date.now() - c.startedAt)}` : "";
    const state = c.running ? `${OK} running${since}` : c.restarting ? `${KO} keeps restarting` : `${KO} stopped (code ${c.exitCode})`;
    row("Enclave", `${state} · product #${c.labels["io.archive.product"] ?? "?"} · port ${c.hostPort ?? "?"} · mode ${modeLabel((c.labels["io.archive.mode"] ?? "demo") as Mode).split(" ")[0]}`);
    row("", dim(c.image));
  }

  // agent
  if (agentAlive) {
    row("Agent", `${OK} active (pid ${st?.pid})${st?.enclaveUrl ? ` · announced address ${st.enclaveUrl}` : ""}`);
  } else {
    row("Agent", `${KO} stopped${st?.updatedAt ? dim(` (last seen ${ago(Date.now() - Date.parse(st.updatedAt))} ago)`) : ""}`);
  }

  // diagnostic
  const green = report.checks.filter((x) => x.ok).length;
  row("Diagnostics", report.ok
    ? `${OK} ${green}/${report.checks.length} green, nothing blocking ${dim("(details: archive-node doctor)")}`
    : `${KO} ${plural(report.blocking.length, "blocking issue", "blocking issues")}: ${report.blocking.join(", ")} ${dim("(details: archive-node doctor)")}`);
  out();

  const web = cfg?.web ?? DEFAULT_WEB;
  let next: string | null = null;
  if (!report.ok) next = "archive-node doctor, then fix the ✗ lines";
  else if (!cfg) next = "archive-node pair";
  else if (!agentAlive || !c?.running) next = upCommand(lastMode ?? mode);
  else if (remote?.ok && remote.machine.registered === false) next = `register the enclave from the site: ${web}/#/operateur`;
  if (next) out(`${ARROW} Next step: ${bold(next)}`);
  return report.ok ? 0 : 1;
}
