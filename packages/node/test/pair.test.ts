/** pair.test.ts — pairing end to end (the real CLI, a fake API): the full address of the approving account, a y/N
 *  confirmation (no by default; "o" and "oui" accepted too) before the key is saved, a refusal = a revoked key; the
 *  key stored in 0600, never shown; never a key as an argument. Messages in English. The question is asked in a REAL
 *  terminal (a pseudo-terminal, pty-relay.py): what is typed before it does not count; outside a terminal, it is never
 *  read (--operator or --yes required). */
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

/** python3 and its pty module (macOS, Linux): without them, the terminal tests are skipped */
const NO_PTY = (() => {
  if (process.platform === "win32") return "no pseudo-terminal on Windows";
  try {
    execFileSync("python3", ["-c", "import pty"], { stdio: "ignore" });
    return false;
  } catch {
    return "python3 (module pty) absent";
  }
})();

/** The CLI in a REAL terminal (an 80-column pseudo-terminal, through pty-relay.py): `type` writes as on a keyboard,
 *  `screen` returns what the terminal showed (without colors or carriage returns; output and errors mixed). */
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
        if (Date.now() - t0 > ms) throw new Error(`expected ${re} on screen; got:\n${screen()}`);
      }
    },
    async exit(ms = 20_000): Promise<number | null> {
      const late = sleep(ms).then(() => "timeout" as const);
      const r = await Promise.race([exited, late]);
      if (r === "timeout") throw new Error(`the CLI did not exit; screen:\n${screen()}`);
      return r;
    },
    stop: () => void child.kill(),
  };
}

/** the CLI, with `input` on its standard input (then end of input: without an answer, the input is closed) */
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

