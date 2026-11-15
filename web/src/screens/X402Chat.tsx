/** X402Chat.tsx — l'IA privée PAYÉE À L'APPEL (rail x402, produit 3 de la pile v2.1) : ni session ni dépôt. Chaque message
 *  est un appel, chiffré pour l'enclave seule (sa clé confrontée à Arc) et payé par UNE signature EIP-3009 du prix exact
 *  LU SUR ARC, vers X402Settler (une signature, pas une transaction : pas de gas). Le prix est affiché AVANT toute
 *  signature et rien n'est signé au-delà (x402.ts : maxAmount du SDK, et un portefeuille bridé à ce prix).
 *  Chaque réponse arrive avec son reçu, vérifié par le SDK (signé par l'enclave vérifiée, pour ce payeur, ce montant, cette
 *  requête et ce texte), puis l'état de son règlement lu sur Arc : en attente → réglé par l'opérateur.
 *  Un appel payé resté sans réponse vérifiée (X402PaidCallError) est expliqué : la réponse peut être perdue alors que le
 *  paiement peut être réglé ; « reprendre » renvoie la MÊME requête avec la MÊME autorisation (aucune 2e facturation),
 *  tant que l'enclave peut encore la rendre ; un prix monté entre-temps n'est accepté que par un clic qui l'affiche.
 *  Tout échec d'avant le paiement (clé, prix, refus de l'enclave, signature refusée) remet le message dans le champ :
 *  rien n'a été signé. */
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { Loader2 } from "lucide-react";
import { testnet, type ArcClient, type ChatMessage, type X402Client, type X402Completion } from "@arcvault/sdk";
import { useArc } from "../useArc";
import { X402_URL } from "../config";
import { X402_PRODUCT, useVerifiedEnclave } from "../arc";
import { makeX402, readX402Price, useSettlement, type PaidCallRef, type X402Price } from "../x402";
import { Card, Btn, Field, Badge, EnclaveCheckView, Hex as HexVal, usdc, short } from "../ui";
import { explainError, paidCallText } from "../errors";
import { MsgError, fail, failWith, isFailure, msg, show, type Msg as Note } from "../msg";
import { fmtNum, fmtUnix, t, tx, useLang } from "../i18n";

/** Ce qu'a payé un appel servi : son reçu vérifié par le SDK, et de quoi suivre son règlement. */
interface Paid {
  signer: string; operator: string; amount: bigint; anchorBlock: bigint;
  settleable: boolean; settleableUnknown: boolean; replay: boolean; ref: PaidCallRef;
}
/** Une ligne de la conversation. `unanswered` : un message payé resté sans réponse vérifiée (laissé tel quel). */
type Line = { role: "user" | "assistant"; content: string; paid?: Paid; unanswered?: PaidCallRef };
type PriceState = { state: "idle" } | { state: "reading" } | { state: "ok"; p: X402Price } | { state: "bad"; error: unknown };
/** Un appel payé sans réponse vérifiée : l'erreur du SDK (son `pending` sert à reprendre) et le suivi de son règlement. */
interface PaidFailure { err: any; ref: PaidCallRef }

/** La conversation part entière à chaque appel et doit tenir dans la requête de l'enclave (32 Kio en clair par défaut,
 *  sel compris) : au plus 24 Kio de messages, les plus anciens retirés d'abord ; null si le dernier seul dépasse. */
const MAX_CONV_BYTES = 24 * 1024;
function fitConversation(messages: ChatMessage[]): ChatMessage[] | null {
  const size = (m: ChatMessage[]) => new TextEncoder().encode(JSON.stringify(m)).length;
  let kept = messages;
  while (kept.length > 1 && (size(kept) > MAX_CONV_BYTES || kept[0]!.role === "assistant")) kept = kept.slice(1);
  return size(kept) > MAX_CONV_BYTES ? null : kept;
}

/** Ce qui suit un appel payé : son payeur, son nonce (commun à toutes ses autorisations), l'échéance la plus tardive. */
function refOf(p: any, fromBlock: bigint): PaidCallRef {
  const auths: any[] = Array.isArray(p?.authorizations) && p.authorizations.length ? p.authorizations : [p?.authorization];
  const big = (pick: (a: any) => unknown) => auths.reduce((m: bigint, a) => { const v = pick(a); return typeof v === "bigint" && v > m ? v : m; }, 0n);
  return { payer: p.payer, nonce: p.nonce, productId: p.productId, fromBlock, validBefore: big((a) => a?.validBefore), amount: big((a) => a?.value) };
}

