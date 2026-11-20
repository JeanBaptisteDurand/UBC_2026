/**
 * Sealed Bounty v2.1: the REFUTATION of an accepted claim (RefutationService, POST /v1/refute), with a FAKE deterministic
 * replay engine (the real replay by anvil is in bounty-refute-anvil.test.ts):
 *  - confirmed (same loss, same tier) → no signature;
 *  - does not reproduce, another loss, another tier → a signed EIP-712 Refutation, with the digest recomputed BY HAND as
 *    SealedBounty._countRefuters does (typehash and domain read from contracts/src/SealedBounty.sol);
 *  - an exploit that does not give back the claim's cPHash (or fingerprint) → refused, nothing replayed or signed;
 *  - the claim's operator, an inactive enclave, outside the window, already refuted, wrong operators → refused;
 *  - cP established but contradicted by the claim (signed fingerprint ≠ cP's, an unreadable report proven with the
 *    bounty's key) → "not proven" without a replay;
 *  - end to end with the SDK: requestRefutations → /v1/refute of several enclaves → prepareRefuteCall; an unreachable
 *    quorum (only one other operator) → nothing is sent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  type Address, type Hex, concat, custom, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getAddress, keccak256,
  numberToHex, pad, parseAbi, recoverAddress, toBytes, toHex, zeroAddress, zeroHash,
} from "viem";
import { x25519 } from "@noble/curves/ed25519";
import { EnclaveKit } from "../src/kit/enclave-kit";
import { type Claim } from "../src/kit/eip712";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { deterministicSeal } from "../src/kit/deterministic-seal";
import { RpcQuorum } from "../src/kit/rpc-quorum";
import { predicateHash, type EvalContext, type Predicate } from "../src/services/predicate";
import {
  BountyService, DeterministicProtocolCipher, RefutationService, canonicalProtocolPlaintext, claimDigestOf, claimOperatorsHash,
  openSealedWithSharedSecret, refuteRequestAad,
  type BountyView, type ExploitBundle, type ForkRunner, type RefuteChainView, type RefuteReader, type RefuteResult, type SubmitResult,
} from "../src/services/bounty";
import { chainRefuteReader, createSealedBountyApp, parseClaimJson } from "../products/sealed-bounty/app";
import * as sdk from "../../packages/sdk/src/index";

const CHAIN = 5042002;
const SEALED = "0x00000000000000000000000000000000000000bb" as Address;
const REGISTRY = "0x0000000000000000000000000000000000000001" as Address;
const PRODUCT = 2n;
const TOKEN = "0x0000000000000000000000000000000000000010" as Address;
const HOLDER = "0x0000000000000000000000000000000000000011" as Address;
const HUNTER = "0x0000000000000000000000000000000000000012" as Address;
const OP_A = getAddress("0x000000000000000000000000000000000000a001"); // signed the claim
const OP_B = getAddress("0x000000000000000000000000000000000000b002");
const OP_C = getAddress("0x000000000000000000000000000000000000c003");
const NOW = 1_000_000n;
const CAPITAL = 1_000_000_000n;
const R = ("0x" + "22".repeat(32)) as Hex;
const TXS = ["0xdeadbeef"] as Hex[];
const WINDOW = 259_200n;

const utf8 = (s: string) => new TextEncoder().encode(s);
const pred: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: TOKEN, holder: HOLDER, min: "1000000" }] };
const protocol = generateEnclaveKeys(); // the bounty's X25519 key (the protocol)
const bountyView: BountyView = { predicateHash: predicateHash(pred), protocolX25519: protocol.x25519PublicKey, tierMinLoss: [1_000_000n, 10_000_000n], deadline: 9_000_000n };

const newKit = () => new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: REGISTRY, mockBlockHash: true });

/** A fake deterministic engine: the measured loss is the one it is given; it counts its replays; the same shape rules as the real one. */
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

/** The chain as the refuting enclaves see it: claimRecords, window, bounty, the active operator of each signer. */
class FakeChain implements RefuteReader {
  records = new Map<string, { acceptedAt: bigint; refuted: boolean; opsHash: Hex }>();
  active = new Map<string, Address>();
  now = NOW + 3_600n;
  bounty = { ...bountyView, productId: PRODUCT };
  accept(claim: Claim, ops: Address[], acceptedAt = NOW): Hex {
    const d = claimDigestOf(SEALED, claim, CHAIN);
    this.records.set(d.toLowerCase(), { acceptedAt, refuted: false, opsHash: claimOperatorsHash(ops) });
    return d;
  }
  async read(q: { claimDigest: Hex; bountyId: bigint; signer: Address }): Promise<RefuteChainView> {
    return {
      block: 5_000n,
      blockTimestamp: this.now,
      record: this.records.get(q.claimDigest.toLowerCase()) ?? { acceptedAt: 0n, refuted: false, opsHash: zeroHash },
      refuteWindow: WINDOW,
      bounty: this.bounty,
      myOperator: this.active.get(q.signer.toLowerCase()) ?? zeroAddress,
    };
  }
}

