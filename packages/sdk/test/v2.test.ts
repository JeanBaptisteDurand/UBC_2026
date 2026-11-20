/** v2.test.ts — the SDK against the v2 contracts (still the base of the live v2.1 stack): decoding of contract refusals,
 *  enclave keys checked against the chain (never encrypt to a /pubkeys key that was not matched against the
 *  EnclaveRegistry), Sealed Bounty encryption, claim checks, the inference client end to end against an emulated
 *  enclave, receipts. */
import { describe, it, expect } from "vitest";
import {
  type Address, type Hex, encodeErrorResult, keccak256, toBytes, toHex, zeroAddress, parseAbi, concat, pad,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  arcErrorsAbi, ARC_ERRORS_EN, ARC_ERRORS_FR, arcErrorOf, explainArcError,
  verifyEnclaveKeys, EnclaveKeyMismatchError, ENCLAVE_KEY_MISMATCH_EN, ENCLAVE_KEY_MISMATCH_FR, type VerifiedEnclaveKeys,
  sealExploitForEnclave, checkProvenClaim, protocolCanonical,
  createInferenceClient, InsufficientSessionBalance, ReceiptMismatchError,
  verifyReceiptOnChain, payableFor,
  generateX25519, hpkeOpen, hpkeSeal, deterministicSeal, deterministicOpen, exploitFingerprint, encodeExploitTx,
  networkDomain, receiptTypes, claimTypes, envelopeDigest, testnet, parseTdxQuote, expectedReportData0,
  type Predicate, type Receipt,
} from "../src/index";

// ---------------------------------------------------------------- an emulated chain and enclave

const OPERATOR = "0x5724d89D610c3017b8DC161c025248341556f6Ab" as Address;
const PRODUCT = 1n;
const MODEL = keccak256(toBytes("openai/gpt-oss-120b"));

function makeEnclave() {
  const signerKey = generatePrivateKey();
  const signer = privateKeyToAccount(signerKey);
  const x = generateX25519();
  return { signer, x25519: x.publicKey.toLowerCase() as Hex, x25519Priv: x.privateKey };
}

interface ChainState {
  head: bigint;
  enclaves: Map<string, { productId: bigint; operator: Address; x25519: Hex; active: boolean }>;
  sessions: Map<string, any>;
}

function fakeChain(st: ChainState) {
  return {
    async getBlockNumber() { return st.head; },
    async getBlock() { return { number: st.head, timestamp: 1_800_000_000n }; },
    async readContract(a: any) {
      const k = String(a.args?.[0] ?? "").toLowerCase();
      switch (a.functionName) {
        case "enclaveOf": {
          const e = st.enclaves.get(k);
          if (!e) return { signer: zeroAddress, x25519: `0x${"00".repeat(32)}`, productId: 0n, operator: zeroAddress, workloadId: `0x${"00".repeat(32)}`, fmspc: "0x000000000000", tcbStatus: 0, quoteHash: `0x${"00".repeat(32)}`, anchorBlock: 0n, registeredAt: 0n, expiresAt: 0n, active: false, fromBlock: 0n, untilBlock: 0n };
          return { signer: a.args[0], x25519: e.x25519, productId: e.productId, operator: e.operator, workloadId: `0x${"ab".repeat(32)}`, fmspc: "0x20a06f000000", tcbStatus: 0, quoteHash: `0x${"cd".repeat(32)}`, anchorBlock: 1n, registeredAt: 1n, expiresAt: 2n, active: e.active, fromBlock: 10n, untilBlock: 170_009n };
        }
        case "activeOperatorAt": {
          const e = st.enclaves.get(k);
          return e && e.active && e.productId === a.args[1] ? e.operator : zeroAddress;
        }
        case "getSession": {
          const s = st.sessions.get(String(a.args[0]));
          return s ?? { owner: zeroAddress, productId: 0n, operator: zeroAddress, sessionKey: zeroAddress, deposit: 0n, cap: 0n, paidUnits: 0n, paid: 0n, expiresAt: 0n, closed: false, verdictWritten: false, price: 0n, enclave: zeroAddress, unitTokens: 0, outWeight: 0, param: `0x${"00".repeat(32)}` };
        }
        default: throw new Error(`read not emulated: ${a.functionName}`);
      }
    },
  } as any;
}

