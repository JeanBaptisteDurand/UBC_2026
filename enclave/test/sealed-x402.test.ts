/**
 * Produit « inférence payée à l'appel » (x402, schéma « exact ») : l'enclave sealed-x402 de bout en bout côté serveur,
 * avec une chaîne et un modèle factices. 402 sans paiement, paiement valide → réponse + reçu (CallReceipt d'X402Settler),
 * rejeu d'autorisation refusé, montant faux refusé, file d'attente de l'opérateur, et les autres refus (solde, caution,
 * payeur à code, signature malléable, fenêtre de validité, taille, enclave non payable).
 */
import { describe, it, expect } from "vitest";
import {
  type Address,
  type Hex,
  concat,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  recoverAddress,
  toBytes,
  toHex,
  zeroAddress,
  type AbiFunction,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x25519 } from "@noble/curves/ed25519";

import { EnclaveKit } from "../src/kit/enclave-kit";
import { open, seal } from "../src/kit/hpke";
import { callReceiptTypes, recoverCallReceiptSigner, type CallReceipt } from "../src/kit/eip712";
import {
  buildPayerAuthorization,
  callNonce,
  callResponseHash,
  decodeXPayment,
  encodeXPayment,
  facilitatorVerify,
  type PaymentRequirements,
} from "../src/services/x402";
import {
  X402Gateway,
  type ChatModel,
  type ChatModelRequest,
  type X402CallResponse,
  type X402ChainReader,
  type X402GatewayConfig,
  type X402PaymentState,
  type X402ProductView,
} from "../src/services/x402-gateway";
import { createSealedX402App } from "../products/sealed-x402/app";
import {
  ENCLAVE_REGISTRY_ACTIVE_ABI,
  OPERATOR_BOND_READ_ABI,
  PRODUCT_REGISTRY_READ_ABI,
  X402_SETTLER_READ_ABI,
  exposureCapacity,
} from "../products/sealed-x402/chain";
import { readSealedX402Config } from "../products/sealed-x402/config";
import { createRedpillModel } from "../products/sealed-x402/model";
import { x402AckDomain, x402AckTypes } from "../src/services/x402-ack";
import { enclaveRegistryAbi, operatorBondAbi, productRegistryAbi, x402Abi } from "../../packages/sdk/src/abis";

const CHAIN = 5042002;
const REGISTRY = "0x00000000000000000000000000000000000000c2" as Address;
const SETTLER = "0x00000000000000000000000000000000000000bb" as Address;
const SESSIONPAY = "0x00000000000000000000000000000000000000aa" as Address;
const USDC = "0x3600000000000000000000000000000000000000" as Address;
/** L'opérateur : sa clé signe les signalements « appels réglés » (POST /x402/settled, réservé à OPERATOR_ALLOWLIST). */
const operatorAccount = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const OPERATOR = operatorAccount.address;
const PRODUCT = 3n;
const MODEL = keccak256(toBytes("openai/gpt-oss-120b"));
const PRICE = 10_000n; // 0,01 USDC par appel
const NOW = 1_800_000_000n;
const payer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const third = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const keyOf = (a: Address, nonce: Hex) => `${a.toLowerCase()}:${nonce.toLowerCase()}`;

class FakeChain implements X402ChainReader {
  block = 1000n;
  product: X402ProductView = { active: true, price: PRICE, settlement: SETTLER, param: MODEL, exposureCap: 0n };
  operator: Address = OPERATOR;
  used = new Set<string>();
  balances = new Map<string, bigint>();
  defaultBalance = 1_000_000n; // 1 USDC
  withCode = new Set<string>();
  capacity: bigint | null = 10_000_000n;
  paymentReads = 0;
  /** Lectures lentes (ms) : pour faire se recouvrir des requêtes concurrentes. */
  delayMs = 0;
  async status() {
    return { block: this.block, product: { ...this.product }, operator: this.operator };
  }
  async paymentState(q: { payer: Address; nonce: Hex }): Promise<X402PaymentState> {
    this.paymentReads++;
    if (this.delayMs) await sleep(this.delayMs);
    return {
      block: this.block,
      product: { ...this.product },
      operator: this.operator,
      authorizationUsed: this.used.has(keyOf(q.payer, q.nonce)),
      balance: this.balances.get(q.payer.toLowerCase()) ?? this.defaultBalance,
      payerHasCode: this.withCode.has(q.payer.toLowerCase()),
      capacity: this.capacity,
    };
  }
  async authorizationUsed(p: Address, nonce: Hex) {
    return this.used.has(keyOf(p, nonce));
  }
}

class FakeModel implements ChatModel {
  calls = 0;
  fail = false;
  delayMs = 0;
  last?: ChatModelRequest;
  async complete(r: ChatModelRequest) {
    this.calls++;
    this.last = r;
    if (this.delayMs) await sleep(this.delayMs);
    if (this.fail) throw new Error("amont : HTTP 500");
    return { text: `réponse : ${r.messages[r.messages.length - 1]!.content}`, tokensIn: 7, tokensOut: 5 };
  }
}

