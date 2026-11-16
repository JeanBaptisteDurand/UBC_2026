import { ENCLAVE_URL } from "../config";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Hex } from "viem";
import {
  createInferenceClient, InferenceClient, serializeReceipt, testnet,
  type ArcClient, type ChatMessage, type Completion, type EnclaveView, type Receipt, type ReceiptCheck, type ReceiptVerification,
} from "@arcvault/sdk";
import { useArc } from "../useArc";
import { fetchEnclaves, fetchProducts } from "../api";
import { INFERENCE_PRODUCT, parseUsdc, useVerifiedEnclave, waitOk } from "../arc";
import { Card, Btn, Field, Badge, Mono, Status, EnclaveCheckView, Hex as HexVal, usdc, short } from "../ui";
import { explainError } from "../errors";
import { fail, isFailure, msg, show, type Msg as Note } from "../msg";
import { fmtNum, fmtUnix, getLang, t, tx, useLang } from "../i18n";

type Msg = ChatMessage & { receipt?: Receipt; verified?: boolean };
/** Le dernier reçu d'une session : la preuve de ce qui est dû, réglable on-chain par n'importe qui (SessionPay.settle). */
export interface LastReceipt { receipt: Receipt; signature: Hex; signer: string; verified: boolean }
/** 402 : la session ne couvre pas la requête. `pending` : l'enclave garde une réponse déjà calculée (pendingSeq). */
export interface Refill { pending: boolean; cost?: bigint; messages: ChatMessage[] }
interface OpenSession { id: bigint; enclave: string; operator: string; expiresAt: bigint }

/** Recharge suggérée : de quoi couvrir largement la réponse en attente, 1 USDC au moins. */
function suggestRefill(cost?: bigint): string {
  const need = cost ? Number(cost) / 1e6 : 0;
  return String(Math.max(1, Math.ceil(need * 2)));
}

/** 402 de l'enclave : recharger la session (topUp), puis rejouer — la réponse gardée, ou le message refusé. */
export function RefillBox({ arc, sessionId, refill, onRefilled }: { arc: ArcClient | null; sessionId: bigint; refill: Refill; onRefilled: () => Promise<void> }) {
  const [amount, setAmount] = useState(() => suggestRefill(refill.cost));
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!arc) return;
    setBusy(true);
    try {
      const v = parseUsdc(amount, "what.topUp");
      setNote(msg("refill.signing"));
      const hash = await arc.topUp(sessionId, v);
      setNote(msg("refill.sent"));
      await waitOk(arc, hash, "tx.topUp");
      setNote(null);
      await onRefilled();
    } catch (e) { setNote(fail(e)); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-lg border border-warn/40 bg-warn/5 p-3">
      <div className="text-[13px] font-medium text-warn">{refill.pending ? t("refill.pendingTitle") : t("refill.lowTitle")}</div>
      <p className="mt-1 text-[12px] text-muted">
        {refill.pending ? t("refill.pendingText", { cost: usdc(refill.cost) }) : t("refill.lowText")}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="w-36"><Field label={t("refill.field")} value={amount} onChange={setAmount} /></div>
        <Btn onClick={go} disabled={!arc?.wallet || busy}>{refill.pending ? t("refill.pendingBtn") : t("refill.lowBtn")}</Btn>
      </div>
      <Status msg={note} />
    </div>
  );
}

/** Une vérification du reçu en mots : la phrase du SDK en français ; en anglais, la même, refaite depuis les données
 *  de la vérification (session, signataire, opérateur au bloc d'ancrage). */
