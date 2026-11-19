/**
 * refute-demo.ts — the refutation demo on Arc testnet (v2.1 stack), kept separate and labelled: product 5
 * "Sealed Bounty — refutation demo (one image deliberately lies)". With a single operator, a refutation cannot be shown
 * on-chain (it needs at least two other operators): this script sets up three demo operators and plays the whole
 * mechanism with real transactions. The same path runs, with the real contracts and the real replay, on a local chain:
 * test/bounty-demo-fault-chain.test.ts.
 *
 *  (a) operator keys A (lying image), B, C: .secrets/demo-operators.json (0600, created if needed); refused if any of them
 *      is the main operator (0x344f…2e1a), the deployer or the hunter; the deployer funds each one (gas + a 1 USDC bond);
 *  (b) each operator: ERC-8004 identity, VerdictLog allowed (setApprovalForAll), 1 USDC bond (EIP-3009), agentId;
 *  (c) the author (deployer) creates product 5, settled by SealedBounty; its public manifest (in English) is written from
 *      the two compose files into web/public/manifests/sealed-bounty-refute-demo-v21.json, and its keccak256 recorded on-chain;
 *  (d) DCAP registration of the three enclaves, each by its own operator: scripts/register-dcap.ts, run with a demo
 *      operator key in a temporary 0600 file (deleted afterwards); the author allows each VM's image fingerprint for
 *      product 5;
 *  (e) the protocol (deployer) deploys a new DemoVault, funds it with 1 USDC and publishes a bounty on product 5
 *      (pool 1 USDC, tier 0.5 USDC for a loss ≥ 1 USDC, ERC20_DROP predicate, an X25519 key of the bounty's own);
 *  (f) the hunter (.secrets/hunter.json) verifies the lying enclave's key on-chain and submits the exploit to it
 *      (DemoVault.migrate(hunter), as in e2e-bounty-v2.ts): a claim signed with a loss of 2 USDC although the vault
 *      holds only 1; acceptClaim;
 *  (g) before delivery, the protocol requests the refutation (SDK requestRefutations) from the three enclaves: A is left
 *      out (the claim's operator), B and C replay at block N and sign Refutation { proven, real loss 1 USDC, tier }.
 *      Source: "protocol" (cP + the X25519 secret of this one report, the default) or REFUTE_SOURCE=hunter (bundle + nonce r);
 *  (h) refute(claim, [A], f, [sigB, sigC]) sent by the deployer: ClaimRefuted, A's bond seized (half to the reporter,
 *      half to the protocol: here the deployer, twice), A banned, the reserved payment returned to the pool,
 *      ERC-8004 verdict "refuted" (0) for A's agent;
 *  (i) the summary (transactions, amounts) is written step by step into deployments.v21.testnet.json, key "refuteDemo":
 *      when re-run, the script resumes where it stopped; once the claim is refuted, it only prints.
 * The main operator's key is never read or used; product 2 and its enclaves are not touched.
 * Demo secrets (the bounty's X25519 key, nonce r, report cP): .secrets/refute-demo.json (0600).
 *
 * Usage (from enclave/):
 *   npx tsx scripts/refute-demo.ts --keys     keys A, B, C (created if needed) and the encrypted variables for the two VMs
 *   LIAR_URL=https://<app>-8803.dstack-… B_URL=https://<app>-8803.dstack-… C_URL=https://<app>-8813.dstack-… \
 *     npx tsx scripts/refute-demo.ts [--dry]
 *   DEPLOYMENTS (default deployments.v21.testnet.json); REFUTE_SOURCE=protocol|hunter (default protocol);
 *   --dry: checks (compose files, enclaves, balances) and writes the manifest, with no transaction.
 */
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { x25519 } from "@noble/curves/ed25519";
import {
  createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, formatUnits, getAddress, http, isAddress, keccak256,
  parseAbi, parseEther, parseEventLogs, toBytes, toHex, zeroAddress, type Abi, type Address, type Hex, type PublicClient,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  hunterRefuteSource, prepareRefuteCall, protocolRefuteSource, readAcceptedClaim, requestRefutations, sealExploitForEnclave,
  submitSealedExploit, type RefuteRound,
} from "../../packages/sdk/src/bounty";
import { verifyEnclaveKeys } from "../../packages/sdk/src/enclave-keys";
import { deploymentFromJson } from "../../packages/sdk/src/network";
import { encodeExploitTx, predicateHash, type Predicate } from "../../packages/sdk/src/predicate";
import { claimDigestOf, normalizeClaim, type Claim, type Refutation } from "../../packages/sdk/src/eip712";

// ---------------------------------------------------------------------------------------------------------------------
// constantes et lectures sans effet de bord (importables par un test)

const ROOT = new URL("../../", import.meta.url);
const ENCLAVE_DIR = fileURLToPath(new URL("../", import.meta.url));
export const DEMO_PRODUCT = 5n;
export const MANIFEST_FILE = "sealed-bounty-refute-demo-v21.json";
export const SITE = "https://archive.62-171-153-35.sslip.io";
export const COMPOSE_FILES = { liar: "refute-demo-liar-v21.yml", honest: "refute-demo-honest-v21.yml" } as const;
export type Role = "A" | "B" | "C";
export const ROLES: readonly Role[] = ["A", "B", "C"];
/** Le service de chaque rôle dans les composes, et la variable CHIFFRÉE qui porte son opérateur. */
export const SERVICE_OF: Record<Role, { compose: keyof typeof COMPOSE_FILES; service: string; allowlistVar: string }> = {
  A: { compose: "liar", service: "sealed-bounty-liar", allowlistVar: "OPERATOR_ALLOWLIST" },
  B: { compose: "honest", service: "sealed-bounty-b", allowlistVar: "OPERATOR_ALLOWLIST_B" },
  C: { compose: "honest", service: "sealed-bounty-c", allowlistVar: "OPERATOR_ALLOWLIST_C" },
};
/** L'opérateur principal de la pile v2.1 (produit 2) : jamais un opérateur de cette démonstration. */
export const MAIN_OPERATOR: Address = "0x344f2d2fA5AeAe78871F0B882245069F887c2e1a";
const USDC6 = 1_000_000n;
const BOND = USDC6; // caution de chaque opérateur de démonstration
const GAS_RESERVE = parseEther("0.6"); // natif d'Arc = USDC à 18 décimales ; inscription DCAP ≈ 6,9 M gas ≈ 0,17 USDC
const HUNTER_GAS = parseEther("0.5");
const VAULT_FUNDING = USDC6;
const POOL = USDC6;
const TIER_MIN_LOSS = USDC6;
const TIER_AMOUNT = USDC6 / 2n;
const MIN_BOND_PER_KEY = 250_000n; // caution réservée par clé d'enclave inscrite (4 clés possibles : redémarrages)
const EXPOSURE_CAP = 10n * USDC6;
const REPLAY_PARAM_TEXT = "arc-foundry v0.8.0-4 arc-anvil --network arc"; // le même moteur que le produit 2

export interface ComposeService {
  image: string;
  measured: Record<string, string>;
  secret: string[];
  /** Variable chiffrée → la variable de la VM qu'elle reprend (OPERATOR_ALLOWLIST → OPERATOR_ALLOWLIST_B…). */
  secretRefs: Record<string, string>;
  ports: string[];
}
export interface Compose { file: string; services: Record<string, ComposeService> }

/** Lit un compose Phala (même lecteur que v21-setup.ts) : services, image, variables mesurées (en clair) et chiffrées (${…}). */
export function parseCompose(file: string, text: string): Compose {
  const services: Record<string, ComposeService> = {};
  let cur: string | null = null;
  let section: "env" | "ports" | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^ {2}[A-Za-z0-9_-]+:$/.test(line)) { cur = line.trim().slice(0, -1); services[cur] = { image: "", measured: {}, secret: [], secretRefs: {}, ports: [] }; section = null; continue; }
    if (!cur) continue;
    const s = services[cur]!;
    const m = line.match(/^ {4}image: (\S+)/);
    if (m) { s.image = m[1]!; section = null; continue; }
    if (/^ {4}environment:/.test(line)) { section = "env"; continue; }
    if (/^ {4}ports:/.test(line)) { section = "ports"; continue; }
    if (/^ {4}\S/.test(line)) { section = null; continue; }
    const item = line.match(/^ {6}- "?([^"]+)"?$/);
    if (!item) continue;
    if (section === "ports") s.ports.push(item[1]!);
    if (section === "env") {
      const [k, ...v] = item[1]!.split("=");
      const val = v.join("=");
      const ref = val.match(/^\$\{(.+)\}$/);
      if (ref) { s.secret.push(k!); s.secretRefs[k!] = ref[1]!; } else s.measured[k!] = val;
    }
  }
  return { file, services };
}

/**
 * Les composes de la démonstration, contrôlés : image épinglée par condensat (plus de __BOUNTY_IMAGE__), la MÊME pour les trois
 * services, produit 5, adresses de la pile, DEMO_FAULT=inflate-loss mesurée pour A seulement, opérateurs en variables chiffrées.
 * Lève une erreur explicite sinon.
 */
