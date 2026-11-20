import { COPILOT_SITE_URL, ENCLAVE_URL } from "../config";
import { useEffect, useRef, useState } from "react";
import { Rotate3d } from "lucide-react";
import {
  type ChatMessage, type Completion, type ProductView, createInferenceClient, InferenceClient, encodeAek, maskAek,
} from "@arcvault/sdk";
import { testnet } from "../deployment";
import { fetchEnclaves, fetchProducts, fetchProof, type Enclave, type Proof } from "../api";
import { useArc } from "../useArc";
import { DCAP, bountyLevelOf, parseUsdc, useVerifiedEnclave, waitOk } from "../arc";
import { Card, Btn, Field, Badge, Mono, Stat, PageHeader, EnclaveCheckView, usdc } from "../ui";
import { fail, isFailure, msg, show, type Msg } from "../msg";
import { t, tx } from "../i18n";
import { stateLabel } from "./Products";
import { RefillBox, ReceiptPanel, type LastReceipt, type Refill } from "./Chat";
import { LevelBadge, useLevels } from "./Levels";
import { ProofChain } from "./Overview";

/** A product's price with its unit: per token (prepaid session), per call (x402), paid from a bounty's pool, or free
 *  (no settlement contract: the attested copilot). */
function priceOf(p: ProductView): string {
  const s = p.settlement.toLowerCase();
  if (/^0x0{40}$/.test(s)) return t("hive.price.free");
  if (bountyLevelOf(s)) return t("hive.price.pool");
  if (s === testnet.x402Settler.toLowerCase()) return t("hive.price.call", { p: usdc(p.price) });
  if (s === testnet.sessionPay.toLowerCase()) return t("hive.price.unit", { p: usdc(p.price) });
  return usdc(p.price);
}

/** The refutation demo's enclave (v2.1 stack: product 5 there, bounty #2): its claim was refuted on Arc and its
 *  operator's bond seized (block 71620138). These events are older than the /activity window, so they are written here;
 *  the v3 registry does not list this enclave. */
const REFUTED: Record<string, string> = {
  "0xedc7df91392c40c89955249006c1fa47bc34e497": "0x0ffca5433186735bf5525e525995f3589d842681da8ffcaa82acb5993025051f",
};

/** The test message sent to the enclave, in the site's language. */
const testMessages = (): ChatMessage[] => [{ role: "user", content: t("hive.testPrompt") }];

