/** x402.test.ts — le rail « paiement à l'appel » côté SDK : signature canonique pour l'USDC, lecture d'un fichier de
 *  déploiement, vérification d'un appel comme X402Settler.settle, file de règlement de l'opérateur (sans double
 *  règlement), garde-fous du client avant toute signature. Le parcours complet contre la vraie enclave est dans
 *  enclave/test/x402-e2e.test.ts. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { type Address, type Hex, keccak256, recoverTypedDataAddress, toBytes, zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  testnet, testnetV2, deploymentFromJson, usdcDomain, networkDomain, receiveWithAuthorizationTypes,
  callReceiptTypes, normalizeEcdsaSignature, eip3009SignatureProblem, normalizeCallReceipt, normalizePendingCall, serializeCallReceipt,
  verifyCallOnChain, X402SettlementQueue, createX402Client, createX402SettlementQueue, X402ChallengeError, X402CallError, X402PaidCallError,
  x402NetworkName, x402AckDomain, x402AckTypes, cancelAuthorizationTypes, serializeX402PaidRequest, parseX402PaidRequest, generateX25519,
  X402_PAID_RETRY_DELAYS_MS,
  type CallReceipt, type PendingCall, type Deployment,
} from "../src/index";

const D: Deployment = testnet;
const PRODUCT = 3n;
const PRICE = 10_000n;
const OPERATOR = "0x344f2d2fA5AeAe78871F0B882245069F887c2e1a" as Address;
const L = (x: string) => x.toLowerCase();
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

interface Chain {
  head: bigint; timestamp: bigint; price: bigint; settlement: Address; active: boolean;
  enclaves: Map<string, Address>; used: Set<string>; balances: Map<string, bigint>;
}
function chain(): Chain {
  return { head: 900n, timestamp: 1_800_000_000n, price: PRICE, settlement: D.x402Settler, active: true, enclaves: new Map(), used: new Set(), balances: new Map() };
}
function pub(c: Chain): any {
  return {
    async getBlock() { return { number: c.head, timestamp: c.timestamp }; },
    async getBlockNumber() { return c.head; },
    async readContract(a: any) {
      const x = a.args ?? [];
      switch (a.functionName) {
        case "getProduct": return { author: OPERATOR, price: c.price, settlement: c.settlement, param: keccak256(toBytes("openai/gpt-oss-120b")), exposureCap: 0n };
        case "isActive": return c.active;
        case "activeOperatorAt": return c.enclaves.get(L(x[0])) ?? zeroAddress;
        case "authorizationState": return c.used.has(`${L(x[0])}:${L(x[1])}`);
        case "balanceOf": return c.balances.get(L(x[0])) ?? 0n;
        default: throw new Error(`lecture non émulée : ${a.functionName}`);
      }
    },
  };
}

/** Un appel servi par `enclave`, payé par `payer` (autorisation EIP-3009 de `value`, échéance `validBefore`). */
async function servedCall(o: { enclave: ReturnType<typeof privateKeyToAccount>; payer: ReturnType<typeof privateKeyToAccount>; value?: bigint; validBefore?: bigint; nonce?: Hex }): Promise<PendingCall> {
  const nonce = o.nonce ?? (keccak256(toBytes(`n-${Math.random()}`)) as Hex);
  const receipt: CallReceipt = {
    productId: PRODUCT, payer: o.payer.address, requestHash: keccak256(toBytes("q")), responseHash: keccak256(toBytes("r")), units: 1n, anchorBlock: 800n, nonce,
  };
  const signature = await o.enclave.signTypedData({ domain: networkDomain(D.x402Settler, D.chainId) as any, types: callReceiptTypes, primaryType: "CallReceipt", message: receipt });
  const validBefore = o.validBefore ?? 1_800_003_600n;
  const authSig = await o.payer.signTypedData({
    domain: usdcDomain(D.usdc, D.chainId) as any, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization",
    message: { from: o.payer.address, to: D.x402Settler, value: o.value ?? PRICE, validAfter: 0n, validBefore, nonce },
  });
  return { receipt, signature, auth: { validAfter: 0n, validBefore, nonce, signature: authSig } };
}

