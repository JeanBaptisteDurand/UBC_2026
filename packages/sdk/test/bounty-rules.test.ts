/** bounty-rules.test.ts — Prime scellée v2.1 bis (revue adverse du 9/11), côté SDK et CLI :
 *  2. les règles d'un prédicat (bornes et forme) sont les MÊMES dans le SDK et dans l'enclave ; un prédicat hors règles est
 *     refusé à la création (predicateHash, CLI loadPredicate) ; checkRefuteSource annonce la faute que signeront les enclaves ;
 *  4. CLI : r se lit dans un fichier 0600 ou sur l'entrée standard, jamais en argument (--r refusé) ;
 *  5. CLI : une clé X25519 PAR PRIME (fichier 0600, nommé par la clé publique), retrouvée par Bounty.protocolX25519 ;
 *     l'avertissement de --reveal-key dit exactement ce que la clé ouvre.
 *  Les modules de la CLI sont importés directement (packages/cli/src) : elle n'a pas de lanceur de tests à elle. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  type Address, type Hex, createPublicClient, custom, decodeFunctionData, encodeFunctionResult, getAddress, keccak256, numberToHex, parseAbi,
  toBytes, toHex,
} from "viem";
import {
  PREDICATE_MAX_DEPTH, PredicateError, checkRefuteSource, deterministicSeal, exploitFingerprint, generateX25519, predicateHash,
  validatePredicate, type Claim, type Predicate,
} from "../src/index";
import * as enclave from "../../../enclave/src/services/predicate";
import { CliError, UsageError, parseArgs } from "../../cli/src/cli";
import { loadPredicate } from "../../cli/src/commands/bounty";
import { readTiers } from "../../cli/src/chain";
import { refuteCmd } from "../../cli/src/commands/refute";
import {
  bountyKeyPath, createBountyKey, findBountyKey, loadProtocolKey, parseR, readR, recordBountyId, revealKeyWarning, saveR,
} from "../../cli/src/secrets";

const TOKEN = getAddress("0x0000000000000000000000000000000000000010");
const HOLDER = getAddress("0x0000000000000000000000000000000000000011");
const HUNTER = getAddress("0x000000000000000000000000000000000000c0de");
const deep = (d: number): any => { let x: any = 0; for (let i = 0; i < d; i++) x = [x]; return x; };
const c0 = { type: "ERC20_DROP", token: TOKEN, holder: HOLDER, min: "1000000" };
const PRED: Predicate = { combine: "OR", clauses: [c0 as any] };

/** Résultat d'un validateur : "ok" ou la règle violée. */
function verdict(v: (p: any) => void, p: unknown): string {
  try {
    v(p);
    return "ok";
  } catch (e) {
    return e instanceof Error && "rule" in e ? `${(e as any).rule}:${e.message}` : `AUTRE:${(e as Error)?.constructor?.name}`;
  }
}