/** The hunter proves their exploit to enclave A (it has its own engine: it is the one that lies, or not). */
async function claimFrom(lossAtA: bigint, o: { capital?: bigint; view?: BountyView } = {}) {
  const kitA = newKit();
  const blocks = { current: async () => 2_000n, blockHash: async (n: bigint) => keccak256(numberToHex(n, { size: 32 })) };
  const view = o.view ?? bountyView;
  const svc = new BountyService(kitA, { sealedBounty: SEALED }, { getBounty: async () => view }, new DeterministicProtocolCipher(), fakeFork(lossAtA), blocks, () => NOW);
  const base: ExploitBundle = { bountyId: 1n, payee: HUNTER, capital: o.capital ?? CAPITAL, predicate: pred, txs: TXS, r: R, cP: "0x" };
  const cP = await new DeterministicProtocolCipher().recompute(base, protocol.x25519PublicKey);
  const plain = { bountyId: "1", payee: HUNTER, capital: base.capital.toString(), predicate: pred, txs: TXS, r: R, cP, blockN: "1990", deadline: String(NOW + 300n) };
  const cE = await seal(toBytes(kitA.keys.x25519PublicKey), utf8(JSON.stringify(plain)));
  const res = (await svc.submit(cE)) as Extract<SubmitResult, { status: "proven" }>;
  expect(res.status).toBe("proven");
  return { claim: res.claim, cP: res.cP };
}

/** A refuting enclave (operator `op`) and its engine. */
function refuter(chain: FakeChain, op: Address | null, lossSeen: bigint) {
  const kit = newKit();
  if (op) chain.active.set(kit.keys.signer.toLowerCase(), op);
  const fork = fakeFork(lossSeen);
  const service = new RefutationService(kit, { sealedBounty: SEALED }, chain, new DeterministicProtocolCipher(), fork);
  return { kit, fork, service };
}

/** The request, encrypted to `kit` for THIS claim (aad = digest). */
async function request(kit: EnclaveKit, claim: Claim, operators: Address[], plaintext: object) {
  const s = await seal(toBytes(kit.keys.x25519PublicKey), utf8(JSON.stringify(plaintext)), refuteRequestAad(claimDigestOf(SEALED, claim, CHAIN)));
  return { claim, operators, enc: s.enc, ciphertext: s.ciphertext };
}
const hunterPlain = (o: { txs?: Hex[]; capital?: bigint; r?: Hex } = {}) => ({
  from: "hunter", bountyId: "1", payee: HUNTER, capital: (o.capital ?? CAPITAL).toString(), predicate: pred, txs: o.txs ?? TXS, r: o.r ?? R,
});
const sharedSecretOf = (cP: Hex) => toHex(x25519.getSharedSecret(protocol.x25519PrivateKey, toBytes(cP).slice(0, 32)));

const refuted = (r: RefuteResult) => {
  expect(r.status).toBe("refuted");
  return r as Extract<RefuteResult, { status: "refuted" }>;
};
const refusedCode = (r: RefuteResult) => {
  expect(r.status).toBe("refused");
  expect(r).not.toHaveProperty("signature");
  return (r as Extract<RefuteResult, { status: "refused" }>).code;
};

// ---- the contract, read from its source: typehash, domain; digests recomputed by hand ----
const SOL = readFileSync(new URL("../../contracts/src/SealedBounty.sol", import.meta.url), "utf8");
const REFUTATION_TYPE = /REFUTATION_TYPEHASH =\s*keccak256\("([^"]+)"\)/.exec(SOL)![1]!;
const CLAIM_TYPE = /CLAIM_TYPEHASH = keccak256\(\s*"([^"]+)"\s*\)/.exec(SOL)![1]!;
const [, DOMAIN_NAME, DOMAIN_VERSION] = /EIP712\("([^"]+)", "([^"]+)"\)/.exec(SOL)!;
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
/** SealedBounty._countRefuters: _hashTypedDataV4(keccak256(abi.encode(REFUTATION_TYPEHASH, claimDigest, proven, loss, tier))) */
function refutationDigestByHand(f: { claimDigest: Hex; proven: boolean; loss: bigint; tier: number }): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bool" }, { type: "uint256" }, { type: "uint8" }],
      [keccak256(toBytes(REFUTATION_TYPE)), f.claimDigest, f.proven, f.loss, f.tier],
    ),
  );
  return keccak256(concat(["0x1901", DOMAIN_SEPARATOR, structHash]));
}