function checkText(c: ReceiptCheck, v: ReceiptVerification, r: Receipt): string {
  if (getLang() === "fr") return c.fr;
  const s = v.session;
  switch (c.id) {
    case "session": return t(c.ok ? "rc.session.ok" : "rc.session.bad", { id: r.sessionId });
    case "open": return t(c.ok ? "rc.open.ok" : "rc.open.bad");
    case "product": return c.ok ? t("rc.product.ok", { id: s?.productId ?? r.productId }) : t("rc.product.bad", { receipt: r.productId, session: s?.productId ?? "?" });
    case "active": return t(c.ok ? "rc.active.ok" : "rc.active.bad", { signer: v.signer, block: r.anchorBlock });
    case "operator": return c.ok ? t("rc.operator.ok", { op: s?.operator ?? v.activeOperatorAtAnchor }) : t("rc.operator.bad", { op: v.activeOperatorAtAnchor, session: s?.operator ?? "?" });
    case "enclave": return c.ok ? t("rc.enclave.ok") : t("rc.enclave.bad", { signer: v.signer, locked: s?.enclave ?? "?" });
    case "model": return c.ok ? t("rc.model.ok") : t("rc.model.bad", { hash: r.modelHash, model: s?.param ?? "?" });
    case "increasing": return t(c.ok ? "rc.increasing.ok" : "rc.increasing.bad", { units: r.cumulativeUnits, paid: s?.paidUnits ?? 0n });
  }
  return c.fr;
}

