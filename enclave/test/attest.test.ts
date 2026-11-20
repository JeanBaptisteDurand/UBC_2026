/**
 * /attest: the operator allowlist (OPERATOR_ALLOWLIST), and a refusal when the enclave's key is already
 * registered on-chain for another operator (read through the kit's RPC quorum).
 * The server's messages are matched as the enclave image prints them.
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

/** The REPORTDATA embedded in the mock quote (see kit.test.ts). */
function embeddedReportData(quote: Hex): Hex {
  return ("0x" + quote.slice(2 + 24, 2 + 24 + 128)) as Hex;
}

describe("OPERATOR_ALLOWLIST", () => {
  it("set: any other address is refused (403); the allowed address gets a quote bound to it", async () => {
    const kit = mockKit();
    const warnings: string[] = [];
    const app = createAttestServer(kit, {
      operatorAllowlist: [OP],
      registeredOperator: async () => zeroAddress,
      warn: (m) => warnings.push(m),
    });

    const refused = await attest(app, OTHER);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toContain("not authorized");

    const res = await attest(app, OP.toLowerCase()); // case does not matter
    expect(res.status).toBe(200);
    const out = (await res.json()) as { quote: Hex; signer: Address; mock: boolean };
    expect(out.signer).toBe(kit.keys.signer);
    const expected = buildReportData(
      { chainId: 5042002n, registry: REG, productId: 7n, operator: OP, signer: kit.keys.signer, x25519: kit.keys.x25519PublicKey },
      keccak256(pad(numberToHex(999n), { size: 32 })),
    );
    expect(embeddedReportData(out.quote).toLowerCase()).toBe(expected.toLowerCase());
    expect(warnings).toEqual([]); // nothing to report in strict mode
  });

  it("OPERATOR_ALLOWLIST=*: explicit development mode, a quote for any address, with a warning", async () => {
    const warnings: string[] = [];
    const app = createAttestServer(mockKit(), {
      operatorAllowlist: parseOperatorAllowlist("*"),
      registeredOperator: async () => zeroAddress,
      warn: (m) => warnings.push(m),
    });
    expect(warnings.some((w) => w.includes("OPERATOR_ALLOWLIST=*"))).toBe(true); // at start-up
    expect((await attest(app, OTHER)).status).toBe(200);
    expect(warnings.some((w) => w.includes("development mode") && w.includes(OTHER))).toBe(true); // on every /attest
  });

  it("reading the variable (fails closed): unset or empty => nobody; * => development; invalid address => stop", async () => {
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
    expect((await attest(app, OP)).status).toBe(403); // set but empty: fails closed
    const absent = createAttestServer(mockKit(), { operatorAllowlist: parseOperatorAllowlist(undefined), registeredOperator: async () => zeroAddress, warn: () => {} });
    expect((await attest(absent, OP)).status).toBe(403); // unset: fails closed too
  });

  it("invalid inputs => 400", async () => {
    const app = createAttestServer(mockKit(), { operatorAllowlist: null, registeredOperator: async () => zeroAddress, warn: () => {} });
    expect((await attest(app, "pas-une-adresse")).status).toBe(400);
    expect((await attest(app, OP, "-1")).status).toBe(400);
    expect((await attest(app, OP, "douze")).status).toBe(400);
  });
});

describe("key already registered on-chain for another operator", () => {
  it("registered for another operator: refused (409); for the same one: allowed (re-attestation)", async () => {
    const app = createAttestServer(mockKit(), { operatorAllowlist: null, registeredOperator: async () => OP, warn: () => {} });
    const refused = await attest(app, OTHER);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { registeredOperator: Address }).registeredOperator).toBe(OP);
    expect((await attest(app, OP)).status).toBe(200);
  });

  it("on-chain read impossible: refused (503), fails closed", async () => {
    const app = createAttestServer(mockKit(), {
      operatorAllowlist: [OP],
      registeredOperator: async () => {
        throw new QuorumError("RPC providers disagree");
      },
      warn: () => {},
    });
    expect((await attest(app, OP)).status).toBe(503);
  });

  /** Fake RPC provider: given head, given enclaveOf answer; records the block of each eth_call. */
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
          throw new Error(`unexpected method ${method}`);
        },
      },
      { retryCount: 0 },
    );
  }

  it("read through the kit's RPC quorum: enclaveOf(signer) at the same block (the common head) from every provider", async () => {
    const seen: bigint[] = [];
    const rpc = new RpcQuorum([fakeProvider(120n, () => OP, seen), fakeProvider(118n, () => OP, seen)]);
    const kit = mockKit(rpc);
    expect(await kit.registeredOperator()).toBe(OP);
    expect(seen).toEqual([118n, 118n]); // both reads at block 118 = min(120, 118)

    // full path, no injection: the server queries the kit
    const app = createAttestServer(kit, { operatorAllowlist: null, warn: () => {} });
    expect((await attest(app, OTHER)).status).toBe(409);
    expect((await attest(app, OP)).status).toBe(200);
  });

  it("key not registered yet (operator = 0): quote allowed; providers disagree: 503", async () => {
    const kitFree = mockKit(new RpcQuorum([fakeProvider(50n, () => zeroAddress, []), fakeProvider(50n, () => zeroAddress, [])]));
    expect(await kitFree.registeredOperator()).toBe(zeroAddress);
    expect((await attest(createAttestServer(kitFree, { operatorAllowlist: [OP], warn: () => {} }), OP)).status).toBe(200);

    const kitLied = mockKit(new RpcQuorum([fakeProvider(50n, () => OP, []), fakeProvider(50n, () => OTHER, [])]));
    await expect(kitLied.registeredOperator()).rejects.toBeInstanceOf(QuorumError);
    expect((await attest(createAttestServer(kitLied, { operatorAllowlist: [OP], warn: () => {} }), OP)).status).toBe(503);
  });

  it("no RPC (local development): on-chain check impossible, quote allowed with a warning", async () => {
    const warnings: string[] = [];
    const app = createAttestServer(mockKit(), { operatorAllowlist: [OP], warn: (m) => warnings.push(m) });
    expect((await attest(app, OP)).status).toBe(200);
    expect(warnings.some((w) => w.includes("without RPC"))).toBe(true);
  });
});
