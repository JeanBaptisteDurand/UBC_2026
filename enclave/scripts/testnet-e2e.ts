/**
 * testnet-e2e.ts — fait tourner le moteur EN VRAI sur Arc testnet.
 *
 * Caution (USDC réel) -> produit -> inscription d'une enclave (politique TDX + ANCRAGE EIP-2935 réel
 * sur Arc) -> paiement x402 à l'appel (EIP-3009 réel + split + exposition + reçu d'enclave vérifié).
 * Le seul élément simulé est la vérification du quote Intel (module paramétrable au lieu d'Automata) :
 * tout le reste s'exécute sur la vraie chaîne.
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { generateEnclaveKeys } from "../src/kit/keys";
import { computeReportData0, buildReportData, computeWorkloadId } from "../src/kit/binding";
import { signCallReceipt } from "../src/kit/eip712";

const DEP = JSON.parse(readFileSync(new URL("../../deployments.testnet.json", import.meta.url), "utf8"));
const SEC = JSON.parse(readFileSync(new URL("../../.secrets/deployer.json", import.meta.url), "utf8"));
const C = DEP.contracts;
const USDC = DEP.external.USDC as Address;
const CHAIN_ID = 5042002;

const arc = defineChain({
  id: CHAIN_ID,
  name: "Arc testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [DEP.rpc] } },
});

const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arc, transport: http(DEP.rpc) });
const wallet = createWalletClient({ account, chain: arc, transport: http(DEP.rpc) });

const abi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
  "function bondFrom(uint256 amount)",
  "struct ProposeParams { bytes32 manifestHash; string manifestURI; bytes32[] workloadIds; bool deterministic; uint256 price; uint16 bpsOperator; uint16 bpsAuthor; uint16 bpsNetwork; uint256 minBond; uint256 exposureCap; address settlement; bytes32 param; string[] advisoryIds; uint32 unitTokens; uint32 outWeight; }",
  "function propose(ProposeParams q) returns (uint256)",
  "function activate(uint256 productId)",
  "struct Measurements { bool ok; uint16 version; uint16 bodyType; uint8 tcbStatus; bytes6 fmspc; bytes reportData; bytes mrtd; bytes rtmr0; bytes rtmr1; bytes rtmr2; bytes rtmr3; bytes mrConfigId; bytes8 xfam; bytes8 tdAttributes; string[] advisories; }",
  "function setMeasurements(bytes quote, Measurements m)",
  "function registerEnclave(uint256 productId, bytes quote, uint256 anchorR, address signer, bytes32 x25519, bytes eventLog)",
  "function isActiveAt(address signer, uint256 productId, uint256 blockNumber) view returns (bool)",
  "struct CallReceipt { uint256 productId; address payer; bytes32 requestHash; bytes32 responseHash; uint128 units; uint64 anchorBlock; bytes32 nonce; }",
  "struct Auth { uint256 validAfter; uint256 validBefore; bytes32 nonce; bytes signature; }",
  "function settle(CallReceipt cr, bytes enclaveSig, Auth auth)",
]);

function rep(byte: string, n: number): Hex {
  return ("0x" + byte.repeat(n)) as Hex;
}

async function send(hash: Promise<Hex>, label: string): Promise<void> {
  const h = await hash;
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log(`  ${label}: ${r.status}  ${DEP.explorer}/tx/${h}`);
  if (r.status !== "success") throw new Error(`${label} a échoué`);
}

async function main() {
  const op = account.address as Address;
  console.log(`Opérateur/payeur : ${op}`);
  console.log(`Solde USDC (natif) : ${await pub.getBalance({ address: op })}`);

  // 1) caution : approve + bondFrom (USDC réel)
  console.log("\n[1] Caution opérateur (4 USDC)");
  await send(
    wallet.writeContract({ address: USDC, abi, functionName: "approve", args: [C.OperatorBond as Address, 4_000_000n] }),
    "approve",
  );
  await send(
    wallet.writeContract({ address: C.OperatorBond as Address, abi, functionName: "bondFrom", args: [4_000_000n] }),
    "bondFrom",
  );

  // mesures d'enclave (workloadId indépendant du produit, calculé d'abord)
  const keys = generateEnclaveKeys();
  const meas = {
    mrtd: rep("aa", 48),
    rtmr0: rep("b0", 48),
    rtmr1: rep("b1", 48),
    rtmr2: rep("b2", 48),
    rtmr3: rep("b3", 48),
    mrConfigId: rep("cc", 48),
    xfam: "0x000000000000000e" as Hex,
    tdAttributes: "0x0000000000000000" as Hex,
  };
  const workloadId = computeWorkloadId(meas);

  // 2) produit x402 (timelock 0 -> activable tout de suite)
  console.log("\n[2] Produit (rail x402, prix 1 USDC/unité)");
  const params = {
    manifestHash: rep("11", 32),
    manifestURI: "ipfs://demo",
    workloadIds: [workloadId],
    deterministic: false,
    price: 1_000_000n,
    bpsOperator: 8000,
    bpsAuthor: 1000,
    bpsNetwork: 1000,
    minBond: 1_000_000n,
    exposureCap: 1_000_000_000n,
    settlement: C.X402Settler as Address,
    param: ("0x" + "00".repeat(32)) as Hex,
    advisoryIds: [] as string[],
    unitTokens: 0, // v2 : 0 = 1 (unité v1)
    outWeight: 0,
  };
  const sim = await pub.simulateContract({ account, address: C.ProductRegistry as Address, abi, functionName: "propose", args: [params] });
  const productId = sim.result as bigint;
  await send(wallet.writeContract(sim.request), `propose (productId=${productId})`);
  await send(
    wallet.writeContract({ address: C.ProductRegistry as Address, abi, functionName: "activate", args: [productId] }),
    "activate",
  );

  // 3) inscription d'enclave : ancrage EIP-2935 RÉEL + politique TDX
  console.log("\n[3] Inscription d'enclave (ancrage EIP-2935 réel sur Arc)");
  const head = await pub.getBlockNumber();
  const R = head - 10n;
  const blk = await pub.getBlock({ blockNumber: R });
  const reportData = buildReportData(
    { chainId: BigInt(CHAIN_ID), registry: C.EnclaveRegistry as Address, productId, operator: op, signer: keys.signer, x25519: keys.x25519PublicKey },
    blk.hash as Hex,
  );
  const rd0 = computeReportData0({ chainId: BigInt(CHAIN_ID), registry: C.EnclaveRegistry as Address, productId, operator: op, signer: keys.signer, x25519: keys.x25519PublicKey });
  const measurements = {
    ok: true,
    version: 4,
    bodyType: 2,
    tcbStatus: 0,
    fmspc: "0x112233445566" as Hex,
    reportData,
    ...meas,
    advisories: [] as string[],
  };
  const quote = toHex(new TextEncoder().encode("arc-enclave-testnet-quote-1"));
  await send(
    wallet.writeContract({ address: C.MockAttestationModule as Address, abi, functionName: "setMeasurements", args: [quote, measurements] }),
    "setMeasurements",
  );
  await send(
    wallet.writeContract({ address: C.EnclaveRegistry as Address, abi, functionName: "registerEnclave", args: [productId, quote, R, keys.signer, keys.x25519PublicKey, "0x"] }),
    "registerEnclave",
  );
  const active = await pub.readContract({ address: C.EnclaveRegistry as Address, abi, functionName: "isActiveAt", args: [keys.signer, productId, head] });
  console.log(`  isActiveAt(signer, product, ${head}) = ${active}  (rd0=${rd0.slice(0, 18)}…)`);

  // 4) paiement x402 à l'appel : reçu d'enclave + autorisation EIP-3009 réelle
  console.log("\n[4] Paiement x402 à l'appel (1 USDC, split + exposition + reçu vérifié)");
  const head2 = await pub.getBlockNumber();
  const nonce = rep("7a", 32);
  const cr = {
    productId,
    payer: op,
    requestHash: rep("a1", 32),
    responseHash: rep("a2", 32),
    units: 1n,
    anchorBlock: head2,
    nonce,
  };
  const enclaveSig = await signCallReceipt(keys.signerPrivateKey, { chainId: CHAIN_ID, verifyingContract: C.X402Settler as Address }, {
    productId: cr.productId,
    payer: cr.payer,
    requestHash: cr.requestHash,
    responseHash: cr.responseHash,
    units: cr.units,
    anchorBlock: cr.anchorBlock,
    nonce: cr.nonce,
  });
  // autorisation EIP-3009 ReceiveWithAuthorization sur l'USDC réel (domaine name "USDC" v2)
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const payerSig = await account.signTypedData({
    domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: { from: op, to: C.X402Settler as Address, value: 1_000_000n, validAfter: 0n, validBefore, nonce },
  });
  const auth = { validAfter: 0n, validBefore, nonce, signature: payerSig };
  await send(
    wallet.writeContract({ address: C.X402Settler as Address, abi, functionName: "settle", args: [cr, enclaveSig, auth] }),
    "x402 settle",
  );

  console.log("\n✅ Moteur exécuté de bout en bout sur Arc testnet.");
}

main().catch((e) => {
  console.error("ERREUR:", e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
