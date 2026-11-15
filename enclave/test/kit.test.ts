import { describe, it, expect } from "vitest";
import {
  type Hex,
  type Address,
  keccak256,
  toBytes,
  encodeAbiParameters,
  concat,
  hashTypedData,
  pad,
  numberToHex,
} from "viem";

import { computeReportData0, computeWorkloadId, buildReportData } from "../src/kit/binding";
import { generateEnclaveKeys } from "../src/kit/keys";
import { seal, open } from "../src/kit/hpke";
import {
  receiptTypes,
  claimTypes,
  domain,
  signReceipt,
  recoverReceiptSigner,
  signClaim,
  recoverClaimSigner,
  type Receipt,
  type Claim,
} from "../src/kit/eip712";
import { EnclaveKit } from "../src/kit/enclave-kit";
import { getQuoteMock } from "../src/kit/quote";

function rep(byteHex: string, n: number): Hex {
  return ("0x" + byteHex.repeat(n)) as Hex;
}

// --- vérité-terrain calculée avec `cast` (Foundry 1.4.1), l'encodeur ABI de Solidity ---
const REG = "0x0000000000000000000000000000000000000001" as Address;
const OP = "0x0000000000000000000000000000000000000002" as Address;
const SG = "0x0000000000000000000000000000000000000003" as Address;
const X = rep("11", 32);
const RD0_GROUND = "0xcc91a62ef1a78b7d2dc3dcf5943e0074e60aa1bc0a1db24745c835b9093bcd15";
const WL_GROUND = "0x2c536fc29eaa072a966d04b88d837cf9671844ca034e25a4a1377d1556f4cbcc";

describe("binding (cross-langage avec Solidity)", () => {
  it("REPORTDATA[0:32] == vérité-terrain cast", () => {
    const rd0 = computeReportData0({
      chainId: 5042002n,
      registry: REG,
      productId: 1n,
      operator: OP,
      signer: SG,
      x25519: X,
    });
    expect(rd0.toLowerCase()).toBe(RD0_GROUND);
  });

  it("workloadId == vérité-terrain cast", () => {
    const wl = computeWorkloadId({
      mrtd: rep("aa", 48),
      rtmr0: rep("b0", 48),
      rtmr1: rep("b1", 48),
      rtmr2: rep("b2", 48),
      rtmr3: rep("b3", 48),
      mrConfigId: rep("cc", 48),
      xfam: "0x000000000000000e",
      tdAttributes: "0x0000000000000000",
    });
    expect(wl.toLowerCase()).toBe(WL_GROUND);
  });
});

