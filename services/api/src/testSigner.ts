/** testSigner.ts — TEST MODE ONLY (Arc testnet): an opt-in, server-side demo wallet that the site can use like any
 *  wallet (relayed EIP-1193), to run the end-to-end journeys without a browser extension. It is off unless
 *  TEST_SIGNER_PK and TEST_SIGNER_TOKEN (24 characters or more) are set, and it is NOT the deployment key.
 *
 *  Guardrails (a security audit showed that "to our contracts only" is not enough: fund or topUp toward someone else's
 *  bounty or session would drain this wallet):
 *  - a token is required (constant-time comparison), Arc testnet only, rate-limited;
 *  - transactions: the calldata is DECODED and only an allowlist passes, contract by contract, where the money stays
 *    with this wallet or comes back to it: SessionPay.openSession / topUp / rotateKey / closeSession; SealedBounty.createBounty
 *    / fund / setPaused / reopen / withdrawRemaining / withdrawCredit, plus the hunter functions acceptClaim, claim,
 *    deliver (they pay from the bounty, never from this wallet); OperatorBond.requestUnbond / withdraw. topUp, fund and
 *    the owner actions require the session or bounty to belong to this wallet (read on-chain). Nothing on USDC (no
 *    transfer, no approve), nothing to any other contract, no native value;
 *  - EIP-3009 authorizations: ReceiveWithAuthorization only, at most 2 USDC per authorization, a budget of 10 USDC per
 *    day (UTC) that also counts gas, and only toward a contract of the SDK's deployment (addresses read from `testnet`,
 *    never written here):
 *    · SessionPay or SealedBounty (the contract collects from the caller, so from a transaction of this wallet that
 *      went through the allowlist), valid for 24 h at most;
 *    · X402Settler: the x402 payment for ONE call (the pay-per-call rail). The contract collects from cr.payer against
 *      a call receipt signed by an active enclave of the product, and the amount goes to the operator, the author and
 *      the network: whoever holds the authorization can only settle that one call (nonce = the receipt's), at most the
 *      signed amount, bounded like the others (2 USDC, daily budget); valid for 1 h at most, the limit of the SDK's x402
 *      client (X402_MAX_VALIDITY_SECONDS);
 *  - gas set by the server (estimate + 20 %, capped at 3 M): the gas the client asks for is ignored;
 *  - personal_sign: only an ArcHive sign-in message (EIP-4361) for this wallet, for our site, with a nonce issued by
 *    this API and still valid (operators.ts: arcHiveSignInStatement);
 *  - one log line per request (method, recipient, selector, function, amount; never the token).
 *  Settings: TEST_SIGNER_MAX_AUTH_USDC (2), TEST_SIGNER_DAILY_USDC (10), TEST_SIGNER_GAS_CAP (3,000,000). */
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, decodeFunctionData, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, testnet, X402_MAX_VALIDITY_SECONDS } from "@arcvault/sdk";
import { arcHiveSignInStatement, clientIp } from "./operators";

const WEI_PER_MICRO = 1_000_000_000_000n; // Arc's native gas: USDC with 18 decimals
const MAX_AUTH_TTL_S = 24 * 3600;
const BODY_MAX = 64 * 1024;

function usdcEnv(name: string, dflt: number): bigint {
  const v = Number(process.env[name] ?? dflt);
  return BigInt(Math.round((Number.isFinite(v) && v >= 0 ? v : dflt) * 1e6));
}
const fmt = (micro: bigint) => {
  const s = micro.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, "") || "0";
};