describe("x402: canonical forms", () => {
  it("normalizeEcdsaSignature: high s → low s, v 0/1 → 27/28, same signer; USDC would accept the returned form", async () => {
    const acc = privateKeyToAccount(generatePrivateKey());
    const msg = { domain: usdcDomain(D.usdc, D.chainId) as any, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization" as const,
      message: { from: acc.address, to: D.x402Settler, value: 1n, validAfter: 0n, validBefore: 2n, nonce: `0x${"01".repeat(32)}` as Hex } };
    const sig = await acc.signTypedData(msg);
    expect(eip3009SignatureProblem(sig)).toBeNull();
    expect(normalizeEcdsaSignature(sig)).toBe(L(sig));
    const s = BigInt(`0x${sig.slice(66, 130)}`);
    const v = parseInt(sig.slice(130), 16);
    const high = `0x${sig.slice(2, 66)}${(N - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}` as Hex;
    expect(eip3009SignatureProblem(high)).toMatch(/s haut/);
    expect(await recoverTypedDataAddress({ ...msg, signature: high })).toBe(acc.address); // viem l'accepte…
    const fixed = normalizeEcdsaSignature(high);
    expect(fixed).toBe(L(sig)); // …le SDK la rend canonique
    const v01 = `${sig.slice(0, 130)}${(v - 27).toString(16).padStart(2, "0")}` as Hex;
    expect(normalizeEcdsaSignature(v01)).toBe(L(sig));
    expect(() => normalizeEcdsaSignature("0x1234" as Hex)).toThrow("65-byte");
  });

  it("receipt and pending call: parsed strictly (nothing malformed gets through)", async () => {
    const enclave = privateKeyToAccount(generatePrivateKey());
    const payer = privateKeyToAccount(generatePrivateKey());
    const call = await servedCall({ enclave, payer });
    const json = JSON.parse(JSON.stringify({
      receipt: serializeCallReceipt(call.receipt), signature: call.signature,
      auth: { validAfter: "0", validBefore: call.auth.validBefore.toString(), nonce: call.auth.nonce, signature: call.auth.signature }, amount: "10000", servedAt: 5,
    }));
    expect(normalizePendingCall(json)).toEqual({ ...call, receipt: { ...call.receipt, nonce: L(call.receipt.nonce) as Hex }, amount: 10_000n, servedAt: 5 });
    expect(() => normalizeCallReceipt({ ...json.receipt, units: "-1" })).toThrow("units");
    expect(() => normalizeCallReceipt({ ...json.receipt, anchorBlock: (2n ** 64n).toString() })).toThrow("anchorBlock");
    expect(() => normalizeCallReceipt({ ...json.receipt, nonce: "0x12" })).toThrow("nonce");
    expect(() => normalizePendingCall({ ...json, auth: { ...json.auth, signature: "0xdead" } })).toThrow("signature");
    expect(x402NetworkName(5042002)).toBe("arc-testnet");
    expect(x402NetworkName(5042)).toBe("arc");
  });

  it("deploymentFromJson: the v2 stack file gives back exactly the SDK's v2 stack; a missing address throws", () => {
    const j = JSON.parse(readFileSync(new URL("../../../deployments.v2.testnet.json", import.meta.url), "utf8"));
    const d = deploymentFromJson(j);
    for (const k of ["usdc", "productRegistry", "operatorBond", "enclaveRegistry", "verdictLog", "sessionPay", "sealedBounty", "x402Settler", "attestationModule", "erc8004Validation", "erc8004Identity", "history"] as const) {
      expect(L(d[k]), k).toBe(L(testnetV2[k]));
    }
    expect(d).toMatchObject({ chainId: 5042002, deployBlock: testnetV2.deployBlock, attestation: "dcap", products: { inference: 1n, bounty: 2n } });
    expect(d.products?.x402).toBeUndefined();
    const v21 = deploymentFromJson({ ...j, products: { ...j.products, "3": { settlement: "X402Settler" } } });
    expect(v21.products).toEqual({ inference: 1n, bounty: 2n, x402: 3n });
    expect(() => deploymentFromJson({ ...j, contracts: { ...j.contracts, X402Settler: undefined } })).toThrow("X402Settler");
  });
});

describe("x402: verify a call like X402Settler.settle", () => {
  it("settleable; then every refusal from the contract or from USDC is named", async () => {
    const c = chain();
    const enclave = privateKeyToAccount(generatePrivateKey());
    const payer = privateKeyToAccount(generatePrivateKey());
    c.enclaves.set(L(enclave.address), OPERATOR);
    c.balances.set(L(payer.address), 1_000_000n);
    const call = await servedCall({ enclave, payer });
    const ok = await verifyCallOnChain(pub(c), call, D, { expectedOperator: OPERATOR });
    expect(ok).toMatchObject({ settleable: true, alreadyUsed: false, expired: false, amount: PRICE, operator: OPERATOR, signer: enclave.address });

    const failing = async (mutate: (c: Chain) => void, id: string, callOver?: PendingCall, op: Address = OPERATOR) => {
      const cc = { ...chain(), enclaves: new Map(c.enclaves), balances: new Map(c.balances), used: new Set(c.used) };
      mutate(cc);
      const v = await verifyCallOnChain(pub(cc), callOver ?? call, D, { expectedOperator: op });
      expect(v.settleable, id).toBe(false);
      expect(v.checks.filter((x) => !x.ok).map((x) => x.id), id).toContain(id);
      return v;
    };
    await failing((x) => { x.active = false; }, "product");
    await failing((x) => { x.settlement = D.sessionPay; }, "settlement");
    await failing((x) => { x.enclaves.clear(); }, "active");
    await failing(() => {}, "operator", undefined, "0x000000000000000000000000000000000000dEaD");
    await failing((x) => { x.price = 20_000n; }, "authorization"); // le prix a changé : l'autorisation ne paie plus le montant dû
    await failing((x) => { x.balances.set(L(payer.address), PRICE - 1n); }, "funds");
    await failing((x) => { x.timestamp = call.auth.validBefore; }, "window");
    const used = await failing((x) => { x.used.add(`${L(payer.address)}:${L(call.receipt.nonce)}`); }, "unused");
    expect(used.alreadyUsed).toBe(true);
    const forged = await servedCall({ enclave, payer: privateKeyToAccount(generatePrivateKey()) });
    await failing(() => {}, "authorization", { ...call, auth: { ...call.auth, signature: forged.auth.signature } });
  });
});

