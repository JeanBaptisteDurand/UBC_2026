/**
 * The skeptical verifier's proofs (9 Nov) on the x402 rail, TURNED AROUND: each proven flaw becomes here a test of good
 * behavior. The same harness as x402-e2e (an emulated chain, the REAL SDK client, the enclave's REAL application, the
 * registrar's REAL settlement queue).
 *  1. a fake "price changed" 402 after the service → the client sends the IDENTICAL request again (resumption), one
 *     single authorization;
 *  2. a proxy's 502 after the service → identical resends, then X402PaidCallError (never "nothing is owed"), which
 *     carries what is needed to resume (resume);
 *  3. (new) a real on-chain price change → a new authorization for the SAME nonce: at most one settlement;
 *  4. POST /x402/settled restricted to the operator (signed, timestamped, not replayable, bounded) and deduplicated;
 *  5. unpayable calls no longer block the bond (reconciliation), a global bound per window.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  type Address,
  type Hex,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
  toHex,
  zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { EnclaveKit } from "../src/kit/enclave-kit";
import { RpcQuorum } from "../src/kit/rpc-quorum";
import { eip3009SignatureProblem } from "../src/services/x402";
import { X402Gateway, type X402ChainReader, type X402GatewayConfig } from "../src/services/x402-gateway";
import { x402AckDomain, x402AckTypes } from "../src/services/x402-ack";
import { createSealedX402App } from "../products/sealed-x402/app";
import { createQuorumX402Reader, USDC_READ_ABI } from "../products/sealed-x402/chain";
import {
  createX402Client,
  createX402SettlementQueue,
  callReceiptTypes,
  receiveWithAuthorizationTypes,
  parseX402PaidRequest,
  serializeX402PaidRequest,
  testnet,
  X402CallError,
  X402PaidCallError,
  X402_PRICE_CHANGED,
  type Deployment,
} from "../../packages/sdk/src/index";

const CHAIN = testnet.chainId;
const PRODUCT = 3n;
const PRICE = 10_000n;
const MODEL = keccak256(toBytes("openai/gpt-oss-120b"));
const URL0 = "https://enclave.example/enclave/x402";
const D: Deployment = { ...testnet, products: { inference: 1n, bounty: 2n, x402: PRODUCT } };
const OPERATOR = privateKeyToAccount(generatePrivateKey());
const AUTHOR = "0x00000000000000000000000000000000000000a7" as Address;
const L = (x: string) => x.toLowerCase();
const FAST = [2, 2, 2] as const; // delays of the identical resends in these tests (ms)

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------- the emulated chain

interface World {
  head: bigint;
  timestamp: bigint;
  product: { active: boolean; price: bigint; settlement: Address; param: Hex; exposureCap: bigint };
  enclaves: Map<string, { productId: bigint; operator: Address; x25519: Hex; active: boolean }>;
  used: Set<string>;
  balances: Map<string, bigint>;
  settlements: Array<{ nonce: Hex; amount: bigint; operator: Address; tx: Hex }>;
  /** the operator's exposure capacity read on-chain; null = not read */
  capacity: bigint | null;
  /** reads made by the enclave: paymentState, authorizationUsed, batched reads */
  reads: { payment: number; auth: number; batch: number };
}
function world(): World {
  return {
    head: 5_000n,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    product: { active: true, price: PRICE, settlement: D.x402Settler, param: MODEL, exposureCap: 0n },
    enclaves: new Map(),
    used: new Set(),
    balances: new Map(),
    settlements: [],
    capacity: null,
    reads: { payment: 0, auth: 0, batch: 0 },
  };
}
const activeOperatorAt = (w: World, signer: Address, pid: bigint): Address => {
  const e = w.enclaves.get(L(signer));
  return e && e.active && e.productId === pid ? e.operator : zeroAddress;
};
async function emulateSettle(w: World, args: readonly any[]): Promise<void> {
  const [cr, enclaveSig, auth] = args as [any, Hex, any];
  if (!w.product.active) throw new Error("BadProduct");
  const amount = BigInt(cr.units) * w.product.price;
  const signer = await recoverTypedDataAddress({
    domain: { name: "ArcEnclaveNetwork", version: "1", chainId: CHAIN, verifyingContract: D.x402Settler },
    types: callReceiptTypes, primaryType: "CallReceipt", message: cr, signature: enclaveSig,
  });
  const operator = activeOperatorAt(w, signer, BigInt(cr.productId));
  if (operator === zeroAddress) throw new Error("InactiveEnclave");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (!(now > BigInt(auth.validAfter)) || !(now < BigInt(auth.validBefore))) throw new Error("FiatTokenV2: authorization is expired");
  const k = `${L(cr.payer)}:${L(cr.nonce)}`;
  if (w.used.has(k)) throw new Error("FiatTokenV2: authorization is used or canceled");
  if (eip3009SignatureProblem(auth.signature)) throw new Error("ECRecover: invalid signature");
  const from = await recoverTypedDataAddress({
    domain: { name: "USDC", version: "2", chainId: CHAIN, verifyingContract: D.usdc },
    types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization",
    message: { from: cr.payer, to: D.x402Settler, value: amount, validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore), nonce: cr.nonce },
    signature: auth.signature,
  });
  if (L(from) !== L(cr.payer)) throw new Error("FiatTokenV2: invalid signature");
  const bal = w.balances.get(L(cr.payer)) ?? 0n;
  if (bal < amount) throw new Error("ERC20: transfer amount exceeds balance");
  w.used.add(k);
  w.balances.set(L(cr.payer), bal - amount);
  w.balances.set(L(operator), (w.balances.get(L(operator)) ?? 0n) + (amount * 9500n) / 10_000n);
  w.settlements.push({ nonce: cr.nonce, amount, operator, tx: keccak256(toBytes(`${k}:${w.settlements.length}`)) });
}
function fakePub(w: World): any {
  return {
    async getBlockNumber() { return w.head; },
    async getBlock() { return { number: w.head, timestamp: BigInt(Math.floor(Date.now() / 1000)) }; },
    async readContract(a: any) {
      const x = a.args ?? [];
      switch (a.functionName) {
        case "enclaveOf": {
          const e = w.enclaves.get(L(x[0]));
          const z = `0x${"00".repeat(32)}`;
          if (!e) return { signer: zeroAddress, x25519: z, productId: 0n, operator: zeroAddress, workloadId: z, fmspc: "0x000000000000", tcbStatus: 0, quoteHash: z, anchorBlock: 0n, registeredAt: 0n, expiresAt: 0n, active: false, fromBlock: 0n, untilBlock: 0n };
          return { signer: x[0], x25519: e.x25519, productId: e.productId, operator: e.operator, workloadId: `0x${"ab".repeat(32)}`, fmspc: "0x20a06f000000", tcbStatus: 0, quoteHash: z, anchorBlock: 1n, registeredAt: 1n, expiresAt: 2n, active: e.active, fromBlock: 1n, untilBlock: 1_000_000n };
        }
        case "activeOperatorAt": return activeOperatorAt(w, x[0], x[1]);
        case "getProduct": { const p = w.product; return { author: AUTHOR, manifestHash: `0x${"00".repeat(32)}`, deterministic: false, price: p.price, bpsOperator: 9500, bpsAuthor: 0, bpsNetwork: 500, minBond: 1_000_000n, exposureCap: p.exposureCap, settlement: p.settlement, param: p.param, version: 1n, activatesAt: 0n, state: p.active ? 2 : 3, unitTokens: 1, outWeight: 1 }; }
        case "isActive": return w.product.active;
        case "authorizationState": return w.used.has(`${L(x[0])}:${L(x[1])}`);
        case "balanceOf": return w.balances.get(L(x[0])) ?? 0n;
        default: throw new Error(`read not emulated: ${a.functionName}`);
      }
    },
    async simulateContract(a: any) {
      const copy: World = { ...w, used: new Set(w.used), balances: new Map(w.balances), settlements: [...w.settlements] };
      await emulateSettle(copy, a.args);
      return { request: { ...a } };
    },
    async waitForTransactionReceipt({ hash }: { hash: Hex }) { return { status: "success", gasUsed: 210_000n, transactionHash: hash }; },
  };
}
function operatorWallet(w: World): any {
  return { account: OPERATOR, async writeContract(req: any) { await emulateSettle(w, req.args); return w.settlements[w.settlements.length - 1]!.tx; } };
}
/** The payer's wallet; counts the signatures (EIP-3009 authorizations). */
function payerWallet(pk: Hex = generatePrivateKey()) {
  const account = privateKeyToAccount(pk);
  let signed = 0;
  return { account, signTypedData: (args: any) => { signed++; return account.signTypedData(args); }, signed: () => signed } as any;
}