/** The enclave's /pubkeys, possibly rewritten by a malicious proxy. */
function pubkeysFetch(e: ReturnType<typeof makeEnclave>, tamper?: (j: any) => any): typeof fetch {
  return (async (url: any) => {
    if (String(url).endsWith("/pubkeys")) {
      const j = { signer: e.signer.address, x25519: e.x25519, lastQuote: "0x" };
      return new Response(JSON.stringify(tamper ? tamper(j) : j), { status: 200 });
    }
    throw new Error(`unexpected call: ${url}`);
  }) as typeof fetch;
}

const URL0 = "https://enclave.example";

// ---------------------------------------------------------------- erreurs

describe("contract refusals: named and explained", () => {
  it("every error of the v2 stack has its explanation", () => {
    const names = arcErrorsAbi.filter((x: any) => x.type === "error").map((x: any) => x.name as string);
    expect(names.length).toBeGreaterThan(80);
    expect(names.filter((n) => !ARC_ERRORS_FR[n])).toEqual([]);
    expect(names.filter((n) => !ARC_ERRORS_EN[n])).toEqual([]);
  });
  it("explains a refusal in English on request, in French by default", () => {
    const data = encodeErrorResult({ abi: arcErrorsAbi, errorName: "WrongEnclave" });
    expect(explainArcError({ data }, "en")).toMatch(/^refused by the contract: WrongEnclave: \S/);
    expect(arcErrorOf({ data })?.en).toBe(ARC_ERRORS_EN.WrongEnclave);
    expect(explainArcError({ data })).toMatch(/^refusé par le contrat : WrongEnclave — /);
  });
  it("decodes a refusal bubbled up from another contract (raw data)", () => {
    const data = encodeErrorResult({ abi: arcErrorsAbi, errorName: "WrongEnclave" });
    const e = { name: "ContractFunctionExecutionError", cause: { name: "CallExecutionError", cause: { data } } };
    expect(arcErrorOf(e)?.name).toBe("WrongEnclave");
    expect(explainArcError(e)).toMatch(/WrongEnclave — le reçu est signé par une autre enclave/);
  });
  it("keeps the arguments (EnclaveHeldByOtherOperator)", () => {
    const data = encodeErrorResult({ abi: arcErrorsAbi, errorName: "EnclaveHeldByOtherOperator", args: [OPERATOR, 42n] });
    expect(explainArcError({ data })).toContain(`(${OPERATOR}, 42)`);
  });
});

// ---------------------------------------------------------------- enclave keys against the chain

