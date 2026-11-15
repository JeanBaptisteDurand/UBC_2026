/**
 * x402 de bout en bout, sans réseau : le VRAI client du SDK (createX402Client) paie un appel à la VRAIE application de
 * l'enclave (sealed-x402), sur une chaîne émulée où X402Settler.settle et l'USDC (EIP-3009) sont rejoués ligne à ligne ;
 * puis la VRAIE file de règlement du SDK (createX402SettlementQueue, celle du registrar) règle l'appel, une seule fois.
 * Vérifie aussi que le SDK et l'enclave calculent les mêmes octets (nonce, responseHash, CallReceipt), et ce qu'un
 * mandataire malveillant ne peut pas faire.
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

// ---------------------------------------------------------------- la chaîne émulée (l'état que lisent le SDK et l'enclave)

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

/** X402Settler.settle puis USDC.receiveWithAuthorization, rejoués : lève comme le ferait la chaîne. */
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
  // FiatToken : fenêtre, nonce à usage unique, signature canonique du payeur pour CE montant vers X402Settler
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

/** Le client public viem émulé (lectures du SDK, simulation et attente des transactions). */
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
        default: throw new Error(`lecture non émulée : ${a.functionName}`);
      }
    },
    async simulateContract(a: any) {
      if (w.simulateDown) throw new Error("RPC injoignable");
      if (a.functionName !== "settle" || L(a.address) !== L(D.x402Settler)) throw new Error(`simulation non émulée : ${a.functionName}`);
      const copy: World = { ...w, used: new Set(w.used), balances: new Map(w.balances), settlements: [...w.settlements] };
      await emulateSettle(copy, a.args); // lève si la transaction échouerait
      return { request: { ...a } };
    },
    async waitForTransactionReceipt({ hash }: { hash: Hex }) {
      return { status: "success", gasUsed: 210_000n, transactionHash: hash };
    },
  };
}

/** Le portefeuille de l'opérateur : envoie la transaction (appliquée à la chaîne émulée). */
function operatorWallet(w: World): any {
  return {
    account: OPERATOR,
    async writeContract(req: any) {
      await emulateSettle(w, req.args);
      return w.settlements[w.settlements.length - 1]!.tx;
    },
  };
}

/** Le portefeuille du payeur : signe seulement (aucune transaction pour payer). */
function payerWallet(pk: Hex = generatePrivateKey()): any {
  const account = privateKeyToAccount(pk);
  return { account, signTypedData: (args: any) => account.signTypedData(args) };
}

/** L'enclave sealed-x402, lisant la même chaîne émulée. */
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
    { async complete(r) { calls++; return { text: `écho : ${r.messages.at(-1)!.content}`, tokensIn: 3, tokensOut: 4 }; } },
  );
  const app = createSealedX402App({ kit, gateway, attest: { operatorAllowlist: [OPERATOR.address], registeredOperator: async () => null, warn: () => {} }, log: () => {} });
  w.enclaves.set(L(kit.keys.signer), { productId: PRODUCT, operator: OPERATOR.address, x25519: L(kit.keys.x25519PublicKey) as Hex, active: true });
  const seen: Array<{ path: string; paid: boolean }> = [];
  /** fetch vers l'application ; `proxy` peut réécrire la requête ou la réponse (mandataire malveillant). */
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