export function checkComposes(c: Record<keyof typeof COMPOSE_FILES, Compose>, k: { sealedBounty: Address; registry: Address; chainId: number }): string {
  const fail = (m: string): never => { throw new Error(`composes de la démonstration : ${m}`); };
  const images = new Set<string>();
  for (const role of ROLES) {
    const { compose, service, allowlistVar } = SERVICE_OF[role];
    const s = c[compose].services[service] ?? fail(`${c[compose].file} : service ${service} absent`);
    if (s.image.includes("__BOUNTY_IMAGE__")) fail(`${c[compose].file} : remplacer __BOUNTY_IMAGE__ par le condensat de l'image construite`);
    if (!/^ghcr\.io\/[^@\s]+@sha256:[0-9a-f]{64}$/.test(s.image)) fail(`${c[compose].file} : l'image de ${service} n'est pas épinglée par condensat`);
    images.add(s.image);
    const m = s.measured;
    if (m.PRODUCT_ID !== DEMO_PRODUCT.toString()) fail(`${service} : PRODUCT_ID=${m.PRODUCT_ID} (attendu ${DEMO_PRODUCT})`);
    if (m.CHAIN_ID !== String(k.chainId)) fail(`${service} : CHAIN_ID=${m.CHAIN_ID}`);
    if (m.SEALEDBOUNTY?.toLowerCase() !== k.sealedBounty.toLowerCase()) fail(`${service} : SEALEDBOUNTY n'est pas celui de la v2.1`);
    if (m.REGISTRY?.toLowerCase() !== k.registry.toLowerCase()) fail(`${service} : REGISTRY n'est pas celui de la v2.1`);
    if (role === "A" && m.DEMO_FAULT !== "inflate-loss") fail(`${service} : DEMO_FAULT=inflate-loss doit être mesurée (en clair)`);
    if (role !== "A" && ("DEMO_FAULT" in m || s.secret.includes("DEMO_FAULT"))) fail(`${service} : une enclave honnête ne porte pas DEMO_FAULT`);
    if (s.secret.includes("DEMO_FAULT")) fail(`${service} : DEMO_FAULT ne doit jamais être une variable chiffrée (elle doit être mesurée)`);
    if (s.secretRefs.OPERATOR_ALLOWLIST !== allowlistVar) fail(`${service} : OPERATOR_ALLOWLIST=\${${allowlistVar}} attendu (variable chiffrée de la VM)`);
    if ("OPERATOR_ALLOWLIST" in m) fail(`${service} : OPERATOR_ALLOWLIST ne doit pas être mesurée`);
  }
  if (images.size !== 1) fail(`une seule image attendue pour les trois services (${[...images].join(", ")})`);
  return [...images][0]!;
}

const composeBlock = (c: Compose, service: string) => {
  const s = c.services[service]!;
  return {
    composeFile: `enclave/phala/${c.file}`, service, image: s.image, measuredEnv: s.measured,
    encryptedEnv: s.secret.map((k) => `${k} (from the VM's encrypted variable ${s.secretRefs[k]})`), ports: s.ports,
  };
};