function setup(over: Partial<X402GatewayConfig> = {}) {
  const kit = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: REGISTRY, mockBlockHash: true });
  const chain = new FakeChain();
  const model = new FakeModel();
  const clock = { now: NOW };
  const gw = new X402Gateway(
    kit,
    {
      chainId: CHAIN,
      settler: SETTLER,
      usdc: USDC,
      network: "arc-testnet",
      usdcName: "USDC",
      usdcVersion: "2",
      modelHash: MODEL,
      operators: [OPERATOR],
      statusCacheMs: 0,
      now: () => clock.now,
      log: () => {},
      ...over,
    },
    chain,
    model,
  );
  const app = createSealedX402App({
    kit,
    gateway: gw,
    attest: { operatorAllowlist: [OPERATOR], registeredOperator: async () => null, warn: () => {} },
    log: () => {},
  });
  return { kit, chain, model, gw, app, clock };
}

/** Ce que fait le SDK : requête salée, chiffrée vers la clé X25519 de l'enclave ; nonce = engagement sur la requête. */
async function makeRequest(kit: EnclaveKit, content = "Bonjour ?", extra: Record<string, unknown> = {}) {
  const plain = new TextEncoder().encode(
    JSON.stringify({ messages: [{ role: "user", content }], ...extra, salt: toHex(globalThis.crypto.getRandomValues(new Uint8Array(32))) }),
  );
  const sealed = await seal(toBytes(kit.keys.x25519PublicKey), plain);
  const ephPriv = x25519.utils.randomPrivateKey();
  const envelope = { enc: toHex(sealed.enc), ciphertext: toHex(sealed.ciphertext), clientEphemeralPub: toHex(x25519.getPublicKey(ephPriv)) };
  const nonce = callNonce({ chainId: CHAIN, settler: SETTLER, productId: PRODUCT, enclave: kit.keys.signer, ...envelope });
  return { plain, envelope, nonce, ephPriv };
}

function requirement(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "arc-testnet",
    maxAmountRequired: PRICE.toString(),
    resource: "https://enclave/v1/chat/completions",
    description: "",
    mimeType: "application/json",
    payTo: SETTLER,
    maxTimeoutSeconds: 3600,
    asset: USDC,
    extra: { name: "USDC", version: "2" },
    ...over,
  };
}

/** En-tête X-PAYMENT : autorisation EIP-3009 vers X402Settler (ou `to`), montant `value`, échéance `validBefore`. */
async function pay(nonce: Hex, o: { value?: bigint; validBefore?: bigint; account?: typeof payer; to?: Address } = {}) {
  const acc = o.account ?? payer;
  const p = await buildPayerAuthorization(
    (args) => acc.signTypedData(args as any),
    requirement({ payTo: o.to ?? SETTLER }),
    CHAIN,
    acc.address,
    nonce,
    o.validBefore ?? NOW + 900n, // AUTH_VALIDITY_SECONDS par défaut (900 s)
    o.value ?? PRICE,
  );
  return encodeXPayment(p);
}

/** POST /x402/settled SIGNÉ par l'opérateur (EIP-712), horodaté à l'horloge de l'enclave, nonce aléatoire ; chaque item
 *  « réglé par X402Settler » (settled: true) sauf s'il dit le contraire. */
async function signedAck(
  s: { app: ReturnType<typeof setup>["app"]; kit: EnclaveKit; clock: { now: bigint } },
  raw: Array<{ payer: Address; nonce: Hex; settled?: boolean }>,
  o: { signer?: ReturnType<typeof privateKeyToAccount>; issuedAt?: bigint; ackNonce?: Hex; enclave?: Address } = {},
) {
  const items = raw.map((i) => ({ payer: i.payer, nonce: i.nonce, settled: i.settled ?? true }));
  const m = {
    enclave: o.enclave ?? s.kit.keys.signer,
    productId: PRODUCT,
    issuedAt: o.issuedAt ?? s.clock.now,
    ackNonce: o.ackNonce ?? toHex(globalThis.crypto.getRandomValues(new Uint8Array(32))),
    items,
  };
  const signature = await (o.signer ?? operatorAccount).signTypedData({ domain: x402AckDomain(CHAIN, SETTLER), types: x402AckTypes, primaryType: "X402Settled", message: m });
  const body = { enclave: m.enclave, productId: m.productId.toString(), issuedAt: Number(m.issuedAt), ackNonce: m.ackNonce, items, signature };
  return s.app.request("/x402/settled", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function post(app: ReturnType<typeof setup>["app"], envelope: unknown, xPayment?: string) {
  return app.request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...(xPayment ? { "x-payment": xPayment } : {}) },
    body: JSON.stringify(envelope),
  });
}

