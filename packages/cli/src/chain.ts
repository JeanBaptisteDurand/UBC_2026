/** chain.ts — Arc testnet access: clients, wallet (PRIVATE_KEY), simulation, sending and
 *  confirmation, decoding of contract reverts, event reads, ABIs not in the SDK. */
import {
  createPublicClient, createWalletClient, decodeFunctionResult, encodeFunctionData, http, parseAbi, toHex,
  type Address, type Hex, type TransactionReceipt,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  ARC_TESTNET_ID, arcErrorsAbi, arcTestnet, createArcClient, enclaveRegistryAbi, EnclaveKeyMismatchError, explainArcError,
  testnet, verifyEnclaveKeys, type ArcClient, type VerifiedEnclaveKeys,
} from "@arcvault/sdk";
import { CliError, UsageError, info } from "./cli";

export const DEFAULT_RPC = "https://rpc.testnet.arc.io";
export const EXPLORER = "https://explorer.testnet.arc.io";
export const NET_TAG = "arctest"; // préfixe réseau des clés aek_
export const EIP2935_WINDOW = 8191n;
export const SETTLE_GRACE_S = 3600n; // SessionPay.SETTLE_GRACE (1 h)
export const ZERO: Address = "0x0000000000000000000000000000000000000000";
/** Registre d'identité ERC-8004 d'Arc testnet — VERIFIED (contracts/src/interfaces/IERC8004.sol). */
export const ERC8004_IDENTITY_TESTNET: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const transport = (rpc?: string) => http(rpc ?? DEFAULT_RPC, { retryCount: 5, retryDelay: 400, timeout: 30_000 });

export function publicClient(rpc?: string) {
  return createPublicClient({ chain: arcTestnet, transport: transport(rpc) });
}
export type Pub = ReturnType<typeof publicClient>;

export function reader(rpc?: string): { arc: ArcClient; pub: Pub } {
  const pub = publicClient(rpc);
  return { pub, arc: createArcClient({ publicClient: pub as any }) };
}

export const txUrl = (h: Hex) => `${EXPLORER}/tx/${h}`;
export const sameAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ---------- portefeuille ----------

/** Account from PRIVATE_KEY (ARC_PK is also accepted). The value is never printed. */
export function walletAccount(): PrivateKeyAccount {
  const raw = (process.env.PRIVATE_KEY ?? process.env.ARC_PK ?? "").trim();
  if (!raw) {
    throw new CliError("cette commande signe : définissez la variable d'environnement PRIVATE_KEY (clé privée 0x…) ; elle n'est jamais passée en argument ni affichée");
  }
  const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new CliError("PRIVATE_KEY invalide : attendu 0x suivi de 64 caractères hexadécimaux (valeur non affichée)");
  }
  return privateKeyToAccount(pk);
}

export function walletAddressIfAny(): Address | undefined {
  try {
    return walletAccount().address;
  } catch {
    return undefined;
  }
}

export const DRY_HASH = `0x${"00".repeat(32)}` as Hex;

interface WriteOnly {
  writeContract(request: unknown): Promise<Hex>;
}

export interface Writer {
  arc: ArcClient;
  pub: Pub;
  account: PrivateKeyAccount;
  wallet: WriteOnly;
  dryRun: boolean;
}

/** Client d'écriture : vérifie le chainId ; en --dry-run, simule (eth_call) mais n'envoie rien. */
export async function writer(ctx: { rpc?: string; dryRun: boolean }): Promise<Writer> {
  const account = walletAccount();
  const pub = publicClient(ctx.rpc);
  const chainId = await pub.getChainId();
  if (chainId !== ARC_TESTNET_ID) {
    throw new CliError(`le RPC répond chainId ${chainId}, attendu Arc testnet (${ARC_TESTNET_ID}) : rien n'est signé`);
  }
  const real = createWalletClient({ account, chain: arcTestnet, transport: transport(ctx.rpc) });
  // Le SDK appelle wallet.signTypedData (autorisations EIP-3009, locales) puis wallet.writeContract après sa
  // propre simulation : en --dry-run on garde la signature locale et on n'envoie rien.
  const wallet = ctx.dryRun
    ? {
        account,
        signTypedData: (a: any) => real.signTypedData(a),
        writeContract: async (req: any) => {
          info(`  [simulation] ${req.functionName} → ${req.address} : accepté par eth_call, rien n'est envoyé`);
          return DRY_HASH;
        },
      }
    : real;
  const arc = createArcClient({ publicClient: pub as any, walletClient: wallet as any, account });
  return { arc, pub, account, wallet: wallet as WriteOnly, dryRun: ctx.dryRun };
}

/** Simule puis envoie un appel que le SDK n'expose pas (approve…). Les refus remontés d'un autre contrat du réseau
 *  sont décodés (ABI de l'appel + toutes les erreurs du réseau). */