/** Le dernier reçu et sa vérification on-chain, exactement comme SessionPay.settle la fera (lectures seulement). */
export function ReceiptPanel({ arc, last }: { arc: ArcClient | null; last: LastReceipt }) {
  const [v, setV] = useState<ReceiptVerification | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const pub = arc?.pub;
  useEffect(() => {
    if (!arc) return;
    let alive = true;
    setV(null); setErr(null);
    arc.verifyReceipt(last.receipt, last.signature).then((x) => { if (alive) setV(x); }).catch((e) => { if (alive) setErr(e ?? new Error("?")); });
    return () => { alive = false; };
  }, [pub, last]);
  const r = last.receipt;
  const json = JSON.stringify({ receipt: serializeReceipt(r), signature: last.signature }, null, 2);
  return (
    <div className="rounded-xl border border-edge bg-ink/50 p-3 text-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-medium">{t("receipt.title", { seq: r.seq.toString(), id: r.sessionId.toString() })}</div>
        <div className="flex items-center gap-2">
          {v ? <Badge tone={v.settleable ? "good" : "bad"}>{v.settleable ? t("receipt.settleable") : t("receipt.notSettleable")}</Badge>
            : !err && <span className="text-muted">{t("receipt.checking")}</span>}
          <button className="text-accent hover:underline" onClick={() => { navigator.clipboard?.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? t("receipt.copied") : t("receipt.copy")}
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-muted">
        <span>{tx("receipt.signedBy", { signer: <HexVal value={last.signer} n={4} /> })}</span>
        <span>{t("receipt.tokens", { in: fmtNum(r.tokensIn), out: fmtNum(r.tokensOut) })}</span>
        <span>{t("receipt.units", { n: fmtNum(r.cumulativeUnits) })}</span>
        <span>{t("receipt.anchor", { n: fmtNum(r.anchorBlock) })}</span>
        {v?.settleable && <span>{t("receipt.payable", { amt: usdc(v.payableNow) })}</span>}
      </div>
      {v && (
        <ul className="mt-2 grid gap-0.5 sm:grid-cols-2">
          {v.checks.map((c) => (
            <li key={c.id} className="flex gap-1.5 break-words"><span className={c.ok ? "text-good" : "text-bad"}>{c.ok ? "✓" : "✗"}</span><span className="min-w-0 text-muted">{checkText(c, v, r)}</span></li>
          ))}
        </ul>
      )}
      {err !== null && <p className="mt-1 text-bad">{t("receipt.error", { err: explainError(err) })}</p>}
    </div>
  );
}

export default function Chat() {
  const arc = useArc();
  const lang = useLang();
  const [productId, setProductId] = useState(INFERENCE_PRODUCT.toString());
  const [enclaveUrl, setEnclaveUrl] = useState(ENCLAVE_URL);
  const [deposit, setDeposit] = useState("2");
  const [session, setSession] = useState<OpenSession | null>(null);
  const [ended, setEnded] = useState(false); // 410 : l'enclave ne sert plus cette session
  const [msgs, setMsgs] = useState<Msg[]>([]);
  // null : la question d'exemple, dans la langue du moment (tant que l'utilisateur n'a rien tapé)
  const [typed, setInput] = useState<string | null>(null);
  const input = typed ?? t("chat.defaultPrompt");
  // la ligne d'état : un message (clé et valeurs), mis en mots à l'affichage dans la langue du moment
  const [status, setStatus] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [hive, setHive] = useState<{ encs: EnclaveView[]; infer: Set<string> } | null>(null);
  const [refill, setRefill] = useState<Refill | null>(null);
  const [last, setLast] = useState<LastReceipt | null>(null);
  const ic = useRef<InferenceClient | null>(null);
  // v2 : la clé de l'enclave servie à cette adresse est confrontée à la chaîne AVANT toute ouverture de session
  const [check, recheck] = useVerifiedEnclave(arc, enclaveUrl, productId);

  // Repère lu par l'API (une fois) : les enclaves actives de la ruche et les produits d'inférence.
  useEffect(() => {
    if (session) return;
    let alive = true;
    Promise.all([fetchEnclaves(), fetchProducts()]).then(([encs, prods]) => {
      const infer = new Set(prods.filter((p) => p.state === "Active" && p.settlement.toLowerCase() === testnet.sessionPay.toLowerCase()).map((p) => p.id.toString()));
      if (alive) setHive({ encs, infer });
    }).catch(() => { /* repère facultatif : la vérification sur Arc suffit */ });
    return () => { alive = false; };
  }, [session]);
  const hint = useMemo(() => {
    if (!hive) return "";
    const pid = productId.trim();
    const n = hive.encs.filter((e) => e.active && e.productId.toString() === pid).length;
    const other = hive.encs.find((e) => e.active && hive.infer.has(e.productId.toString()));
    return n > 0 ? t("chat.hint", { n, pid })
      : other ? t("chat.hintOther", { pid, other: other.productId.toString() })
      : t("chat.hintNone");
  }, [hive, productId, lang]);

  async function open() {
    if (!arc || check.state !== "ok") return;
    const url = enclaveUrl.trim();
    setStatus(msg("chat.opening"));
    try {
      const amount = parseUsdc(deposit, "what.deposit");
      // la session est VERROUILLÉE sur l'enclave vérifiée : seuls ses reçus la paieront
      const r = await arc.openSession({ productId: BigInt(productId.trim()), deposit: amount, enclaveUrl: url, enclave: check.keys.signer });
      setStatus(msg("order.sent", { id: r.sessionId }));
      await waitOk(arc, r.tx, "tx.openSession");
      ic.current = createInferenceClient({ enclaveUrl: url, sessionId: r.sessionId, sessionKey: r.sessionKey, publicClient: arc.pub });
      setMsgs([]); setLast(null); setRefill(null); setEnded(false);
      setSession({ id: r.sessionId, enclave: r.enclave, operator: r.operator, expiresAt: r.expiresAt });
      setStatus(msg("chat.opened", { id: r.sessionId, enclave: short(r.enclave) }));
    } catch (e) { setStatus(fail(e)); }
  }

  /** Un appel à l'enclave (ou la réponse gardée après recharge) : la réponse et son reçu, ou le refus expliqué. */
  async function ask(call: () => Promise<Completion>, messages: ChatMessage[]) {
    setBusy(true); setStatus(msg("chat.calling"));
    try {
      const res = await call();
      setRefill(null);
      setMsgs((m) => [...m, { role: "assistant", content: res.text, receipt: res.receipt, verified: res.verified }]);
      setLast({ receipt: res.receipt, signature: res.signature, signer: res.signer, verified: res.verified });
      setStatus(null);
    } catch (e: any) {
      if (e?.name === "InsufficientSessionBalance") setRefill({ pending: !!e.pending, cost: e.pending?.cost, messages });
      if (e?.name === "SessionExpiredError") setEnded(true);
      setStatus(fail(e));
    } finally { setBusy(false); }
  }

  async function send() {
    const client = ic.current;
    const text = input.trim();
    if (!client || !text || busy || refill || ended) return;
    const messages: ChatMessage[] = [...msgs.map(({ role, content }) => ({ role, content })), { role: "user", content: text }];
    setMsgs((m) => [...m, { role: "user", content: text }]); setInput("");
    await ask(() => client.chat.completions.create({ messages }), messages);
  }

  async function replay() {
    const client = ic.current;
    if (!client || !refill) return;
    const r = refill;
    await ask(() => (r.pending ? client.retryPending() : client.chat.completions.create({ messages: r.messages })), r.messages);
  }

  function reset() {
    ic.current = null;
    setSession(null); setMsgs([]); setLast(null); setRefill(null); setEnded(false); setStatus(null);
  }

  return (
    <div className="space-y-6">
      <Card title={t("chat.title")} sub={t("chat.sub")}>
        {!session ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("field.productId")} value={productId} onChange={setProductId} />
            <Field label={t("field.deposit")} value={deposit} onChange={setDeposit} hint={t("chat.depositHint")} />
            <div className="sm:col-span-2">
              <Field label={t("field.enclaveUrl")} value={enclaveUrl} onChange={setEnclaveUrl} />
              <div className="mt-1.5"><EnclaveCheckView check={check} onRetry={recheck} /></div>
            </div>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <Btn onClick={open} disabled={!arc?.wallet || check.state !== "ok"}>{t("chat.open")}</Btn>
              {!arc?.wallet && <span className="text-[12px] text-muted">{t("chat.needWallet")}</span>}
            </div>
            {hint && <p className="sm:col-span-2 font-mono text-xs text-muted">{hint}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
              <span>
                {tx("chat.header", { id: session.id.toString(), enclave: <HexVal value={session.enclave} n={4} />, when: fmtUnix(session.expiresAt) })}
              </span>
              <Btn kind="ghost" onClick={reset}>{t("chat.new")}</Btn>
            </div>
            <div className="max-h-[360px] space-y-2 overflow-auto rounded-xl border border-edge bg-ink/50 p-3">
              {msgs.length === 0 && <p className="text-[12px] text-muted">{t("chat.empty")}</p>}
              {msgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "text-right" : ""}>
                  <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-left text-sm ${m.role === "user" ? "bg-accent/20" : "bg-edge"}`}>{m.content}</div>
                  {m.receipt && (
                    <div className="mt-1 flex items-center gap-2">
                      <Badge tone={m.verified ? "good" : "bad"}>{m.verified ? t("chat.receiptOk") : t("chat.receiptBad")}</Badge>
                      <Mono>{t("chat.units", { n: fmtNum(m.receipt.cumulativeUnits), seq: m.receipt.seq.toString() })}</Mono>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {refill && <RefillBox arc={arc} sessionId={session.id} refill={refill} onRefilled={replay} />}
            {ended ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-edge px-3 py-2.5 text-[13px] text-muted">
                {t("chat.ended")}
                <Btn onClick={reset}>{t("chat.openNew")}</Btn>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex-1"><Field label={t("chat.message")} value={input} onChange={setInput} /></div>
                <Btn onClick={send} disabled={busy || !!refill || !input.trim()}>{t("chat.send")}</Btn>
              </div>
            )}
            {last && <ReceiptPanel arc={arc} last={last} />}
          </div>
        )}
        {status && <p className={`mt-2 break-words font-mono text-xs ${isFailure(status) ? "text-bad" : "text-muted"}`}>{show(status)}</p>}
      </Card>
    </div>
  );
}
