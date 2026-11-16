/** retire-demo.ts — retire de la chaîne ce qui reste de l'attestation simulée (PILE v1, testnet ; joué le 7/11) :
 *  l'empreinte « démo » (mesures toutes à zéro) n'est plus autorisée pour le produit #7, et l'enclave O3 simulée est retirée.
 *  Vise explicitement les contrats v1 (testnetV1) avec leur ABI v1 : la pile v2 n'a jamais eu d'attestation simulée. */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, testnetV1 as testnet } from "../src/index";

/** ABI v1 des seules fonctions utilisées (communes à la v1 et à la v2, sauf enclaveOf dont la struct v1 a 12 champs). */
const productRegistryAbi = parseAbi([
  "function isWorkloadAllowed(uint256 productId, bytes32 workloadId) view returns (bool)",
  "function retireWorkload(uint256 productId, bytes32 workloadId)",
]);
const enclaveRegistryAbi = parseAbi([
  "struct Enclave { address signer; bytes32 x25519; uint256 productId; address operator; bytes32 workloadId; bytes6 fmspc; uint8 tcbStatus; bytes32 quoteHash; uint64 anchorBlock; uint64 registeredAt; uint64 expiresAt; bool active; }",
  "function enclaveOf(address signer) view returns (Enclave)",
  "function retire(address signer)",
  "function isActiveAt(address signer, uint256 productId, uint256 blockNumber) view returns (bool)",
]);

const DEMO_WORKLOAD = "0x595b5067f7b9e6b4153462ea198226ec97dfbc2f5a8200b0c4ce763c983f54e4" as Hex;
const O3_SIGNER = "0xF4ddE583519C067bBfd0Fb141BFFB550FF29FeBB" as Address;
const SEC = JSON.parse(readFileSync(new URL("../../../.secrets/deployer.json", import.meta.url), "utf8"));
const account = privateKeyToAccount(SEC.privateKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 800 }) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });

async function send(address: Address, abi: any, functionName: string, args: unknown[]) {
  const { request } = await pub.simulateContract({ account, address, abi, functionName, args });
  const tx = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  console.log(`${functionName} : ${tx} (statut ${r.status}, gas ${r.gasUsed})`);
}
async function main() {
  if (await pub.readContract({ address: testnet.productRegistry, abi: productRegistryAbi, functionName: "isWorkloadAllowed", args: [7n, DEMO_WORKLOAD] }))
    await send(testnet.productRegistry, productRegistryAbi, "retireWorkload", [7n, DEMO_WORKLOAD]);
  const e = await pub.readContract({ address: testnet.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "enclaveOf", args: [O3_SIGNER] }).catch(() => null) as any;
  if (!e || e.active !== false) await send(testnet.enclaveRegistry, enclaveRegistryAbi, "retire", [O3_SIGNER]);
  const allowed = await pub.readContract({ address: testnet.productRegistry, abi: productRegistryAbi, functionName: "isWorkloadAllowed", args: [7n, DEMO_WORKLOAD] });
  const head = await pub.getBlockNumber();
  const active = await pub.readContract({ address: testnet.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "isActiveAt", args: [O3_SIGNER, 7n, head] });
  console.log(`empreinte démo autorisée pour #7 : ${allowed} ; enclave O3 simulée active : ${active}`);
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