test("terminal: an Enter typed while waiting does not count; \"y\" after the question keeps the key (0600, masked)", { skip: NO_PTY }, async () => {
  const api = await startMockApi({ poll: ["pending", "pending", "approved"] });
  const h = home();
  const t = tty(["pair", "--api", api.url], h);
  try {
    await t.waitFor(/enter the code HIVE-7K2P-QX9M, then sign with your wallet/);
    assert.match(t.screen(), /Open http:\/\/site\.test\/#\/operator\?code=HIVE-7K2P-QX9M/);
    t.type("\r"); // a reflex Enter during the wait (it used to refuse the pairing, and revoke its key)
    await t.waitFor(/\[y\/N\] /);
    await sleep(300);
    assert.equal(api.rejects.length, 0, "the Enter typed ahead refused nothing: the question waits");
    assert.ok(!existsSync(join(h, "node.json")));
    assert.match(t.screen(), /anything typed before this question is ignored: answer now/);
    assert.match(t.screen(), new RegExp(`approved on the site, by the account:\\n\\n {6}${TEST_OPERATOR}\\n`), "the FULL address, alone on its line");
    t.type("y\r");
    assert.equal(await t.exit(), 0, t.screen());
    const s = t.screen();
    assert.match(s, /Keep this pairing and save the key on this machine\? \[y\/N\] y\n/);
    assert.match(s, new RegExp(`Machine paired with the account ${TEST_OPERATOR} .*confirmed on this machine`));
    assert.match(s, /arcop_1a2b…2345/);
    assert.ok(!s.includes(TEST_KEY), "the full key must never be shown");
    const file = join(h, "node.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(
      { api: cfg.api, key: cfg.key, machineId: cfg.machineId, operator: cfg.operator, web: cfg.web },
      { api: api.url, key: TEST_KEY, machineId: "m-0001", operator: TEST_OPERATOR, web: "http://site.test" },
    );
    assert.equal(api.polls, 3);
    assert.deepEqual(api.rejects, [], "nothing is revoked");

    // already paired: the key is not replaced without --force, and the account is shown in full (no question, so no
    // terminal required)
    const again = await cli(["pair", "--api", api.url], h);
    assert.equal(again.code, 0);
    assert.match(again.stdout, new RegExp(`already paired: account ${TEST_OPERATOR} `));
  } finally {
    t.stop();
    await api.close();
  }
});

test("terminal: a \"y\" typed ahead does not answer the question; the intruder is refused on \"n\", its key revoked", { skip: NO_PTY }, async () => {
  const api = await startMockApi({ operator: INTRUDER, poll: ["pending", "pending", "approved"] });
  const h = home();
  const t = tty(["pair", "--api", api.url], h);
  try {
    await t.waitFor(/enter the code HIVE-7K2P-QX9M/);
    t.type("y\r"); // it used to be that an "o" typed ahead accepted the intruder before the address even showed
    await t.waitFor(/\[y\/N\] /);
    await sleep(300);
    assert.ok(!existsSync(join(h, "node.json")), "nothing is accepted ahead");
    assert.equal(api.rejects.length, 0, "the question waits for the person");
    assert.match(t.screen(), new RegExp(`by the account:\\n\\n {6}${INTRUDER}\\n`));
    t.type("n\r");
    assert.equal(await t.exit(), 1, t.screen());
    const s = t.screen();
    assert.match(s, /Pairing refused\.\nThe key is not saved, the API revoked it/);
    assert.match(s, /Run archive-node pair again/);
    assert.ok(!existsSync(join(h, "node.json")), "no key saved");
    assert.deepEqual(api.rejects, [`Bearer ${TEST_KEY}`], "POST /pair/reject with the refused key");
    assert.ok(!s.includes(TEST_KEY));
  } finally {
    t.stop();
    await api.close();
  }
});

test("terminal: Enter alone, \"no\", \"non\" or any other answer = no; Ctrl+D = no; Ctrl+C = cancelled (130); the key is revoked", { skip: NO_PTY }, async () => {
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

test("terminal: \"YES\" and the French \"oui\" keep the key", { skip: NO_PTY }, async () => {
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

test("no terminal (pipe, script, \"echo y |\"): the answer is never read; --operator or --yes required before any code", async () => {
  for (const input of ["y\n", "yes\n", "o\n", "\n", ""]) {
    const api = await startMockApi();
    const h = home();
    try {
      const r = await cli(["pair", "--api", api.url], h, { input });
      assert.equal(r.code, 2, `input ${JSON.stringify(input)}: ${r.stderr}`);
      assert.match(r.stderr, /Standard input is not a terminal/);
      assert.match(r.stderr, /--operator <the full address of YOUR wallet> \(accepts only this account, recommended\), or --yes/);
      assert.equal(api.starts, 0, "no code requested: the refusal comes first");
      assert.ok(!existsSync(join(h, "node.json")));
      assert.deepEqual(api.rejects, []);
    } finally {
      await api.close();
    }
  }
});

test("automation: --operator accepts only that account; --yes accepts without a question", async () => {
  // the right account (case does not matter): accepted without a question
  let api = await startMockApi();
  let h = home();
  try {
    const r = await cli(["pair", "--api", api.url, "--operator", TEST_OPERATOR.toUpperCase().replace("0X", "0x")], h);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stdout.includes("[y/N]"), "no question");
    assert.match(r.stdout, /it is the expected account \(--operator\)/);
    assert.equal(JSON.parse(readFileSync(join(h, "node.json"), "utf8")).operator, TEST_OPERATOR);
  } finally {
    await api.close();
  }
  // another account approved: refused, key revoked, even with "y" on the input
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
  // --yes: accepted without a question, the full address stays shown
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
  // a malformed --operator: a usage error before any call
  const bad = await cli(["pair", "--operator", "0x1234"], home());
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--operator: invalid address/);
});

test("the API does not say which account approved: the key is refused as a precaution", async () => {
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

test("expired code, code already used, unknown request", async () => {
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

test("API without pairing (404) or unreachable: a clear message, no stack trace", async () => {
  const api = await startMockApi({ startMissing: true });
  try {
    const r = await cli(["pair", "--api", api.url, "--yes"], home());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /doesn't offer pairing yet \(POST .*\/pair\/start → 404\)/);
  } finally {
    await api.close();
  }
  // an API refusal whose text is not English: the agent says it in English, by its stable code
  const busy = await startMockApi({ startError: { status: 429, body: {
    error: "déjà 20 appairages en cours depuis cette adresse : terminez-en un ou attendez son expiration (15 min)",
    code: "pairings_per_ip", params: { max: 20, minutes: 15 },
  } } });
  try {
    const r = await cli(["pair", "--api", busy.url, "--yes"], home());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /The API refused to start the pairing \(HTTP 429: already 20 pairings in progress from this address: finish one or wait for it to expire \(15 min\)\)/);
    assert.ok(!/appairages/.test(r.stderr), "no French");
  } finally {
    await busy.close();
  }
  // a code the agent does not know: the API's text, as is (better than nothing)
  const odd = await startMockApi({ startError: { status: 503, body: { error: "unknown outage", code: "new_code" } } });
  try {
    const r = await cli(["pair", "--api", odd.url, "--yes"], home());
    assert.match(r.stderr, /HTTP 503: unknown outage/);
  } finally {
    await odd.close();
  }
  const closed = await startMockApi(); // a port just freed: nobody listens there
  await closed.close();
  const down = await cli(["pair", "--api", closed.url, "--yes"], home());
  assert.equal(down.code, 1);
  assert.match(down.stderr, /Can't reach the ArcHive API .*connection refused/);
  assert.ok(!/at .*\.ts:\d+/.test(down.stderr), "no stack trace");
});

test("up refuses a machine without TDX unless --demo, and without pairing; the key is never passed as an argument", async () => {
  if (process.platform === "linux") return; // a Linux test machine may have TDX
  const h = home();
  const noTdx = await cli(["up"], h);
  assert.equal(noTdx.code, 1);
  assert.match(noTdx.stderr, /No TDX.*\n.*archive-node up --demo   \(local trial/);
  const unpaired = await cli(["up", "--demo"], h);
  assert.equal(unpaired.code, 1);
  assert.match(unpaired.stderr, /isn't paired: run archive-node pair first \(or give the key with --key-file <file> or the ARCHIVE_KEY variable\)/);
  // --key is refused, even with a well-formed key: it would show in "ps" and the shell history
  for (const k of ["not-a-key", TEST_KEY]) {
    const r = await cli(["up", "--demo", "--key", k], h);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--key is no longer accepted: .*process list/);
    assert.match(r.stderr, /--key-file <file>.*ARCHIVE_KEY/);
    assert.ok(!r.stderr.includes(TEST_KEY), "the refused key is not echoed on screen");
  }
  // the same refusal for the service (the key would end up in the systemd unit)
  const svc = await cli(["service", "install", "--demo", "--key", TEST_KEY], h);
  assert.equal(svc.code, 2);
  assert.match(svc.stderr, /--key is no longer accepted/);
  // --key-file and ARCHIVE_KEY: a malformed key or a missing file are usage errors, before any start
  mkdirSync(h, { recursive: true });
  const bad = join(h, "bad-key");
  writeFileSync(bad, "not a key\n", { mode: 0o600 });
  const badFile = await cli(["up", "--demo", "--key-file", bad], h);
  assert.equal(badFile.code, 2);
  assert.match(badFile.stderr, /--key-file: .* must contain the operator key alone/);
  const missing = await cli(["up", "--demo", "--key-file", join(h, "absent")], h);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /--key-file: can't read .*file not found/);
  const badEnv = await cli(["up", "--demo"], h, { env: { ARCHIVE_KEY: "not-a-key" } });
  assert.equal(badEnv.code, 2);
  assert.match(badEnv.stderr, /ARCHIVE_KEY: invalid operator key/);
});

test("a damaged configuration file gives an instruction, not a stack trace", async () => {
  const h = home();
  const r0 = await cli(["--version"], h);
  assert.equal(r0.code, 0);
  mkdirSync(h, { recursive: true });
  writeFileSync(join(h, "node.json"), "{not json");
  const r = await cli(["pair"], h);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unreadable: delete it/);
});

test("help: --yes and --operator documented for pair, --key-file and ARCHIVE_KEY for up", async () => {
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
  assert.ok(!/--key <arcop/.test(up.stdout), "no more --key <arcop_…> in the help");
  assert.equal(TEST_CODE.length, 14);
});