function enclaveOn(w: World, over: Partial<X402GatewayConfig> = {}, o: { batched?: boolean } = {}) {
  const kit = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: D.enclaveRegistry, mockBlockHash: true });
  const reader: X402ChainReader = {
    async status(enclave, pid) { return { block: w.head, product: { ...w.product }, operator: activeOperatorAt(w, enclave, pid) }; },
    async paymentState({ enclave, productId, payer, nonce }) {
      w.reads.payment++;
      return {
        block: w.head, product: { ...w.product }, operator: activeOperatorAt(w, enclave, productId),
        authorizationUsed: w.used.has(`${L(payer)}:${L(nonce)}`), balance: w.balances.get(L(payer)) ?? 0n, payerHasCode: false, capacity: w.capacity,
      };
    },
    async authorizationUsed(payer, nonce) { w.reads.auth++; return w.used.has(`${L(payer)}:${L(nonce)}`); },
    ...(o.batched
      ? {
          async pendingState({ payers, auths }) {
            w.reads.batch++;
            return {
              block: w.head,
              balances: new Map(payers.map((p) => [L(p), w.balances.get(L(p)) ?? 0n] as const)),
              used: new Map(auths.map((a) => [`${L(a.payer)}:${L(a.nonce)}`, w.used.has(`${L(a.payer)}:${L(a.nonce)}`)] as const)),
            };
          },
        }
      : {}),
  };
  let calls = 0;
  const gateway = new X402Gateway(
    kit,
    { chainId: CHAIN, settler: D.x402Settler, usdc: D.usdc, network: "arc-testnet", usdcName: "USDC", usdcVersion: "2", modelHash: MODEL, operators: [OPERATOR.address], statusCacheMs: 0, log: () => {}, ...over },
    reader,
    { async complete(r) { calls++; return { text: `echo: ${r.messages.at(-1)!.content}`, tokensIn: 3, tokensOut: 4 }; } },
  );
  const app = createSealedX402App({ kit, gateway, attest: { operatorAllowlist: [OPERATOR.address], registeredOperator: async () => null, warn: () => {} }, log: () => {} });
  w.enclaves.set(L(kit.keys.signer), { productId: PRODUCT, operator: OPERATOR.address, x25519: L(kit.keys.x25519PublicKey) as Hex, active: true });
  const direct = (async (url: any, init?: any) => {
    const u = new URL(String(url));
    const path = u.pathname.replace(/^\/enclave\/x402/, "") + u.search;
    return app.request(path, { method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body });
  }) as typeof fetch;
  return { kit, app, gateway, direct, calls: () => calls };
}
const isPaid = (init?: any) => new Headers(init?.headers).has("x-payment");
const authValueOf = (init?: any) => BigInt(JSON.parse(atob(new Headers(init?.headers).get("x-payment")!)).payload.authorization.value);
const fake402 = () =>
  new Response(JSON.stringify({ x402Version: 1, error: X402_PRICE_CHANGED, detail: "price changed", accepts: [] }), { status: 402, headers: { "content-type": "application/json" } });

/** A signed "calls settled" report (by the operator by default), timestamped now; each item "settled by X402Settler"
 *  (settled: true) unless it says otherwise. */
async function signedAck(
  e: ReturnType<typeof enclaveOn>,
  raw: Array<{ payer: Address; nonce: Hex; settled?: boolean }>,
  o: { signer?: ReturnType<typeof privateKeyToAccount>; issuedAt?: bigint; ackNonce?: Hex; enclave?: Address } = {},
) {
  const items = raw.map((i) => ({ payer: i.payer, nonce: i.nonce, settled: i.settled ?? true }));
  const m = {
    enclave: o.enclave ?? e.kit.keys.signer,
    productId: PRODUCT,
    issuedAt: o.issuedAt ?? BigInt(Math.floor(Date.now() / 1000)),
    ackNonce: o.ackNonce ?? toHex(globalThis.crypto.getRandomValues(new Uint8Array(32))),
    items,
  };
  const signature = await (o.signer ?? OPERATOR).signTypedData({ domain: x402AckDomain(CHAIN, D.x402Settler), types: x402AckTypes, primaryType: "X402Settled", message: m });
  const body = JSON.stringify({ enclave: m.enclave, productId: m.productId.toString(), issuedAt: Number(m.issuedAt), ackNonce: m.ackNonce, items, signature });
  return { body, send: () => e.app.request("/x402/settled", { method: "POST", headers: { "content-type": "application/json" }, body }) };
}

