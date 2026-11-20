/** secrets.ts — Sealed Bounty secrets on the user's disk (hardened after an adversarial review):
 *  - one X25519 key PER BOUNTY (file mode 0600 in a 0700 folder, named after its public key): revealing it for a
 *    refutation (--reveal-key) opens only the reports of THAT bounty;
 *  - an exploit's random r (with the public cP, it decrypts the exploit): read from a 0600 file or from standard input,
 *    never as an argument (shell history, process list). */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { toBytes, toHex, type Hex } from "viem";
import { deterministicOpen, deterministicSeal, generateX25519 } from "@arcvault/sdk";
import { CliError } from "./cli";

export const KEY_KIND = "arcvault-protocol-x25519";
/** The older layout: ONE key shared by every bounty of a protocol (still read, never created any more). */
export const LEGACY_PROTOCOL_KEY = join(homedir(), ".arcvault", "protocol-x25519.json");
/** The current layout: one key per bounty, stored here. */
export const BOUNTY_KEY_DIR = join(homedir(), ".arcvault", "bounty-keys");

export interface ProtocolKey {
  publicKey: Hex;
  privateKey: Uint8Array;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const isBytes32 = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

/** File of a bounty key, named by its public key (found again from Bounty.protocolX25519). */
export function bountyKeyPath(publicKey: Hex, dir = BOUNTY_KEY_DIR): string {
  return join(dir, `x25519-${publicKey.slice(2).toLowerCase()}.json`);
}

/** A secret file must be readable by its owner only (no rights for the group or others). */
export function assertOwnerOnly(path: string, what: string): void {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch {
    throw new CliError(`${what} not found or unreadable: ${path}`);
  }
  if (process.platform !== "win32" && (mode & 0o077) !== 0) {
    throw new CliError(`${what}: ${path} is readable by others (mode ${(mode & 0o777).toString(8)}); chmod 600 ${path}`);
  }
}

export function loadProtocolKey(path: string): ProtocolKey {
  assertOwnerOnly(path, "protocol key");
  let j: any;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CliError(`unreadable protocol key (JSON expected): ${path}`);
  }
  if (j?.kind !== KEY_KIND || !isBytes32(j?.publicKey) || !isBytes32(j?.privateKey)) {
    throw new CliError(`${path} is not an arcvault protocol key (fields kind/publicKey/privateKey)`);
  }
  const privateKey = toBytes(j.privateKey as Hex);
  // consistency: a seal to the public key must open with the private key
  const probe = deterministicSeal(toBytes(j.publicKey as Hex), utf8("arcvault-probe"), new Uint8Array(32).fill(7));
  try {
    if (new TextDecoder().decode(deterministicOpen(privateKey, probe)) !== "arcvault-probe") throw new Error();
  } catch {
    throw new CliError(`${path}: public key and private key do not match`);
  }
  return { publicKey: (j.publicKey as Hex).toLowerCase() as Hex, privateKey };
}

/**
 * A NEW X25519 key for one bounty: a 0600 file (in a 0700 folder), never overwritten. Default path: named by the public
 * key in BOUNTY_KEY_DIR; an explicit path that already exists is refused (one key serves one bounty).
 */
