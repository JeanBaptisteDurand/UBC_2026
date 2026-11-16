/**
 * Les preuves du vérificateur sceptique (9/11) sur le rail x402, RETOURNÉES : chaque faille prouvée devient ici un test
 * de bon comportement. Même harnais que x402-e2e (chaîne émulée, VRAI client SDK, VRAIE application de l'enclave, VRAIE
 * file de règlement du registrar).
 *  1. faux 402 « prix changé » après le service → le client renvoie la requête IDENTIQUE (reprise), une seule autorisation ;
 *  2. 502 d'un mandataire après le service → renvois à l'identique, puis X402PaidCallError (jamais « rien n'est dû »),
 *     qui porte de quoi reprendre (resume) ;
 *  3. (nouveau) vrai changement de prix on-chain → nouvelle autorisation pour le MÊME nonce : au plus un règlement ;
 *  4. POST /x402/settled réservé à l'opérateur (signé, horodaté, non rejouable, borné) et dédoublonné ;
 *  5. des appels impayables ne bloquent plus la caution (rapprochement), borne globale par fenêtre.
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
const FAST = [2, 2, 2] as const; // délais des renvois à l'identique dans ces tests (ms)

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------- la chaîne émulée

interface World {
  head: bigint;
  timestamp: bigint;
  product: { active: boolean; price: bigint; settlement: Address; param: Hex; exposureCap: bigint };
  enclaves: Map<string, { productId: bigint; operator: Address; x25519: Hex; active: boolean }>;
  used: Set<string>;
  balances: Map<string, bigint>;
  settlements: Array<{ nonce: Hex; amount: bigint; operator: Address; tx: Hex }>;
  /** capacité d'exposition de l'opérateur lue on-chain ; null = non lue */
  capacity: bigint | null;
  /** lectures faites par l'enclave : paymentState, authorizationUsed, lectures groupées */
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
        default: throw new Error(`lecture non émulée : ${a.functionName}`);
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
/** Le portefeuille du payeur ; compte les signatures (autorisations EIP-3009). */
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
    { async complete(r) { calls++; return { text: `écho : ${r.messages.at(-1)!.content}`, tokensIn: 3, tokensOut: 4 }; } },
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
  new Response(JSON.stringify({ x402Version: 1, error: X402_PRICE_CHANGED, detail: "prix changé", accepts: [] }), { status: 402, headers: { "content-type": "application/json" } });

/** Un signalement « appels réglés » signé (par l'opérateur par défaut), horodaté maintenant ; chaque item « réglé par
 *  X402Settler » (settled: true) sauf s'il dit le contraire. */
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

// ---------------------------------------------------------------- preuves 1, 2 (et 3) : le client face à un mandataire