/** Le nom du contrat qui règle un produit (pour dire pourquoi il ne se paie pas à l'appel). */
function settlementName(a: string): string {
  const x = a.toLowerCase();
  if (x === testnet.sessionPay.toLowerCase()) return "SessionPay";
  if (x === testnet.sealedBounty.toLowerCase()) return "SealedBounty";
  return short(a);
}

function PriceView({ price, onRetry }: { price: PriceState; onRetry: () => void }) {
  switch (price.state) {
    case "idle": return <span className="text-muted">—</span>;
    case "reading": return <span className="inline-flex items-center gap-1.5 text-muted"><Loader2 size={12} className="animate-spin" />{t("x402.price.reading")}</span>;
    case "bad":
      return (
        <span className="break-words text-bad">
          {t("x402.price.error", { err: explainError(price.error) })}
          <button className="ml-2 text-accent hover:underline" onClick={onRetry}>{t("x402.price.retry")}</button>
        </span>
      );
  }
  const p = price.p;
  const id = p.productId.toString();
  if (!p.exists) return <span className="break-words text-warn">{t("x402.price.missing", { id })}</span>;
  if (!p.perCall) return <span className="break-words text-warn">{t("x402.price.notPerCall", { id, settlement: settlementName(p.settlement) })}</span>;
  if (!p.active) return <span className="text-warn">{t("x402.price.inactive", { id })}</span>;
  if (p.price <= 0n) return <span className="text-warn">{t("x402.price.none", { id })}</span>;
  return (
    <span className="text-muted">
      {tx("x402.price.ok", { price: <span className="font-mono text-[14px] text-text">{usdc(p.price)}</span>, block: fmtNum(p.block) })}
    </span>
  );
}

/** Le règlement d'un appel payé, lu sur Arc (et relu jusqu'à un état final). */
function SettlementLine({ arc, r }: { arc: ArcClient | null; r: PaidCallRef }) {
  const { s, err } = useSettlement(arc, r);
  if (!s) {
    return err !== null
      ? <p className="break-words text-bad">{t("x402.settle.error", { err: explainError(err) })}</p>
      : <p className="text-muted">{t("x402.settle.reading")}</p>;
  }
  switch (s.state) {
    case "pending":
      return (
        <p className="inline-flex items-center gap-1.5 text-muted">
          <Loader2 size={12} className="shrink-0 animate-spin" />{t("x402.settle.pending", { until: fmtUnix(r.validBefore) })}
        </p>
      );
    case "settled": {
      const amount = usdc(s.amount ?? r.amount);
      const txv = <HexVal value={s.tx} kind="tx" n={4} />;
      return (
        <p className="text-good">
          {s.operator
            ? tx("x402.settle.settled", { op: <HexVal value={s.operator} n={4} />, amount, tx: txv })
            : tx("x402.settle.settledNoOp", { amount, tx: txv })}
        </p>
      );
    }
    case "consumed": return <p className="text-muted">{t("x402.settle.consumed")}</p>;
    case "expired": return <p className="text-muted">{t("x402.settle.expired")}</p>;
  }
}

/** Le reçu d'un appel servi (vérifié par le SDK avant que le texte soit rendu) et son règlement. */
function PaidReceipt({ arc, p }: { arc: ArcClient | null; p: Paid }) {
  return (
    <div className="mt-1 space-y-1 text-[12px] text-muted">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone="good">{t("x402.receipt.ok")}</Badge>
        <span>{tx("x402.receipt.signedBy", { signer: <HexVal value={p.signer} n={4} /> })}</span>
        <span>{t("x402.receipt.amount", { amount: usdc(p.amount) })}</span>
        <span>{t("x402.receipt.anchor", { n: fmtNum(p.anchorBlock) })}</span>
        {p.settleableUnknown ? <span>{t("x402.receipt.settleableUnknown")}</span>
          : p.settleable ? <span>{t("x402.receipt.settleable")}</span>
          : <span className="text-warn">{t("x402.receipt.notSettleable")}</span>}
        {p.replay && <span>{t("x402.receipt.replay")}</span>}
      </div>
      <SettlementLine arc={arc} r={p.ref} />
    </div>
  );
}

