/**
 * Sealed Bounty v2.1 quater: the DELIBERATE fault of the refutation demo (DEMO_FAULT=inflate-loss), with a FAKE
 * deterministic replay engine (the local chain, the real contract and the real replay: bounty-demo-fault-chain.test.ts):
 *  - the faulty enclave signs a claim with a DOUBLED loss and everything else identical (block N, predicate, tier of the
 *    MEASURED loss, fingerprint, cPHash, deadline); the digest is recomputed by hand as SealedBounty does; without the
 *    fault, nothing changes;
 *  - two honest enclaves of distinct operators refute it ("proven, real loss") and the refutation passes the rules of
 *    SealedBounty.refute, recomputed here from the contract (digests, signers, quorum, operators distinct and foreign
 *    to the claim, a different result); the faulty enclave itself refutes honestly;
 *  - /pubkeys and /health announce it, and only it;
 *  - safeguards: product 2, an absent PRODUCT_ID, OPERATOR_ALLOWLIST=* or the main operator, an unknown value → refused;
 *    the REAL server (products/sealed-bounty/server.ts, started by tsx) refuses to start with PRODUCT_ID=2 and DEMO_FAULT.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Address, type Hex, concat, encodeAbiParameters, getAddress, keccak256, numberToHex, recoverAddress, toBytes, toHex, zeroAddress, zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x25519 } from "@noble/curves/ed25519";
import { EnclaveKit } from "../src/kit/enclave-kit";
import { domain, type Claim } from "../src/kit/eip712";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { predicateHash, type EvalContext, type Predicate } from "../src/services/predicate";
import {
  BountyService, DEMO_FAULT_FORBIDDEN_PRODUCTS, DeterministicProtocolCipher, RefutationService, claimDigestOf, claimOperatorsHash,
  refutationTypes, refuteRequestAad,
  type BountyView, type ExploitBundle, type ForkRunner, type RefuteChainView, type RefuteReader, type RefuteResult, type Refutation, type SubmitResult,
} from "../src/services/bounty";
import { createSealedBountyApp } from "../products/sealed-bounty/app";
import { DEMO_FAULT_NOTE, PROTECTED_OPERATORS, parseDemoFault } from "../products/sealed-bounty/demo-fault";

const CHAIN = 5042002;
const SEALED = "0x182871d34438aB37a7FD4d8689f3e0812E447A9b" as Address;
const REGISTRY = "0xf627e7f40c7a0F50bA3eAFf2D459352EdB5DC59d" as Address;
const DEMO_PRODUCT = 5n;
const TOKEN = "0x3600000000000000000000000000000000000000" as Address;
const VAULT = "0x0000000000000000000000000000000000000d01" as Address;
const HUNTER = "0x0000000000000000000000000000000000000012" as Address;
const OP_A = getAddress("0x000000000000000000000000000000000000a001"); // the lying enclave's operator
const OP_B = getAddress("0x000000000000000000000000000000000000b002");
const OP_C = getAddress("0x000000000000000000000000000000000000c003");
const OP_D = getAddress("0x000000000000000000000000000000000000d004");
const NOW = 1_000_000n;
const WINDOW = 259_200n;
const R = ("0x" + "31".repeat(32)) as Hex;
const TXS = ["0xc0ffee"] as Hex[];
const REAL_LOSS = 6_000_000n; // what the replay measures; tier 0 (≥ 1 USDC); doubled, it would reach tier 1 (≥ 10 USDC)

const utf8 = (s: string) => new TextEncoder().encode(s);
const pred: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: TOKEN, holder: VAULT, min: "1000000" }] };
const protocol = generateEnclaveKeys(); // the bounty's X25519 key
const view: BountyView = { predicateHash: predicateHash(pred), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [1_000_000n, 10_000_000n], deadline: 9_000_000n };

const newKit = (productId = DEMO_PRODUCT) => new EnclaveKit({ productId, chainId: CHAIN, registry: REGISTRY, mockBlockHash: true });

/** A fake deterministic engine: the measured loss is the one it is given; the same shape rules as the real one. */
function fakeFork(loss: bigint) {
  const f = {
    runs: 0,
    async run(_: { blockN: bigint; bundle: ExploitBundle }) {
      f.runs++;
      const ctx: EvalContext = { erc20Drop: () => loss, nativeDrop: () => 0n, attackerProfit: () => 0n, viewValue: () => 0n, invariantHeld: () => true };
      return { ctx };
    },
    validate(b: ExploitBundle) {
      if (!Array.isArray(b.txs) || b.txs.length < 1 || b.txs.length > 10) throw new Error("1 to 10 transactions");
    },
  };
  return f satisfies ForkRunner;
}