async function json(res: Response): Promise<any> {
  return res.json();
}

function receiptOf(out: X402CallResponse): CallReceipt {
  const r = out.receipt;
  return {
    productId: BigInt(r.productId),
    payer: r.payer,
    requestHash: r.requestHash,
    responseHash: r.responseHash,
    units: BigInt(r.units),
    anchorBlock: BigInt(r.anchorBlock),
    nonce: r.nonce,
  };
}

describe("x402 — 402 sans paiement", () => {
  it("rend les exigences x402 : payTo = X402Settler, asset = USDC, prix FIXE par appel lu dans le produit on-chain, domaine EIP-712 de l'USDC", async () => {
    const { app, model, kit, chain } = setup();
    const q = await makeRequest(kit);
    const res = await post(app, q.envelope);
    expect(res.status).toBe(402);
    const b = await json(res);
    expect(b.x402Version).toBe(1);
    expect(b.error).toBe("payment_required");
    expect(b.accepts).toHaveLength(1);
    expect(b.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "arc-testnet",
      maxAmountRequired: "10000",
      payTo: SETTLER,
      asset: USDC,
      // 9/11 : 900 s au plus (au lieu de 3 600) ; au soir : 60 s de moins annoncées, pour l'horloge des clients
      maxTimeoutSeconds: 840,
      extra: { name: "USDC", version: "2", productId: "3", unitsPerCall: "1", enclave: kit.keys.signer },
    });
    // le prix suit le produit on-chain
    chain.product = { ...chain.product, price: 25_000n };
    expect((await json(await post(app, q.envelope))).accepts[0].maxAmountRequired).toBe("25000");
    // découverte du prix sans corps du tout
    expect((await app.request("/v1/chat/completions", { method: "POST" })).status).toBe(402);
    expect(model.calls).toBe(0);
  });

  it("503 (et pas de 402) quand un reçu de cette enclave ne serait pas payé : autre règlement, autre modèle, enclave inactive, opérateur hors liste, produit inactif", async () => {
    const { app, model, kit, chain } = setup();
    const q = await makeRequest(kit);
    const cases: Array<[() => void, string]> = [
      [() => (chain.product = { ...chain.product, settlement: SESSIONPAY }), "wrong_settlement"],
      [() => (chain.product = { ...chain.product, param: keccak256(toBytes("autre-modele")) }), "model_mismatch"],
      [() => (chain.operator = zeroAddress), "enclave_inactive"],
      [() => (chain.operator = "0x000000000000000000000000000000000000dEaD"), "wrong_operator"],
      [() => (chain.product = { ...chain.product, active: false }), "product_inactive"],
      [() => (chain.product = { ...chain.product, price: 0n }), "zero_price"],
    ];
    for (const [mutate, code] of cases) {
      const saved = { product: { ...chain.product }, operator: chain.operator };
      mutate();
      const res = await post(app, q.envelope, await pay(q.nonce));
      expect(res.status, code).toBe(503);
      expect((await json(res)).code).toBe(code);
      chain.product = saved.product;
      chain.operator = saved.operator;
    }
    expect(model.calls).toBe(0);
  });
});

