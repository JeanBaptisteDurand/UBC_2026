/**
 * Preuves d'état (EIP-1186) vérifiées contre le stateRoot d'un VRAI bloc d'Arc testnet (capturé le 10/11/2026 sur
 * rpc.blockdaemon.testnet.arc.io, test/fixtures/arc-testnet-state-proofs.json) : comptes avec et sans code, compte
 * absent, cases nulles et non nulles, code du registre ; puis toutes les façons de mentir que la vérification doit refuser.
 */
import { readFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { blockHeaderHash } from "../src/services/rpc-relay.js";
import {
  EMPTY_CODE_HASH, EMPTY_TRIE_ROOT, StateProofError, checkCode, checkProofResult, slotKey, verifyAccountProof, verifyMptProof,
} from "../src/services/state-proof.js";

type Proof = {
  address: Hex; balance: string; nonce: string; codeHash: Hex; storageHash: Hex; accountProof: Hex[];
  storageProof: { key: string; value: string; proof: Hex[] }[];
};
const fx = JSON.parse(readFileSync(new URL("./fixtures/arc-testnet-state-proofs.json", import.meta.url), "utf8")) as {
  block: Record<string, unknown> & { hash: Hex; stateRoot: Hex; parentHash: Hex; number: string };
  proofs: Proof[];
  code: { address: Hex; code: Hex };
};
const root = fx.block.stateRoot;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const slotsOf = (p: Proof) => p.storageProof.map((s) => s.key);
const flipLastByte = (h: Hex): Hex => `${h.slice(0, -2)}${((parseInt(h.slice(-2), 16) ^ 1) >>> 0).toString(16).padStart(2, "0")}` as Hex;

describe("preuves d'état sur un vrai bloc d'Arc testnet", () => {
  it("l'en-tête capturé redonne son hash (le stateRoot est donc celui du bloc)", () => {
    expect(blockHeaderHash(fx.block)).toBe(fx.block.hash.toLowerCase());
  });

  it("chaque compte et chaque case se prouvent, et les valeurs prouvées sont celles annoncées", () => {
    let nonZero = 0;
    for (const p of fx.proofs) {
      const r = checkProofResult(root, p.address, slotsOf(p), p);
      expect(r.account.balance).toBe(BigInt(p.balance));
      expect(r.account.nonce).toBe(BigInt(p.nonce));
      expect(r.account.codeHash).toBe(p.codeHash.toLowerCase());
      for (const s of p.storageProof) {
        expect(r.storage.get(slotKey(s.key))).toBe(BigInt(s.value));
        if (BigInt(s.value) !== 0n) nonZero++;
      }
    }
    expect(nonZero).toBeGreaterThan(0); // le jeu contient de vraies cases non nulles
  });

  it("un compte inexistant est prouvé ABSENT (valeurs d'un compte vide)", () => {
    const p = fx.proofs.find((x) => x.address.toLowerCase() === "0x582a0000000000000000000000000000000000aa")!;
    const a = verifyAccountProof(root, p.address, p.accountProof);
    expect(a.exists).toBe(false);
    expect(a.balance).toBe(0n);
    expect(a.codeHash).toBe(EMPTY_CODE_HASH);
    expect(a.storageRoot).toBe(EMPTY_TRIE_ROOT);
    expect(checkProofResult(root, p.address, slotsOf(p), p).storage.get(slotKey("0x0"))).toBe(0n);
  });

  it("DURCISSEMENT #5 : compte absent aux hash NULS (style geth) accepté ; compte présent aux hash nuls refusé", () => {
    const ZERO = `0x${"00".repeat(32)}` as Hex;
    const p = clone(fx.proofs.find((x) => x.address.toLowerCase() === "0x582a0000000000000000000000000000000000aa")!);
    p.codeHash = ZERO;
    p.storageHash = ZERO; // ce que renvoie un RPC de type geth pour un compte inexistant
    expect(checkProofResult(root, p.address, slotsOf(p), p).account.exists).toBe(false);
    const q = clone(fx.proofs[0]!); // USDC : compte PRÉSENT ; des hash nuls restent refusés
    q.codeHash = ZERO;
    q.storageHash = ZERO;
    expect(() => checkProofResult(root, q.address, slotsOf(q), q)).toThrow(StateProofError);
  });

  it("le code du registre redonne le hash de code prouvé", () => {
    const p = fx.proofs.find((x) => x.address.toLowerCase() === fx.code.address.toLowerCase())!;
    const a = verifyAccountProof(root, p.address, p.accountProof);
    expect(checkCode(a, fx.code.code)).toBe(fx.code.code.toLowerCase());
    expect(keccak256(fx.code.code)).toBe(a.codeHash);
  });
});

describe("toutes les façons de mentir sont refusées", () => {
  const usdc = fx.proofs[0]!;
  const expectRefused = (f: () => unknown) => expect(f).toThrow(StateProofError);

  it("solde, nonce, hash de code ou racine de stockage annoncés autrement que prouvés", () => {
    for (const field of ["balance", "nonce"] as const) {
      const p = clone(usdc);
      p[field] = `0x${(BigInt(p[field]) + 1n).toString(16)}`;
      expectRefused(() => checkProofResult(root, p.address, slotsOf(p), p));
    }
    const q = clone(usdc);
    q.codeHash = EMPTY_CODE_HASH;
    expectRefused(() => checkProofResult(root, q.address, slotsOf(q), q));
    const s = clone(usdc);
    s.storageHash = EMPTY_TRIE_ROOT;
    expectRefused(() => checkProofResult(root, s.address, slotsOf(s), s));
  });

  it("un nœud modifié, retiré ou ajouté", () => {
    const a = clone(usdc);
    a.accountProof[a.accountProof.length - 1] = flipLastByte(a.accountProof[a.accountProof.length - 1]!);
    expectRefused(() => checkProofResult(root, a.address, slotsOf(a), a));
    const b = clone(usdc);
    b.accountProof.pop();
    expectRefused(() => checkProofResult(root, b.address, slotsOf(b), b));
    const c = clone(usdc);
    c.accountProof.push(c.accountProof[0]!);
    expectRefused(() => checkProofResult(root, c.address, slotsOf(c), c));
    const d = clone(usdc);
    d.accountProof = [...d.accountProof.slice(1)];
    expectRefused(() => checkProofResult(root, d.address, slotsOf(d), d));
  });

  it("une preuve contre un autre bloc (stateRoot différent)", () => {
    expectRefused(() => checkProofResult(fx.block.parentHash, usdc.address, slotsOf(usdc), usdc));
  });

  it("la preuve d'un autre compte présentée pour celui-ci", () => {
    const other = fx.proofs[2]!;
    const p = { ...clone(other), address: usdc.address };
    expectRefused(() => checkProofResult(root, usdc.address, slotsOf(p), p));
  });

  it("une case : valeur annoncée fausse, preuve d'une autre case, ordre changé, preuve tronquée", () => {
    const nz = usdc.storageProof.findIndex((s) => BigInt(s.value) !== 0n);
    expect(nz).toBeGreaterThanOrEqual(0);
    const a = clone(usdc);
    a.storageProof[nz]!.value = `0x${(BigInt(a.storageProof[nz]!.value) + 1n).toString(16)}`;
    expectRefused(() => checkProofResult(root, a.address, slotsOf(usdc), a));
    const b = clone(usdc);
    const other = (nz + 1) % b.storageProof.length;
    b.storageProof[nz]!.proof = clone(usdc.storageProof[other]!.proof);
    b.storageProof[nz]!.value = usdc.storageProof[other]!.value;
    expectRefused(() => checkProofResult(root, b.address, slotsOf(usdc), b));
    const c = clone(usdc);
    c.storageProof.reverse();
    expectRefused(() => checkProofResult(root, c.address, slotsOf(usdc), c));
    const d = clone(usdc);
    d.storageProof[nz]!.proof.pop();
    expectRefused(() => checkProofResult(root, d.address, slotsOf(usdc), d));
  });

  it("une case non nulle annoncée nulle (ou l'inverse)", () => {
    const nz = usdc.storageProof.findIndex((s) => BigInt(s.value) !== 0n);
    const z = usdc.storageProof.findIndex((s) => BigInt(s.value) === 0n);
    const a = clone(usdc);
    a.storageProof[nz]!.value = "0x0";
    expectRefused(() => checkProofResult(root, a.address, slotsOf(usdc), a));
    if (z >= 0) {
      const b = clone(usdc);
      b.storageProof[z]!.value = "0x1";
      expectRefused(() => checkProofResult(root, b.address, slotsOf(usdc), b));
    }
  });

  it("un compte absent annoncé avec un solde", () => {
    const p = clone(fx.proofs.find((x) => x.address.toLowerCase() === "0x582a0000000000000000000000000000000000aa")!);
    p.balance = "0x1";
    expectRefused(() => checkProofResult(root, p.address, slotsOf(p), p));
  });

  it("un code qui n'est pas celui du compte prouvé", () => {
    const p = fx.proofs.find((x) => x.address.toLowerCase() === fx.code.address.toLowerCase())!;
    const a = verifyAccountProof(root, p.address, p.accountProof);
    expectRefused(() => checkCode(a, `${fx.code.code}00`));
    expectRefused(() => checkCode(a, "0x"));
  });

  it("formes hostiles : racine ou clé mal formées, nœuds non hexadécimaux, preuve géante", () => {
    expectRefused(() => verifyMptProof("0x1234" as Hex, keccak256("0x01"), []));
    expectRefused(() => verifyMptProof(root, keccak256("0x01"), [123]));
    expectRefused(() => verifyMptProof(root, keccak256("0x01"), ["0xzz"]));
    expectRefused(() => verifyMptProof(root, keccak256("0x01"), new Array(200).fill(usdc.accountProof[0])));
    expectRefused(() => verifyMptProof(root, keccak256("0x01"), []));
  });

  it("arbre vide : absence prouvée sans nœud, ou par le nœud vide", () => {
    expect(verifyMptProof(EMPTY_TRIE_ROOT, keccak256("0x01"), [])).toBeNull();
    expect(verifyMptProof(EMPTY_TRIE_ROOT, keccak256("0x01"), ["0x80"])).toBeNull();
  });
});
