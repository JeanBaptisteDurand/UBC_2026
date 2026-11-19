/**
 * Revue ADVERSE de l'enclave v2 (7/11/2026), cas corrigés (v2 bis). Chaque « FIXED v2 » (même convention que les
 * `test_FIXED_*` des contrats) rejoue le
 * MÊME scénario et prouve qu'il ne passe plus. Paramètres mainnet de F-economie-mainnet-2026-11-07 : UNIT_TOKENS=1000,
 * OUT_WEIGHT=4, prix 200 unités de base par unité.
 */
import { describe, it, expect } from "vitest";
import { type Address, type Hex, keccak256, numberToHex, toBytes, toHex } from "viem";

import { EnclaveKit } from "../src/kit/enclave-kit";
import { seal } from "../src/kit/hpke";
import { generateEnclaveKeys } from "../src/kit/keys";
import { createAttestServer } from "../src/server/attest-server";
import {
  InferenceGateway,
  GatewayError,
  type BlockSource,
  type GatewayConfig,
  type InferenceOk,
  type LlamaClient,
  type SessionReader,
  type SessionView,
} from "../src/services/inference";
import { predicateHash, type EvalContext, type Predicate } from "../src/services/predicate";
import {
  BountyService,
  DeterministicProtocolCipher,
  exploitFingerprint,
  type BountyReader,
  type BountyView,
  type ExploitBundle,
  type ForkRunner,
  type SubmitResult,
} from "../src/services/bounty";
import { exploitFingerprint as anvilExploitFingerprint } from "../src/services/anvil-fork";

const CHAIN = 5042002;
const SESSIONPAY = "0x00000000000000000000000000000000000000aa" as Address;
const SEALED = "0x00000000000000000000000000000000000000bb" as Address;
const REGISTRY = "0x0000000000000000000000000000000000000001" as Address;
const MODEL = ("0x" + "6a".repeat(32)) as Hex;
const MY_PRODUCT = 1n; // PRODUCT_ID de cette enclave d'inférence (kit)
const MY_OPERATOR = "0x0000000000000000000000000000000000000002" as Address;

function chatKit(): EnclaveKit {
  return new EnclaveKit({ productId: MY_PRODUCT, chainId: CHAIN, registry: REGISTRY, mockBlockHash: true });
}

/** Session LIÉE à l'enclave `kit` (v2 bis), de l'opérateur de cette enclave, échéance lointaine. */
function session(kit: EnclaveKit, over: Partial<SessionView> = {}): SessionView {
  return {
    owner: "0x0000000000000000000000000000000000000011",
    productId: MY_PRODUCT,
    operator: MY_OPERATOR,
    sessionKey: "0x0000000000000000000000000000000000000003",
    deposit: 10_000_000n, // 10 USDC
    price: 200n, // F §0.2
    paidUnits: 0n,
    expiresAt: 4_000_000_000n, // an 2096
    closed: false,
    enclave: kit.keys.signer,
    param: MODEL,
    unitTokens: 1000n,
    outWeight: 4n,
    ...over,
  };
}

class Reader implements SessionReader {
  constructor(public s: SessionView) {}
  async getSession(): Promise<SessionView> {
    return { ...this.s };
  }
}

const blocks: BlockSource = { current: async () => 1000n };
const NOW_S = 1_800_000_000n; // horloge des tests (2027)

/** Modèle factice : requête type de F §2.2 (40 000 jetons lus, 2 000 écrits) ; compte les appels payés à l'amont. */
class TypicalLlama implements LlamaClient {
  calls = 0;
  async infer(prompt: string) {
    this.calls++;
    return { text: `réponse à ${prompt}`, tokensIn: 40_000, tokensOut: 2_000 };
  }
}

/** Passerelle de l'enclave `kit`, opérée par MY_OPERATOR (OPERATOR_ALLOWLIST), UNIT_TOKENS=1000, OUT_WEIGHT=4. */
function gateway(kit: EnclaveKit, reader: SessionReader, llama: LlamaClient, over: Partial<GatewayConfig> = {}): InferenceGateway {
  return new InferenceGateway(
    kit,
    { sessionPay: SESSIONPAY, modelHash: MODEL, unitTokens: 1000n, outWeight: 4n, operators: [MY_OPERATOR], now: () => NOW_S, ...over },
    reader,
    llama,
    blocks,
  );
}