describe("x402 — paiement valide", () => {
  it("réponse chiffrée vers la clé du client + CallReceipt signé par l'enclave, exactement ce que X402Settler.settle vérifie", async () => {
    const { app, model, kit, chain, gw } = setup();
    const q = await makeRequest(kit, "Combien font 2 + 2 ?", { temperature: 0.1, max_tokens: 99_999 });
    const res = await post(app, q.envelope, await pay(q.nonce));
    expect(res.status).toBe(200);
    const out = (await json(res)) as X402CallResponse;
    const text = new TextDecoder().decode(await open(q.ephPriv, toBytes(out.enc), toBytes(out.ciphertext)));
    expect(text).toBe("réponse : Combien font 2 + 2 ?");
    expect(model.last).toMatchObject({ temperature: 0.1, maxTokens: 1024 }); // max_tokens borné (prix fixe par appel)

    const cr = receiptOf(out);
    const requestHash = keccak256(q.plain);
    expect(cr).toEqual({
      productId: PRODUCT,
      payer: payer.address,
      requestHash,
      responseHash: callResponseHash(requestHash, text),
      units: 1n,
      anchorBlock: chain.block,
      nonce: q.nonce,
    });
    expect(await recoverCallReceiptSigner({ chainId: CHAIN, verifyingContract: SETTLER }, cr, out.signature)).toBe(kit.keys.signer);

    // le digest « à la main », comme X402Settler._recover : CALL_RECEIPT_TYPEHASH, abi.encode, domaine ArcEnclaveNetwork/1
    const TYPEHASH = keccak256(
      toBytes("CallReceipt(uint256 productId,address payer,bytes32 requestHash,bytes32 responseHash,uint128 units,uint64 anchorBlock,bytes32 nonce)"),
    );
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint128" }, { type: "uint64" }, { type: "bytes32" }],
        [TYPEHASH, cr.productId, cr.payer, cr.requestHash, cr.responseHash, cr.units, cr.anchorBlock, cr.nonce],
      ),
    );
    const domainSeparator = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [
          keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
          keccak256(toBytes("ArcEnclaveNetwork")),
          keccak256(toBytes("1")),
          BigInt(CHAIN),
          SETTLER,
        ],
      ),
    );
    const digest = keccak256(concat(["0x1901", domainSeparator, structHash]));
    expect(digest).toBe(
      hashTypedData({
        domain: { name: "ArcEnclaveNetwork", version: "1", chainId: CHAIN, verifyingContract: SETTLER },
        types: callReceiptTypes,
        primaryType: "CallReceipt",
        message: cr,
      }),
    );
    expect(await recoverAddress({ hash: digest, signature: out.signature })).toBe(kit.keys.signer);

    expect(out.payment).toMatchObject({ scheme: "exact", payer: payer.address, amount: "10000", nonce: q.nonce, payTo: SETTLER, asset: USDC, settlement: "deferred" });
    expect(model.calls).toBe(1);
    expect(gw.stats()).toMatchObject({ pending: 1, pendingAmount: "10000", inFlight: 0 });
  });

  it("le modèle échoue : rien n'est signé ni gardé ; la même requête avec la même autorisation est servie ensuite", async () => {
    const { app, model, kit, gw } = setup();
    const q = await makeRequest(kit);
    const xp = await pay(q.nonce);
    model.fail = true;
    const bad = await post(app, q.envelope, xp);
    expect(bad.status).toBe(502);
    expect((await json(bad)).error).toContain("nothing is billed");
    expect(gw.pending().total).toBe(0);
    expect(gw.stats().inFlight).toBe(0);
    model.fail = false;
    expect((await post(app, q.envelope, xp)).status).toBe(200);
    expect(gw.pending().total).toBe(1);
  });

  it("des requêtes identiques concurrentes (même requête, même autorisation) : UN appel au modèle, UN reçu", async () => {
    const { app, model, kit } = setup();
    model.delayMs = 20;
    const q = await makeRequest(kit);
    const xp = await pay(q.nonce);
    const rs = await Promise.all(Array.from({ length: 5 }, () => post(app, q.envelope, xp)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const bodies = await Promise.all(rs.map(json));
    expect(new Set(bodies.map((b) => b.signature)).size).toBe(1);
    expect(model.calls).toBe(1);
  });
});

describe("x402 — rejeu d'autorisation refusé", () => {
  it("le même X-PAYMENT ne paie qu'UNE requête ; la même requête rejouée reçoit la même réponse ; une 2e autorisation du même nonce, un nonce consommé on-chain : refusés", async () => {
    const { app, model, kit, chain, gw } = setup();
    const q = await makeRequest(kit, "première");
    const xp = await pay(q.nonce);
    const first = await json(await post(app, q.envelope, xp));

    // (a) même en-tête X-PAYMENT, AUTRE requête : le nonce n'engage pas cette requête
    const other2 = await makeRequest(kit, "seconde, gratuite ?");
    const r2 = await post(app, other2.envelope, xp);
    expect(r2.status).toBe(402);
    expect((await json(r2)).error).toBe("nonce_not_bound");

    // (b) même requête, même autorisation : la MÊME réponse (reprise idempotente), sans 2e appel ni 2e reçu
    const r3 = await post(app, q.envelope, xp);
    expect(r3.status).toBe(200);
    const again = await json(r3);
    expect(again.replay).toBe(true);
    expect(again.signature).toBe(first.signature);
    expect(again.receipt).toEqual(first.receipt);

    // (c) même requête, AUTRE autorisation (autre échéance) pour le même nonce : 409
    const r4 = await post(app, q.envelope, await pay(q.nonce, { validBefore: NOW + 800n }));
    expect(r4.status).toBe(409);
    expect((await json(r4)).code).toBe("nonce_reused");

    // (d) nonce déjà consommé on-chain (réglé, ou annulé par le payeur) : refusé sans appel au modèle
    const q5 = await makeRequest(kit, "x");
    chain.used.add(keyOf(payer.address, q5.nonce));
    const r5 = await post(app, q5.envelope, await pay(q5.nonce));
    expect(r5.status).toBe(402);
    expect((await json(r5)).error).toBe("authorization_used");

    // (e) un nonce quelconque (pas l'engagement de la requête) : refusé
    const q6 = await makeRequest(kit, "y");
    const r6 = await post(app, q6.envelope, await pay(("0x" + "11".repeat(32)) as Hex));
    expect((await json(r6)).error).toBe("nonce_not_bound");

    // (f) la reprise passe AVANT toute lecture de la chaîne : l'appel déjà servi est rendu même si l'enclave n'est plus
    //     payable entre-temps (inscription échue), et aucun nouvel appel n'est servi
    chain.operator = zeroAddress;
    const r7 = await post(app, q.envelope, xp);
    expect(r7.status).toBe(200);
    expect((await json(r7)).signature).toBe(first.signature);
    const q8 = await makeRequest(kit, "z");
    expect((await post(app, q8.envelope, await pay(q8.nonce))).status).toBe(503);

    expect(model.calls).toBe(1);
    expect(gw.pending().total).toBe(1);
  });
});