const blocks = { current: async () => 2_000n, blockHash: async (n: bigint) => keccak256(numberToHex(n, { size: 32 })) };

/** A Sealed Bounty enclave (claims), lying or not, and its engine. */
function claimer(o: { demoFault?: "inflate-loss"; kit?: EnclaveKit } = {}) {
  const kit = o.kit ?? newKit();
  const fork = fakeFork(REAL_LOSS);
  const service = new BountyService(
    kit, { sealedBounty: SEALED, ...(o.demoFault ? { demoFault: o.demoFault } : {}) }, { getBounty: async () => view },
    new DeterministicProtocolCipher(), fork, blocks, () => NOW,
  );
  return { kit, fork, service };
}

/** The hunter submits the same exploit (same r, same block N, same deadline): the claim depends only on the enclave. */
async function submit(c: ReturnType<typeof claimer>) {
  const base: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: 0n, predicate: pred, txs: TXS, r: R, cP: "0x" };
  const cP = await new DeterministicProtocolCipher().recompute(base, protocol.x25519PublicKey);
  const plain = { bountyId: "1", payee: HUNTER, capital: "0", predicate: pred, txs: TXS, r: R, cP, blockN: "1990", deadline: String(NOW + 300n) };
  const cE = await seal(toBytes(c.kit.keys.x25519PublicKey), utf8(JSON.stringify(plain)));
  const res = (await c.service.submit(cE)) as Extract<SubmitResult, { status: "proven" }>;
  expect(res.status).toBe("proven");
  return { ...res, cE };
}

/** The chain as the refuting enclaves see it: claimRecords, window, bounty, the active operator of each signer. */
class FakeChain implements RefuteReader {
  records = new Map<string, { acceptedAt: bigint; refuted: boolean; opsHash: Hex }>();
  active = new Map<string, Address>();
  now = NOW + 3_600n;
  accept(claim: Claim, ops: Address[]): Hex {
    const d = claimDigestOf(SEALED, claim, CHAIN);
    this.records.set(d.toLowerCase(), { acceptedAt: NOW, refuted: false, opsHash: claimOperatorsHash(ops) });
    return d;
  }
  async read(q: { claimDigest: Hex; signer: Address }): Promise<RefuteChainView> {
    return {
      block: 5_000n, blockTimestamp: this.now, refuteWindow: WINDOW, bounty: { ...view, productId: DEMO_PRODUCT },
      record: this.records.get(q.claimDigest.toLowerCase()) ?? { acceptedAt: 0n, refuted: false, opsHash: zeroHash },
      myOperator: this.active.get(q.signer.toLowerCase()) ?? zeroAddress,
    };
  }
}

/** A refuting enclave of operator `op` (its own key, its own engine, which measures the REAL loss). */
function refuter(chain: FakeChain, op: Address, kit = newKit()) {
  chain.active.set(kit.keys.signer.toLowerCase(), op);
  const fork = fakeFork(REAL_LOSS);
  return { kit, fork, op, service: new RefutationService(kit, { sealedBounty: SEALED }, chain, new DeterministicProtocolCipher(), fork) };
}

const sharedSecretOf = (cP: Hex) => toHex(x25519.getSharedSecret(protocol.x25519PrivateKey, toBytes(cP).slice(0, 32)));