describe("x402 — un mandataire après l'envoi payé (preuves 1 et 2, retournées)", () => {
  it("preuve 1 : faux 402 « prix changé » après le service → le client renvoie la requête IDENTIQUE et reçoit la réponse gardée ; UNE autorisation, UN appel, UN règlement", async () => {
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
        return fake402(); // le mandataire GARDE la vraie réponse et renvoie un faux 402
      }
      return res;
    }) as typeof fetch;
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: relay, paidRetryDelaysMs: FAST });
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "une seule question" }] });
    expect(r.text).toBe("écho : une seule question");
    expect(r.replay).toBe(true); // la réponse gardée par l'enclave
    expect(wallet.signed()).toBe(1); // jamais de 2e autorisation sur la foi d'un 402 non authentifié
    expect(e.calls()).toBe(1);
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(1);
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    const rep = await q.runOnce();
    expect(rep.settled).toHaveLength(1);
    expect(w.balances.get(payer)).toBe(1_000_000n - PRICE); // débité UNE fois
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(0); // signalement signé accepté
  });

  it("402 « prix changé » répété mais prix on-chain INCHANGÉ → jamais de 2e autorisation ; X402PaidCallError après les renvois", async () => {
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

  it("preuve 2 : 502 après le service → renvois à l'identique, puis X402PaidCallError SANS « rien n'est dû », avec enveloppe, clé éphémère et autorisation ; la reprise (même sérialisée) rend la réponse, réglée UNE fois", async () => {
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
    expect(err).not.toBeInstanceOf(X402CallError); // X402CallError = avant tout paiement, rien n'est dû
    expect(String(err.message)).not.toContain("rien n'est dû");
    expect(String(err.message)).toMatch(/PEUT le régler/);
    expect(err).toMatchObject({ status: 502, code: "http_502", attempts: 1 + FAST.length, paid: true });
    const p = err.pending;
    expect(p.envelope).toMatchObject({ enc: expect.stringMatching(/^0x[0-9a-f]{64}$/), clientEphemeralPub: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(p.ephemeralPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.authorization).toMatchObject({ from: wallet.account.address, to: D.x402Settler, value: PRICE, nonce: p.nonce });
    expect(p.authorizations).toHaveLength(1);
    expect(Object.keys(err)).not.toContain("pending"); // la clé éphémère ne part pas dans un console.log(err)
    expect(e.calls()).toBe(1); // les renvois sont des reprises : un seul appel au modèle
    // reprise plus tard, par un chemin sain (ex. l'URL Phala directe), après sérialisation
    const saved = serializeX402PaidRequest(p);
    const ai2 = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct });
    const r = await ai2.resume(parseX402PaidRequest(saved));
    expect(r.replay).toBe(true);
    expect(r.text).toBe("écho : q");
    expect(e.calls()).toBe(1);
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    expect((await q.runOnce()).settled).toHaveLength(1);
    expect(w.balances.get(payer)).toBe(1_000_000n - PRICE);
  });

  it("faux 402 ET vrai changement de prix on-chain (à la hausse) → rien de plus cher n'est signé seul (price_increased, newPrice) ; accepté explicitement : nouvelle autorisation pour la MÊME requête (même nonce) ; l'enclave dit 409 (servie sous la 1re) ; le client renvoie la 1re ; au plus UN règlement", async () => {
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
        if (faked === 1) w.product = { ...w.product, price: 2n * PRICE }; // l'auteur change le prix au même moment
        return fake402();
      }
      return res;
    }) as typeof fetch;
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: relay, paidRetryDelaysMs: FAST });
    // 9/11 au soir (preuve E3) : le prix monté au-delà du plafond de l'appel (le prix lu à son début) n'est PAS signé seul
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "prix" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err.code).toBe("price_increased");
    expect(err.newPrice).toBe(2n * PRICE);
    expect(err.message).toContain("maxPrice: err.newPrice");
    expect(wallet.signed()).toBe(1);
    expect(err.pending.authorizations).toHaveLength(1);
    expect(statuses).toEqual([200, 200]); // servi, reprise (réponses cachées par le mandataire)
    // le payeur ACCEPTE le nouveau prix : une 2e autorisation, même nonce ; l'enclave l'a servie sous la 1re (409) et la rend
    const r = await ai.resume(err.pending, { renew: true, maxPrice: err.newPrice });
    expect(r.text).toBe("écho : prix");
    expect(r.replay).toBe(true);
    expect(r.authorization.value).toBe(PRICE); // la réponse servie sous la 1re autorisation
    expect(wallet.signed()).toBe(2); // la 2e : prix CONFIRMÉ on-chain ET accepté, même nonce
    expect(statuses).toEqual([200, 200, 409, 200]); // servi, reprise, 409 (2e autorisation refusée : déjà servie), reprise
    expect(e.calls()).toBe(1);
    // au plus UN règlement : au nouveau prix, la 1re autorisation ne se règle pas ; revenu au prix d'origine, elle se règle
    // une fois, et la 2e (même nonce EIP-3009) est alors inutilisable
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    expect((await q.runOnce()).settled).toHaveLength(0);
    w.product = { ...w.product, price: PRICE };
    expect((await q.runOnce()).settled).toHaveLength(1);
    expect(w.balances.get(payer)).toBe(1_000_000n - PRICE);
  });
});