describe("x402 — montant faux et autres paiements invalides refusés", () => {
  it("montant ≠ prix d'un appel (moins, plus, zéro) : 402, sans appel au modèle", async () => {
    const { app, model, kit } = setup();
    for (const value of [PRICE - 1n, PRICE + 1n, 0n]) {
      const q = await makeRequest(kit);
      const res = await post(app, q.envelope, await pay(q.nonce, { value }));
      expect(res.status).toBe(402);
      const b = await json(res);
      expect(b.error).toBe("invalid_exact_evm_payload_authorization_value");
      expect(b.accepts[0].maxAmountRequired).toBe("10000");
    }
    expect(model.calls).toBe(0);
  });

  it("le prix on-chain change entre le 402 et le paiement : 402 avec le nouveau prix", async () => {
    const { app, model, kit, chain } = setup();
    const q = await makeRequest(kit);
    const xp = await pay(q.nonce); // signée au prix 10 000
    chain.product = { ...chain.product, price: 20_000n };
    const b = await json(await post(app, q.envelope, xp));
    expect(b.error).toBe("invalid_exact_evm_payload_authorization_value");
    expect(b.accepts[0].maxAmountRequired).toBe("20000");
    expect(model.calls).toBe(0);
  });

  it("payTo ≠ X402Settler, signataire ≠ from, signature malléable (s haut), échéance trop proche ou trop lointaine : 402", async () => {
    const { app, model, kit } = setup();
    const expectRefused = async (xp: string, code: string) => {
      const q = await makeRequestFor(xp);
      const res = await post(app, q, xp);
      expect(res.status, code).toBe(402);
      expect((await json(res)).error, code).toBe(code);
    };
    // chaque cas : une requête neuve dont le nonce est celui de l'autorisation fabriquée
    const reqs = new Map<string, unknown>();
    const makeRequestFor = async (xp: string) => reqs.get(xp)!;
    const make = async (f: (nonce: Hex) => Promise<string>) => {
      const q = await makeRequest(kit);
      const xp = await f(q.nonce);
      reqs.set(xp, q.envelope);
      return xp;
    };
    await expectRefused(await make((n) => pay(n, { to: "0x000000000000000000000000000000000000bEEF" })), "invalid_exact_evm_payload_recipient_mismatch");
    await expectRefused(
      await make(async (n) => {
        const p = decodeXPayment(await pay(n, { account: other }));
        p.payload.authorization.from = payer.address; // signée par un autre que le payeur annoncé
        return encodeXPayment(p);
      }),
      "invalid_exact_evm_payload_signature",
    );
    await expectRefused(
      await make(async (n) => {
        const p = decodeXPayment(await pay(n));
        p.payload.signature = malleate(p.payload.signature); // même signataire pour viem, refusée par l'USDC
        return encodeXPayment(p);
      }),
      "invalid_exact_evm_payload_signature",
    );
    await expectRefused(await make((n) => pay(n, { validBefore: NOW + 300n })), "invalid_exact_evm_payload_authorization_valid_before");
    await expectRefused(await make((n) => pay(n, { validBefore: NOW - 1n })), "invalid_exact_evm_payload_authorization_valid_before");
    await expectRefused(await make((n) => pay(n, { validBefore: NOW + 30n * 86_400n })), "authorization_validity_too_long");
    // en-tête illisible
    const q = await makeRequest(kit);
    const res = await post(app, q.envelope, "pas du base64 !");
    expect((await json(res)).error).toBe("invalid_payload");
    expect(model.calls).toBe(0);
  });

  it("le facilitateur v1 exige lui aussi le montant EXACT", async () => {
    const r = requirement();
    const p = decodeXPayment(await pay(("0x" + "7d".repeat(32)) as Hex, { value: PRICE + 1n }));
    expect(await facilitatorVerify(p, r, CHAIN, NOW)).toEqual({ ok: false, reason: "amount" });
  });
});