describe("x402 de bout en bout : SDK ↔ enclave ↔ X402Settler émulé ↔ file de règlement", () => {
  it("le client paie un appel (402 géré seul), l'enclave sert et signe ; l'opérateur règle UNE fois ; le payeur est débité du prix exact", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.fetchVia(), expectedModel: "openai/gpt-oss-120b" });

    const r = await ai.chat.completions.create({ messages: [{ role: "system", content: "Réponds court." }, { role: "user", content: "2 + 2 ?" }], temperature: 0.2 });
    expect(r.text).toBe("écho : 2 + 2 ?");
    expect(r.signer).toBe(e.kit.keys.signer);
    expect(r.settleable).toBe(true);
    expect(r.operator).toBe(OPERATOR.address);
    expect(r.amount).toBe(PRICE);
    expect(r.receipt).toMatchObject({ productId: PRODUCT, payer: wallet.account.address, units: 1n, anchorBlock: w.head, nonce: r.authorization.nonce });
    expect(r.authorization).toMatchObject({ from: wallet.account.address, to: D.x402Settler, value: PRICE, validAfter: 0n });
    expect(r.receipt.responseHash).toBe(x402ResponseHash(r.requestHash, r.text));
    // la danse x402 : une requête sans paiement (402), puis la même avec X-PAYMENT
    expect(e.seen.map((s) => [s.path, s.paid])).toEqual([["/enclave/x402/pubkeys", false], ["/enclave/x402/v1/chat/completions", false], ["/enclave/x402/v1/chat/completions", true]]);
    expect(await ai.isSettled(r)).toBe(false);

    // l'opérateur : deux passages simultanés n'en font qu'un ; l'appel est réglé une seule fois
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.fetchVia() });
    const [rep, rep2] = await Promise.all([q.runOnce(), q.runOnce()]);
    expect(rep2).toBe(rep);
    expect(rep.settled).toHaveLength(1);
    expect(rep.settled[0]).toMatchObject({ payer: wallet.account.address, nonce: r.receipt.nonce, amount: PRICE, gasUsed: 210_000n });
    expect(w.settlements).toHaveLength(1);
    expect(w.balances.get(L(wallet.account.address))).toBe(1_000_000n - PRICE);
    expect(w.balances.get(L(OPERATOR.address))).toBe((PRICE * 9500n) / 10_000n);
    expect(await ai.isSettled(r)).toBe(true);
    // l'enclave a sorti l'appel de sa file (signalé, revérifié on-chain)
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(0);
    // un nouveau passage n'envoie rien ; régler à la main une 2e fois échoue (nonce EIP-3009 à usage unique)
    const rep3 = await q.runOnce();
    expect(rep3.settled).toHaveLength(0);
    expect(w.settlements).toHaveLength(1);
    await expect(emulateSettle(w, [r.receipt, r.signature, { ...r.authorization }])).rejects.toThrow("used or canceled");
    expect(e.calls()).toBe(1);
  });

  it("le SDK et l'enclave calculent les mêmes octets (nonce, responseHash)", async () => {
    const kit = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: D.enclaveRegistry, mockBlockHash: true });
    const s = await seal(toBytes(kit.keys.x25519PublicKey), new TextEncoder().encode("x"));
    const i = { chainId: CHAIN, settler: D.x402Settler, productId: PRODUCT, enclave: kit.keys.signer, enc: toHex(s.enc), ciphertext: toHex(s.ciphertext), clientEphemeralPub: L(kit.keys.x25519PublicKey) as Hex };
    expect(x402CallNonce(i)).toBe(callNonce(i));
    const rh = keccak256(toBytes("requête"));
    expect(x402ResponseHash(rh, "réponse — é")).toBe(callResponseHash(rh, "réponse — é"));
  });

  it("le payeur peut régler lui-même tout de suite ; l'opérateur ne renvoie alors rien et vide la file de l'enclave", async () => {
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

  it("l'enclave redémarre après le relevé : le registrar règle quand même ce qu'il a relevé", async () => {
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
    w.simulateDown = true; // 1er passage : relevé fait, mais la chaîne ne répond pas
    const r1 = await q.runOnce();
    expect(r1.fetched).toBe(1);
    expect(r1.failed).toHaveLength(1);
    expect(q.size).toBe(1);
    enclaveUp = false; // l'enclave redémarre (sa file en mémoire est perdue)
    w.simulateDown = false;
    const r2 = await q.runOnce();
    expect(r2.fetchError).toContain("ECONNREFUSED");
    expect(r2.settled).toHaveLength(1);
    expect(w.settlements).toHaveLength(1);
  });

  it("le prix MONTE entre le 402 et le paiement : prix confirmé ON-CHAIN mais au-delà du plafond de l'appel → rien n'est signé seul (price_increased) ; accepté explicitement, nouvelle autorisation pour la MÊME requête (même nonce)", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    let bumped = false;
    const f = e.fetchVia({
      response: (path, status) => {
        if (status === 402 && !bumped) {
          bumped = true;
          w.product = { ...w.product, price: 20_000n }; // l'auteur change le prix juste après le 402
        }
        return undefined;
      },
    });
    let signed = 0;
    const counting = { ...wallet, signTypedData: (a: any) => { signed++; return wallet.signTypedData(a); } };
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: counting, publicClient: fakePub(w), deployment: D, fetch: f, paidRetryDelaysMs: [5, 5, 5] });
    // 9/11 au soir (preuve E3) : jamais plus cher que le prix lu au début de l'appel sans accord explicite
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err).toMatchObject({ code: "price_increased", newPrice: 20_000n });
    expect(signed).toBe(1);
    expect(e.calls()).toBe(0); // l'enclave a refusé l'ancien prix : rien n'est servi
    // le payeur accepte le nouveau prix
    const r = await ai.resume(err.pending, { renew: true, maxPrice: err.newPrice });
    expect(r.amount).toBe(20_000n);
    expect(r.authorization.value).toBe(20_000n);
    expect(signed).toBe(2); // une autorisation au prix lu, une au prix changé (confirmé on-chain ET accepté)
    // la même requête : l'enclave n'a servi qu'un appel, payable une seule fois (nonce EIP-3009 commun)
    expect(e.seen.filter((x) => x.path.endsWith("/chat/completions") && x.paid).length).toBe(3); // A, A à l'identique, B
    expect(e.calls()).toBe(1);
    // un plafond accepté plus bas que le prix : rien n'est signé (même nonce, aucune autorisation de plus)
    const err2 = await ai.resume(err.pending, { renew: true, maxPrice: 15_000n }).catch((x) => x);
    expect(err2).toMatchObject({ code: "price_increased", newPrice: 20_000n });
    expect(signed).toBe(2);
  });

  it("le prix BAISSE entre le 402 et le paiement : la nouvelle autorisation (moins chère, même nonce) est signée seule", async () => {
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

  it("le prix MONTE entre la lecture du client et le 402 : le client relit la chaîne, ne signe rien (X402ChallengeError « price », newPrice) ; relancer l'appel accepte le nouveau prix", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    let bumped = false;
    const f = e.fetchVia({
      request: (body) => {
        if (!bumped) {
          bumped = true;
          w.product = { ...w.product, price: 30_000n }; // juste avant que l'enclave rédige son 402
        }
        return body;
      },
    });
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: f });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402ChallengeError);
    expect(err).toMatchObject({ reason: "price", newPrice: 30_000n });
    expect(e.seen.some((s) => s.paid)).toBe(false); // rien n'est signé ni envoyé avec paiement
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }); // relancer = accepter
    expect(r.amount).toBe(30_000n);
    expect(e.seen.filter((s) => s.path.endsWith("/chat/completions")).map((s) => s.paid)).toEqual([false, false, true]);
  });
});

