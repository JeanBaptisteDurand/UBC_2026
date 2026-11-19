/**
 * retire-v2.ts — retires the v2 stack (deployments.v2.testnet.json) after the switch to v2.1 (9 Nov 2026):
 *  1) the operator retires its v2 enclaves that are still registered (nothing anchors to them any more; the bond they
 *     reserved is released; receipts anchored earlier stay payable during the grace period);
 *  2) the products' author retires their fingerprints (no other instance of those images can register);
 *  3) the operator requests the release of its v2 bond (withdrawable after OperatorBond.UNBOND_DELAY = 7 days).
 * Idempotent: a step already done is skipped. Keys are read from .secrets/ (never printed).
 * Usage: cd enclave && npx tsx scripts/retire-v2.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = new URL("../../", import.meta.url);
const D = JSON.parse(readFileSync(new URL("deployments.v2.testnet.json", ROOT), "utf8"));
const K = D.contracts as Record<string, Address>;
const abi = (n: string): Abi => JSON.parse(readFileSync(new URL(`contracts/out/${n}.sol/${n}.json`, ROOT), "utf8")).abi;
const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const key = (f: string) => privateKeyToAccount(JSON.parse(readFileSync(new URL(`.secrets/${f}`, ROOT), "utf8")).privateKey as Hex);
const operator = key("operator.json");
const author = key("deployer.json");
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800 }) });

async function send(acct: typeof operator, address: Address, a: Abi, fn: string, args: unknown[], label: string) {
  const wallet = createWalletClient({ account: acct, chain, transport: http() });
  try {
    const { request } = await pub.simulateContract({ account: acct, address, abi: a, functionName: fn, args } as any);
    const hash = await wallet.writeContract(request as any);
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`${label}: ${hash} (${r.status}, gas ${r.gasUsed})`);
  } catch (e: any) {
    console.log(`${label}: skipped (${(e?.shortMessage ?? e?.message ?? String(e)).split("\n")[0]})`);
  }
}

// the v2 enclaves of operator 0x344f… (registered on 7–8 Nov) and their full fingerprints (the instance's RTMR3)
const V2 = [
  { signer: "0x6AFc62deC6C33DdFff75f95cBf1b8D9d18296DA6" as Address, product: 1n, workload: "0x9b21399b827e42da3a6753340f938b946bf635d7e96496896dbe9753e67e5d06" as Hex },
  { signer: "0x951cC6556a47acD0B3c9bD6F126B4952AEf48f00" as Address, product: 2n, workload: "0xf9c1e729864ffc4bd9734d7aa8dd6290fbe93651d73536a53ff1d5a58ecdc0e1" as Hex },
];

async function main() {
  const reg = abi("EnclaveRegistry"), pr = abi("ProductRegistry"), ob = abi("OperatorBond");
  for (const o of V2) {
    // the ABIs in contracts/out are v2.1's: the v2 Enclave struct is not decoded; retire() is simulated first and
    // skipped if it fails (already retired, or unknown)
    await send(operator, K.EnclaveRegistry!, reg, "retire", [o.signer], `v2 enclave ${o.signer.slice(0, 10)}… (product ${o.product}) retired by the operator`);
    if (await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "isWorkloadAllowed", args: [o.product, o.workload] })) {
      await send(author, K.ProductRegistry!, pr, "retireWorkload", [o.product, o.workload], `v2 fingerprint ${o.workload.slice(0, 10)}… retired by the author`);
    } else console.log(`v2 fingerprint ${o.workload.slice(0, 10)}…: already retired`);
  }
  const bond = (await pub.readContract({ address: K.OperatorBond!, abi: ob, functionName: "bondOf", args: [operator.address] })) as bigint;
  if (bond > 0n) await send(operator, K.OperatorBond!, ob, "requestUnbond", [bond], `v2 bond release requested (${Number(bond) / 1e6} USDC, withdrawable in 7 days)`);
  else console.log("v2 bond: nothing to withdraw");
}
main().catch((e) => { console.error("FAILED:", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
