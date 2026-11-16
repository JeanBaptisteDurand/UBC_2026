/**
 * /attest v2 (fix 2) : liste blanche des opérateurs (OPERATOR_ALLOWLIST) et refus si la clé de
 * l'enclave est déjà inscrite on-chain pour un autre opérateur (lu par le quorum RPC du kit).
 */
import { describe, it, expect } from "vitest";
import {
  type Address,
  type Hex,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  hexToBigInt,
  keccak256,
  numberToHex,
  pad,
  zeroAddress,
} from "viem";

import { EnclaveKit, ENCLAVE_REGISTRY_READ_ABI } from "../src/kit/enclave-kit";
import { RpcQuorum, QuorumError } from "../src/kit/rpc-quorum";
import { buildReportData } from "../src/kit/binding";
import { createAttestServer, parseOperatorAllowlist } from "../src/server/attest-server";

const REG = "0x00000000000000000000000000000000000000c2" as Address;
const OP = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;

function mockKit(rpc?: RpcQuorum): EnclaveKit {
  return new EnclaveKit({ productId: 7n, chainId: 5042002, registry: REG, mockBlockHash: true, rpc });
}

async function attest(app: ReturnType<typeof createAttestServer>, operator: string, anchorR: unknown = "999") {
  return app.request("/attest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operator, anchorR }),
  });
}

/** Le REPORTDATA embarqué dans le quote mock (voir kit.test.ts). */
function embeddedReportData(quote: Hex): Hex {
  return ("0x" + quote.slice(2 + 24, 2 + 24 + 128)) as Hex;
}

describe("fix 2 — OPERATOR_ALLOWLIST", () => {
  it("définie : toute autre adresse est refusée (403) ; l'adresse permise obtient un quote lié à elle", async () => {
    const kit = mockKit();
    const warnings: string[] = [];
    const app = createAttestServer(kit, {
      operatorAllowlist: [OP],
      registeredOperator: async () => zeroAddress,
      warn: (m) => warnings.push(m),
    });

    const refused = await attest(app, OTHER);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toContain("non autorisé");

    const res = await attest(app, OP.toLowerCase()); // la casse ne compte pas
    expect(res.status).toBe(200);
    const out = (await res.json()) as { quote: Hex; signer: Address; mock: boolean };
    expect(out.signer).toBe(kit.keys.signer);
    const expected = buildReportData(
      { chainId: 5042002n, registry: REG, productId: 7n, operator: OP, signer: kit.keys.signer, x25519: kit.keys.x25519PublicKey },
      keccak256(pad(numberToHex(999n), { size: 32 })),
    );
    expect(embeddedReportData(out.quote).toLowerCase()).toBe(expected.toLowerCase());
    expect(warnings).toEqual([]); // rien à signaler en mode strict
  });

  it("OPERATOR_ALLOWLIST=* : mode développement EXPLICITE, quote pour n'importe quelle adresse, avec avertissement", async () => {
    const warnings: string[] = [];
    const app = createAttestServer(mockKit(), {
      operatorAllowlist: parseOperatorAllowlist("*"),
      registeredOperator: async () => zeroAddress,
      warn: (m) => warnings.push(m),
    });
    expect(warnings.some((w) => w.includes("OPERATOR_ALLOWLIST=*"))).toBe(true); // au démarrage
    expect((await attest(app, OTHER)).status).toBe(200);
    expect(warnings.some((w) => w.includes("mode développement") && w.includes(OTHER))).toBe(true); // à chaque /attest
  });

  it("lecture de la variable (v2 bis, échoue fermé) : absente ou vide => personne ; * => développement ; adresse invalide => arrêt", async () => {
    expect(parseOperatorAllowlist(undefined)).toEqual([]);
    expect(parseOperatorAllowlist("")).toEqual([]);
    expect(parseOperatorAllowlist("*")).toBeNull();
    expect(parseOperatorAllowlist(" * ")).toBeNull();
    expect(parseOperatorAllowlist(` ${OP.toLowerCase()} ,${OTHER},`)).toEqual([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ]);
    expect(() => parseOperatorAllowlist("0x1234")).toThrow(/OPERATOR_ALLOWLIST/);

    const app = createAttestServer(mockKit(), { operatorAllowlist: parseOperatorAllowlist(""), registeredOperator: async () => zeroAddress, warn: () => {} });
    expect((await attest(app, OP)).status).toBe(403); // définie mais vide : on échoue fermé
    const absent = createAttestServer(mockKit(), { operatorAllowlist: parseOperatorAllowlist(undefined), registeredOperator: async () => zeroAddress, warn: () => {} });
    expect((await attest(absent, OP)).status).toBe(403); // absente : on échoue fermé aussi (v2 bis)
  });

  it("entrées invalides => 400", async () => {
    const app = createAttestServer(mockKit(), { operatorAllowlist: null, registeredOperator: async () => zeroAddress, warn: () => {} });
    expect((await attest(app, "pas-une-adresse")).status).toBe(400);
    expect((await attest(app, OP, "-1")).status).toBe(400);
    expect((await attest(app, OP, "douze")).status).toBe(400);
  });
});