/** The PROTOCOL's refutation request (cP + the secret of this one report), encrypted to `kit` for THIS claim. */
async function protocolRequest(kit: EnclaveKit, claim: Claim, operators: Address[], cP: Hex) {
  const s = await seal(
    toBytes(kit.keys.x25519PublicKey), utf8(JSON.stringify({ from: "protocol", cP, sharedSecret: sharedSecretOf(cP) })),
    refuteRequestAad(claimDigestOf(SEALED, claim, CHAIN)),
  );
  return { claim, operators, enc: s.enc, ciphertext: s.ciphertext };
}

const refutedOf = (r: RefuteResult) => {
  expect(r.status).toBe("refuted");
  return r as Extract<RefuteResult, { status: "refuted" }>;
};

// ---- the contract, read from its source: typehash, domain, constants; digests and refute rules recomputed by hand ----
const SOL = readFileSync(new URL("../../contracts/src/SealedBounty.sol", import.meta.url), "utf8");
const REFUTATION_TYPE = /REFUTATION_TYPEHASH =\s*keccak256\("([^"]+)"\)/.exec(SOL)![1]!;
const CLAIM_TYPE = /CLAIM_TYPEHASH = keccak256\(\s*"([^"]+)"\s*\)/.exec(SOL)![1]!;
const [, DOMAIN_NAME, DOMAIN_VERSION] = /EIP712\("([^"]+)", "([^"]+)"\)/.exec(SOL)!;
const REFUTE_QUORUM = BigInt(/REFUTE_QUORUM = (\d+);/.exec(SOL)![1]!);
const MAX_SIGS = BigInt(/MAX_SIGS = (\d+);/.exec(SOL)![1]!);
const SOL_WINDOW = /REFUTE_WINDOW = (\d+) days;/.exec(SOL)![1]!;
const DOMAIN_SEPARATOR = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")), keccak256(toBytes(DOMAIN_NAME!)), keccak256(toBytes(DOMAIN_VERSION!)), BigInt(CHAIN), SEALED],
  ),
);
/** _hashTypedDataV4(_claimHash(r)) */
function claimDigestByHand(c: Claim): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }],
      [keccak256(toBytes(CLAIM_TYPE)), c.bountyId, c.payee, c.blockN, c.blockHashN, c.predicateHash, c.loss, c.tier, c.fingerprint, c.cPHash, c.deadline],
    ),
  );
  return keccak256(concat(["0x1901", DOMAIN_SEPARATOR, structHash]));
}
/** _hashTypedDataV4(keccak256(abi.encode(REFUTATION_TYPEHASH, claimDigest, proven, loss, tier))) */
function refutationDigestByHand(f: Refutation): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bool" }, { type: "uint256" }, { type: "uint8" }],
      [keccak256(toBytes(REFUTATION_TYPE)), f.claimDigest, f.proven, f.loss, f.tier],
    ),
  );
  return keccak256(concat(["0x1901", DOMAIN_SEPARATOR, structHash]));
}

/**
 * SealedBounty.refute + _countRefuters, in the contract's order (the name of the error it would raise, or "ok"); the
 * active operator of a key (EnclaveRegistry.activeOperatorAt at the current block) is given by `activeOf`.
 */
async function contractRefute(a: {
  claim: Claim; ops: Address[]; record: { acceptedAt: bigint; refuted: boolean; opsHash: Hex }; now: bigint;
  f: Refutation; sigs: Hex[]; activeOf: (signer: Address) => Address;
}): Promise<string> {
  const digest = claimDigestByHand(a.claim);
  if (a.record.acceptedAt === 0n) return "UnknownClaim";
  if (a.record.refuted) return "AlreadyRefuted";
  if (a.now > a.record.acceptedAt + BigInt(SOL_WINDOW) * 86_400n) return "RefuteWindowOver";
  if (claimOperatorsHash(a.ops).toLowerCase() !== a.record.opsHash.toLowerCase()) return "BadOps";
  if (a.f.claimDigest.toLowerCase() !== digest.toLowerCase()) return "NotARefutation";
  if (a.f.proven && a.f.loss === a.claim.loss && a.f.tier === a.claim.tier) return "NotARefutation";
  if (a.sigs.length === 0 || BigInt(a.sigs.length) > 2n * MAX_SIGS) return "NeedMoreRefuters";
  const d = refutationDigestByHand(a.f);
  const seen: string[] = [];
  for (const sig of a.sigs) {
    const op = a.activeOf(await recoverAddress({ hash: d, signature: sig })).toLowerCase();
    if (op === zeroAddress) return "NoValidSigner";
    if (a.ops.some((o) => o.toLowerCase() === op)) return "RefuterIsClaimOperator";
    if (!seen.includes(op)) seen.push(op);
  }
  if (BigInt(seen.length) < REFUTE_QUORUM || seen.length <= a.ops.length) return "NeedMoreRefuters";
  return "ok";
}

