/** pair.test.ts — l'appairage de bout en bout (la vraie CLI, une fausse API) : adresse complète du compte qui approuve,
 *  confirmation y/N (non par défaut ; « o », « oui » acceptés aussi) avant d'enregistrer la clé, refus = clé révoquée ;
 *  clé rangée en 0600, jamais affichée ; jamais de clé en argument. Messages en anglais. La question se pose dans un VRAI
 *  terminal (pseudo-terminal, pty-relay.py) : ce qui est tapé avant elle ne compte pas ; hors terminal, elle n'est jamais
 *  lue (--operator ou --yes exigé). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startMockApi, TEST_CODE, TEST_KEY, TEST_OPERATOR } from "./mock-api";
import { stripAnsi } from "../src/ui";

const ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** python3 et son module pty (macOS, Linux) : sans eux, les tests au terminal sont sautés */
const NO_PTY = (() => {
  if (process.platform === "win32") return "pas de pseudo-terminal sous Windows";
  try {
    execFileSync("python3", ["-c", "import pty"], { stdio: "ignore" });
    return false;
  } catch {
    return "python3 (module pty) absent";
  }
})();

/** La CLI dans un VRAI terminal (pseudo-terminal de 80 colonnes, par pty-relay.py) : `type` écrit comme au clavier,
 *  `screen` rend ce que le terminal a affiché (sans couleurs ni retours chariot ; sortie et erreurs mêlées). */
function tty(args: string[], home: string) {
  const child = spawn("python3", [join(ROOT, "test", "pty-relay.py"), process.execPath, "--import", "tsx", "src/index.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, ARCHIVE_HOME: home, ARCHIVE_API: "", ARCHIVE_KEY: "", NO_COLOR: "1", TERM: "xterm", PTY_COLS: "80" },
  });
  let raw = "";
  child.stdout.on("data", (c) => (raw += c));
  child.stderr.on("data", (c) => (raw += c));
  const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
  const screen = () => stripAnsi(raw).replace(/\r/g, "");
  return {
    screen,
    type: (keys: string) => void child.stdin.write(keys),
    async waitFor(re: RegExp, ms = 20_000): Promise<void> {
      for (const t0 = Date.now(); !re.test(screen()); await sleep(25)) {
        if (Date.now() - t0 > ms) throw new Error(`attendu ${re} à l'écran ; reçu :\n${screen()}`);
      }
    },
    async exit(ms = 20_000): Promise<number | null> {
      const late = sleep(ms).then(() => "délai" as const);
      const r = await Promise.race([exited, late]);
      if (r === "délai") throw new Error(`la CLI ne s'est pas arrêtée ; écran :\n${screen()}`);
      return r;
    },
    stop: () => void child.kill(),
  };
}

/** la CLI, avec `input` sur son entrée standard (puis fin de l'entrée : sans réponse, c'est une entrée fermée) */
function cli(args: string[], home: string, o: { input?: string; env?: Record<string, string> } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
      cwd: ROOT,
      env: { ...process.env, ARCHIVE_HOME: home, ARCHIVE_API: "", ARCHIVE_KEY: "", NO_COLOR: "1", ...o.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("exit", (code) => done({ code, stdout, stderr }));
    child.stdin.end(o.input ?? "");
  });
}

const home = () => join(mkdtempSync(join(tmpdir(), "archive-node-test-")), ".archive");
const INTRUDER = "0x1111111111111111111111111111111111111111";

