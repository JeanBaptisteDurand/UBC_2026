/** refute.test.ts — v2.1 : réfuter une réclamation acceptée (SealedBounty.refute) côté SDK.
 *  - lecture de la réclamation acceptée (ClaimAccepted + claimRecords), bloc retrouvé par son horodatage, opsHash contrôlé ;
 *  - rapport livré (ExploitDelivered) retrouvé par son cPHash ;
 *  - sources de l'exploit contrôlées AVANT tout envoi (cPHash, lisibilité, clé de la prime) ;
 *  - quorum : messages clairs quand il n'est pas atteignable (un seul opérateur), rien n'est envoyé ;
 *  - réponses d'enclaves émulées : signature d'une autre clé, « réfutation » qui ne contredit pas, désaccords ;
 *  - l'appel refute préparé. Le bout en bout avec les vraies applications d'enclave : enclave/test/bounty-refute.test.ts. */
import { describe, it, expect } from "vitest";
import {
  type Address, type Hex, encodeAbiParameters, encodeEventTopics, getAddress, keccak256, toBytes, toHex, zeroAddress, zeroHash,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  REFUTE_QUORUM, RefuteError, checkRefuteSource, claimDigestOf, claimOperatorsHash, deterministicSeal, findDeliveredReport,
  generateX25519, hpkeOpen, hunterRefuteSource, listAcceptedClaims, networkDomain, openSealedWithSharedSecret, prepareRefuteCall,
  protocolCanonical, protocolRefuteSource, readAcceptedClaim, refuteQuorumPlan, refuteRequestAad, refutersNeeded, refutationTypes,
  requestRefutations, sealedBountyAbi, testnet, exploitFingerprint, predicateHash,
  type AcceptedClaim, type Claim, type Predicate, type Refutation, type RefuteSource,
} from "../src/index";

const SEALED = getAddress("0x00000000000000000000000000000000000000bb");
const D = { ...testnet, sealedBounty: SEALED, deployBlock: 100n };
const OP_A = getAddress("0x000000000000000000000000000000000000a001");
const OP_B = getAddress("0x000000000000000000000000000000000000b002");
const OP_C = getAddress("0x000000000000000000000000000000000000c003");
const HUNTER = getAddress("0x000000000000000000000000000000000000c0de");
const T0 = 1_800_000_000n; // horodatage du bloc 0 (1 s par bloc)
const WINDOW = 259_200n;
const PRED: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: testnet.usdc, holder: testnet.demoVault, min: "1000000" }] };
const TXS = ["0xdeadbeef"] as Hex[];
const R = ("0x" + "42".repeat(32)) as Hex;
const proto = generateX25519();

/** La réclamation d'un exploit (cP scellé comme le fait le chasseur, avec r). */
function makeClaim(o: { capital?: bigint; loss?: bigint; tier?: number } = {}) {
  const exploit = { predicate: PRED, txs: TXS, capital: o.capital ?? 5n };
  const cP = deterministicSeal(toBytes(proto.publicKey), new TextEncoder().encode(protocolCanonical({ bountyId: 3n, payee: HUNTER, exploit })), toBytes(R));
  const claim: Claim = {
    bountyId: 3n, payee: HUNTER, blockN: 990n, blockHashN: keccak256(toBytes("bloc 990")), predicateHash: predicateHash(PRED),
    loss: o.loss ?? 5_000_000n, tier: o.tier ?? 0, fingerprint: exploitFingerprint({ txs: TXS }), cPHash: keccak256(cP), deadline: T0 + 2_000n,
  };
  return { claim, cP, exploit, digest: claimDigestOf(SEALED, claim, D.chainId) };
}

const ACCEPTED = sealedBountyAbi.find((x: any) => x.type === "event" && x.name === "ClaimAccepted") as any;