export async function writeCall(w: Writer, address: Address, abi: any, functionName: string, args: unknown[]): Promise<Hex> {
  const { request } = await w.pub.simulateContract({ account: w.account, address, abi: [...abi, ...arcErrorsAbi], functionName, args } as any);
  return w.wallet.writeContract(request);
}

export class RevertedOnChain extends CliError {}

/** Attend la confirmation ; rend undefined en --dry-run (rien n'a été envoyé). */
export async function confirm(w: Writer, label: string, hash: Hex): Promise<TransactionReceipt | undefined> {
  if (w.dryRun) return undefined;
  info(`  ${label} : envoyée ${hash}`);
  const rcpt = await w.pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (rcpt.status !== "success") throw new RevertedOnChain(`${label} : transaction annulée on-chain (revert) — ${txUrl(hash)}`);
  info(`  ${label} : confirmée au bloc ${rcpt.blockNumber} — ${txUrl(hash)}`);
  return rcpt;
}

// ---------- refus des contrats, expliqués ----------

/** Message d'erreur lisible : refus de contrat décodé par le SDK (toutes les erreurs de la pile v2, en français, y
 *  compris celles remontées d'un contrat appelé), clés d'enclave refusées, ou message brut. */
export function explainError(e: unknown): string {
  if (e instanceof CliError || e instanceof UsageError) return e.message;
  if (e instanceof EnclaveKeyMismatchError) return e.message;
  return explainArcError(e);
}

// ---------- HTTP (enclaves) ----------