describe("x402 — protections de l'opérateur (avant tout appel au modèle)", () => {
  it("solde : les appels non réglés d'un payeur ne dépassent jamais son solde USDC", async () => {
    const { app, model, kit, chain } = setup();
    chain.defaultBalance = 2n * PRICE;
    for (let i = 0; i < 2; i++) {
      const q = await makeRequest(kit);
      expect((await post(app, q.envelope, await pay(q.nonce))).status).toBe(200);
    }
    const q = await makeRequest(kit);
    const res = await post(app, q.envelope, await pay(q.nonce));
    expect(res.status).toBe(402);
    expect((await json(res)).error).toBe("insufficient_funds");
    expect(model.calls).toBe(2);
  });

  it("des requêtes CONCURRENTES du même payeur ne passent pas sur le même solde (réservation sans attente après le dernier contrôle)", async () => {
    const { app, model, kit, chain } = setup();
    chain.defaultBalance = PRICE; // un seul appel couvert
    const reqs = await Promise.all(["a", "b", "c"].map((x) => makeRequest(kit, x)));
    const xs = await Promise.all(reqs.map((q) => pay(q.nonce)));
    const rs = await Promise.all(reqs.map((q, i) => post(app, q.envelope, xs[i])));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 402, 402]);
    expect(model.calls).toBe(1);
  });

  it("des requêtes qui attendent le MÊME rapprochement ne passent pas toutes sur la place qu'il libère", async () => {
    const { app, model, kit, chain } = setup();
    chain.capacity = 3n * PRICE;
    for (const x of ["1", "2", "3"]) {
      const q = await makeRequest(kit, x);
      expect((await post(app, q.envelope, await pay(q.nonce))).status).toBe(200);
    }
    chain.capacity = PRICE; // place pour UN appel de plus, une fois les impayés retirés de l'exposition
    chain.balances.set(payer.address.toLowerCase(), 0n); // le payeur vide son solde : ses 3 appels deviennent impayables
    chain.delayMs = 20; // lectures lentes : les deux requêtes attendent le même rapprochement
    const b = await makeRequest(kit, "b");
    const c = await makeRequest(kit, "c");
    const [xb, xc] = [await pay(b.nonce, { account: other }), await pay(c.nonce, { account: third })];
    const [rb, rc] = await Promise.all([post(app, b.envelope, xb), post(app, c.envelope, xc)]);
    expect([rb.status, rc.status].sort()).toEqual([200, 503]);
    expect(model.calls).toBe(4);
  });

  it("au plus MAX_PENDING_PER_PAYER appels non réglés par payeur (429) ; un payeur à code (contrat, EIP-7702) est refusé", async () => {
    const { app, model, kit, chain } = setup({ maxPendingPerPayer: 2 });
    for (let i = 0; i < 2; i++) {
      const q = await makeRequest(kit);
      expect((await post(app, q.envelope, await pay(q.nonce))).status).toBe(200);
    }
    const q = await makeRequest(kit);
    expect((await post(app, q.envelope, await pay(q.nonce))).status).toBe(429);
    // un autre payeur, mais avec du code
    chain.withCode.add(other.address.toLowerCase());
    const q2 = await makeRequest(kit);
    const res = await post(app, q2.envelope, await pay(q2.nonce, { account: other }));
    expect((await json(res)).error).toBe("payer_is_contract");
    expect(model.calls).toBe(2);
  });

  it("caution de l'opérateur épuisée (OperatorBond) : 503 sans appel au modèle", async () => {
    const { app, model, kit, chain } = setup();
    chain.capacity = PRICE; // de quoi régler UN appel
    const q1 = await makeRequest(kit);
    expect((await post(app, q1.envelope, await pay(q1.nonce))).status).toBe(200);
    const q2 = await makeRequest(kit);
    const res = await post(app, q2.envelope, await pay(q2.nonce));
    expect(res.status).toBe(503);
    expect((await json(res)).code).toBe("operator_capacity");
    expect(model.calls).toBe(1);
    expect(exposureCapacity({ availableBond: 3_000_000n, totalExposure: 1_000_000n, productExposure: 0n, cap: 0n, banned: false })).toBe(500_000n);
    expect(exposureCapacity({ availableBond: 3_000_000n, totalExposure: 0n, productExposure: 9_990_000n, cap: 10_000_000n, banned: false })).toBe(10_000n);
    expect(exposureCapacity({ availableBond: 3_000_000n, totalExposure: 0n, productExposure: 0n, cap: 0n, banned: true })).toBe(0n);
  });

  it("requête trop grande (413), enveloppe ou requête illisibles (400) : rien n'est facturé", async () => {
    const { app, model, kit } = setup({ maxRequestBytes: 256 });
    const big = await makeRequest(kit, "x".repeat(400));
    expect((await post(app, big.envelope, await pay(big.nonce))).status).toBe(413);
    const q = await makeRequest(kit);
    expect((await post(app, { ...q.envelope, enc: "0x1234" }, await pay(q.nonce))).status).toBe(400);
    // chiffrée vers une AUTRE clé : indéchiffrable par cette enclave
    const stranger = new EnclaveKit({ productId: PRODUCT, chainId: CHAIN, registry: REGISTRY, mockBlockHash: true });
    const sealed = await seal(toBytes(stranger.keys.x25519PublicKey), new TextEncoder().encode('{"messages":[{"role":"user","content":"a"}]}'));
    const env = { enc: toHex(sealed.enc), ciphertext: toHex(sealed.ciphertext), clientEphemeralPub: q.envelope.clientEphemeralPub };
    const n = callNonce({ chainId: CHAIN, settler: SETTLER, productId: PRODUCT, enclave: kit.keys.signer, ...env });
    expect((await json(await post(app, env, await pay(n)))).code).toBe("undecryptable");
    // JSON valide mais sans messages
    const sealed2 = await seal(toBytes(kit.keys.x25519PublicKey), new TextEncoder().encode('{"prompt":"a"}'));
    const env2 = { enc: toHex(sealed2.enc), ciphertext: toHex(sealed2.ciphertext), clientEphemeralPub: q.envelope.clientEphemeralPub };
    const n2 = callNonce({ chainId: CHAIN, settler: SETTLER, productId: PRODUCT, enclave: kit.keys.signer, ...env2 });
    expect((await json(await post(app, env2, await pay(n2)))).code).toBe("invalid_request");
    expect(model.calls).toBe(0);
  });
});