test("terminal : une Entrée tapée pendant l'attente ne compte pas ; « y » après la question garde la clé (0600, masquée)", { skip: NO_PTY }, async () => {
  const api = await startMockApi({ poll: ["pending", "pending", "approved"] });
  const h = home();
  const t = tty(["pair", "--api", api.url], h);
  try {
    await t.waitFor(/enter the code HIVE-7K2P-QX9M, then sign with your wallet/);
    assert.match(t.screen(), /Open http:\/\/site\.test\/#\/operateur\?code=HIVE-7K2P-QX9M/);
    t.type("\r"); // une Entrée machinale pendant l'attente (avant : elle refusait l'appairage, et sa clé était révoquée)
    await t.waitFor(/\[y\/N\] /);
    await sleep(300);
    assert.equal(api.rejects.length, 0, "l'Entrée tapée d'avance n'a rien refusé : la question attend");
    assert.ok(!existsSync(join(h, "node.json")));
    assert.match(t.screen(), /anything typed before this question is ignored: answer now/);
    assert.match(t.screen(), new RegExp(`approved on the site, by the account:\\n\\n {6}${TEST_OPERATOR}\\n`), "l'adresse COMPLÈTE, seule sur sa ligne");
    t.type("y\r");
    assert.equal(await t.exit(), 0, t.screen());
    const s = t.screen();
    assert.match(s, /Keep this pairing and save the key on this machine\? \[y\/N\] y\n/);
    assert.match(s, new RegExp(`Machine paired with the account ${TEST_OPERATOR} .*confirmed on this machine`));
    assert.match(s, /arcop_1a2b…2345/);
    assert.ok(!s.includes(TEST_KEY), "la clé complète ne doit jamais s'afficher");
    const file = join(h, "node.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(
      { api: cfg.api, key: cfg.key, machineId: cfg.machineId, operator: cfg.operator, web: cfg.web },
      { api: api.url, key: TEST_KEY, machineId: "m-0001", operator: TEST_OPERATOR, web: "http://site.test" },
    );
    assert.equal(api.polls, 3);
    assert.deepEqual(api.rejects, [], "rien n'est révoqué");

    // déjà appairée : on ne remplace pas la clé sans --force, et le compte est montré en entier (sans question : pas de
    // terminal exigé)
    const again = await cli(["pair", "--api", api.url], h);
    assert.equal(again.code, 0);
    assert.match(again.stdout, new RegExp(`already paired: account ${TEST_OPERATOR} `));
  } finally {
    t.stop();
    await api.close();
  }
});

test("terminal : « y » tapé d'avance ne répond pas à la question ; l'intrus est refusé sur « n », sa clé révoquée", { skip: NO_PTY }, async () => {
  const api = await startMockApi({ operator: INTRUDER, poll: ["pending", "pending", "approved"] });
  const h = home();
  const t = tty(["pair", "--api", api.url], h);
  try {
    await t.waitFor(/enter the code HIVE-7K2P-QX9M/);
    t.type("y\r"); // avant : un « o » tapé d'avance acceptait l'intrus avant même que l'adresse ne s'affiche
    await t.waitFor(/\[y\/N\] /);
    await sleep(300);
    assert.ok(!existsSync(join(h, "node.json")), "rien n'est accepté d'avance");
    assert.equal(api.rejects.length, 0, "la question attend l'humain");
    assert.match(t.screen(), new RegExp(`by the account:\\n\\n {6}${INTRUDER}\\n`));
    t.type("n\r");
    assert.equal(await t.exit(), 1, t.screen());
    const s = t.screen();
    assert.match(s, /Pairing refused\.\nThe key is not saved, the API revoked it/);
    assert.match(s, /Run archive-node pair again/);
    assert.ok(!existsSync(join(h, "node.json")), "aucune clé enregistrée");
    assert.deepEqual(api.rejects, [`Bearer ${TEST_KEY}`], "POST /pair/reject avec la clé refusée");
    assert.ok(!s.includes(TEST_KEY));
  } finally {
    t.stop();
    await api.close();
  }
});

test("terminal : Entrée seule, « no », « non » ou réponse quelconque = non ; Ctrl+D = non ; Ctrl+C = annulé (130) ; la clé est révoquée", { skip: NO_PTY }, async () => {
  for (const [keys, code, re] of [
    ["\r", 1, /Pairing refused\./],
    ["no\r", 1, /Pairing refused\./],
    ["non\r", 1, /Pairing refused\./],
    ["maybe\r", 1, /Pairing refused\./],
    ["\x04", 1, /No answer \(input closed\): refused by default\./],
    ["\x03", 130, /Pairing cancelled\./],
  ] as const) {
    const api = await startMockApi();
    const h = home();
    const t = tty(["pair", "--api", api.url], h);
    try {
      await t.waitFor(/\[y\/N\] /);
      t.type(keys);
      assert.equal(await t.exit(), code, `${JSON.stringify(keys)} : ${t.screen()}`);
      assert.match(t.screen(), re);
      assert.ok(!existsSync(join(h, "node.json")));
      assert.equal(api.rejects.length, 1);
    } finally {
      t.stop();
      await api.close();
    }
  }
});

test("terminal : « YES » et, pour les habitués, « oui » gardent la clé", { skip: NO_PTY }, async () => {
  for (const keys of ["YES\r", "oui\r"]) {
    const api = await startMockApi();
    const h = home();
    const t = tty(["pair", "--api", api.url], h);
    try {
      await t.waitFor(/\[y\/N\] /);
      t.type(keys);
      assert.equal(await t.exit(), 0, `${JSON.stringify(keys)} : ${t.screen()}`);
      assert.match(t.screen(), /confirmed on this machine/);
      assert.equal(JSON.parse(readFileSync(join(h, "node.json"), "utf8")).operator, TEST_OPERATOR);
      assert.deepEqual(api.rejects, []);
    } finally {
      t.stop();
      await api.close();
    }
  }
});

test("hors terminal (tube, script, « echo y | ») : la réponse n'est jamais lue ; --operator ou --yes exigé avant tout code", async () => {
  for (const input of ["y\n", "yes\n", "o\n", "\n", ""]) {
    const api = await startMockApi();
    const h = home();
    try {
      const r = await cli(["pair", "--api", api.url], h, { input });
      assert.equal(r.code, 2, `entrée ${JSON.stringify(input)} : ${r.stderr}`);
      assert.match(r.stderr, /Standard input is not a terminal/);
      assert.match(r.stderr, /--operator <the full address of YOUR wallet> \(accepts only this account, recommended\), or --yes/);
      assert.equal(api.starts, 0, "aucun code demandé : le refus vient avant");
      assert.ok(!existsSync(join(h, "node.json")));
      assert.deepEqual(api.rejects, []);
    } finally {
      await api.close();
    }
  }
});

test("automatisation : --operator n'accepte que ce compte ; --yes accepte sans question", async () => {
  // le bon compte (casse indifférente) : accepté sans question
  let api = await startMockApi();
  let h = home();
  try {
    const r = await cli(["pair", "--api", api.url, "--operator", TEST_OPERATOR.toUpperCase().replace("0X", "0x")], h);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stdout.includes("[y/N]"), "aucune question");
    assert.match(r.stdout, /it is the expected account \(--operator\)/);
    assert.equal(JSON.parse(readFileSync(join(h, "node.json"), "utf8")).operator, TEST_OPERATOR);
  } finally {
    await api.close();
  }
  // un autre compte a approuvé : refusé, clé révoquée, même avec « y » sur l'entrée
  api = await startMockApi({ operator: INTRUDER });
  h = home();
  try {
    const r = await cli(["pair", "--api", api.url, "--operator", TEST_OPERATOR], h, { input: "y\n" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`This is not the expected account \\(--operator ${TEST_OPERATOR}\\): someone else approved the code`));
    assert.ok(!existsSync(join(h, "node.json")));
    assert.deepEqual(api.rejects, [`Bearer ${TEST_KEY}`]);
  } finally {
    await api.close();
  }
  // --yes : accepté sans question, l'adresse complète reste affichée
  api = await startMockApi({ operator: INTRUDER });
  h = home();
  try {
    const r = await cli(["pair", "--api", api.url, "--yes"], h);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stdout.includes("[y/N]"));
    assert.match(r.stdout, new RegExp(` {6}${INTRUDER}\\n`));
    assert.match(r.stdout, /accepted without asking \(--yes\)/);
    assert.equal(api.rejects.length, 0);
  } finally {
    await api.close();
  }
  // --operator mal formé : erreur d'usage avant tout appel
  const bad = await cli(["pair", "--operator", "0x1234"], home());
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--operator: invalid address/);
});