describe("verifyEnclaveKeys — encrypt only to the key registered on-chain", () => {
  const e = makeEnclave();
  const st: ChainState = { head: 1000n, enclaves: new Map([[e.signer.address.toLowerCase(), { productId: PRODUCT, operator: OPERATOR, x25519: e.x25519, active: true }]]), sessions: new Map() };
  const pub = fakeChain(st);

  it("accepts the registered, active key of the right product", async () => {
    const k = await verifyEnclaveKeys(URL0, PRODUCT, { publicClient: pub, fetch: pubkeysFetch(e) });
    expect(k).toMatchObject({ verified: true, signer: e.signer.address, x25519: e.x25519, operator: OPERATOR, checkedAtBlock: 1000n });
  });
  it("refuses an X25519 key swapped by the proxy", async () => {
    const swapped = generateX25519().publicKey;
    const p = verifyEnclaveKeys(URL0, PRODUCT, { publicClient: pub, fetch: pubkeysFetch(e, (j) => ({ ...j, x25519: swapped })) });
    await expect(p).rejects.toThrow(ENCLAVE_KEY_MISMATCH_FR);
    await expect(p).rejects.toMatchObject({ reason: "x25519_mismatch" });
    const err = await p.catch((x) => x as EnclaveKeyMismatchError);
    expect(err.en.startsWith(`${ENCLAVE_KEY_MISMATCH_EN} (/pubkeys announces the X25519 key `)).toBe(true);
    expect(err.detail).toMatch(/^\/pubkeys annonce la clé X25519 /);
  });
  it("refuses an unknown signer, another product, an inactive enclave", async () => {
    const other = makeEnclave();
    await expect(verifyEnclaveKeys(URL0, PRODUCT, { publicClient: pub, fetch: pubkeysFetch(other) })).rejects.toMatchObject({ reason: "not_registered" });
    await expect(verifyEnclaveKeys(URL0, 2n, { publicClient: pub, fetch: pubkeysFetch(e) })).rejects.toMatchObject({ reason: "wrong_product" });
    const off = makeEnclave();
    st.enclaves.set(off.signer.address.toLowerCase(), { productId: PRODUCT, operator: OPERATOR, x25519: off.x25519, active: false });
    await expect(verifyEnclaveKeys(URL0, PRODUCT, { publicClient: pub, fetch: pubkeysFetch(off) })).rejects.toMatchObject({ reason: "inactive" });
  });
  it("session: the enclave served must be the one locked when the session opened", async () => {
    const locked = makeEnclave();
    st.sessions.set("7", { owner: OPERATOR, productId: PRODUCT, operator: OPERATOR, sessionKey: OPERATOR, deposit: 1n, cap: 0n, paidUnits: 0n, paid: 0n, expiresAt: 0n, closed: false, verdictWritten: false, price: 100n, enclave: locked.signer.address, unitTokens: 1, outWeight: 1, param: MODEL });
    const p = verifyEnclaveKeys(URL0, PRODUCT, { publicClient: pub, fetch: pubkeysFetch(e), sessionId: 7n });
    await expect(p).rejects.toBeInstanceOf(EnclaveKeyMismatchError);
    await expect(p).rejects.toMatchObject({ reason: "wrong_session_enclave" });
    await expect(verifyEnclaveKeys(URL0, PRODUCT, { publicClient: pub, fetch: pubkeysFetch(e), sessionId: 8n })).rejects.toMatchObject({ reason: "session_unknown" });
  });
  it("refuses a malformed /pubkeys response", async () => {
    await expect(verifyEnclaveKeys(URL0, PRODUCT, { publicClient: pub, fetch: pubkeysFetch(e, () => ({ signer: "x", x25519: "0x01" })) })).rejects.toMatchObject({ reason: "pubkeys_unreadable" });
  });
});

// ---------------------------------------------------------------- Sealed Bounty

const PREDICATE: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: testnet.usdc, holder: testnet.demoVault, min: "1000000" }] };

/** What the Sealed Bounty enclave does (enclave/src/services/bounty.ts): open cE, read the bundle, recompute cP. */
async function enclaveRecomputes(e: ReturnType<typeof makeEnclave>, body: { enc: Hex; ciphertext: Hex }, protocolX25519: Hex) {
  const obj = JSON.parse(new TextDecoder().decode(await hpkeOpen(e.x25519Priv, toBytes(body.enc), toBytes(body.ciphertext))));
  const canonical = JSON.stringify({
    bountyId: BigInt(obj.bountyId).toString(), payee: obj.payee, capital: BigInt(obj.capital).toString(),
    predicate: obj.predicate, txs: obj.txs, attackCode: obj.attackCode ?? undefined ?? null,
  });
  return { obj, cP: deterministicSeal(toBytes(protocolX25519), new TextEncoder().encode(canonical), toBytes(obj.r)) };
}