describe("x402 — reprise d'un appel payé (resume)", () => {
  it("l'envoi payé n'atteint jamais l'enclave (coupure) : X402PaidCallError ; 7 min plus tard l'autorisation n'a plus la fenêtre de règlement ; resume({ renew }) en signe une fraîche pour le MÊME nonce, servie et réglée UNE fois", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const w = world();
    const e = enclaveOn(w);
    const wallet = payerWallet();
    const payer = L(wallet.account.address);
    w.balances.set(payer, 1_000_000n);
    const cut = (async (url: any, init?: any) => {
      if (isPaid(init)) throw new TypeError("fetch failed"); // la connexion tombe avant l'enclave
      return e.direct(url, init);
    }) as typeof fetch;
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: cut, paidRetryDelaysMs: FAST });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "r" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err).toMatchObject({ status: 0, code: "network_error", attempts: 1 + FAST.length });
    expect(e.calls()).toBe(0);
    vi.setSystemTime(t0 + 420_000); // 7 min : l'autorisation (900 s) n'a plus les 600 s qu'exige le règlement
    const ai2 = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, paidRetryDelaysMs: FAST });
    const stale = await ai2.resume(err.pending).catch((x) => x);
    expect(stale).toBeInstanceOf(X402PaidCallError);
    expect(stale.code).toBe("invalid_exact_evm_payload_authorization_valid_before");
    expect(wallet.signed()).toBe(1); // jamais de nouvelle autorisation sans qu'on la demande (ni prix changé on-chain)
    const r = await ai2.resume(err.pending, { renew: true });
    expect(r.text).toBe("écho : r");
    expect(r.replay).toBe(false);
    expect(r.authorization.nonce).toBe(err.pending.nonce);
    expect(r.authorization.signature).not.toBe(err.pending.authorization.signature);
    expect(wallet.signed()).toBe(2);
    expect(err.pending.authorizations).toHaveLength(1); // l'objet d'origine n'est pas modifié
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    expect((await q.runOnce()).settled).toHaveLength(1);
    expect(w.balances.get(payer)).toBe(1_000_000n - PRICE);
    // reprendre avec un autre compte, ou pour un autre produit : refusé avant tout envoi
    const intruder = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: payerWallet(), publicClient: fakePub(w), deployment: D, fetch: e.direct });
    await expect(intruder.resume(err.pending)).rejects.toThrow("pas par ce client");
  });
});

// ---------------------------------------------------------------- preuve 4 : POST /x402/settled

describe("x402 — POST /x402/settled réservé à l'opérateur (preuve 4, retournée)", () => {
  async function served(w: World, e: ReturnType<typeof enclaveOn>) {
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct });
    await ai.chat.completions.create({ messages: [{ role: "user", content: "x" }] });
    const p = await (await e.app.request("/x402/pending")).json();
    return { payer: p.items[0].receipt.payer as Address, nonce: p.items[0].receipt.nonce as Hex };
  }

  it("non signé : 401 ; signé par un tiers : 403 ; aucune lecture on-chain dans les deux cas", async () => {
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

  it("signé par l'opérateur : 200 copies d'une clé = UNE lecture ; rejoué : 409 ; périmé, daté du futur, autre enclave : 401 ; corps trop long : 413", async () => {
    const w = world();
    const e = enclaveOn(w);
    const it0 = await served(w, e);
    const before = w.reads.auth;
    const a = await signedAck(e, Array(200).fill(it0));
    const r = await a.send();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ settled: [], pending: [`${L(it0.payer)}:${L(it0.nonce)}`], unknown: [] });
    expect(w.reads.auth - before).toBe(1); // dédoublonné : une lecture pour la clé
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
    // l'appel réglé on-chain : signalé, il sort de la file
    w.used.add(`${L(it0.payer)}:${L(it0.nonce)}`);
    expect((await (await (await signedAck(e, [it0, it0])).send()).json()).settled).toEqual([`${L(it0.payer)}:${L(it0.nonce)}`]);
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(0);
    expect(w.reads.auth - before).toBe(2); // une lecture de plus : celle du signalement qui l'a sorti
    // corps de plus de 64 Kio : 413 sur l'en-tête Content-Length ; sans lui (flux), la lecture s'arrête à 64 Kio : refusé
    const huge = JSON.stringify({ items: Array(800).fill(it0), pad: "x".repeat(70_000) });
    const big = await e.app.request("/x402/settled", { method: "POST", headers: { "content-type": "application/json", "content-length": String(huge.length) }, body: huge });
    expect(big.status).toBe(413);
    const chunked = await e.app.request("/x402/settled", { method: "POST", headers: { "content-type": "application/json" }, body: huge });
    expect(chunked.status).toBe(400);
    expect(w.reads.auth - before).toBe(2); // aucune lecture pour les corps trop longs
  });

  it("débit borné : au-delà des signalements permis par minute, 429 (sans lecture) ; lecture groupée au même bloc quand le lecteur sait le faire", async () => {
    const w = world();
    const e = enclaveOn(w, { ackRequestsPerMinute: 5 }, { batched: true });
    const it0 = await served(w, e);
    const batchBefore = w.reads.batch; // (le relevé GET /x402/pending relit les soldes : une lecture groupée)
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await (await signedAck(e, [it0, it0, it0])).send()).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(w.reads.batch - batchBefore).toBe(5); // une lecture groupée par signalement accepté, aucune pour les refusés
    expect(w.reads.auth).toBe(0);
  });

  it("la file du registrar signe ses signalements : signés d'une clé hors OPERATOR_ALLOWLIST, refusés (403, journalisé) et la file de l'enclave reste ; signés par l'opérateur, acceptés", async () => {
    const w = world();
    const e = enclaveOn(w, { operators: [OPERATOR.address] });
    const pw = payerWallet();
    w.balances.set(L(pw.account.address), 1_000_000n);
    const wallet = { ...pw, writeContract: async (req: any) => { await emulateSettle(w, req.args); return w.settlements.at(-1)!.tx; } };
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct });
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "x" }] });
    await ai.settle(r); // le payeur règle lui-même : l'appel est consommé on-chain, il reste à le signaler à l'enclave
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