/** Code HTTP du résultat : 200 / 402, ou le code d'une GatewayError, ou −1 pour toute autre erreur. */
async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    return ((await p) as { status: number }).status;
  } catch (e) {
    return e instanceof GatewayError ? e.httpStatus : -1;
  }
}

describe("adverse v2 — passerelle d'inférence : qui sert-elle, et qui paie ? (corrigé)", () => {
  it("FIXED v2 : une session d'un AUTRE produit, ou au prix 0, est refusée (403) sans appel au modèle", async () => {
    const kit = chatKit();
    const llama = new TypicalLlama();
    // la Prime scellée de F §0.2 (produit 2, prix 0) ; côté contrat, SessionPay ne l'ouvre plus (ZeroPrice)
    const other = gateway(kit, new Reader(session(kit, { productId: 2n, price: 0n, deposit: 1n })), llama);
    expect(await statusOf(other.handle(1n, 1n, "requête type", {}))).toBe(403);
    const free = gateway(kit, new Reader(session(kit, { price: 0n, deposit: 1n })), llama);
    expect(await statusOf(free.handle(1n, 1n, "requête type", {}))).toBe(403);
    expect(llama.calls, "l'opérateur ne paie plus le modèle pour une session qui ne le paiera jamais").toBe(0);
  });

  it("FIXED v2 : une session d'un autre opérateur, ou liée à une autre enclave, est refusée (403) sans appel au modèle", async () => {
    const kit = chatKit();
    const llama = new TypicalLlama();
    const stranger = "0x000000000000000000000000000000000000dEaD" as Address; // aucune caution, aucune enclave
    const gw = gateway(kit, new Reader(session(kit, { operator: stranger })), llama);
    const err = await gw.handle(1n, 1n, "requête type", {}).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).httpStatus).toBe(403);
    expect((err as GatewayError).message).toContain("WrongOperator");

    const elsewhere = gateway(kit, new Reader(session(kit, { enclave: "0x000000000000000000000000000000000000bEEF" })), llama);
    const err2 = await elsewhere.handle(1n, 1n, "requête type", {}).catch((e) => e);
    expect((err2 as GatewayError).httpStatus).toBe(403);
    expect((err2 as GatewayError).message).toContain("WrongEnclave");
    expect(llama.calls).toBe(0);
  });

  it("FIXED v2 (haute) : une session échue, ou à moins d'une minute de son échéance, n'est plus servie (410)", async () => {
    const kit = chatKit();
    const llama = new TypicalLlama();
    const expired = gateway(kit, new Reader(session(kit, { expiresAt: 1n })), llama); // échue en 1970
    expect(await statusOf(expired.handle(1n, 1n, "requête type", {}))).toBe(410);
    const almost = gateway(kit, new Reader(session(kit, { expiresAt: NOW_S + 30n })), llama);
    expect(await statusOf(almost.handle(1n, 1n, "requête type", {}))).toBe(410);
    expect(llama.calls).toBe(0);
    const fine = gateway(kit, new Reader(session(kit, { expiresAt: NOW_S + 3600n })), llama);
    expect(await statusOf(fine.handle(1n, 1n, "requête type", {}))).toBe(200);
  });

  it("FIXED v2 (moyenne) : un 402 constaté APRÈS le modèle garde la réponse — 20 rejeux = 1 seul appel ; rechargée, la même requête la reçoit", async () => {
    // il reste exactement 1 unité payable (dépôt 200, prix 200) ; chaque requête en coûte 48
    const kit = chatKit();
    const llama = new TypicalLlama();
    const reader = new Reader(session(kit, { deposit: 200n }));
    const gw = gateway(kit, reader, llama);
    for (let i = 0; i < 20; i++) expect(await statusOf(gw.handle(1n, 1n, "longue invite", {}))).toBe(402);
    expect(llama.calls, "un seul appel au modèle, jamais rejoué aux frais de l'opérateur").toBe(1);
    const r = await gw.handle(1n, 2n, "autre chose", {});
    expect(r.status).toBe(402); // toute requête de la session attend que le solde couvre la réponse gardée
    if (r.status === 402) expect(r.pending).toEqual({ seq: 1n, cost: 48n * 200n });
    expect(gw.lastReceipt(1n), "rien n'est signé tant que la réponse n'est pas couverte").toBeUndefined();

    reader.s.deposit = 10_000_000n; // la propriétaire recharge (SessionPay.topUp)
    expect(await statusOf(gw.handle(1n, 1n, "une autre invite", {}))).toBe(409); // seule la MÊME requête
    const served = (await gw.handle(1n, 1n, "longue invite", {})) as InferenceOk;
    expect(served.status).toBe(200);
    expect(served.text).toBe("réponse à longue invite");
    expect(served.receipt.cumulativeUnits).toBe(48n);
    expect(llama.calls, "la réponse gardée est livrée sans 2e appel au modèle").toBe(1);
  });

  it("FIXED v2 (haute) : deux enclaves du même opérateur — seule celle de la session la sert, l'autre refuse (403)", async () => {
    const kitA = chatKit();
    const kitB = chatKit();
    const reader = new Reader(session(kitA)); // la session est liée à l'enclave A
    const llamaB = new TypicalLlama();
    const a = gateway(kitA, reader, new TypicalLlama());
    const b = gateway(kitB, reader, llamaB);
    const ra = (await a.handle(1n, 1n, "question 1", {})) as InferenceOk;
    expect(ra.status).toBe(200);
    expect(ra.receipt.cumulativeUnits).toBe(48n);
    expect(await statusOf(b.handle(1n, 1n, "question 2", {})), "la 2e enclave ne sert plus une session qui ne la paiera pas").toBe(403);
    expect(llamaB.calls).toBe(0);
  });
});

