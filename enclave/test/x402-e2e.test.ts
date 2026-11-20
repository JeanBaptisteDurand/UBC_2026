/**
 * x402 end to end, without a network: the SDK's REAL client (createX402Client) pays a call to the enclave's REAL
 * application (sealed-x402), on an emulated chain where X402Settler.settle and USDC (EIP-3009) are replayed line by line;
 * then the SDK's REAL settlement queue (createX402SettlementQueue, the registrar's) settles the call, only once.
 * It also checks that the SDK and the enclave compute the same bytes (nonce, responseHash, CallReceipt), and what a
 * malicious proxy cannot do.
 */
import { describe, it, expect } from "vitest";
import { type Address, type Hex, keccak256, recoverTypedDataAddress, toBytes, toHex, zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { EnclaveKit } from "../src/kit/enclave-kit";
import { seal } from "../src/kit/hpke";
import { callNonce, callResponseHash, eip3009SignatureProblem } from "../src/services/x402";
import { X402Gateway, type X402ChainReader, type X402PaymentState } from "../src/services/x402-gateway";
import { createSealedX402App } from "../products/sealed-x402/app";
import {
  createX402Client,
  createX402SettlementQueue,
  x402CallNonce,
  x402ResponseHash,
  callReceiptTypes,
  receiveWithAuthorizationTypes,
  ENCLAVE_KEY_MISMATCH_FR,
  X402ChallengeError,
  X402PaidCallError,
  X402ReceiptMismatchError,
  testnet,
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

// ---------------------------------------------------------------- the emulated chain (the state the SDK and the enclave read)

interface World {
  head: bigint;
  timestamp: bigint;
  product: { active: boolean; price: bigint; settlement: Address; param: Hex; exposureCap: bigint };
  enclaves: Map<string, { productId: bigint; operator: Address; x25519: Hex; active: boolean }>;
  used: Set<string>;
  balances: Map<string, bigint>;
  settlements: Array<{ nonce: Hex; amount: bigint; operator: Address; tx: Hex }>;
  simulateDown: boolean;
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
    simulateDown: false,
  };
}

const activeOperatorAt = (w: World, signer: Address, pid: bigint): Address => {
  const e = w.enclaves.get(L(signer));
  return e && e.active && e.productId === pid ? e.operator : zeroAddress;
};

/** X402Settler.settle then USDC.receiveWithAuthorization, replayed: throws as the chain would. */
async function emulateSettle(w: World, args: readonly any[]): Promise<void> {
  const [cr, enclaveSig, auth] = args as [any, Hex, any];
  if (!w.product.active) throw new Error("BadProduct");
  if (L(w.product.settlement) !== L(D.x402Settler)) throw new Error("WrongSettlement");
  const amount = BigInt(cr.units) * w.product.price;
  if (amount === 0n) throw new Error("ZeroAmount");
  const signer = await recoverTypedDataAddress({
    domain: { name: "ArcEnclaveNetwork", version: "1", chainId: CHAIN, verifyingContract: D.x402Settler },
    types: callReceiptTypes, primaryType: "CallReceipt", message: cr, signature: enclaveSig,
  });
  const operator = activeOperatorAt(w, signer, BigInt(cr.productId));
  if (operator === zeroAddress) throw new Error("InactiveEnclave");
  // FiatToken: window, single-use nonce, the payer's canonical signature for THIS amount to X402Settler
  if (!(w.timestamp > BigInt(auth.validAfter)) || !(w.timestamp < BigInt(auth.validBefore))) throw new Error("FiatTokenV2: authorization is expired");
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
  const toOp = (amount * 9500n) / 10_000n;
  w.balances.set(L(operator), (w.balances.get(L(operator)) ?? 0n) + toOp);
  w.settlements.push({ nonce: cr.nonce, amount, operator, tx: keccak256(toBytes(`${k}:${w.settlements.length}`)) });
}

/** The emulated viem public client (the SDK's reads, simulation and waiting for transactions). */
function fakePub(w: World): any {
  return {
    async getBlockNumber() { return w.head; },
    async getBlock() { return { number: w.head, timestamp: w.timestamp }; },
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
        case "getProduct": {
          const p = w.product;
          return { author: AUTHOR, manifestHash: `0x${"00".repeat(32)}`, deterministic: false, price: p.price, bpsOperator: 9500, bpsAuthor: 0, bpsNetwork: 500, minBond: 1_000_000n, exposureCap: p.exposureCap, settlement: p.settlement, param: p.param, version: 1n, activatesAt: 0n, state: p.active ? 2 : 3, unitTokens: 1, outWeight: 1 };
        }
        case "isActive": return w.product.active;
        case "authorizationState": return w.used.has(`${L(x[0])}:${L(x[1])}`);
        case "balanceOf": return w.balances.get(L(x[0])) ?? 0n;
        default: throw new Error(`read not emulated: ${a.functionName}`);
      }
    },
    async simulateContract(a: any) {
      if (w.simulateDown) throw new Error("RPC injoignable");
      if (a.functionName !== "settle" || L(a.address) !== L(D.x402Settler)) throw new Error(`simulation not emulated: ${a.functionName}`);
      const copy: World = { ...w, used: new Set(w.used), balances: new Map(w.balances), settlements: [...w.settlements] };
      await emulateSettle(copy, a.args); // throws if the transaction would fail
      return { request: { ...a } };
    },
    async waitForTransactionReceipt({ hash }: { hash: Hex }) {
      return { status: "success", gasUsed: 210_000n, transactionHash: hash };
    },
  };
}