describe("refutation: the counter-replay signs only what contradicts the claim", () => {
  it("the enclave's typehash and domain are those of SealedBounty.sol", () => {
    expect(REFUTATION_TYPE).toBe("Refutation(bytes32 claimDigest,bool proven,uint256 loss,uint8 tier)");
    expect(DOMAIN_NAME).toBe("ArcEnclaveNetwork");
    expect(DOMAIN_VERSION).toBe("1");
  });

  it("claim confirmed (same loss, same tier) → \"confirmed\", NO signature; one single replay per claim", async () => {
    const { claim, cP } = await claimFrom(5_000_000n);
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    const B = refuter(chain, OP_B, 5_000_000n);
    const r1 = await B.service.refute(await request(B.kit, claim, [OP_A], hunterPlain()));
    expect(r1.status).toBe("confirmed");
    expect(r1).not.toHaveProperty("signature");
    expect((r1 as any).replay).toMatchObject({ replayed: true, satisfied: true, loss: 5_000_000n, tier: 0, proven: true, blockN: 1_990n });
    // the protocol, with the secret of this one report: the same content, the same verdict, without a new replay
    const r2 = await B.service.refute(await request(B.kit, claim, [OP_A], { from: "protocol", cP, sharedSecret: sharedSecretOf(cP) }));
    expect(r2.status).toBe("confirmed");
    expect(B.fork.runs).toBe(1);
  });

  it("does not reproduce (predicate not met) → Refutation { proven: false, loss: 0, tier: 0 } signed, digest = the contract's", async () => {
    const { claim } = await claimFrom(5_000_000n); // enclave A announces a 5 USDC loss…
    const chain = new FakeChain();
    const digest = chain.accept(claim, [OP_A]);
    const B = refuter(chain, OP_B, 0n); // …the counter-replay sees nothing drop
    const r = refuted(await B.service.refute(await request(B.kit, claim, [OP_A], hunterPlain())));
    expect(r.refutation).toEqual({ claimDigest: digest, proven: false, loss: 0n, tier: 0 });
    expect(r.replay).toMatchObject({ replayed: true, satisfied: false, proven: false, tier: -1 });
    expect(r.operator).toBe(OP_B);
    // the digest of the claim and that of the refutation, recomputed by hand as the contract does
    expect(claimDigestByHand(claim)).toBe(digest);
    const d = refutationDigestByHand(r.refutation);
    expect((await recoverAddress({ hash: d, signature: r.signature })).toLowerCase()).toBe(B.kit.keys.signer.toLowerCase());
    expect(sdk.refutationDigestOf(SEALED, r.refutation, CHAIN)).toBe(d); // the SDK computes the same digest
  });

  it("another loss (same tier), then another tier → a \"proven\" refutation with the MEASURED loss and tier", async () => {
    const chain = new FakeChain();
    const one = await claimFrom(5_000_000n);
    chain.accept(one.claim, [OP_A]);
    const B = refuter(chain, OP_B, 3_000_000n);
    const r1 = refuted(await B.service.refute(await request(B.kit, one.claim, [OP_A], hunterPlain())));
    expect(r1.refutation).toMatchObject({ proven: true, loss: 3_000_000n, tier: 0 });
    expect((await recoverAddress({ hash: refutationDigestByHand(r1.refutation), signature: r1.signature })).toLowerCase()).toBe(B.kit.keys.signer.toLowerCase());

    const two = await claimFrom(50_000_000n, { capital: CAPITAL + 1n }); // tier 1 announced (another exploit: another capital)
    expect(two.claim.tier).toBe(1);
    chain.accept(two.claim, [OP_A]);
    const C = refuter(chain, OP_C, 5_000_000n);
    const r2 = refuted(await C.service.refute(await request(C.kit, two.claim, [OP_A], hunterPlain({ capital: CAPITAL + 1n }))));
    expect(r2.refutation).toMatchObject({ proven: true, loss: 5_000_000n, tier: 0 });
    expect((await recoverAddress({ hash: refutationDigestByHand(r2.refutation), signature: r2.signature })).toLowerCase()).toBe(C.kit.keys.signer.toLowerCase());
  });

  it("predicate met but loss below the lowest tier → \"not proven\" (canonical form: loss 0, tier 0)", async () => {
    const view = { ...bountyView, tierMinLoss: [2_000_000n, 10_000_000n] }; // predicate: ≥ 1 USDC; first tier: 2 USDC
    const { claim } = await claimFrom(5_000_000n, { view });
    const chain = new FakeChain();
    chain.bounty = { ...view, productId: PRODUCT };
    chain.accept(claim, [OP_A]);
    const B = refuter(chain, OP_B, 1_500_000n);
    const r = refuted(await B.service.refute(await request(B.kit, claim, [OP_A], hunterPlain())));
    expect(r.refutation).toMatchObject({ proven: false, loss: 0n, tier: 0 });
    expect(r.replay).toMatchObject({ satisfied: true, loss: 1_500_000n, tier: -1, proven: false });
  });
});