/** Une chaîne émulée : journaux (ClaimAccepted, ExploitDelivered), claimRecords, blocs horodatés, registre d'enclaves. */
function fakeChain(head: bigint) {
  const logs: Array<{ address: Address; topics: Hex[]; data: Hex; blockNumber: bigint; transactionHash: Hex }> = [];
  const records = new Map<string, readonly [bigint, boolean, Hex]>();
  const enclaves = new Map<string, { x25519: Hex; operator: Address }>();
  const calls = { getLogs: 0, getBlock: 0 };
  const pub = {
    async getBlockNumber() { return head; },
    async getBlock({ blockNumber }: { blockNumber: bigint }) { calls.getBlock++; return { number: blockNumber, timestamp: T0 + blockNumber }; },
    async readContract(a: any) {
      switch (a.functionName) {
        case "claimRecords": return records.get(String(a.args[0]).toLowerCase()) ?? [0n, false, zeroHash];
        case "REFUTE_WINDOW": return WINDOW;
        case "enclaveOf": {
          const e = enclaves.get(String(a.args[0]).toLowerCase());
          return { signer: e ? a.args[0] : zeroAddress, x25519: e?.x25519 ?? zeroHash, productId: 2n, operator: e?.operator ?? zeroAddress, workloadId: zeroHash, fmspc: "0x000000000000", tcbStatus: 0, quoteHash: zeroHash, anchorBlock: 1n, registeredAt: 1n, expiresAt: 2n, active: !!e, fromBlock: 1n, untilBlock: 99_999n };
        }
        case "activeOperatorAt": return enclaves.get(String(a.args[0]).toLowerCase())?.operator ?? zeroAddress;
        default: throw new Error(`lecture non émulée : ${a.functionName}`);
      }
    },
    async request({ method, params }: { method: string; params: any[] }) {
      if (method !== "eth_getLogs") throw new Error(`méthode non émulée : ${method}`);
      calls.getLogs++;
      const q = params[0];
      const from = BigInt(q.fromBlock), to = BigInt(q.toBlock);
      if (to - from + 1n > 5_000n) throw new Error("plage eth_getLogs trop grande");
      return logs
        .filter((l) => l.address.toLowerCase() === q.address.toLowerCase() && l.blockNumber >= from && l.blockNumber <= to)
        .filter((l) => (q.topics as (Hex | null)[]).every((t, i) => t === null || t === undefined || l.topics[i]?.toLowerCase() === t.toLowerCase()))
        .map((l) => ({ ...l, blockNumber: toHex(l.blockNumber) }));
    },
  };
  return {
    pub: pub as any, calls, enclaves,
    accept(c: Claim, ops: Address[], block: bigint, amount = 1_000_000n) {
      const digest = claimDigestOf(SEALED, c, D.chainId);
      const topics = encodeEventTopics({ abi: sealedBountyAbi, eventName: "ClaimAccepted", args: { bountyId: c.bountyId, claimDigest: digest } }) as Hex[];
      const data = encodeAbiParameters(ACCEPTED.inputs.filter((i: any) => !i.indexed), [c, ops, amount]);
      logs.push({ address: SEALED, topics, data, blockNumber: block, transactionHash: keccak256(toBytes(`tx ${block}`)) });
      records.set(digest.toLowerCase(), [T0 + block, false, claimOperatorsHash(ops)]);
      return digest;
    },
    deliver(bountyId: bigint, cP: Hex, block: bigint) {
      const topics = encodeEventTopics({ abi: sealedBountyAbi, eventName: "ExploitDelivered", args: { bountyId } }) as Hex[];
      logs.push({ address: SEALED, topics, data: encodeAbiParameters([{ type: "bytes" }], [cP]), blockNumber: block, transactionHash: keccak256(toBytes(`deliver ${block}`)) });
    },
    setRecord(digest: Hex, r: readonly [bigint, boolean, Hex]) { records.set(digest.toLowerCase(), r); },
  };
}