// ---------------------------------------------------------------- proofs 1, 2 (and 3): the client facing a proxy

describe("x402: a proxy after the paid send (proofs 1 and 2, turned around)", () => {
  it("proof 1: a fake \"price changed\" 402 after the service → the client sends the IDENTICAL request again and receives the kept answer; ONE authorization, ONE call, ONE settlement", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    const payer = L(wallet.account.address);
    w.balances.set(payer, 1_000_000n);
    let faked = 0;
    const relay = (async (url: any, init?: any) => {
      const res = await e.direct(url, init);
      if (isPaid(init) && faked === 0 && res.status === 200) {
        faked++;
        return fake402(); // the proxy KEEPS the real answer and sends back a fake 402
      }
      return res;
    }) as typeof fetch;
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: relay, paidRetryDelaysMs: FAST });
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "one single question" }] });
    expect(r.text).toBe("echo: one single question");
    expect(r.replay).toBe(true); // the answer kept by the enclave
    expect(wallet.signed()).toBe(1); // never a second authorization on the strength of an unauthenticated 402
    expect(e.calls()).toBe(1);
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(1);
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    const rep = await q.runOnce();
    expect(rep.settled).toHaveLength(1);
    expect(w.balances.get(payer)).toBe(1_000_000n - PRICE); // debited ONCE
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(0); // signed report accepted
  });

  it("a repeated \"price changed\" 402 but an UNCHANGED on-chain price → never a second authorization; X402PaidCallError after the resends", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const relay = (async (url: any, init?: any) => {
      const res = await e.direct(url, init);
      return isPaid(init) ? fake402() : res;
    }) as typeof fetch;
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: relay, paidRetryDelaysMs: FAST });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "q" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err.code).toBe(X402_PRICE_CHANGED);
    expect(err.attempts).toBe(1 + FAST.length);
    expect(wallet.signed()).toBe(1);
    expect(e.calls()).toBe(1);
  });

  it("proof 2: a 502 after the service → identical resends, then X402PaidCallError WITHOUT \"nothing is owed\", with the envelope, the ephemeral key and the authorization; the resumption (even serialized) returns the answer, settled ONCE", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    const payer = L(wallet.account.address);
    w.balances.set(payer, 1_000_000n);
    const relay = (async (url: any, init?: any) => {
      const res = await e.direct(url, init);
      if (isPaid(init) && res.status === 200) return new Response(JSON.stringify({ error: "Bad Gateway" }), { status: 502, headers: { "content-type": "application/json" } });
      return res;
    }) as typeof fetch;
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: relay, paidRetryDelaysMs: FAST });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "q" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err).not.toBeInstanceOf(X402CallError); // X402CallError = before any payment, nothing is owed
    expect(String(err.message)).not.toContain("nothing is owed");
    expect(String(err.message)).toMatch(/operator MAY settle it/);
    expect(err).toMatchObject({ status: 502, code: "http_502", attempts: 1 + FAST.length, paid: true });
    const p = err.pending;
    expect(p.envelope).toMatchObject({ enc: expect.stringMatching(/^0x[0-9a-f]{64}$/), clientEphemeralPub: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(p.ephemeralPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.authorization).toMatchObject({ from: wallet.account.address, to: D.x402Settler, value: PRICE, nonce: p.nonce });
    expect(p.authorizations).toHaveLength(1);
    expect(Object.keys(err)).not.toContain("pending"); // the ephemeral key does not leave in a console.log(err)
    expect(e.calls()).toBe(1); // the resends are resumptions: one single call to the model
    // resumption later, through a healthy path (e.g. the direct Phala URL), after serialization
    const saved = serializeX402PaidRequest(p);
    const ai2 = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct });
    const r = await ai2.resume(parseX402PaidRequest(saved));
    expect(r.replay).toBe(true);
    expect(r.text).toBe("echo: q");
    expect(e.calls()).toBe(1);
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    expect((await q.runOnce()).settled).toHaveLength(1);
    expect(w.balances.get(payer)).toBe(1_000_000n - PRICE);
  });

  it("a fake 402 AND a real on-chain price change (upward) → nothing more expensive is signed on its own (price_increased, newPrice); accepted explicitly: a new authorization for the SAME request (same nonce); the enclave says 409 (served under the first); the client resends the first; at most ONE settlement", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    const payer = L(wallet.account.address);
    w.balances.set(payer, 1_000_000n);
    let faked = 0;
    const statuses: number[] = [];
    const relay = (async (url: any, init?: any) => {
      const res = await e.direct(url, init);
      if (isPaid(init)) statuses.push(res.status);
      if (isPaid(init) && res.status === 200 && faked < 2) {
        faked++;
        if (faked === 1) w.product = { ...w.product, price: 2n * PRICE }; // the author changes the price at the same moment
        return fake402();
      }
      return res;
    }) as typeof fetch;
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: relay, paidRetryDelaysMs: FAST });
    // evening of 9 Nov (proof E3): a price raised above the call's cap (the price read at its start) is NOT signed on its own
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "price" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err.code).toBe("price_increased");
    expect(err.newPrice).toBe(2n * PRICE);
    expect(err.message).toContain("maxPrice: err.newPrice");
    expect(wallet.signed()).toBe(1);
    expect(err.pending.authorizations).toHaveLength(1);
    expect(statuses).toEqual([200, 200]); // served, resumption (answers hidden by the proxy)
    // the payer ACCEPTS the new price: a second authorization, same nonce; the enclave served it under the first (409) and returns it
    const r = await ai.resume(err.pending, { renew: true, maxPrice: err.newPrice });
    expect(r.text).toBe("echo: price");
    expect(r.replay).toBe(true);
    expect(r.authorization.value).toBe(PRICE); // the answer served under the first authorization
    expect(wallet.signed()).toBe(2); // the second: price CONFIRMED on-chain AND accepted, same nonce
    expect(statuses).toEqual([200, 200, 409, 200]); // served, resumption, 409 (second authorization refused: already served), resumption
    expect(e.calls()).toBe(1);
    // at most ONE settlement: at the new price, the first authorization does not settle; back at the original price, it
    // settles once, and the second (same EIP-3009 nonce) is then unusable
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    expect((await q.runOnce()).settled).toHaveLength(0);
    w.product = { ...w.product, price: PRICE };
    expect((await q.runOnce()).settled).toHaveLength(1);
    expect(w.balances.get(payer)).toBe(1_000_000n - PRICE);
  });
});

