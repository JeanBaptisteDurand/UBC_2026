/** X402Chat.tsx — private AI PAID PER CALL (the x402 rail, product 3 of the v2.1 stack): no session, no deposit.
 *  Each message is one call, encrypted for the enclave alone (its key checked against Arc). ONE EIP-3009 signature
 *  pays it to X402Settler, at the exact price READ ON ARC. A signature is not a transaction, so it costs no gas.
 *  The price shows BEFORE any signature, and nothing is signed above it (x402.ts: the SDK's maxAmount, and a wallet
 *  capped at that price).
 *  Each answer arrives with its receipt, which the SDK verifies: signed by the verified enclave, for this payer, this
 *  amount, this request and this text. The state of its settlement follows, read on Arc: pending, then settled by
 *  the operator.
 *  A paid call left without a verified answer (X402PaidCallError) is explained: the answer may be lost while the
 *  payment may still settle. "Resume" sends the SAME request with the SAME authorization, so it is never charged
 *  twice, as long as the enclave can still return the answer. A price that rose in the meantime is accepted only by a
 *  click that shows it. Any failure before payment (key, price, enclave refusal, signature refused) puts the message
 *  back in the field: nothing was signed. */
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

/** What a served call paid: its receipt verified by the SDK, and what is needed to follow its settlement. */
interface Paid {
  signer: string; operator: string; amount: bigint; anchorBlock: bigint;
  settleable: boolean; settleableUnknown: boolean; replay: boolean; ref: PaidCallRef;
}
/** A line of the conversation. `unanswered`: a paid message left without a verified answer (kept as is). */
type Line = { role: "user" | "assistant"; content: string; paid?: Paid; unanswered?: PaidCallRef };
type PriceState = { state: "idle" } | { state: "reading" } | { state: "ok"; p: X402Price } | { state: "bad"; error: unknown };
/** A paid call without a verified answer: the SDK's error (its `pending` is used to resume) and its settlement tracking. */
interface PaidFailure { err: any; ref: PaidCallRef }

/** The whole conversation is sent with each call and must fit in the enclave's request (32 KiB in clear text by default,
 *  salt included): at most 24 KiB of messages, the oldest removed first; null if the last one alone is too large. */
const MAX_CONV_BYTES = 24 * 1024;
function fitConversation(messages: ChatMessage[]): ChatMessage[] | null {
  const size = (m: ChatMessage[]) => new TextEncoder().encode(JSON.stringify(m)).length;
  let kept = messages;
  while (kept.length > 1 && (size(kept) > MAX_CONV_BYTES || kept[0]!.role === "assistant")) kept = kept.slice(1);
  return size(kept) > MAX_CONV_BYTES ? null : kept;
}

/** What follows a paid call: its payer, its nonce (shared by all its authorizations), the latest expiry. */
function refOf(p: any, fromBlock: bigint): PaidCallRef {
  const auths: any[] = Array.isArray(p?.authorizations) && p.authorizations.length ? p.authorizations : [p?.authorization];
  const big = (pick: (a: any) => unknown) => auths.reduce((m: bigint, a) => { const v = pick(a); return typeof v === "bigint" && v > m ? v : m; }, 0n);
  return { payer: p.payer, nonce: p.nonce, productId: p.productId, fromBlock, validBefore: big((a) => a?.validBefore), amount: big((a) => a?.value) };
}

/** The name of the contract that settles a product (to say why it is not paid per call). */
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

/** The settlement of a paid call, read on Arc (and read again until a final state). */
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

/** The receipt of a served call (verified by the SDK before the text is rendered) and its settlement. */
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

/** A paid call without a verified answer: what happened (paidCallText, from the error's fields, without repeating the
 *  title; an answer discarded because it did not match its receipt is described as such), where its settlement
 *  stands, and the resume button while resuming is still possible. */