// ---------------------------------------------------------------- preuve 5 : capacité de caution, borne globale

describe("x402 — appels impayables et capacité de la caution (preuve 5, retournée)", () => {
  it("0,2 USDC qui tourne entre 8 comptes neufs : 150 appels impayables NE bloquent PLUS la caution ; le payeur honnête est servi tout de suite ; les impayés restent listés pour l'opérateur", async () => {
    const w = world();
    // ce test porte sur la caution : 20 appels en attente par payeur (3 par défaut depuis le 9/11 au soir), débit des
    // lectures payées non borné, soldes relus à chaque relevé de l'opérateur
    const e = enclaveOn(w, { maxPendingPerPayer: 20, paymentReadsPerMinute: 1_000_000, reconcileCacheMs: 0 });
    w.capacity = 1_500_000n; // ½ caution de 3 USDC
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
    expect(e.gateway.stats().exposure).toBe((150n * PRICE).toString()); // la caution est pleine (1,5 USDC)
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    const readsAtFetch = w.reads.payment;
    const rep = await q.runOnce();
    expect(rep.settled).toHaveLength(0);
    expect(rep.waiting).toHaveLength(150);
    // 9/11 au soir : le relevé de l'opérateur relit d'abord les soldes (un par compte en attente, lecture une à une ici) :
    // les 150 impayés sont « non couverts », hors exposition, listés après les autres
    expect(w.reads.payment - readsAtFetch).toBe(8);
    expect(e.gateway.stats()).toMatchObject({ pending: 150, uncovered: 150, exposure: "0" });
    // le payeur honnête : servi TOUT DE SUITE, sans autre lecture que son paiement
    const honest = payerWallet();
    w.balances.set(L(honest.account.address), 5_000_000n);
    const readsBefore = w.reads.payment;
    const ai2 = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: honest, publicClient: fakePub(w), deployment: D, fetch: e.direct });
    const ok = await ai2.chat.completions.create({ messages: [{ role: "user", content: "honnête" }] });
    expect(ok.text).toBe("écho : honnête");
    expect(w.reads.payment - readsBefore).toBe(1);
    expect(e.gateway.stats()).toMatchObject({ pending: 151, uncovered: 150, exposure: PRICE.toString() });
    // les impayés restent listés : l'opérateur les réglera si leur payeur se renfloue avant l'échéance
    expect((await (await e.app.request("/x402/pending?limit=500")).json()).total).toBe(151);
    // un 2e payeur honnête : servi sans nouveau rapprochement (l'exposition est juste)
    const honest2 = payerWallet();
    w.balances.set(L(honest2.account.address), 5_000_000n);
    const before2 = w.reads.payment;
    await createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: honest2, publicClient: fakePub(w), deployment: D, fetch: e.direct }).chat.completions.create({ messages: [{ role: "user", content: "h2" }] });
    expect(w.reads.payment - before2).toBe(1);
    const rep2 = await q.runOnce();
    expect(rep2.settled).toHaveLength(2); // les deux honnêtes
    // un compte vidé qui se renfloue avant l'échéance : ses appels, restés listés, sont réglés par l'opérateur et sortent
    // de la file de l'enclave (signalement signé)
    w.balances.set(accounts[0]!, SEED);
    const rep3 = await q.runOnce();
    expect(rep3.settled).toHaveLength(20);
    expect(e.gateway.stats()).toMatchObject({ pending: 130, uncovered: 130, exposure: "0" });
  }, 60_000);

  it("le 402 annonce 840 s (AUTH_VALIDITY_SECONDS − 60 s d'horloge) et l'enclave refuse toute échéance au-delà de 900 s : un impayé ne vit pas plus d'un quart d'heure ; 3 appels en attente par payeur", async () => {
    const w = world();
    const e = enclaveOn(w);
    const res = await e.app.request("/v1/chat/completions", { method: "POST" });
    expect((await res.json()).accepts[0].maxTimeoutSeconds).toBe(840);
    expect(e.gateway.limits).toMatchObject({
      authValiditySeconds: 900, announcedValiditySeconds: 840, minSettleWindowSeconds: 600, maxUnsettledPerWindow: 300, unsettledWindowSeconds: 600,
      maxPendingPerPayer: 3, paymentReadsPerMinute: 120, paymentReadsPerMinutePerIp: 60,
    });
    // le client qui signe 900 s (horloge en avance de 60 s : 840 annoncées + 60) passe ; 1 000 s : refusé (plus de « + 300 s »)
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const ok = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, validitySeconds: 900, paidRetryDelaysMs: [] });
    expect((await ok.chat.completions.create({ messages: [{ role: "user", content: "900" }] })).text).toBe("écho : 900");
    const tooLong = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, validitySeconds: 1_000, paidRetryDelaysMs: [] });
    const err = await tooLong.chat.completions.create({ messages: [{ role: "user", content: "1000" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err.code).toBe("authorization_validity_too_long");
    expect(e.calls()).toBe(1);
  });

  it("borne globale : au-delà de MAX_UNSETTLED_PER_WINDOW appels non réglés sur la fenêtre, 503 pour un payeur inconnu ; un payeur dont un appel est réglé reste servi ; la fenêtre glisse", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const w = world();
    const e = enclaveOn(w, { maxUnsettledPerWindow: 5, unsettledWindowSeconds: 600, maxPendingPerPayer: 5 });
    const client = (wallet: any) =>
      createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, paidRetryDelaysMs: [] });
    // un payeur connu : un appel servi puis réglé (signalement signé de l'opérateur)
    const known = payerWallet();
    w.balances.set(L(known.account.address), 1_000_000n);
    await client(known).chat.completions.create({ messages: [{ role: "user", content: "k1" }] });
    const q = createX402SettlementQueue({ enclaveUrl: URL0, publicClient: fakePub(w), walletClient: operatorWallet(w), deployment: D, fetch: e.direct });
    expect((await q.runOnce()).settled).toHaveLength(1);
    // un compte qui se fait servir 5 appels puis vide son solde
    const drained = payerWallet();
    w.balances.set(L(drained.account.address), 5n * PRICE);
    for (let i = 0; i < 5; i++) await client(drained).chat.completions.create({ messages: [{ role: "user", content: `d${i}` }] });
    w.balances.set(L(drained.account.address), 0n);
    // un payeur inconnu, approvisionné : la fenêtre est pleine d'impayés → 503 unsettled_backlog (rien n'est servi)
    const fresh = payerWallet();
    w.balances.set(L(fresh.account.address), 1_000_000n);
    const err = await client(fresh).chat.completions.create({ messages: [{ role: "user", content: "f1" }] }).catch((x) => x);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err.code).toBe("unsettled_backlog");
    expect(e.calls()).toBe(6);
    // le payeur connu n'est pas bloqué par les impayés des autres
    expect((await client(known).chat.completions.create({ messages: [{ role: "user", content: "k2" }] })).text).toBe("écho : k2");
    // la fenêtre glisse : 10 min plus tard, le payeur inconnu est servi
    vi.setSystemTime(t0 + 601_000);
    expect((await client(fresh).chat.completions.create({ messages: [{ role: "user", content: "f2" }] })).text).toBe("écho : f2");
  });

  it("appels réglés on-chain mais pas encore signalés : la limite par payeur (429) se libère d'elle-même (rapprochement du seul payeur)", async () => {
    const w = world();
    const e = enclaveOn(w, { maxPendingPerPayer: 2 });
    const wallet = payerWallet();
    const payer = L(wallet.account.address);
    w.balances.set(payer, 1_000_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, paidRetryDelaysMs: [] });
    await ai.chat.completions.create({ messages: [{ role: "user", content: "1" }] });
    await ai.chat.completions.create({ messages: [{ role: "user", content: "2" }] });
    // l'opérateur règle les deux (ou le payeur lui-même) ; aucun signalement n'arrive à l'enclave
    const p = await (await e.app.request("/x402/pending")).json();
    for (const it of p.items) w.used.add(`${L(it.receipt.payer)}:${L(it.receipt.nonce)}`);
    const r = await ai.chat.completions.create({ messages: [{ role: "user", content: "3" }] });
    expect(r.text).toBe("écho : 3");
    expect(e.gateway.stats()).toMatchObject({ pending: 1 });
  });
});