describe("x402: resuming a paid call (resume)", () => {
  it("the paid send never reaches the enclave (a cut): X402PaidCallError; 7 min later the authorization no longer has the settlement window; resume({ renew }) signs a fresh one for the SAME nonce, served and settled ONCE", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    const payer = L(wallet.account.address);
    w.balances.set(payer, 1_000_000n);
    const cut = (async (url: any, init?: any) => {
      if (isPaid(init)) throw new TypeError("fetch failed"); // the connection drops before the enclave
      return e.direct(url, init);
    }) as typeof fetch;
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: cut, paidRetryDelaysMs: FAST });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "r" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err).toMatchObject({ status: 0, code: "network_error", attempts: 1 + FAST.length });
    expect(e.calls()).toBe(0);
    vi.setSystemTime(t0 + 420_000); // 7 min: the authorization (900 s) no longer has the 600 s the settlement requires
    const ai2 = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, paidRetryDelaysMs: FAST });
    const stale = await ai2.resume(err.pending).catch((x) => x);
    expect(stale).toBeInstanceOf(X402PaidCallError);
    expect(stale.code).toBe("invalid_exact_evm_payload_authorization_valid_before");
    expect(wallet.signed()).toBe(1); // never a new authorization unless asked (nor an on-chain price change)
    const r = await ai2.resume(err.pending, { renew: true });
    expect(r.text).toBe("echo: r");
    expect(r.replay).toBe(false);
    expect(r.authorization.nonce).toBe(err.pending.nonce);
    expect(r.authorization.signature).not.toBe(err.pending.authorization.signature);
    expect(wallet.signed()).toBe(2);
    expect(err.pending.authorizations).toHaveLength(1); // the original object is not modified
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    expect((await q.runOnce()).settled).toHaveLength(1);
    expect(w.balances.get(payer)).toBe(1_000_000n - PRICE);
    // resuming with another account, or for another product: refused before anything is sent
    const intruder = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: payerWallet(), publicClient: fakePub(w), deployment: D, fetch: e.direct });
    await expect(intruder.resume(err.pending)).rejects.toThrow("not by this client");
  });
});

// ---------------------------------------------------------------- proof 4: POST /x402/settled

describe("x402: POST /x402/settled restricted to the operator (proof 4, turned around)", () => {
  async function served(w: World, e: ReturnType<typeof enclaveOn>) {
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct });
    await ai.chat.completions.create({ messages: [{ role: "user", content: "x" }] });
    const p = await (await e.app.request("/x402/pending")).json();
    return { payer: p.items[0].receipt.payer as Address, nonce: p.items[0].receipt.nonce as Hex };
  }

  it("unsigned: 401; signed by a third party: 403; no on-chain read in either case", async () => {
    const w = world();
    const e = enclaveOn(w);
    const it0 = await served(w, e);
    const before = { ...w.reads };
    const unsigned = await e.app.request("/x402/settled", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: Array(200).fill(it0) }) });
    expect(unsigned.status).toBe(401);
    expect((await unsigned.json()).code).toBe("ack_unsigned");
    const stranger = await signedAck(e, Array(200).fill(it0), { signer: privateKeyToAccount(generatePrivateKey()) });
    const r403 = await stranger.send();
    expect(r403.status).toBe(403);
    expect((await r403.json()).code).toBe("ack_not_operator");
    expect(w.reads).toEqual(before);
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(1);
  });

  it("signed by the operator: 200 copies of a key = ONE read; replayed: 409; stale, future-dated, another enclave: 401; a body too long: 413", async () => {
    const w = world();
    const e = enclaveOn(w);
    const it0 = await served(w, e);
    const before = w.reads.auth;
    const a = await signedAck(e, Array(200).fill(it0));
    const r = await a.send();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ settled: [], pending: [`${L(it0.payer)}:${L(it0.nonce)}`], unknown: [] });
    expect(w.reads.auth - before).toBe(1); // deduplicated: one read for the key
    const replay = await e.app.request("/x402/settled", { method: "POST", headers: { "content-type": "application/json" }, body: a.body });
    expect(replay.status).toBe(409);
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const [o, code] of [
      [{ issuedAt: now - 3600n }, "ack_stale"],
      [{ issuedAt: now + 3600n }, "ack_stale"],
      [{ enclave: privateKeyToAccount(generatePrivateKey()).address }, "ack_wrong_enclave"],
    ] as const) {
      const res = await (await signedAck(e, [it0], o)).send();
      expect(res.status, code).toBe(401);
      expect((await res.json()).code).toBe(code);
    }
    expect(w.reads.auth - before).toBe(1);
    // the call settled on-chain: reported, it leaves the queue
    w.used.add(`${L(it0.payer)}:${L(it0.nonce)}`);
    expect((await (await (await signedAck(e, [it0, it0])).send()).json()).settled).toEqual([`${L(it0.payer)}:${L(it0.nonce)}`]);
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(0);
    expect(w.reads.auth - before).toBe(2); // one more read: that of the report that removed it
    // a body over 64 KiB: 413 on the Content-Length header; without it (a stream), the read stops at 64 KiB: refused
    const huge = JSON.stringify({ items: Array(800).fill(it0), pad: "x".repeat(70_000) });
    const big = await e.app.request("/x402/settled", { method: "POST", headers: { "content-type": "application/json", "content-length": String(huge.length) }, body: huge });
    expect(big.status).toBe(413);
    const chunked = await e.app.request("/x402/settled", { method: "POST", headers: { "content-type": "application/json" }, body: huge });
    expect(chunked.status).toBe(400);
    expect(w.reads.auth - before).toBe(2); // no read for bodies that are too long
  });

  it("bounded rate: beyond the reports allowed per minute, 429 (without a read); a batched read at one block when the reader can do it", async () => {
    const w = world();
    const e = enclaveOn(w, { ackRequestsPerMinute: 5 }, { batched: true });
    const it0 = await served(w, e);
    const batchBefore = w.reads.batch; // (the GET /x402/pending collection reads the balances again: one batched read)
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await (await signedAck(e, [it0, it0, it0])).send()).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(w.reads.batch - batchBefore).toBe(5); // one batched read per accepted report, none for the refused ones
    expect(w.reads.auth).toBe(0);
  });

  it("the registrar's queue signs its reports: signed by a key outside OPERATOR_ALLOWLIST, refused (403, logged) and the enclave's queue stays; signed by the operator, accepted", async () => {
    const w = world();
    const e = enclaveOn(w, { operators: [OPERATOR.address] });
    const pw = payerWallet();
    w.balances.set(L(pw.account.address), 1_000_000n);
    const wallet = { ...pw, writeContract: async (req: any) => { await emulateSettle(w, req.args); return w.settlements.at(-1)!.tx; } };
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct });
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "x" }] });
    await ai.settle(r); // the payer settles it themselves: the call is consumed on-chain, it remains to report it to the enclave
    const other = privateKeyToAccount(generatePrivateKey());
    const logs: string[] = [];
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), deployment: D, fetch: e.direct, log: (m) => logs.push(m), walletClient: { account: other } as any });
    expect((await q.runOnce()).alreadySettled).toBe(1);
    expect(logs.join("\n")).toMatch(/HTTP 403 \(ack_not_operator\)/);
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(1);
    const q2 = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    expect((await q2.runOnce()).alreadySettled).toBe(1);
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(0);
    expect(w.settlements).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- proof 5: bond capacity, global bound