describe("réclamation acceptée lue on-chain", () => {
  it("ClaimAccepted retrouvé à partir de l'horodatage d'acceptation (dichotomie, une seule tranche de journaux), état et fenêtre", async () => {
    const chain = fakeChain(250_000n);
    const { claim, digest } = makeClaim();
    chain.accept(makeClaim({ capital: 9n }).claim, [OP_C], 150n); // une autre réclamation de la même prime
    chain.accept(claim, [OP_A], 200_000n);
    const a = await readAcceptedClaim(chain.pub, { claimDigest: digest, deployment: D });
    expect(a).toMatchObject({ claimDigest: digest, operators: [OP_A], amount: 1_000_000n, acceptedAt: T0 + 200_000n, refuted: false, block: 200_000n });
    expect(a.claim).toEqual(claim);
    expect(a.refuteWindowEndsAt).toBe(T0 + 200_000n + WINDOW);
    expect(a.windowOpen).toBe(true);
    expect(chain.calls.getLogs).toBe(1);
    expect(chain.calls.getBlock).toBeLessThan(25);

    const late = fakeChain(200_000n + WINDOW + 1n);
    late.accept(claim, [OP_A], 200_000n);
    expect((await readAcceptedClaim(late.pub, { claimDigest: digest, deployment: D })).windowOpen).toBe(false);
  });

  it("inconnue, déjà réfutée, opérateurs émis ≠ opsHash → erreurs explicites", async () => {
    const chain = fakeChain(1_000n);
    const { claim, digest } = makeClaim();
    await expect(readAcceptedClaim(chain.pub, { claimDigest: digest, deployment: D })).rejects.toMatchObject({ code: "unknown_claim" });
    chain.accept(claim, [OP_A], 500n);
    chain.setRecord(digest, [T0 + 500n, true, claimOperatorsHash([OP_A])]);
    const done = await readAcceptedClaim(chain.pub, { claimDigest: digest, deployment: D });
    expect(done).toMatchObject({ refuted: true, windowOpen: false });
    chain.setRecord(digest, [T0 + 500n, false, claimOperatorsHash([OP_B])]);
    await expect(readAcceptedClaim(chain.pub, { claimDigest: digest, deployment: D })).rejects.toMatchObject({ code: "inconsistent_event" });
  });

  it("listAcceptedClaims d'une prime ; findDeliveredReport retrouve le cP livré par son cPHash", async () => {
    const chain = fakeChain(12_000n);
    const one = makeClaim();
    const two = makeClaim({ capital: 6n });
    chain.accept(one.claim, [OP_A], 300n);
    chain.accept(two.claim, [OP_A, OP_B], 7_000n);
    chain.deliver(3n, two.cP, 7_010n);
    chain.deliver(3n, one.cP, 7_020n);
    const all = await listAcceptedClaims(chain.pub, { bountyId: 3n, deployment: D });
    expect(all.map((x) => x.claimDigest)).toEqual([one.digest, two.digest]);
    expect(all[1]!.operators).toEqual([OP_A, OP_B]);
    expect(await listAcceptedClaims(chain.pub, { bountyId: 4n, deployment: D })).toEqual([]);
    const found = await findDeliveredReport(chain.pub, { bountyId: 3n, cPHash: one.claim.cPHash, deployment: D, fromBlock: 300n });
    expect(found).toMatchObject({ cP: one.cP, block: 7_020n });
    expect(await findDeliveredReport(chain.pub, { bountyId: 3n, cPHash: keccak256("0x01"), deployment: D })).toBeUndefined();
  });
});