/** SealedBounty._tierPayout: is the claim payable as it is? */
function tierPayable(c: Claim): boolean {
  return c.tier < view.tierMinLoss.length && c.loss >= view.tierMinLoss[c.tier]!;
}

describe("DEMO_FAULT=inflate-loss: the faulty enclave signs a doubled loss, the rest identical", () => {
  it("the constants read from SealedBounty.sol are the ones the demo assumes", () => {
    expect(REFUTATION_TYPE).toBe("Refutation(bytes32 claimDigest,bool proven,uint256 loss,uint8 tier)");
    expect([DOMAIN_NAME, DOMAIN_VERSION, REFUTE_QUORUM, MAX_SIGS, SOL_WINDOW]).toEqual(["ArcEnclaveNetwork", "1", 2n, 5n, "3"]);
    expect(DEMO_FAULT_FORBIDDEN_PRODUCTS).toEqual([2n]);
  });

  it("without the fault: the measured loss; with it: 2 × the measured loss, the tier of the MEASURED loss, everything else identical", async () => {
    const honest = await submit(claimer());
    const liar = claimer({ demoFault: "inflate-loss" });
    expect(liar.service.demoFault).toBe("inflate-loss");
    expect(claimer().service.demoFault).toBeUndefined();
    const lie = await submit(liar);

    expect(honest.claim.loss).toBe(REAL_LOSS);
    expect(lie.claim.loss).toBe(2n * REAL_LOSS);
    expect(lie.claim.tier).toBe(0); // 12 USDC would reach tier 1: the fault touches ONLY the loss
    expect({ ...lie.claim, loss: REAL_LOSS }).toEqual(honest.claim);
    expect(lie.cP).toBe(honest.cP);
    expect(tierPayable(lie.claim)).toBe(true); // the contract would accept it (loss ≥ tierMinLoss[tier])

    // the signature covers the DOUBLED claim (digest recomputed as the contract does) and comes from the faulty enclave
    const digest = claimDigestByHand(lie.claim);
    expect(claimDigestOf(SEALED, lie.claim, CHAIN)).toBe(digest);
    expect((await recoverAddress({ hash: digest, signature: lie.signature })).toLowerCase()).toBe(liar.kit.keys.signer.toLowerCase());

    // resubmission: the same doubled claim, the same signature (a consistent anti-equivocation memory)
    const again = (await liar.service.submit(lie.cE)) as Extract<SubmitResult, { status: "proven" }>;
    expect(again.claim).toEqual(lie.claim);
    expect(again.signature).toBe(lie.signature);
  });

  it("two honest enclaves refute it (\"proven\", real loss): the refutation passes the rules of SealedBounty.refute", async () => {
    const liar = claimer({ demoFault: "inflate-loss" });
    const lie = await submit(liar);
    const chain = new FakeChain();
    chain.active.set(liar.kit.keys.signer.toLowerCase(), OP_A);
    const digest = chain.accept(lie.claim, [OP_A]);
    const B = refuter(chain, OP_B);
    const C = refuter(chain, OP_C);

    const rB = refutedOf(await B.service.refute(await protocolRequest(B.kit, lie.claim, [OP_A], lie.cP)));
    const rC = refutedOf(await C.service.refute(await protocolRequest(C.kit, lie.claim, [OP_A], lie.cP)));
    const f: Refutation = { claimDigest: digest, proven: true, loss: REAL_LOSS, tier: 0 };
    expect(rB.refutation).toEqual(f);
    expect(rC.refutation).toEqual(f);
    expect(rB.replay).toMatchObject({ replayed: true, satisfied: true, loss: REAL_LOSS, tier: 0, proven: true, blockN: 1_990n });
    expect([rB.operator, rC.operator]).toEqual([OP_B, OP_C]);

    // signatures recovered over the CONTRACT's digest (typehash and domain read from its source)
    const d = refutationDigestByHand(f);
    expect((await recoverAddress({ hash: d, signature: rB.signature })).toLowerCase()).toBe(B.kit.keys.signer.toLowerCase());
    expect((await recoverAddress({ hash: d, signature: rC.signature })).toLowerCase()).toBe(C.kit.keys.signer.toLowerCase());
    // and the same digest as the one the enclave signs (viem's EIP-712, the kit's domain)
    const viaKit = await privateKeyToAccount(B.kit.keys.signerPrivateKey).signTypedData({
      domain: domain({ chainId: CHAIN, verifyingContract: SEALED }), types: refutationTypes, primaryType: "Refutation", message: f,
    });
    expect(viaKit).toBe(rB.signature);

    // the refute rules, in the contract's order
    const activeOf = (s: Address) => chain.active.get(s.toLowerCase()) ?? zeroAddress;
    const record = chain.records.get(digest.toLowerCase())!;
    const base = { claim: lie.claim, ops: [OP_A], record, now: chain.now, f, activeOf };
    expect(await contractRefute({ ...base, sigs: [rB.signature, rC.signature] })).toBe("ok");
    expect(await contractRefute({ ...base, sigs: [rB.signature] })).toBe("NeedMoreRefuters"); // one single operator
    expect(await contractRefute({ ...base, sigs: [rB.signature, rB.signature] })).toBe("NeedMoreRefuters"); // the same one twice
    // the claim's operator never counts (the contract refuses it; its enclave even refuses to refute)
    const forgedByA = await privateKeyToAccount(liar.kit.keys.signerPrivateKey).signTypedData({
      domain: domain({ chainId: CHAIN, verifyingContract: SEALED }), types: refutationTypes, primaryType: "Refutation", message: f,
    });
    expect(await contractRefute({ ...base, sigs: [forgedByA, rB.signature, rC.signature] })).toBe("RefuterIsClaimOperator");
    const A = new RefutationService(liar.kit, { sealedBounty: SEALED }, chain, new DeterministicProtocolCipher(), fakeFork(REAL_LOSS));
    const selfRefute = await A.refute(await protocolRequest(liar.kit, lie.claim, [OP_A], lie.cP));
    expect(selfRefute).toMatchObject({ status: "refused", code: "claim_operator" });
    // a "refutation" that gives back the claim is not one
    expect(await contractRefute({ ...base, f: { ...f, loss: lie.claim.loss }, sigs: [rB.signature, rC.signature] })).toBe("NotARefutation");
    // outside the window, or already refuted
    expect(await contractRefute({ ...base, now: NOW + WINDOW + 1n, sigs: [rB.signature, rC.signature] })).toBe("RefuteWindowOver");
    expect(await contractRefute({ ...base, record: { ...record, refuted: true }, sigs: [rB.signature, rC.signature] })).toBe("AlreadyRefuted");
  });

  it("the claim of an honest enclave is CONFIRMED: nothing is signed, nothing to refute", async () => {
    const honest = await submit(claimer());
    const chain = new FakeChain();
    chain.accept(honest.claim, [OP_A]);
    const B = refuter(chain, OP_B);
    const r = await B.service.refute(await protocolRequest(B.kit, honest.claim, [OP_A], honest.cP));
    expect(r.status).toBe("confirmed");
    expect(r).not.toHaveProperty("signature");
  });
});