describe("x402: unpayable calls and the bond's capacity (proof 5, turned around)", () => {
  it("0.2 USDC rotating between 8 new accounts: 150 unpayable calls NO LONGER block the bond; the honest payer is served at once; the unpaid calls stay listed for the operator", async () => {
    const w = world();
    // this test is about the bond: 20 pending calls per payer (3 by default since the evening of 9 Nov), an unbounded
    // rate of paid reads, balances read again at each of the operator's collections
    const e = enclaveOn(w, { maxPendingPerPayer: 20, paymentReadsPerMinute: 1_000_000, reconcileCacheMs: 0 });
    w.capacity = 1_500_000n; // ½ of a 3 USDC bond
    const SEED = 200_000n;
    let served = 0;
    let holder: string | undefined;
    const accounts: string[] = [];
    for (let i = 0; i < 8 && served < 150; i++) {
      const wallet = payerWallet();
      const me = L(wallet.account.address);
      accounts.push(me);
      if (holder) w.balances.set(holder, 0n);
      w.balances.set(me, SEED);
      holder = me;
      const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct });
      for (let k = 0; k < 20 && served < 150; k++) {
        await ai.chat.completions.create({ messages: [{ role: "user", content: `a${i}-${k}` }] });
        served++;
      }
    }
    w.balances.set(holder!, 0n);
    expect(served).toBe(150);
    expect(e.gateway.stats().exposure).toBe((150n * PRICE).toString()); // the bond is full (1.5 USDC)
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    const readsAtFetch = w.reads.payment;
    const rep = await q.runOnce();
    expect(rep.settled).toHaveLength(0);
    expect(rep.waiting).toHaveLength(150);
    // evening of 9 Nov: the operator's collection first reads the balances again (one per pending account, one by one
    // here): the 150 unpaid calls are "not covered", outside the exposure, listed after the others
    expect(w.reads.payment - readsAtFetch).toBe(8);
    expect(e.gateway.stats()).toMatchObject({ pending: 150, uncovered: 150, exposure: "0" });
    // the honest payer: served AT ONCE, with no read other than their payment
    const honest = payerWallet();
    w.balances.set(L(honest.account.address), 5_000_000n);
    const readsBefore = w.reads.payment;
    const ai2 = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: honest, publicClient: fakePub(w), deployment: D, fetch: e.direct });
    const ok = await ai2.chat.completions.create({ messages: [{ role: "user", content: "honest" }] });
    expect(ok.text).toBe("echo: honest");
    expect(w.reads.payment - readsBefore).toBe(1);
    expect(e.gateway.stats()).toMatchObject({ pending: 151, uncovered: 150, exposure: PRICE.toString() });
    // the unpaid calls stay listed: the operator will settle them if their payer funds the account before the deadline
    expect((await (await e.app.request("/x402/pending?limit=500")).json()).total).toBe(151);
    // a second honest payer: served without a new reconciliation (the exposure is right)
    const honest2 = payerWallet();
    w.balances.set(L(honest2.account.address), 5_000_000n);
    const before2 = w.reads.payment;
    await createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: honest2, publicClient: fakePub(w), deployment: D, fetch: e.direct }).chat.completions.create({ messages: [{ role: "user", content: "h2" }] });
    expect(w.reads.payment - before2).toBe(1);
    const rep2 = await q.runOnce();
    expect(rep2.settled).toHaveLength(2); // the two honest ones
    // an emptied account that is funded again before the deadline: its calls, still listed, are settled by the
    // operator and leave the enclave's queue (a signed report)
    w.balances.set(accounts[0]!, SEED);
    const rep3 = await q.runOnce();
    expect(rep3.settled).toHaveLength(20);
    expect(e.gateway.stats()).toMatchObject({ pending: 130, uncovered: 130, exposure: "0" });
  }, 60_000);

  it("the 402 announces 840 s (AUTH_VALIDITY_SECONDS − 60 s of clock) and the enclave refuses any deadline beyond 900 s: an unpaid call lives no longer than a quarter of an hour; 3 pending calls per payer", async () => {
    const w = world();
    const e = enclaveOn(w);
    const res = await e.app.request("/v1/chat/completions", { method: "POST" });
    expect((await res.json()).accepts[0].maxTimeoutSeconds).toBe(840);
    expect(e.gateway.limits).toMatchObject({
      authValiditySeconds: 900, announcedValiditySeconds: 840, minSettleWindowSeconds: 600, maxUnsettledPerWindow: 300, unsettledWindowSeconds: 600,
      maxPendingPerPayer: 3, paymentReadsPerMinute: 120, paymentReadsPerMinutePerIp: 60,
    });
    // the client that signs 900 s (a clock 60 s ahead: 840 announced + 60) passes; 1,000 s: refused (no more "+ 300 s")
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const ok = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, validitySeconds: 900, paidRetryDelaysMs: [] });
    expect((await ok.chat.completions.create({ messages: [{ role: "user", content: "900" }] })).text).toBe("echo: 900");
    const tooLong = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, validitySeconds: 1_000, paidRetryDelaysMs: [] });
    const err = await tooLong.chat.completions.create({ messages: [{ role: "user", content: "1000" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err.code).toBe("authorization_validity_too_long");
    expect(e.calls()).toBe(1);
  });

  it("global bound: beyond MAX_UNSETTLED_PER_WINDOW unsettled calls over the window, 503 for an unknown payer; a payer with a settled call stays served; the window slides", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const w = world();
    const e = enclaveOn(w, { maxUnsettledPerWindow: 5, unsettledWindowSeconds: 600, maxPendingPerPayer: 5 });
    const client = (wallet: any) =>
      createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, paidRetryDelaysMs: [] });
    // a known payer: one call served then settled (the operator's signed report)
    const known = payerWallet();
    w.balances.set(L(known.account.address), 1_000_000n);
    await client(known).chat.completions.create({ messages: [{ role: "user", content: "k1" }] });
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    expect((await q.runOnce()).settled).toHaveLength(1);
    // an account that gets 5 calls served and then empties its balance
    const drained = payerWallet();
    w.balances.set(L(drained.account.address), 5n * PRICE);
    for (let i = 0; i < 5; i++) await client(drained).chat.completions.create({ messages: [{ role: "user", content: `d${i}` }] });
    w.balances.set(L(drained.account.address), 0n);
    // an unknown, funded payer: the window is full of unpaid calls → 503 unsettled_backlog (nothing is served)
    const fresh = payerWallet();
    w.balances.set(L(fresh.account.address), 1_000_000n);
    const err = await client(fresh).chat.completions.create({ messages: [{ role: "user", content: "f1" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err.code).toBe("unsettled_backlog");
    expect(e.calls()).toBe(6);
    // the known payer is not blocked by the others' unpaid calls
    expect((await client(known).chat.completions.create({ messages: [{ role: "user", content: "k2" }] })).text).toBe("echo: k2");
    // the window slides: 10 min later, the unknown payer is served
    vi.setSystemTime(t0 + 601_000);
    expect((await client(fresh).chat.completions.create({ messages: [{ role: "user", content: "f2" }] })).text).toBe("echo: f2");
  });

  it("calls settled on-chain but not reported yet: the per-payer limit (429) frees itself (a reconciliation of that payer alone)", async () => {
    const w = world();
    const e = enclaveOn(w, { maxPendingPerPayer: 2 });
    const wallet = payerWallet();
    const payer = L(wallet.account.address);
    w.balances.set(payer, 1_000_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, paidRetryDelaysMs: [] });
    await ai.chat.completions.create({ messages: [{ role: "user", content: "1" }] });
    await ai.chat.completions.create({ messages: [{ role: "user", content: "2" }] });
    // the operator settles both (or the payer does); no report reaches the enclave
    const p = await (await e.app.request("/x402/pending")).json();
    for (const it of p.items) w.used.add(`${L(it.receipt.payer)}:${L(it.receipt.nonce)}`);
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "3" }] });
    expect(r.text).toBe("echo: 3");
    expect(e.gateway.stats()).toMatchObject({ pending: 1 });
  });
});