describe("x402 — un refus ne multiplie pas les lectures RPC", () => {
  it("les rapprochements puisent dans un budget global de lectures (reconcileReadsPerMinute) : épuisé, le refus tient sans lecture", async () => {
    const w = world();
    const e = enclaveOn(w, { maxPendingPerPayer: 1, payerReconcileCacheMs: 0, reconcileMaxReads: 2, reconcileReadsPerMinute: 1 });
    const wallet = payerWallet();
    w.balances.set(L(wallet.account.address), 1_000_000n);
    const ai = createX402Client({ enclaveUrl: URL0, productId: PRODUCT, walletClient: wallet, publicClient: fakePub(w), deployment: D, fetch: e.direct, paidRetryDelaysMs: [] });
    await ai.chat.completions.create({ messages: [{ role: "user", content: "1" }] }); // un appel en attente : la limite (1) est atteinte
    const before = w.reads.payment + w.reads.auth;
    for (let i = 0; i < 8; i++) {
      const err = await ai.chat.completions.create({ messages: [{ role: "user", content: `x${i}` }] }).catch((x) => x);
      expect(err.code).toBe("payer_pending_limit");
    }
    // budget initial = 2 × reconcileMaxReads = 4 lectures (une par rapprochement ici), puis plus aucune
    expect(w.reads.payment + w.reads.auth - before).toBe(4);
    expect(e.calls()).toBe(1);
  });
});

