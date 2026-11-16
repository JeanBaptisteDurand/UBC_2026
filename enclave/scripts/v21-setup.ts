/**
 * v21-setup.ts — met en place les PRODUITS de la pile v2.1 sur Arc testnet (idempotent : relançable sans doublon).
 *
 * Pour chaque produit de la liste : le manifeste public (anglais, pour les juges) est ÉCRIT à partir du fichier compose
 * Phala réellement lancé (image épinglée par condensat, variables mesurées) et des adresses de la pile, dans
 * web/public/manifests/<fichier> ; son keccak256 est inscrit on-chain ; le produit est proposé puis activé (timelock 0
 * sur testnet). L'auteur des produits est la clé du déployeur (.secrets/deployer.json, jamais affichée).
 * L'opérateur se prépare à part : DEPLOYMENTS=… npx tsx scripts/operator-setup.ts (caution, agentId, VerdictLog).
 *
 * Usage : cd enclave && DEPLOYMENTS=deployments.v21.testnet.json npx tsx scripts/v21-setup.ts [--dry]
 *   --dry : écrit les manifestes et affiche ce qui serait proposé, sans transaction.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = new URL("../../", import.meta.url);
const DEPLOYMENTS = process.env.DEPLOYMENTS;
if (!DEPLOYMENTS || !/v21/.test(DEPLOYMENTS)) { console.error("DEPLOYMENTS=deployments.v21.testnet.json requis (ce script ne touche pas la v2)"); process.exit(1); }
const D = JSON.parse(readFileSync(new URL(DEPLOYMENTS, ROOT), "utf8"));
const K = D.contracts as Record<string, Address>;
const X = D.external as Record<string, Address>;
const DRY = process.argv.includes("--dry");
const SITE = "https://archive.62-171-153-35.sslip.io";
const MODEL = "openai/gpt-oss-120b";
const abi = (name: string): Abi => JSON.parse(readFileSync(new URL(`contracts/out/${name}.sol/${name}.json`, ROOT), "utf8")).abi;

/** Lit un compose Phala : services, image épinglée, variables (mesurées = en clair ; ${…} = chiffrées, non mesurées). */
function readCompose(file: string) {
  const text = readFileSync(new URL(`enclave/phala/${file}`, ROOT), "utf8");
  const services: Record<string, { image: string; measured: Record<string, string>; secret: string[]; ports: string[] }> = {};
  let cur: string | null = null;
  let section: "env" | "ports" | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^ {2}[A-Za-z0-9_-]+:$/.test(line)) { cur = line.trim().slice(0, -1); services[cur] = { image: "", measured: {}, secret: [], ports: [] }; section = null; continue; }
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
      if (/^\$\{.+\}$/.test(val)) s.secret.push(k!); else s.measured[k!] = val;
    }
  }
  for (const [n, s] of Object.entries(services)) if (!/@sha256:[0-9a-f]{64}$/.test(s.image)) throw new Error(`${file} : l'image de ${n} n'est pas épinglée par condensat`);
  return { file, services };
}

interface Spec {
  id: bigint;
  kind: string;
  manifestFile: string;
  compose: string;
  service: string;
  settlement: Address;
  price: bigint; // micro-USDC par unité (SessionPay) ou par appel (X402Settler)
  param: Hex;
  deterministic: boolean;
  manifest: (c: ReturnType<typeof readCompose>) => Record<string, unknown>;
}

const attestation = {
  tee: "Intel TDX confidential VM (dstack) on Phala Cloud",
  verifiedOnArc: `Intel's signature on each TDX quote is checked on-chain by Automata DCAP: TdxAttestationModule ${K.TdxAttestationModule} -> AutomataDcapAttestationFee ${X.AutomataDcapAttestationFee}`,
  imageFingerprint: "v2.1: the registry replays the dstack RTMR3 event log on-chain (SHA-384), requires it to reproduce the quote's RTMR3, and allows the image by keccak256(MRTD | RTMR0 | RTMR1 | RTMR2 | compose-hash | os-image-hash | XFAM | TDATTRIBUTES) - no instance id, so a restart keeps the same fingerprint",
  reportData: "REPORTDATA[0:32] binds chain id, registry, product id, operator, enclave signer and X25519 key; REPORTDATA[32:64] is a recent block hash (EIP-2935)",
};
const composeBlock = (c: ReturnType<typeof readCompose>, service: string) => {
  const s = c.services[service];
  if (!s) throw new Error(`${c.file} : service ${service} absent`);
  return { composeFile: `enclave/phala/${c.file}`, service, image: s.image, measuredEnv: s.measured, encryptedEnv: s.secret };
};