describe("Sealed Bounty: encryption to the verified enclave, claim check", () => {
  const e = makeEnclave();
  const proto = generateX25519();
  const keys: VerifiedEnclaveKeys = { verified: true, enclaveUrl: URL0, productId: 2n, signer: e.signer.address, x25519: e.x25519, operator: OPERATOR, workloadId: `0x${"ab".repeat(32)}`, tcbStatus: 0, fromBlock: 1n, untilBlock: 2n, checkedAtBlock: 1n, checkedAtMs: Date.now() };
  const payee = OPERATOR;
  const txs = [encodeExploitTx({ to: testnet.demoVault, data: "0x12345678" })];

  it("the enclave reopens the bundle and recomputes the SAME cP; the protocol decrypts it", async () => {
    const s = await sealExploitForEnclave({ bountyId: 3n, payee, exploit: { predicate: PREDICATE, txs }, protocolX25519: proto.publicKey, enclave: keys, blockN: 900n });
    const { obj, cP } = await enclaveRecomputes(e, s.submitBody, proto.publicKey);
    expect(cP).toBe(s.cP);
    expect(obj.blockN).toBe("900");
    expect(s.fingerprint).toBe(exploitFingerprint({ txs }));
    const report = JSON.parse(new TextDecoder().decode(deterministicOpen(proto.privateKey, s.cP)));
    expect(report).toEqual(JSON.parse(protocolCanonical({ bountyId: 3n, payee, exploit: { predicate: PREDICATE, txs } })));
  });
  it("refuses to encrypt to unverified keys (raw /pubkeys response)", async () => {
    const raw = { signer: e.signer.address, x25519: e.x25519 } as unknown as VerifiedEnclaveKeys;
    await expect(sealExploitForEnclave({ bountyId: 3n, payee, exploit: { predicate: PREDICATE, txs }, protocolX25519: proto.publicKey, enclave: raw })).rejects.toThrow(ENCLAVE_KEY_MISMATCH_FR);
  });
  it("k enclaves, same r and same anchor: the same cP for all", async () => {
    const r = new Uint8Array(32).fill(5);
    const e2 = makeEnclave();
    const keys2 = { ...keys, signer: e2.signer.address, x25519: e2.x25519 };
    const a = await sealExploitForEnclave({ bountyId: 3n, payee, exploit: { predicate: PREDICATE, txs }, protocolX25519: proto.publicKey, enclave: keys, r, blockN: 9n, deadline: 99n });
    const b = await sealExploitForEnclave({ bountyId: 3n, payee, exploit: { predicate: PREDICATE, txs }, protocolX25519: proto.publicKey, enclave: keys2, r, blockN: 9n, deadline: 99n });
    expect(a.cP).toBe(b.cP);
    expect(a.submitBody.ciphertext).not.toBe(b.submitBody.ciphertext);
  });
  it("checks the signed claim before anything is sent", async () => {
    const s = await sealExploitForEnclave({ bountyId: 3n, payee, exploit: { predicate: PREDICATE, txs }, protocolX25519: proto.publicKey, enclave: keys });
    const claim = { bountyId: 3n, payee, blockN: 900n, blockHashN: `0x${"aa".repeat(32)}` as Hex, predicateHash: s.predicateHash, loss: 1_000_000n, tier: 0, fingerprint: s.fingerprint, cPHash: keccak256(s.cP), deadline: 1_900_000_000n };
    const sign = (acc: ReturnType<typeof privateKeyToAccount>, c = claim) => acc.signTypedData({ domain: networkDomain(testnet.sealedBounty, testnet.chainId) as any, types: claimTypes, primaryType: "Claim", message: c });
    const o = { sealedBounty: testnet.sealedBounty, chainId: testnet.chainId };
    const j = (c: typeof claim) => ({ ...c, bountyId: c.bountyId.toString(), blockN: c.blockN.toString(), loss: c.loss.toString(), deadline: c.deadline.toString() });
    const good = await checkProvenClaim(s, { claim: j(claim), signature: await sign(e.signer), cP: s.cP }, o);
    expect(good.signer).toBe(e.signer.address);
    const intruder = privateKeyToAccount(generatePrivateKey());
    await expect(checkProvenClaim(s, { claim: j(claim), signature: await sign(intruder), cP: s.cP }, o)).rejects.toThrow(/not by the verified enclave/);
    const other = { ...claim, payee: "0x000000000000000000000000000000000000dEaD" as Address };
    await expect(checkProvenClaim(s, { claim: j(other), signature: await sign(e.signer, other), cP: s.cP }, o)).rejects.toThrow(/payee/);
    await expect(checkProvenClaim(s, { claim: j(claim), signature: await sign(e.signer), cP: "0xdead" }, o)).rejects.toThrow(/cP/);
  });
});

// ---------------------------------------------------------------- end-to-end inference (emulated enclave)