describe("adverse v2 — /attest échoue FERMÉ par défaut (corrigé)", () => {
  it("FIXED v2 (moyenne) : sans la ligne OPERATOR_ALLOWLIST dans le compose, /attest refuse tout le monde (403) ; * = développement explicite", async () => {
    const saved = process.env.OPERATOR_ALLOWLIST;
    delete process.env.OPERATOR_ALLOWLIST;
    try {
      const kit = chatKit();
      const app = createAttestServer(kit, { registeredOperator: async () => null, warn: () => {} });
      const res = await app.request("/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operator: "0x000000000000000000000000000000000000bEEF", anchorR: "999" }),
      });
      expect(res.status, "un tiers n'obtient plus de quote à SON nom pour la clé de cette enclave").toBe(403);

      process.env.OPERATOR_ALLOWLIST = "*";
      const dev = createAttestServer(chatKit(), { registeredOperator: async () => null, warn: () => {} });
      const ok = await dev.request("/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operator: "0x000000000000000000000000000000000000bEEF", anchorR: "999" }),
      });
      expect(ok.status).toBe(200);
    } finally {
      if (saved !== undefined) process.env.OPERATOR_ALLOWLIST = saved;
      else delete process.env.OPERATOR_ALLOWLIST;
    }
  });
});

// ------------------------------------------------------------------------- Prime scellée

const TOKEN = "0x0000000000000000000000000000000000000010" as Address;
const HOLDER = "0x0000000000000000000000000000000000000011" as Address;
const HUNTER = "0x0000000000000000000000000000000000000012" as Address;
const NOW = 1_000_000n;
const pred: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: TOKEN, holder: HOLDER, min: "10000000" }] };
const protocol = generateEnclaveKeys();
const bounty: BountyView = {
  predicateHash: predicateHash(pred),
  protocolX25519: protocol.x25519PublicKey,
  tierMinLoss: [10_000_000n], // F §0.3 : perte ≥ 10 USDC → 5 USDC
  deadline: 9_000_000n,
};
const bountyReader: BountyReader = { getBounty: async () => bounty };