function PaidCallBox({ arc, pf, busy, onResume, onDismiss }: {
  arc: ArcClient | null; pf: PaidFailure; busy: boolean; onResume: (acceptPrice?: bigint) => void; onDismiss: () => void;
}) {
  const e = pf.err;
  const lost = e?.code === "enclave_changed";
  // the enclave keeps the answer only until the authorization's expiry (and only if it has not restarted)
  const canResume = !lost && BigInt(Math.floor(Date.now() / 1000)) + 10n < pf.ref.validBefore;
  const newPrice: bigint | undefined = (e?.code === "price_increased" || e?.code === "price_above_cap") && typeof e?.newPrice === "bigint" ? e.newPrice : undefined;
  return (
    <div className="rounded-lg border border-warn/40 bg-warn/5 p-3" role="alert">
      <div className="text-[13px] font-medium text-warn">{t(lost ? "x402.paid.lostTitle" : "x402.paid.title")}</div>
      <p className="expl mt-1 break-words text-[12px] text-muted">{paidCallText(e)}</p>
      <div className="mt-1.5 text-[12px]"><SettlementLine arc={arc} r={pf.ref} /></div>
      {!lost && !canResume && <p className="expl mt-1 text-[12px] text-muted">{t("x402.paid.noResume")}</p>}
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

/** `active`: the mode is shown (the enclave's key is verified only once the mode is open); `onPrice`: the price of a
 *  call read on Arc (null if it cannot be paid), for the label of the payment choice. */
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
  // null: the sample question, in the current language (until the user types something)
  const [typed, setInput] = useState<string | null>(null);
  const input = typed ?? t("chat.defaultPrompt");
  const [status, setStatus] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [paidFail, setPaidFail] = useState<PaidFailure | null>(null);
  // the key of the enclave served at this address, checked against the chain before anything is sent (shown, then checked again by the SDK)
  const [check, recheck] = useVerifiedEnclave(seen ? arc : null, url, productId);
  const cache = useRef<{ key: string; wallet: unknown; client: X402Client } | null>(null);

  // the price of a call, read on Arc (after a short pause while the product is being typed)
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

  /** The x402 client (kept while the enclave, the product, the cap and the wallet do not change). */
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

  /** A served call: the answer (verified by the SDK), its receipt and its settlement tracking. */
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
    // the cap: the price SHOWN (read on Arc); nothing is signed above it
    const cap = payable.price;
    const fromBlock = payable.block;
    setLines((l) => [...l, { role: "user", content: text }]); setInput("");
    setBusy(true); setStatus(msg("x402.checking"));
    try {
      const c = await clientFor(cap, url, BigInt(pid)).chat.completions.create({ messages });
      answered(c, fromBlock);
    } catch (e: any) {
      if (e?.name === "X402PaidCallError" && e.pending) {
        // paid, without a verified answer: the message stays, the box says what to do
        setPaidFail({ err: e, ref: refOf(e.pending, fromBlock) });
        setStatus(null);
      } else {
        // nothing was signed (key, price, enclave refusal before payment, signature refused): the message comes back
        setLines((l) => l.slice(0, -1)); setInput(text);
        setStatus(fail(e));
        if (e?.name === "X402ChallengeError") setPriceNonce((n) => n + 1); // the price may have changed: it is read again and shown
      }
    } finally { setBusy(false); }
  }

  /** Resumes the paid call: the same request, the same authorization; `acceptPrice`: the new price, accepted by a click
   *  that showed it (a fresh authorization at this price, same nonce: at most one of the two can be settled). */
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

  /** Leave the paid call: the message stays marked "paid, without a verified answer", with its settlement tracking. */
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
            {url.trim() ? <EnclaveCheckView check={check} onRetry={recheck} /> : <span className="expl text-[12px] text-muted">{t("x402.needUrl")}</span>}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="max-h-[420px] space-y-2 overflow-auto rounded-xl border border-edge bg-ink/50 p-3">
          {lines.length === 0 && <p className="expl text-[12px] text-muted">{t("x402.empty")}</p>}
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
        {/* narrow (phone): the button, with its long label ("Pay 0.01 USDC and send"), moves under the field, which keeps
            the full width; from 640 px, side by side */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 sm:flex-1"><Field label={t("chat.message")} value={input} onChange={setInput} /></div>
          <div className="flex justify-end sm:block">
            <Btn onClick={send} disabled={!canSend}>{payable ? t("x402.send", { price: usdc(payable.price) }) : t("x402.sendPlain")}</Btn>
          </div>
        </div>
        {!wallet ? <p className="expl text-[12px] text-muted">{t("x402.needWallet")}</p>
          : wrongNet ? <p className="expl text-[12px] text-warn">{t("err.wrongNetwork")}</p> : null}
      </div>
      {status && <p className={`mt-2 break-words font-mono text-xs ${isFailure(status) ? "text-bad" : "text-muted"}`}>{show(status)}</p>}
    </Card>
  );
}