/** Un appel payé sans réponse vérifiée : ce qui s'est passé (paidCallText, d'après les champs de l'erreur, sans redire le
 *  titre ; une réponse écartée parce qu'elle ne correspondait pas à son reçu est dite comme telle), où en est son
 *  règlement, et la reprise quand elle est encore possible. */
function PaidCallBox({ arc, pf, busy, onResume, onDismiss }: {
  arc: ArcClient | null; pf: PaidFailure; busy: boolean; onResume: (acceptPrice?: bigint) => void; onDismiss: () => void;
}) {
  const e = pf.err;
  const lost = e?.code === "enclave_changed";
  // l'enclave ne garde la réponse que jusqu'à l'échéance de l'autorisation (et seulement si elle n'a pas redémarré)
  const canResume = !lost && BigInt(Math.floor(Date.now() / 1000)) + 10n < pf.ref.validBefore;
  const newPrice: bigint | undefined = (e?.code === "price_increased" || e?.code === "price_above_cap") && typeof e?.newPrice === "bigint" ? e.newPrice : undefined;
  return (
    <div className="rounded-lg border border-warn/40 bg-warn/5 p-3" role="alert">
      <div className="text-[13px] font-medium text-warn">{t(lost ? "x402.paid.lostTitle" : "x402.paid.title")}</div>
      <p className="mt-1 break-words text-[12px] text-muted">{paidCallText(e)}</p>
      <div className="mt-1.5 text-[12px]"><SettlementLine arc={arc} r={pf.ref} /></div>
      {!lost && !canResume && <p className="mt-1 text-[12px] text-muted">{t("x402.paid.noResume")}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {canResume && <Btn onClick={() => onResume()} disabled={busy}>{t("x402.paid.resume")}</Btn>}
        {canResume && newPrice !== undefined && (
          <Btn kind="ghost" onClick={() => onResume(newPrice)} disabled={busy}>{t("x402.paid.accept", { price: usdc(newPrice) })}</Btn>
        )}
        <Btn kind="ghost" onClick={onDismiss} disabled={busy}>{t("x402.paid.dismiss")}</Btn>
      </div>
    </div>
  );
}

/** `active` : le mode est affiché (la clé de l'enclave n'est vérifiée qu'une fois le mode ouvert) ; `onPrice` : le prix
 *  d'un appel lu sur Arc (null s'il n'est pas payable), pour le libellé du choix de paiement. */
export default function X402Chat({ active, onPrice }: { active: boolean; onPrice?: (price: bigint | null) => void }) {
  const arc = useArc();
  useLang();
  const { chain } = useAccount();
  const [seen, setSeen] = useState(active);
  useEffect(() => { if (active) setSeen(true); }, [active]);
  const [productId, setProductId] = useState(X402_PRODUCT.toString());
  const [url, setUrl] = useState(X402_URL);
  const [price, setPrice] = useState<PriceState>({ state: "idle" });
  const [priceNonce, setPriceNonce] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  // null : la question d'exemple, dans la langue du moment (tant que l'utilisateur n'a rien tapé)
  const [typed, setInput] = useState<string | null>(null);
  const input = typed ?? t("chat.defaultPrompt");
  const [status, setStatus] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [paidFail, setPaidFail] = useState<PaidFailure | null>(null);
  // la clé de l'enclave servie à cette adresse, confrontée à la chaîne avant tout envoi (montrée, puis revérifiée par le SDK)
  const [check, recheck] = useVerifiedEnclave(seen ? arc : null, url, productId);
  const cache = useRef<{ key: string; wallet: unknown; client: X402Client } | null>(null);

  // le prix d'un appel, lu sur Arc (après une courte pause pendant la saisie du produit)
  const pub = arc?.pub;
  const pid = productId.trim();
  useEffect(() => {
    if (!arc || !/^\d{1,10}$/.test(pid)) { setPrice({ state: "idle" }); return; }
    let alive = true;
    setPrice({ state: "reading" });
    const timer = setTimeout(() => {
      readX402Price(arc, BigInt(pid))
        .then((p) => { if (alive) setPrice({ state: "ok", p }); })
        .catch((e) => { if (alive) setPrice({ state: "bad", error: e ?? new Error("?") }); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [pub, pid, priceNonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const payable = price.state === "ok" && price.p.perCall && price.p.active && price.p.price > 0n ? price.p : null;
  useEffect(() => { onPrice?.(payable ? payable.price : null); }, [payable?.price, onPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  const wallet = arc?.wallet;
  const wrongNet = !!wallet && chain?.id !== testnet.chainId;
  const urlOk = /^https?:\/\/\S+$/.test(url.trim());
  const canSend = !!wallet && !wrongNet && !!payable && urlOk && check.state === "ok" && !busy && !paidFail && !!input.trim();

  /** Le client x402 (gardé tant que l'enclave, le produit, le plafond et le portefeuille ne changent pas). */
  function clientFor(cap: bigint, enclaveUrl: string, product: bigint): X402Client {
    if (!arc?.wallet) throw new MsgError(msg("err.connectWallet"));
    const key = `${enclaveUrl.trim()}|${product}|${cap}`;
    if (cache.current && cache.current.key === key && cache.current.wallet === arc.wallet) return cache.current.client;
    const client = makeX402(arc, enclaveUrl, product, cap, {
      onSign: (v) => setStatus(msg("x402.signing", { price: () => usdc(v) })),
      onSigned: () => setStatus(msg("x402.calling")),
    });
    cache.current = { key, wallet: arc.wallet, client };
    return client;
  }

  /** Un appel servi : la réponse (vérifiée par le SDK), son reçu et le suivi de son règlement. */
  function answered(c: X402Completion, fromBlock: bigint) {
    const ref: PaidCallRef = {
      payer: c.receipt.payer, nonce: c.receipt.nonce, productId: c.receipt.productId,
      fromBlock: c.receipt.anchorBlock < fromBlock ? c.receipt.anchorBlock : fromBlock,
      validBefore: c.authorization.validBefore, amount: c.amount,
    };
    const paid: Paid = {
      signer: c.signer, operator: c.operator, amount: c.amount, anchorBlock: c.receipt.anchorBlock,
      settleable: c.settleable, settleableUnknown: c.settleableUnknown === true, replay: c.replay, ref,
    };
    setLines((l) => [...l, { role: "assistant", content: c.text, paid }]);
    setStatus(null);
  }

  async function send() {
    const text = input.trim();
    if (!canSend || !arc || !payable) return;
    const history: ChatMessage[] = [
      ...lines.filter((l) => !l.unanswered).map(({ role, content }) => ({ role, content })),
      { role: "user", content: text },
    ];
    const messages = fitConversation(history);
    if (!messages) { setStatus(failWith(msg("x402.tooLong", { n: MAX_CONV_BYTES / 1024 }))); return; }
    // le plafond : le prix AFFICHÉ (lu sur Arc) ; rien n'est signé au-delà
    const cap = payable.price;
    const fromBlock = payable.block;
    setLines((l) => [...l, { role: "user", content: text }]); setInput("");
    setBusy(true); setStatus(msg("x402.checking"));
    try {
      const c = await clientFor(cap, url, BigInt(pid)).chat.completions.create({ messages });
      answered(c, fromBlock);
    } catch (e: any) {
      if (e?.name === "X402PaidCallError" && e.pending) {
        // payé, sans réponse vérifiée : le message reste, l'encadré dit quoi faire
        setPaidFail({ err: e, ref: refOf(e.pending, fromBlock) });
        setStatus(null);
      } else {
        // rien n'a été signé (clé, prix, refus de l'enclave avant paiement, signature refusée) : le message revient
        setLines((l) => l.slice(0, -1)); setInput(text);
        setStatus(fail(e));
        if (e?.name === "X402ChallengeError") setPriceNonce((n) => n + 1); // le prix a pu changer : il est relu et affiché
      }
    } finally { setBusy(false); }
  }

  /** Reprend l'appel payé : la même requête, la même autorisation ; `acceptPrice` : le nouveau prix, accepté d'un clic
   *  qui l'affichait (une autorisation fraîche à ce prix, même nonce : au plus une des deux peut être réglée). */
  async function resume(acceptPrice?: bigint) {
    const pf = paidFail;
    if (!pf || !arc?.wallet || busy) return;
    const p = pf.err.pending;
    const cap: bigint = acceptPrice ?? (typeof p.maxPrice === "bigint" ? p.maxPrice : p.authorizations[0].value);
    setBusy(true); setStatus(msg("x402.resuming"));
    try {
      const c = await clientFor(cap, p.enclaveUrl || url, p.productId).resume(p, acceptPrice !== undefined ? { renew: true, maxPrice: acceptPrice } : {});
      setPaidFail(null);
      answered(c, pf.ref.fromBlock);
      if (acceptPrice !== undefined) setPriceNonce((n) => n + 1);
    } catch (e: any) {
      if (e?.name === "X402PaidCallError" && e.pending) { setPaidFail({ err: e, ref: refOf(e.pending, pf.ref.fromBlock) }); setStatus(null); }
      else setStatus(fail(e));
    } finally { setBusy(false); }
  }

  /** Laisser l'appel payé : le message reste marqué « payé, sans réponse vérifiée », avec le suivi de son règlement. */
  function dismiss() {
    const pf = paidFail;
    if (!pf || busy) return;
    setLines((l) => {
      const c = [...l];
      for (let i = c.length - 1; i >= 0; i--) if (c[i]!.role === "user") { c[i] = { ...c[i]!, unanswered: pf.ref }; break; }
      return c;
    });
    setPaidFail(null);
  }

  function reset() {
    if (busy || paidFail) return;
    setLines([]); setStatus(null);
  }

  return (
    <Card title={t("x402.title")} sub={t("x402.sub")} right={lines.length > 0 ? <Btn kind="ghost" onClick={reset} disabled={busy || !!paidFail}>{t("copilot.new")}</Btn> : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("field.productId")} value={productId} onChange={setProductId} />
        <div className="min-w-0">
          <span className="text-[13px] text-muted">{t("x402.price.label")}</span>
          <div className="mt-1 flex min-h-[38px] items-center rounded-lg border border-edge bg-ink/60 px-3 py-2 text-[13px]">
            <PriceView price={price} onRetry={() => setPriceNonce((n) => n + 1)} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <Field label={t("field.enclaveUrl")} value={url} onChange={setUrl} placeholder="https://…/enclave/x402" />
          <div className="mt-1.5">
            {url.trim() ? <EnclaveCheckView check={check} onRetry={recheck} /> : <span className="text-[12px] text-muted">{t("x402.needUrl")}</span>}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="max-h-[420px] space-y-2 overflow-auto rounded-xl border border-edge bg-ink/50 p-3">
          {lines.length === 0 && <p className="text-[12px] text-muted">{t("x402.empty")}</p>}
          {lines.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : ""}>
              <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-left text-sm [overflow-wrap:anywhere] ${m.role === "user" ? "bg-accent/20" : "bg-edge"}`}>{m.content}</div>
              {m.paid && <PaidReceipt arc={arc} p={m.paid} />}
              {m.unanswered && (
                <div className="mt-1 text-[12px]">
                  <p className="text-warn">{t("x402.unanswered")}</p>
                  <SettlementLine arc={arc} r={m.unanswered} />
                </div>
              )}
            </div>
          ))}
        </div>
        {paidFail && <PaidCallBox arc={arc} pf={paidFail} busy={busy} onResume={resume} onDismiss={dismiss} />}
        {/* étroit (téléphone) : le bouton, au libellé long (« Payer 0,01 USDC et envoyer »), passe sous le champ, qui garde
            toute la largeur ; à partir de 640 px, côte à côte */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 sm:flex-1"><Field label={t("chat.message")} value={input} onChange={setInput} /></div>
          <div className="flex justify-end sm:block">
            <Btn onClick={send} disabled={!canSend}>{payable ? t("x402.send", { price: usdc(payable.price) }) : t("x402.sendPlain")}</Btn>
          </div>
        </div>
        {!wallet ? <p className="text-[12px] text-muted">{t("x402.needWallet")}</p>
          : wrongNet ? <p className="text-[12px] text-warn">{t("err.wrongNetwork")}</p> : null}
      </div>
      {status && <p className={`mt-2 break-words font-mono text-xs ${isFailure(status) ? "text-bad" : "text-muted"}`}>{show(status)}</p>}
    </Card>
  );
}