describe("x402: a refusal does not multiply RPC reads", () => {
  it("reconciliations draw from a global read budget (reconcileReadsPerMinute): once exhausted, the refusal stands without a read", async () => {
    const w = world();
    const e = enclaveOn(w, { maxPendingPerPayer: 1, payerReconcileCacheMs: 0, reconcileMaxReads: 2, reconcileReadsPerMinute: 1 });
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, paidRetryDelaysMs: [] });
    await ai.chat.completions.create({ messages: [{ role: "user", content: "1" }] }); // one pending call: the limit (1) is reached
    const before = w.reads.payment + w.reads.auth;
    for (let i = 0; i < 8; i++) {
      const err = await ai.chat.completions.create({ messages: [{ role: "user", content: `x${i}` }] }).catch((x) => x);
      expect(err.code).toBe("payer_pending_limit");
    }
    // initial budget = 2 × reconcileMaxReads = 4 reads (one per reconciliation here), then none
    expect(w.reads.payment + w.reads.auth - before).toBe(4);
    expect(e.calls()).toBe(1);
  });
});

// ---------------------------------------------------------------- the production on-chain reader (quorum)

describe("x402: the quorum reader's batched read (pendingState)", () => {
  const USDC = "0x3600000000000000000000000000000000000000" as Address;
  const A = {
    settler: D.x402Settler, registry: D.enclaveRegistry, products: D.productRegistry, bond: D.operatorBond, usdc: USDC,
  };
  function provider(head: bigint, state: { balances: Map<string, bigint>; used: Set<string> }, blocks: string[]) {
    return custom({
      async request({ method, params }: { method: string; params?: any }) {
        if (method === "eth_blockNumber") return toHex(head);
        if (method === "eth_chainId") return toHex(CHAIN);
        if (method === "eth_call") {
          const [call, block] = params as [{ to: string; data: Hex }, string];
          blocks.push(block);
          if (L(call.to) !== L(USDC)) throw new Error("unexpected call");
          const { functionName, args } = decodeFunctionData({ abi: USDC_READ_ABI, data: call.data });
          if (functionName === "balanceOf") {
            return encodeFunctionResult({ abi: USDC_READ_ABI, functionName, result: state.balances.get(L(args[0] as string)) ?? 0n });
          }
          return encodeFunctionResult({ abi: USDC_READ_ABI, functionName, result: state.used.has(`${L(args[0] as string)}:${L(args[1] as string)}`) });
        }
        throw new Error(`method not allowed: ${method}`);
      },
    });
  }

  it("balances and authorizations read on ALL the providers, at the SAME block (the common head); a disagreement makes the read fail", async () => {
    const p1 = privateKeyToAccount(generatePrivateKey()).address;
    const p2 = privateKeyToAccount(generatePrivateKey()).address;
    const n1 = keccak256(toBytes("n1"));
    const n2 = keccak256(toBytes("n2"));
    const state = { balances: new Map([[L(p1), 7n], [L(p2), 0n]]), used: new Set([`${L(p1)}:${L(n2)}`]) };
    const blocks: string[] = [];
    const rpc = new RpcQuorum([provider(120n, state, blocks), provider(118n, state, blocks)]);
    const reader = createQuorumX402Reader(rpc, async () => A);
    const s = await reader.pendingState!({ payers: [p1, p2], auths: [{ payer: p1, nonce: n1 }, { payer: p1, nonce: n2 }] });
    expect(s.block).toBe(118n);
    expect(s.balances).toEqual(new Map([[L(p1), 7n], [L(p2), 0n]]));
    expect(s.used).toEqual(new Map([[`${L(p1)}:${L(n1)}`, false], [`${L(p1)}:${L(n2)}`, true]]));
    expect(blocks).toHaveLength(8); // 2 balances + 2 authorizations, on each of the 2 providers
    expect(new Set(blocks)).toEqual(new Set([toHex(118n)]));
    // a provider that lies about a balance: the read fails (nothing is removed or taken out of the queue on its word)
    const liar = { balances: new Map([[L(p1), 7_000_000n], [L(p2), 0n]]), used: state.used };
    const bad = createQuorumX402Reader(new RpcQuorum([provider(120n, state, []), provider(120n, liar, [])]), async () => A);
    await expect(bad.pendingState!({ payers: [p1], auths: [] })).rejects.toThrow(/disagree/);
  });
});

