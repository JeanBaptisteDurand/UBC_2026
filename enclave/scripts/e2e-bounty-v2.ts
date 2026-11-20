/**
 * e2e-bounty-v2.ts — the Sealed Bounty end to end, entirely real, on Arc testnet:
 *  1) the protocol funds a vault (DemoVault, with a deliberate flaw) and publishes a bounty: "the vault's USDC balance
 *     drops by at least 1 USDC"; the pool is in USDC, and the bounty points to product 2's machine;
 *  2) the hunter verifies the enclave's key on-chain (registered through DCAP, active for the product), then sends it
 *     the encrypted exploit (DemoVault.migrate(hunter));
 *  3) the enclave (an Intel TDX VM at Phala) replays the exploit on a fork of Arc at block N (anvil) and signs the claim;
 *  4) the hunter gets it accepted (acceptClaim), then delivers the encrypted report to the protocol (deliver): the hunter
 *     is paid and the vault is paused; the protocol decrypts the report.
 * Nothing moves on the real chain on the vault's side: the exploit only ran in the fork.
 * Keys: protocol = deployer; hunter = .secrets/hunter.json (created if needed). Usage: cd enclave && npx tsx scripts/e2e-bounty-v2.ts
 * Verified level: PRODUCT_ID=7 (SealedBountyVerified contract, the enclave's level checked through PolicyEnclaves before
 * sending); while the verified bounty is not yet authorized by the bond contract (8-day delay), the script stops after
 * the claim signed by the enclave and says why acceptClaim would be refused.
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import {
  createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, parseEther, parseEventLogs, toBytes, toHex,
  type Abi, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { predicateHash, type Predicate } from "../src/services/predicate";
import { DeterministicProtocolCipher } from "../src/services/bounty";
import { encodeExploitTx, ARC_USDC } from "../src/services/anvil-fork";
import { seal } from "../src/kit/hpke";
import { deterministicOpen } from "../src/kit/deterministic-seal";

const ROOT = new URL("../../", import.meta.url);
const D = JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS ?? "docs/history/deployments.v2.testnet.json", ROOT), "utf8"));
const K = D.contracts as Record<string, Address>;
const PRODUCT = BigInt(process.env.PRODUCT_ID ?? "2");
const VERIFIED = PRODUCT === 7n;
const BOUNTY_CONTRACT = (VERIFIED ? D.levels.SealedBountyVerified : K.SealedBounty) as Address;
const BOUNTY_ENCLAVE = (process.env.ENCLAVE_URL ?? D.enclaves[PRODUCT.toString()].url).replace(/\/$/, "");
const abi = (n: string): Abi => JSON.parse(readFileSync(new URL(`contracts/out/${n}.sol/${n}.json`, ROOT), "utf8")).abi;
const sb = abi("SealedBounty"), reg = abi("EnclaveRegistry");
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const vaultAbi = parseAbi(["function migrate(address to)", "function paused() view returns (bool)"]);
const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800, timeout: 60_000 }) });
const sec = (f: string) => JSON.parse(readFileSync(new URL(`.secrets/${f}`, ROOT), "utf8"));
const protocol = privateKeyToAccount(sec("deployer.json").privateKey as Hex);
const PROTO_X = sec("demo-protocol-x25519.json") as { privateKey: Hex; publicKey: Hex };
const HF = new URL(".secrets/hunter.json", ROOT);
if (!existsSync(HF)) { const pk = generatePrivateKey(); writeFileSync(HF, JSON.stringify({ address: privateKeyToAccount(pk).address, privateKey: pk, role: "demo hunter" }, null, 2)); chmodSync(HF, 0o600); }
const hunter = privateKeyToAccount(JSON.parse(readFileSync(HF, "utf8")).privateKey as Hex);
const asProtocol = createWalletClient({ account: protocol, chain, transport: http() });
const asHunter = createWalletClient({ account: hunter, chain, transport: http() });
const usd = (x: bigint) => `${Number(x) / 1e6} USDC`;

async function send(w: typeof asHunter, address: Address, a: Abi, fn: string, args: unknown[], label: string) {
  const { request, result } = await pub.simulateContract({ account: w.account!, address, abi: a, functionName: fn, args } as any);
  const hash = await w.writeContract(request as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`${label}: ${hash} (status ${r.status}, gas ${r.gasUsed})`);
  if (r.status !== "success") throw new Error(`${label} failed`);
  return { r, result };
}

async function main() {
  const vault = K.DemoVault!;
  console.log(`protocol ${protocol.address}; hunter ${hunter.address}; vault ${vault}`);
  // the hunter's gas (Arc's native token is USDC)
  if ((await pub.getBalance({ address: hunter.address })) < parseEther("0.3")) {
    const h = await asProtocol.sendTransaction({ to: hunter.address, value: parseEther("0.5") });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`hunter funded for gas: ${h}`);
  }
  // 1. the demo vault is funded (a real flaw, real funds)
  if ((await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [vault] })) < 1_000_000n) {
    const h = await asProtocol.writeContract({ address: ARC_USDC, abi: usdcAbi, functionName: "transfer", args: [vault, 1_000_000n] });
    await pub.waitForTransactionReceipt({ hash: h });
    console.log(`vault funded with 1 USDC: ${h}`);
  }
  const vaultBefore = await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [vault] });

  // 2. the bounty
  const predicate: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: ARC_USDC, holder: vault, min: "1000000" }] };
  const funding = 1_000_000n;
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await asProtocol.signTypedData({
    account: protocol, domain: { name: "USDC", version: "2", chainId: chain.id, verifyingContract: ARC_USDC },
    types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "ReceiveWithAuthorization", message: { from: protocol.address, to: BOUNTY_CONTRACT, value: funding, validAfter: 0n, validBefore, nonce },
  });
  const q = {
    productId: PRODUCT, predicateHash: predicateHash(predicate), protocolX25519: PROTO_X.publicKey,
    tierMinLoss: [1_000_000n], tierAmount: [500_000n], singleCap: 500_000n, k: 1, targetToPause: vault,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 86400), funding, auth: { validAfter: 0n, validBefore, nonce, signature },
  };
  // BOUNTY_ID: resume a bounty already published (e.g. after a network cut) instead of creating one
  const bountyId = process.env.BOUNTY_ID ? BigInt(process.env.BOUNTY_ID)
    : (await send(asProtocol, BOUNTY_CONTRACT, sb, "createBounty", [q], "bounty published (pool 1 USDC, tier 0.5 USDC for a loss ≥ 1 USDC)")).result as bigint;
  console.log(`bounty #${bountyId}`);

  // 3. the hunter verifies the enclave's key on-chain before sending anything
  const pk = await (await fetch(`${BOUNTY_ENCLAVE}/pubkeys`)).json() as { signer: Address; x25519: Hex };
  const e = await pub.readContract({ address: K.EnclaveRegistry!, abi: reg, functionName: "enclaveOf", args: [pk.signer] }) as any;
  const head = await pub.getBlockNumber();
  // verified level: read through PolicyEnclaves (as the settlement contract does): does the enclave count at the verified level?
  const op = await pub.readContract({ address: (VERIFIED ? D.levels.PolicyEnclaves : K.EnclaveRegistry!) as Address, abi: reg, functionName: "activeOperatorAt", args: [pk.signer, PRODUCT, head] }) as Address;
  if (String(e.x25519).toLowerCase() !== pk.x25519.toLowerCase()) throw new Error("the enclave's key does not match the one registered on Arc: sending refused");
  if (/^0x0+$/.test(op)) throw new Error("the enclave is not active for the Sealed Bounty: sending refused");
  console.log(`enclave key verified on Arc: signer ${pk.signer}, operator ${op}, workload ${e.workloadId}`);

  // 4. the (real) exploit encrypted for the enclave; cP encrypted for the protocol, reproducible by the enclave
  const txs = [encodeExploitTx({ to: vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "migrate", args: [hunter.address] }) })];
  const r = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const bundle = { bountyId, payee: hunter.address, capital: 0n, predicate, txs, r, cP: "0x" as Hex };
  bundle.cP = await new DeterministicProtocolCipher().recompute(bundle as any, PROTO_X.publicKey);
  const wire = JSON.stringify({ ...bundle, bountyId: bountyId.toString(), capital: "0" });
  const cE = await seal(toBytes(pk.x25519), new TextEncoder().encode(wire));
  const t0 = Date.now();
  const resp = await fetch(`${BOUNTY_ENCLAVE}/bounty/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enc: toHex(cE.enc), ciphertext: toHex(cE.ciphertext) }), signal: AbortSignal.timeout(600_000) })
    .catch((e) => { throw new Error(`sending to the enclave cut after ${Date.now() - t0} ms: ${e?.cause?.code ?? e?.cause?.message ?? e?.message}`); });
  if (!resp.ok && resp.status !== 200) throw new Error(`enclave: HTTP ${resp.status} after ${Date.now() - t0} ms: ${(await resp.text()).slice(0, 200)}`);
  const res = await resp.json() as any;
  if (res.status !== "proven") throw new Error(`not proven: ${res.reason ?? JSON.stringify(res).slice(0, 200)}`);
  console.log(`enclave: exploit replayed on a fork of Arc at block ${res.claim.blockN} and proven in ${Date.now() - t0} ms (loss ${usd(BigInt(res.claim.loss))}, tier ${res.claim.tier}, fingerprint ${res.claim.fingerprint.slice(0, 18)}…)`);

  // 5. claim accepted, then report delivered: payment
  const claim = { ...res.claim, bountyId: BigInt(res.claim.bountyId), blockN: BigInt(res.claim.blockN), loss: BigInt(res.claim.loss), deadline: BigInt(res.claim.deadline), tier: Number(res.claim.tier) };
  if (VERIFIED) {
    const bondAbi = parseAbi(["function isSettlement(address) view returns (bool)", "function settlementApplyAt(address) view returns (uint64)"]);
    const ok = await pub.readContract({ address: K.OperatorBond!, abi: bondAbi, functionName: "isSettlement", args: [BOUNTY_CONTRACT] });
    if (!ok) {
      const at = await pub.readContract({ address: K.OperatorBond!, abi: bondAbi, functionName: "settlementApplyAt", args: [BOUNTY_CONTRACT] });
      console.log(`claim signed by the verified-level enclave (signature ${String(res.signature).slice(0, 18)}…); acceptClaim waits for the bond contract to authorize the verified bounty (applySettlement possible from ${new Date(Number(at) * 1000).toISOString()}: an 8-day delay for any new settlement contract). Stopping here.`);
      return;
    }
  }
  const before = await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [hunter.address] });
  await send(asHunter, BOUNTY_CONTRACT, sb, "acceptClaim", [claim, [res.signature]], "claim accepted (the enclave's signature verified by the contract)");
  const d = await send(asHunter, BOUNTY_CONTRACT, sb, "deliver", [bountyId, claim.fingerprint, res.cP], "report delivered to the protocol → payment");
  const after = await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [hunter.address] });
  const names = parseEventLogs({ abi: sb, logs: d.r.logs }).map((l: any) => l.eventName);
  console.log(`events: ${names.join(", ")}`);
  console.log(`hunter: +${usd(after - before)} (net of the gas it paid, in USDC on Arc); vault paused: ${await pub.readContract({ address: vault, abi: vaultAbi, functionName: "paused" })}; vault on the real chain: ${usd(vaultBefore)} → ${usd(await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [vault] }))}`);

  // 6. the protocol reads the report (and only it can)
  const report = JSON.parse(new TextDecoder().decode(deterministicOpen(toBytes(PROTO_X.privateKey), res.cP)));
  console.log(`the protocol decrypts the report: hunter ${report.payee}, ${report.txs.length} exploit transaction(s), predicate ${report.predicate.clauses[0].type}`);
}
main().catch((e) => { console.error("FAILED:", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