const SPECS: Spec[] = [
  {
    id: 1n, kind: "chat", manifestFile: "sealed-chat-v21.json", compose: "sealed-chat-v21.yml", service: "sealed-chat",
    settlement: K.SessionPay!, price: 100n, param: keccak256(toBytes(MODEL)), deterministic: false,
    manifest: (c) => ({
      product: "ArcHive - Private AI inference (sealed-chat)", version: "2.1",
      summary: "OpenAI-compatible chat completions. The prompt is encrypted to the enclave's X25519 key (HPKE); the enclave calls the model and signs an EIP-712 receipt per answer; the client pays from a prepaid session locked to that enclave.",
      model: MODEL, modelHash: keccak256(toBytes(MODEL)), upstream: c.services["sealed-chat"]?.measured.REDPILL_BASE_URL,
      modelAttestation: c.services["sealed-chat"]?.measured.MODEL_ATTESTATION === "aci" ? {
        provider: "RedPill private AI gateway (Attested Confidential Inference), verified by the enclave with @phala/aci-verifier 0.11.0 (Apache-2.0)",
        checks: "at start and every 30 min with a fresh nonce: the gateway's Intel TDX quote to Intel's root (dcap-qvl), its workload keyset bound to the quote for our nonce, keys not expired, its docker-compose measured into RTMR3 (event log replayed), and - ArcHive's own check - its OS image is the PRODUCTION dstack image (os-image-hash in RTMR3: " + (c.services["sealed-chat"]?.measured.MODEL_GATEWAY_OS_IMAGES ?? "8db40cb2…") + ")",
        channel: "every model call goes over TLS pinned to the gateway's attested key (SPKI in the keyset)",
        serving: "every answer must carry a gateway receipt citing a verified upstream session (requireVerified, requireReceipt): gpt-oss-120b is served by Tinfoil in a GPU enclave",
        publicStatus: "GET /model-attestation on this enclave",
        failClosed: "if the gateway cannot be verified, the enclave does not start; if a call cannot be verified, no receipt is signed",
      } : undefined,
      billing: { unit: "1 input or output token", unitTokens: 1, outWeight: 1, priceUsdcPerUnit: "0.0001" },
      settlement: `SessionPay ${K.SessionPay} (Arc testnet): cumulative receipts, one settle pays everything so far`,
      build: { context: "enclave/", dockerfile: "enclave/Dockerfile", lockfile: "enclave/package-lock.json", entry: "enclave/products/sealed-chat/server.ts" },
      ...composeBlock(c, "sealed-chat"), ...attestation,
    }),
  },
  {
    id: 2n, kind: "bounty", manifestFile: "sealed-bounty-v21.json", compose: "sealed-bounty-v21.yml", service: "sealed-bounty",
    settlement: K.SealedBounty!, price: 0n, param: keccak256(toBytes("arc-foundry v0.8.0-4 arc-anvil --network arc")), deterministic: true,
    manifest: (c) => ({
      product: "ArcHive - Sealed Bounty (sealed-bounty)", version: "2.1",
      summary: "A protocol funds a bounty with a machine-checkable loss predicate. A hunter's exploit is replayed inside the enclave on a fork of Arc at block N; if the predicate shows a real loss, the hunter is paid in the same flow (acceptClaim then deliver), the target is paused, and the encrypted report goes to the protocol only. Nothing runs on the real chain.",
      replay: "arc-anvil from Arc Foundry (circlefin/arc-foundry v0.8.0-4, x86_64 archive sha256 78330505af7dc0d2c9b55fc1aed00d9d063581bb57054949d31ef1c1b4bdbc5e) --network arc: Arc's precompiles (native USDC, blocklist, EIP-7708 logs) without emulation; gas paid at Arc's base fee from a 20 USDC fork-only allowance, subtracted from the measured profit",
      exploitTx: "abi.encode(address to, uint256 value, bytes data), sent from the hunter's address",
      fingerprint: "keccak256(abi.encode(keccak256(attackCode), keccak256(tx)[]))",
      settlement: `SealedBounty ${K.SealedBounty} (Arc testnet): acceptClaim then deliver`,
      build: { context: "enclave/", dockerfile: "enclave/Dockerfile.bounty", base: "node:22-trixie-slim", lockfile: "enclave/package-lock.json", entry: "enclave/products/sealed-bounty/server.ts" },
      ...composeBlock(c, "sealed-bounty"), ...attestation,
    }),
  },
  {
    id: 3n, kind: "x402", manifestFile: "sealed-x402-v21.json", compose: "sealed-chat-v21.yml", service: "sealed-x402",
    settlement: K.X402Settler!, price: 10_000n, param: keccak256(toBytes(MODEL)), deterministic: false,
    manifest: (c) => ({
      product: "ArcHive - Pay-per-call private inference (x402)", version: "2.1",
      summary: "The same private inference, paid per call with HTTP 402: no session, no prior deposit. The client signs one EIP-3009 ReceiveWithAuthorization for the exact price of one call to X402Settler; the enclave answers (HPKE-encrypted to the client's ephemeral key) with an EIP-712 CallReceipt; the operator settles the call on-chain.",
      model: MODEL, modelHash: keccak256(toBytes(MODEL)), upstream: c.services["sealed-x402"]?.measured.REDPILL_BASE_URL,
      modelAttestation: c.services["sealed-x402"]?.measured.MODEL_ATTESTATION === "aci" ? {
        provider: "RedPill private AI gateway (Attested Confidential Inference), verified by the enclave with @phala/aci-verifier 0.11.0 (Apache-2.0)",
        checks: "at start and every 30 min with a fresh nonce: the gateway's Intel TDX quote to Intel's root (dcap-qvl), its workload keyset bound to the quote for our nonce, keys not expired, its docker-compose measured into RTMR3 (event log replayed), and - ArcHive's own check - its OS image is the PRODUCTION dstack image (os-image-hash in RTMR3: " + (c.services["sealed-x402"]?.measured.MODEL_GATEWAY_OS_IMAGES ?? "8db40cb2…") + ")",
        channel: "every model call goes over TLS pinned to the gateway's attested key (SPKI in the keyset)",
        serving: "every answer must carry a gateway receipt citing a verified upstream session (requireVerified, requireReceipt): gpt-oss-120b is served by Tinfoil in a GPU enclave",
        publicStatus: "GET /model-attestation on this enclave",
        failClosed: "if the gateway cannot be verified, the enclave does not start; if a call cannot be verified, no receipt is signed",
      } : undefined,
      payment: {
        scheme: "x402 v1, 'exact' scheme", payTo: `X402Settler ${K.X402Settler}`, asset: `USDC ${X.USDC} (EIP-712 domain USDC / 2)`,
        pricePerCallUsdc: "0.01", unitsPerCall: 1, maxOutputTokens: Number(c.services["sealed-x402"]?.measured.MAX_OUTPUT_TOKENS ?? 0) || undefined,
        nonce: "the EIP-3009 nonce commits to this exact request: keccak256(abi.encode('ARC-X402-CALL-v1', chainId, X402Settler, productId, enclave, keccak(enc), keccak(ciphertext), clientEphemeralPub)); a payment cannot be replayed on another request",
        responseHash: "keccak256(abi.encode(requestHash, keccak256(text))) - nothing guessable goes on-chain",
      },
      settlement: `X402Settler ${K.X402Settler} (Arc testnet): one call per settle, paid to the operator by the payer's authorization`,
      build: { context: "enclave/", dockerfile: "enclave/Dockerfile", lockfile: "enclave/package-lock.json", entry: "enclave/products/sealed-x402/server.ts" },
      ...composeBlock(c, "sealed-x402"), ...attestation,
    }),
  },
  {
    id: 4n, kind: "copilot", manifestFile: "copilot-enclave-v21.json", compose: "copilot-v21.yml", service: "copilot-enclave",
    settlement: "0x0000000000000000000000000000000000000000", price: 0n, param: keccak256(toBytes(MODEL)), deterministic: false,
    manifest: (c) => ({
      product: "ArcHive - Attested copilot (copilot-enclave)", version: "2.1",
      summary: "The site's copilot (retrieval plus tools that read Arc and PREPARE actions the user signs; it never holds a key) runs in its own Intel TDX VM. The browser verifies the copilot's key against the registry, then encrypts the conversation to the enclave: the web server that relays it sees ciphertext only.",
      protocol: {
        name: "ARC-COPILOT-CHAT-v1",
        request: "HPKE base mode, DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / ChaCha20-Poly1305, info = keccak256(abi.encode(tag, chainId, EnclaveRegistry, productId, enclaveSigner)): a ciphertext prepared for another enclave, product or chain does not open",
        response: "sealed for that request only, with a key exported from the request's HPKE context (as in Oblivious HTTP, RFC 9458): a relay can neither read, modify nor replay it",
      },
      model: MODEL, upstream: c.services["copilot-enclave"]?.measured.OPENAI_BASE_URL,
      modelAttestation: c.services["copilot-enclave"]?.measured.MODEL_ATTESTATION === "aci" ? {
        provider: "RedPill private AI gateway (Attested Confidential Inference), verified by the enclave with @phala/aci-verifier 0.11.0 (Apache-2.0)",
        checks: "at start and every 30 min with a fresh nonce: the gateway's Intel TDX quote to Intel's root (dcap-qvl), its workload keyset bound to the quote for our nonce, keys not expired, its docker-compose measured into RTMR3 (event log replayed), and - ArcHive's own check - its OS image is the PRODUCTION dstack image (os-image-hash in RTMR3: " + (c.services["copilot-enclave"]?.measured.MODEL_GATEWAY_OS_IMAGES ?? "8db40cb2…") + ")",
        channel: "every model call goes over TLS pinned to the gateway's attested key (SPKI in the keyset)",
        serving: "every answer must carry a gateway receipt citing a verified upstream session (requireVerified, requireReceipt)",
        publicStatus: "GET /model-attestation on this enclave",
        failClosed: "if the gateway cannot be verified, the enclave does not start",
      } : undefined,
      price: "free (no receipts, no settlement)", isolation: "own VM: a flaw in the copilot cannot produce quotes for the inference or bounty products",
      build: { context: ".", dockerfile: "enclave/Dockerfile.copilot", entry: "services/copilot/src/enclave-server.ts" },
      ...composeBlock(c, "copilot-enclave"), ...attestation,
    }),
  },
  {
    // 10/11 : la Prime au NIVEAU VÉRIFIÉ. 11/11 : REDÉPLOYÉE en PRODUIT 7 sur la pile corrigée (revue de sécurité) ; preuves d'état désactivées (nœud trop gros), réactivables.
    id: 7n, kind: "bounty-verified", manifestFile: "sealed-bounty-verified-v21.json", compose: "sealed-bounty-verified-v21.yml", service: "sealed-bounty",
    settlement: (D.levels?.SealedBountyVerified ?? "0x0000000000000000000000000000000000000000") as Address, price: 0n,
    param: keccak256(toBytes("arc-foundry v0.8.0-4 arc-anvil --network arc")), deterministic: true,
    manifest: (c) => ({
      product: "ArcHive - Sealed Bounty, verified operator level (sealed-bounty)", version: "2.1",
      summary: "The Sealed Bounty for protocols that need more than a correct attestation: only enclaves whose MACHINE is declared in an inspected datacenter count. A protocol funds a bounty with a machine-checkable loss predicate; a hunter's exploit is replayed inside the enclave on a fork of Arc at block N; if the predicate shows a real loss, the hunter is paid in the same flow (acceptClaim then deliver), the target is paused, and the encrypted report goes to the protocol only.",
      operatorLevel: {
        required: "verified",
        meaning: "an enclave counts only if its machine (PPID read on-chain from Intel's PCK certificate in its registered quote, MachineRegistry.bindMachine) is declared in a known datacenter by an auditor this product accepts; enforced on-chain: the settlement contract reads the registry through PolicyEnclaves",
        policy: `MachineRegistry ${D.levels?.MachineRegistry} (policyOf(7))`,
        auditors: [`ProofOfCloudAuditor ${D.levels?.ProofOfCloudAuditor}: the Proof of Cloud alliance's token (EdDSA, co-signed by the Secret, Nillion and iExec trust servers) verified on-chain`],
        whyItMatters: "physical attacks published in 2025 (TEE.fail, Battering RAM, Wiretap) extract attestation keys from a server the attacker can touch",
      },
      stateProofs: "OPTIONAL, currently OFF: when STATE_PROOF_RPC_URL is set, every state read of the replay is an eth_getProof (EIP-1186) verified against the state root of block N's anchored header (a wrong proof is a violation, a missing proof fails closed); disabled for now because a testnet archive node does not fit the current host (measured, tested) - re-enable with a larger disk or an archive RPC that serves historical eth_getProof",
      replay: "arc-anvil from Arc Foundry (circlefin/arc-foundry v0.8.0-4, x86_64 archive sha256 78330505af7dc0d2c9b55fc1aed00d9d063581bb57054949d31ef1c1b4bdbc5e) --network arc: Arc's precompiles (native USDC, blocklist, EIP-7708 logs) without emulation; gas paid at Arc's base fee from a 20 USDC fork-only allowance, subtracted from the measured profit",
      exploitTx: "abi.encode(address to, uint256 value, bytes data), sent from the hunter's address",
      fingerprint: "keccak256(abi.encode(keccak256(attackCode), keccak256(tx)[]))",
      settlement: `SealedBounty (verified level) ${D.levels?.SealedBountyVerified} (Arc testnet), same code as product 2's, wired to PolicyEnclaves ${D.levels?.PolicyEnclaves}: acceptClaim then deliver; it can slash bonds and write ERC-8004 verdicts from ${new Date(Number(D.levels?.settlementApplyAt ?? 0) * 1000).toISOString()} (any new settlement contract waits 8 days, so every operator can leave first)`,
      build: { context: "enclave/", dockerfile: "enclave/Dockerfile.bounty", base: "node:22-trixie-slim", lockfile: "enclave/package-lock.json", entry: "enclave/products/sealed-bounty/server.ts" },
      ...composeBlock(c, "sealed-bounty"), ...attestation,
    }),
  },
];

