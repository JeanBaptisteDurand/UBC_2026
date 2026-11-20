/**
 * circle-signer.ts: the x402 payer as a Circle developer-controlled wallet (EOA) instead of a local private key.
 * Used by archive-bridge.ts when PAYER=circle.
 *
 * Circle keeps the wallet's key in its MPC: this process holds only the Circle API key and the entity secret, read from
 * their files here and never logged. For each paid call the SDK's x402 client asks this account to sign ONE EIP-3009
 * ReceiveWithAuthorization (EIP-712 typed data). signTypedData sends it to Circle (POST /v1/w3s/developer/sign/typedData)
 * with a fresh entitySecretCiphertext (the entity secret encrypted with Circle's entity public key, RSA-OAEP SHA-256,
 * new for every request as Circle requires), then checks that the signature Circle returns recovers to the wallet's
 * address before the x402 client sends it. ArcHive's contract and enclave see an ordinary EOA signature.
 *
 * Nothing else is signed: messages and transactions are refused, and the typed data must be a ReceiveWithAuthorization
 * on the configured USDC and chain, from this wallet, to the configured settler, of at most maxValue.
 *
 * Files (testnet only):
 *   CIRCLE_ENV          CIRCLE_API_KEY=TEST_API_KEY:...                  (Circle console, developer-controlled wallets)
 *   CIRCLE_ENTITY_FILE  CIRCLE_ENTITY_SECRET=<64 hex>                    (registered once with Circle)
 *   CIRCLE_WALLET_FILE  {"walletId": "<uuid>", "address": "0x..."}       (accountType EOA, blockchain ARC-TESTNET)
 * The wallet must be an EOA: the enclave and USDC check the EIP-3009 signature with ecrecover (no ERC-1271 for SCAs).
 */
import { readFileSync } from "node:fs";
import { constants, publicEncrypt } from "node:crypto";
import { getAddress, getTypesForEIP712Domain, recoverTypedDataAddress, serializeTypedData, type Address, type Hex } from "viem";
import { toAccount } from "viem/accounts";

export interface CircleSignerOptions {
  envFile: string;
  entityFile: string;
  walletFile: string;
  /** what this account may sign: a ReceiveWithAuthorization on `usdc` (chain `chainId`) to `to`, value <= maxValue */
  allow: { chainId: number; usdc: Address; to: Address; maxValue: bigint };
  baseUrl?: string;
}

function envOf(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export async function circleAccount(o: CircleSignerOptions) {
  const base = (o.baseUrl ?? "https://api.circle.com").replace(/\/+$/, "");
  const apiKey = envOf(o.envFile).CIRCLE_API_KEY ?? "";
  if (!apiKey.startsWith("TEST_API_KEY:")) throw new Error(`circle payer: CIRCLE_API_KEY in ${o.envFile} must be a TEST_API_KEY (testnet only)`);
  const secret = envOf(o.entityFile).CIRCLE_ENTITY_SECRET ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) throw new Error(`circle payer: CIRCLE_ENTITY_SECRET (64 hex) missing in ${o.entityFile}`);
  const file = JSON.parse(readFileSync(o.walletFile, "utf8"));
  const walletId = String(file.walletId ?? file.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(walletId)) throw new Error(`circle payer: walletId missing in ${o.walletFile}`);

  const call = async (method: "GET" | "POST", path: string, body?: object): Promise<any> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) throw new Error(`Circle ${method} ${path}: HTTP ${res.status} ${j?.code ?? ""} ${String(j?.message ?? text).slice(0, 160)}`);
    return j?.data;
  };

  // the wallet as Circle has it: a live EOA on ARC-TESTNET
  const w = (await call("GET", `/v1/w3s/wallets/${encodeURIComponent(walletId)}`))?.wallet;
  if (!w?.address) throw new Error(`circle payer: wallet ${walletId} not found`);
  if (w.accountType !== "EOA") throw new Error(`circle payer: wallet ${walletId} is ${w.accountType}, not EOA (ArcHive accepts only EOA payers)`);
  if (w.blockchain !== "ARC-TESTNET") throw new Error(`circle payer: wallet ${walletId} is on ${w.blockchain}, not ARC-TESTNET`);
  if (w.state !== "LIVE") throw new Error(`circle payer: wallet ${walletId} is ${w.state}, not LIVE`);
  const address = getAddress(w.address);
  if (file.address && getAddress(file.address) !== address) throw new Error(`circle payer: ${o.walletFile} says ${file.address}, Circle says ${address}`);
  const pem = String((await call("GET", "/v1/w3s/config/entity/publicKey"))?.publicKey ?? "");
  if (!pem.includes("PUBLIC KEY")) throw new Error("circle payer: no entity public key from Circle");
  // a new ciphertext for every request (RSA-OAEP is randomized; Circle refuses a reused one)
  const ciphertext = () => publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(secret, "hex")).toString("base64");

  const refuse = (what: string) => async (): Promise<Hex> => { throw new Error(`circle payer: ${what} refused (this account signs x402 payment authorizations only)`); };
  const account = toAccount({
    address,
    signMessage: refuse("signMessage"),
    signTransaction: refuse("signTransaction"),
    async signTypedData(td: any): Promise<Hex> {
      const { domain, primaryType, message } = td ?? {};
      if (primaryType !== "ReceiveWithAuthorization") throw new Error(`circle payer: typed data ${String(primaryType)} refused`);
      if (Number(domain?.chainId) !== o.allow.chainId || getAddress(String(domain?.verifyingContract)) !== getAddress(o.allow.usdc)) {
        throw new Error("circle payer: authorization outside the configured USDC and chain refused");
      }
      if (getAddress(String(message?.from)) !== address || getAddress(String(message?.to)) !== getAddress(o.allow.to)) {
        throw new Error("circle payer: authorization not from this wallet to the configured settler refused");
      }
      const value = BigInt(message.value);
      if (value <= 0n || value > o.allow.maxValue) throw new Error(`circle payer: amount ${value} outside (0, ${o.allow.maxValue}] refused`);
      const types = td.types?.EIP712Domain ? td.types : { EIP712Domain: getTypesForEIP712Domain({ domain }), ...td.types };
      const data = serializeTypedData({ domain, types, primaryType, message } as any);
      const out = await call("POST", "/v1/w3s/developer/sign/typedData", {
        walletId, data, memo: `ArcHive x402: ${Number(value) / 1e6} USDC to X402Settler ${getAddress(String(message.to))}`, entitySecretCiphertext: ciphertext(),
      });
      const sig = out?.signature;
      if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error("circle payer: Circle returned no 65-byte signature");
      const signer = await recoverTypedDataAddress({ domain, types, primaryType, message, signature: sig as Hex } as any);
      if (getAddress(signer) !== address) throw new Error(`circle payer: Circle's signature recovers to ${signer}, not to the wallet ${address}: nothing sent`);
      return sig as Hex;
    },
  });
  return { account, walletId, address };
}