export async function httpJson(url: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  } catch (e) {
    throw new CliError(`${url} injoignable : ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new CliError(`${url} : réponse non JSON (HTTP ${res.status}) : ${text.slice(0, 160)}`);
  }
  if (!res.ok) throw new CliError(`${url} : HTTP ${res.status} ${body?.error ?? text.slice(0, 200)}`);
  return body;
}

/** /pubkeys d'une enclave SANS confiance (ex. l'inscrire : la chaîne vérifiera son quote). Pour CHIFFRER vers elle,
 *  utiliser verifiedEnclave : la clé de /pubkeys doit être celle inscrite on-chain. */
export async function enclavePubkeys(url: string): Promise<{ signer: Address; x25519: Hex }> {
  const j = await httpJson(`${url.replace(/\/$/, "")}/pubkeys`);
  if (typeof j?.signer !== "string" || typeof j?.x25519 !== "string") throw new CliError(`${url}/pubkeys : réponse inattendue`);
  return { signer: j.signer as Address, x25519: j.x25519 as Hex };
}

/** Clés d'une enclave confrontées à la chaîne (SDK verifyEnclaveKeys) : clé X25519 = celle inscrite, enclave active
 *  pour le produit au bloc de tête ; pour une session, l'enclave verrouillée. Sinon CliError : « la clé de l'enclave ne
 *  correspond pas à celle inscrite sur Arc : envoi refusé (…) ». */
export async function verifiedEnclave(
  pub: Pub, url: string, productId: bigint, o: { sessionId?: bigint; expectedSigner?: Address } = {},
): Promise<VerifiedEnclaveKeys> {
  try {
    return await verifyEnclaveKeys(url, productId, { publicClient: pub as any, deployment: testnet, ...o });
  } catch (e) {
    if (e instanceof EnclaveKeyMismatchError) throw new CliError(e.message);
    throw e;
  }
}

export function isActiveAt(pub: Pub, signer: Address, productId: bigint, block: bigint): Promise<boolean> {
  return pub.readContract({ address: testnet.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "isActiveAt", args: [signer, productId, block] }) as Promise<boolean>;
}

/** Délai de grâce du registre, en blocs (lu une fois) : une enclave sortie de sa fenêtre peut encore faire régler les
 *  reçus ancrés dedans pendant ce délai. */
let graceBlocks: bigint | undefined;
export async function enclaveGraceBlocks(pub: Pub): Promise<bigint> {
  graceBlocks ??= (await pub.readContract({ address: testnet.enclaveRegistry, abi: enclaveRegistryAbi, functionName: "GRACE_BLOCKS" })) as bigint;
  return graceBlocks;
}

// ---------- événements (Blockscout, secours RPC) ----------

export interface RawLog {
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  txHash: Hex;
}

/** Événements d'un contrat filtrés par topic0 (et topic1), du plus ancien au plus récent. Lecture via
 *  l'indexeur Blockscout de l'explorateur ; à défaut, eth_getLogs par tranches de 5 000 blocs (séquentiel). */
export async function fetchLogs(pub: Pub, address: Address, topic0: Hex, topic1?: Hex): Promise<RawLog[]> {
  const want = (t: (Hex | null)[]) =>
    t[0]?.toLowerCase() === topic0.toLowerCase() && (!topic1 || t[1]?.toLowerCase() === topic1.toLowerCase());
  const bs = testnet.blockscoutUrl;
  if (bs) {
    try {
      const outLogs: RawLog[] = [];
      let query = "";
      for (let page = 0; page < 40; page++) {
        const res = await fetch(`${bs.replace(/\/$/, "")}/api/v2/addresses/${address}/logs${query}`, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`blockscout ${res.status}`);
        const j = (await res.json()) as { items?: any[]; next_page_params?: Record<string, unknown> | null };
        for (const it of j.items ?? []) {
          const topics = (it.topics ?? []) as (Hex | null)[];
          if (!want(topics)) continue;
          outLogs.push({ topics: topics.filter(Boolean) as Hex[], data: it.data as Hex, blockNumber: BigInt(it.block_number), txHash: it.transaction_hash as Hex });
        }
        if (!j.next_page_params) break;
        query = `?${new URLSearchParams(Object.entries(j.next_page_params).map(([k, v]) => [k, String(v)])).toString()}`;
      }
      return outLogs.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
    } catch {
      info("  (indexeur indisponible : lecture des événements par le RPC, plus lente)");
    }
  }
  const head = await pub.getBlockNumber();
  const outLogs: RawLog[] = [];
  for (let from = testnet.deployBlock; from <= head; from += 5000n) {
    const to = from + 4999n < head ? from + 4999n : head;
    const logs = (await (pub as any).request({
      method: "eth_getLogs",
      params: [{ address, topics: topic1 ? [topic0, topic1] : [topic0], fromBlock: toHex(from), toBlock: toHex(to) }],
    })) as any[];
    for (const l of logs) outLogs.push({ topics: l.topics, data: l.data, blockNumber: BigInt(l.blockNumber), txHash: l.transactionHash });
  }
  return outLogs;
}

// ---------- noms et ABI absentes du SDK ----------

export function contractName(a: Address): string {
  const names: Record<string, string> = {
    [testnet.sessionPay.toLowerCase()]: "SessionPay",
    [testnet.sealedBounty.toLowerCase()]: "SealedBounty",
    [testnet.x402Settler.toLowerCase()]: "X402Settler",
  };
  return names[a.toLowerCase()] ?? a;
}

export const bountyExtraAbi = parseAbi([
  "function tierMinLoss(uint256 bountyId, uint256 index) view returns (uint256)",
  "function tierAmount(uint256 bountyId, uint256 index) view returns (uint256)",
  "function networkBountyBps() view returns (uint16)",
  "function operatorBountyBps() view returns (uint16)",
]);

export const bondExtraAbi = parseAbi([
  "function agentIdOf(address operator) view returns (uint256)",
  "function unbondableAt(address operator) view returns (uint64)",
]);

export const sessionExtraAbi = parseAbi([
  "event SessionClosed(uint256 indexed sessionId, uint256 refund)",
  "event Settled(uint256 indexed sessionId, uint128 cumulativeUnits, uint256 paidDelta)",
]);

export const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);

export interface Tier {
  minLoss: bigint;
  amount: bigint;
}

/** Paliers d'une prime (tableaux publics lus élément par élément, jusqu'au premier hors borne). v2.1 bis : lus par
 *  pub.call (et non readContract, qui range une erreur interne -32603 du nœud parmi les reverts) : seule une fin de
 *  tableau (revert EVM, code 3) arrête la lecture, toute autre erreur remonte (jamais de paliers tronqués en silence). */
export async function readTiers(pub: Pub, bountyId: bigint): Promise<Tier[]> {
  const tiers: Tier[] = [];
  const read = async (functionName: "tierMinLoss" | "tierAmount", i: bigint): Promise<bigint> => {
    const { data } = await pub.call({ to: testnet.sealedBounty, data: encodeFunctionData({ abi: bountyExtraAbi, functionName, args: [bountyId, i] }) });
    if (data === undefined) throw new CliError(`${functionName} : réponse vide`);
    return decodeFunctionResult({ abi: bountyExtraAbi, functionName, data }) as bigint;
  };
  for (let i = 0n; i < 16n; i++) {
    try {
      const minLoss = await read("tierMinLoss", i);
      const amount = await read("tierAmount", i);
      tiers.push({ minLoss, amount });
    } catch (e) {
      if (isRevert(e)) break; // fin du tableau
      throw e; // erreur réseau ou interne du nœud : ne pas tronquer les paliers en silence
    }
  }
  return tiers;
}

/** Vrai si l'erreur est un revert EVM : code JSON-RPC 3 (EIP-1474) dans la chaîne des causes. v2.1 bis : plus le nom
 *  d'erreur de viem (ContractFunctionRevertedError couvre aussi une erreur interne -32603 du nœud). */
export function isRevert(e: unknown): boolean {
  for (let x: any = e, n = 0; x && n < 12; x = x.cause, n++) {
    if (x?.code === 3) return true;
  }
  return false;
}

export async function bountyFeesBps(pub: Pub): Promise<{ network: number; operator: number }> {
  const network = Number(await pub.readContract({ address: testnet.sealedBounty, abi: bountyExtraAbi, functionName: "networkBountyBps" }));
  const operator = Number(await pub.readContract({ address: testnet.sealedBounty, abi: bountyExtraAbi, functionName: "operatorBountyBps" }));
  return { network, operator };
}