describe("eip712 (le digest du kit == la méthode des contrats)", () => {
  const dom = { chainId: 5042002, verifyingContract: "0x00000000000000000000000000000000000000AA" as Address };
  const receipt: Receipt = {
    productId: 1n,
    sessionId: 7n,
    seq: 3n,
    modelHash: rep("a1", 32),
    paramsHash: rep("a2", 32),
    requestHash: rep("a3", 32),
    responseHash: rep("a4", 32),
    tokensIn: 10n,
    tokensOut: 20n,
    cumulativeUnits: 100n,
    anchorBlock: 999n,
  };

  it("hashTypedData == keccak(0x1901 ‖ domainSeparator ‖ structHash) à la Solidity", () => {
    const DOMAIN_TYPEHASH = keccak256(
      toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
    );
    const domainSeparator = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [
          DOMAIN_TYPEHASH,
          keccak256(toBytes("ArcEnclaveNetwork")),
          keccak256(toBytes("1")),
          BigInt(dom.chainId),
          dom.verifyingContract,
        ],
      ),
    );
    const RECEIPT_TYPEHASH = keccak256(
      toBytes(
        "Receipt(uint256 productId,uint256 sessionId,uint64 seq,bytes32 modelHash,bytes32 paramsHash,bytes32 requestHash,bytes32 responseHash,uint64 tokensIn,uint64 tokensOut,uint128 cumulativeUnits,uint64 anchorBlock)",
      ),
    );
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint64" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint64" },
          { type: "uint64" },
          { type: "uint128" },
          { type: "uint64" },
        ],
        [
          RECEIPT_TYPEHASH,
          receipt.productId,
          receipt.sessionId,
          receipt.seq,
          receipt.modelHash,
          receipt.paramsHash,
          receipt.requestHash,
          receipt.responseHash,
          receipt.tokensIn,
          receipt.tokensOut,
          receipt.cumulativeUnits,
          receipt.anchorBlock,
        ],
      ),
    );
    const manual = keccak256(concat(["0x1901", domainSeparator, structHash]));
    const viemDigest = hashTypedData({ domain: domain(dom), types: receiptTypes, primaryType: "Receipt", message: receipt });
    expect(viemDigest).toBe(manual);
  });

  it("signe et recouvre un reçu", async () => {
    const keys = generateEnclaveKeys();
    const sig = await signReceipt(keys.signerPrivateKey, dom, receipt);
    const rec = await recoverReceiptSigner(dom, receipt, sig);
    expect(rec.toLowerCase()).toBe(keys.signer.toLowerCase());
  });

  it("signe et recouvre une réclamation", async () => {
    const keys = generateEnclaveKeys();
    const claim: Claim = {
      bountyId: 1n,
      payee: OP,
      blockN: 1001n,
      blockHashN: rep("cd", 32),
      predicateHash: rep("ce", 32),
      loss: 5_000_000n,
      tier: 0,
      fingerprint: rep("cf", 32),
      cPHash: rep("d0", 32),
      deadline: 2000000n,
    };
    const sig = await signClaim(keys.signerPrivateKey, dom, claim);
    const rec = await recoverClaimSigner(dom, claim, sig);
    expect(rec.toLowerCase()).toBe(keys.signer.toLowerCase());
  });
});

describe("keys + hpke", () => {
  it("deux démarrages => deux paires de clés différentes", () => {
    const a = generateEnclaveKeys();
    const b = generateEnclaveKeys();
    expect(a.signer).not.toBe(b.signer);
    expect(a.x25519PublicKey).not.toBe(b.x25519PublicKey);
  });

  it("HPKE : seal puis open rend le clair", async () => {
    const keys = generateEnclaveKeys();
    const msg = new TextEncoder().encode("requête d'inférence chiffrée");
    const sealed = await seal(toBytes(keys.x25519PublicKey), msg);
    const back = await open(keys.x25519PrivateKey, sealed.enc, sealed.ciphertext);
    expect(new TextDecoder().decode(back)).toBe("requête d'inférence chiffrée");
  });

  it("HPKE : mauvaise clé => échec de déchiffrement", async () => {
    const a = generateEnclaveKeys();
    const b = generateEnclaveKeys();
    const sealed = await seal(toBytes(a.x25519PublicKey), new Uint8Array([1, 2, 3]));
    await expect(open(b.x25519PrivateKey, sealed.enc, sealed.ciphertext)).rejects.toBeDefined();
  });
});

describe("EnclaveKit.attest (mock local)", () => {
  it("produit un quote mock dont le REPORTDATA lie les clés et l'ancre", async () => {
    const kit = new EnclaveKit({ productId: 1n, chainId: 5042002, registry: REG, mockBlockHash: true });
    const out = await kit.attest({ operator: OP, anchorR: 999n });
    expect(out.mock).toBe(true);
    expect(out.signer.toLowerCase()).toBe(kit.keys.signer.toLowerCase());

    const anchorHash = keccak256(pad(numberToHex(999n), { size: 32 }));
    const expectedReportData = buildReportData(
      { chainId: 5042002n, registry: REG, productId: 1n, operator: OP, signer: kit.keys.signer, x25519: kit.keys.x25519PublicKey },
      anchorHash,
    );
    // le quote mock = concat(marker(12o) ‖ reportData(64o), keccak(...)) ; on relit le reportData
    const embedded = ("0x" + out.quote.slice(2 + 24, 2 + 24 + 128)) as Hex;
    expect(embedded.toLowerCase()).toBe(expectedReportData.toLowerCase());
    expect(out.quote).toBe(getQuoteMock(expectedReportData).quote);
  });
});