// ---- Allowlist ABI (v2 stack; selectors checked against the deployed bytecode) ----
const AUTH = "struct Auth { uint256 validAfter; uint256 validBefore; bytes32 nonce; bytes signature; }";
const sessionPayAbi = parseAbi([
  AUTH,
  "struct OpenParams { uint256 productId; address operator; address sessionKey; uint64 expiresAt; uint256 deposit; uint256 cap; Auth auth; address enclave; }",
  "function openSession(OpenParams q) returns (uint256)",
  "function topUp(uint256 sessionId, uint256 amount, Auth auth)",
  "function rotateKey(uint256 sessionId, address newKey)",
  "function closeSession(uint256 sessionId)",
]);
const sealedBountyAbi = parseAbi([
  AUTH,
  "struct CreateParams { uint256 productId; bytes32 predicateHash; bytes32 protocolX25519; uint256[] tierMinLoss; uint256[] tierAmount; uint256 singleCap; uint8 k; address targetToPause; uint64 deadline; uint256 funding; Auth auth; }",
  "struct Claim { uint256 bountyId; address payee; uint64 blockN; bytes32 blockHashN; bytes32 predicateHash; uint256 loss; uint8 tier; bytes32 fingerprint; bytes32 cPHash; uint64 deadline; }",
  "function createBounty(CreateParams q) returns (uint256)",
  "function fund(uint256 bountyId, uint256 amount, Auth auth)",
  "function setPaused(uint256 bountyId, bool p)",
  "function reopen(uint256 bountyId)",
  "function withdrawRemaining(uint256 bountyId)",
  "function withdrawCredit()",
  "function acceptClaim(Claim r, bytes[] signatures)",
  "function claim(Claim r, bytes[] signatures, bytes cP)",
  "function deliver(uint256 bountyId, bytes32 fingerprint, bytes cP)",
]);
const operatorBondAbi = parseAbi(["function requestUnbond(uint256 amount)", "function withdraw()"]);
/** lectures de propriété : Session et Bounty sont des structs statiques, le 1er mot est owner / protocol */
const readAbi = parseAbi(["function getSession(uint256 sessionId)", "function getBounty(uint256 bountyId)"]);

const RWA_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
} as const;

/** refus du mode test : renvoyé au site comme un refus de wallet (code 4001) */
class Refus extends Error {}