const chain = { id: 5042002, name: "Arc testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } } as const;
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 6, retryDelay: 800 }) });

async function main() {
  const pr = abi("ProductRegistry");
  const author = DRY ? null : privateKeyToAccount(JSON.parse(readFileSync(new URL(".secrets/deployer.json", ROOT), "utf8")).privateKey as Hex);
  const wallet = author ? createWalletClient({ account: author, chain, transport: http() }) : null;
  const send = async (functionName: string, args: unknown[], label: string) => {
    const { request } = await pub.simulateContract({ account: author!, address: K.ProductRegistry!, abi: pr, functionName, args } as any);
    const hash = await wallet!.writeContract(request as any);
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`${label} : ${hash} (statut ${r.status}, gas ${r.gasUsed})`);
    if (r.status !== "success") throw new Error(`${label} a échoué`);
  };
  const only = process.env.ONLY_PRODUCT ? BigInt(process.env.ONLY_PRODUCT) : null;
  for (const s of SPECS) {
    if (only !== null && s.id !== only) continue;
    const c = readCompose(s.compose);
    const body = JSON.stringify(s.manifest(c), null, 2) + "\n";
    writeFileSync(new URL(`web/public/manifests/${s.manifestFile}`, ROOT), body);
    const manifestHash = keccak256(toBytes(body));
    const params = {
      manifestHash, manifestURI: `${SITE}/manifests/${s.manifestFile}`, workloadIds: [] as Hex[], deterministic: s.deterministic,
      price: s.price, bpsOperator: 9500, bpsAuthor: 0, bpsNetwork: 500, minBond: 1_000_000n, exposureCap: 10_000_000n,
      settlement: s.settlement, param: s.param, advisoryIds: [] as string[], unitTokens: 1, outWeight: 1,
    };
    const n = (await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "productCount" })) as bigint;
    console.log(`produit ${s.id} (${s.kind}) : manifeste ${s.manifestFile} ${manifestHash} ; ${n >= s.id ? "déjà proposé" : "à proposer"}`);
    if (n >= s.id) {
      const p = (await pub.readContract({ address: K.ProductRegistry!, abi: pr, functionName: "getProduct", args: [s.id] })) as any;
      if (p.manifestHash?.toLowerCase() !== manifestHash.toLowerCase()) console.log(`  ⚠ le manifeste on-chain (${p.manifestHash}) diffère : mise à jour par proposeUpdateWithURI à faire`);
      continue;
    }
    if (DRY) continue;
    if (n !== s.id - 1n) throw new Error(`productCount = ${n} : les produits doivent être créés dans l'ordre (attendu ${s.id - 1n})`);
    await send("propose", [params], `produit ${s.id} (${s.kind}) proposé`);
    await send("activate", [s.id], `produit ${s.id} activé`);
  }
}
main().catch((e) => { console.error("ÉCHEC :", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
