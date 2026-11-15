/** x402.ts — côté site, l'inférence privée payée À L'APPEL (rail x402 ; produit 3 de la pile v2.1, réglé par X402Settler) :
 *  - readX402Price : le prix d'un appel LU SUR ARC (ProductRegistry.getProduct et isActive, au même bloc), et si ce produit
 *    se paie bien à l'appel (règlement = X402Settler du déploiement). C'est ce prix que la page affiche AVANT toute
 *    signature ;
 *  - makeX402 : le client du SDK (createX402Client) bridé à ce prix : maxAmount = le prix affiché (le SDK ne signe rien
 *    au-delà), et un portefeuille qui ne laisse passer QUE l'autorisation EIP-3009 d'un appel (ReceiveWithAuthorization,
 *    vers X402Settler, domaine de l'USDC d'Arc) d'au plus ce prix : une 2e garde, indépendante du SDK. Le portefeuille
 *    est celui qui est connecté (navigateur, ou portefeuille de test du site en mode test) ;
 *  - settlementOf / useSettlement : où en est le règlement d'un appel payé, lu sur la chaîne (USDC.authorizationState,
 *    puis l'événement CallSettled de X402Settler) ou, à défaut, dans l'activité indexée par l'API : en attente de
 *    l'opérateur, réglé (par quel opérateur, quelle transaction), consommé sans événement trouvé (annulé ?), ou échu sans
 *    règlement (rien n'a été prélevé). Lectures seulement. */
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

/** Le prix d'un appel, tel que lu sur Arc. */
export interface X402Price {
  productId: bigint;
  /** Prix d'un appel (unités de base d'USDC, 6 décimales) : Product.price × 1 unité. */
  price: bigint;
  /** Bloc de la lecture (aussi le bloc à partir duquel chercher le règlement d'un appel payé ensuite). */
  block: bigint;
  /** Le produit existe dans le registre (un identifiant inconnu rend une fiche vide : auteur et règlement nuls). */
  exists: boolean;
  /** Réglé par X402Settler : sinon ce produit ne se paie pas à l'appel. */
  perCall: boolean;
  active: boolean;
  settlement: Address;
}

/** Le prix d'un appel du produit, lu sur Arc (getProduct et isActive au même bloc). */
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

/** Ce que la page affiche pendant un paiement : la signature demandée au portefeuille (montant), puis signée. */
export interface PayHooks { onSign?: (amount: bigint) => void; onSigned?: () => void }

/** Le portefeuille du payeur, bridé : seule l'autorisation EIP-3009 d'UN appel (ReceiveWithAuthorization), vers
 *  X402Settler, sur l'USDC d'Arc (chainId et contrat du domaine), d'au plus `cap` (le prix affiché) atteint le
 *  portefeuille ; toute autre demande de signature est refusée AVANT (rien n'est signé). */
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

/** Le client x402 du SDK pour ce produit et cette enclave, avec le portefeuille connecté, plafonné au prix affiché. */
export function makeX402(arc: ArcClient, url: string, productId: bigint, cap: bigint, hooks?: PayHooks): X402Client {
  if (!arc.wallet) throw new MsgError(msg("err.connectWallet"));
  return createX402Client({
    enclaveUrl: url.trim(), productId, walletClient: payingWallet(arc.wallet, cap, hooks), publicClient: arc.pub,
    deployment: testnet, maxAmount: cap,
  });
}

/** Un appel payé dont on suit le règlement : son payeur et son nonce EIP-3009 (commun à toutes ses autorisations). */
export interface PaidCallRef {
  payer: Address; nonce: Hex; productId: bigint;
  /** Bloc à partir duquel chercher CallSettled (bloc d'ancrage du reçu, ou bloc lu avant l'appel). */
  fromBlock: bigint;
  /** Échéance de l'autorisation (la plus tardive) : au-delà, plus aucun règlement possible. */
  validBefore: bigint;
  /** Montant autorisé (affiché si l'événement ne le dit pas). */
  amount: bigint;
}

export type Settlement =
  | { state: "pending" }
  | { state: "settled"; tx: Hex; operator?: Address; amount?: bigint }
  /** autorisation consommée, mais aucun CallSettled trouvé (annulée par le payeur, ou événement pas encore lisible) */
  | { state: "consumed" }
  /** jamais réglée avant son échéance : rien n'a été prélevé */
  | { state: "expired" };

/** Où en est le règlement de cet appel : lu sur Arc, puis dans l'activité de l'API si la chaîne ne donne pas l'événement. */
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
  } catch { /* plage refusée ou RPC limité : l'activité indexée par l'API */ }
  try {
    const hit = (await fetchActivity(100)).find((e) => e.name === "CallSettled" && lower(e.args?.nonce) === nonce);
    if (hit) {
      const op = String(hit.args.operator ?? "");
      return {
        state: "settled", tx: hit.tx as Hex, ...(/^0x[0-9a-fA-F]{40}$/.test(op) ? { operator: op as Address } : {}),
        ...(/^\d+$/.test(String(hit.args.amount ?? "")) ? { amount: BigInt(String(hit.args.amount)) } : {}),
      };
    }
  } catch { /* API muette : on relira */ }
  return { state: "consumed" };
}

/** Suit le règlement d'un appel payé : relu toutes les 3 s, puis toutes les 8 s, jusqu'à un état final (réglé, échu ; ou
 *  consommé sans événement après quelques lectures). L'erreur d'une lecture est gardée telle quelle (mise en mots à
 *  l'affichage) ; la lecture suivante l'efface. */
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