describe("source de l'exploit : contrôlée avant tout envoi", () => {
  const { claim, cP, exploit } = makeClaim();

  it("chasseur : le bundle et r redonnent cPHash ; autre r ou autre capital → source_mismatch", () => {
    expect(checkRefuteSource(hunterRefuteSource({ bountyId: 3n, payee: HUNTER, exploit, r: R }), claim, proto.publicKey)).toMatchObject({ mode: "hunter", readable: true, consistent: true });
    const other = hunterRefuteSource({ bountyId: 3n, payee: HUNTER, exploit, r: ("0x" + "43".repeat(32)) as Hex });
    expect(() => checkRefuteSource(other, claim, proto.publicKey)).toThrow(/cPHash/);
    const cap = hunterRefuteSource({ bountyId: 3n, payee: HUNTER, exploit: { ...exploit, capital: 6n }, r: R });
    expect(() => checkRefuteSource(cap, claim, proto.publicKey)).toThrow(RefuteError);
    expect(() => hunterRefuteSource({ bountyId: 3n, payee: HUNTER, exploit, r: "0x1234" })).toThrow(/32 octets/);
  });

  it("protocole : par défaut le secret de CE rapport (pas la clé) ; il ouvre cP ; un faux secret ou un autre cP → refus", () => {
    const s = protocolRefuteSource({ cP, protocolPrivateKey: proto.privateKey });
    expect(s).not.toHaveProperty("protocolPrivateKey");
    expect(checkRefuteSource(s, claim, proto.publicKey)).toMatchObject({ mode: "protocol-secret", readable: true, consistent: true });
    expect(new TextDecoder().decode(openSealedWithSharedSecret(cP, toBytes((s as any).sharedSecret)))).toBe(protocolCanonical({ bountyId: 3n, payee: HUNTER, exploit }));
    expect(() => checkRefuteSource({ from: "protocol", cP, sharedSecret: toHex(new Uint8Array(32).fill(1)) }, claim, proto.publicKey)).toThrow(/revealKey/);
    const other = makeClaim({ capital: 99n });
    expect(() => checkRefuteSource(protocolRefuteSource({ cP: other.cP, protocolPrivateKey: proto.privateKey }), claim, proto.publicKey)).toThrow(/cPHash/);
  });

  it("protocole, rapport illisible : seul revealKey (clé vérifiée) le prouve ; une clé qui n'est pas celle de la prime est refusée", () => {
    const garbage = toHex(new Uint8Array(32 + 64).fill(7));
    const forged = { ...claim, cPHash: keccak256(garbage) };
    expect(() => checkRefuteSource(protocolRefuteSource({ cP: garbage, protocolPrivateKey: proto.privateKey }), forged, proto.publicKey)).toThrow(/revealKey/);
    const withKey = protocolRefuteSource({ cP: garbage, protocolPrivateKey: proto.privateKey, revealKey: true });
    expect(checkRefuteSource(withKey, forged, proto.publicKey)).toMatchObject({ mode: "protocol-key", readable: false, consistent: false });
    const stranger = generateX25519();
    expect(() => checkRefuteSource(protocolRefuteSource({ cP: garbage, protocolPrivateKey: stranger.privateKey, revealKey: true }), forged, proto.publicKey)).toThrow(/n'est pas celle de la prime/);
    // trop court pour être un scellé : le secret ne peut pas même se calculer, la clé le prouve
    const tiny = "0x010203" as Hex;
    expect(() => protocolRefuteSource({ cP: tiny, protocolPrivateKey: proto.privateKey })).toThrow(/revealKey/);
    const tinyKey = protocolRefuteSource({ cP: tiny, protocolPrivateKey: proto.privateKey, revealKey: true });
    expect(checkRefuteSource(tinyKey, { ...claim, cPHash: keccak256(tiny) }, proto.publicKey)).toMatchObject({ readable: false, consistent: false });
  });

  it("rapport lisible mais empreinte signée différente : signalé (« non prouvée » attendue, sans rejeu)", () => {
    const forged = { ...claim, fingerprint: keccak256(toBytes("autre")) };
    const chk = checkRefuteSource(protocolRefuteSource({ cP, protocolPrivateKey: proto.privateKey }), forged, proto.publicKey);
    expect(chk).toMatchObject({ readable: true, consistent: false });
    expect(chk.note).toMatch(/empreinte/);
  });
});

describe("quorum : au moins 2 opérateurs distincts, plus que la réclamation, aucun d'elle", () => {
  it("refutersNeeded et messages : un seul opérateur sur le réseau, un seul éligible, assez", () => {
    expect(REFUTE_QUORUM).toBe(2);
    expect([refutersNeeded(1), refutersNeeded(2), refutersNeeded(5)]).toEqual([2, 3, 6]);
    const alone = refuteQuorumPlan({ claimOperators: [OP_A], candidateOperators: [OP_A, OP_A], scope: "network" });
    expect(alone).toMatchObject({ reachable: false, needed: 2, eligibleOperators: [] });
    expect(alone.message).toMatch(/le seul opérateur a signé la réclamation/);
    const one = refuteQuorumPlan({ claimOperators: [OP_A], candidateOperators: [OP_A, OP_B, OP_B] });
    expect(one.message).toMatch(/un seul opérateur éligible.*0x000000000000000000000000000000000000b002/i);
    expect(refuteQuorumPlan({ claimOperators: [OP_A, OP_B], candidateOperators: [OP_C, getAddress("0x00000000000000000000000000000000000000d4")] }).reachable).toBe(false); // 3 requis
    expect(refuteQuorumPlan({ claimOperators: [OP_A], candidateOperators: [OP_B, OP_C, zeroAddress] })).toMatchObject({ reachable: true, eligibleOperators: [OP_B, OP_C] });
  });
});

// ---------------------------------------------------------------- enclaves émulées

/** Une enclave émulée : ouvre la demande (aad = digest), puis répond ce que `answer` décide, signé par `signWith`. */
function emulated(op: Address, answer: (digest: Hex, plain: any) => { kind: "refute"; f: Refutation } | { kind: "confirm" } | { kind: "refuse" }, signWith?: Hex) {
  const key = generatePrivateKey();
  const acc = privateKeyToAccount(key);
  const x = generateX25519();
  const seen: any[] = [];
  return {
    op, signer: acc.address, x25519: x.publicKey.toLowerCase() as Hex, seen,
    async handle(body: any): Promise<Response> {
      const claim = body.claim;
      const c: Claim = { ...claim, bountyId: BigInt(claim.bountyId), blockN: BigInt(claim.blockN), loss: BigInt(claim.loss), deadline: BigInt(claim.deadline) };
      const digest = claimDigestOf(SEALED, c, D.chainId);
      const plain = JSON.parse(new TextDecoder().decode(await hpkeOpen(x.privateKey, toBytes(body.enc), toBytes(body.ciphertext), refuteRequestAad(digest))));
      seen.push(plain);
      const a = answer(digest, plain);
      if (a.kind === "confirm") return Response.json({ status: "confirmed", claimDigest: digest, replay: { blockN: "990", replayed: true, satisfied: true, loss: claim.loss, tier: claim.tier, proven: true }, reason: "redonne la réclamation" });
      if (a.kind === "refuse") return Response.json({ status: "refused", code: "claim_operator", reason: "non" });
      const signer = signWith ? privateKeyToAccount(signWith) : acc;
      const signature = await signer.signTypedData({ domain: networkDomain(SEALED, D.chainId) as any, types: refutationTypes, primaryType: "Refutation", message: a.f });
      return Response.json({ status: "refuted", refutation: { ...a.f, loss: a.f.loss.toString() }, signature, signer: acc.address, operator: op, replay: { blockN: "990", replayed: true, satisfied: false, loss: "0", tier: -1, proven: false } });
    },
  };
}

async function round(nodes: ReturnType<typeof emulated>[], source?: RefuteSource, unregistered: ReturnType<typeof emulated>[] = []) {
  const { claim, cP, digest } = makeClaim();
  const chain = fakeChain(1_000n);
  for (const n of nodes) if (!unregistered.includes(n)) chain.enclaves.set(n.signer.toLowerCase(), { x25519: n.x25519, operator: n.op });
  const urls = nodes.map((_, i) => `https://op${i}.example`);
  const posted: string[] = [];
  const fetchFn = (async (url: any, init?: any) => {
    const u = String(url);
    const i = urls.findIndex((x) => u.startsWith(x));
    const n = nodes[i]!;
    if (u.endsWith("/pubkeys")) return Response.json({ signer: n.signer, x25519: n.x25519, lastQuote: "0x" });
    posted.push(urls[i]!);
    return n.handle(JSON.parse(init.body));
  }) as typeof fetch;
  const accepted: AcceptedClaim = {
    claimDigest: digest, claim, operators: [OP_A], amount: 1n, acceptedAt: T0, refuted: false, refuteWindowEndsAt: T0 + WINDOW,
    checkedAtBlock: 1_000n, checkedAtTimestamp: T0 + 1_000n, windowOpen: true, block: 900n, txHash: zeroHash,
  };
  const r = await requestRefutations({
    accepted, source: source ?? protocolRefuteSource({ cP, protocolPrivateKey: proto.privateKey }), enclaveUrls: urls, productId: 2n,
    protocolX25519: proto.publicKey, publicClient: chain.pub, deployment: D, fetch: fetchFn,
  });
  return { r, posted, accepted, digest, claim };
}

const notProven = (digest: Hex): { kind: "refute"; f: Refutation } => ({ kind: "refute", f: { claimDigest: digest, proven: false, loss: 0n, tier: 0 } });

describe("requestRefutations : signatures vérifiées, réunies par résultat et par opérateur", () => {
  it("deux opérateurs distincts « non prouvée » → prête ; le clair reçu est la source du protocole (secret du rapport)", async () => {
    const b = emulated(OP_B, notProven), c = emulated(OP_C, notProven);
    const { r, accepted } = await round([b, c]);
    expect(r.status).toBe("ready");
    expect(r.refuters).toEqual([OP_B, OP_C]);
    expect(r.disagreement).toBe(false);
    expect(b.seen[0]).toMatchObject({ from: "protocol" });
    expect(b.seen[0]).toHaveProperty("sharedSecret");
    const call = prepareRefuteCall(accepted, r, D);
    expect(call).toMatchObject({ address: SEALED, functionName: "refute" });
    expect(call.args[1]).toEqual([OP_A]);
    expect(call.args[3]).toHaveLength(2);
  });

  it("signature d'une autre clé, « réfutation » qui ne contredit pas, autre digest → rejetées ; quorum non atteint", async () => {
    const b = emulated(OP_B, notProven, generatePrivateKey()); // signe avec une clé qui n'est pas celle inscrite
    const c = emulated(OP_C, (d) => ({ kind: "refute", f: { claimDigest: d, proven: true, loss: 5_000_000n, tier: 0 } })); // identique à la réclamation
    const e = emulated(getAddress("0x00000000000000000000000000000000000000d4"), () => ({ kind: "refute", f: { claimDigest: keccak256("0x01"), proven: false, loss: 0n, tier: 0 } }));
    const { r } = await round([b, c, e]);
    expect(r.status).toBe("insufficient");
    expect(r.results.map((x) => x.status)).toEqual(["error", "error", "error"]);
    expect(r.results[0]!.reason).toMatch(/pas par l'enclave vérifiée/);
    expect(r.results[1]!.reason).toMatch(/ne contredit pas/);
    expect(r.results[2]!.reason).toMatch(/autre réclamation/);
  });

  it("désaccord : deux résultats différents, ou confirmée ET réfutée → signalé ; le plus grand groupe d'opérateurs l'emporte", async () => {
    const d4 = getAddress("0x00000000000000000000000000000000000000d4");
    const b = emulated(OP_B, notProven), c = emulated(OP_C, notProven);
    const x = emulated(d4, (d) => ({ kind: "refute", f: { claimDigest: d, proven: true, loss: 1_000_000n, tier: 0 } }));
    const { r } = await round([b, c, x]);
    expect(r.status).toBe("ready");
    expect(r.refutation).toMatchObject({ proven: false });
    expect(r.disagreement).toBe(true);
    expect(r.message).toMatch(/désaccord/);

    const conf = await round([emulated(OP_B, () => ({ kind: "confirm" })), emulated(OP_C, () => ({ kind: "confirm" }))]);
    expect(conf.r.status).toBe("confirmed");
    expect(() => prepareRefuteCall(conf.accepted, conf.r, D)).toThrow(/non prête/);
  });

  it("enclave de l'opérateur de la réclamation écartée et clé non inscrite jamais contactée ; quorum non atteignable → rien n'est posté", async () => {
    const a = emulated(OP_A, notProven), b = emulated(OP_B, notProven), ghost = emulated(OP_C, notProven);
    const { r, posted } = await round([a, b, ghost], undefined, [ghost]);
    expect(r.status).toBe("unreachable");
    expect(r.results.map((x) => x.status)).toEqual(["excluded", "skipped", "unverified"]);
    expect(r.results[2]!.reason).toMatch(/ne correspond pas à celle inscrite sur Arc/);
    expect(r.message).toMatch(/un seul opérateur éligible/);
    expect(r.message).toMatch(/rien n'a été envoyé/);
    expect(posted).toEqual([]);
    expect(a.seen.length + b.seen.length + ghost.seen.length).toBe(0);
  });
});