describe("x402 — file d'attente de l'opérateur", () => {
  it("GET /x402/pending rend les arguments de X402Settler.settle, les plus urgents d'abord ; POST /x402/settled ne sort que ce que la chaîne dit consommé ; les échus sortent", async () => {
    const st = setup();
    const { app, kit, chain, model, clock } = st;
    const a = await makeRequest(kit, "un");
    const xa = await pay(a.nonce);
    const b = await makeRequest(kit, "deux");
    const xb = await pay(b.nonce, { validBefore: NOW + 700n });
    const ra = await json(await post(app, a.envelope, xa));
    const rb = await json(await post(app, b.envelope, xb));

    const p1 = await json(await app.request("/x402/pending"));
    expect(p1).toMatchObject({ enclave: kit.keys.signer, productId: "3", chainId: CHAIN, settler: SETTLER, total: 2 });
    expect(p1.items[0]).toEqual({
      receipt: rb.receipt,
      signature: rb.signature,
      auth: { validAfter: "0", validBefore: String(NOW + 700n), nonce: b.nonce, signature: decodeXPayment(xb).payload.signature },
      amount: "10000",
      servedAt: Number(NOW),
      covered: true, // le solde du payeur (relu au relevé) couvre ses deux appels
    });
    expect(p1.items[1].receipt).toEqual(ra.receipt);
    // relever deux fois ne change rien (lecture sans effet)
    expect(await json(await app.request("/x402/pending"))).toEqual(p1);

    const ack = (items: Array<{ payer: Address; nonce: Hex }>) => signedAck(st, items).then(json);
    // signalé mais PAS réglé on-chain : il reste (rien n'est cru sur parole)
    expect(await ack([{ payer: payer.address, nonce: a.nonce }])).toEqual({ settled: [], pending: [keyOf(payer.address, a.nonce)], unknown: [] });
    expect((await json(await app.request("/x402/pending"))).total).toBe(2);
    // réglé on-chain : il sort
    chain.used.add(keyOf(payer.address, a.nonce));
    expect((await ack([{ payer: payer.address, nonce: a.nonce }, { payer: payer.address, nonce: ("0x" + "22".repeat(32)) as Hex }])).settled).toEqual([
      keyOf(payer.address, a.nonce),
    ]);
    const p2 = await json(await app.request("/x402/pending"));
    expect(p2.total).toBe(1);
    expect(p2.items[0].receipt.nonce).toBe(b.nonce);
    // le client qui rejoue après le règlement reçoit encore sa réponse, sans 2e appel
    const again = await json(await post(app, a.envelope, xa));
    expect(again.replay).toBe(true);
    expect(model.calls).toBe(2);
    // l'autorisation de b échoit : plus réglable, b sort de la file (perdu pour l'opérateur)
    clock.now = NOW + 700n;
    expect((await json(await app.request("/x402/pending"))).total).toBe(0);
    // un corps invalide
    expect((await app.request("/x402/settled", { method: "POST", body: "{}" })).status).toBe(400);
  });

  it("le solde réservé se libère quand l'appel est réglé", async () => {
    const st = setup();
    const { app, kit, chain } = st;
    chain.defaultBalance = PRICE; // un seul appel couvert à la fois
    const a = await makeRequest(kit);
    expect((await post(app, a.envelope, await pay(a.nonce))).status).toBe(200);
    const b = await makeRequest(kit);
    expect((await json(await post(app, b.envelope, await pay(b.nonce)))).error).toBe("insufficient_funds");
    chain.used.add(keyOf(payer.address, a.nonce)); // a est réglé (le solde on-chain serait 0 : on simule un rechargement)
    expect((await signedAck(st, [{ payer: payer.address, nonce: a.nonce }])).status).toBe(200);
    expect((await post(app, b.envelope, await pay(b.nonce))).status).toBe(200);
  });
});

