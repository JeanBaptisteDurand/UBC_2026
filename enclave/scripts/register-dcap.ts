/**
 * register-dcap.ts — registers a real Intel TDX enclave in the registry, verified by DCAP on-chain:
 *  1) a fresh quote is requested from the enclave (/attest), bound to the chain, the registry, the product, the operator
 *     and a recent block;
 *  2) the measurements come from simulating the DCAP module (exactly what the contract will compute), hence the workloadId;
 *  3) the product's author allows this workloadId (proposeWorkload, then applyWorkload; delay = timelock, 0 on testnet);
 *  4) registerEnclave: the registry calls TdxAttestationModule → Automata DCAP, which verifies Intel's signature.
 * Separate roles: the product's author (the deployer key) allows the image; the operator (.secrets/operator.json) registers.
 * v2.1 (when the registry exposes replayEventLog): dstack's RTMR3 event log is encoded (FORMAT_V1) and replayed off-chain,
 * then by the registry itself; the allowed image is the image fingerprint (compose-hash + os-image-hash, without the
 * instance id), so a VM restart needs no new authorization. On the v2 registry, the original path is used.
 * Usage: ENCLAVE_URL=https://…-8802.dstack-pha1-prod9.phala.network PRODUCT_ID=1 npx tsx scripts/register-dcap.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodePacked, http, keccak256, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { dstackImageFromAttest } from "../../packages/sdk/src/dstack-eventlog";
import { parseTdxQuote } from "../../packages/sdk/src/quote";

const ROOT = new URL("../../", import.meta.url);
const D = JSON.parse(readFileSync(new URL(process.env.DEPLOYMENTS ?? "docs/history/deployments.v2.testnet.json", ROOT), "utf8"));
const K = D.contracts as Record<string, Address>;
const abi = (name: string, dir = name): Abi => JSON.parse(readFileSync(new URL(`contracts/out/${dir}.sol/${name}.json`, ROOT), "utf8")).abi;
const ENCLAVE = (process.env.ENCLAVE_URL ?? "").replace(/\/$/, "");
const PRODUCT_ID = BigInt(process.env.PRODUCT_ID ?? "0");
if (!ENCLAVE || !PRODUCT_ID) { console.error("ENCLAVE_URL and PRODUCT_ID are required"); process.exit(1); }

const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const key = (f: string) => privateKeyToAccount(JSON.parse(readFileSync(new URL(`.secrets/${f}`, ROOT), "utf8")).privateKey as Hex);
const account = key(process.env.OPERATOR_KEY_FILE ?? "operator.json"); // the operator: registers the enclave
const author = key(process.env.AUTHOR_KEY_FILE ?? "deployer.json"); // the product's author: allows the image
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain, transport: http() });
const authorWallet = createWalletClient({ account: author, chain, transport: http() });

async function send(address: Address, a: Abi, functionName: string, args: unknown[], label: string, w = wallet) {
  const { request } = await pub.simulateContract({ account: w.account!, address, abi: a, functionName, args } as any);
  const hash = await w.writeContract(request as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  const price = r.effectiveGasPrice ?? 0n;
  console.log(`${label}: ${hash} (status ${r.status}, gas ${r.gasUsed}, ${(Number(r.gasUsed * price) / 1e18).toFixed(4)} USDC)`);
  if (r.status !== "success") throw new Error(`${label} failed`);
  return r;
}

async function main() {
  const reg = abi("EnclaveRegistry"), pr = abi("ProductRegistry"), mod = abi("TdxAttestationModule");
  const anchorR = (await pub.getBlockNumber()) - 10n;
  const res = await fetch(`${ENCLAVE}/attest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operator: account.address, anchorR: anchorR.toString() }) });
  const a = await res.json() as { quote: Hex; signer: Address; x25519: Hex; eventLog?: Hex; mock?: boolean; error?: string };
  if (!res.ok || a.error) throw new Error(`/attest: ${res.status} ${a.error ?? ""}`);
  if (a.mock) throw new Error("simulated quote: this machine has no Intel TDX, registration refused");
  let eventLog = (a.eventLog ?? "0x") as Hex;
  console.log(`TDX quote received: ${(a.quote.length - 2) / 2} bytes, signer ${a.signer}, anchored to block ${anchorR}`);
  // v2.1? (the registry can replay the RTMR3 event log)
  const img = dstackImageFromAttest(a.quote, a.eventLog);
  let v21 = false;
  if (img.eventLog) {
    try {
      const [rtmr3, known, compose, os] = await pub.readContract({ address: K.EnclaveRegistry!, abi: reg, functionName: "replayEventLog", args: [img.eventLog] }) as [Hex, boolean, Hex, Hex];
      v21 = true;
      if (!img.rtmr3Matches) throw new Error("the RTMR3 event log does not reproduce the quote's RTMR3 (local replay)");
      if (rtmr3.toLowerCase() !== parseTdxQuote(a.quote).rtmr3.toLowerCase()) throw new Error("the registry's replay does not reproduce the quote's RTMR3");
      if (!known || compose.toLowerCase() !== img.composeHash?.toLowerCase() || os.toLowerCase() !== img.osImageHash?.toLowerCase())
        throw new Error(`the registry's replay differs from the local replay (known image ${known}, compose ${compose}, os ${os})`);
      eventLog = img.eventLog;
      console.log(`v2.1: RTMR3 event log replayed (off-chain and by the registry): compose-hash ${compose}, os-image-hash ${os}`);
    } catch (e) {
      if (v21) throw e;
      console.log("v2 registry (no replayEventLog): full fingerprint, raw event log");
    }
  }

  // what the contract will compute: the simulated DCAP verification returns the measurements
  const { result: m } = await pub.simulateContract({ account, address: K.TdxAttestationModule!, abi: mod, functionName: "verify", args: [a.quote, eventLog] } as any) as { result: any };
  if (!m.ok) throw new Error("simulated DCAP verification: failed");
  const workloadId = keccak256(encodePacked(
    ["bytes", "bytes", "bytes", "bytes", "bytes", "bytes", "bytes8", "bytes8"],
    [m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, m.rtmr3, m.mrConfigId, m.xfam, m.tdAttributes],
  ));
  console.log(`DCAP (simulated): version ${m.version}, TCB ${m.tcbStatus}, FMSPC ${m.fmspc}, attributes ${m.tdAttributes}, workloadId ${workloadId}`);
  if (workloadId.toLowerCase() !== img.workloadId.toLowerCase()) throw new Error("full fingerprint: the SDK and the DCAP module disagree");

  let allowId = workloadId;
  if (v21) {
    const onchain = await pub.readContract({ address: K.EnclaveRegistry!, abi: reg, functionName: "imageIdOf", args: [m.mrtd, m.rtmr0, m.rtmr1, m.rtmr2, img.composeHash, img.osImageHash, m.xfam, m.tdAttributes] }) as Hex;
    if (onchain.toLowerCase() !== img.imageId?.toLowerCase()) throw new Error(`image fingerprint: registry ${onchain}, SDK ${img.imageId}`);
    allowId = onchain;
    console.log(`image fingerprint (stable across restarts): ${allowId}`);
  }
  if (!(await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "isWorkloadAllowed", args: [PRODUCT_ID, allowId] }))) {
    await send(K.ProductRegistry!, pr, "proposeWorkload", [PRODUCT_ID, allowId], `image proposed (product ${PRODUCT_ID}, by the author)`, authorWallet);
    await send(K.ProductRegistry!, pr, "applyWorkload", [PRODUCT_ID, allowId], "image allowed (by the author)", authorWallet);
  }
  const r = await send(K.EnclaveRegistry!, reg, "registerEnclave", [PRODUCT_ID, a.quote, anchorR, a.signer, a.x25519, eventLog], "registerEnclave (on-chain DCAP verification)");
  const e = await pub.readContract({ address: K.EnclaveRegistry!, abi: reg, functionName: "enclaveOf", args: [a.signer] }) as any;
  const head = await pub.getBlockNumber();
  const op = await pub.readContract({ address: K.EnclaveRegistry!, abi: reg, functionName: "activeOperatorAt", args: [a.signer, PRODUCT_ID, head] });
  console.log(`registered: product ${e.productId}, operator ${e.operator}, TCB ${e.tcbStatus}, FMSPC ${e.fmspc}, workload ${e.workloadId}, blocks ${e.fromBlock}→${e.untilBlock}; active operator at block ${head}: ${op}`);
  console.log(`registration tx: ${r.transactionHash}`);
}
main().catch((e) => { console.error("FAILED:", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