export function createBountyKey(o: { path?: string; dir?: string; sealedBounty: string; chainId: number }): { path: string; key: ProtocolKey } {
  const k = generateX25519();
  const path = o.path ?? bountyKeyPath(k.publicKey, o.dir);
  if (existsSync(path)) {
    throw new CliError(`${path} already exists: one X25519 key per bounty (it opens every report encrypted to it); choose a new file`);
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body = {
    kind: KEY_KIND,
    publicKey: k.publicKey,
    privateKey: toHex(k.privateKey),
    createdAt: new Date().toISOString(),
    sealedBounty: o.sealedBounty,
    chainId: o.chainId,
    bountyId: null as string | null,
    note: "X25519 private key of ONE bounty: the only key that can decrypt its exploit reports (cP). Never share it; " +
      "--reveal-key (refutation) sends it encrypted to the verified enclaves only, and then it opens only this bounty's reports.",
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { path, key: { publicKey: k.publicKey.toLowerCase() as Hex, privateKey: k.privateKey } };
}

/** Writes the bounty's number into its key file (atomic rewrite, 0600). */
export function recordBountyId(path: string, bountyId: bigint): void {
  const j = JSON.parse(readFileSync(path, "utf8"));
  j.bountyId = bountyId.toString();
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(j, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(tmp, path);
}

/**
 * A bounty's local key, from its on-chain public key (Bounty.protocolX25519): the file given, otherwise the one in
 * BOUNTY_KEY_DIR, otherwise the older shared key (LEGACY_PROTOCOL_KEY) if it matches. `shared`: true for the older key.
 */
export function findBountyKey(publicKey: Hex, o: { path?: string; dir?: string; legacyPath?: string } = {}): { path: string; key: ProtocolKey; shared: boolean } {
  const want = publicKey.toLowerCase();
  if (o.path) {
    const key = loadProtocolKey(o.path);
    if (key.publicKey !== want) throw new CliError(`the key ${o.path} (${key.publicKey}) is not the bounty's (${publicKey})`);
    return { path: o.path, key, shared: false };
  }
  const own = bountyKeyPath(publicKey, o.dir);
  if (existsSync(own)) {
    const key = loadProtocolKey(own);
    if (key.publicKey !== want) throw new CliError(`${own} does not hold the key ${publicKey}`);
    return { path: own, key, shared: false };
  }
  const legacy = o.legacyPath ?? LEGACY_PROTOCOL_KEY;
  if (existsSync(legacy)) {
    const key = loadProtocolKey(legacy);
    if (key.publicKey === want) return { path: legacy, key, shared: true };
  }
  throw new CliError(`no local key for the public key ${publicKey} (looked in: ${own}, ${legacy}); give the file with --protocol-key / --key`);
}

/** The --reveal-key message: EXACTLY what the revealed key opens (the bounties whose Bounty.protocolX25519 it is). */
export function revealKeyWarning(a: { publicKey: Hex; bountyId: bigint; sharing?: bigint[] }): string {
  const head = `the X25519 private key ${a.publicKey} goes encrypted to each VERIFIED enclave (which erases it after use); ` +
    "it opens EVERY report encrypted to this public key";
  if (!a.sharing) return `${head}: those of bounty #${a.bountyId} and those of any other bounty created with the same key (bounty list unreadable)`;
  const others = [...new Set(a.sharing.map(String))].filter((x) => x !== a.bountyId.toString()).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
  if (!others.length) return `${head}: those of bounty #${a.bountyId} only (no other bounty uses this key)`;
  return `${head}: those of bounty #${a.bountyId} AND those of bounties ${others.map((x) => `#${x}`).join(", ")}, which use the same key`;
}

// ---------- the random r ----------

/** r: 0x + 64 hex characters, or a JSON { "r": "0x…" }; anything else is refused (without echoing the content). */
export function parseR(text: string, from: string): Hex {
  const t = text.trim();
  let v: unknown = t;
  if (t.startsWith("{")) {
    try {
      v = JSON.parse(t)?.r;
    } catch {
      v = undefined;
    }
  }
  if (!isBytes32(v)) throw new CliError(`${from}: r expected (0x + 64 hex characters, or JSON { "r": "0x…" })`);
  return (v as string).toLowerCase() as Hex;
}

/** Reads r from a 0600 file, or from redirected standard input ("-"), never typed at the keyboard (it would show). */
export async function readR(source: string, stdin: NodeJS.ReadStream = process.stdin): Promise<Hex> {
  if (source === "-") {
    if (stdin.isTTY) throw new CliError("--r-file -: redirect r to standard input (e.g. < r.hex); typing it would show it on screen");
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(typeof c === "string" ? Buffer.from(c) : (c as Buffer));
    return parseR(Buffer.concat(chunks).toString("utf8"), "standard input");
  }
  assertOwnerOnly(source, "r file");
  return parseR(readFileSync(source, "utf8"), source);
}

/** Writes r into a NEW 0600 file (bounty submit --save-r): enough to refute later without passing it as an argument. */
export function saveR(path: string, r: Uint8Array): void {
  if (existsSync(path)) throw new CliError(`${path} already exists: choose a new file for r`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${toHex(r)}\n`, { mode: 0o600, flag: "wx" });
}
