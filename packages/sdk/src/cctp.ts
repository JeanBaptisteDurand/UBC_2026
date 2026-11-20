/** cctp.ts — on-ramp: see a user's USDC on several chains and move it to Arc with CCTP.
 *
 *  Arc's CCTP domain is 26. Reading balances across chains needs only each chain's RPC and USDC address; the
 *  burn→mint transfer (depositForBurn, CCTP v2) also takes each source chain's CCTP contracts from its config entry.
 *  The attestation is fetched from Circle's Iris API. */
import { createPublicClient, http, parseAbi, type Address, type Hex, type WalletClient, type Account, pad } from "viem";

export const ARC_CCTP_DOMAIN = 26;

export interface CctpChain {
  key: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  usdc: Address;
  cctpDomain: number;
  tokenMessenger?: Address; // the chain's TokenMessengerV2 (CCTP v2)
  messageTransmitter?: Address; // the chain's MessageTransmitterV2 (CCTP v2)
}

const erc20 = parseAbi(["function balanceOf(address a) view returns (uint256)", "function approve(address s, uint256 v) returns (bool)"]);
const tokenMessengerAbi = parseAbi([
  // CCTP v2 depositForBurn
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64 nonce)",
]);

export interface ChainBalance { chain: CctpChain; balance: bigint; }

/** `owner`'s USDC balance on each configured chain (the screen's "all your USDC"). */
export async function readUsdcBalances(chains: CctpChain[], owner: Address): Promise<ChainBalance[]> {
  return Promise.all(chains.map(async (chain) => {
    const client = createPublicClient({ transport: http(chain.rpcUrl) });
    const balance = await client.readContract({ address: chain.usdc, abi: erc20, functionName: "balanceOf", args: [owner] }) as bigint;
    return { chain, balance };
  }));
}

export function toBytes32(addr: Address): Hex { return pad(addr, { size: 32 }); }

/** Starts a CCTP transfer from `src` to Arc: approve, then depositForBurn. Returns the transaction hash. */
export async function bridgeToArc(
  wallet: WalletClient, account: Account, src: CctpChain, amount: bigint, arcRecipient: Address,
): Promise<Hex> {
  if (!src.tokenMessenger) throw new Error(`no CCTP tokenMessenger configured for ${src.key}`);
  // approve
  await wallet.writeContract({ account, chain: null, address: src.usdc, abi: erc20, functionName: "approve", args: [src.tokenMessenger, amount] });
  // burn toward Arc's domain (26), mint to the recipient on Arc
  return wallet.writeContract({
    account, chain: null, address: src.tokenMessenger, abi: tokenMessengerAbi, functionName: "depositForBurn",
    args: [amount, ARC_CCTP_DOMAIN, toBytes32(arcRecipient), src.usdc, toBytes32("0x0000000000000000000000000000000000000000"), 0n, 1000],
  });
}

/** Circle's Iris attestation (passed to receiveMessage on Arc). */
export async function fetchAttestation(irisBase: string, txHash: Hex): Promise<{ status: string; attestation?: Hex; message?: Hex }> {
  const r = await fetch(`${irisBase.replace(/\/$/, "")}/v2/messages?transactionHash=${txHash}`);
  if (!r.ok) return { status: `http_${r.status}` };
  const j = await r.json() as any;
  const m = j?.messages?.[0];
  return { status: m?.status ?? "pending", attestation: m?.attestation, message: m?.message };
}