/** The operator's wallet: sends the transaction (applied to the emulated chain). */
function operatorWallet(w: World): any {
  return {
    account: OPERATOR,
    async writeContract(req: any) {
      await emulateSettle(w, req.args);
      return w.settlements[w.settlements.length - 1]!.tx;
    },
  };
}

/** The payer's wallet: signs only (no transaction to pay). */
function payerWallet(pk: Hex = generatePrivateKey()): any {
  const account = privateKeyToAccount(pk);
  return { account, signTypedData: (args: any) => account.signTypedData(args) };
}

/** The sealed-x402 enclave, reading the same emulated chain. */
function enclaveOn(w: World) {
  const kit = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: D.enclaveRegistry, mockBlockHash: true });
  const reader: X402ChainReader = {
    async status(enclave, pid) {
      return { block: w.head, product: { ...w.product }, operator: activeOperatorAt(w, enclave, pid) };
    },
    async paymentState({ enclave, productId, payer, nonce }): Promise<X402PaymentState> {
      return {
        block: w.head, product: { ...w.product }, operator: activeOperatorAt(w, enclave, productId),
        authorizationUsed: w.used.has(`${L(payer)}:${L(nonce)}`), balance: w.balances.get(L(payer)) ?? 0n, payerHasCode: false, capacity: null,
      };
    },
    async authorizationUsed(payer, nonce) { return w.used.has(`${L(payer)}:${L(nonce)}`); },
  };
  let calls = 0;
  const gateway = new X402Gateway(
    kit,
    { chainId: CHAIN, settler: D.x402Settler, usdc: D.usdc, network: "arc-testnet", usdcName: "USDC", usdcVersion: "2", modelHash: MODEL, operators: [OPERATOR.address], statusCacheMs: 0, log: () => {} },
    reader,
    { async complete(r) { calls++; return { text: `echo: ${r.messages.at(-1)!.content}`, tokensIn: 3, tokensOut: 4 }; } },
  );
  const app = createSealedX402App({ kit, gateway, attest: { operatorAllowlist: [OPERATOR.address], registeredOperator: async () => null, warn: () => {} }, log: () => {} });
  w.enclaves.set(L(kit.keys.signer), { productId: PRODUCT, operator: OPERATOR.address, x25519: L(kit.keys.x25519PublicKey) as Hex, active: true });
  const seen: Array<{ path: string; paid: boolean }> = [];
  /** fetch to the application; `proxy` can rewrite the request or the answer (a malicious proxy). */
  const fetchVia = (proxy?: { request?: (body: any) => any; response?: (path: string, status: number, body: any, reqBody: any) => any }): typeof fetch =>
    (async (url: any, init?: any) => {
      const u = new URL(String(url));
      const path = u.pathname.replace(/^\/enclave\/x402/, "") + u.search;
      const headers = new Headers(init?.headers);
      let body = init?.body;
      const reqBody = body ? JSON.parse(body) : undefined;
      if (proxy?.request && reqBody) body = JSON.stringify(proxy.request(reqBody));
      seen.push({ path: u.pathname, paid: headers.has("x-payment") });
      const res = await app.request(path, { method: init?.method ?? "GET", headers, body });
      if (!proxy?.response) return res;
      const j = await res.clone().json().catch(() => undefined);
      const out = j === undefined ? undefined : await proxy.response(path, res.status, j, reqBody);
      return out === undefined ? res : new Response(JSON.stringify(out), { status: res.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  return { kit, app, gateway, fetchVia, seen, calls: () => calls };
}

describe("x402 end to end: SDK ↔ enclave ↔ emulated X402Settler ↔ settlement queue", () => {
  it("the client pays a call (the 402 handled on its own), the enclave serves and signs; the operator settles ONCE; the payer is debited the exact price", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.fetchVia(), expectedModel: "openai/gpt-oss-120b" });

    const r = await ai.chat.completions.create({ messages: [{ role: "system", content: "Answer briefly." }, { role: "user", content: "2 + 2 ?" }], temperature: 0.2 });
    expect(r.text).toBe("echo: 2 + 2 ?");
    expect(r.signer).toBe(e.kit.keys.signer);
    expect(r.settleable).toBe(true);
    expect(r.operator).toBe(OPERATOR.address);
    expect(r.amount).toBe(PRICE);
    expect(r.receipt).toMatchObject({ productId: PRODUCT, payer: wallet.account.address, units: 1n, anchorBlock: w.head, nonce: r.authorization.nonce });
    expect(r.authorization).toMatchObject({ from: wallet.account.address, to: D.x402Settler, value: PRICE, validAfter: 0n });
    expect(r.receipt.responseHash).toBe(x402ResponseHash(r.requestHash, r.text));
    // the x402 dance: a request without payment (402), then the same one with X-PAYMENT
    expect(e.seen.map((s) => [s.path, s.paid])).toEqual([["/enclave/x402/pubkeys", false], ["/enclave/x402/v1/chat/completions", false], ["/enclave/x402/v1/chat/completions", true]]);
    expect(await ai.isSettled(r)).toBe(false);

    // the operator: two simultaneous passes make only one; the call is settled only once
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.fetchVia() });
    const [rep, rep2] = await Promise.all([q.runOnce(), q.runOnce()]);
    expect(rep2).toBe(rep);
    expect(rep.settled).toHaveLength(1);
    expect(rep.settled[0]).toMatchObject({ payer: wallet.account.address, nonce: r.receipt.nonce, amount: PRICE, gasUsed: 210_000n });
    expect(w.settlements).toHaveLength(1);
    expect(w.balances.get(L(wallet.account.address))).toBe(1_000_000n - PRICE);
    expect(w.balances.get(L(OPERATOR.address))).toBe((PRICE * 9500n) / 10_000n);
    expect(await ai.isSettled(r)).toBe(true);
    // the enclave took the call out of its queue (reported, checked again on-chain)
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(0);
    // a new pass sends nothing; settling by hand a second time fails (single-use EIP-3009 nonce)
    const rep3 = await q.runOnce();
    expect(rep3.settled).toHaveLength(0);
    expect(w.settlements).toHaveLength(1);
    await expect(emulateSettle(w, [r.receipt, r.signature, { ...r.authorization }])).rejects.toThrow("used or canceled");
    expect(e.calls()).toBe(1);
  });

  it("the SDK and the enclave compute the same bytes (nonce, responseHash)", async () => {
    const kit = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: D.enclaveRegistry, mockBlockHash: true });
    const s = await seal(toBytes(kit.keys.x25519PublicKey), new TextEncoder().encode("x"));
    const i = { chainId: CHAIN, settler: D.x402Settler, productId: PRODUCT, enclave: kit.keys.signer, enc: toHex(s.enc), ciphertext: toHex(s.ciphertext), clientEphemeralPub: L(kit.keys.x25519PublicKey) as Hex };
    expect(x402CallNonce(i)).toBe(callNonce(i));
    const rh = keccak256(toBytes("request"));
    expect(x402ResponseHash(rh, "answer — é")).toBe(callResponseHash(rh, "answer — é"));
  });

  it("the payer can settle it themselves right away; the operator then sends nothing and empties the enclave's queue", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = { ...payerWallet(), writeContract: async (req: any) => { await emulateSettle(w, req.args); return w.settlements.at(-1)!.tx; } };
    w.balances.set(L(wallet.account.address), 50_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.fetchVia() });
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "vite" }] });
    await ai.settle(r);
    expect(w.settlements).toHaveLength(1);
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.fetchVia() });
    const rep = await q.runOnce();
    expect(rep).toMatchObject({ alreadySettled: 1, settled: [] });
    expect(w.settlements).toHaveLength(1);
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(0);
  });

  it("the enclave restarts after the collection: the registrar still settles what it collected", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 50_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.fetchVia() });
    await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] });
    let enclaveUp = true;
    const flaky = (async (u: any, i: any) => {
      if (!enclaveUp) throw new Error("ECONNREFUSED");
      return e.fetchVia()(u, i);
    }) as typeof fetch;
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: flaky });
    w.simulateDown = true; // first pass: collection done, but the chain does not answer
    const r1 = await q.runOnce();
    expect(r1.fetched).toBe(1);
    expect(r1.failed).toHaveLength(1);
    expect(q.size).toBe(1);
    enclaveUp = false; // the enclave restarts (its in-memory queue is lost)
    w.simulateDown = false;
    const r2 = await q.runOnce();
    expect(r2.fetchError).toContain("ECONNREFUSED");
    expect(r2.settled).toHaveLength(1);
    expect(w.settlements).toHaveLength(1);
  });

  it("the price RISES between the 402 and the payment: price confirmed ON-CHAIN but above the call's cap → nothing is signed on its own (price_increased); accepted explicitly, a new authorization for the SAME request (same nonce)", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    let bumped = false;
    const f = e.fetchVia({
      response: (path, status) => {
        if (status === 402 && !bumped) {
          bumped = true;
          w.product = { ...w.product, price: 20_000n }; // the author changes the price right after the 402
        }
        return undefined;
      },
    });
    let signed = 0;
    const counting = { ...wallet, signTypedData: (a: any) => { signed++; return wallet.signTypedData(a); } };
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: counting, publicClient: fakePub(w), deployment: D, fetch: f, paidRetryDelaysMs: [5, 5, 5] });
    // evening of 9 Nov (proof E3): never more expensive than the price read at the start of the call without explicit consent
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err).toMatchObject({ code: "price_increased", newPrice: 20_000n });
    expect(signed).toBe(1);
    expect(e.calls()).toBe(0); // the enclave refused the old price: nothing is served
    // the payer accepts the new price
    const r = await ai.resume(err.pending, { renew: true, maxPrice: err.newPrice });
    expect(r.amount).toBe(20_000n);
    expect(r.authorization.value).toBe(20_000n);
    expect(signed).toBe(2); // one authorization at the price read, one at the changed price (confirmed on-chain AND accepted)
    // the same request: the enclave served only one call, payable only once (a shared EIP-3009 nonce)
    expect(e.seen.filter((x) => x.path.endsWith("/chat/completions") && x.paid).length).toBe(3); // A, A unchanged, B
    expect(e.calls()).toBe(1);
    // an accepted cap lower than the price: nothing is signed (same nonce, no extra authorization)
    const err2 = await ai.resume(err.pending, { renew: true, maxPrice: 15_000n }).catch((x) => x);
    expect(err2).toMatchObject({ code: "price_increased", newPrice: 20_000n });
    expect(signed).toBe(2);
  });

  it("the price DROPS between the 402 and the payment: the new authorization (cheaper, same nonce) is signed on its own", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    let lowered = false;
    const f = e.fetchVia({
      response: (_path, status) => {
        if (status === 402 && !lowered) {
          lowered = true;
          w.product = { ...w.product, price: 5_000n };
        }
        return undefined;
      },
    });
    let signed = 0;
    const counting = { ...wallet, signTypedData: (a: any) => { signed++; return wallet.signTypedData(a); } };
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: counting, publicClient: fakePub(w), deployment: D, fetch: f, paidRetryDelaysMs: [5, 5, 5] });
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] });
    expect(r.amount).toBe(5_000n);
    expect(signed).toBe(2);
    expect(e.calls()).toBe(1);
  });

  it("the price RISES between the client's read and the 402: the client reads the chain again and signs nothing (X402ChallengeError \"price\", newPrice); running the call again accepts the new price", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    let bumped = false;
    const f = e.fetchVia({
      request: (body) => {
        if (!bumped) {
          bumped = true;
          w.product = { ...w.product, price: 30_000n }; // just before the enclave writes its 402
        }
        return body;
      },
    });
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: f });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402ChallengeError);
    expect(err).toMatchObject({ reason: "price", newPrice: 30_000n });
    expect(e.seen.some((s) => s.paid)).toBe(false); // nothing is signed or sent with a payment
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }); // relancer = accepter
    expect(r.amount).toBe(30_000n);
    expect(e.seen.filter((s) => s.path.endsWith("/chat/completions")).map((s) => s.paid)).toEqual([false, false, true]);
  });
});

