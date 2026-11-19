/** unit.test.ts — les fonctions pures de l'agent : masquage, police, bannière, coupure, journaux, tunnel, docker,
 *  systemd, origine de la clé (--key-file, ARCHIVE_KEY ; --key refusé), réponse oui/non, refus de l'API par code. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bigText, bigWidth, codeBanner, keyIdOf, maskKey, parseYesNo, wrap } from "../src/ui";
import { apiError, type HttpResult } from "../src/net";
import { KEY_ARG_REFUSED, planUp, suppliedKey } from "../src/agent";
import { upArgsFromPlan } from "../src/service";
import { parseTunnelUrl } from "../src/tunnel";
import { formatLogLine, mergeLogLines, parseLogLines, pullError, runArgs, runError } from "../src/docker";
import { renderSystemdUnit, systemdQuote } from "../src/service";
import { isPrivateIPv4 } from "../src/system";
import { parseCommand } from "../src/args";
import { CHECK_IDS } from "../src/doctor";
import { UsageError } from "../src/errors";

const KEY = "arcop_1a2b3c4d_AbCdEfGhIjKlMnOpQrStUvWxYz012345";

test("the operator key is never shown in full", () => {
  assert.equal(maskKey(KEY), "arcop_1a2b…2345");
  assert.ok(!maskKey(KEY).includes("AbCdEfGh"));
  assert.equal(maskKey("arcop_court"), "arcop_…");
  assert.equal(keyIdOf(KEY), "1a2b3c4d");
});

test("the diagnostic check ids are exactly those of the contract", () => {
  assert.deepEqual([...CHECK_IDS], ["os", "node", "docker", "tdx_guest", "tsm_report", "dstack_socket", "clock", "rpc", "api", "port", "enclave_health", "attest"]);
});

test("the code is drawn in large characters (5 lines), otherwise null", () => {
  const rows = bigText("HIVE-7K2P");
  assert.ok(rows);
  assert.equal(rows.length, 5);
  assert.ok(rows[0]!.startsWith("█   █"));
  assert.equal(bigText("HIVE-é"), null);
});

test("code banner (14 characters): readable on an 80-column terminal, a narrower fallback without HIVE-", () => {
  const code = "HIVE-7K2P-QX9M";
  assert.equal(code.length, 14);
  assert.equal(bigWidth(code), 77);
  assert.ok(bigText(code)!.every((r) => r.length <= 77));
  const b80 = codeBanner(code, 80);
  assert.ok(b80 && !b80.short, "le code entier tient sur 80 colonnes");
  assert.equal(b80.rows.length, 5);
  assert.ok(b80.rows.every((r) => r.length <= 79), "une colonne reste libre : pas de retour à la ligne automatique");
  // le haut de « M », dernier signe : rien n'est coupé
  assert.ok(b80.rows[0]!.endsWith("█   █"));
  const b60 = codeBanner(code, 60);
  assert.ok(b60 && b60.short && b60.rows.every((r) => r.length <= 59), "repli : 7K2P-QX9M seul, le préfixe est facultatif");
  assert.equal(bigWidth("7K2P-QX9M"), 51);
  assert.equal(codeBanner(code, 40), null);
});

test("operator key: --key refused; --key-file (first) then ARCHIVE_KEY; never the key in the service", () => {
  const dir = mkdtempSync(join(tmpdir(), "archive-node-key-"));
  process.env.ARCHIVE_HOME = join(dir, ".archive"); // aucun node.json
  const file = join(dir, "cle");
  writeFileSync(file, `  ${KEY}\n`, { mode: 0o600 });
  assert.deepEqual(suppliedKey(file, {}), { key: KEY, source: `--key-file ${file}`, warning: null });
  const loose = join(dir, "cle-ouverte");
  writeFileSync(loose, KEY, { mode: 0o644 });
  assert.match(suppliedKey(loose, {})!.warning!, /readable by other accounts on this machine: chmod 600 /);
  const other = "arcop_99999999_ZyXwVuTsRqPoNmLkJiHgFeDcBa987654";
  assert.equal(suppliedKey(file, { ARCHIVE_KEY: other })!.key, KEY, "--key-file passe avant ARCHIVE_KEY");
  assert.deepEqual(suppliedKey(undefined, { ARCHIVE_KEY: ` ${other} ` }), { key: other, source: "ARCHIVE_KEY", warning: null });
  assert.equal(suppliedKey(undefined, {}), null);
  assert.throws(() => suppliedKey(undefined, { ARCHIVE_KEY: "pas-une-cle" }), (e: unknown) => e instanceof UsageError);
  assert.throws(() => suppliedKey(dir, {}), (e: unknown) => e instanceof UsageError && /directory/.test(e.message));
  assert.throws(() => planUp({ demo: true, key: KEY }, { requireKey: true }), (e: unknown) => e instanceof UsageError && e.message === KEY_ARG_REFUSED);
  const plan = planUp({ demo: true, keyFile: file }, { requireKey: true });
  assert.equal(plan.key, KEY);
  assert.equal(plan.keyFromConfig, false);
  assert.equal(plan.keySource, `--key-file ${file}`);
  const args = upArgsFromPlan(plan, { demo: true, keyFile: file });
  assert.deepEqual(args.slice(-2), ["--key-file", file]);
  assert.ok(!args.join(" ").includes("arcop_"), "le service ne reçoit que le chemin du fichier");
});

test("line wrapping never breaks a command, even inside quotes", () => {
  const t = "The enclave isn't running: archive-node up --product 8 --demo --tunnel. Then, check the site.";
  const w = wrap(t, 30, "  ");
  assert.ok(w.includes("archive-node up --product 8 --demo --tunnel."), w);
  assert.equal(wrap(t, Infinity, ""), t);
  const q = wrap("Unknown or expired code: run “archive-node pair” again on the machine", 24, "");
  assert.ok(q.includes("“archive-node pair”"), q);
});

test("answer to the question: y, yes, o, oui = yes; n, no, non, Enter or anything else = no (the default)", () => {
  for (const a of ["y", "Y", "yes", "YES", " yes ", "o", "oui", "OUI"]) assert.equal(parseYesNo(a), "yes", JSON.stringify(a));
  for (const a of ["n", "no", "NO", "non", "", "   ", "maybe", "yess", "ye", "oui oui", "nope"]) assert.equal(parseYesNo(a), "no", JSON.stringify(a));
});

test("API refusals: shown in English through their stable code; otherwise the API text as is", () => {
  const res = (status: number, json: unknown): HttpResult => ({ status, ok: false, json, text: JSON.stringify(json), headers: new Headers(), ms: 1, skewS: null });
  assert.equal(apiError(res(429, { error: "trop de requêtes (battements de cette clé) : réessayez dans 12 s", code: "rate_limited", params: { scope: "key_heartbeats", retryAfter: 12 } })),
    "HTTP 429: too many requests (heartbeats for this key): try again in 12 s");
  assert.equal(apiError(res(401, { error: "clé opérateur inconnue ou révoquée", code: "key_unknown_or_revoked" })), "HTTP 401: unknown or revoked operator key");
  assert.equal(apiError(res(409, { error: "limite de 20 machines…", code: "machine_limit", params: { max: 20 } })),
    "HTTP 409: limit of 20 machines per operator reached: remove one on the Operator page");
  assert.equal(apiError(res(400, { error: "mode invalide : attendu tdx, dstack, demo", code: "invalid_enum", params: { field: "mode", allowed: "tdx, dstack, demo" } })),
    "HTTP 400: invalid mode: expected tdx, dstack, demo");
  // API d'avant les codes, ou code inconnu de cette version de l'agent : le texte reçu
  assert.equal(apiError(res(503, { error: "panne" })), "HTTP 503: panne");
  assert.equal(apiError(res(418, { error: "théière", code: "teapot" })), "HTTP 418: théière");
  assert.equal(apiError({ ...res(502, null), text: "<html>Bad Gateway</html>" }), "HTTP 502: <html>Bad Gateway</html>");
});

test("the quick tunnel address is read from cloudflared's output", () => {
  assert.equal(parseTunnelUrl("2026-11-07T10:00:00Z INF |  https://quiet-river-1234.trycloudflare.com   |"), "https://quiet-river-1234.trycloudflare.com");
  assert.equal(parseTunnelUrl('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel"'), null);
  assert.equal(parseTunnelUrl("INF Starting tunnel"), null);
});

test("logs: stdout and stderr put back in order, even with chunks of different lengths", () => {
  const so = parseLogLines("2026-11-07T01:03:50.123456789Z a\n2026-11-07T01:03:52Z c\n");
  const se = parseLogLines("2026-11-07T01:03:50.1234Z b-avant-a\n2026-11-07T01:03:51.5Z b\nsuite sans horodatage\n");
  const merged = mergeLogLines([so, se], 100).map((l) => l.text);
  assert.deepEqual(merged, ["b-avant-a", "a", "b", "suite sans horodatage", "c"]);
  assert.equal(mergeLogLines([so, se], 2).length, 2);
  assert.equal(formatLogLine(so[0]!), "2026-11-07T01:03:50Z a");
  assert.ok(formatLogLine({ ts: 0, frac: 0, text: "x".repeat(1000) }).length <= 400);
  assert.equal(parseLogLines("2026-11-07T01:03:50Z \x1b[32mvert\x1b[0m")[0]!.text, "vert");
});

test("docker run: the expected command", () => {
  const a = runArgs({ port: 8802, product: 1, image: "img@sha256:abc", platform: null, dstack: false, labels: { "io.archive.owner": "archive-node" } });
  assert.deepEqual(a.slice(0, 12), ["run", "-d", "--init", "--name", "archive-enclave", "--restart", "unless-stopped", "-p", "8802:8802", "-e", "PRODUCT_ID=1", "--label"]);
  assert.equal(a[a.length - 1], "img@sha256:abc");
  assert.ok(!a.includes("-v"));
  const b = runArgs({ port: 9000, product: 1, image: "img", platform: "linux/amd64", dstack: true, labels: {}, env: { REGISTRY: "0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d", OPERATOR_ALLOWLIST: "0x5724d89D610c3017b8DC161c025248341556f6Ab", REDPILL_API_KEY: "" } });
  assert.ok(b.join(" ").includes("-e REGISTRY=0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d -e OPERATOR_ALLOWLIST=0x5724d89D610c3017b8DC161c025248341556f6Ab"));
  assert.ok(b.join(" ").includes("-e REDPILL_API_KEY -v"), "un secret est hérité de l'environnement, jamais écrit dans la commande");
  assert.ok(b.join(" ").includes("-v /var/run/dstack.sock:/var/run/dstack.sock"));
  assert.ok(b.join(" ").includes("-p 9000:8802"));
  assert.ok(b.join(" ").includes("--platform linux/amd64"));
});

test("docker errors explained and actionable", () => {
  assert.match(pullError("Error response from daemon: denied: denied", "ghcr.io/x/y@sha256:1"), /docker login ghcr\.io/);
  assert.match(pullError("pull access denied for archive-sealed-chat, repository does not exist or may require 'docker login'", "x"), /--image/);
  assert.match(runError("Bind for 0.0.0.0:8802 failed: port is already allocated", 8802), /Port 8802 is already in use.*--port 8803/);
});

test("systemd: quotes and escapes, and never the key", () => {
  assert.equal(systemdQuote('a "b" 100% $HOME \\'), '"a \\"b\\" 100%% $$HOME \\\\"');
  const unit = renderSystemdUnit({ user: "jb", home: "/home/jb", path: "/usr/bin:/bin", execStart: ["/usr/bin/node", "/home/jb/.archive/bin/archive-node.mjs", "up", "--product", "8", "--demo", "--tunnel"] });
  assert.match(unit, /^ExecStart="\/usr\/bin\/node" "\/home\/jb\/\.archive\/bin\/archive-node\.mjs" "up" "--product" "8" "--demo" "--tunnel"$/m);
  assert.match(unit, /^User=jb$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.ok(!/arcop_/.test(unit.replace(/^#.*$/gm, "")));
});

test("private addresses recognized", () => {
  for (const ip of ["10.0.0.5", "172.20.1.1", "192.168.1.20", "100.64.0.1", "169.254.1.1"]) assert.ok(isPrivateIPv4(ip), ip);
  for (const ip of ["62.171.153.35", "172.32.0.1", "8.8.8.8"]) assert.ok(!isPrivateIPv4(ip), ip);
});

test("options: errors in English", () => {
  assert.throws(() => parseCommand(["--frob"], {}, "up"), (e: unknown) => e instanceof UsageError && /unknown option --frob/.test(e.message));
  assert.throws(() => parseCommand(["--port"], { port: { type: "string" } }, "up"), (e: unknown) => e instanceof UsageError && /expects a value/.test(e.message));
  assert.throws(() => parseCommand(["--demo=1"], { demo: { type: "boolean" } }, "up"), (e: unknown) => e instanceof UsageError && /doesn't take a value/.test(e.message));
  assert.equal(parseCommand(["-f", "-n", "5"], { follow: { type: "boolean", short: "f" }, tail: { type: "string", short: "n" } }, "logs").values.tail, "5");
});
