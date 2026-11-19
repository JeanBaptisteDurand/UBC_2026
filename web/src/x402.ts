/** x402.ts — on the site side, private inference paid PER CALL (x402 rail; product 3 of the v2.1 stack, settled by
 *  X402Settler):
 *  - readX402Price: the price of a call READ ON ARC (ProductRegistry.getProduct and isActive, at the same block), and
 *    whether this product is really paid per call (settlement = the deployment's X402Settler). This is the price the
 *    page shows BEFORE any signature;
 *  - makeX402: the SDK client (createX402Client) capped at this price: maxAmount = the price shown (the SDK signs nothing
 *    above it), and a wallet that lets through ONLY the EIP-3009 authorization of one call (ReceiveWithAuthorization,
 *    to X402Settler, in the domain of Arc's USDC) of at most this price: a second guard, independent of the SDK. The
 *    wallet is the connected one (the browser's, or the site's test wallet in test mode);
 *  - settlementOf / useSettlement: where the settlement of a paid call stands, read on the chain
 *    (USDC.authorizationState, then X402Settler's CallSettled event) or, failing that, in the activity indexed by the
 *    API: waiting for the operator, settled (by which operator, in which transaction), consumed with no event found
 *    (cancelled?), or expired without settlement (nothing was charged). Reads only. */
import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import {
  callSettledEvent, createX402Client, productRegistryAbi, testnet, usdcAuthAbi, X402_UNITS_PER_CALL,
  type ArcClient, type X402Client,
} from "@arcvault/sdk";
import { fetchActivity } from "./api";
import { usdc } from "./fmt";
import { MsgError, msg } from "./msg";

const lower = (x: unknown) => String(x ?? "").toLowerCase();

/** The price of a call, as read on Arc. */
export interface X402Price {
  productId: bigint;
  /** Price of a call (USDC base units, 6 decimals): Product.price × 1 unit. */
  price: bigint;
  /** Block of the read (also the block from which to look for the settlement of a call paid afterwards). */
  block: bigint;
  /** The product exists in the registry (an unknown id returns an empty record: zero author and settlement). */
  exists: boolean;
  /** Settled by X402Settler: otherwise this product is not paid per call. */
  perCall: boolean;
  active: boolean;
  settlement: Address;
}

/** The price of a call of the product, read on Arc (getProduct and isActive at the same block). */
export async function readX402Price(arc: ArcClient, productId: bigint): Promise<X402Price> {
  const block = await arc.pub.getBlockNumber();
  const [p, active] = (await Promise.all([
    arc.pub.readContract({ address: testnet.productRegistry, abi: productRegistryAbi, functionName: "getProduct", args: [productId], blockNumber: block }),
    arc.pub.readContract({ address: testnet.productRegistry, abi: productRegistryAbi, functionName: "isActive", args: [productId], blockNumber: block }),
  ])) as [{ author: Address; price: bigint; settlement: Address }, boolean];
  const zero = /^0x0{40}$/i;
  return {
    productId, price: p.price * X402_UNITS_PER_CALL, block, active, settlement: p.settlement,
    exists: !zero.test(p.author) || !zero.test(p.settlement),
    perCall: lower(p.settlement) === lower(testnet.x402Settler),
  };
}

/** What the page shows during a payment: the signature requested from the wallet (amount), then signed. */
export interface PayHooks { onSign?: (amount: bigint) => void; onSigned?: () => void }

/** The payer's wallet, capped: only the EIP-3009 authorization of ONE call (ReceiveWithAuthorization), to X402Settler,
 *  on Arc's USDC (domain chainId and contract), of at most `cap` (the price shown) reaches the wallet; any other
 *  signature request is refused BEFORE it (nothing is signed). */
export function payingWallet<W extends object>(w: W, cap: bigint, hooks: PayHooks = {}): W {
  return new Proxy(w, {
    get(target, prop, receiver) {
      if (prop !== "signTypedData") return Reflect.get(target, prop, receiver);
      return async (args: any) => {
        const m = args?.message ?? {};
        const d = args?.domain ?? {};
        const value: bigint = typeof m.value === "bigint" ? m.value : -1n;
        const ok = args?.primaryType === "ReceiveWithAuthorization"
          && lower(m.to) === lower(testnet.x402Settler)
          && Number(d.chainId) === testnet.chainId
          && lower(d.verifyingContract) === lower(testnet.usdc)
          && value > 0n && value <= cap;
        if (!ok) throw new MsgError(msg("x402.guard", { cap: () => usdc(cap) }), "X402GuardError");
        hooks.onSign?.(value);
        const sig = await (target as any).signTypedData(args);
        hooks.onSigned?.();
        return sig;
      };
    },
  });
}