describe("x402 — configuration, modèle amont et ABI", () => {
  it("la configuration exige les adresses de la pile (aucune par défaut) et valide les bornes", () => {
    const base = { PRODUCT_ID: "3", REGISTRY, X402SETTLER: SETTLER, USDC, OPERATOR_ALLOWLIST: OPERATOR };
    const c = readSealedX402Config(base);
    expect(c).toMatchObject({ productId: 3n, settler: SETTLER, registry: REGISTRY, usdc: USDC, network: "arc-testnet", port: 8804, maxOutputTokens: 1024, checkBalance: true });
    expect(c.operatorAllowlist).toEqual([OPERATOR]);
    for (const missing of ["PRODUCT_ID", "REGISTRY", "X402SETTLER", "USDC"] as const) {
      const env: Record<string, string | undefined> = { ...base };
      delete env[missing];
      expect(() => readSealedX402Config(env), missing).toThrow(missing);
    }
    expect(() => readSealedX402Config({ ...base, X402SETTLER: zeroAddress })).toThrow("X402SETTLER");
    expect(() => readSealedX402Config({ ...base, MAX_OUTPUT_TOKENS: "abc" })).toThrow("MAX_OUTPUT_TOKENS");
    expect(() => readSealedX402Config({ ...base, AUTH_VALIDITY_SECONDS: "600" })).toThrow("AUTH_VALIDITY_SECONDS");
    expect(readSealedX402Config({ ...base, OPERATOR_ALLOWLIST: undefined }).operatorAllowlist).toEqual([]); // échoue fermé
  });

  it("une erreur du modèle amont ne remonte jamais son corps (il peut recopier la clé)", async () => {
    const KEY = "rpk_super_secret_key_123";
    const m = createRedpillModel({
      baseUrl: "https://api.example/v1",
      model: "openai/gpt-oss-120b",
      apiKey: KEY,
      fetch: (async () => new Response(JSON.stringify({ error: `Invalid API key ${KEY}` }), { status: 401 })) as typeof fetch,
    });
    const err = (await m.complete({ messages: [{ role: "user", content: "a" }], maxTokens: 5 }, new AbortController().signal).catch((e) => e)) as Error;
    expect(err.message).toBe("upstream model: HTTP 401");
    expect(err.message).not.toContain(KEY);
  });

  it("les fragments d'ABI de l'enclave sont ceux des contrats (packages/sdk/src/abis.ts, généré depuis contracts/out)", () => {
    const shape = (abi: readonly unknown[], name: string) => {
      const f = (abi as AbiFunction[]).find((x) => x.type === "function" && x.name === name);
      if (!f) throw new Error(`${name} absent`);
      return `${f.name}(${f.inputs.map(formatType).join(",")}) ${f.stateMutability} -> (${f.outputs.map(formatType).join(",")})`;
    };
    const pairs: Array<[readonly unknown[], readonly unknown[], string]> = [
      [PRODUCT_REGISTRY_READ_ABI, productRegistryAbi, "getProduct"],
      [PRODUCT_REGISTRY_READ_ABI, productRegistryAbi, "isActive"],
      [ENCLAVE_REGISTRY_ACTIVE_ABI, enclaveRegistryAbi, "activeOperatorAt"],
      [OPERATOR_BOND_READ_ABI, operatorBondAbi, "availableBond"],
      [OPERATOR_BOND_READ_ABI, operatorBondAbi, "totalExposureOf"],
      [OPERATOR_BOND_READ_ABI, operatorBondAbi, "exposureOf"],
      [OPERATOR_BOND_READ_ABI, operatorBondAbi, "banned"],
      [X402_SETTLER_READ_ABI, x402Abi, "products"],
      [X402_SETTLER_READ_ABI, x402Abi, "enclaves"],
      [X402_SETTLER_READ_ABI, x402Abi, "bond"],
      [X402_SETTLER_READ_ABI, x402Abi, "usdc"],
    ];
    for (const [mine, theirs, name] of pairs) expect(shape(mine, name), name).toBe(shape(theirs, name));
  });
});

/** Type ABI complet (tuples développés), noms ignorés. */
function formatType(p: { type: string; components?: readonly any[] }): string {
  if (p.type.startsWith("tuple")) return `(${(p.components ?? []).map(formatType).join(",")})${p.type.slice(5)}`;
  return p.type;
}

/** La même signature ECDSA, rendue malléable (s → n − s, v basculé) : viem retrouve le même signataire, pas l'USDC. */
function malleate(sig: Hex): Hex {
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const r = sig.slice(2, 66);
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  const v = parseInt(sig.slice(130, 132), 16);
  return `0x${r}${(n - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}` as Hex;
}