describe("x402: the operator's settlement queue", () => {
  function setup() {
    const c = chain();
    const enclave = privateKeyToAccount(generatePrivateKey());
    c.enclaves.set(L(enclave.address), OPERATOR);
    const sent: Hex[] = [];
    const acked: Array<{ payer: Address; nonce: Hex }> = [];
    let pending: PendingCall[] = [];
    let outcome: "success" | "timeout" | "reverted" = "success";
    const q = new X402SettlementQueue({
      publicClient: pub(c), deployment: D, operator: OPERATOR,
      fetchPending: async () => pending,
      acknowledge: async (items) => { acked.push(...items); },
      settle: async (call) => {
        sent.push(call.receipt.nonce);
        await new Promise((r) => setTimeout(r, 5));
        if (outcome === "success") c.used.add(`${L(call.receipt.payer)}:${L(call.receipt.nonce)}`);
        return { tx: keccak256(toBytes(call.receipt.nonce)), status: outcome };
      },
    });
    return { c, enclave, q, sent, acked, setPending: (p: PendingCall[]) => { pending = p; }, setOutcome: (o: typeof outcome) => { outcome = o; } };
  }

  it("settles each call only once, even with simultaneous passes; reports what is consumed to the enclave", async () => {
    const s = setup();
    const payer = privateKeyToAccount(generatePrivateKey());
    s.c.balances.set(L(payer.address), 1_000_000n);
    const calls = [await servedCall({ enclave: s.enclave, payer }), await servedCall({ enclave: s.enclave, payer })];
    s.setPending(calls);
    const [a, b] = await Promise.all([s.q.runOnce(), s.q.runOnce()]);
    expect(a).toBe(b);
    expect(a.settled).toHaveLength(2);
    expect(s.sent).toHaveLength(2);
    expect(s.acked).toHaveLength(2);
    const again = await s.q.runOnce(); // l'enclave les liste encore (pas encore traité le signalement) : rien n'est renvoyé
    expect(again.alreadySettled).toBe(2);
    expect(s.sent).toHaveLength(2);
  });

  it("transaction with no receipt (timeout): no resend during the cooldown; a call for another operator is skipped; insufficient balance: waiting", async () => {
    const s = setup();
    const payer = privateKeyToAccount(generatePrivateKey());
    s.c.balances.set(L(payer.address), 1_000_000n);
    const stranger = privateKeyToAccount(generatePrivateKey());
    s.c.enclaves.set(L(stranger.address), "0x000000000000000000000000000000000000dEaD");
    const poor = privateKeyToAccount(generatePrivateKey());
    const mine = await servedCall({ enclave: s.enclave, payer });
    s.setPending([mine, await servedCall({ enclave: stranger, payer }), await servedCall({ enclave: s.enclave, payer: poor })]);
    s.setOutcome("timeout");
    const r1 = await s.q.runOnce();
    expect(s.sent).toEqual([mine.receipt.nonce]);
    expect(r1.dropped).toBe(1);
    expect(r1.waiting.map((w) => w.payer)).toEqual(expect.arrayContaining([payer.address, poor.address]));
    s.setOutcome("success");
    const r2 = await s.q.runOnce();
    expect(s.sent).toEqual([mine.receipt.nonce]); // refroidissement : pas de 2e envoi
    expect(r2.settled).toHaveLength(0);
    expect(s.q.size).toBe(2); // le mien (en attente de reçu) et celui du payeur sans fonds
  });

  it("an authorization that expires before settlement leaves the queue (lost), with no send", async () => {
    const s = setup();
    const payer = privateKeyToAccount(generatePrivateKey());
    s.c.balances.set(L(payer.address), 1_000_000n);
    s.setPending([await servedCall({ enclave: s.enclave, payer, validBefore: s.c.timestamp + 10n })]);
    const r = await s.q.runOnce();
    expect(r.expired).toBe(1);
    expect(s.sent).toHaveLength(0);
    expect(s.q.size).toBe(0);
  });
});