export function registerTestSigner(app: Hono) {
  const pk = process.env.TEST_SIGNER_PK as Hex | undefined;
  const token = process.env.TEST_SIGNER_TOKEN;
  if (!pk || !token || token.length < 24) {
    app.get("/test-signer/info", (c) => c.json({ enabled: false }));
    return;
  }
  const MAX_AUTH = usdcEnv("TEST_SIGNER_MAX_AUTH_USDC", 2);
  const DAILY = usdcEnv("TEST_SIGNER_DAILY_USDC", 10);
  const GAS_CAP = BigInt(Math.max(100_000, Number(process.env.TEST_SIGNER_GAS_CAP ?? 3_000_000) || 3_000_000));
  const account = privateKeyToAccount(pk);
  const me = account.address.toLowerCase();
  const transport = http(process.env.RPC_URL, { retryCount: 2 });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport });
  const pub = createPublicClient({ chain: arcTestnet, transport });
  const CHAIN_HEX = "0x" + arcTestnet.id.toString(16);
  const USDC = testnet.usdc.toLowerCase();
  const SESSION_PAY = testnet.sessionPay.toLowerCase();
  const SEALED_BOUNTY = testnet.sealedBounty.toLowerCase();
  const RULES = new Map<string, { name: string; abi: readonly unknown[] }>([
    [SESSION_PAY, { name: "SessionPay", abi: sessionPayAbi }],
    [SEALED_BOUNTY, { name: "SealedBounty", abi: sealedBountyAbi }],
    [testnet.operatorBond.toLowerCase(), { name: "OperatorBond", abi: operatorBondAbi }],
  ]);
  const X402_SETTLER = testnet.x402Settler.toLowerCase();
  /** destinataires permis d'une autorisation EIP-3009, avec la validité maximale de chacun (s) : les contrats qui
   *  encaissent depuis l'APPELANT (SessionPay, SealedBounty : 24 h), et X402Settler pour le paiement d'un appel x402
   *  (1 h, comme le client x402 du SDK). Jamais OperatorBond (une caution bloque l'argent 7 jours). */
  const AUTH_TO = new Map<string, { name: string; maxTtl: number }>([
    [SESSION_PAY, { name: "SessionPay", maxTtl: MAX_AUTH_TTL_S }],
    [SEALED_BOUNTY, { name: "SealedBounty", maxTtl: MAX_AUTH_TTL_S }],
    [X402_SETTLER, { name: "X402Settler", maxTtl: Math.min(MAX_AUTH_TTL_S, X402_MAX_VALIDITY_SECONDS) }],
  ]);
  const USDC_DOMAIN = { name: "USDC", version: "2", chainId: arcTestnet.id, verifyingContract: testnet.usdc } as const;

  // ---- budget du jour (UTC), en micro-USDC, gardé dans DATA_DIR (un redémarrage ne le remet pas à zéro) ----
  const BUDGET_FILE = join(process.env.DATA_DIR ?? "./data", "test-signer-budget.json");
  let budget = { day: "", spent: "0" };
  try {
    const saved = existsSync(BUDGET_FILE) ? JSON.parse(readFileSync(BUDGET_FILE, "utf8")) : null;
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(String(saved.day)) && /^\d{1,30}$/.test(String(saved.spent))) budget = { day: String(saved.day), spent: String(saved.spent) };
  } catch { /* budget illisible : on repart du jour */ }
  const today = () => new Date().toISOString().slice(0, 10);
  const spent = () => { if (budget.day !== today()) budget = { day: today(), spent: "0" }; return BigInt(budget.spent); };
  function reserve(amount: bigint, what: string) {
    const s = spent();
    if (s + amount > DAILY) {
      throw new Refus(`mode test : budget du jour atteint (${fmt(DAILY)} USDC par jour, ${fmt(DAILY - s)} restants, ${what} de ${fmt(amount)} USDC) : réessayez demain`);
    }
    budget.spent = (s + amount).toString();
    try {
      const dir = join(BUDGET_FILE, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(BUDGET_FILE + ".tmp", JSON.stringify(budget), { mode: 0o600 });
      renameSync(BUDGET_FILE + ".tmp", BUDGET_FILE);
    } catch (e) { console.error("mode test : budget non enregistré :", (e as Error).message); }
  }
  const refund = (amount: bigint) => { const s = spent(); budget.spent = (s > amount ? s - amount : 0n).toString(); };

  const authed = (h?: string | null) => {
    const m = (h ?? "").match(/^Bearer\s+(.+)$/);
    if (!m) return false;
    const a = Buffer.from(m[1]!), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  let win = { t: Date.now(), n: 0 };
  /** refus de jeton : 5 lignes de journal par minute au plus (un inconnu ne doit pas pouvoir remplir le disque) */
  let authFails = { t: Date.now(), n: 0 };

  /** une ligne par requête (jamais le jeton) */
  type Entry = { ip: string; method: string; ok: boolean; to?: string; selector?: string; fn?: string; amount?: bigint; gas?: bigint; reason?: string; tx?: string };
  const journal = (e: Entry) => console.log("mode test " + JSON.stringify({
    t: new Date().toISOString(), ...e, amount: e.amount !== undefined ? fmt(e.amount) : undefined, gas: e.gas?.toString(),
  }));

  const asBig = (v: unknown, field: string): bigint => {
    try {
      if (typeof v === "bigint") return v;
      if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
      if (typeof v === "string" && /^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/.test(v)) return BigInt(v);
    } catch { /* plus bas */ }
    throw new Refus(`mode test : ${field} illisible`);
  };
  const capAmount = (v: bigint, what: string) => {
    if (v > MAX_AUTH) throw new Refus(`mode test : ${what} de ${fmt(v)} USDC refusé (${fmt(MAX_AUTH)} USDC au plus par opération)`);
  };

  async function ownerWord(to: Address, data: Hex): Promise<string> {
    const r = await pub.call({ to, data });
    const hex = r.data ?? "0x";
    return hex.length >= 66 ? ("0x" + hex.slice(26, 66)).toLowerCase() : "0x" + "0".repeat(40);
  }
  async function mustOwnSession(id: bigint) {
    const owner = await ownerWord(testnet.sessionPay, encodeFunctionData({ abi: readAbi, functionName: "getSession", args: [id] }));
    if (owner !== me) throw new Refus(`mode test : la session n° ${id} n'appartient pas au wallet de test`);
  }
  async function mustOwnBounty(id: bigint) {
    const protocol = await ownerWord(testnet.sealedBounty, encodeFunctionData({ abi: readAbi, functionName: "getBounty", args: [id] }));
    if (protocol !== me) throw new Refus(`mode test : la prime n° ${id} n'appartient pas au wallet de test`);
  }

  /** liste blanche : la fonction décodée, et le montant qui quitte ce wallet (déjà compté à la signature de l'autorisation) */
  async function policy(to: string, data: Hex): Promise<{ fn: string; amount: bigint }> {
    const rule = RULES.get(to);
    if (!rule) {
      throw new Refus(to === USDC
        ? "mode test : aucune transaction sur l'USDC (les paiements passent par une autorisation EIP-3009 vers nos contrats)"
        : "mode test : transaction vers un contrat hors de la liste blanche refusée");
    }
    let d: { functionName: string; args?: readonly unknown[] };
    try { d = decodeFunctionData({ abi: rule.abi as any, data }) as any; } catch {
      throw new Refus(`mode test : fonction non autorisée sur ${rule.name} (sélecteur ${data.slice(0, 10)})`);
    }
    const a = (d.args ?? []) as any[];
    const fn = `${rule.name}.${d.functionName}`;
    switch (fn) {
      case "SessionPay.openSession": { const v = asBig(a[0]?.deposit, "dépôt"); capAmount(v, "dépôt"); return { fn, amount: v }; }
      case "SessionPay.topUp": { const v = asBig(a[1], "montant"); capAmount(v, "recharge"); await mustOwnSession(asBig(a[0], "session")); return { fn, amount: v }; }
      case "SessionPay.rotateKey":
      case "SessionPay.closeSession": await mustOwnSession(asBig(a[0], "session")); return { fn, amount: 0n };
      case "SealedBounty.createBounty": { const v = asBig(a[0]?.funding, "dotation"); capAmount(v, "dotation"); return { fn, amount: v }; }
      case "SealedBounty.fund": { const v = asBig(a[1], "montant"); capAmount(v, "dotation"); await mustOwnBounty(asBig(a[0], "prime")); return { fn, amount: v }; }
      case "SealedBounty.setPaused":
      case "SealedBounty.reopen":
      case "SealedBounty.withdrawRemaining": await mustOwnBounty(asBig(a[0], "prime")); return { fn, amount: 0n };
      case "SealedBounty.withdrawCredit": // vers ce wallet
      case "SealedBounty.acceptClaim": // chasseur : paie depuis la prime, gaz seulement pour ce wallet
      case "SealedBounty.claim":
      case "SealedBounty.deliver":
      case "OperatorBond.requestUnbond": // sa propre caution, qui lui revient
      case "OperatorBond.withdraw":
        return { fn, amount: 0n };
    }
    throw new Refus(`mode test : fonction non autorisée (${fn})`);
  }

  /** une autorisation EIP-3009 telle qu'elle sera signée (domaine et types canoniques : ce qui est vérifié est ce qui est signé) */
  function checkAuthorization(td: any) {
    if (!td || typeof td !== "object") throw new Refus("mode test : données typées illisibles");
    if (td.primaryType !== "ReceiveWithAuthorization") {
      throw new Refus("mode test : seules les autorisations de paiement USDC ReceiveWithAuthorization (EIP-3009) sont signées");
    }
    const dom = td.domain ?? {};
    if (Number(dom.chainId) !== arcTestnet.id) throw new Refus("mode test : signature hors d'Arc testnet refusée");
    if (String(dom.verifyingContract ?? "").toLowerCase() !== USDC || dom.name !== "USDC" || String(dom.version) !== "2") {
      throw new Refus("mode test : signature hors du contrat USDC d'Arc refusée");
    }
    const t = td.types?.ReceiveWithAuthorization;
    const want = RWA_TYPES.ReceiveWithAuthorization;
    if (!Array.isArray(t) || t.length !== want.length || t.some((x: any, i: number) => x?.name !== want[i]!.name || x?.type !== want[i]!.type)) {
      throw new Refus("mode test : type ReceiveWithAuthorization non standard refusé");
    }
    const msg = td.message ?? {};
    if (String(msg.from ?? "").toLowerCase() !== me) throw new Refus("mode test : autorisation au nom d'une autre adresse refusée");
    const to = String(msg.to ?? "").toLowerCase();
    const dest = AUTH_TO.get(to);
    if (!dest) throw new Refus("mode test : autorisation de paiement vers SessionPay, SealedBounty ou X402Settler seulement");
    const value = asBig(msg.value, "montant");
    if (value <= 0n) throw new Refus("mode test : montant nul refusé");
    capAmount(value, "paiement");
    const now = BigInt(Math.floor(Date.now() / 1000));
    const validAfter = asBig(msg.validAfter ?? 0, "validAfter");
    const validBefore = asBig(msg.validBefore, "validBefore");
    if (validAfter > now) throw new Refus("mode test : autorisation à effet différé refusée");
    if (validBefore <= now || validBefore > now + BigInt(dest.maxTtl)) {
      throw new Refus(`mode test : validité de l'autorisation vers ${dest.name} de ${dest.maxTtl >= 3600 ? `${dest.maxTtl / 3600} h` : `${dest.maxTtl} s`} au plus`);
    }
    if (typeof msg.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(msg.nonce)) throw new Refus("mode test : nonce de l'autorisation invalide");
    return { from: account.address, to: to as Address, value, validAfter, validBefore, nonce: msg.nonce as Hex };
  }


  async function feesNow(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | { gasPrice: bigint }> {
    try {
      const f = await pub.estimateFeesPerGas();
      if (f.maxFeePerGas !== undefined && f.maxPriorityFeePerGas !== undefined) return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
    } catch { /* chaîne sans EIP-1559 : prix unique */ }
    return { gasPrice: await pub.getGasPrice() };
  }

  app.use("/test-signer/*", bodyLimit({ maxSize: BODY_MAX, onError: (c) => c.json({ error: { code: 4200, message: "mode test : requête trop volumineuse" } }, 413) }));

  app.get("/test-signer/info", (c) => {
    if (!authed(c.req.header("authorization"))) return c.json({ enabled: true, chainId: arcTestnet.id });
    const s = spent();
    return c.json({
      enabled: true, chainId: arcTestnet.id, address: account.address,
      budget: { day: budget.day || today(), dailyUsdc: fmt(DAILY), spentUsdc: fmt(s), remainingUsdc: fmt(DAILY > s ? DAILY - s : 0n), maxPerOperationUsdc: fmt(MAX_AUTH) },
    });
  });

  app.post("/test-signer/rpc", async (c: Context) => {
    const ip = clientIp(c);
    if (!authed(c.req.header("authorization"))) {
      if (Date.now() - authFails.t > 60_000) authFails = { t: Date.now(), n: 0 };
      if (++authFails.n <= 5) journal({ ip, method: "?", ok: false, reason: authFails.n < 5 ? "jeton absent ou invalide" : "jeton absent ou invalide (refus suivants de cette minute non journalisés)" });
      return c.json({ error: { code: 4100, message: "mode test : jeton absent ou invalide" } }, 401);
    }
    if (Date.now() - win.t > 60_000) win = { t: Date.now(), n: 0 };
    if (++win.n > 180) return c.json({ error: { code: 4200, message: "mode test : trop de requêtes, réessayez dans une minute" } }, 429);
    let body: { method?: unknown; params?: unknown } = {};
    try { body = (await c.req.json()) ?? {}; } catch { /* corps illisible : méthode vide, refusée plus bas */ }
    const method = typeof body.method === "string" ? body.method.slice(0, 64) : "";
    const params: any[] = Array.isArray(body.params) ? body.params : [];
    const entry: Entry = { ip, method, ok: false };
    const ok = (result: unknown) => { entry.ok = true; journal(entry); return c.json({ result }); };
    const fail = (code: number, message: string) => { entry.reason = message.slice(0, 200); journal(entry); return c.json({ error: { code, message } }); };
    try {
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return ok([account.address]);
        case "eth_chainId":
          return ok(CHAIN_HEX);
        case "net_version":
          return ok(String(arcTestnet.id));
        case "wallet_switchEthereumChain": {
          const want = String(params[0]?.chainId ?? "").toLowerCase();
          return want === CHAIN_HEX ? ok(null) : fail(4902, "mode test : Arc testnet uniquement");
        }
        case "personal_sign": {
          const raw = String(params[0] ?? "");
          const who = params[1] ? String(params[1]).toLowerCase() : me;
          if (who !== me) throw new Refus("mode test : signature demandée pour une autre adresse");
          const text = /^0x([0-9a-fA-F]{2})*$/.test(raw) ? Buffer.from(raw.slice(2), "hex").toString("utf8") : raw;
          const statement = arcHiveSignInStatement(text, me);
          if (statement === null) {
            throw new Refus("mode test : seuls les messages de connexion ArcHive (EIP-4361) au nom de ce wallet sont signés : notre site, un nonce de cette API encore valable, 10 minutes au plus");
          }
          entry.fn = statement.slice(0, 80);
          return ok(await account.signMessage({ message: text }));
        }
        case "eth_signTypedData_v4": {
          const who = params[0] ? String(params[0]).toLowerCase() : me;
          if (who !== me) throw new Refus("mode test : signature demandée pour une autre adresse");
          let td: any;
          try { td = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1]; } catch { throw new Refus("mode test : données typées illisibles"); }
          const auth = checkAuthorization(td);
          Object.assign(entry, { to: auth.to, fn: auth.to === X402_SETTLER ? "ReceiveWithAuthorization (x402)" : "ReceiveWithAuthorization", amount: auth.value });
          reserve(auth.value, "autorisation");
          try {
            return ok(await account.signTypedData({ domain: USDC_DOMAIN, types: RWA_TYPES, primaryType: "ReceiveWithAuthorization", message: auth }));
          } catch (e) { refund(auth.value); throw e; }
        }
        case "eth_sendTransaction": {
          const tx = params[0] ?? {};
          if (tx.from && String(tx.from).toLowerCase() !== me) throw new Refus("mode test : transaction au nom d'une autre adresse refusée");
          const to = String(tx.to ?? "").toLowerCase();
          if (!/^0x[0-9a-f]{40}$/.test(to)) throw new Refus("mode test : destinataire manquant ou invalide");
          const data = String(tx.data ?? tx.input ?? "0x") as Hex;
          if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) throw new Refus("mode test : données de transaction invalides");
          entry.to = to; entry.selector = data.slice(0, 10);
          if (asBig(tx.value ?? 0, "valeur") !== 0n) throw new Refus("mode test : aucun transfert de valeur");
          const p = await policy(to, data);
          entry.fn = p.fn; entry.amount = p.amount;
          // gaz : estimé ICI (le client ne le choisit pas), avec une marge, et plafonné
          let est: bigint;
          try { est = await pub.estimateGas({ account: account.address, to: to as Address, data, value: 0n }); } catch (e: any) {
            return fail(-32000, String(e?.shortMessage ?? e?.message ?? e).slice(0, 300));
          }
          const gas = (est * 12n) / 10n + 20_000n;
          entry.gas = gas;
          if (gas > GAS_CAP) throw new Refus(`mode test : transaction trop coûteuse (${gas} unités de gaz, ${GAS_CAP} au plus)`);
          const fees = await feesNow();
          const perGas = "gasPrice" in fees ? fees.gasPrice : fees.maxFeePerGas;
          const gasCost = (gas * perGas + WEI_PER_MICRO - 1n) / WEI_PER_MICRO; // borne haute, en micro-USDC
          reserve(gasCost, "gaz");
          try {
            const hash = "gasPrice" in fees
              ? await wallet.sendTransaction({ account, chain: arcTestnet, to: to as Address, data, value: 0n, gas, gasPrice: fees.gasPrice })
              : await wallet.sendTransaction({ account, chain: arcTestnet, to: to as Address, data, value: 0n, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
            entry.tx = hash;
            return ok(hash);
          } catch (e) { refund(gasCost); throw e; }
        }
        default:
          return fail(4200, `mode test : méthode non prise en charge (${method})`);
      }
    } catch (e: any) {
      if (e instanceof Refus) return fail(4001, e.message);
      return fail(-32000, String(e?.shortMessage ?? e?.message ?? e).slice(0, 300));
    }
  });
  console.log(`mode test : wallet serveur ${account.address} (Arc testnet seulement ; ${fmt(MAX_AUTH)} USDC au plus par opération, ${fmt(DAILY)} USDC par jour)`);
}