describe("2 — predicate: the same rules in the SDK and in the enclave; refused at creation", () => {
  const corpus: unknown[] = [
    PRED,
    { combine: "AND", clauses: [{ type: "NATIVE_DROP", holder: HOLDER, min: 1 }, { type: "ATTACKER_PROFIT", token: TOKEN, min: "0" }] },
    { combine: "OR", clauses: [{ type: "VIEW_CHANGED", target: TOKEN, call: "0x01", op: "lt", value: "3" }, { type: "INVARIANT_BROKEN", target: HOLDER, call: "0x" }], note: "démo ☃" },
    { combine: "OR", clauses: [{ ...c0, x: deep(PREDICATE_MAX_DEPTH - 3) }] },
    { combine: "OR", clauses: [{ ...c0, x: deep(PREDICATE_MAX_DEPTH - 2) }] },
    { combine: "OR", clauses: [{ ...c0, x: deep(50_000) }] },
    { combine: "OR", clauses: [{ ...c0, x: Array(400).fill(0) }] },
    { combine: "OR", clauses: [{ ...c0, x: "z".repeat(20_000) }] },
    { combine: "OR", clauses: [{ ...c0, x: NaN }] },
    { combine: "XOR", clauses: [c0] },
    { combine: "OR", clauses: [] },
    { combine: "OR", clauses: [{ ...c0, type: "ERC20_DROPS" }] },
    { combine: "OR", clauses: [{ ...c0, holder: "0x11" }] },
    { combine: "OR", clauses: [{ ...c0, min: "1e6" }] },
    { combine: "OR", clauses: [{ type: "VIEW_CHANGED", target: TOKEN, call: "0x1", op: "eq", value: "0" }] },
    "pas un objet",
  ];

  it("every predicate of the corpus gets the SAME verdict (and the same hash) from the SDK and from the enclave", () => {
    for (const p of corpus) {
      const sdkV = verdict(validatePredicate, p);
      expect(sdkV).toBe(verdict(enclave.validatePredicate, p));
      expect(sdkV.startsWith("AUTRE")).toBe(false); // jamais une RangeError ou une erreur hors règle
      if (sdkV === "ok") expect(predicateHash(p as Predicate)).toBe(enclave.predicateHash(p as any));
    }
    expect(PREDICATE_MAX_DEPTH).toBe(enclave.PREDICATE_MAX_DEPTH);
  });

  it("refused at creation: predicateHash throws PredicateError for a predicate outside the rules; the CLI refuses it with a clear message", () => {
    expect(() => predicateHash({ combine: "OR", clauses: [{ ...c0, x: deep(9_000) } as any] })).toThrow(PredicateError);
    expect(() => loadPredicate({ combine: "OR", clauses: [{ ...c0, x: deep(9_000) }] }, "predicat.json")).toThrow(CliError);
    expect(() => loadPredicate({ combine: "OR", clauses: [{ ...c0, x: deep(9_000) }] }, "predicat.json")).toThrow(/predicat\.json : prédicat invalide \(prédicat : imbrication de plus de 8 niveaux\)/);
    expect(() => loadPredicate({ combine: "OR", clauses: [{ ...c0, token: "0xabc" }] }, "p.json")).toThrow(/clause 1 : token doit être une adresse/);
    expect(loadPredicate(PRED, "p.json")).toBe(PRED);
  });

  it("checkRefuteSource (bounty key) announces the fault the enclaves will sign: malformed predicate, report nested too deeply", () => {
    const proto = generateX25519();
    const make = (predicate: unknown) => {
      const text = JSON.stringify({ bountyId: "3", payee: HUNTER, capital: "0", predicate, txs: ["0xdeadbeef"], attackCode: null });
      const cP = deterministicSeal(toBytes(proto.publicKey), new TextEncoder().encode(text), new Uint8Array(32).fill(5));
      const claim: Claim = {
        bountyId: 3n, payee: HUNTER, blockN: 9n, blockHashN: keccak256(toBytes("b")), predicateHash: predicateHash(PRED), loss: 1n, tier: 0,
        fingerprint: exploitFingerprint({ txs: ["0xdeadbeef"] }), cPHash: keccak256(cP), deadline: 9n,
      };
      return checkRefuteSource({ from: "protocol", cP, protocolPrivateKey: toHex(proto.privateKey) }, claim, proto.publicKey);
    };
    expect(make({ combine: "OR", clauses: [{ type: "VIEW_CHANGED", target: TOKEN, call: "0x01", op: "xor", value: "1" }] }))
      .toMatchObject({ readable: true, consistent: false, note: expect.stringMatching(/hors règles \(clause 1 : op doit valoir eq, neq, gt ou lt\)/) });
    expect(make({ combine: "OR", clauses: [{ ...c0, x: deep(20) }] })).toMatchObject({ readable: false, consistent: false, note: expect.stringMatching(/imbriqué au-delà des bornes/) });
    expect(make(PRED)).toMatchObject({ readable: true, consistent: true });
  });
});

describe("4 — CLI: r in a 0600 file or on standard input, never as an argument", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "arcvault-r-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const R = ("0x" + "ab".repeat(32)) as Hex;

  it("--r <0x…> is refused (shell history, process list); --r-file is accepted", () => {
    const base = ["--claim", "0x" + "11".repeat(32), "--enclave", "https://e.example"];
    expect(() => parseArgs([...base, "--r", R], refuteCmd)).toThrow(UsageError);
    expect(() => parseArgs([...base, `--r=${R}`], refuteCmd)).toThrow(/--r is not supported/);
    expect(parseArgs([...base, "--bundle", "x.json", "--r-file", "r.hex"], refuteCmd).opts["r-file"]).toBe("r.hex");
  });

  it("0600 file: read; readable by others: refused; invalid content: refused without being echoed", async () => {
    const f = join(dir, "r.hex");
    saveR(f, toBytes(R)); // écrit en 0600, jamais par-dessus un fichier existant
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(() => saveR(f, toBytes(R))).toThrow(/existe déjà/);
    expect(await readR(f)).toBe(R);
    chmodSync(f, 0o644);
    await expect(readR(f)).rejects.toThrow(/lisible par d'autres/);
    const j = join(dir, "r.json");
    writeFileSync(j, JSON.stringify({ r: R.toUpperCase().replace("0X", "0x") }), { mode: 0o600 });
    expect(await readR(j)).toBe(R);
    expect(() => parseR("0xSECRET-NOT-HEX", "r.txt")).toThrow(CliError);
    try { parseR("0xSECRET-NOT-HEX", "r.txt"); } catch (e) { expect((e as Error).message).not.toContain("SECRET"); }
  });

  it("standard input (--r-file -): read when redirected; refused from a terminal (the input would be shown)", async () => {
    expect(await readR("-", Readable.from([`${R}\n`]) as any)).toBe(R);
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    await expect(readR("-", tty as any)).rejects.toThrow(/redirigez r/);
  });
});