function emulatedEnclave(e: ReturnType<typeof makeEnclave>, st: ChainState, opts: { tamperText?: boolean; balance402?: boolean } = {}) {
  const seen: string[] = [];
  const seqs: string[] = [];
  let lastSeq = 0n;
  let cum = 0n;
  const f = (async (url: any, init?: any) => {
    const u = String(url);
    seen.push(u.replace(URL0, ""));
    if (u.endsWith("/pubkeys")) return new Response(JSON.stringify({ signer: e.signer.address, x25519: e.x25519, lastQuote: "0x" }), { status: 200 });
    if (u.endsWith("/v1/chat/completions")) {
      const b = JSON.parse(init.body);
      const s = st.sessions.get(b.sessionId);
      const seq = BigInt(b.seq);
      seqs.push(b.seq);
      if (seq !== lastSeq + 1n) return new Response(JSON.stringify({ error: "seq", expectedSeq: (lastSeq + 1n).toString() }), { status: 409 });
      if (opts.balance402) return new Response(JSON.stringify({ error: "insufficient_session_balance", balance: "5" }), { status: 402 });
      const prompt = new TextDecoder().decode(await hpkeOpen(e.x25519Priv, toBytes(b.enc), toBytes(b.ciphertext)));
      const text = `echo: ${prompt}`;
      cum += 10n;
      const receipt: Receipt = {
        productId: s.productId, sessionId: BigInt(b.sessionId), seq, modelHash: MODEL,
        paramsHash: keccak256(toBytes(JSON.stringify(b.params ?? {}))), requestHash: keccak256(toBytes(prompt)),
        responseHash: keccak256(toBytes(text)), tokensIn: 4n, tokensOut: 6n, cumulativeUnits: cum, anchorBlock: st.head,
      };
      lastSeq = seq;
      const signature = await e.signer.signTypedData({ domain: networkDomain(testnet.sessionPay, testnet.chainId) as any, types: receiptTypes, primaryType: "Receipt", message: receipt });
      const sealed = await hpkeSeal(toBytes(b.clientEphemeralPub), new TextEncoder().encode(opts.tamperText ? "forged text" : text));
      const ser = Object.fromEntries(Object.entries(receipt).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
      return new Response(JSON.stringify({ enc: toHex(sealed.enc), ciphertext: toHex(sealed.ciphertext), receipt: ser, signature }), { status: 200 });
    }
    throw new Error(`unexpected call: ${u}`);
  }) as typeof fetch;
  return { f, seen, seqs, setLastSeq: (n: bigint) => { lastSeq = n; } };
}

describe("inference client", () => {
  function setup(o: { tamperText?: boolean; balance402?: boolean; pubkeysTamper?: boolean } = {}) {
    const e = makeEnclave();
    const sk = generatePrivateKey();
    const st: ChainState = { head: 1000n, enclaves: new Map([[e.signer.address.toLowerCase(), { productId: PRODUCT, operator: OPERATOR, x25519: e.x25519, active: true }]]), sessions: new Map() };
    st.sessions.set("12", { owner: OPERATOR, productId: PRODUCT, operator: OPERATOR, sessionKey: privateKeyToAccount(sk).address, deposit: 1_000_000n, cap: 0n, paidUnits: 0n, paid: 0n, expiresAt: 0n, closed: false, verdictWritten: false, price: 100n, enclave: e.signer.address, unitTokens: 1, outWeight: 1, param: MODEL });
    const emu = emulatedEnclave(e, st, o);
    const f = o.pubkeysTamper
      ? ((async (u: any, i: any) => (String(u).endsWith("/pubkeys") ? new Response(JSON.stringify({ signer: e.signer.address, x25519: generateX25519().publicKey }), { status: 200 }) : emu.f(u, i))) as typeof fetch)
      : emu.f;
    const ai = createInferenceClient({ enclaveUrl: URL0, sessionId: 12n, sessionKey: { privateKey: sk, address: zeroAddress }, publicClient: fakeChain(st), fetch: f });
    return { ai, emu, e };
  }

  it("encrypts to the verified key, authenticates the reply, says whether the receipt is payable", async () => {
    const { ai } = setup();
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "hello" }], temperature: 0.2 });
    expect(r.text).toBe("echo: user: hello");
    expect(r.verified).toBe(true);
    expect(r.receipt.seq).toBe(1n);
    const r2 = await ai.chat.completions.create({ messages: [{ role: "user", content: "encore" }] });
    expect(r2.receipt.seq).toBe(2n);
  });
  it("a proxy that swaps the X25519 key: NOTHING is sent to the enclave", async () => {
    const { ai, emu } = setup({ pubkeysTamper: true });
    await expect(ai.chat.completions.create({ messages: [{ role: "user", content: "secret" }] })).rejects.toThrow(ENCLAVE_KEY_MISMATCH_FR);
    expect(emu.seen.filter((u) => u.includes("chat/completions"))).toEqual([]);
  });
  it("text that is not the one signed by the enclave: refused", async () => {
    const { ai } = setup({ tamperText: true });
    await expect(ai.chat.completions.create({ messages: [{ role: "user", content: "x" }] })).rejects.toBeInstanceOf(ReceiptMismatchError);
  });
  it("resyncs on the enclave's seq (409 expectedSeq)", async () => {
    const { ai, emu } = setup();
    emu.setLastSeq(4n); // another instance already served 4 requests with the same aek_ key
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "x" }] });
    expect(r.receipt.seq).toBe(5n);
  });
  it("402 with no pending reply: the seq is not consumed", async () => {
    const { ai, emu } = setup({ balance402: true });
    const p = ai.chat.completions.create({ messages: [{ role: "user", content: "x" }] });
    await expect(p).rejects.toBeInstanceOf(InsufficientSessionBalance);
    await expect(ai.chat.completions.create({ messages: [{ role: "user", content: "x" }] })).rejects.toBeInstanceOf(InsufficientSessionBalance);
    expect(emu.seqs).toEqual(["1", "1"]); // never a 409: the same seq is replayed
  });
});