/** Le manifeste public (anglais, pour les juges) du produit 5, écrit depuis les composes réellement lancés. */
export function buildManifest(a: {
  composes: Record<keyof typeof COMPOSE_FILES, Compose>;
  operators: Record<Role, Address>;
  contracts: { SealedBounty: Address; EnclaveRegistry: Address; OperatorBond: Address; VerdictLog: Address; TdxAttestationModule: Address };
  external: { USDC: Address; AutomataDcapAttestationFee: Address; ERC8004_Validation: Address };
}): Record<string, unknown> {
  const K = a.contracts;
  return {
    product: "ArcHive - Sealed Bounty - refutation demo (one image deliberately lies)",
    version: "2.1",
    demonstration: true,
    summary:
      "A separate, labelled demonstration of SealedBounty.refute on Arc testnet. Product 5 is settled by the same SealedBounty contract as the real Sealed Bounty (product 2) and runs the same enclave image, in two Intel TDX VMs for three demo operators. One VM runs the image with DEMO_FAULT=inflate-loss, written in clear in its compose and therefore part of its measured image fingerprint: it signs claims with a DOUBLED loss. The other VM runs the honest image twice. A claim signed by the lying enclave is accepted, then refuted by the honest replays of the two other operators: the liar's operator bond is seized, the reserved payment returns to the bounty pool, and a 'refuted' verdict (0) is written to ERC-8004 for the liar's agent.",
    deliberateFault: {
      variable: "DEMO_FAULT=inflate-loss (measured: compose-hash -> image fingerprint allowed on-chain for product 5)",
      effect:
        "claims are signed with loss = 2 x the loss measured by the replay; everything else (block N, predicate, tier of the MEASURED loss, fingerprint, cPHash, deadline) is what an honest enclave signs. Refutations signed by this enclave are never altered.",
      guards: [
        "the enclave refuses to start with DEMO_FAULT when PRODUCT_ID is 2 (the real Sealed Bounty) or unset",
        `the enclave refuses to start with DEMO_FAULT when OPERATOR_ALLOWLIST is '*' or contains the main operator ${MAIN_OPERATOR}`,
        "/health and /pubkeys announce demoFault",
        "without DEMO_FAULT nothing changes (same code path as product 2)",
      ],
      why: "with a single operator a refutation cannot happen on-chain (it needs at least two OTHER operators); this demo shows the mechanism with three demo operators whose only stake is a 1 USDC bond each",
      transparency: "ALL keys in this demonstration belong to the ArcHive team: the three demo operators (A, B, C), the hunter and the protocol. It demonstrates the on-chain fault-proof and slashing path end to end; it does not demonstrate decentralisation (that needs independent operators).",
    },
    refutationRule:
      "SealedBounty.refute(claim, ops, refutation, signatures), within REFUTE_WINDOW (3 days) of acceptClaim: an EIP-712 Refutation(bytes32 claimDigest,bool proven,uint256 loss,uint8 tier) signed by enclaves active for the product NOW, from at least REFUTE_QUORUM (2) DISTINCT operators, none of them a signer of the claim, and strictly more operators than signed the claim; the refutation must differ from the claim (not proven, or another loss or tier). Effects: every claim operator's whole bond is seized (half to the reporter, half to the protocol) and the operator is banned; the reserved payment returns to the pool if it was not delivered; verdict 0 'tdx-dcap/refuted' in ERC-8004 for the claim operator's agent.",
    flow: [
      "a NEW DemoVault (deliberately vulnerable migrate()) holds 1 USDC; a bounty on product 5: pool 1 USDC, 0.5 USDC for a loss >= 1 USDC (ERC20_DROP on the vault)",
      "the hunter submits migrate(hunter) to the lying enclave (A): it replays it on a fork of Arc at block N, measures 1 USDC and signs a claim for 2 USDC; acceptClaim reserves the payment",
      "before delivery, the protocol asks the three enclaves to replay the claim: A is excluded (claim operator), B and C replay at the same block N and sign Refutation { proven: true, loss: 1 USDC }",
      "refute(claim, [A], refutation, [sigB, sigC]): A's 1 USDC bond is seized and A banned, the payment returns to the pool, ERC-8004 verdict 0 for A's agent",
    ],
    operators: {
      A: { address: a.operators.A, role: "runs the deliberately lying image (DEMO_FAULT=inflate-loss)", bond: "1 USDC" },
      B: { address: a.operators.B, role: "honest replay (honest VM, port 8803)", bond: "1 USDC" },
      C: { address: a.operators.C, role: "honest replay (honest VM, port 8813)", bond: "1 USDC" },
      neverUsed: `the main operator ${MAIN_OPERATOR} (products 1-4) takes no part in this demo`,
    },
    productParameters: {
      settlement: `SealedBounty ${K.SealedBounty} (Arc testnet), the same contract as product 2`,
      deterministic: true,
      minBondPerEnclaveKey: "0.25 USDC",
      exposureCap: "10 USDC per operator per rolling 24 h (and at most half of the bond)",
      operatorBond: `OperatorBond ${K.OperatorBond}`,
      verdicts: `VerdictLog ${K.VerdictLog} -> ERC-8004 validation registry ${a.external.ERC8004_Validation}`,
    },
    replay:
      "arc-anvil from Arc Foundry (circlefin/arc-foundry v0.8.0-4) --network arc: Arc's precompiles (native USDC, blocklist, EIP-7708 logs) without emulation; the exploit runs only in a fork at block N, nothing runs on the real chain",
    exploitTx: "abi.encode(address to, uint256 value, bytes data), sent from the hunter's address",
    fingerprint: "keccak256(abi.encode(keccak256(attackCode), keccak256(tx)[]))",
    build: { context: "enclave/", dockerfile: "enclave/Dockerfile.bounty", base: "node:22-trixie-slim", lockfile: "enclave/package-lock.json", entry: "enclave/products/sealed-bounty/server.ts" },
    code: {
      fault: "enclave/src/services/bounty.ts (BountyServiceConfig.demoFault) and enclave/products/sealed-bounty/demo-fault.ts (guards, announcement)",
      script: "enclave/scripts/refute-demo.ts",
      localProof: "enclave/test/bounty-demo-fault-chain.test.ts (the same flow on a local chain, with the real contracts and the real replay engine)",
    },
    composes: [
      composeBlock(a.composes.liar, SERVICE_OF.A.service),
      composeBlock(a.composes.honest, SERVICE_OF.B.service),
      composeBlock(a.composes.honest, SERVICE_OF.C.service),
    ],
    tee: "Intel TDX confidential VM (dstack) on Phala Cloud",
    verifiedOnArc: `Intel's signature on each TDX quote is checked on-chain by Automata DCAP: TdxAttestationModule ${K.TdxAttestationModule} -> AutomataDcapAttestationFee ${a.external.AutomataDcapAttestationFee}`,
    imageFingerprint:
      "v2.1: the registry replays the dstack RTMR3 event log on-chain (SHA-384), requires it to reproduce the quote's RTMR3, and allows the image by keccak256(MRTD | RTMR0 | RTMR1 | RTMR2 | compose-hash | os-image-hash | XFAM | TDATTRIBUTES); the lying VM and the honest VM have different compose-hashes, hence different fingerprints",
    reportData: "REPORTDATA[0:32] binds chain id, registry, product id, operator, enclave signer and X25519 key; REPORTDATA[32:64] is a recent block hash (EIP-2935)",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// exécution

const chainOf = (rpc: string) =>
  ({ id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }) as const;
const usd = (x: bigint) => `${formatUnits(x, 6)} USDC`;
const native = (x: bigint) => `${formatUnits(x, 18)} USDC`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lower = (a: string) => a.toLowerCase();

interface DemoOperator { address: Address; privateKey: Hex; role: string; agentId?: string }
type Operators = Record<Role, DemoOperator>;

const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const vaultAbi = parseAbi(["function migrate(address to)", "function paused() view returns (bool)"]);
const idAbi = parseAbi([
  "function register(string agentURI) returns (uint256)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const receiveAuthTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Le nom de l'erreur Solidity d'un revert (viem le range dans la cause), ou le texte du message. */
function revertText(e: unknown): string {
  const parts: string[] = [];
  for (let x: any = e, n = 0; x && n < 8; x = x.cause, n++) {
    if (x.data?.errorName) parts.push(String(x.data.errorName));
    if (typeof x.shortMessage === "string") parts.push(x.shortMessage);
    if (typeof x.message === "string") parts.push(x.message);
  }
  return parts.join(" | ");
}

const claimJson = (c: Claim) => ({
  bountyId: c.bountyId.toString(), payee: c.payee, blockN: c.blockN.toString(), blockHashN: c.blockHashN, predicateHash: c.predicateHash,
  loss: c.loss.toString(), tier: c.tier, fingerprint: c.fingerprint, cPHash: c.cPHash, deadline: c.deadline.toString(),
});
const refutationJson = (f: Refutation) => ({ claimDigest: f.claimDigest, proven: f.proven, loss: f.loss.toString(), tier: f.tier });

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const KEYS_ONLY = args.has("--keys");
  const DRY = args.has("--dry");
  const DEPLOYMENTS = process.env.DEPLOYMENTS ?? "deployments.v21.testnet.json";
  if (!/v21/.test(DEPLOYMENTS)) throw new Error("DEPLOYMENTS doit être la pile v2.1 (deployments.v21.testnet.json) : ce script ne touche pas les autres piles");
  const DEPLOY_URL = new URL(DEPLOYMENTS, ROOT);
  const readDeployments = () => JSON.parse(readFileSync(DEPLOY_URL, "utf8"));
  const D = readDeployments();
  const K = D.contracts as Record<string, Address>;
  const X = D.external as Record<string, Address>;
  const CHAIN_ID = Number(D.chainId);
  if (CHAIN_ID !== 5042002) throw new Error(`chainId ${CHAIN_ID} : Arc testnet attendu`);
  const RPC = String(D.rpc ?? "https://rpc.testnet.arc.io");
  const EXPLORER = String(D.explorer ?? "https://explorer.testnet.arc.io");
  const chain = chainOf(RPC);
  const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 6, retryDelay: 800, timeout: 60_000 }) }) as PublicClient;
  const dep = deploymentFromJson(D);
  const out = (name: string): { abi: Abi; bytecode: { object: Hex } } => JSON.parse(readFileSync(new URL(`contracts/out/${name}.sol/${name}.json`, ROOT), "utf8"));
  const sbAbi = out("SealedBounty").abi, obAbi = out("OperatorBond").abi, prAbi = out("ProductRegistry").abi;
  const erAbi = out("EnclaveRegistry").abi, vlAbi = out("VerdictLog").abi;
  const SEC = (f: string) => new URL(`.secrets/${f}`, ROOT);
  const writeSecret = (f: string, v: unknown) => { writeFileSync(SEC(f), JSON.stringify(v, null, 2), { mode: 0o600 }); chmodSync(SEC(f), 0o600); };
  const readSecret = (f: string) => JSON.parse(readFileSync(SEC(f), "utf8"));

  // ---- garde-fous des rôles : l'opérateur principal n'est JAMAIS un opérateur de la démonstration ----
  const mainOps = new Set([lower(MAIN_OPERATOR)]);
  for (const m of String(D.roles?.operator ?? "").match(/0x[0-9a-fA-F]{40}/g) ?? []) mainOps.add(lower(m));
  const deployerAddr = getAddress(String(D.deployer));
  const HF = SEC("hunter.json");
  const hunterAddrIfAny = existsSync(HF) ? (readSecret("hunter.json").address as Address | undefined) : undefined;

  // ---- (a) les clés A, B, C ----
  const OPF = "demo-operators.json";
  if (!existsSync(SEC(OPF))) {
    const mk = (role: Role, what: string): DemoOperator => {
      const pk = generatePrivateKey();
      return { address: privateKeyToAccount(pk).address, privateKey: pk, role: `opérateur de démonstration ${role} (réfutation, produit ${DEMO_PRODUCT}) : ${what}` };
    };
    writeSecret(OPF, {
      note: "Opérateurs de la DÉMONSTRATION de la réfutation (scripts/refute-demo.ts). Jamais l'opérateur principal. Caution : 1 USDC chacun.",
      A: mk("A", "fait tourner l'image VOLONTAIREMENT menteuse (DEMO_FAULT=inflate-loss) ; sa caution sera saisie"),
      B: mk("B", "rejeu honnête"),
      C: mk("C", "rejeu honnête"),
    });
    console.log(`(a) clés d'opérateur de démonstration créées : .secrets/${OPF} (0600)`);
  }
  const opsFile = readSecret(OPF);
  const ops = {} as Operators;
  for (const r of ROLES) {
    const o = opsFile[r] as DemoOperator | undefined;
    if (!o?.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(o.privateKey)) throw new Error(`.secrets/${OPF} : clé ${r} absente ou illisible`);
    const addr = privateKeyToAccount(o.privateKey).address;
    if (o.address && lower(o.address) !== lower(addr)) throw new Error(`.secrets/${OPF} : l'adresse de ${r} ne correspond pas à sa clé`);
    ops[r] = { ...o, address: addr };
  }
  const forbidden = new Map<string, string>([...mainOps].map((m) => [m, "l'opérateur principal"]));
  forbidden.set(lower(deployerAddr), "le déployeur");
  if (hunterAddrIfAny) forbidden.set(lower(hunterAddrIfAny), "le chasseur");
  const seenOps = new Set<string>();
  for (const r of ROLES) {
    const a = lower(ops[r].address);
    if (forbidden.has(a)) throw new Error(`REFUS : l'opérateur de démonstration ${r} (${ops[r].address}) est ${forbidden.get(a)}`);
    if (seenOps.has(a)) throw new Error(`REFUS : deux rôles de démonstration ont la même adresse (${ops[r].address})`);
    seenOps.add(a);
  }
  console.log(`opérateurs de démonstration : A ${ops.A.address} (image menteuse), B ${ops.B.address}, C ${ops.C.address}`);
  if (KEYS_ONLY) {
    console.log("\nvariables CHIFFRÉES à donner aux VM (Phala, allowed_envs ; jamais mesurées) :");
    console.log(`  VM menteuse  (enclave/phala/${COMPOSE_FILES.liar})  : OPERATOR_ALLOWLIST=${ops.A.address}`);
    console.log(`  VM honnête   (enclave/phala/${COMPOSE_FILES.honest}) : OPERATOR_ALLOWLIST_B=${ops.B.address}  OPERATOR_ALLOWLIST_C=${ops.C.address}`);
    return;
  }

  // ---- l'état de la démonstration (reprise) : deployments.v21.testnet.json, clé "refuteDemo" ----
  const S: any = D.refuteDemo ?? {
    status: "in-progress",
    note: "Démonstration SÉPARÉE et étiquetée de SealedBounty.refute (produit 5, une image volontairement menteuse) : scripts/refute-demo.ts. Opérateurs de démonstration A, B, C ; jamais l'opérateur principal.",
    startedAt: new Date().toISOString(),
    transactions: [],
  };
  S.transactions ??= [];
  for (const r of ROLES) {
    const prev = S.operators?.[r]?.address as string | undefined;
    if (prev && lower(prev) !== lower(ops[r].address)) {
      throw new Error(`"refuteDemo" de ${DEPLOYMENTS} a été écrit avec une autre clé ${r} (${prev}) que .secrets/${OPF} (${ops[r].address}) : rien n'est repris`);
    }
  }
  const save = () => {
    if (DRY) return;
    S.updatedAt = new Date().toISOString();
    const cur = readDeployments();
    cur.refuteDemo = S;
    writeFileSync(DEPLOY_URL, JSON.stringify(cur, null, 1));
  };
  const record = (step: string, label: string, r: TransactionReceipt) => {
    const cost = r.gasUsed * (r.effectiveGasPrice ?? 0n);
    console.log(`  [${step}] ${label} : ${r.transactionHash} (statut ${r.status}, gas ${r.gasUsed}, ${native(cost)} de gas) ${EXPLORER}/tx/${r.transactionHash}`);
    S.transactions.push({ step, label, hash: r.transactionHash, status: r.status, block: r.blockNumber.toString(), gasUsed: r.gasUsed.toString(), gasCostUsdc: formatUnits(cost, 18) });
    save();
  };

  // ---- déjà faite : on vérifie, on affiche, on s'arrête (le manifeste on-chain n'est plus touché) ----
  if (S.status === "done" && S.claim?.digest) {
    const [, refuted] = (await pub.readContract({ address: K.SealedBounty!, abi: sbAbi, functionName: "claimRecords", args: [S.claim.digest] })) as [bigint, boolean, Hex];
    console.log(`\ndémonstration déjà faite (réclamation ${S.claim.digest} réfutée on-chain : ${refuted}) ; résumé dans ${DEPLOYMENTS}, clé "refuteDemo".`);
    printSummary(S, EXPLORER);
    return;
  }

  // ---- composes et manifeste ----
  const composes = {
    liar: parseCompose(COMPOSE_FILES.liar, readFileSync(new URL(`enclave/phala/${COMPOSE_FILES.liar}`, ROOT), "utf8")),
    honest: parseCompose(COMPOSE_FILES.honest, readFileSync(new URL(`enclave/phala/${COMPOSE_FILES.honest}`, ROOT), "utf8")),
  };
  const image = checkComposes(composes, { sealedBounty: K.SealedBounty!, registry: K.EnclaveRegistry!, chainId: CHAIN_ID });
  const manifestBody = JSON.stringify(buildManifest({
    composes, operators: { A: ops.A.address, B: ops.B.address, C: ops.C.address },
    contracts: { SealedBounty: K.SealedBounty!, EnclaveRegistry: K.EnclaveRegistry!, OperatorBond: K.OperatorBond!, VerdictLog: K.VerdictLog!, TdxAttestationModule: K.TdxAttestationModule! },
    external: { USDC: X.USDC!, AutomataDcapAttestationFee: X.AutomataDcapAttestationFee!, ERC8004_Validation: X.ERC8004_Validation! },
  }), null, 2) + "\n";
  writeFileSync(new URL(`web/public/manifests/${MANIFEST_FILE}`, ROOT), manifestBody);
  const manifestHash = keccak256(toBytes(manifestBody));
  const manifestURI = `${SITE}/manifests/${MANIFEST_FILE}`;
  console.log(`manifeste écrit : web/public/manifests/${MANIFEST_FILE} (${manifestHash}) ; image ${image}`);

  // ---- les enclaves : santé, faute annoncée, clés ----
  const urls = {} as Record<Role, string>;
  for (const [r, v] of [["A", "LIAR_URL"], ["B", "B_URL"], ["C", "C_URL"]] as const) {
    const u = (process.env[v] ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(u)) throw new Error(`${v} requis (URL de l'enclave ${r}) ; les clés A, B, C : npx tsx scripts/refute-demo.ts --keys`);
    urls[r] = u;
  }
  if (new Set(Object.values(urls)).size !== 3) throw new Error("LIAR_URL, B_URL et C_URL doivent être trois enclaves différentes");
  const probe = async (r: Role) => {
    const get = async (p: string) => {
      const res = await fetch(`${urls[r]}${p}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`${urls[r]}${p} : HTTP ${res.status}`);
      return (await res.json()) as any;
    };
    const [health, pk] = [await get("/health"), await get("/pubkeys")];
    if (r === "A" && health.demoFault !== "inflate-loss") throw new Error(`LIAR_URL (${urls.A}) n'annonce pas DEMO_FAULT=inflate-loss sur /health : ce n'est pas l'enclave menteuse, arrêt`);
    if (r !== "A" && health.demoFault !== undefined) throw new Error(`${r === "B" ? "B_URL" : "C_URL"} annonce une faute (${health.demoFault}) : une enclave honnête est attendue, arrêt`);
    if (!isAddress(String(pk.signer))) throw new Error(`${urls[r]}/pubkeys : signataire illisible`);
    const signer = getAddress(lower(pk.signer));
    const e = (await pub.readContract({ address: K.EnclaveRegistry!, abi: erAbi, functionName: "enclaveOf", args: [signer] })) as any;
    if (e.signer !== zeroAddress && mainOps.has(lower(e.operator))) throw new Error(`REFUS : l'enclave ${r} (${signer}) est inscrite sous l'opérateur principal`);
    if (e.signer !== zeroAddress && (BigInt(e.productId) !== DEMO_PRODUCT || lower(e.operator) !== lower(ops[r].address))) {
      throw new Error(`REFUS : la clé de l'enclave ${r} (${signer}) est inscrite pour le produit ${e.productId} sous ${e.operator}, pas pour la démonstration`);
    }
    console.log(`  enclave ${r} ${urls[r]} : signataire ${signer}${health.demoFault ? ` — demoFault ${health.demoFault} (annoncée)` : " — honnête"}`);
    return { signer, x25519: lower(String(pk.x25519)) as Hex };
  };
  console.log("\n== enclaves ==");
  const keys = { A: await probe("A"), B: await probe("B"), C: await probe("C") };
  if (new Set(ROLES.map((r) => lower(keys[r].signer))).size !== 3) throw new Error("les trois URL servent des clés d'enclave identiques");

  const read = (address: Address, abi: Abi, functionName: string, args: unknown[] = [], blockNumber?: bigint) =>
    pub.readContract({ address, abi, functionName, args, ...(blockNumber !== undefined ? { blockNumber } : {}) } as any) as Promise<any>;
  const usdcOf = (a: Address, blockNumber?: bigint) => read(X.USDC!, usdcAbi as Abi, "balanceOf", [a], blockNumber) as Promise<bigint>;
  const bondOf = async (r: Role) => (await read(K.OperatorBond!, obAbi, "bondOf", [ops[r].address])) as bigint;
  const banned = async (r: Role) => (await read(K.OperatorBond!, obAbi, "banned", [ops[r].address])) as boolean;
  /** Ce que l'opérateur doit avoir en natif : réserve de gas + la part de caution qui manque (USDC 6 → 18 décimales). */
  const fundingTarget = async (r: Role) => {
    const have = await bondOf(r);
    return GAS_RESERVE + (BOND > have ? (BOND - have) * 10n ** 12n : 0n);
  };

  // ---- soldes : le déployeur peut-il tout payer ? (rien n'est envoyé avant ce contrôle) ----
  let need = 0n;
  for (const r of ROLES) {
    if (await banned(r)) throw new Error(`l'opérateur de démonstration ${r} est déjà radié (démonstration faite avec cette clé ?) : voir "refuteDemo" de ${DEPLOYMENTS}`);
    const target = await fundingTarget(r);
    const bal = await pub.getBalance({ address: ops[r].address });
    if (bal < target) need += target - bal;
  }
  if (!hunterAddrIfAny || (await pub.getBalance({ address: hunterAddrIfAny })) < parseEther("0.3")) need += HUNTER_GAS;
  if (!S.bounty?.id) need += (VAULT_FUNDING + POOL) * 10n ** 12n + parseEther("0.3");
  const deployerBal = await pub.getBalance({ address: deployerAddr });
  console.log(`\nsoldes : déployeur ${native(deployerBal)} ; à engager au plus ≈ ${native(need)} (dotations, coffre, cagnotte, gas)`);
  if (deployerBal < need + parseEther("0.5")) throw new Error(`solde du déployeur insuffisant (${native(deployerBal)} < ${native(need + parseEther("0.5"))}) : rien n'a été envoyé`);

  if (DRY) {
    console.log("\n--dry : contrôles faits, manifeste écrit ; aucune transaction, aucune clé lue hors des opérateurs de démonstration. État actuel :");
    printSummary(S, EXPLORER);
    return;
  }

  // ---- les acteurs (clés lues seulement maintenant) ----
  const deployer = privateKeyToAccount(readSecret("deployer.json").privateKey as Hex);
  if (lower(deployer.address) !== lower(deployerAddr)) throw new Error(".secrets/deployer.json n'est pas le déployeur de la v2.1");
  if (!existsSync(HF)) {
    const pk = generatePrivateKey();
    writeSecret("hunter.json", { address: privateKeyToAccount(pk).address, privateKey: pk, role: "chasseur de démonstration" });
  }
  const hunter = privateKeyToAccount(readSecret("hunter.json").privateKey as Hex);
  if (seenOps.has(lower(hunter.address)) || mainOps.has(lower(hunter.address))) throw new Error("REFUS : le chasseur est un opérateur");
  const opAcct = { A: privateKeyToAccount(ops.A.privateKey), B: privateKeyToAccount(ops.B.privateKey), C: privateKeyToAccount(ops.C.privateKey) };
  const wallet = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain, transport: http(RPC) });
  type Wallet = ReturnType<typeof wallet>;
  const asDeployer = wallet(deployer), asHunter = wallet(hunter);
  const asOp = { A: wallet(opAcct.A), B: wallet(opAcct.B), C: wallet(opAcct.C) };
  console.log(`chasseur ${hunter.address} ; protocole, auteur et dénonciateur : le déployeur ${deployer.address}`);

  const send = async (w: Wallet, address: Address, abi: Abi, functionName: string, args: unknown[], step: string, label: string, gasMargin?: number) => {
    const { request } = await pub.simulateContract({ account: w.account, address, abi, functionName, args } as any);
    let gas: bigint | undefined;
    if (gasMargin) gas = (BigInt(await pub.estimateContractGas({ account: w.account, address, abi, functionName, args } as any)) * BigInt(Math.round(gasMargin * 100))) / 100n;
    const hash = await w.writeContract({ ...(request as any), ...(gas ? { gas } : {}) });
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    record(step, label, r);
    if (r.status !== "success") throw new Error(`${label} a échoué (${hash})`);
    return r;
  };
  const sendValue = async (w: Wallet, to: Address, value: bigint, step: string, label: string) => {
    const hash = await w.sendTransaction({ to, value } as any);
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    record(step, label, r);
    if (r.status !== "success") throw new Error(`${label} a échoué (${hash})`);
    return r;
  };
  save();

  // ---- (a) dotations ----
  console.log("\n== (a) dotation des opérateurs de démonstration (gas + caution 1 USDC) ==");
  for (const r of ROLES) {
    const target = await fundingTarget(r);
    const bal = await pub.getBalance({ address: ops[r].address });
    if (bal >= target) { console.log(`  ${r} : ${native(bal)}, suffisant`); continue; }
    await sendValue(asDeployer, ops[r].address, target - bal, "a", `opérateur ${r} doté de ${native(target - bal)}`);
  }

  // ---- (b) identité ERC-8004, VerdictLog, caution, agentId ----
  console.log("\n== (b) opérateurs : identité ERC-8004, VerdictLog autorisé, caution 1 USDC (EIP-3009), agentId ==");
  S.operators ??= {};
  for (const r of ROLES) {
    const o = ops[r];
    const w = asOp[r];
    let agentId = o.agentId !== undefined ? BigInt(o.agentId) : undefined;
    if (agentId !== undefined && lower((await read(X.ERC8004_Identity!, idAbi as Abi, "ownerOf", [agentId])) as string) !== lower(o.address)) {
      throw new Error(`agent ERC-8004 ${agentId} de ${r} : ${o.address} n'en est pas propriétaire`);
    }
    if (agentId === undefined) {
      const card = {
        type: "agent",
        name: `ArcHive refutation demo - operator ${r}${r === "A" ? " (runs the deliberately lying image)" : ""}`,
        description: `Demo operator of product ${DEMO_PRODUCT} (Sealed Bounty refutation demo) on Arc testnet; 1 USDC bond in OperatorBond.`,
        url: `${SITE}/manifests/${MANIFEST_FILE}`,
      };
      const uri = "data:application/json;base64," + Buffer.from(JSON.stringify(card)).toString("base64");
      const rec = await send(w, X.ERC8004_Identity!, idAbi as Abi, "register", [uri], "b", `${r} : identité ERC-8004 créée`);
      const t = parseEventLogs({ abi: idAbi, logs: rec.logs, eventName: "Transfer" }).find((l) => lower(l.address) === lower(X.ERC8004_Identity!) && lower(l.args.to) === lower(o.address));
      if (!t) throw new Error(`${r} : identité ERC-8004 créée, mais aucun Transfer vers l'opérateur dans le reçu`);
      agentId = t.args.tokenId;
      o.agentId = agentId.toString();
      opsFile[r] = { ...opsFile[r], agentId: o.agentId };
      writeSecret(OPF, opsFile);
    }
    if (!(await read(X.ERC8004_Identity!, idAbi as Abi, "isApprovedForAll", [o.address, K.VerdictLog!]))) {
      await send(w, X.ERC8004_Identity!, idAbi as Abi, "setApprovalForAll", [K.VerdictLog!, true], "b", `${r} : VerdictLog autorisé à écrire ses verdicts`);
    }
    const have = await bondOf(r);
    if (have < BOND) {
      const value = BOND - have;
      const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const signature = await opAcct[r].signTypedData({
        domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: X.USDC! }, types: receiveAuthTypes, primaryType: "ReceiveWithAuthorization",
        message: { from: o.address, to: K.OperatorBond!, value, validAfter: 0n, validBefore, nonce },
      });
      await send(w, K.OperatorBond!, obAbi, "bond", [value, { validAfter: 0n, validBefore, nonce, signature }], "b", `${r} : caution +${usd(value)}`);
    }
    if (((await read(K.OperatorBond!, obAbi, "agentIdOf", [o.address])) as bigint) !== agentId) {
      await send(w, K.OperatorBond!, obAbi, "setAgentId", [agentId], "b", `${r} : agentId ${agentId} déclaré dans OperatorBond`);
    }
    S.operators[r] = { address: o.address, agentId: agentId.toString(), bond: usd(await bondOf(r)), role: r === "A" ? "lying image (DEMO_FAULT=inflate-loss)" : "honest replay" };
    console.log(`  ${r} prêt : agent ERC-8004 ${agentId}, caution ${usd(await bondOf(r))}`);
  }
  save();

  // ---- (c) le produit 5 ----
  console.log(`\n== (c) produit ${DEMO_PRODUCT} « Sealed Bounty — refutation demo » (auteur : déployeur, réglé par SealedBounty) ==`);
  const param = keccak256(toBytes(REPLAY_PARAM_TEXT));
  const count = (await read(K.ProductRegistry!, prAbi, "productCount")) as bigint;
  if (count < DEMO_PRODUCT - 1n) throw new Error(`productCount = ${count} : les produits 1 à ${DEMO_PRODUCT - 1n} de la v2.1 devraient exister`);
  if (count === DEMO_PRODUCT - 1n) {
    const rec = await send(asDeployer, K.ProductRegistry!, prAbi, "propose", [{
      manifestHash, manifestURI, workloadIds: [], deterministic: true, price: 0n, bpsOperator: 9500, bpsAuthor: 0, bpsNetwork: 500,
      minBond: MIN_BOND_PER_KEY, exposureCap: EXPOSURE_CAP, settlement: K.SealedBounty!, param, advisoryIds: [], unitTokens: 1, outWeight: 1,
    }], "c", `produit ${DEMO_PRODUCT} proposé (manifeste ${manifestHash})`);
    const ev = parseEventLogs({ abi: prAbi, logs: rec.logs, eventName: "ProductProposed" })[0] as any;
    if (BigInt(ev?.args?.productId ?? 0) !== DEMO_PRODUCT) throw new Error(`le produit créé porte le n° ${ev?.args?.productId} (attendu ${DEMO_PRODUCT}) : composes à corriger`);
  }
  const p = (await read(K.ProductRegistry!, prAbi, "getProduct", [DEMO_PRODUCT])) as any;
  if (lower(p.author) !== lower(deployer.address) || lower(p.settlement) !== lower(K.SealedBounty!)) {
    throw new Error(`le produit ${DEMO_PRODUCT} n'est pas celui de la démonstration (auteur ${p.author}, règlement ${p.settlement}) : changer PRODUCT_ID des composes`);
  }
  if (Number(p.state) === 1) await send(asDeployer, K.ProductRegistry!, prAbi, "activate", [DEMO_PRODUCT], "c", `produit ${DEMO_PRODUCT} activé`); // State : None, Proposed, Active, Retired
  if (lower(p.manifestHash) !== lower(manifestHash)) {
    console.log(`  le manifeste on-chain (${p.manifestHash}) diffère du manifeste écrit : mise à jour (timelock 0 sur testnet)`);
    await send(asDeployer, K.ProductRegistry!, prAbi, "proposeUpdate", [DEMO_PRODUCT, manifestHash, 0n, param], "c", `produit ${DEMO_PRODUCT} : mise à jour du manifeste proposée`);
    await send(asDeployer, K.ProductRegistry!, prAbi, "applyUpdate", [DEMO_PRODUCT], "c", `produit ${DEMO_PRODUCT} : manifeste mis à jour`);
  }
  if (!(await read(K.ProductRegistry!, prAbi, "isActive", [DEMO_PRODUCT]))) throw new Error(`produit ${DEMO_PRODUCT} inactif`);
  S.product = { id: DEMO_PRODUCT.toString(), manifest: `web/public/manifests/${MANIFEST_FILE}`, manifestURI, manifestHash, image, minBondPerKey: usd(MIN_BOND_PER_KEY), settlement: K.SealedBounty };
  save();

  // ---- (d) inscription DCAP des trois enclaves, chacune par SON opérateur (scripts/register-dcap.ts) ----
  console.log("\n== (d) inscription DCAP des enclaves (chacune par son opérateur ; l'auteur autorise l'empreinte d'image) ==");
  S.enclaves ??= {};
  const TSX_CLI = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
  if (!existsSync(TSX_CLI)) throw new Error("tsx introuvable (enclave/node_modules) : npm ci dans enclave/");
  for (const r of ROLES) {
    const head = await pub.getBlockNumber();
    const isActive = async () => lower((await read(K.EnclaveRegistry!, erAbi, "activeOperatorAt", [keys[r].signer, DEMO_PRODUCT, await pub.getBlockNumber()])) as string) === lower(ops[r].address);
    const e0 = (await read(K.EnclaveRegistry!, erAbi, "enclaveOf", [keys[r].signer])) as any;
    if ((await isActive()) && lower(e0.x25519) === keys[r].x25519) {
      console.log(`  ${r} : déjà inscrite et active (signataire ${keys[r].signer}, opérateur ${ops[r].address}, fenêtre ${e0.fromBlock}→${e0.untilBlock}, tête ${head})`);
    } else {
      if (mainOps.has(lower(ops[r].address))) throw new Error("REFUS : opérateur principal"); // déjà exclu au (a) ; ceinture et bretelles
      const tmpName = `refute-demo-operator-${r}.tmp.json`;
      writeSecret(tmpName, { address: ops[r].address, privateKey: ops[r].privateKey, role: `temporaire : inscription DCAP de l'enclave ${r} (effacé ensuite)` });
      let output: string;
      try {
        output = await runChild(TSX_CLI, ["scripts/register-dcap.ts"], {
          ...process.env, ENCLAVE_URL: urls[r], PRODUCT_ID: DEMO_PRODUCT.toString(), DEPLOYMENTS, OPERATOR_KEY_FILE: tmpName, AUTHOR_KEY_FILE: "deployer.json",
        }, `register-dcap ${r}`);
      } finally {
        try { unlinkSync(SEC(tmpName)); } catch { /* déjà effacé */ }
      }
      for (const m of output.matchAll(/^(.+?) : (0x[0-9a-fA-F]{64}) \(statut/gm)) {
        const rec = await pub.getTransactionReceipt({ hash: m[2] as Hex });
        record("d", `${r} : ${m[1]!.trim()}`, rec);
      }
      const img = output.match(/empreinte d'IMAGE[^:]*: (0x[0-9a-fA-F]{64})/)?.[1];
      if (img) S.enclaves[r] = { ...(S.enclaves[r] ?? {}), imageId: img };
      if (!(await isActive())) throw new Error(`l'enclave ${r} n'est pas active pour le produit ${DEMO_PRODUCT} sous ${ops[r].address} après l'inscription`);
    }
    const e = (await read(K.EnclaveRegistry!, erAbi, "enclaveOf", [keys[r].signer])) as any;
    S.enclaves[r] = {
      ...(S.enclaves[r] ?? {}), url: urls[r], service: SERVICE_OF[r].service, compose: `enclave/phala/${COMPOSE_FILES[SERVICE_OF[r].compose]}`,
      signer: keys[r].signer, x25519: keys[r].x25519, operator: ops[r].address, workloadId: e.workloadId, fromBlock: String(e.fromBlock), untilBlock: String(e.untilBlock),
      demoFault: r === "A" ? "inflate-loss" : null,
    };
    save();
  }

  // ---- (e) le coffre de démonstration et la prime ----
  console.log("\n== (e) le protocole (déployeur) : un NOUVEAU DemoVault doté de 1 USDC, une prime sur le produit 5 ==");
  const RUNF = "refute-demo.json";
  const run: any = existsSync(SEC(RUNF)) ? readSecret(RUNF) : {};
  const saveRun = () => writeSecret(RUNF, run);
  if (!S.vault?.address || (await pub.getCode({ address: S.vault.address })) === undefined) {
    const v = out("DemoVault");
    const hash = await asDeployer.deployContract({ abi: v.abi, bytecode: v.bytecode.object, args: [X.USDC!] } as any);
    const rec = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    record("e", "DemoVault de démonstration déployé (faille volontaire : migrate sans contrôle d'accès)", rec);
    if (rec.status !== "success" || !rec.contractAddress) throw new Error("déploiement du DemoVault : échec");
    S.vault = { address: rec.contractAddress, deployTx: hash };
    save();
  }
  const vault = getAddress(S.vault.address) as Address;
  if (!S.claim?.acceptTx) {
    const bal = await usdcOf(vault);
    if (bal < VAULT_FUNDING) {
      const rec = await send(asDeployer, X.USDC!, usdcAbi as Abi, "transfer", [vault, VAULT_FUNDING - bal], "e", `coffre doté de ${usd(VAULT_FUNDING - bal)} (vrais fonds)`);
      S.vault.fundTx = rec.transactionHash;
      S.vault.fundBlock = rec.blockNumber.toString();
      save();
    }
  }
  console.log(`  coffre ${vault} : ${usd(await usdcOf(vault))}`);
  if (!run.protocolX25519) {
    const priv = x25519.utils.randomPrivateKey();
    run.protocolX25519 = { privateKey: toHex(priv), publicKey: toHex(x25519.getPublicKey(priv)), note: "clé X25519 de la prime de démonstration (protocole)" };
    saveRun();
  }
  const predicate: Predicate = { combine: "OR", clauses: [{ type: "ERC20_DROP", token: X.USDC!, holder: vault, min: TIER_MIN_LOSS.toString() }] };
  let bountyId: bigint | undefined = S.bounty?.id ? BigInt(S.bounty.id) : undefined;
  if (bountyId !== undefined) {
    const b = (await read(K.SealedBounty!, sbAbi, "getBounty", [bountyId])) as any;
    if (lower(b.protocol) !== lower(deployer.address) || BigInt(b.productId) !== DEMO_PRODUCT || lower(b.protocolX25519) !== lower(run.protocolX25519.publicKey)) {
      throw new Error(`prime n° ${bountyId} de l'état : ce n'est pas celle de la démonstration`);
    }
  } else {
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await deployer.signTypedData({
      domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: X.USDC! }, types: receiveAuthTypes, primaryType: "ReceiveWithAuthorization",
      message: { from: deployer.address, to: K.SealedBounty!, value: POOL, validAfter: 0n, validBefore, nonce },
    });
    const q = {
      productId: DEMO_PRODUCT, predicateHash: predicateHash(predicate), protocolX25519: run.protocolX25519.publicKey as Hex,
      tierMinLoss: [TIER_MIN_LOSS], tierAmount: [TIER_AMOUNT], singleCap: TIER_AMOUNT, k: 1, targetToPause: vault,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400), funding: POOL, auth: { validAfter: 0n, validBefore, nonce, signature },
    };
    const rec = await send(asDeployer, K.SealedBounty!, sbAbi, "createBounty", [q], "e", `prime publiée sur le produit ${DEMO_PRODUCT} (cagnotte 1 USDC, palier 0,5 USDC pour une perte ≥ 1 USDC)`);
    const ev = parseEventLogs({ abi: sbAbi, logs: rec.logs, eventName: "BountyCreated" })[0] as any;
    bountyId = BigInt(ev.args.bountyId);
    S.bounty = {
      id: bountyId.toString(), productId: DEMO_PRODUCT.toString(), createTx: rec.transactionHash, block: rec.blockNumber.toString(),
      pool: usd(POOL), tier: `${usd(TIER_AMOUNT)} for a loss >= ${usd(TIER_MIN_LOSS)}`, predicate, predicateHash: q.predicateHash,
      protocolX25519: q.protocolX25519, targetToPause: vault,
    };
    save();
  }
  console.log(`  prime n° ${bountyId} (produit ${DEMO_PRODUCT}) sur le coffre ${vault}`);

  // ---- (f) le chasseur soumet l'exploit à l'enclave MENTEUSE ; acceptClaim ----
  console.log("\n== (f) le chasseur → l'enclave MENTEUSE (A) : réclamation, puis acceptClaim ==");
  if ((await pub.getBalance({ address: hunter.address })) < parseEther("0.3")) {
    await sendValue(asDeployer, hunter.address, HUNTER_GAS, "f", `chasseur doté pour le gas (${native(HUNTER_GAS)})`);
  }
  const bountyOnChain = (await read(K.SealedBounty!, sbAbi, "getBounty", [bountyId])) as any;
  const protocolX25519 = bountyOnChain.protocolX25519 as Hex; // lue on-chain, jamais d'un serveur
  const exploitOf = (attempt: number) => {
    const data = encodeFunctionData({ abi: vaultAbi, functionName: "migrate", args: [hunter.address] });
    // tentative > 0 (réclamation précédente expirée avant acceptClaim) : 32 octets ignorés par migrate en fin de calldata →
    // autre empreinte (l'enclave ne signe jamais deux réclamations différentes pour la même empreinte)
    const txData = (attempt === 0 ? data : `${data}${attempt.toString(16).padStart(64, "0")}`) as Hex;
    return { predicate, txs: [encodeExploitTx({ to: vault, data: txData })], capital: 0n };
  };
  let accepted0 = S.claim?.digest
    ? ((await read(K.SealedBounty!, sbAbi, "claimRecords", [S.claim.digest])) as [bigint, boolean, Hex])
    : undefined;
  // reprise : une réclamation signée (secrets de la démonstration) a-t-elle été acceptée sans que l'état ait pu le noter ?
  if ((!accepted0 || accepted0[0] === 0n) && run.claim) {
    const c = normalizeClaim(run.claim);
    const d = claimDigestOf(K.SealedBounty!, c, CHAIN_ID);
    const rec0 = (await read(K.SealedBounty!, sbAbi, "claimRecords", [d])) as [bigint, boolean, Hex];
    if (rec0[0] !== 0n) {
      const acc = await readAcceptedClaim(pub as any, { claimDigest: d, deployment: dep, fromBlock: BigInt(S.bounty.block) });
      S.claim = {
        digest: d, claim: claimJson(c), signer: run.signer ?? null, operators: acc.operators, amount: usd(acc.amount), claimedLoss: usd(c.loss),
        vaultBalanceAtN: null, attempt: Number(run.hunter?.attempt ?? 0), acceptTx: acc.txHash, acceptBlock: acc.block.toString(),
      };
      save();
      accepted0 = rec0;
      console.log(`  réclamation ${d} retrouvée on-chain (acceptée, tx ${acc.txHash})`);
    }
  }
  if (!accepted0 || accepted0[0] === 0n) {
    // le bloc N (tête − 2) doit voir le coffre doté, la prime et l'enclave A inscrite
    const eA = (await read(K.EnclaveRegistry!, erAbi, "enclaveOf", [keys.A.signer])) as any;
    const minN = [BigInt(S.vault.fundBlock ?? 0), BigInt(S.bounty.block ?? 0), BigInt(eA.fromBlock)].reduce((a, b) => (a > b ? a : b));
    while ((await pub.getBlockNumber()) < minN + 3n) await sleep(1_000);
    run.hunter ??= { attempt: 0 };
    for (let tries = 0; ; tries++) {
      const attempt = Number(run.hunter.attempt ?? 0);
      run.hunter.r ??= toHex(crypto.getRandomValues(new Uint8Array(32))); // gardé AVANT l'envoi : la source « chasseur » en a besoin
      saveRun();
      const enclave = await verifyEnclaveKeys(urls.A, DEMO_PRODUCT, { publicClient: pub as any, deployment: dep });
      if (lower(enclave.operator) !== lower(ops.A.address)) throw new Error(`l'enclave menteuse est active pour ${enclave.operator}, pas pour A`);
      console.log(`  clé de l'enclave menteuse vérifiée sur Arc : signataire ${enclave.signer}, opérateur A ${enclave.operator}`);
      const sealed = await sealExploitForEnclave({
        bountyId: bountyId!, payee: hunter.address, exploit: exploitOf(attempt), protocolX25519, enclave, r: toBytes(run.hunter.r as Hex),
      });
      const t0 = Date.now();
      const proven = await submitSealedExploit(sealed, { sealedBounty: K.SealedBounty!, chainId: CHAIN_ID, timeoutMs: 600_000 });
      run.claim = claimJson(proven.claim);
      run.signature = proven.signature;
      run.signer = proven.signer;
      run.cP = proven.cP;
      saveRun();
      let atN: bigint | undefined;
      try { atN = await usdcOf(vault, proven.claim.blockN); } catch { atN = undefined; } // RPC sans l'état du bloc N : on le dit
      console.log(`  enclave A : exploit rejoué au bloc ${proven.claim.blockN} en ${Date.now() - t0} ms ; réclamation signée : perte ${usd(proven.claim.loss)}, palier ${proven.claim.tier}`
        + ` — le coffre contenait ${atN === undefined ? "?" : usd(atN)} au bloc N${atN !== undefined && proven.claim.loss === 2n * atN ? " : perte DOUBLÉE, comme annoncé" : ""}`);
      if (atN !== undefined && proven.claim.loss !== 2n * atN) console.log("  ⚠ la perte signée n'est pas le double du solde du coffre au bloc N (coffre doté autrement ?)");
      try {
        const rec = await send(asHunter, K.SealedBounty!, sbAbi, "acceptClaim", [proven.claim, [proven.signature]], "f", "réclamation MENSONGÈRE acceptée (signature de l'enclave A vérifiée par le contrat)");
        const ev = parseEventLogs({ abi: sbAbi, logs: rec.logs, eventName: "ClaimAccepted" })[0] as any;
        S.claim = {
          digest: ev.args.claimDigest, claim: claimJson(proven.claim), signer: proven.signer, operators: ev.args.operators, amount: usd(ev.args.amount),
          claimedLoss: usd(proven.claim.loss), vaultBalanceAtN: atN === undefined ? null : usd(atN), attempt,
          acceptTx: rec.transactionHash, acceptBlock: rec.blockNumber.toString(),
        };
        save();
        break;
      } catch (e) {
        if (!/ClaimExpired/.test(revertText(e)) || tries >= 2) throw e;
        console.log("  réclamation expirée avant acceptClaim : nouvelle tentative (autre empreinte)");
        run.hunter = { attempt: attempt + 1 };
        saveRun();
      }
    }
    accepted0 = (await read(K.SealedBounty!, sbAbi, "claimRecords", [S.claim.digest])) as [bigint, boolean, Hex];
  } else {
    console.log(`  réclamation ${S.claim.digest} déjà acceptée (tx ${S.claim.acceptTx})`);
  }
  const claim = normalizeClaim(S.claim.claim);
  const digest = S.claim.digest as Hex;
  const fp = claim.fingerprint;
  const requestHash = keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "string" }, { type: "uint256" }, { type: "bytes32" }],
    [BigInt(CHAIN_ID), K.SealedBounty!, "refuted", bountyId!, digest],
  )); // SealedBounty.refute : keccak256(abi.encode(block.chainid, address(this), "refuted", bountyId, digest))
  /** Ce que la transaction refute a fait, lu dans son reçu et dans l'état d'après (sans les valeurs d'avant). */
  const effectsOf = async (rec: TransactionReceipt) => {
    const sbEvents = parseEventLogs({ abi: sbAbi, logs: rec.logs }).filter((l) => lower(l.address) === lower(K.SealedBounty!)) as any[];
    const slashed = (parseEventLogs({ abi: obAbi, logs: rec.logs, eventName: "Slashed" }) as any[]).filter((l) => lower(l.address) === lower(K.OperatorBond!));
    const recorded = (parseEventLogs({ abi: vlAbi, logs: rec.logs, eventName: "Recorded" }) as any[]).filter((l) => lower(l.address) === lower(K.VerdictLog!));
    const transfers = (parseEventLogs({ abi: usdcAbi, logs: rec.logs, eventName: "Transfer" }) as any[]).filter((l) => lower(l.address) === lower(X.USDC!) && lower(l.args.from) === lower(K.OperatorBond!));
    let deliverBlocked = false;
    try {
      await pub.simulateContract({ account: hunter, address: K.SealedBounty!, abi: sbAbi, functionName: "deliver", args: [bountyId, fp, run.cP ?? "0x"] } as any);
    } catch (e) {
      deliverBlocked = /NothingToDeliver/.test(revertText(e));
    }
    return {
      refutedEv: sbEvents.find((l) => l.eventName === "ClaimRefuted"), skipped: sbEvents.find((l) => l.eventName === "VerdictSkipped"),
      sl: slashed[0]?.args, recorded: recorded[0]?.args, transfers,
      written: (await read(K.VerdictLog!, vlAbi, "recordedAs", [requestHash])) as Hex,
      bondA: await bondOf("A"), bannedA: await banned("A"),
      poolAfter: ((await read(K.SealedBounty!, sbAbi, "getBounty", [bountyId])) as any).balance as bigint,
      pendingPayee: ((await read(K.SealedBounty!, sbAbi, "pendingOf", [bountyId, fp])) as any).payee as Address,
      refuted: ((await read(K.SealedBounty!, sbAbi, "claimRecords", [digest])) as [bigint, boolean, Hex])[1],
      deliverBlocked,
    };
  };
  const refuteRecord = (rec: TransactionReceipt, x: Awaited<ReturnType<typeof effectsOf>>, before?: { bondA: bigint; poolBefore: bigint; reserved: bigint; deployerUsdc: bigint }, deployerUsdcAfter?: bigint) => ({
    tx: rec.transactionHash, block: rec.blockNumber.toString(), reporter: x.refutedEv?.args.reporter ?? null,
    claimRefuted: x.refutedEv ? { bountyId: x.refutedEv.args.bountyId.toString(), claimDigest: x.refutedEv.args.claimDigest, reporter: x.refutedEv.args.reporter } : null,
    slash: {
      operator: ops.A.address, seized: x.sl ? usd(x.sl.amount) : null, bondBefore: before ? usd(before.bondA) : null, bondAfter: usd(x.bondA), banned: x.bannedA,
      payouts: x.transfers.map((t) => ({ to: t.args.to, amount: usd(t.args.value) })), note: "half to the reporter, half to the protocol (both are the deployer here)",
    },
    pool: {
      before: before ? usd(before.poolBefore) : null, after: usd(x.poolAfter), returned: before ? usd(x.poolAfter - before.poolBefore) : null,
      reservedBefore: before ? usd(before.reserved) : null, pendingCleared: x.pendingPayee === zeroAddress, deliverBlocked: x.deliverBlocked,
    },
    verdict: x.recorded
      ? { agentId: x.recorded.agentId.toString(), requestHash, written: x.recorded.requestHash, recordedAs: x.written, response: Number(x.recorded.response), tag: x.recorded.tag, operator: ops.A.address }
      : { skipped: x.skipped ? x.skipped.args.requestHash : null, requestHash },
    ...(before && deployerUsdcAfter !== undefined ? { deployerUsdcDelta: `${formatUnits(deployerUsdcAfter - before.deployerUsdc, 6)} (slash payouts minus the refute gas, paid in USDC on Arc)` } : {}),
  });

  // ---- (g) AVANT la livraison : la réfutation demandée aux enclaves ----
  if (!accepted0[1]) {
    console.log(`\n== (g) AVANT la livraison : le protocole demande la réfutation (source ${process.env.REFUTE_SOURCE === "hunter" ? "« chasseur »" : "« protocole »"}) ==`);
    // F1 (vérificateur) : viem rend le reçu dès une confirmation et garde la tête en cache 4 s ; on attend une tête
    // FRAÎCHE au moins égale au bloc d'acceptation avant de relire la réclamation (sinon faux « jamais acceptée »)
    let fresh = await pub.getBlockNumber({ cacheTime: 0 });
    while (fresh < BigInt(S.claim.acceptBlock)) { await new Promise((r) => setTimeout(r, 500)); fresh = await pub.getBlockNumber({ cacheTime: 0 }); }
    const accepted = await readAcceptedClaim(pub as any, { claimDigest: digest, deployment: dep, fromBlock: BigInt(S.claim.acceptBlock), toBlock: fresh } as any);
    console.log(`  réclamation ${digest} : opérateurs ${accepted.operators.join(", ")}, réservé ${usd(accepted.amount)}, bloc N ${claim.blockN} (tête − ${(await pub.getBlockNumber()) - claim.blockN}), fenêtre jusqu'à ${accepted.refuteWindowEndsAt}`);
    const source = process.env.REFUTE_SOURCE === "hunter"
      ? hunterRefuteSource({ bountyId: bountyId!, payee: hunter.address, exploit: exploitOf(Number(S.claim.attempt ?? 0)), r: run.hunter.r as Hex })
      : protocolRefuteSource({ cP: run.cP as Hex, protocolPrivateKey: run.protocolX25519.privateKey as Hex });
    const t0 = Date.now();
    const round: RefuteRound = await requestRefutations({
      accepted, source, enclaveUrls: [urls.A, urls.B, urls.C], productId: DEMO_PRODUCT, protocolX25519, publicClient: pub as any, deployment: dep, timeoutMs: 600_000,
    });
    for (const x of round.results) {
      const what = x.refutation
        ? `Refutation { proven: ${x.refutation.proven}, loss: ${usd(x.refutation.loss)}, tier: ${x.refutation.tier} }`
        : x.replay ? `rejeu : perte ${usd(x.replay.loss)}, palier ${x.replay.tier}` : "";
      console.log(`  ${x.enclaveUrl} : ${x.status}${x.operator ? ` (opérateur ${x.operator})` : ""} ${what}${x.reason ? ` — ${x.reason}` : ""}`);
    }
    console.log(`  ${round.message} (${Date.now() - t0} ms)`);
    if (round.status !== "ready" || !round.refutation || !round.signatures) throw new Error(`réfutation non prête : ${round.message} — rien n'est envoyé on-chain`);
    const f = round.refutation;
    if (!f.proven || f.loss * 2n !== claim.loss) console.log(`  ⚠ réfutation inattendue (attendu : prouvée, perte ${usd(claim.loss / 2n)})`);
    const want = new Set([lower(ops.B.address), lower(ops.C.address)]);
    if (!round.refuters || round.refuters.length !== 2 || !round.refuters.every((o) => want.has(lower(o)))) throw new Error(`réfutants inattendus : ${round.refuters?.join(", ")}`);
    S.refutation = {
      source: process.env.REFUTE_SOURCE === "hunter" ? "hunter (bundle + r)" : "protocol (cP + X25519 shared secret of this report only)",
      refutation: refutationJson(f), signatures: round.signatures, refuters: round.refuters,
      results: round.results.map((x) => ({ enclave: x.enclaveUrl, status: x.status, operator: x.operator ?? null, signer: x.signer ?? null, ...(x.replay ? { replayLoss: usd(x.replay.loss), replayTier: x.replay.tier, blockN: x.replay.blockN.toString() } : {}), ...(x.code ? { code: x.code } : {}) })),
    };
    save();

    // ---- (h) refute, envoyé par le déployeur ----
    console.log("\n== (h) refute(claim, [A], réfutation, [sigB, sigC]) par le déployeur ==");
    const pendingBefore = (await read(K.SealedBounty!, sbAbi, "pendingOf", [bountyId, fp])) as any;
    const before = {
      bondA: await bondOf("A"), poolBefore: ((await read(K.SealedBounty!, sbAbi, "getBounty", [bountyId])) as any).balance as bigint,
      reserved: pendingBefore.payee === zeroAddress ? 0n : (pendingBefore.amount as bigint) + (pendingBefore.netFee as bigint) + (pendingBefore.opFee as bigint),
      deployerUsdc: await usdcOf(deployer.address),
    };
    if (pendingBefore.payee === zeroAddress) console.log("  ⚠ aucun paiement réservé en attente (déjà livré ?) : la réfutation saisira la caution sans rien rendre à la cagnotte");
    const call = prepareRefuteCall(accepted, round, dep);
    const rec = await send(asDeployer, call.address, sbAbi, call.functionName, [...call.args], "h", "réclamation RÉFUTÉE (deux opérateurs distincts, ni l'un ni l'autre signataire)", 1.3);
    const x = await effectsOf(rec);
    const deployerUsdcAfter = await usdcOf(deployer.address);
    console.log(`  ClaimRefuted : ${x.refutedEv ? `prime ${x.refutedEv.args.bountyId}, réclamation ${x.refutedEv.args.claimDigest}, dénonciateur ${x.refutedEv.args.reporter}` : "ABSENT"}`);
    console.log(`  caution de A saisie : ${x.sl ? usd(x.sl.amount) : "?"} (${usd(before.bondA)} → ${usd(x.bondA)}), A radié : ${x.bannedA} ; versements : ${x.transfers.map((t) => `${usd(t.args.value)} → ${t.args.to}`).join(", ") || "aucun"} (dénonciateur et protocole = le déployeur)`);
    console.log(`  cagnotte de la prime : ${usd(before.poolBefore)} → ${usd(x.poolAfter)} (paiement réservé rendu : ${usd(before.reserved)}) ; plus rien à livrer : ${x.deliverBlocked}`);
    console.log(`  verdict ERC-8004 : ${x.recorded ? `réponse ${x.recorded.response} « ${x.recorded.tag} » pour l'agent ${x.recorded.agentId} (requestHash écrit ${x.recorded.requestHash})` : x.skipped ? `SAUTÉ (VerdictSkipped ${x.skipped.args.requestHash})` : "absent"}`);
    if (!x.refutedEv || !x.refuted) throw new Error("refute : ClaimRefuted absent ou réclamation non marquée réfutée");
    if (x.bondA !== 0n || !x.bannedA) throw new Error("refute : la caution de A n'a pas été saisie");
    S.refute = refuteRecord(rec, x, before, deployerUsdcAfter);
    S.status = "done";
    S.doneAt = new Date().toISOString();
    save();
  } else {
    // réfutée on-chain : par ce script (transaction notée, état d'après non écrit) ou par quelqu'un d'autre
    console.log(`\nréclamation ${digest} déjà réfutée on-chain`);
    const h = [...S.transactions].reverse().find((t: any) => t.step === "h" && t.status === "success");
    if (h && !S.refute) {
      const rec = await pub.getTransactionReceipt({ hash: h.hash as Hex });
      S.refute = refuteRecord(rec, await effectsOf(rec));
      console.log(`  effets relus dans le reçu de ${h.hash}`);
    }
    S.status = "done";
    S.doneAt ??= new Date().toISOString();
    save();
  }

  console.log(`\n== (i) résumé écrit dans ${DEPLOYMENTS}, clé "refuteDemo" ==`);
  printSummary(S, EXPLORER);
}