describe("5 — CLI: one X25519 key per bounty; --reveal-key says exactly what it opens", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "arcvault-keys-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const D = { sealedBounty: "0x182871d34438aB37a7FD4d8689f3e0812E447A9b", chainId: 5042002 };

  it("two bounties = two keys, two 0600 files named after the public key; an existing file is never overwritten", () => {
    const a = createBountyKey({ dir, ...D });
    const b = createBountyKey({ dir, ...D });
    expect(a.key.publicKey).not.toBe(b.key.publicKey);
    expect(a.path).toBe(bountyKeyPath(a.key.publicKey, dir));
    for (const k of [a, b]) {
      expect(statSync(k.path).mode & 0o777).toBe(0o600);
      expect(loadProtocolKey(k.path).publicKey).toBe(k.key.publicKey);
    }
    expect(() => createBountyKey({ path: a.path, ...D })).toThrow(/existe déjà/);
    recordBountyId(a.path, 7n);
    expect(JSON.parse(readFileSync(a.path, "utf8")).bountyId).toBe("7");
    expect(statSync(a.path).mode & 0o777).toBe(0o600);
  });

  it("found through the bounty's public key (Bounty.protocolX25519); the earlier shared key is still read, and flagged", () => {
    const a = createBountyKey({ dir, ...D });
    expect(findBountyKey(a.key.publicKey.toUpperCase().replace("0X", "0x") as Hex, { dir, legacyPath: join(dir, "nope.json") })).toMatchObject({ path: a.path, shared: false });
    const legacyPath = join(dir, "legacy", "protocol-x25519.json");
    const legacy = createBountyKey({ path: legacyPath, ...D });
    expect(findBountyKey(legacy.key.publicKey, { dir: join(dir, "vide"), legacyPath })).toMatchObject({ path: legacyPath, shared: true });
    expect(() => findBountyKey(generateX25519().publicKey, { dir, legacyPath })).toThrow(/aucune clé locale/);
    expect(() => findBountyKey(legacy.key.publicKey, { path: a.path })).toThrow(/n'est pas celle de la prime/);
    chmodSync(a.path, 0o640);
    expect(() => loadProtocolKey(a.path)).toThrow(/lisible par d'autres/);
    expect(existsSync(legacyPath)).toBe(true);
  });

  it("the --reveal-key warning names exactly the bounties the key opens", () => {
    const pk = ("0x" + "cd".repeat(32)) as Hex;
    expect(revealKeyWarning({ publicKey: pk, bountyId: 3n, sharing: [3n] })).toMatch(/ceux de la prime #3 seulement \(aucune autre prime n'utilise cette clé\)$/);
    expect(revealKeyWarning({ publicKey: pk, bountyId: 3n, sharing: [7n, 3n, 4n, 4n] })).toMatch(/ceux de la prime #3 ET ceux des primes #4, #7, qui utilisent la même clé$/);
    expect(revealKeyWarning({ publicKey: pk, bountyId: 3n })).toMatch(/toute autre prime créée avec la même clé \(liste des primes illisible\)$/);
    for (const w of [revealKeyWarning({ publicKey: pk, bountyId: 3n, sharing: [3n] })]) {
      expect(w).toContain(pk);
      expect(w).toMatch(/TOUT rapport chiffré vers cette clé publique/);
      expect(w).not.toMatch(/n'ouvre que les rapports de cette prime/); // l'ancien message, faux pour une clé partagée
    }
  });
});

describe("CLI: tiers are read up to the EVM revert (code 3) only", () => {
  const abi = parseAbi([
    "function tierMinLoss(uint256 bountyId, uint256 index) view returns (uint256)",
    "function tierAmount(uint256 bountyId, uint256 index) view returns (uint256)",
  ]);
  const pub = (failAt: number, code: number) => createPublicClient({
    transport: custom({
      async request({ method, params }: { method: string; params?: any }) {
        if (method === "eth_blockNumber") return numberToHex(5n);
        const { functionName, args } = decodeFunctionData({ abi, data: params[0].data });
        const i = Number(args[1]);
        if (i >= failAt) throw Object.assign(new Error(code === 3 ? "execution reverted" : "internal error"), { code });
        return encodeFunctionResult({ abi, functionName, result: BigInt((i + 1) * (functionName === "tierMinLoss" ? 10 : 1)) });
      },
    }, { retryCount: 0 }),
  });
  it("end of array = revert (code 3, with no data, like Arc's public RPC); internal error -32603 = it is raised (never truncated)", async () => {
    expect(await readTiers(pub(2, 3) as any, 1n)).toEqual([{ minLoss: 10n, amount: 1n }, { minLoss: 20n, amount: 2n }]);
    await expect(readTiers(pub(1, -32603) as any, 1n)).rejects.toThrow();
  });
});

void ({} as Address);