describe("refutation: the exploit must give back the claim, otherwise nothing is replayed or signed", () => {
  it("hunter: other transactions, another capital, another r → refused (cPHash not given back)", async () => {
    const { claim } = await claimFrom(5_000_000n);
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    const B = refuter(chain, OP_B, 0n);
    for (const plain of [hunterPlain({ txs: ["0xdeadbeee"] }), hunterPlain({ capital: CAPITAL - 1n }), hunterPlain({ r: ("0x" + "23".repeat(32)) as Hex })]) {
      const r = await B.service.refute(await request(B.kit, claim, [OP_A], plain));
      expect(refusedCode(r)).toBe("exploit_mismatch");
    }
    expect(B.fork.runs).toBe(0);
  });

  it("protocol: the cP of another claim, a false secret, a key that is not the bounty's → refused", async () => {
    const { claim, cP } = await claimFrom(5_000_000n);
    const other = await claimFrom(5_000_000n, { capital: 7n });
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    const B = refuter(chain, OP_B, 0n);
    const ask = async (p: object) => B.service.refute(await request(B.kit, claim, [OP_A], p));
    expect(refusedCode(await ask({ from: "protocol", cP: other.cP, sharedSecret: sharedSecretOf(other.cP) }))).toBe("exploit_mismatch");
    expect(refusedCode(await ask({ from: "protocol", cP, sharedSecret: toHex(new Uint8Array(32).fill(9)) }))).toBe("exploit_mismatch");
    expect(refusedCode(await ask({ from: "protocol", cP, protocolPrivateKey: toHex(generateEnclaveKeys().x25519PrivateKey) }))).toBe("exploit_mismatch");
    expect(refusedCode(await ask({ from: "protocol", cP, sharedSecret: sharedSecretOf(cP), protocolPrivateKey: toHex(protocol.x25519PrivateKey) }))).toBe("bad_request");
    expect(B.fork.runs).toBe(0);
  });

  it("a request encrypted for another claim (aad), or to another enclave → undecryptable", async () => {
    const { claim } = await claimFrom(5_000_000n);
    const other = await claimFrom(5_000_000n, { capital: 7n });
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    const B = refuter(chain, OP_B, 0n);
    const forOther = await request(B.kit, other.claim, [OP_A], hunterPlain());
    expect(refusedCode(await B.service.refute({ ...forOther, claim }))).toBe("undecryptable");
    const C = refuter(chain, OP_C, 0n);
    expect(refusedCode(await B.service.refute(await request(C.kit, claim, [OP_A], hunterPlain())))).toBe("undecryptable");
  });

  it("cP established but the SIGNED fingerprint is not its own → \"not proven\" without a replay (cP is not the announced exploit)", async () => {
    const honest = await claimFrom(5_000_000n);
    const forged: Claim = { ...honest.claim, fingerprint: keccak256(toBytes("another exploit")) };
    const chain = new FakeChain();
    chain.accept(forged, [OP_A]);
    const B = refuter(chain, OP_B, 5_000_000n);
    const r = refuted(await B.service.refute(await request(B.kit, forged, [OP_A], { from: "protocol", cP: honest.cP, sharedSecret: sharedSecretOf(honest.cP) })));
    expect(r.refutation).toMatchObject({ proven: false, loss: 0n, tier: 0 });
    expect(r.replay.replayed).toBe(false);
    expect(r.replay.note).toContain("fingerprint");
    expect(B.fork.runs).toBe(0);
  });

  it("unreadable report: the shared secret proves nothing (refused), the bounty's key verified on-chain proves it (\"not proven\")", async () => {
    const honest = await claimFrom(5_000_000n);
    // forged enclaves signed for a cP that is not a report: a valid ephemeral key, an arbitrary ciphertext
    const garbage = toHex(concat([x25519.getPublicKey(new Uint8Array(32).fill(3)), new Uint8Array(80).fill(1)]));
    const forged: Claim = { ...honest.claim, cPHash: keccak256(garbage) };
    const chain = new FakeChain();
    chain.accept(forged, [OP_A]);
    const B = refuter(chain, OP_B, 5_000_000n);
    const viaSecret = await B.service.refute(await request(B.kit, forged, [OP_A], { from: "protocol", cP: garbage, sharedSecret: sharedSecretOf(garbage) }));
    expect(refusedCode(viaSecret)).toBe("exploit_mismatch");
    const viaKey = refuted(await B.service.refute(await request(B.kit, forged, [OP_A], { from: "protocol", cP: garbage, protocolPrivateKey: toHex(protocol.x25519PrivateKey) })));
    expect(viaKey.refutation).toMatchObject({ proven: false, loss: 0n, tier: 0 });
    expect(viaKey.replay.note).toContain("unreadable");
    // a "report" too short to be a seal (3 bytes): the same rule
    const tiny = "0x010203" as Hex;
    const forged2: Claim = { ...honest.claim, cPHash: keccak256(tiny) };
    chain.accept(forged2, [OP_A]);
    expect(refusedCode(await B.service.refute(await request(B.kit, forged2, [OP_A], { from: "protocol", cP: tiny, sharedSecret: toHex(new Uint8Array(32)) })))).toBe("exploit_mismatch");
    const tinyKey = refuted(await B.service.refute(await request(B.kit, forged2, [OP_A], { from: "protocol", cP: tiny, protocolPrivateKey: toHex(protocol.x25519PrivateKey) })));
    expect(tinyKey.refutation).toMatchObject({ proven: false, loss: 0n, tier: 0 });
    expect(B.fork.runs).toBe(0);
  });

  it("the shared secret opens exactly what deterministicSeal seals (the same construction as the kit)", () => {
    const msg = utf8(canonicalProtocolPlaintext({ bountyId: 1n, payee: HUNTER, capital: 0n, predicate: pred, txs: TXS }));
    const sealed = deterministicSeal(toBytes(protocol.x25519PublicKey), msg, toBytes(R));
    expect(openSealedWithSharedSecret(sealed, toBytes(sharedSecretOf(sealed)))).toEqual(msg);
    expect(() => openSealedWithSharedSecret(sealed, new Uint8Array(32).fill(1))).toThrow();
  });
});