// ---------------------------------------------------------------- the verifier's proofs of the evening of 9 Nov, turned around

// A 60 s timeout per test (not the default 5 s): on a loaded machine, C2 (41 rounds) took more than 5 s; a test abandoned
// by vitest keeps running in the background, and its vi.setSystemTime moved the frozen clock of the next test (D then
// counted tokens that had come back: 42 reads instead of 29).
describe("x402: proofs A, B, C2, D and F of the evening of 9 Nov, turned around", () => {
  const clientOf =(w: World, e: ReturnType<typeof enclaveOn>, wallet: any, extra: Record<string, unknown> = {}, f?: typeof fetch) =>
    createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: f ?? e.direct, paidRetryDelaysMs: [], ...extra });
  const queueOf = (w: World, e: ReturnType<typeof enclaveOn>) =>
    createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
  async function tryCall(ai: ReturnType<typeof createX402Client>, content: string): Promise<{ ok: boolean; code?: string; text?: string }> {
    try {
      return { ok: true, text: (await ai.chat.completions.create({ messages: [{ role: "user", content }] })).text };
    } catch (x: any) {
      return { ok: false, code: x?.code };
    }
  }
  /** The attacker: a new account receives `seed`, makes `k` calls IN PARALLEL, then empties its balance. */
  async function drainedBatch(w: World, e: ReturnType<typeof enclaveOn>, k: number, seed: bigint, extra: Record<string, unknown> = {}) {
    const wallet = payerWallet();
    const me = L(wallet.account.address);
    w.balances.set(me, seed);
    const ai = clientOf(w, e, wallet, extra);
    const rs = await Promise.all(Array.from({ length: k }, (_, i) => tryCall(ai, `free-${me.slice(2, 8)}-${i}`)));
    w.balances.set(me, 0n);
    return { served: rs.filter((r) => r.ok).length, codes: rs.filter((r) => !r.ok).map((r) => r.code) };
  }
  /** The same client, as the enclave sees it from IP address `ip` (the Node server's TCP peer). */
  const fromIp = (e: ReturnType<typeof enclaveOn>, ip: string) =>
    (async (url: any, init?: any) => {
      const u = new URL(String(url));
      const path = u.pathname.replace(/^\/enclave\/x402/, "") + u.search;
      return e.app.request(path, { method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body }, { incoming: { socket: { remoteAddress: ip } } });
    }) as typeof fetch;

  it("A: at most 3 pending calls per payer (default): 15 emptied new accounts no longer get 300 unpaid calls but 45; a new payer stays served", async () => {
    const w = world();
    const e = enclaveOn(w, { paymentReadsPerMinute: 1_000_000 }); // only the default MAX_PENDING_PER_PAYER plays here
    w.capacity = 100_000_000n;
    let served = 0;
    const codes = new Set<string | undefined>();
    for (let i = 0; i < 15; i++) {
      const b = await drainedBatch(w, e, 20, 200_000n);
      served += b.served;
      b.codes.forEach((c) => codes.add(c));
    }
    expect(served).toBe(45); // before: 300 (20 per account)
    expect([...codes]).toEqual(["payer_pending_limit"]);
    const judge = payerWallet();
    w.balances.set(L(judge.account.address), 5_000_000n);
    expect((await tryCall(clientOf(w, e, judge), "the judge")).ok).toBe(true);
  }, 60_000);

  it("B / F: a CANCELLED authorization never makes a payer \"known\" and stays counted in the bound; an X402Settler settlement reported by the operator does", async () => {
    const w = world();
    const e = enclaveOn(w, { maxUnsettledPerWindow: 4, maxPendingPerPayer: 20, paymentReadsPerMinute: 1_000_000 });
    const q = queueOf(w, e);
    const honest = payerWallet();
    const insider = payerWallet();
    w.balances.set(L(honest.account.address), 1_000_000n);
    w.balances.set(L(insider.account.address), 1_000_000n);
    expect((await tryCall(clientOf(w, e, honest), "h1")).ok).toBe(true);
    expect((await tryCall(clientOf(w, e, insider), "i1")).ok).toBe(true);
    const pend = await (await e.app.request("/x402/pending")).json();
    const mine = pend.items.find((it: any) => L(it.receipt.payer) === L(insider.account.address));
    w.used.add(`${L(mine.receipt.payer)}:${L(mine.receipt.nonce)}`); // USDC.cancelAuthorization: the call is free
    const rep = await q.runOnce();
    expect(rep.settled.map((s) => L(s.payer))).toEqual([L(honest.account.address)]); // settled by OUR transaction
    expect(rep).toMatchObject({ alreadySettled: 1, consumedElsewhere: 1 }); // the cancelled one: "consumed elsewhere"
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(0);
    // 3 more unpaid calls: with the cancelled one, the bound (4) is full
    expect((await drainedBatch(w, e, 3, 3n * PRICE)).served).toBe(3);
    expect(e.gateway.stats().unsettledInWindow).toBe(4); // the cancelled one stays counted: the bound is hard
    // the canceller is not "known": refused; a new payer too; the SETTLED payer passes
    expect((await tryCall(clientOf(w, e, insider), "i2")).code).toBe("unsettled_backlog");
    const fresh = payerWallet();
    w.balances.set(L(fresh.account.address), 1_000_000n);
    expect((await tryCall(clientOf(w, e, fresh), "f1")).code).toBe("unsettled_backlog");
    expect((await tryCall(clientOf(w, e, honest), "h2")).ok).toBe(true);
  }, 60_000);

  it("B: an authorization seen consumed only by the enclave's RECONCILIATION does not make its payer \"known\" (cancelled or settled, the chain does not say)", async () => {
    const w = world();
    const e = enclaveOn(w, { maxPendingPerPayer: 1, maxUnsettledPerWindow: 2, payerReconcileCacheMs: 0, paymentReadsPerMinute: 1_000_000 });
    const insider = payerWallet();
    w.balances.set(L(insider.account.address), 1_000_000n);
    const ai = clientOf(w, e, insider);
    const cancelAll = async () => {
      for (const it of (await (await e.app.request("/x402/pending")).json()).items) w.used.add(`${L(it.receipt.payer)}:${L(it.receipt.nonce)}`);
    };
    expect((await tryCall(ai, "1")).ok).toBe(true);
    await cancelAll();
    expect((await tryCall(ai, "2")).ok).toBe(true); // the per-payer limit freed itself (reconciliation of the payer)
    await cancelAll();
    // two cancelled calls in the window: the bound (2) is full, and the reconciliation made nobody "known"
    expect((await tryCall(ai, "3")).code).toBe("unsettled_backlog");
    expect(e.calls()).toBe(2);
  }, 60_000);

  it("C2: under a continuous flow of unpaid calls with a short deadline (below the bound), an honest payer's call is settled at the registrar's first pass", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const w = world();
    const e = enclaveOn(w);
    w.capacity = 100_000_000n;
    const q = queueOf(w, e);
    const honest = payerWallet();
    w.balances.set(L(honest.account.address), 5_000_000n);
    let honestAt = -1, settledAt = -1, attackerServed = 0;
    for (let s = 0; s <= 400; s += 10) {
      vi.setSystemTime(t0 + s * 1000);
      attackerServed += (await drainedBatch(w, e, 5, 50_000n, { validitySeconds: 605 })).served;
      if (s === 200) {
        expect((await tryCall(clientOf(w, e, honest), "honest")).ok).toBe(true);
        honestAt = s;
      }
      const rep = await q.runOnce();
      if (honestAt >= 0 && settledAt < 0 && rep.settled.some((x) => L(x.payer) === L(honest.account.address))) settledAt = s;
    }
    expect(attackerServed).toBeGreaterThan(100);
    expect(settledAt).toBe(honestAt); // before: 490 s later (proof C2)
    // the unpaid calls are listed AFTER the covered calls
    const p = await (await e.app.request("/x402/pending?limit=500")).json();
    expect(p.items.every((it: any) => it.covered === false)).toBe(true);
  }, 60_000);

  it("D: a flow of calls \"paid\" by a key without USDC no longer multiplies the paymentState reads (global bucket: 503 busy); a known payer stays served", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] }); // a frozen clock: no token comes back during the flow
    vi.setSystemTime(t0);
    const w = world();
    const e = enclaveOn(w); // 120 reads per minute by default, burst of 30
    const q = queueOf(w, e);
    const known = payerWallet();
    w.balances.set(L(known.account.address), 1_000_000n);
    expect((await tryCall(clientOf(w, e, known), "k1")).ok).toBe(true);
    expect((await q.runOnce()).settled).toHaveLength(1); // settled by X402Settler: "known"
    const before = w.reads.payment;
    const broke = clientOf(w, e, payerWallet()); // no transaction, no USDC: only signatures
    const codes: Array<string | undefined> = [];
    for (let i = 0; i < 200; i++) codes.push((await tryCall(broke, `x${i}`)).code);
    expect(w.reads.payment - before).toBe(29); // the burst (30), minus the known payer's read; before: 200
    expect(new Set(codes)).toEqual(new Set(["insufficient_funds", "busy"]));
    expect(e.calls()).toBe(1);
    // the known payer has their own bucket: served during the flow
    expect((await tryCall(clientOf(w, e, known), "k2")).ok).toBe(true);
    // the bucket refills over time (2 reads per second)
    vi.setSystemTime(t0 + 10_000);
    expect((await tryCall(broke, "later")).code).toBe("insufficient_funds");
  }, 60_000);

  it("D: a \"known\" payer who empties their balance loses that status at their first refused request: their flow does not empty the known payers' bucket", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] }); // a frozen clock: no token comes back during the flow
    vi.setSystemTime(t0);
    const w = world();
    const e = enclaveOn(w); // buckets of 30 reads (new payers, known payers)
    const q = queueOf(w, e);
    const [rogue, honest] = [payerWallet(), payerWallet()];
    for (const x of [rogue, honest]) {
      w.balances.set(L(x.account.address), 1_000_000n);
      expect((await tryCall(clientOf(w, e, x), "paid")).ok).toBe(true);
    }
    expect((await q.runOnce()).settled).toHaveLength(2); // settled by X402Settler: both "known"
    w.balances.set(L(rogue.account.address), 0n); // they empty their balance, then flood with signed (free) requests
    const before = w.reads.payment;
    const codes = new Set<string | undefined>();
    for (let i = 0; i < 60; i++) codes.add((await tryCall(clientOf(w, e, rogue), `r${i}`)).code);
    expect(codes).toEqual(new Set(["insufficient_funds", "busy"]));
    expect(w.reads.payment - before).toBe(29); // 1 in the known payers' bucket, then 28 in the new payers' (30 − 2 taken)
    // the honest known payer still draws from THEIR bucket: served
    expect((await tryCall(clientOf(w, e, honest), "still served")).ok).toBe(true);
  }, 60_000);

  it("D: a cap per IP address SEEN by the enclave (TCP peer), for new payers: 429 beyond it; another address, or a known payer, passes", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const w = world();
    const e = enclaveOn(w, { paymentReadsPerMinute: 1_000_000, paymentReadsPerMinutePerIp: 6 }); // rafale de 5 par IP
    const q = queueOf(w, e);
    const known = payerWallet();
    w.balances.set(L(known.account.address), 1_000_000n);
    expect((await tryCall(clientOf(w, e, known, {}, fromIp(e, "203.0.113.7")), "k1")).ok).toBe(true);
    expect((await q.runOnce()).settled).toHaveLength(1);
    const broke = clientOf(w, e, payerWallet(), {}, fromIp(e, "203.0.113.7"));
    const codes: Array<string | undefined> = [];
    for (let i = 0; i < 8; i++) codes.push((await tryCall(broke, `x${i}`)).code);
    expect(codes).toEqual([...Array(4).fill("insufficient_funds"), ...Array(4).fill("rate_limited")]); // 5 tokens, 1 of them taken by the known payer
    expect((await tryCall(clientOf(w, e, payerWallet(), {}, fromIp(e, "::ffff:198.51.100.4")), "other")).code).toBe("insufficient_funds");
    expect((await tryCall(clientOf(w, e, known, {}, fromIp(e, "203.0.113.7")), "k2")).ok).toBe(true);
  }, 60_000);
});
