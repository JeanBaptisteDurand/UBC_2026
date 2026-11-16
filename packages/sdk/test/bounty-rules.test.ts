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

describe("2 — prédicat : mêmes règles dans le SDK et dans l'enclave ; refus à la création", () => {
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

  it("chaque prédicat du corpus reçoit le MÊME verdict (et le même hash) du SDK et de l'enclave", () => {
    for (const p of corpus) {
      const sdkV = verdict(validatePredicate, p);
      expect(sdkV).toBe(verdict(enclave.validatePredicate, p));
      expect(sdkV.startsWith("AUTRE")).toBe(false); // jamais une RangeError ou une erreur hors règle
      if (sdkV === "ok") expect(predicateHash(p as Predicate)).toBe(enclave.predicateHash(p as any));
    }
    expect(PREDICATE_MAX_DEPTH).toBe(enclave.PREDICATE_MAX_DEPTH);
  });

  it("refus à la création : predicateHash lève PredicateError pour un prédicat hors règles ; la CLI le refuse avec un message clair", () => {
    expect(() => predicateHash({ combine: "OR", clauses: [{ ...c0, x: deep(9_000) } as any] })).toThrow(PredicateError);
    expect(() => loadPredicate({ combine: "OR", clauses: [{ ...c0, x: deep(9_000) }] }, "predicat.json")).toThrow(CliError);
    expect(() => loadPredicate({ combine: "OR", clauses: [{ ...c0, x: deep(9_000) }] }, "predicat.json")).toThrow(/predicat\.json : prédicat invalide \(prédicat : imbrication de plus de 8 niveaux\)/);
    expect(() => loadPredicate({ combine: "OR", clauses: [{ ...c0, token: "0xabc" }] }, "p.json")).toThrow(/clause 1 : token doit être une adresse/);
    expect(loadPredicate(PRED, "p.json")).toBe(PRED);
  });

  it("checkRefuteSource (clé de la prime) annonce la faute que signeront les enclaves : prédicat hors forme, rapport trop imbriqué", () => {
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

describe("4 — CLI : r dans un fichier 0600 ou sur l'entrée standard, jamais en argument", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "arcvault-r-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const R = ("0x" + "ab".repeat(32)) as Hex;

  it("--r <0x…> est refusé (historique du shell, liste des processus) ; --r-file est accepté", () => {
    const base = ["--claim", "0x" + "11".repeat(32), "--enclave", "https://e.example"];
    expect(() => parseArgs([...base, "--r", R], refuteCmd)).toThrow(UsageError);
    expect(() => parseArgs([...base, `--r=${R}`], refuteCmd)).toThrow(/--r n'est plus accepté/);
    expect(parseArgs([...base, "--bundle", "x.json", "--r-file", "r.hex"], refuteCmd).opts["r-file"]).toBe("r.hex");
  });

  it("fichier 0600 : lu ; lisible par d'autres : refusé ; contenu invalide : refusé sans être recopié", async () => {
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
    expect(() => parseR("0xSECRET-PAS-HEX", "r.txt")).toThrow(CliError);
    try { parseR("0xSECRET-PAS-HEX", "r.txt"); } catch (e) { expect((e as Error).message).not.toContain("SECRET"); }
  });

  it("entrée standard (--r-file -) : lue si redirigée ; refusée depuis un terminal (la saisie s'afficherait)", async () => {
    expect(await readR("-", Readable.from([`${R}\n`]) as any)).toBe(R);
    const tty = Object.assign(Readable.from([]), { isTTY: true });
    await expect(readR("-", tty as any)).rejects.toThrow(/redirigez r/);
  });
});

describe("5 — CLI : une clé X25519 par prime ; --reveal-key dit exactement ce qu'elle ouvre", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "arcvault-keys-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const D = { sealedBounty: "0x182871d34438aB37a7FD4d8689f3e0812E447A9b", chainId: 5042002 };

  it("deux primes = deux clés, deux fichiers 0600 nommés par la clé publique ; jamais un fichier existant écrasé", () => {
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

  it("retrouvée par la clé publique de la prime (Bounty.protocolX25519) ; l'ancienne clé partagée encore lue, signalée", () => {
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

  it("l'avertissement de --reveal-key nomme exactement les primes que la clé ouvre", () => {
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

describe("CLI : paliers lus jusqu'au revert EVM (code 3) seulement", () => {
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
  it("fin de tableau = revert (code 3, sans données comme le RPC public d'Arc) ; erreur interne -32603 = elle remonte (jamais tronqués)", async () => {
    expect(await readTiers(pub(2, 3) as any, 1n)).toEqual([{ minLoss: 10n, amount: 1n }, { minLoss: 20n, amount: 2n }]);
    await expect(readTiers(pub(1, -32603) as any, 1n)).rejects.toThrow();
  });
});

void ({} as Address);
