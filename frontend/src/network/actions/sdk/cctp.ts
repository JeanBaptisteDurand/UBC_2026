/** cctp.ts — on-ramp : voir l'USDC d'un utilisateur sur plusieurs chaînes et le convertir vers Arc via CCTP.
 *
 *  Le domaine CCTP d'Arc = 26 (VERIFIED, recherche Circle). La lecture des soldes multi-chaînes marche
 *  telle quelle ; le pont burn→mint (depositForBurn, CCTP v2) prend l'adresse du TokenMessenger de chaque chaîne
 *  dans la config. Récupération d'attestation via l'API Iris de Circle. */
import { createPublicClient, http, parseAbi, type Address, type Hex, type WalletClient, type Account, pad } from "viem";

export const ARC_CCTP_DOMAIN = 26;

export interface CctpChain {
  key: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  usdc: Address;
  cctpDomain: number;
  tokenMessenger?: Address; // TokenMessengerV2 (CCTP v2) de la chaîne
  messageTransmitter?: Address; // MessageTransmitterV2 (CCTP v2) de la chaîne
}

const erc20 = parseAbi(["function balanceOf(address a) view returns (uint256)", "function approve(address s, uint256 v) returns (bool)"]);
const tokenMessengerAbi = parseAbi([
  // CCTP v2 depositForBurn
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64 nonce)",
]);

export interface ChainBalance { chain: CctpChain; balance: bigint; }

/** Soldes USDC de `owner` sur chaque chaîne de la config (le « tous tes USDC » de l'écran). */
export async function readUsdcBalances(chains: CctpChain[], owner: Address): Promise<ChainBalance[]> {
  return Promise.all(chains.map(async (chain) => {
    const client = createPublicClient({ transport: http(chain.rpcUrl) });
    const balance = await client.readContract({ address: chain.usdc, abi: erc20, functionName: "balanceOf", args: [owner] }) as bigint;
    return { chain, balance };
  }));
}

export function toBytes32(addr: Address): Hex { return pad(addr, { size: 32 }); }

/** Démarre un transfert CCTP depuis `src` vers Arc : approuve puis depositForBurn. Rend le hash. */
export async function bridgeToArc(
  wallet: WalletClient, account: Account, src: CctpChain, amount: bigint, arcRecipient: Address,
): Promise<Hex> {
  if (!src.tokenMessenger) throw new Error(`tokenMessenger CCTP manquant pour ${src.key} (config de la chaîne)`);
  // approve
  await wallet.writeContract({ account, chain: null, address: src.usdc, abi: erc20, functionName: "approve", args: [src.tokenMessenger, amount] });
  // burn vers le domaine Arc (26), mint au destinataire sur Arc
  return wallet.writeContract({
    account, chain: null, address: src.tokenMessenger, abi: tokenMessengerAbi, functionName: "depositForBurn",
    args: [amount, ARC_CCTP_DOMAIN, toBytes32(arcRecipient), src.usdc, toBytes32("0x0000000000000000000000000000000000000000"), 0n, 1000],
  });
}

/** Attestation Iris de Circle (à passer à receiveMessage sur Arc). */
export async function fetchAttestation(irisBase: string, txHash: Hex): Promise<{ status: string; attestation?: Hex; message?: Hex }> {
  const r = await fetch(`${irisBase.replace(/\/$/, "")}/v2/messages?transactionHash=${txHash}`);
  if (!r.ok) return { status: `http_${r.status}` };
  const j = await r.json() as any;
  const m = j?.messages?.[0];
  return { status: m?.status ?? "pending", attestation: m?.attestation, message: m?.message };
}