describe("refutation: refusals before any decryption (the contract would refuse too)", () => {
  it("the claim's operator, an inactive enclave, another product → refused", async () => {
    const { claim } = await claimFrom(5_000_000n);
    const chain = new FakeChain();
    chain.accept(claim, [OP_A, OP_C]);
    const sameOp = refuter(chain, OP_C, 0n); // OP_C co-signed the claim
    expect(refusedCode(await sameOp.service.refute(await request(sameOp.kit, claim, [OP_A, OP_C], hunterPlain())))).toBe("claim_operator");
    const inactive = refuter(chain, null, 0n);
    expect(refusedCode(await inactive.service.refute(await request(inactive.kit, claim, [OP_A, OP_C], hunterPlain())))).toBe("inactive");
    chain.bounty = { ...chain.bounty, productId: 9n };
    const B = refuter(chain, OP_B, 0n);
    expect(refusedCode(await B.service.refute(await request(B.kit, claim, [OP_A, OP_C], hunterPlain())))).toBe("wrong_product");
    expect(sameOp.fork.runs + inactive.fork.runs + B.fork.runs).toBe(0);
  });

  it("outside the window (after acceptedAt + 3 days), already refuted, unknown, wrong operators → refused; the bound is inclusive as in the contract", async () => {
    const { claim } = await claimFrom(5_000_000n);
    const chain = new FakeChain();
    const digest = chain.accept(claim, [OP_A]);
    const B = refuter(chain, OP_B, 0n);
    const ask = async (ops: Address[] = [OP_A], c: Claim = claim) => B.service.refute(await request(B.kit, c, ops, hunterPlain()));

    chain.now = NOW + WINDOW + 1n;
    expect(refusedCode(await ask())).toBe("window_over");
    chain.now = NOW + WINDOW; // block.timestamp > acceptedAt + REFUTE_WINDOW reverts: equality passes
    expect((await ask()).status).toBe("refuted");

    expect(refusedCode(await ask([OP_B]))).toBe("bad_ops");
    expect(refusedCode(await ask([OP_A], { ...claim, loss: claim.loss + 1n }))).toBe("unknown_claim");
    chain.records.get(digest.toLowerCase())!.refuted = true;
    expect(refusedCode(await ask())).toBe("already_refuted");
  });

  it("concurrent requests on the same claim: ONE replay, the SAME signature (never two different refutations)", async () => {
    const { claim, cP } = await claimFrom(5_000_000n);
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    const B = refuter(chain, OP_B, 2_000_000n);
    const reqs = await Promise.all([
      request(B.kit, claim, [OP_A], hunterPlain()),
      request(B.kit, claim, [OP_A], { from: "protocol", cP, sharedSecret: sharedSecretOf(cP) }),
      request(B.kit, claim, [OP_A], { from: "protocol", cP, protocolPrivateKey: toHex(protocol.x25519PrivateKey) }),
    ]);
    const out = (await Promise.all(reqs.map((q) => B.service.refute(q)))).map(refuted);
    expect(new Set(out.map((x) => x.signature)).size).toBe(1);
    expect(B.fork.runs).toBe(1);
  });
});