/** Rejeu déterministe ; rend l'ANCIENNE empreinte (keccak256 du JSON des txs), que le service v2 bis ignore. */
const fork: ForkRunner = {
  async run({ bundle }) {
    const ctx: EvalContext = {
      erc20Drop: () => 20_000_000n,
      nativeDrop: () => 0n,
      attackerProfit: () => 0n,
      viewValue: () => 0n,
      invariantHeld: () => true,
    };
    const fingerprint = keccak256(toHex(new TextEncoder().encode(JSON.stringify(bundle.txs)))) as Hex;
    return { ctx, fingerprint };
  },
};

function bountyEnclave() {
  const kit = new EnclaveKit({ productId: 2n, chainId: CHAIN, registry: REGISTRY, mockBlockHash: true });
  const blk = { current: async () => 2000n, blockHash: async (n: bigint) => keccak256(numberToHex(n, { size: 32 })) };
  const service = new BountyService(kit, { sealedBounty: SEALED }, bountyReader, new DeterministicProtocolCipher(), fork, blk, () => NOW);
  return { kit, service };
}

async function bundleFor(kit: EnclaveKit, txs: Hex[]) {
  const base: ExploitBundle = {
    bountyId: 1n,
    payee: HUNTER,
    capital: 1_000_000_000n,
    predicate: pred,
    txs,
    r: ("0x" + "22".repeat(32)) as Hex,
    cP: "0x",
  };
  const cP = await new DeterministicProtocolCipher().recompute(base, protocol.x25519PublicKey);
  const plain = { bountyId: "1", payee: HUNTER, capital: base.capital.toString(), predicate: pred, txs, r: base.r, cP };
  return seal(toBytes(kit.keys.x25519PublicKey), new TextEncoder().encode(JSON.stringify(plain)));
}

describe("adverse v2 — Prime scellée : un exploit, combien de paiements ? (corrigé)", () => {
  it("FIXED v2 (haute) : le MÊME exploit en hexadécimal majuscule a la MÊME empreinte — pas de 2e réclamation signée", async () => {
    const { kit, service } = bountyEnclave();
    const first: SubmitResult = await service.submit(await bundleFor(kit, ["0xa9059cbb"]));
    expect(first.status).toBe("proven");
    const second: SubmitResult = await service.submit(await bundleFor(kit, ["0xA9059CBB"])); // mêmes octets
    expect(second.status, "même empreinte : l'enclave ne signe pas une 2e réclamation (et SealedBounty ne paierait pas)").toBe("not_proven");

    // l'empreinte est celle des OCTETS, calculée par le service (le rejeu de test rend une empreinte JSON, ignorée)
    if (first.status === "proven") {
      expect(first.claim.fingerprint).toBe(exploitFingerprint({ txs: ["0xA9059CBB"] }));
      expect(first.claim.fingerprint).not.toBe(keccak256(toHex(new TextEncoder().encode(JSON.stringify(["0xa9059cbb"])))));
    }
    // même formule que le rejeu réel (src/services/anvil-fork.ts)
    for (const b of [{ txs: ["0xa9059cbb", "0x"] as Hex[] }, { txs: ["0xDEADbeef"] as Hex[], attackCode: "0x6000" as Hex }]) {
      expect(exploitFingerprint(b)).toBe(anvilExploitFingerprint(b));
    }
    // un exploit DIFFÉRENT garde une empreinte différente
    expect(exploitFingerprint({ txs: ["0xa9059cbc"] })).not.toBe(exploitFingerprint({ txs: ["0xa9059cbb"] }));
  });

  it("v2 bis : des transactions qui ne sont pas de l'hexadécimal pair sont refusées (empreinte sans ambiguïté)", async () => {
    const { kit, service } = bountyEnclave();
    const res = await service.submit(await bundleFor(kit, ["0xabc" as Hex]));
    expect(res.status).toBe("not_proven");
    if (res.status === "not_proven") expect(res.reason).toContain("hexadécimal pair");
  });
});