describe("fix 2 — clé déjà inscrite on-chain pour un autre opérateur", () => {
  it("inscrite pour un AUTRE opérateur : refus (409) ; pour le même : permis (réattestation)", async () => {
    const app = createAttestServer(mockKit(), { operatorAllowlist: null, registeredOperator: async () => OP, warn: () => {} });
    const refused = await attest(app, OTHER);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { registeredOperator: Address }).registeredOperator).toBe(OP);
    expect((await attest(app, OP)).status).toBe(200);
  });

  it("lecture on-chain impossible : refus (503), on échoue fermé", async () => {
    const app = createAttestServer(mockKit(), {
      operatorAllowlist: [OP],
      registeredOperator: async () => {
        throw new QuorumError("désaccord entre fournisseurs RPC");
      },
      warn: () => {},
    });
    expect((await attest(app, OP)).status).toBe(503);
  });

  /** Faux fournisseur RPC : tête donnée, réponse d'enclaveOf donnée ; note le bloc de chaque eth_call. */
  function fakeProvider(head: bigint, operatorOf: (signer: Address) => Address, seenBlocks: bigint[]) {
    return custom(
      {
        async request({ method, params }: { method: string; params?: any }) {
          if (method === "eth_blockNumber") return numberToHex(head);
          if (method === "eth_call") {
            const [{ to, data }, block] = params;
            expect(to.toLowerCase()).toBe(REG.toLowerCase());
            seenBlocks.push(hexToBigInt(block));
            const { functionName, args } = decodeFunctionData({ abi: ENCLAVE_REGISTRY_READ_ABI, data });
            expect(functionName).toBe("enclaveOf");
            const signer = args[0] as Address;
            const operator = operatorOf(signer);
            return encodeFunctionResult({
              abi: ENCLAVE_REGISTRY_READ_ABI,
              functionName: "enclaveOf",
              result: {
                signer: operator === zeroAddress ? zeroAddress : signer,
                x25519: pad("0x00", { size: 32 }), productId: 7n, operator,
                workloadId: pad("0x00", { size: 32 }), fmspc: "0x000000000000", tcbStatus: 0,
                quoteHash: pad("0x00", { size: 32 }), anchorBlock: 0n, registeredAt: 0n, expiresAt: 0n, active: operator !== zeroAddress,
              },
            });
          }
          throw new Error(`méthode inattendue ${method}`);
        },
      },
      { retryCount: 0 },
    );
  }

  it("lu par le quorum RPC du kit : enclaveOf(signer) AU MÊME BLOC (la tête commune) chez tous les fournisseurs", async () => {
    const seen: bigint[] = [];
    const rpc = new RpcQuorum([fakeProvider(120n, () => OP, seen), fakeProvider(118n, () => OP, seen)]);
    const kit = mockKit(rpc);
    expect(await kit.registeredOperator()).toBe(OP);
    expect(seen).toEqual([118n, 118n]); // les deux lectures au bloc 118 = min(120, 118)

    // chemin complet, sans injection : le serveur interroge le kit
    const app = createAttestServer(kit, { operatorAllowlist: null, warn: () => {} });
    expect((await attest(app, OTHER)).status).toBe(409);
    expect((await attest(app, OP)).status).toBe(200);
  });

  it("clé pas encore inscrite (operator = 0) : quote permis ; fournisseurs en désaccord : 503", async () => {
    const kitFree = mockKit(new RpcQuorum([fakeProvider(50n, () => zeroAddress, []), fakeProvider(50n, () => zeroAddress, [])]));
    expect(await kitFree.registeredOperator()).toBe(zeroAddress);
    expect((await attest(createAttestServer(kitFree, { operatorAllowlist: [OP], warn: () => {} }), OP)).status).toBe(200);

    const kitLied = mockKit(new RpcQuorum([fakeProvider(50n, () => OP, []), fakeProvider(50n, () => OTHER, [])]));
    await expect(kitLied.registeredOperator()).rejects.toBeInstanceOf(QuorumError);
    expect((await attest(createAttestServer(kitLied, { operatorAllowlist: [OP], warn: () => {} }), OP)).status).toBe(503);
  });

  it("sans RPC (développement local) : vérification on-chain impossible, quote permis avec avertissement", async () => {
    const warnings: string[] = [];
    const app = createAttestServer(mockKit(), { operatorAllowlist: [OP], warn: (m) => warnings.push(m) });
    expect((await attest(app, OP)).status).toBe(200);
    expect(warnings.some((w) => w.includes("sans RPC"))).toBe(true);
  });
});