/** The SDK's x402 client for this product and this enclave, with the connected wallet, capped at the price shown. */
export function makeX402(arc: ArcClient, url: string, productId: bigint, cap: bigint, hooks?: PayHooks): X402Client {
  if (!arc.wallet) throw new MsgError(msg("err.connectWallet"));
  return createX402Client({
    enclaveUrl: url.trim(), productId, walletClient: payingWallet(arc.wallet, cap, hooks), publicClient: arc.pub,
    deployment: testnet, maxAmount: cap,
  });
}

/** A paid call whose settlement is followed: its payer and its EIP-3009 nonce (shared by all its authorizations). */
export interface PaidCallRef {
  payer: Address; nonce: Hex; productId: bigint;
  /** Block from which to look for CallSettled (the receipt's anchor block, or the block read before the call). */
  fromBlock: bigint;
  /** Expiry of the authorization (the latest one): after it, no settlement is possible. */
  validBefore: bigint;
  /** Authorized amount (shown if the event does not say it). */
  amount: bigint;
}

export type Settlement =
  | { state: "pending" }
  | { state: "settled"; tx: Hex; operator?: Address; amount?: bigint }
  /** authorization consumed, but no CallSettled found (cancelled by the payer, or the event not readable yet) */
  | { state: "consumed" }
  /** never settled before its expiry: nothing was charged */
  | { state: "expired" };

/** Where the settlement of this call stands: read on Arc, then in the API's activity if the chain does not give the event. */
export async function settlementOf(arc: ArcClient, c: PaidCallRef): Promise<Settlement> {
  const used = (await arc.pub.readContract({
    address: testnet.usdc, abi: usdcAuthAbi, functionName: "authorizationState", args: [c.payer, c.nonce],
  })) as boolean;
  if (!used) return BigInt(Math.floor(Date.now() / 1000)) > c.validBefore + 30n ? { state: "expired" } : { state: "pending" };
  const nonce = lower(c.nonce);
  try {
    const logs = await arc.pub.getLogs({
      address: testnet.x402Settler, event: callSettledEvent, args: { productId: c.productId, payer: c.payer },
      fromBlock: c.fromBlock, toBlock: "latest",
    });
    const hit = logs.find((l) => lower(l.args.nonce) === nonce);
    if (hit) return { state: "settled", tx: hit.transactionHash as Hex, operator: hit.args.operator as Address | undefined, amount: hit.args.amount };
  } catch { /* range refused or RPC rate-limited: fall back to the activity indexed by the API */ }
  try {
    const hit = (await fetchActivity(100)).find((e) => e.name === "CallSettled" && lower(e.args?.nonce) === nonce);
    if (hit) {
      const op = String(hit.args.operator ?? "");
      return {
        state: "settled", tx: hit.tx as Hex, ...(/^0x[0-9a-fA-F]{40}$/.test(op) ? { operator: op as Address } : {}),
        ...(/^\d+$/.test(String(hit.args.amount ?? "")) ? { amount: BigInt(String(hit.args.amount)) } : {}),
      };
    }
  } catch { /* silent API: read again on the next poll */ }
  return { state: "consumed" };
}

/** Follows the settlement of a paid call: read again every 3 s, then every 8 s, until a final state (settled, expired;
 *  or consumed without an event after a few reads). A read's error is kept as is (put into words at display time); the
 *  next read clears it. */
export function useSettlement(arc: ArcClient | null, ref: PaidCallRef | null): { s: Settlement | null; err: unknown } {
  const [s, setS] = useState<Settlement | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const pub = arc?.pub;
  const key = ref ? `${lower(ref.payer)}:${lower(ref.nonce)}` : "";
  useEffect(() => {
    if (!arc || !ref) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let n = 0;
    let consumed = 0;
    const tick = async () => {
      n++;
      try {
        const r = await settlementOf(arc, ref);
        if (!alive) return;
        setS(r); setErr(null);
        if (r.state === "settled" || r.state === "expired") return;
        if (r.state === "consumed" && ++consumed >= 6) return;
      } catch (e) {
        if (alive) setErr(e ?? new Error("?"));
      }
      if (alive) timer = setTimeout(tick, n < 10 ? 3000 : 8000);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [pub, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { s, err };
}