// ---------------------------------------------------------------- le lecteur on-chain de production (quorum)

describe("x402 — lecture groupée du lecteur à quorum (pendingState)", () => {
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
          if (L(call.to) !== L(USDC)) throw new Error("appel inattendu");
          const { functionName, args } = decodeFunctionData({ abi: USDC_READ_ABI, data: call.data });
          if (functionName === "balanceOf") {
            return encodeFunctionResult({ abi: USDC_READ_ABI, functionName, result: state.balances.get(L(args[0] as string)) ?? 0n });
          }
          return encodeFunctionResult({ abi: USDC_READ_ABI, functionName, result: state.used.has(`${L(args[0] as string)}:${L(args[1] as string)}`) });
        }
        throw new Error(`méthode non permise : ${method}`);
      },
    });
  }

  it("soldes et autorisations lus chez TOUS les fournisseurs, au MÊME bloc (la tête commune) ; un désaccord fait échouer la lecture", async () => {
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
    expect(blocks).toHaveLength(8); // 2 soldes + 2 autorisations, chez chacun des 2 fournisseurs
    expect(new Set(blocks)).toEqual(new Set([toHex(118n)]));
    // un fournisseur qui ment sur un solde : la lecture échoue (rien n'est retiré ni sorti de la file sur sa foi)
    const liar = { balances: new Map([[L(p1), 7_000_000n], [L(p2), 0n]]), used: state.used };
    const bad = createQuorumX402Reader(new RpcQuorum([provider(120n, state, []), provider(120n, liar, [])]), async () => A);
    await expect(bad.pendingState!({ payers: [p1], auths: [] })).rejects.toThrow(/désaccord/);
  });
});

// ---------------------------------------------------------------- preuves du vérificateur du 9/11 au soir, retournées