describe("x402: the client refuses before signing", () => {
  it("a product not settled through X402Settler: X402ChallengeError, no inference request", async () => {
    const c = chain();
    c.settlement = D.sessionPay;
    const enclave = privateKeyToAccount(generatePrivateKey());
    const x = `0x${"5a".repeat(32)}` as Hex;
    const seen: string[] = [];
    const f = (async (u: any) => {
      seen.push(String(u));
      if (String(u).endsWith("/pubkeys")) return new Response(JSON.stringify({ signer: enclave.address, x25519: x }), { status: 200 });
      throw new Error("inattendu");
    }) as typeof fetch;
    const p = pub(c);
    const base = p.readContract;
    p.readContract = async (a: any) => {
      if (a.functionName === "enclaveOf") return { signer: enclave.address, x25519: x, productId: PRODUCT, operator: OPERATOR, workloadId: x, tcbStatus: 0, fromBlock: 1n, untilBlock: 9_999n };
      if (a.functionName === "activeOperatorAt") return OPERATOR;
      return base(a);
    };
    const payer = privateKeyToAccount(generatePrivateKey());
    const ai = createX402Client({ enclaveUrl: "https://e.example", productId: PRODUCT, walletClient: { account: payer, signTypedData: () => { throw new Error("ne doit pas signer"); } } as any, publicClient: p, deployment: D, fetch: f });
    await expect(ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] })).rejects.toBeInstanceOf(X402ChallengeError);
    expect(seen.filter((u) => u.includes("chat/completions"))).toEqual([]);
  });
});

