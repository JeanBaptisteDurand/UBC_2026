import { ENCLAVE_URL } from "../config";
import { useEffect, useRef, useState } from "react";
import { Rotate3d } from "lucide-react";
import {
  type ChatMessage, type Completion, type EnclaveView, type ProductView, testnet, createInferenceClient, InferenceClient, encodeAek, maskAek,
} from "@arcvault/sdk";
import { fetchEnclaves, fetchProducts } from "../api";
import { useArc } from "../useArc";
import { DCAP, parseUsdc, useVerifiedEnclave, waitOk } from "../arc";
import { Card, Btn, Field, Badge, Mono, Stat, PageHeader, EnclaveCheckView, usdc } from "../ui";
import { fail, isFailure, msg, show, type Msg } from "../msg";
import { t, tx } from "../i18n";
import { stateLabel } from "./Products";
import { RefillBox, ReceiptPanel, type LastReceipt, type Refill } from "./Chat";
import { LevelBadge, useLevels } from "./Levels";

/** Le message de test envoyé à l'enclave, dans la langue du site. */
const testMessages = (): ChatMessage[] => [{ role: "user", content: t("hive.testPrompt") }];

export default function Hive() {
  const [encs, setEncs] = useState<EnclaveView[]>([]);
  const [products, setProducts] = useState<Map<string, ProductView>>(new Map());
  const [sel, setSel] = useState<EnclaveView | null>(null);
  const [loading, setLoading] = useState(false);
  const levels = useLevels();

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchEnclaves(), fetchProducts()])
      .then(([e, p]) => { setEncs(e); setProducts(new Map(p.map((x) => [x.id.toString(), x]))); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const active = encs.filter((e) => e.active);

  return (
    <div className="space-y-6">
      <PageHeader title={t("hive.title")} lead={t(DCAP ? "hive.lead.dcap" : "hive.lead.dev")}
        actions={
          /* la même ruche en salle des serveurs 3D (/datacenter/) : une autre page du site, dans le même onglet */
          <a href="/datacenter/" className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3.5 py-2 text-[13px] font-medium text-text transition hover:border-muted/60">
            <Rotate3d size={15} aria-hidden="true" />{t("hive.view3d")}
          </a>
        } />

      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("hive.stat.active")} value={active.length} tone="good" />
        <Stat label={t("hive.stat.total")} value={encs.length} />
        <Stat label={t("hive.stat.products")} value={new Set(active.map((e) => e.productId.toString())).size} />
      </div>

      {loading && <p className="text-[13px] text-muted">{t("hive.loading")}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {encs.map((e) => {
          const p = products.get(e.productId.toString());
          const on = e.active;
          return (
            <button key={e.signer} onClick={() => setSel(e)}
              className={`rounded-xl border p-4 text-left transition ${sel?.signer === e.signer ? "border-accent bg-accent/10" : on ? "border-good/40 bg-good/5 hover:border-good/70" : "border-edge bg-panel opacity-60 hover:opacity-80"}`}>
              <div className="flex items-center justify-between">
                <span className={`hex block h-7 w-7 ${on ? "bg-good" : "bg-edge"}`} aria-hidden />
                <Badge tone={on ? "good" : "muted"}>{on ? t("common.active") : t("hive.expired")}</Badge>
              </div>
              <div className="mt-2 text-sm font-medium">{t("common.Product", { id: e.productId.toString() })}</div>
              <Mono>{e.signer.slice(0, 10)}…</Mono>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {!DCAP && <Badge tone="warn">{t("hive.unverified")}</Badge>}
                <Badge tone={e.tcbStatus === 0 ? "good" : "warn"}>{e.tcbStatus === 0 ? t("hive.tcbOk") : t("hive.tcbReview")}</Badge>
                {on && <LevelBadge levels={levels} signer={e.signer} />}
                {p && <Mono>{usdc(p.price)}</Mono>}
              </div>
            </button>
          );
        })}
      </div>

      {sel && <OrderPanel key={sel.signer} enclave={sel} product={products.get(sel.productId.toString())} onClose={() => setSel(null)} />}
    </div>
  );
}

function OrderPanel({ enclave, product, onClose }: { enclave: EnclaveView; product?: ProductView; onClose: () => void }) {
  const arc = useArc();
  const isInference = product?.settlement.toLowerCase() === testnet.sessionPay.toLowerCase();
  const [enclaveUrl, setEnclaveUrl] = useState(ENCLAVE_URL);
  const [deposit, setDeposit] = useState("2");
  const [aek, setAek] = useState("");
  const [out, setOut] = useState<Msg | null>(null);
  const [answer, setAnswer] = useState<{ text: string; verified: boolean } | null>(null);
  const [last, setLast] = useState<LastReceipt | null>(null);
  const [refill, setRefill] = useState<Refill | null>(null);
  const [sessionId, setSessionId] = useState<bigint | null>(null);
  const ic = useRef<InferenceClient | null>(null);
  // l'adresse doit servir CETTE alvéole, et sa clé doit être celle inscrite sur Arc
  const [check, recheck] = useVerifiedEnclave(arc, isInference ? enclaveUrl : "", enclave.productId);
  const served = check.state === "ok" && check.keys.signer.toLowerCase() === enclave.signer.toLowerCase();

  async function test(call: () => Promise<Completion>, messages: ChatMessage[]) {
    setOut(msg("order.testing"));
    try {
      const res = await call();
      setRefill(null);
      setAnswer({ text: res.text, verified: res.verified });
      setLast({ receipt: res.receipt, signature: res.signature, signer: res.signer, verified: res.verified });
      setOut(msg("order.done"));
    } catch (e: any) {
      if (e?.name === "InsufficientSessionBalance") setRefill({ pending: !!e.pending, cost: e.pending?.cost, messages });
      setOut(fail(e));
    }
  }

  async function order() {
    if (!arc || !served) return;
    const url = enclaveUrl.trim();
    setOut(msg("order.opening")); setAnswer(null); setLast(null); setRefill(null);
    try {
      // la session est VERROUILLÉE sur cette alvéole : le SDK revérifie que l'adresse la sert, avec la clé inscrite sur Arc
      const r = await arc.openSession({ productId: enclave.productId, deposit: parseUsdc(deposit, "what.deposit"), enclaveUrl: url, enclave: enclave.signer });
      setOut(msg("order.sent", { id: r.sessionId }));
      await waitOk(arc, r.tx, "tx.openSession");
      setSessionId(r.sessionId);
      setAek(encodeAek("arctest", r.sessionId, r.sessionKey.privateKey));
      const client = createInferenceClient({ enclaveUrl: url, sessionId: r.sessionId, sessionKey: r.sessionKey, publicClient: arc.pub });
      ic.current = client;
      const messages = testMessages();
      await test(() => client.chat.completions.create({ messages }), messages);
    } catch (e) { setOut(fail(e)); }
  }

  async function replay() {
    const client = ic.current;
    if (!client || !refill) return;
    const r = refill;
    await test(() => (r.pending ? client.retryPending() : client.chat.completions.create({ messages: r.messages })), r.messages);
  }

  return (
    <Card title={t("order.title", { id: enclave.productId.toString() })} sub={t("order.sub", { enclave: enclave.signer.slice(0, 14), operator: enclave.operator.slice(0, 10) })}
      right={<Btn kind="ghost" onClick={onClose}>{t("common.close")}</Btn>}>
      {product && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge tone="muted">{product.deterministic ? t("common.deterministic") : t("common.nondeterministic")}</Badge>
          <Badge tone="muted">{t("order.perUnit", { price: usdc(product.price), tokens: isInference ? product.unitTokens : undefined })}</Badge>
          <Badge tone={product.state === "Active" ? "good" : "warn"}>{stateLabel(product.state)}</Badge>
        </div>
      )}
      {!enclave.active ? (
        <p className="text-[13px] text-muted">{t("order.inactive")}</p>
      ) : isInference ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("field.enclaveUrl")} value={enclaveUrl} onChange={setEnclaveUrl} />
            <Field label={t("field.deposit")} value={deposit} onChange={setDeposit} />
          </div>
          <div className="mt-1.5">
            {check.state === "ok" && !served
              ? <span className="text-[12px] text-bad">{t("order.otherEnclave", { signer: check.keys.signer.slice(0, 10) })}</span>
              : <EnclaveCheckView check={check} onRetry={recheck} />}
          </div>
          <div className="mt-3"><Btn onClick={order} disabled={!arc?.wallet || !served}>{t("order.open")}</Btn></div>
          {aek && (
            <div className="mt-3 rounded-xl border border-edge bg-ink/60 p-3">
              <div className="text-xs text-muted">{t("order.aek")}</div>
              <div className="mt-1 font-mono text-sm text-accent">{maskAek(aek)}</div>
              <button className="mt-1 text-[11px] text-muted hover:text-white" onClick={() => navigator.clipboard?.writeText(aek)}>{t("common.copyFullKey")}</button>
            </div>
          )}
          {refill && sessionId !== null && <div className="mt-3"><RefillBox arc={arc} sessionId={sessionId} refill={refill} onRefilled={replay} /></div>}
          {answer && (
            <div className="mt-3 rounded-xl border border-edge bg-edge/40 p-3">
              <div className="text-sm">{answer.text}</div>
              <div className="mt-1"><Badge tone={answer.verified ? "good" : "bad"}>{answer.verified ? t("order.receiptOk") : t("order.receiptBad")}</Badge></div>
            </div>
          )}
          {last && <div className="mt-3"><ReceiptPanel arc={arc} last={last} /></div>}
        </>
      ) : (
        <p className="text-[13px] text-muted">{tx("order.bounty", { link: <a href="#/primes" className="text-accent hover:underline">{t("nav.primes")}</a> })}</p>
      )}
      {out && <p className={`mt-2 break-words font-mono text-xs ${isFailure(out) ? "text-bad" : "text-muted"}`}>{show(out)}</p>}
    </Card>
  );
}
