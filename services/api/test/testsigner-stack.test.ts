/** testsigner-stack.test.ts — the test mode follows the API's LIVE stack: given the v3 deployment (DEPLOYMENTS), it
 *  signs an x402 payment toward v3's X402Settler and refuses the same payment toward v2.1's, and refuses a transaction
 *  to a v2.1 contract. A throwaway wallet key, no RPC call (typed-data signatures and refusals need none), requests
 *  through Hono's app.request.
 *  Run: cd services/api && npx tsx --test test/testsigner-stack.test.ts */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { recoverTypedDataAddress, toHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deploymentFromJson, receiveWithAuthorizationTypes, testnet, usdcDomain, x402CallNonce, X402_MAX_VALIDITY_SECONDS } from "@arcvault/sdk";

const v3 = deploymentFromJson(JSON.parse(readFileSync(new URL("../../../deployments.v3.testnet.json", import.meta.url), "utf8")));
const dataDir = mkdtempSync(join(tmpdir(), "archive-testsigner-v3-"));
const pk = generatePrivateKey();
const wallet = privateKeyToAccount(pk);
const TOKEN = randomBytes(36).toString("base64url");
const DEAD = "0x000000000000000000000000000000000000dEaD" as Address;
let app: Hono;
const origLog = console.log;

before(async () => {
  // nothing reaches the network: an unused local RPC address
  Object.assign(process.env, { DATA_DIR: dataDir, RPC_URL: "http://127.0.0.1:9", TEST_SIGNER_PK: pk, TEST_SIGNER_TOKEN: TOKEN });
  console.log = () => {}; // the test mode logs one line per request
  const { registerTestSigner } = await import("../src/testSigner");
  app = new Hono();
  registerTestSigner(app, v3);
});
after(() => { console.log = origLog; rmSync(dataDir, { recursive: true, force: true }); });

async function rpc(method: string, params: unknown[]) {
  const r = await app.request("/test-signer/rpc", {
    method: "POST", body: JSON.stringify({ method, params }),
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-forwarded-for": "203.0.113.9" },
  });
  return (await r.json()) as { result?: string; error?: { code: number; message: string } };
}
/** the x402 authorization the SDK's client signs for one call, toward `settler` */
function x402(settler: Address) {
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  const nonce = x402CallNonce({
    chainId: v3.chainId, settler, productId: 3n, enclave: DEAD,
    enc: toHex(randomBytes(32)), ciphertext: toHex(randomBytes(64)), clientEphemeralPub: toHex(randomBytes(32)),
  });
  const td = {
    domain: usdcDomain(v3.usdc, v3.chainId),
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      ...receiveWithAuthorizationTypes,
    },
    primaryType: "ReceiveWithAuthorization" as const,
    message: { from: wallet.address, to: settler, value: 10_000n, validAfter: 0n, validBefore: nowS + BigInt(X402_MAX_VALIDITY_SECONDS), nonce },
  };
  return { td, json: JSON.stringify(td, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) };
}

test("on the v3 stack, the test mode signs an x402 payment to v3's X402Settler", async () => {
  assert.notEqual(v3.x402Settler.toLowerCase(), testnet.x402Settler.toLowerCase());
  const a = x402(v3.x402Settler);
  const r = await rpc("eth_signTypedData_v4", [wallet.address, a.json]);
  assert.match(String(r.result), /^0x[0-9a-f]{130}$/, JSON.stringify(r));
  const who = await recoverTypedDataAddress({
    domain: a.td.domain, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization", message: a.td.message, signature: r.result as `0x${string}`,
  });
  assert.equal(who, wallet.address);
});

test("on the v3 stack, the test mode refuses v2.1's contracts", async () => {
  const r = await rpc("eth_signTypedData_v4", [wallet.address, x402(testnet.x402Settler).json]);
  assert.equal(r.error?.code, 4001, JSON.stringify(r));
  const s = await rpc("eth_sendTransaction", [{ from: wallet.address, to: testnet.sessionPay, data: "0x12345678", gas: "0x989680" }]);
  assert.equal(s.error?.code, 4001, JSON.stringify(s));
  assert.match(String(s.error?.message), /outside the allowlist/);
});