describe("x402: after the paid send, never \"nothing is owed\"", () => {
  /** Une passerelle factice : clés vérifiables on-chain, 402 conforme à la chaîne, puis `paid` pour chaque envoi payé. */
  function gateway(paid: (n: number) => Response | Promise<Response>) {
    const c = chain();
    const enclave = privateKeyToAccount(generatePrivateKey());
    const x = generateX25519().publicKey;
    const sent: Array<{ paid: boolean; xPayment?: string; body: string }> = [];
    let n = 0;
    const f = (async (u: any, init?: any) => {
      const url = String(u);
      if (url.endsWith("/pubkeys")) return new Response(JSON.stringify({ signer: enclave.address, x25519: x }), { status: 200 });
      const h = new Headers(init?.headers);
      sent.push({ paid: h.has("x-payment"), xPayment: h.get("x-payment") ?? undefined, body: init?.body });
      if (!h.has("x-payment")) {
        return new Response(JSON.stringify({
          x402Version: 1, error: "payment_required",
          accepts: [{ scheme: "exact", network: "arc-testnet", maxAmountRequired: c.price.toString(), payTo: D.x402Settler, asset: D.usdc, maxTimeoutSeconds: 900, resource: url, description: "", mimeType: "application/json", extra: { name: "USDC", version: "2" } }],
        }), { status: 402 });
      }
      return paid(++n);
    }) as typeof fetch;
    const p = pub(c);
    const base = p.readContract;
    p.readContract = async (a: any) => {
      if (a.functionName === "enclaveOf") return { signer: enclave.address, x25519: x, productId: PRODUCT, operator: OPERATOR, workloadId: x, tcbStatus: 0, fromBlock: 1n, untilBlock: 9_999n };
      if (a.functionName === "activeOperatorAt") return OPERATOR;
      return base(a);
    };
    const payer = privateKeyToAccount(generatePrivateKey());
    let signed = 0;
    const wallet = { account: payer, signTypedData: (args: any) => { signed++; return payer.signTypedData(args); } } as any;
    return { c, f, p, payer, wallet, sent, signed: () => signed };
  }

  it("every failure after the paid send (503, 429, 409, 402, disconnect) resends the IDENTICAL request; one authorization only; the error carries what is needed to resume", async () => {
    const answers = [
      () => new Response(JSON.stringify({ error: "x", code: "chain_unavailable" }), { status: 503 }),
      () => new Response(JSON.stringify({ error: "x", code: "payer_pending_limit" }), { status: 429 }),
      () => { throw new TypeError("fetch failed"); },
      () => new Response(JSON.stringify({ x402Version: 1, error: "insufficient_funds", detail: "rien n'est dû, promis", accepts: [] }), { status: 402 }),
    ];
    const g = gateway((n) => answers[n - 1]!());
    const ai = createX402Client({ enclaveUrl: "https://e.example", productId: PRODUCT, walletClient: g.wallet, publicClient: g.p, deployment: D, fetch: g.f, paidRetryDelaysMs: [1, 1, 1] });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err).not.toBeInstanceOf(X402CallError);
    expect(err.message).not.toContain("rien n'est dû"); // ni le nôtre, ni celui (non authentifié) du serveur
    expect(err.serverDetail).toBe("rien n'est dû, promis"); // gardé à part, comme donnée non authentifiée
    expect(err).toMatchObject({ status: 402, code: "insufficient_funds", attempts: 4 });
    expect(g.signed()).toBe(1);
    const paid = g.sent.filter((x) => x.paid);
    expect(paid).toHaveLength(4);
    expect(new Set(paid.map((x) => x.body)).size).toBe(1); // même enveloppe
    expect(new Set(paid.map((x) => x.xPayment)).size).toBe(1); // même autorisation
    const pending = err.pending;
    expect(JSON.parse(paid[0]!.body)).toEqual(pending.envelope);
    expect(pending.authorization.value).toBe(PRICE);
    expect(pending.authorization.validBefore - BigInt(Math.floor(Date.now() / 1000))).toBeGreaterThan(850n); // 900 s annoncées
    expect(parseX402PaidRequest(serializeX402PaidRequest(pending))).toEqual({ ...pending, envelope: { ...pending.envelope } });
    expect(JSON.stringify(err)).not.toContain(pending.ephemeralPrivateKey.slice(2)); // clé éphémère non énumérable
    // reprise : la même requête, la même autorisation ; toujours en échec ici → de nouveau X402PaidCallError
    const again = await ai.resume(pending).catch((e) => e);
    expect(again).toBeInstanceOf(X402PaidCallError);
    expect(g.signed()).toBe(1);
    expect(new Set(g.sent.filter((x) => x.paid).map((x) => x.xPayment)).size).toBe(1);
  });

  it("402 \"price changed\" not confirmed on-chain: no 2nd authorization; confirmed as a DECREASE: a 2nd one, for the SAME nonce", async () => {
    const PC = { x402Version: 1, error: "invalid_exact_evm_payload_authorization_value", accepts: [] };
    const g = gateway(() => new Response(JSON.stringify(PC), { status: 402 }));
    const ai = createX402Client({ enclaveUrl: "https://e.example", productId: PRODUCT, walletClient: g.wallet, publicClient: g.p, deployment: D, fetch: g.f, paidRetryDelaysMs: [1, 1] });
    expect(await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }).catch((e) => e)).toBeInstanceOf(X402PaidCallError);
    expect(g.signed()).toBe(1);

    const g2 = gateway((n) => {
      if (n === 2) g2.c.price = PRICE / 2n; // le prix baisse vraiment on-chain
      return new Response(JSON.stringify(PC), { status: 402 });
    });
    const ai2 = createX402Client({ enclaveUrl: "https://e.example", productId: PRODUCT, walletClient: g2.wallet, publicClient: g2.p, deployment: D, fetch: g2.f, paidRetryDelaysMs: [1, 1] });
    const err = await ai2.chat.completions.create({ messages: [{ role: "user", content: "a" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(g2.signed()).toBe(2);
    const auths = err.pending.authorizations;
    expect(auths.map((a: any) => a.value)).toEqual([PRICE, PRICE / 2n]);
    expect(auths[0].nonce).toBe(auths[1].nonce); // même nonce : au plus une des deux est consommable on-chain
    expect(new Set(g2.sent.filter((x) => x.paid).map((x) => x.body)).size).toBe(1); // même requête
  });

  it("price REALLY raised during the call (×100) → NO authorization at the new price; X402PaidCallError \"price_increased\" with newPrice; accepted explicitly through resume({ renew, maxPrice })", async () => {
    const PC = { x402Version: 1, error: "invalid_exact_evm_payload_authorization_value", accepts: [] };
    const g = gateway((n) => {
      if (n === 1) g.c.price = 100n * PRICE; // l'auteur relève le prix pendant qu'un mandataire cache la réponse
      return new Response(JSON.stringify(PC), { status: 402 });
    });
    const ai = createX402Client({ enclaveUrl: "https://e.example", productId: PRODUCT, walletClient: g.wallet, publicClient: g.p, deployment: D, fetch: g.f, paidRetryDelaysMs: [1, 1, 1] });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(X402PaidCallError);
    expect(err).toMatchObject({ code: "price_increased", newPrice: 100n * PRICE });
    expect(g.signed()).toBe(1); // jamais ×100 sans accord
    const values = g.sent.filter((x) => x.paid).map((x) => JSON.parse(atob(x.xPayment!)).payload.authorization.value);
    expect(new Set(values)).toEqual(new Set([PRICE.toString()]));
    expect(err.message).toMatch(/au-delà du plafond de cet appel/);
    expect(err.message).toContain("client.resume(err.pending, { renew: true, maxPrice: err.newPrice })");
    expect(err.pending.maxPrice).toBe(PRICE); // le plafond de l'appel = le prix lu à son début
    // une reprise SANS accord ne signe rien de plus cher
    const again = await ai.resume(err.pending, { renew: true }).catch((e) => e);
    expect(again).toMatchObject({ code: "price_increased", newPrice: 100n * PRICE });
    expect(g.signed()).toBe(1);
    // le plafond survit à la sérialisation
    expect(parseX402PaidRequest(serializeX402PaidRequest(err.pending)).maxPrice).toBe(PRICE);
    // accord explicite : une autorisation au nouveau prix, MÊME nonce (au plus une des deux est consommable)
    const accepted = await ai.resume(err.pending, { renew: true, maxPrice: err.newPrice }).catch((e) => e);
    expect(g.signed()).toBe(2);
    expect(accepted.pending.authorizations.map((a: any) => a.value)).toEqual([PRICE, 100n * PRICE]);
    expect(accepted.pending.authorizations[1].nonce).toBe(err.pending.nonce);
    expect(accepted.pending.maxPrice).toBe(100n * PRICE);
  });

  it("enclave restarted → the message says the reply is LOST and that the payment may have been settled, without suggesting resume", async () => {
    const g = gateway(() => new Response(JSON.stringify({ error: "Bad Gateway" }), { status: 502 }));
    const ai = createX402Client({ enclaveUrl: "https://e.example", productId: PRODUCT, walletClient: g.wallet, publicClient: g.p, deployment: D, fetch: g.f, paidRetryDelaysMs: [] });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(X402PaidCallError);
    // le message général dit jusqu'à quand l'enclave garde la réponse
    expect(err.message).toMatch(/ne garde la réponse que jusqu'à .*et seulement si elle ne redémarre pas/);
    // l'enclave redémarre : nouvelle clé à la même URL
    const restarted = { ...err.pending, enclave: privateKeyToAccount(generatePrivateKey()).address };
    const changed = await ai.resume(restarted).catch((e) => e);
    expect(changed).toBeInstanceOf(X402PaidCallError);
    expect(changed.code).toBe("enclave_changed");
    expect(changed.message).toMatch(/réponse est PERDUE/);
    expect(changed.message).toMatch(/a PU être réglé/);
    expect(changed.message).not.toMatch(/resume\(err\.pending\)/); // la reprise ne rendrait pas cette réponse
    expect(changed.message).not.toContain("rien n'est dû");
  });

  it("a disconnect BEFORE any payment stays X402CallError (nothing was signed)", async () => {
    const c = chain();
    const enclave = privateKeyToAccount(generatePrivateKey());
    const x = generateX25519().publicKey;
    const f = (async (u: any) => {
      if (String(u).endsWith("/pubkeys")) return new Response(JSON.stringify({ signer: enclave.address, x25519: x }), { status: 200 });
      return new Response(JSON.stringify({ error: "x", code: "chain_unavailable" }), { status: 503 });
    }) as typeof fetch;
    const p = pub(c);
    const base = p.readContract;
    p.readContract = async (a: any) => {
      if (a.functionName === "enclaveOf") return { signer: enclave.address, x25519: x, productId: PRODUCT, operator: OPERATOR, workloadId: x, tcbStatus: 0, fromBlock: 1n, untilBlock: 9_999n };
      if (a.functionName === "activeOperatorAt") return OPERATOR;
      return base(a);
    };
    const payer = privateKeyToAccount(generatePrivateKey());
    const ai = createX402Client({ enclaveUrl: "https://e.example", productId: PRODUCT, walletClient: { account: payer, signTypedData: () => { throw new Error("ne doit pas signer"); } } as any, publicClient: p, deployment: D, fetch: f });
    const err = await ai.chat.completions.create({ messages: [{ role: "user", content: "a" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(X402CallError);
    expect(err.message).toContain("avant tout paiement");
    expect(X402_PAID_RETRY_DELAYS_MS.length).toBe(3);
  });

  it("cancelAuthorization: the payer signs CancelAuthorization (USDC domain) and sends it; refused if already consumed", async () => {
    const c = chain();
    const payer = privateKeyToAccount(generatePrivateKey());
    const nonce = keccak256(toBytes("n")) as Hex;
    const calls: any[] = [];
    const p = { ...pub(c), async simulateContract(a: any) { calls.push(a); return { request: a }; } } as any;
    const wallet = { account: payer, signTypedData: (a: any) => payer.signTypedData(a), writeContract: async (r: any) => { calls.push({ write: r }); return "0xab" as Hex; } } as any;
    const ai = createX402Client({ enclaveUrl: "https://e.example", productId: PRODUCT, walletClient: wallet, publicClient: p, deployment: D });
    expect(await ai.cancelAuthorization({ nonce })).toBe("0xab");
    const sim = calls[0];
    expect(sim).toMatchObject({ address: D.usdc, functionName: "cancelAuthorization" });
    const [authorizer, n, v, r, s2] = sim.args;
    expect([authorizer, n]).toEqual([payer.address, nonce]);
    const sig = `${r}${(s2 as string).slice(2)}${Number(v).toString(16)}` as Hex;
    expect(eip3009SignatureProblem(sig)).toBeNull();
    expect(await recoverTypedDataAddress({ domain: usdcDomain(D.usdc, D.chainId) as any, types: cancelAuthorizationTypes, primaryType: "CancelAuthorization", message: { authorizer: payer.address, nonce }, signature: sig })).toBe(payer.address);
    c.used.add(`${L(payer.address)}:${L(nonce)}`);
    await expect(ai.cancelAuthorization({ nonce })).rejects.toThrow("déjà consommée");
    await expect(ai.cancelAuthorization({ nonce, payer: OPERATOR })).rejects.toThrow("pas de ce client");
  });
});

describe("x402: the operator queue's reports are signed and never duplicated", () => {
  it("POST /x402/settled carries the operator's EIP-712 signature (enclave read back from /x402/pending, product, timestamp, nonce), each key once", async () => {
    const c = chain();
    const enclave = privateKeyToAccount(generatePrivateKey());
    const operator = privateKeyToAccount(generatePrivateKey());
    c.enclaves.set(L(enclave.address), operator.address);
    const payer = privateKeyToAccount(generatePrivateKey());
    c.balances.set(L(payer.address), 1_000_000n);
    const call = await servedCall({ enclave, payer });
    c.used.add(`${L(payer.address)}:${L(call.receipt.nonce)}`); // déjà réglé (par le payeur lui-même)
    const item = { receipt: serializeCallReceipt(call.receipt), signature: call.signature, auth: { validAfter: "0", validBefore: call.auth.validBefore.toString(), nonce: call.auth.nonce, signature: call.auth.signature }, amount: "10000", servedAt: 1 };
    const posted: any[] = [];
    const f = (async (u: any, init?: any) => {
      if (String(u).includes("/x402/pending")) return new Response(JSON.stringify({ enclave: enclave.address, productId: "3", items: [item, item] }), { status: 200 });
      posted.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ settled: [], pending: [], unknown: [] }), { status: 200 });
    }) as typeof fetch;
    // l'événement CallSettled de ce payeur porte ce nonce : le payeur a réglé lui-même par X402Settler
    const logsAsked: any[] = [];
    const p = { ...pub(c), async getLogs(a: any) { logsAsked.push(a); return [{ args: { productId: PRODUCT, payer: payer.address, operator: operator.address, amount: PRICE, nonce: call.receipt.nonce } }]; } };
    const q = createX402SettlementQueue({ enclaveUrl: "https://e.example", publicClient: p as any, walletClient: { account: operator } as any, deployment: D, fetch: f });
    const r = await q.runOnce();
    expect(r.alreadySettled).toBe(1);
    expect(r.consumedElsewhere).toBe(0);
    expect(logsAsked[0]).toMatchObject({ address: D.x402Settler, args: { productId: PRODUCT, payer: payer.address }, fromBlock: call.receipt.anchorBlock, toBlock: c.head });
    expect(posted).toHaveLength(1);
    const b = posted[0];
    expect(b.items).toEqual([{ payer: payer.address, nonce: L(call.receipt.nonce), settled: true }]);
    expect(b).toMatchObject({ enclave: enclave.address, productId: "3" });
    expect(Math.abs(b.issuedAt - Math.floor(Date.now() / 1000))).toBeLessThan(5);
    const signer = await recoverTypedDataAddress({
      domain: x402AckDomain(D.x402Settler, D.chainId) as any, types: x402AckTypes, primaryType: "X402Settled",
      message: { enclave: b.enclave, productId: BigInt(b.productId), issuedAt: BigInt(b.issuedAt), ackNonce: b.ackNonce, items: b.items }, signature: b.signature,
    });
    expect(signer).toBe(operator.address);
    expect(x402AckDomain(D.x402Settler, D.chainId).version).toBe("2");
  });

  it("an authorization consumed WITHOUT a visible X402Settler settlement (cancelled) is reported \"settled: false\"; our own settlements, even fetched a 2nd time, \"settled: true\"; a failed report is sent again", async () => {
    const c = chain();
    const enclave = privateKeyToAccount(generatePrivateKey());
    const operator = privateKeyToAccount(generatePrivateKey());
    c.enclaves.set(L(enclave.address), operator.address);
    const payer = privateKeyToAccount(generatePrivateKey());
    c.balances.set(L(payer.address), 1_000_000n);
    const cancelled = await servedCall({ enclave, payer });
    const mine = await servedCall({ enclave, payer });
    c.used.add(`${L(payer.address)}:${L(cancelled.receipt.nonce)}`); // cancelAuthorization du payeur
    const asItem = (x: PendingCall) => ({ receipt: serializeCallReceipt(x.receipt), signature: x.signature, auth: { validAfter: "0", validBefore: x.auth.validBefore.toString(), nonce: x.auth.nonce, signature: x.auth.signature }, amount: "10000", servedAt: 1 });
    const posted: any[] = [];
    let ackStatus = 503;
    const f = (async (u: any, init?: any) => {
      if (String(u).includes("/x402/pending")) return new Response(JSON.stringify({ enclave: enclave.address, productId: "3", total: 2, offset: 0, items: [asItem(cancelled), asItem(mine)] }), { status: 200 });
      posted.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ settled: [], pending: [], unknown: [] }), { status: ackStatus });
    }) as typeof fetch;
    const p = {
      ...pub(c),
      async getLogs() { return []; }, // aucun événement CallSettled : pas un règlement
      async simulateContract(a: any) { return { request: a }; },
      async waitForTransactionReceipt() { return { status: "success", gasUsed: 1n }; },
    };
    const wallet = { account: operator, async writeContract(req: any) { c.used.add(`${L(req.args[0].payer)}:${L(req.args[0].nonce)}`); return keccak256(toBytes("tx")) as Hex; } };
    const q = createX402SettlementQueue({ enclaveUrl: "https://e.example", publicClient: p as any, walletClient: wallet as any, deployment: D, fetch: f });
    const r1 = await q.runOnce();
    expect(r1).toMatchObject({ alreadySettled: 1, consumedElsewhere: 1 });
    expect(r1.settled).toHaveLength(1);
    const items1 = posted.at(-1).items;
    expect(items1).toEqual(expect.arrayContaining([
      { payer: payer.address, nonce: L(cancelled.receipt.nonce), settled: false },
      { payer: payer.address, nonce: L(mine.receipt.nonce), settled: true },
    ]));
    // le signalement a échoué (503) : renvoyé au passage suivant ; l'enclave liste encore les deux appels : le nôtre reste
    // « réglé » (nous l'avons réglé), l'annulé reste « consommé autrement »
    ackStatus = 200;
    const r2 = await q.runOnce();
    expect(r2.settled).toHaveLength(0);
    const items2 = posted.at(-1).items;
    expect(items2).toHaveLength(2);
    expect(items2).toEqual(expect.arrayContaining([
      { payer: payer.address, nonce: L(cancelled.receipt.nonce), settled: false },
      { payer: payer.address, nonce: L(mine.receipt.nonce), settled: true },
    ]));
  });
});