test("l'API ne dit pas quel compte a approuvé : clé refusée par prudence", async () => {
  const api = await startMockApi({ operator: null });
  const h = home();
  try {
    const r = await cli(["pair", "--api", api.url, "--yes"], h);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /without saying which account approved it: to be safe, the key is not saved/);
    assert.ok(!existsSync(join(h, "node.json")));
    assert.equal(api.rejects.length, 1);
  } finally {
    await api.close();
  }
});

test("code expiré, code déjà servi, demande inconnue", async () => {
  for (const [poll, re] of [
    [["pending", "expired"], /expired/],
    [["consumed"], /already used/],
    [[404], /no longer knows this pairing request/],
  ] as const) {
    const api = await startMockApi({ poll: [...poll] });
    try {
      const r = await cli(["pair", "--api", api.url, "--yes"], home());
      assert.equal(r.code, 1);
      assert.match(r.stderr, re);
    } finally {
      await api.close();
    }
  }
});

test("API sans appairage (404) ou injoignable : message clair, pas de pile", async () => {
  const api = await startMockApi({ startMissing: true });
  try {
    const r = await cli(["pair", "--api", api.url, "--yes"], home());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /doesn't offer pairing yet \(POST .*\/pair\/start → 404\)/);
  } finally {
    await api.close();
  }
  // un refus de l'API (son texte est en français) : l'agent le dit en anglais, par son code stable
  const busy = await startMockApi({ startError: { status: 429, body: {
    error: "déjà 20 appairages en cours depuis cette adresse : terminez-en un ou attendez son expiration (15 min)",
    code: "pairings_per_ip", params: { max: 20, minutes: 15 },
  } } });
  try {
    const r = await cli(["pair", "--api", busy.url, "--yes"], home());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /The API refused to start the pairing \(HTTP 429: already 20 pairings in progress from this address: finish one or wait for it to expire \(15 min\)\)/);
    assert.ok(!/appairages/.test(r.stderr), "pas de français");
  } finally {
    await busy.close();
  }
  // un code que l'agent ne connaît pas : le texte de l'API, tel quel (mieux que rien)
  const odd = await startMockApi({ startError: { status: 503, body: { error: "panne inconnue", code: "nouveau_code" } } });
  try {
    const r = await cli(["pair", "--api", odd.url, "--yes"], home());
    assert.match(r.stderr, /HTTP 503: panne inconnue/);
  } finally {
    await odd.close();
  }
  const closed = await startMockApi(); // un port qui vient de se libérer : personne n'y écoute
  await closed.close();
  const down = await cli(["pair", "--api", closed.url, "--yes"], home());
  assert.equal(down.code, 1);
  assert.match(down.stderr, /Can't reach the ArcHive API .*connection refused/);
  assert.ok(!/at .*\.ts:\d+/.test(down.stderr), "pas de pile d'appels");
});