describe("x402 de bout en bout : ce qu'un mandataire malveillant ne peut pas faire", () => {
  async function attempt(proxy: Parameters<ReturnType<typeof enclaveOn>["fetchVia"]>[0], o: { maxAmount?: bigint } = {}) {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.fetchVia(proxy), paidRetryDelaysMs: [1, 1, 1], ...o });
    const p = ai.chat.completions.create({ messages: [{ role: "user", content: "secret" }] });
    return { p, e, w, ai, wallet };
  }

  it("détourner le paiement (payTo) ou gonfler le prix dans le 402 : rien n'est signé ni envoyé avec paiement", async () => {
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

  it("remplacer la clé X25519 de l'enclave : refusé avant tout envoi", async () => {
    const other = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: D.enclaveRegistry, mockBlockHash: true });
    const { p, e } = await attempt({ response: (path, _s, body) => (path.startsWith("/pubkeys") ? { ...body, x25519: other.keys.x25519PublicKey } : undefined) });
    await expect(p).rejects.toThrow(ENCLAVE_KEY_MISMATCH_FR);
    expect(e.seen.filter((s) => s.path.endsWith("/chat/completions"))).toHaveLength(0);
  });

  it("remplacer la réponse par un texte chiffré vers la clé éphémère du client : le texte n'est pas rendu ; erreur d'appel PAYÉ (cause X402ReceiptMismatchError), reprise possible", async () => {
    const { p, e, ai, wallet } = await attempt({
      response: async (path, status, body, reqBody) => {
        if (status !== 200 || !path.endsWith("/chat/completions")) return undefined;
        const forged = await seal(toBytes(reqBody.clientEphemeralPub), new TextEncoder().encode("texte forgé par le mandataire"));
        return { ...body, enc: toHex(forged.enc), ciphertext: toHex(forged.ciphertext) };
      },
    });
    const err = await p.catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err.code).toBe("receipt_mismatch");
    expect(err.cause).toBeInstanceOf(X402ReceiptMismatchError);
    expect(err.message).not.toContain("rien n'est dû");
    expect(err.attempts).toBe(4); // l'envoi payé + 3 renvois à l'identique (le mandataire falsifie chaque réponse)
    expect(e.calls()).toBe(1); // l'enclave n'a servi qu'une fois (les renvois sont des reprises)
    // sans le mandataire, la reprise rend la VRAIE réponse (gardée par l'enclave), sans 2e appel au modèle
    const clean = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: ai.pub, deployment: D, fetch: e.fetchVia() });
    const r = await clean.resume(err.pending);
    expect(r.replay).toBe(true);
    expect(r.text).toBe("écho : secret");
    expect(e.calls()).toBe(1);
  });

  it("rejouer le paiement sur une autre requête (corps remplacé en route) : refusé par l'enclave, sans appel au modèle", async () => {
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    let swapped: any;
    const f = e.fetchVia({
      request: (body) => {
        if (!swapped) return body;
        return swapped; // le mandataire remplace la requête payée par la sienne
      },
    });
    // la requête du mandataire, chiffrée vers la vraie enclave
    const s = await seal(toBytes(e.kit.keys.x25519PublicKey), new TextEncoder().encode('{"messages":[{"role":"user","content":"la mienne"}]}'));
    swapped = { enc: toHex(s.enc), ciphertext: toHex(s.ciphertext), clientEphemeralPub: L(e.kit.keys.x25519PublicKey) };
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: f, paidRetryDelaysMs: [1, 1, 1] });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "secret" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError); // après un envoi payé, un 402 n'est pas authentifié : jamais « rien n'est dû »
    expect(err.code).toBe("nonce_not_bound");
    expect(err.message).toMatch(/nonce_not_bound/);
    expect(e.calls()).toBe(0);
  });

  it("plafond par appel du client : au-delà, rien n'est signé", async () => {
    const { p, e } = await attempt({}, { maxAmount: PRICE - 1n });
    await expect(p).rejects.toBeInstanceOf(X402ChallengeError);
    expect(e.seen.filter((s) => s.path.endsWith("/chat/completions"))).toHaveLength(0);
  });
});