describe("x402: the operator queue fetches EVERYTHING and settles covered calls first", () => {
  it("GET /x402/pending page by page (limit, offset) up to the total; an enclave that ignores offset: a single page", async () => {
    const c = chain();
    const enclave = privateKeyToAccount(generatePrivateKey());
    const operator = privateKeyToAccount(generatePrivateKey());
    c.enclaves.set(L(enclave.address), operator.address);
    const payer = privateKeyToAccount(generatePrivateKey());
    const calls = await Promise.all(Array.from({ length: 7 }, () => servedCall({ enclave, payer })));
    const items = calls.map((x) => ({ receipt: serializeCallReceipt(x.receipt), signature: x.signature, auth: { validAfter: "0", validBefore: x.auth.validBefore.toString(), nonce: x.auth.nonce, signature: x.auth.signature }, amount: "10000", servedAt: 1, covered: false }));
    const asked: string[] = [];
    const paged = (echoOffset: boolean) => (async (u: any) => {
      const url = new URL(String(u));
      asked.push(url.search);
      const limit = Number(url.searchParams.get("limit")), offset = Number(url.searchParams.get("offset") ?? 0);
      return new Response(JSON.stringify({ enclave: enclave.address, productId: "3", total: items.length, ...(echoOffset ? { offset } : {}), items: items.slice(echoOffset ? offset : 0, (echoOffset ? offset : 0) + limit) }), { status: 200 });
    }) as typeof fetch;
    const q = createX402SettlementQueue({ enclaveUrl: "https://e.example", publicClient: pub(c), walletClient: { account: operator } as any, deployment: D, fetch: paged(true), limit: 3, maxUncoveredChecks: 0 });
    const r = await q.runOnce();
    expect(asked).toEqual(["?limit=3&offset=0", "?limit=3&offset=3", "?limit=3&offset=6"]);
    expect(r.fetched).toBe(7);
    expect(q.size).toBe(7);
    // aucune revérification d'appel « non couvert » permise : tous attendent, sans lecture
    expect(r.waiting).toHaveLength(7);
    expect(r.waiting[0]!.reasons[0]).toMatch(/non couvert/);
    asked.length = 0;
    const q2 = createX402SettlementQueue({ enclaveUrl: "https://e.example", publicClient: pub(c), walletClient: { account: operator } as any, deployment: D, fetch: paged(false), limit: 3 });
    expect((await q2.runOnce()).fetched).toBe(3);
    expect(asked).toEqual(["?limit=3&offset=0"]);
  });

  it("hundreds of \"uncovered\" unpaid calls with short expiry: an honest payer's COVERED call is settled on the first pass; at most maxUncoveredChecks unpaid calls re-checked", async () => {
    const c = chain();
    const enclave = privateKeyToAccount(generatePrivateKey());
    c.enclaves.set(L(enclave.address), OPERATOR);
    const honest = privateKeyToAccount(generatePrivateKey());
    c.balances.set(L(honest.address), 1_000_000n);
    const attackers = Array.from({ length: 30 }, () => privateKeyToAccount(generatePrivateKey())); // soldes vidés : 0
    const junk: PendingCall[] = [];
    for (const [i, a] of attackers.entries()) junk.push({ ...(await servedCall({ enclave, payer: a, validBefore: c.timestamp + 300n + BigInt(i) })), covered: false });
    const good: PendingCall = { ...(await servedCall({ enclave, payer: honest, validBefore: c.timestamp + 900n })), covered: true };
    const sent: Hex[] = [];
    let verified = 0;
    const p = pub(c);
    const base = p.getBlock;
    p.getBlock = async () => { verified++; return base(); }; // une vérification on-chain = une lecture de tête
    const q = new X402SettlementQueue({
      publicClient: p, deployment: D, operator: OPERATOR, maxUncoveredChecks: 5,
      fetchPending: async () => [...junk, good], // les impayés d'abord, échéance plus proche
      settle: async (call) => { sent.push(call.receipt.nonce); c.used.add(`${L(call.receipt.payer)}:${L(call.receipt.nonce)}`); return { tx: keccak256(toBytes(call.receipt.nonce)), status: "success" }; },
    });
    const r = await q.runOnce();
    expect(sent).toEqual([good.receipt.nonce]); // réglé d'abord, au premier passage
    expect(r.settled).toHaveLength(1);
    expect(verified).toBe(1 + 5); // l'honnête, puis 5 impayés seulement
    expect(r.waiting).toHaveLength(30);
  });
});