describe("DEMO_FAULT: the HTTP application announces it; its refutations stay honest", () => {
  const attest = { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} };

  it("/pubkeys and /health announce the fault (CORS included); without it, the kit's answers, unchanged", async () => {
    const liar = claimer({ demoFault: "inflate-loss" });
    const lyingApp = createSealedBountyApp({ kit: liar.kit, service: liar.service, attest });
    const h = await lyingApp.request("/health");
    expect(await h.json()).toEqual({ ok: true, demoFault: "inflate-loss", demoFaultNote: DEMO_FAULT_NOTE["inflate-loss"] });
    const p = await lyingApp.request("/pubkeys", { headers: { origin: "https://example.org" } });
    expect(p.headers.get("access-control-allow-origin")).toBe("*");
    expect(await p.json()).toEqual({ ...liar.kit.pubkeys(), demoFault: "inflate-loss", demoFaultNote: DEMO_FAULT_NOTE["inflate-loss"] });
    // the kit's other routes stay served (/attest, here in development mode: a simulated quote)
    const at = await lyingApp.request("/attest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator: OP_A, anchorR: "10" }) });
    expect(at.status).toBe(200);
    expect(((await at.json()) as any).signer).toBe(liar.kit.keys.signer);

    const honest = claimer();
    const honestApp = createSealedBountyApp({ kit: honest.kit, service: honest.service, attest });
    expect(await (await honestApp.request("/health")).json()).toEqual({ ok: true });
    expect(await (await honestApp.request("/pubkeys")).json()).toEqual(honest.kit.pubkeys());
  });

  it("POST /bounty/submit returns the doubled claim; POST /v1/refute of the SAME faulty enclave refutes honestly", async () => {
    const chain = new FakeChain();
    // a faulty enclave A lied; ANOTHER faulty enclave (operator D) receives the refutation request
    const A = claimer({ demoFault: "inflate-loss" });
    const lie = await submit(A);
    const digest = chain.accept(lie.claim, [OP_A]);
    const D = claimer({ demoFault: "inflate-loss" });
    const Dref = refuter(chain, OP_D, D.kit);
    const app = createSealedBountyApp({ kit: D.kit, service: D.service, refuter: Dref.service, attest });

    const own = await submit({ ...D }); // it lies about its own claims…
    expect(own.claim.loss).toBe(2n * REAL_LOSS);
    const q = await protocolRequest(D.kit, lie.claim, [OP_A], lie.cP);
    const body = {
      claim: { ...lie.claim, bountyId: lie.claim.bountyId.toString(), blockN: lie.claim.blockN.toString(), loss: lie.claim.loss.toString(), deadline: lie.claim.deadline.toString() },
      operators: [OP_A], enc: toHex(q.enc), ciphertext: toHex(q.ciphertext),
    };
    const res = await app.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    // …but refutes with the REAL loss (the mode never touches refutations)
    expect(await res.json()).toMatchObject({ status: "refuted", refutation: { claimDigest: digest, proven: true, loss: REAL_LOSS.toString(), tier: 0 }, operator: OP_D });

    const sub = await app.request("/bounty/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enc: toHex(own.cE.enc), ciphertext: toHex(own.cE.ciphertext) }) });
    expect(((await sub.json()) as any).claim.loss).toBe((2n * REAL_LOSS).toString());
  });
});

describe("DEMO_FAULT — garde-fous", () => {
  const A_ADDR = "0x00000000000000000000000000000000000a0a0a";
  it("parseDemoFault: absent or empty → no fault; product 2 or absent, an unknown value, \"*\", the main operator → refused", () => {
    expect(parseDemoFault({}, 2n)).toBeUndefined(); // without the variable, nothing changes, even for product 2
    expect(parseDemoFault({ DEMO_FAULT: "" }, 5n)).toBeUndefined();
    expect(parseDemoFault({ DEMO_FAULT: "  " }, 5n)).toBeUndefined();
    expect(parseDemoFault({ DEMO_FAULT: "inflate-loss", OPERATOR_ALLOWLIST: A_ADDR }, 5n)).toBe("inflate-loss");
    expect(parseDemoFault({ DEMO_FAULT: "inflate-loss" }, 5n)).toBe("inflate-loss"); // empty list: nobody attests (closed)
    expect(() => parseDemoFault({ DEMO_FAULT: "inflate-loss", OPERATOR_ALLOWLIST: A_ADDR }, 2n)).toThrow(/product 2/);
    expect(() => parseDemoFault({ DEMO_FAULT: "inflate-loss", OPERATOR_ALLOWLIST: A_ADDR }, 0n)).toThrow(/PRODUCT_ID/);
    expect(() => parseDemoFault({ DEMO_FAULT: "zero-loss", OPERATOR_ALLOWLIST: A_ADDR }, 5n)).toThrow(/unknown/);
    expect(() => parseDemoFault({ DEMO_FAULT: "inflate-loss", OPERATOR_ALLOWLIST: "*" }, 5n)).toThrow(/OPERATOR_ALLOWLIST=\*/);
    expect(() => parseDemoFault({ DEMO_FAULT: "inflate-loss", OPERATOR_ALLOWLIST: `${A_ADDR},${PROTECTED_OPERATORS[0]!.toLowerCase()}` }, 5n)).toThrow(/main operator/);
    expect(() => parseDemoFault({ DEMO_FAULT: "inflate-loss", OPERATOR_ALLOWLIST: "0x1234" }, 5n)).toThrow(/invalid OPERATOR_ALLOWLIST/);
  });

  it("BountyService refuses a fault on product 2, or an unknown one", () => {
    expect(() => claimer({ demoFault: "inflate-loss", kit: newKit(2n) })).toThrow(/product 2/);
    expect(() => new BountyService(newKit(), { sealedBounty: SEALED, demoFault: "nope" as any }, { getBounty: async () => view }, new DeterministicProtocolCipher(), fakeFork(0n), blocks, () => NOW))
      .toThrow(/unknown/);
    expect(() => claimer({ kit: newKit(2n) })).not.toThrow(); // without a fault: product 2 runs as before
  });

  const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
  const ENCLAVE_DIR = fileURLToPath(new URL("..", import.meta.url));
  const runServer = (env: Record<string, string>) => {
    const clean = { ...process.env };
    for (const k of ["DEMO_FAULT", "OPERATOR_ALLOWLIST", "PRODUCT_ID", "PORT", "ANVIL_BIN"]) delete clean[k];
    return spawnSync(TSX, ["products/sealed-bounty/server.ts"], {
      cwd: ENCLAVE_DIR, encoding: "utf8", timeout: 60_000,
      // the server requires its contract addresses (set and measured by the compose file) before any other check
      env: {
        ...clean, SEALEDBOUNTY: "0x182871d34438aB37a7FD4d8689f3e0812E447A9b", REGISTRY,
        ANVIL_BIN: "/nonexistent/anvil-for-test", PORT: "0", ...env,
      },
    });
  };

  it.skipIf(!existsSync(TSX))("the REAL server refuses to start with PRODUCT_ID=2 and DEMO_FAULT (before anything else)", () => {
    const r = runServer({ PRODUCT_ID: "2", DEMO_FAULT: "inflate-loss", OPERATOR_ALLOWLIST: A_ADDR });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/DEMO_FAULT refused for product 2.*stopping/);
    expect(r.stderr).not.toMatch(/anvil not found/); // stopped BEFORE the engine check
    expect(r.stdout).not.toMatch(/sealed-bounty \(O3\) on/);

    // counter-check: product 5 → the fault's log line, then the stop comes from the missing engine (not from the fault)
    const ok = runServer({ PRODUCT_ID: "5", DEMO_FAULT: "inflate-loss", OPERATOR_ALLOWLIST: A_ADDR });
    expect(ok.status).toBe(1);
    expect(ok.stderr).toMatch(/DEMO_FAULT=inflate-loss: deliberately faulty DEMO enclave \(product 5\)/);
    expect(ok.stderr).toMatch(/anvil not found/);
    // without the variable, product 2 starts as before (here stopped by the missing engine, without a word about the fault)
    const prod = runServer({ PRODUCT_ID: "2", OPERATOR_ALLOWLIST: A_ADDR });
    expect(prod.stderr).toMatch(/anvil not found/);
    expect(prod.stderr).not.toMatch(/DEMO_FAULT/);
  }, 120_000);
});