describe("x402 end to end: what a malicious proxy cannot do", () => {
  async function attempt(proxy: Parameters<ReturnType<typeof enclaveOn>["fetchVia"]>[0], o: { maxAmount?: bigint } = {}) {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.fetchVia(proxy), paidRetryDelaysMs: [1, 1, 1], ...o });
    const p = ai.chat.completions.create({ messages: [{ role: "user", content: "secret" }] });
    return { p, e, w, ai, wallet };
  }

  it("diverting the payment (payTo) or inflating the price in the 402: nothing is signed or sent with a payment", async () => {
    for (const rewrite of [
      (b: any) => ({ ...b, accepts: b.accepts.map((a: any) => ({ ...a, payTo: "0x000000000000000000000000000000000000bEEF" })) }),
      (b: any) => ({ ...b, accepts: b.accepts.map((a: any) => ({ ...a, maxAmountRequired: "999999" })) }),
      (b: any) => ({ ...b, accepts: b.accepts.map((a: any) => ({ ...a, asset: "0x000000000000000000000000000000000000bEEF" })) }),
    ]) {
      const { p, e } = await attempt({ response: (_path, status, body) => (status === 402 ? rewrite(body) : undefined) });
      await expect(p).rejects.toBeInstanceOf(X402ChallengeError);
      expect(e.seen.some((s) => s.paid)).toBe(false);
      expect(e.calls()).toBe(0);
    }
  });

  it("replacing the enclave's X25519 key: refused before anything is sent", async () => {
    const other = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: D.enclaveRegistry, mockBlockHash: true });
    const { p, e } = await attempt({ response: (path, _s, body) => (path.startsWith("/pubkeys") ? { ...body, x25519: other.keys.x25519PublicKey } : undefined) });
    await expect(p).rejects.toThrow(ENCLAVE_KEY_MISMATCH_FR);
    expect(e.seen.filter((s) => s.path.endsWith("/chat/completions"))).toHaveLength(0);
  });

  it("replacing the answer with a text encrypted to the client's ephemeral key: the text is not returned; a PAID call error (cause X402ReceiptMismatchError), resumption possible", async () => {
    const { p, e, ai, wallet } = await attempt({
      response: async (path, status, body, reqBody) => {
        if (status !== 200 || !path.endsWith("/chat/completions")) return undefined;
        const forged = await seal(toBytes(reqBody.clientEphemeralPub), new TextEncoder().encode("text forged by the proxy"));
        return { ...body, enc: toHex(forged.enc), ciphertext: toHex(forged.ciphertext) };
      },
    });
    const err = await p.catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err.code).toBe("receipt_mismatch");
    expect(err.cause).toBeInstanceOf(X402ReceiptMismatchError);
    expect(err.message).not.toContain("nothing is owed");
    expect(err.attempts).toBe(4); // the paid send + 3 identical resends (the proxy forges each answer)
    expect(e.calls()).toBe(1); // the enclave served only once (the resends are resumptions)
    // without the proxy, the resumption returns the REAL answer (kept by the enclave), without a second call to the model
    const clean = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: ai.pub, deployment: D, fetch: e.fetchVia() });
    const r = await clean.resume(err.pending);
    expect(r.replay).toBe(true);
    expect(r.text).toBe("echo: secret");
    expect(e.calls()).toBe(1);
  });

  it("replaying the payment on another request (body replaced on the way): refused by the enclave, without a call to the model", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    let swapped: any;
    const f = e.fetchVia({
      request: (body) => {
        if (!swapped) return body;
        return swapped; // the proxy replaces the paid request with its own
      },
    });
    // the proxy's request, encrypted to the real enclave
    const s = await seal(toBytes(e.kit.keys.x25519PublicKey), new TextEncoder().encode('{"messages":[{"role":"user","content":"mine"}]}'));
    swapped = { enc: toHex(s.enc), ciphertext: toHex(s.ciphertext), clientEphemeralPub: L(e.kit.keys.x25519PublicKey) };
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: f, paidRetryDelaysMs: [1, 1, 1] });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "secret" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError); // after a paid send, a 402 is not authenticated: never "nothing is owed"
    expect(err.code).toBe("nonce_not_bound");
    expect(err.message).toMatch(/nonce_not_bound/);
    expect(e.calls()).toBe(0);
  });

  it("per-call cap of the client: beyond it, nothing is signed", async () => {
    const { p, e } = await attempt({}, { maxAmount: PRICE - 1n });
    await expect(p).rejects.toBeInstanceOf(X402ChallengeError);
    expect(e.seen.filter((s) => s.path.endsWith("/chat/completions"))).toHaveLength(0);
  });
});