describe("POST /v1/refute and the on-chain reader", () => {
  it("HTTP: refutation in JSON (amounts as strings), 400 if malformed, 503 if the chain is unreadable, 501 without a service", async () => {
    const { claim } = await claimFrom(5_000_000n);
    const chain = new FakeChain();
    chain.accept(claim, [OP_A]);
    const B = refuter(chain, OP_B, 0n);
    const service = new BountyService(B.kit, { sealedBounty: SEALED }, { getBounty: async () => bountyView }, new DeterministicProtocolCipher(), fakeFork(0n), { current: async () => 2_000n, blockHash: async () => zeroHash }, () => NOW);
    const attest = { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} };
    const app = createSealedBountyApp({ kit: B.kit, service, refuter: B.service, attest });
    const q = await request(B.kit, claim, [OP_A], hunterPlain());
    const body = sdkBody(claim, [OP_A], q.enc, q.ciphertext);
    const post = (b: unknown, a = app) => a.request("/v1/refute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

    const res = await post(body);
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j).toMatchObject({ status: "refuted", refutation: { proven: false, loss: "0", tier: 0 }, operator: OP_B, replay: { replayed: true, satisfied: false } });
    expect(parseClaimJson(body.claim)).toEqual(claim);

    expect((await post({ ...body, operators: [] })).status).toBe(400);
    expect((await post({ ...body, claim: { ...body.claim, tier: 256 } })).status).toBe(400);
    expect((await post({ ...body, enc: "0x1234" })).status).toBe(400);

    const broken = new RefutationService(B.kit, { sealedBounty: SEALED }, { read: async () => { throw new Error("quorum disagrees"); } }, new DeterministicProtocolCipher(), fakeFork(0n));
    const r503 = await post(body, createSealedBountyApp({ kit: B.kit, service, refuter: broken, attest }));
    expect(r503.status).toBe(503);
    expect(((await r503.json()) as any).error).toContain("nothing is signed");
    expect((await post(body, createSealedBountyApp({ kit: B.kit, service, attest }))).status).toBe(501);
  });

  it("chainRefuteReader reads everything at one block: claimRecords, REFUTE_WINDOW, bounty, tiers, activeOperatorAt, timestamp", async () => {
    const abi = parseAbi([
      "struct Bounty { address protocol; uint256 productId; bytes32 predicateHash; bytes32 protocolX25519; uint256 singleCap; uint8 k; address targetToPause; uint64 deadline; uint256 balance; bool paused; }",
      "function getBounty(uint256 id) view returns (Bounty)",
      "function tierMinLoss(uint256 bountyId, uint256 index) view returns (uint256)",
      "function claimRecords(bytes32) view returns (uint64 acceptedAt, bool refuted, bytes32 opsHash)",
      "function REFUTE_WINDOW() view returns (uint64)",
      "function activeOperatorAt(address signer, uint256 productId, uint256 blockNumber) view returns (address)",
    ]);
    const DIGEST = keccak256(toBytes("claim"));
    const OPS_HASH = claimOperatorsHash([OP_A]);
    const SIGNER = "0x00000000000000000000000000000000000000e1" as Address;
    const seen: bigint[] = [];
    const transport = custom({
      async request({ method, params }: { method: string; params?: any }) {
        if (method === "eth_blockNumber") return numberToHex(7_000n);
        if (method === "eth_getBlockByNumber") {
          return { number: params[0], hash: pad("0x07", { size: 32 }), timestamp: numberToHex(NOW + 99n), parentHash: zeroHash, transactions: [], logsBloom: null, nonce: null };
        }
        if (method !== "eth_call") throw new Error(`unexpected method ${method}`);
        seen.push(BigInt(params[1]));
        const { functionName, args } = decodeFunctionData({ abi, data: params[0].data });
        switch (functionName) {
          case "claimRecords":
            expect(args![0]).toBe(DIGEST);
            return encodeFunctionResult({ abi, functionName, result: [NOW, false, OPS_HASH] });
          case "REFUTE_WINDOW":
            return encodeFunctionResult({ abi, functionName, result: WINDOW });
          case "getBounty":
            return encodeFunctionResult({ abi, functionName, result: { protocol: HOLDER, productId: PRODUCT, predicateHash: bountyView.predicateHash, protocolX25519: bountyView.protocolX25519, singleCap: 1n, k: 1, targetToPause: HOLDER, deadline: 9_000_000n, balance: 1n, paused: false } });
          case "tierMinLoss":
            if (Number(args![1]) >= 2) throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x4e487b71" + pad("0x32", { size: 32 }).slice(2) });
            return encodeFunctionResult({ abi, functionName, result: [1_000_000n, 10_000_000n][Number(args![1])]! });
          case "activeOperatorAt":
            expect(params[0].to.toLowerCase()).toBe(REGISTRY.toLowerCase());
            expect(args).toEqual([SIGNER, PRODUCT, 7_000n]);
            return encodeFunctionResult({ abi, functionName, result: OP_B });
          default:
            throw new Error(`unexpected read ${functionName}`);
        }
      },
    }, { retryCount: 0 });
    const v = await chainRefuteReader(new RpcQuorum([transport]), SEALED, REGISTRY).read({ claimDigest: DIGEST, bountyId: 1n, signer: SIGNER });
    expect(v).toMatchObject({ block: 7_000n, blockTimestamp: NOW + 99n, refuteWindow: WINDOW, myOperator: OP_B, record: { acceptedAt: NOW, refuted: false, opsHash: OPS_HASH } });
    expect(v.bounty).toMatchObject({ productId: PRODUCT, tierMinLoss: [1_000_000n, 10_000_000n], predicateHash: bountyView.predicateHash });
    expect(new Set(seen)).toEqual(new Set([7_000n])); // one single block for all the reads
  });
});