/** Lance un script enfant (tsx) et rend sa sortie ; chaque ligne est recopiée, préfixée. Échec si le code de sortie ≠ 0. */
function runChild(tsxCli: string, args: string[], env: NodeJS.ProcessEnv, tag: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, ...args], { cwd: ENCLAVE_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    let all = "";
    const pipe = (s: NodeJS.ReadableStream, w: (m: string) => void) => {
      let buf = "";
      s.setEncoding("utf8");
      s.on("data", (d: string) => {
        buf += d;
        all += d;
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          w(`    │ [${tag}] ${buf.slice(0, i)}`);
          buf = buf.slice(i + 1);
        }
      });
      s.on("end", () => { if (buf) w(`    │ [${tag}] ${buf}`); });
    };
    pipe(child.stdout!, (m) => console.log(m));
    pipe(child.stderr!, (m) => console.error(m));
    const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60_000);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(all);
      else reject(new Error(`${tag} : sortie ${code} (voir le journal ci-dessus)`));
    });
  });
}

function printSummary(S: any, explorer: string): void {
  const tx = (h?: string) => (h ? `${h} (${explorer}/tx/${h})` : "—");
  const lines: string[] = [];
  lines.push(`état : ${S?.status ?? "rien de fait"}`);
  if (S?.product) lines.push(`produit ${S.product.id} : manifeste ${S.product.manifestURI} (${S.product.manifestHash}), image ${S.product.image}`);
  for (const r of ROLES) {
    const o = S?.operators?.[r], e = S?.enclaves?.[r];
    if (o || e) lines.push(`opérateur ${r} ${o?.address ?? "?"} (agent ${o?.agentId ?? "?"}, caution ${o?.bond ?? "?"}) ; enclave ${e?.signer ?? "?"}${e?.demoFault ? ` [DEMO_FAULT=${e.demoFault}]` : ""}${e?.imageId ? `, image ${e.imageId}` : ""}`);
  }
  if (S?.vault) lines.push(`coffre DemoVault ${S.vault.address} : déployé ${tx(S.vault.deployTx)}, doté ${tx(S.vault.fundTx)}`);
  if (S?.bounty) lines.push(`prime n° ${S.bounty.id} : ${S.bounty.pool}, ${S.bounty.tier} — ${tx(S.bounty.createTx)}`);
  if (S?.claim) lines.push(`réclamation de A : perte ${S.claim.claimedLoss} (coffre au bloc N : ${S.claim.vaultBalanceAtN ?? "?"}), acceptée ${tx(S.claim.acceptTx)}`);
  if (S?.refutation) lines.push(`réfutation (${S.refutation.source}) : ${JSON.stringify(S.refutation.refutation)} signée par ${S.refutation.refuters?.join(", ")}`);
  if (S?.refute) {
    lines.push(`refute : ${tx(S.refute.tx)}`);
    lines.push(`  caution de A : ${S.refute.slash.bondBefore ?? "?"} → ${S.refute.slash.bondAfter} (saisie ${S.refute.slash.seized ?? "?"}), radié : ${S.refute.slash.banned}`);
    lines.push(`  cagnotte : ${S.refute.pool.before ?? "?"} → ${S.refute.pool.after} (rendu ${S.refute.pool.returned ?? "?"}) ; livraison désormais impossible : ${S.refute.pool.deliverBlocked}`);
    lines.push(`  verdict ERC-8004 : ${S.refute.verdict.response !== undefined ? `${S.refute.verdict.response} « ${S.refute.verdict.tag} » pour l'agent ${S.refute.verdict.agentId}` : `sauté (${S.refute.verdict.skipped ?? "?"})`}`);
  }
  lines.push(`transactions : ${S?.transactions?.length ?? 0}`);
  for (const l of lines) console.log(`  ${l}`);
}

// exécuté directement (tsx scripts/refute-demo.ts) : main ; importé (test) : rien ne se passe
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e);
    process.exit(1);
  });
}