test("up refuse une machine sans TDX sans --demo, et sans appairage ; la clé ne passe jamais en argument", async () => {
  if (process.platform === "linux") return; // une machine de test Linux peut avoir TDX
  const h = home();
  const noTdx = await cli(["up"], h);
  assert.equal(noTdx.code, 1);
  assert.match(noTdx.stderr, /No TDX.*\n.*archive-node up --demo   \(local trial/);
  const unpaired = await cli(["up", "--demo"], h);
  assert.equal(unpaired.code, 1);
  assert.match(unpaired.stderr, /isn't paired: run archive-node pair first \(or give the key with --key-file <file> or the ARCHIVE_KEY variable\)/);
  // --key est refusé, même avec une clé bien formée : elle se lirait dans « ps » et l'historique du shell
  for (const k of ["pas-une-cle", TEST_KEY]) {
    const r = await cli(["up", "--demo", "--key", k], h);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--key is no longer accepted: .*process list/);
    assert.match(r.stderr, /--key-file <file>.*ARCHIVE_KEY/);
    assert.ok(!r.stderr.includes(TEST_KEY), "la clé refusée n'est pas recopiée à l'écran");
  }
  // le même refus pour le service (la clé finirait dans l'unité systemd)
  const svc = await cli(["service", "install", "--demo", "--key", TEST_KEY], h);
  assert.equal(svc.code, 2);
  assert.match(svc.stderr, /--key is no longer accepted/);
  // --key-file et ARCHIVE_KEY : une clé mal formée ou un fichier absent sont des erreurs d'usage, avant tout lancement
  mkdirSync(h, { recursive: true });
  const bad = join(h, "mauvaise-cle");
  writeFileSync(bad, "pas une clé\n", { mode: 0o600 });
  const badFile = await cli(["up", "--demo", "--key-file", bad], h);
  assert.equal(badFile.code, 2);
  assert.match(badFile.stderr, /--key-file: .* must contain the operator key alone/);
  const missing = await cli(["up", "--demo", "--key-file", join(h, "absent")], h);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /--key-file: can't read .*file not found/);
  const badEnv = await cli(["up", "--demo"], h, { env: { ARCHIVE_KEY: "pas-une-cle" } });
  assert.equal(badEnv.code, 2);
  assert.match(badEnv.stderr, /ARCHIVE_KEY: invalid operator key/);
});

test("un fichier de configuration abîmé donne une consigne, pas une pile", async () => {
  const h = home();
  const r0 = await cli(["--version"], h);
  assert.equal(r0.code, 0);
  mkdirSync(h, { recursive: true });
  writeFileSync(join(h, "node.json"), "{pas du json");
  const r = await cli(["pair"], h);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unreadable: delete it/);
});

test("aide : --yes et --operator documentés pour pair, --key-file et ARCHIVE_KEY pour up", async () => {
  const pair = await cli(["pair", "--help"], home());
  assert.equal(pair.code, 0);
  assert.match(pair.stdout, /HIVE-XXXX-XXXX/);
  assert.match(pair.stdout, /\[y\/N\]/);
  assert.match(pair.stdout, /--operator <address>/);
  assert.match(pair.stdout, /-y, --yes/);
  assert.match(pair.stdout, /anything typed while waiting\nis ignored\. Without a terminal \(pipe, script, cloud-init\), the question isn't asked:\n--operator or --yes is then required\./);
  const up = await cli(["up", "--help"], home());
  assert.match(up.stdout, /--key-file <file>/);
  assert.match(up.stdout, /ARCHIVE_KEY/);
  assert.ok(!/--key <arcop/.test(up.stdout), "plus de --key <arcop_…> dans l'aide");
  assert.equal(TEST_CODE.length, 14);
});