function sdkBody(claim: Claim, operators: Address[], enc: Uint8Array, ciphertext: Uint8Array) {
  return {
    claim: { ...claim, bountyId: claim.bountyId.toString(), blockN: claim.blockN.toString(), loss: claim.loss.toString(), deadline: claim.deadline.toString() },
    operators, enc: toHex(enc), ciphertext: toHex(ciphertext),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// end to end: the SDK (keys verified on-chain, quorum, signatures gathered) ↔ the real /v1/refute applications

describe("SDK ↔ enclaves: requestRefutations, quorum, prepareRefuteCall", () => {
  async function network(lossSeen: bigint, ops: Array<Address | null>) {
    const { claim, cP } = await claimFrom(5_000_000n);
    const chain = new FakeChain();
    const digest = chain.accept(claim, [OP_A]);
    const nodes = ops.map((op, i) => {
      const r = refuter(chain, op, lossSeen);
      const service = new BountyService(r.kit, { sealedBounty: SEALED }, { getBounty: async () => bountyView }, new DeterministicProtocolCipher(), r.fork, { current: async () => 2_000n, blockHash: async () => zeroHash }, () => NOW);
      const app = createSealedBountyApp({ kit: r.kit, service, refuter: r.service, attest: { operatorAllowlist: null, registeredOperator: async () => null, warn: () => {} } });
      return { ...r, op, url: `https://op${i}.example/enclave/bounty`, app };
    });
    const calls: string[] = [];
    const fetchFn = (async (url: any, init?: any) => {
      const u = new URL(String(url));
      const node = nodes.find((n) => u.href.startsWith(n.url));
      if (!node) throw new Error(`unknown host ${u.href}`);
      calls.push(`${node.url}${u.pathname.slice(new URL(node.url).pathname.length)}`);
      return node.app.request(u.pathname.slice(new URL(node.url).pathname.length), init);
    }) as typeof fetch;
    // the chain as the SDK sees it: the enclave registry (registered X25519 key, active operator)
    const pub = {
      async getBlockNumber() { return 7_000n; },
      async readContract(a: any) {
        const n = nodes.find((x) => x.kit.keys.signer.toLowerCase() === String(a.args?.[0]).toLowerCase());
        if (a.functionName === "enclaveOf") {
          return { signer: n ? n.kit.keys.signer : zeroAddress, x25519: n ? n.kit.keys.x25519PublicKey : zeroHash, productId: PRODUCT, operator: n?.op ?? zeroAddress, workloadId: zeroHash, fmspc: "0x000000000000", tcbStatus: 0, quoteHash: zeroHash, anchorBlock: 1n, registeredAt: 1n, expiresAt: 2n, active: true, fromBlock: 1n, untilBlock: 9_999n };
        }
        if (a.functionName === "activeOperatorAt") return n?.op ?? zeroAddress;
        throw new Error(`read not emulated: ${a.functionName}`);
      },
    } as any;
    const accepted: sdk.AcceptedClaim = {
      claimDigest: digest, claim, operators: [OP_A], amount: 1n, acceptedAt: NOW, refuted: false, refuteWindowEndsAt: NOW + WINDOW,
      checkedAtBlock: 7_000n, checkedAtTimestamp: NOW + 3_600n, windowOpen: true, block: 6_000n, txHash: zeroHash,
    };
    const deployment = { ...sdk.testnet, sealedBounty: SEALED, chainId: CHAIN };
    const ask = (source: sdk.RefuteSource) => sdk.requestRefutations({
      accepted, source, enclaveUrls: nodes.map((n) => n.url), productId: PRODUCT, protocolX25519: protocol.x25519PublicKey,
      publicClient: pub, deployment, fetch: fetchFn,
    });
    return { claim, cP, digest, nodes, calls, ask, accepted, deployment };
  }

  it("3 enclaves (one of them the claim operator's): 2 distinct operators sign the same refutation → refute ready", async () => {
    const net = await network(0n, [OP_A, OP_B, OP_C]);
    const source = sdk.protocolRefuteSource({ cP: net.cP, protocolPrivateKey: protocol.x25519PrivateKey });
    expect(source).toHaveProperty("sharedSecret"); // by default: the secret of THIS report, not the bounty's key
    const round = await net.ask(source);
    expect(round.status).toBe("ready");
    expect(round.needed).toBe(2);
    expect(round.results.map((r) => r.status)).toEqual(["excluded", "refuted", "refuted"]);
    expect(round.refuters).toEqual([OP_B, OP_C]);
    expect(round.refutation).toEqual({ claimDigest: net.digest, proven: false, loss: 0n, tier: 0 });
    expect(net.calls.filter((c) => c.endsWith("/v1/refute"))).toHaveLength(2); // nothing sent to OP_A's enclave
    for (const [i, sig] of round.signatures!.entries()) {
      expect((await recoverAddress({ hash: refutationDigestByHand(round.refutation!), signature: sig })).toLowerCase()).toBe(net.nodes[i + 1]!.kit.keys.signer.toLowerCase());
    }
    const call = sdk.prepareRefuteCall(net.accepted, round, net.deployment);
    expect(call.functionName).toBe("refute");
    expect(call.address).toBe(SEALED);
    expect(call.args).toEqual([net.claim, [OP_A], round.refutation, round.signatures]);
  });

  it("hunter, a claim that reproduces: the enclaves confirm, nothing is signed, prepareRefuteCall refuses", async () => {
    const net = await network(5_000_000n, [OP_B, OP_C]);
    const round = await net.ask(sdk.hunterRefuteSource({ bountyId: 1n, payee: HUNTER, exploit: { predicate: pred, txs: TXS, capital: CAPITAL }, r: R }));
    expect(round.status).toBe("confirmed");
    expect(round.confirmations).toBe(2);
    expect(round.signatures).toBeUndefined();
    expect(() => sdk.prepareRefuteCall(net.accepted, round, net.deployment)).toThrow(/not ready/);
  });

  it("unreachable quorum (only one other operator on the network): a clear message, NOTHING is sent to the enclaves", async () => {
    const net = await network(0n, [OP_A, OP_B, OP_B]); // two enclaves… of the same operator OP_B
    const round = await net.ask(sdk.protocolRefuteSource({ cP: net.cP, protocolPrivateKey: protocol.x25519PrivateKey }));
    expect(round.status).toBe("unreachable");
    expect(round.message).toMatch(/only one eligible operator/);
    expect(round.message).toMatch(/nothing was sent/);
    expect(net.calls.filter((c) => c.endsWith("/v1/refute"))).toEqual([]);
    const plan = sdk.refuteQuorumPlan({ claimOperators: [OP_A], candidateOperators: [OP_A], scope: "network" });
    expect(plan.reachable).toBe(false);
    expect(plan.message).toMatch(/only operator has signed the claim/);
  });

  it("a source that does not give back the cPHash: refused by the SDK before any connection", async () => {
    const net = await network(0n, [OP_B, OP_C]);
    await expect(net.ask(sdk.hunterRefuteSource({ bountyId: 1n, payee: HUNTER, exploit: { predicate: pred, txs: ["0xdeadbeee"], capital: CAPITAL }, r: R }))).rejects.toThrow(/cPHash/);
    expect(net.calls).toEqual([]);
  });
});