export default function Hive() {
  const [encs, setEncs] = useState<Enclave[]>([]);
  const [products, setProducts] = useState<Map<string, ProductView>>(new Map());
  const [sel, setSel] = useState<Enclave | null>(null);
  const [loading, setLoading] = useState(false);
  const levels = useLevels();
  // the control panel is below the cells (about 2,000 px down on a phone): the page scrolls to it on selection
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sel) panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sel?.signer]); // eslint-disable-line react-hooks/exhaustive-deps

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
          /* the same hive as a 3D server room (/datacenter/): another page of the site, in the same tab */
          <a href="/datacenter/" className="tap inline-flex items-center gap-1.5 rounded-lg border border-edge px-3.5 py-2 text-[13px] font-medium text-text transition hover:border-muted/60">
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
          const liar = REFUTED[e.signer.toLowerCase()];
          // the state reported by the chain (API): active, withdrawn by its operator, invalidated (with the reason), expired
          const status = e.status ?? (on ? "active" : "expired");
          const why = status === "invalidated" ? t("hive.invalidated.title", { reason: e.statusReason ?? "" }) : undefined;
          return (
            // flex-col: a cell's content starts at the top (a button centres its content, so a shorter inactive cell
            // would have its hexagon and state pushed to the middle of the box); items-stretch: the browser aligns a
            // button's content at the start, and the state must stay on the right
            <button key={e.signer} onClick={() => setSel(e)} aria-pressed={sel?.signer === e.signer}
              className={`flex min-w-0 flex-col items-stretch rounded-xl border p-3 text-left transition sm:p-4 ${sel?.signer === e.signer ? "border-accent bg-accent/10" : on ? "border-good/40 bg-good/5 hover:border-good/70" : "border-edge bg-panel opacity-60 hover:opacity-80"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className={`hex block h-7 w-7 shrink-0 ${on ? "bg-good" : "bg-edge"}`} aria-hidden />
                {liar && !on
                  ? <span title={t("hive.refuted.title")}><Badge tone="bad">{t("hive.refuted")}</Badge></span>
                  : <span title={why}><Badge tone={on ? "good" : "muted"}>{t(`hive.status.${status}` as const)}</Badge></span>}
              </div>
              <div className="mt-2 text-sm font-medium">{t("common.Product", { id: e.productId.toString() })}</div>
              <Mono>{e.signer.slice(0, 10)}…</Mono>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                {!DCAP && <Badge tone="warn">{t("hive.unverified")}</Badge>}
                <Badge tone={e.tcbStatus === 0 ? "good" : "warn"}>{e.tcbStatus === 0 ? t("hive.tcbOk") : t("hive.tcbReview")}</Badge>
                {on && <LevelBadge levels={levels} signer={e.signer} />}
                {p && <Mono>{priceOf(p)}</Mono>}
              </div>
            </button>
          );
        })}
      </div>

      <div ref={panel} className="scroll-mt-20">
        {sel && <OrderPanel key={sel.signer} enclave={sel} product={products.get(sel.productId.toString())} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}

function OrderPanel({ enclave, product, onClose }: { enclave: Enclave; product?: ProductView; onClose: () => void }) {
  const arc = useArc();
  const isInference = product?.settlement.toLowerCase() === testnet.sessionPay.toLowerCase();
  // the other rails are driven elsewhere: the paid x402 call on the Private AI page, the attested copilot (free)
  // through the site's copilot panel, bounties (both levels) on the Bounties page
  const rail = product?.settlement.toLowerCase() ?? "";
  const isX402 = rail === testnet.x402Settler.toLowerCase();
  const isFree = /^0x0{40}$/.test(rail);
  // the state of THIS cell (reported by the chain, API): an inactive cell shows its own, never its product's "Active"
  // state right above "this cell is no longer active"
  const status = enclave.status ?? (enclave.active ? "active" : "expired");
  const liar = !!REFUTED[enclave.signer.toLowerCase()];
  // the proof chain of THIS enclave (GET /proof?signer=); an API response about another enclave is not shown
  const [proof, setProof] = useState<Proof | null>(null);
  const [proofFailed, setProofFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchProof(enclave.signer)
      .then((p) => { if (!alive) return; if (p.enclave?.signer?.toLowerCase() === enclave.signer.toLowerCase()) setProof(p); else setProofFailed(true); })
      .catch(() => { if (alive) setProofFailed(true); });
    return () => { alive = false; };
  }, [enclave.signer]);
  const [enclaveUrl, setEnclaveUrl] = useState(ENCLAVE_URL);
  const [deposit, setDeposit] = useState("2");
  const [aek, setAek] = useState("");
  const [out, setOut] = useState<Msg | null>(null);
  const [answer, setAnswer] = useState<{ text: string; verified: boolean } | null>(null);
  const [last, setLast] = useState<LastReceipt | null>(null);
  const [refill, setRefill] = useState<Refill | null>(null);
  const [sessionId, setSessionId] = useState<bigint | null>(null);
  const ic = useRef<InferenceClient | null>(null);
  // the address must serve THIS cell, and its key must be the one registered on Arc; for the attested copilot (free,
  // active), the same read-only check of the site copilot's enclave
  const checkUrl = isInference ? enclaveUrl : isFree && enclave.active ? COPILOT_SITE_URL : "";
  const [check, recheck] = useVerifiedEnclave(arc, checkUrl, enclave.productId);
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
      // the session is LOCKED to this cell: the SDK checks again that the address serves it, with the key registered on Arc
      const r = await arc.openSession({ productId: enclave.productId, deposit: parseUsdc(deposit, "what.deposit"), enclaveUrl: url, enclave: enclave.signer });
      setOut(msg("order.sent", { id: r.sessionId }));
      await waitOk(arc, r.tx, "tx.openSession");
      setSessionId(r.sessionId);
      setAek(encodeAek("arctest", r.sessionId, r.sessionKey.privateKey));
      const client = createInferenceClient({ enclaveUrl: url, sessionId: r.sessionId, sessionKey: r.sessionKey, publicClient: arc.pub, deployment: arc.d });
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
          <Badge tone="muted">{isInference ? t("order.perUnit", { price: usdc(product.price), tokens: product.unitTokens }) : priceOf(product)}</Badge>
          {enclave.active
            ? <Badge tone={product.state === "Active" ? "good" : "warn"}>{stateLabel(product.state)}</Badge>
            : <span title={status === "invalidated" ? t("hive.invalidated.title", { reason: enclave.statusReason ?? "" }) : liar ? t("hive.refuted.title") : undefined}>
                <Badge tone={liar || status === "invalidated" ? "bad" : "muted"}>{liar ? t("hive.refuted") : t(`hive.status.${status}` as const)}</Badge>
              </span>}
          {!enclave.active && product.state !== "Active" && <Badge tone="warn">{t("order.productState", { state: stateLabel(product.state) })}</Badge>}
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
              <button className="tap mt-1 text-[11px] text-muted hover:text-white" onClick={() => navigator.clipboard?.writeText(aek)}>{t("common.copyFullKey")}</button>
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
      ) : isX402 ? (
        // the link opens the Private AI page directly on "Pay per call" (Playground, ?mode=x402)
        <p className="text-[13px] text-muted">{tx("order.x402", { link: <a href="#/playground?mode=x402" className="text-accent hover:underline">{t("nav.playground")}</a> })}</p>
      ) : isFree ? (
        // the attested copilot (product 4) answers in the copilot panel of the site's pages; its key is checked against
        // Arc right here (a read of /enclave/copilot-site/pubkeys), and this console's button can switch back to the server
        <>
          <p className="text-[13px] text-muted">{tx("order.free", { link: <a href="/network.html" className="text-accent hover:underline">{t("order.free.site")}</a> })}</p>
          {COPILOT_SITE_URL && (
            <div className="mt-1.5">
              {check.state === "ok" && !served
                ? <span className="text-[12px] text-bad">{t("order.otherEnclave", { signer: check.keys.signer.slice(0, 10) })}</span>
                : <EnclaveCheckView check={check} onRetry={recheck} />}
            </div>
          )}
        </>
      ) : (
        <p className="text-[13px] text-muted">{tx("order.bounty", { link: <a href="#/primes" className="text-accent hover:underline">{t("nav.primes")}</a> })}</p>
      )}
      {out && <p className={`mt-2 break-words font-mono text-xs ${isFailure(out) ? "text-bad" : "text-muted"}`}>{show(out)}</p>}
      <div className="mt-5 border-t border-edge pt-4">
        <div className="mb-3 text-[13px] font-medium">{t("order.proof")}</div>
        {proofFailed ? <p className="expl text-[12px] text-muted">{t("order.proofUnavailable")}</p> : <ProofChain p={proof} />}
      </div>
    </Card>
  );
}