// Délai de 60 s par test (et non les 5 s par défaut) : sur une machine chargée, C2 (41 tours) dépassait 5 s ; un test
// abandonné par vitest continue en arrière-plan et ses vi.setSystemTime déplaçaient l'horloge figée du test suivant (D
// comptait alors des jetons revenus : 42 lectures au lieu de 29).
describe("x402 — preuves A, B, C2, D et F du 9/11 au soir, retournées", () => {
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
  /** L'attaquant : un compte neuf reçoit `seed`, fait `k` appels EN PARALLÈLE, puis vide son solde. */
  async function drainedBatch(w: World, e: ReturnType<typeof enclaveOn>, k: number, seed: bigint, extra: Record<string, unknown> = {}) {
    const wallet = payerWallet();
    const me = L(wallet.account.address);
    w.balances.set(me, seed);
    const ai = clientOf(w, e, wallet, extra);
    const rs = await Promise.all(Array.from({ length: k }, (_, i) => tryCall(ai, `free-${me.slice(2, 8)}-${i}`)));
    w.balances.set(me, 0n);
    return { served: rs.filter((r) => r.ok).length, codes: rs.filter((r) => !r.ok).map((r) => r.code) };
  }
  /** Le même client, vu par l'enclave depuis l'adresse IP `ip` (pair TCP du serveur Node). */
  const fromIp = (e: ReturnType<typeof enclaveOn>, ip: string) =>
    (async (url: any, init?: any) => {
      const u = new URL(String(url));
      const path = u.pathname.replace(/^\/enclave\/x402/, "") + u.search;
      return e.app.request(path, { method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body }, { incoming: { socket: { remoteAddress: ip } } });
    }) as typeof fetch;

  it("A : 3 appels en attente au plus par payeur (défaut) : 15 comptes neufs vidés n'obtiennent plus 300 impayés mais 45 ; un nouveau payeur reste servi", async () => {
    const w = world();
    const e = enclaveOn(w, { paymentReadsPerMinute: 1_000_000 }); // seul le défaut MAX_PENDING_PER_PAYER joue ici
    w.capacity = 100_000_000n;
    let served = 0;
    const codes = new Set<string | undefined>();
    for (let i = 0; i < 15; i++) {
      const b = await drainedBatch(w, e, 20, 200_000n);
      served += b.served;
      b.codes.forEach((c) => codes.add(c));
    }
    expect(served).toBe(45); // avant : 300 (20 par compte)
    expect([...codes]).toEqual(["payer_pending_limit"]);
    const judge = payerWallet();
    w.balances.set(L(judge.account.address), 5_000_000n);
    expect((await tryCall(clientOf(w, e, judge), "le juge")).ok).toBe(true);
  }, 60_000);

  it("B / F : une autorisation ANNULÉE ne rend jamais un payeur « connu » et reste comptée dans la borne ; un règlement X402Settler signalé par l'opérateur, si", async () => {
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
    w.used.add(`${L(mine.receipt.payer)}:${L(mine.receipt.nonce)}`); // USDC.cancelAuthorization : l'appel est gratuit
    const rep = await q.runOnce();
    expect(rep.settled.map((s) => L(s.payer))).toEqual([L(honest.account.address)]); // réglé par NOTRE transaction
    expect(rep).toMatchObject({ alreadySettled: 1, consumedElsewhere: 1 }); // l'annulé : « consommé autrement »
    expect((await (await e.app.request("/x402/pending")).json()).total).toBe(0);
    // 3 impayés de plus : avec l'annulé, la borne (4) est pleine
    expect((await drainedBatch(w, e, 3, 3n * PRICE)).served).toBe(3);
    expect(e.gateway.stats().unsettledInWindow).toBe(4); // l'annulé reste compté : la borne est dure
    // l'annuleur n'est pas « connu » : refusé ; un nouveau payeur aussi ; le payeur RÉGLÉ passe
    expect((await tryCall(clientOf(w, e, insider), "i2")).code).toBe("unsettled_backlog");
    const fresh = payerWallet();
    w.balances.set(L(fresh.account.address), 1_000_000n);
    expect((await tryCall(clientOf(w, e, fresh), "f1")).code).toBe("unsettled_backlog");
    expect((await tryCall(clientOf(w, e, honest), "h2")).ok).toBe(true);
  }, 60_000);

  it("B : une autorisation vue consommée par le seul RAPPROCHEMENT de l'enclave ne rend pas son payeur « connu » (annulée ou réglée, la chaîne ne le dit pas)", async () => {
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
    expect((await tryCall(ai, "2")).ok).toBe(true); // la limite par payeur s'est libérée (rapprochement du payeur)
    await cancelAll();
    // deux appels annulés dans la fenêtre : la borne (2) est pleine, et le rapprochement n'a rendu personne « connu »
    expect((await tryCall(ai, "3")).code).toBe("unsettled_backlog");
    expect(e.calls()).toBe(2);
  }, 60_000);

  it("C2 : sous un flot continu d'impayés à échéance courte (sous la borne), l'appel d'un payeur honnête est réglé au premier passage du registrar", async () => {
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
        expect((await tryCall(clientOf(w, e, honest), "honnête")).ok).toBe(true);
        honestAt = s;
      }
      const rep = await q.runOnce();
      if (honestAt >= 0 && settledAt < 0 && rep.settled.some((x) => L(x.payer) === L(honest.account.address))) settledAt = s;
    }
    expect(attackerServed).toBeGreaterThan(100);
    expect(settledAt).toBe(honestAt); // avant : 490 s plus tard (preuve C2)
    // les impayés sont listés APRÈS les appels couverts
    const p = await (await e.app.request("/x402/pending?limit=500")).json();
    expect(p.items.every((it: any) => it.covered === false)).toBe(true);
  }, 60_000);

  it("D : un flot d'appels « payés » par une clé sans USDC ne multiplie plus les lectures paymentState (seau global : 503 busy) ; un payeur connu reste servi", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] }); // horloge figée : aucun jeton ne revient pendant le flot
    vi.setSystemTime(t0);
    const w = world();
    const e = enclaveOn(w); // 120 lectures par minute par défaut, rafale de 30
    const q = queueOf(w, e);
    const known = payerWallet();
    w.balances.set(L(known.account.address), 1_000_000n);
    expect((await tryCall(clientOf(w, e, known), "k1")).ok).toBe(true);
    expect((await q.runOnce()).settled).toHaveLength(1); // réglé par X402Settler : « connu »
    const before = w.reads.payment;
    const broke = clientOf(w, e, payerWallet()); // aucune transaction, aucun USDC : seulement des signatures
    const codes: Array<string | undefined> = [];
    for (let i = 0; i < 200; i++) codes.push((await tryCall(broke, `x${i}`)).code);
    expect(w.reads.payment - before).toBe(29); // la rafale (30), moins la lecture du payeur connu ; avant : 200
    expect(new Set(codes)).toEqual(new Set(["insufficient_funds", "busy"]));
    expect(e.calls()).toBe(1);
    // le payeur connu a son propre seau : servi pendant le flot
    expect((await tryCall(clientOf(w, e, known), "k2")).ok).toBe(true);
    // le seau se remplit avec le temps (2 lectures par seconde)
    vi.setSystemTime(t0 + 10_000);
    expect((await tryCall(broke, "plus tard")).code).toBe("insufficient_funds");
  }, 60_000);

  it("D : un payeur « connu » qui vide son solde perd ce statut à sa 1re requête refusée : son flot ne vide pas le seau des payeurs connus", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] }); // horloge figée : aucun jeton ne revient pendant le flot
    vi.setSystemTime(t0);
    const w = world();
    const e = enclaveOn(w); // seaux de 30 lectures (nouveaux payeurs, payeurs connus)
    const q = queueOf(w, e);
    const [rogue, honest] = [payerWallet(), payerWallet()];
    for (const x of [rogue, honest]) {
      w.balances.set(L(x.account.address), 1_000_000n);
      expect((await tryCall(clientOf(w, e, x), "payé")).ok).toBe(true);
    }
    expect((await q.runOnce()).settled).toHaveLength(2); // réglés par X402Settler : tous deux « connus »
    w.balances.set(L(rogue.account.address), 0n); // il vide son solde, puis inonde de requêtes signées (gratuites)
    const before = w.reads.payment;
    const codes = new Set<string | undefined>();
    for (let i = 0; i < 60; i++) codes.add((await tryCall(clientOf(w, e, rogue), `r${i}`)).code);
    expect(codes).toEqual(new Set(["insufficient_funds", "busy"]));
    expect(w.reads.payment - before).toBe(29); // 1 dans le seau des connus, puis 28 dans celui des nouveaux (30 − 2 pris)
    // le payeur connu honnête puise encore dans SON seau : servi
    expect((await tryCall(clientOf(w, e, honest), "toujours servi")).ok).toBe(true);
  }, 60_000);

  it("D : plafond par adresse IP VUE par l'enclave (pair TCP), pour les nouveaux payeurs : 429 au-delà ; une autre adresse, ou un payeur connu, passe", async () => {
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
    expect(codes).toEqual([...Array(4).fill("insufficient_funds"), ...Array(4).fill("rate_limited")]); // 5 jetons, dont 1 pris par le payeur connu
    expect((await tryCall(clientOf(w, e, payerWallet(), {}, fromIp(e, "::ffff:198.51.100.4")), "autre")).code).toBe("insufficient_funds");
    expect((await tryCall(clientOf(w, e, known, {}, fromIp(e, "203.0.113.7")), "k2")).ok).toBe(true);
  }, 60_000);
});