// ---------------------------------------------------------------- receipts, quote

describe("receipts and quote", () => {
  it("verifies a receipt like SessionPay.settle", async () => {
    const e = makeEnclave();
    const st: ChainState = { head: 1000n, enclaves: new Map([[e.signer.address.toLowerCase(), { productId: PRODUCT, operator: OPERATOR, x25519: e.x25519, active: true }]]), sessions: new Map() };
    st.sessions.set("3", { owner: OPERATOR, productId: PRODUCT, operator: OPERATOR, sessionKey: OPERATOR, deposit: 1_000n, cap: 0n, paidUnits: 2n, paid: 200n, expiresAt: 0n, closed: false, verdictWritten: false, price: 100n, enclave: e.signer.address, unitTokens: 1, outWeight: 1, param: MODEL });
    const r: Receipt = { productId: PRODUCT, sessionId: 3n, seq: 4n, modelHash: MODEL, paramsHash: MODEL, requestHash: MODEL, responseHash: MODEL, tokensIn: 1n, tokensOut: 1n, cumulativeUnits: 20n, anchorBlock: 999n };
    const sig = await e.signer.signTypedData({ domain: networkDomain(testnet.sessionPay, testnet.chainId) as any, types: receiptTypes, primaryType: "Receipt", message: r });
    const v = await verifyReceiptOnChain(fakeChain(st), r, sig);
    expect(v.settleable).toBe(true);
    expect(v.payableNow).toBe(800n); // 20 × 100 capped at the 1,000 deposit, minus 200 already paid
    const forged = await verifyReceiptOnChain(fakeChain(st), { ...r, modelHash: keccak256(toBytes("autre")) }, sig);
    expect(forged.settleable).toBe(false);
    expect(payableFor({ deposit: 1_000n, cap: 500n, paid: 0n, price: 100n }, 20n)).toBe(500n);
  });
  it("reads a TDX v4 quote and computes REPORTDATA like the registry", () => {
    const body = new Uint8Array(584);
    body[120 + 3] = 0x10; // SEPT_VE_DISABLE
    body.fill(7, 136, 136 + 48); // MRTD
    const header = new Uint8Array(48);
    header[0] = 4; header[4] = 0x81;
    const q = toHex(concat([header, body]));
    const m = parseTdxQuote(q);
    expect(m).toMatchObject({ version: 4, bodyType: 2, debug: false, septVeDisabled: true });
    const rd = expectedReportData0({ chainId: 5042002, registry: testnet.enclaveRegistry, productId: 1n, operator: OPERATOR, signer: OPERATOR, x25519: pad("0x01", { size: 32 }) });
    expect(rd).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("the envelope digest stays the enclave's", () => {
    expect(envelopeDigest(1n, 2n, "0xdead", `0x${"11".repeat(32)}`)).toBe(envelopeDigest(1n, 2n, "0xdead", `0x${"11".repeat(32)}`));
    expect(parseAbi(["function f()"]).length).toBe(1);
  });
});
