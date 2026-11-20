import { useEffect, useState, type ReactNode } from "react";
import { MessageSquareLock, Crosshair, Server, PackagePlus, ChevronRight } from "lucide-react";
import { STACK_NAME, testnet } from "../deployment";
import { fetchStats, fetchActivity, fetchProof, type Stats, type ActivityEvent, type Proof } from "../api";
import { PageHeader, Section, Hex, Badge, usdc, short } from "../ui";
import { skipReason } from "../arc";
import { explainError } from "../errors";
import { fmtNum, fmtUnix, t, tx } from "../i18n";

const DCAP = testnet.attestation === "dcap";

/** A link of the proof chain: a hexagonal cell that lights up when the fact is proven on-chain. On a phone, the links
 *  form a list (the cell on the left, the text beside it); wider, a grid. */
function Link_({ n, title, what, proven, last, children }: { n: number; title: string; what: string; proven: boolean; last?: boolean; children: ReactNode }) {
  return (
    <li className="relative flex items-start gap-3 sm:flex-col sm:gap-2">
      {/* line to the next link (on one row, on a very large screen: at 1024 px, three links per row) */}
      {!last && <span aria-hidden className={`absolute left-11 top-[21px] hidden h-px w-[calc(100%-44px+24px)] xl:block ${proven ? "bg-good/60" : "bg-edge"}`} />}
      <span className={`hex relative z-10 grid h-11 w-11 shrink-0 place-items-center font-mono text-[13px] font-medium ${proven ? "bg-good text-ink" : "bg-edge text-muted"}`}>{n}</span>
      <div className="flex min-w-0 flex-col items-start gap-1 sm:gap-2">
        <div className="text-[14px] font-semibold leading-snug">{title}</div>
        {/* a long reason (revert bytes, an address) wraps instead of widening the page */}
        <p className="expl max-w-full text-[12px] leading-snug text-muted [overflow-wrap:anywhere]">{what}</p>
        <div className="min-h-[18px] max-w-full">{children}</div>
      </div>
    </li>
  );
}

/** The proof chain of an enclave (/proof: the inference enclave; /proof?signer=: another one, from the Hive).
 *  Each link lights up on ITS proof, read on Arc. Link 1 is the image pinned by the author's manifest (manifestVerified:
 *  the keccak256 of the manifest equals the on-chain manifestHash); failing that, the fingerprint of the image and of
 *  its composition replayed on Arc at registration (EnclaveImage), described as such; failing that, nothing is shown.
 *  Links 5 and 6 follow the product's rail: session, paid call (x402), bounty, or free. */
export function ProofChain({ p }: { p: Proof | null }) {
  const pinned = p?.manifestVerified === true;
  const digest = pinned ? p?.image?.split("@")[1] ?? null : null;
  const fp = !pinned ? p?.enclaveImage ?? null : null;
  const e = p?.enclave;
  const rail = p?.rail ?? "session";
  const p1 = (pinned && !!digest) || !!fp;
  const p2 = !!e?.workloadId;
  const p3 = !!p?.registerTx;
  const p4 = !!e?.active;
  const p5 = !!p?.settleTx;
  const p6 = !!p?.verdictTx;
  const lag = p?.index?.lagBlocks ?? 0;
  const l5 = rail === "free" ? t("ov.l5.free")
    : p?.settleUsdc ? t(rail === "x402" ? "ov.l5.x402" : rail === "bounty" ? "ov.l5.bounty" : "ov.l5.paid", { amt: usdc(p.settleUsdc) })
    : t(rail === "x402" ? "ov.l5.noneX402" : rail === "bounty" ? "ov.l5.noneBounty" : "ov.l5.none");
  return (
    <>
      <ol className="relative grid grid-cols-1 gap-y-5 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-8 xl:grid-cols-6">
        <Link_ n={1} title={t(fp ? "ov.l1.fp.title" : "ov.l1.title")} what={t(fp ? "ov.l1.fp.what" : p && !p1 ? "ov.l1.unverified" : "ov.l1.what")} proven={p1}>
          {fp
            ? <span className="flex flex-col items-start gap-0.5"><span className="font-mono text-[12px] text-text">{t("ov.l1.fp.ids", { img: short(fp.imageId, 4), compose: short(fp.composeHash, 4) })}</span><Hex value={fp.tx} kind="tx" n={4} /></span>
            : <Hex value={digest} kind="none" n={8} />}
        </Link_>
        <Link_ n={2} title={t("ov.l2.title")} what={t("ov.l2.what")} proven={p2}><Hex value={e?.workloadId} kind="none" /></Link_>
        <Link_ n={3} title={t(DCAP ? "ov.l3.title.dcap" : "ov.l3.title.dev")} what={t(DCAP ? "ov.l3.what.dcap" : "ov.l3.what.dev")} proven={p3}><Hex value={p?.registerTx} kind="tx" /></Link_>
        <Link_ n={4} title={t("ov.l4.title")} what={t(e?.active === false ? (e.status === "retired" ? "ov.l4.retired" : e.status === "invalidated" ? "ov.l4.invalidated" : "ov.l4.expired") : "ov.l4.what")} proven={p4}><Hex value={e?.signer} kind="address" /></Link_>
        <Link_ n={5} title={t("ov.l5.title")} what={l5} proven={p5}><Hex value={p?.settleTx} kind="tx" /></Link_>
        <Link_ n={6} last title={t("ov.l6.title")} what={verdictWhat(p)} proven={p6}><Hex value={p?.verdictTx ?? p?.verdictStatusTx} kind="tx" /></Link_>
      </ol>
      {lag > 600 && <p className="mt-4 text-[12px] text-warn">{t("ov.lag", { n: fmtNum(lag) })}</p>}
    </>
  );
}

/** Link 6 in words: the verdict written; otherwise (since v2.1) why the session shown has none: closed without payment
 *  (not applicable), write skipped (with the reason), closed without a verdict, or still open; or a rail that writes no
 *  verdict (paid call, free), or a bounty not paid yet. */
function verdictWhat(p: Proof | null): string {
  if (p?.verdictAgentId) return t("ov.l6.what", { agent: p.verdictAgentId, score: String(p.verdictResponse) });
  const id = p?.verdictSession ?? "?";
  if (p?.rail === "bounty" && !p.verdictStatus) return t("ov.l6.noneBounty");
  switch (p?.verdictStatus) {
    case "no_verdict_rail": return t("ov.l6.noVerdictRail");
    case "not_applicable": return t("ov.l6.na", { id });
    // the reason is put into words HERE, from the revert bytes (skipReason, in the site's language): never the API's
    // English sentence; an API without the bytes gives its decoded reason ("Name(args)") or nothing
    case "skipped": return t("ov.l6.skipped", { id, reason: skippedReason(p) });
    case "none": return t("ov.l6.noneClosed", { id });
    case "pending": return t("ov.l6.pending", { id });
  }
  return t("ov.l6.none");
}

/** Why a verdict was skipped, in the site's language: from its bytes (verdictReasonData); failing that, the API's two
 *  known sentences (empty revert, unreadable data) translated, or a named error as is. */
function skippedReason(p: Proof): string {
  if (typeof p.verdictReasonData === "string") return skipReason(p.verdictReasonData);
  const r = p.verdictReason ?? "";
  if (r === "empty revert (no reason given)") return skipReason("0x");
  if (!r || r === "unreadable revert data") return skipReason(null);
  return /^0x[0-9a-fA-F]*$/.test(r) ? skipReason(r) : r;
}

/** The label and detail of a contract event, in the site's language (a short hash is never split). */
const LABEL: Record<string, (a: Record<string, any>) => [string, ReactNode]> = {
  EnclaveRegistered: (a) => [t(DCAP ? "ev.EnclaveRegistered.dcap" : "ev.EnclaveRegistered.dev"), t("common.product", { id: a.productId })],
  SessionOpened: (a) => [t("ev.SessionOpened", { id: a.sessionId }), t("ev.d.deposit", { amt: usdc(a.deposit) })],
  SessionToppedUp: (a) => [t("ev.SessionToppedUp", { id: a.sessionId }), usdc(a.amount)],
  SessionKeyRotated: (a) => [t("ev.SessionKeyRotated", { id: a.sessionId }), ""],
  Settled: (a) => [t("ev.Settled", { id: a.sessionId }), usdc(a.paidDelta)],
  SessionClosed: (a) => [t("ev.SessionClosed", { id: a.sessionId }), t("ev.d.refunded", { amt: usdc(a.refund) })],
  EquivocationSlashed: () => [t("ev.EquivocationSlashed"), ""],
  BountyCreated: (a) => [t("ev.BountyCreated", { id: a.bountyId }), t("ev.d.pool", { amt: usdc(a.funding) })],
  BountyFunded: (a) => [t("ev.BountyFunded", { id: a.bountyId }), usdc(a.amount)],
  ExploitDelivered: (a) => [t("ev.ExploitDelivered", { id: a.bountyId }), ""],
  BountyPaid: (a) => [t("ev.BountyPaid", { id: a.bountyId }), usdc(a.amount)],
  RemainingWithdrawn: (a) => [t("ev.RemainingWithdrawn", { id: a.bountyId }), usdc(a.amount)],
  Recorded: (a) => [t("ev.Recorded"), t("ev.d.verdict", { agent: a.agentId, score: a.response })],
  CallSettled: (a) => [t("ev.CallSettled"), t("ev.d.call", { amt: usdc(a.amount), id: a.productId })],
  ProductUpdated: (a) => [t("ev.ProductUpdated", { id: a.productId }), t("ev.d.version", { v: a.version })],
  // events added by the v2 contracts
  EnclaveRetired: () => [t("ev.EnclaveRetired"), t("ev.d.reserveFreed")],
  EnclaveInvalidated: (a) => [t("ev.EnclaveInvalidated"), String(a.reason ?? "")],
  ProductProposed: (a) => [t("ev.ProductProposed", { id: a.productId }), ""],
  ProductActivated: (a) => [t("ev.ProductActivated", { id: a.productId }), ""],
  WorkloadAdded: (a) => [t("ev.WorkloadAdded", { id: a.productId }), ""],
  WorkloadRetired: (a) => [t("ev.WorkloadRetired", { id: a.productId }), ""],
  ClaimAccepted: (a) => [t("ev.ClaimAccepted", { id: a.bountyId }), t("ev.d.reserved")],
  ClaimRefuted: (a) => [t("ev.ClaimRefuted", { id: a.bountyId }), ""],
  BountyReopened: (a) => [t("ev.BountyReopened", { id: a.bountyId }), ""],
  BountyPauseSet: (a) => [t(String(a.paused) === "true" ? "ev.BountyPaused" : "ev.BountyResumed", { id: a.bountyId }), ""],
  UndeliveredCancelled: (a) => [t("ev.UndeliveredCancelled", { id: a.bountyId }), usdc(a.returned)],
  Credited: (a) => [t("ev.Credited"), usdc(a.amount)],
  ProductUpdateProposed: (a) => [t("ev.ProductUpdateProposed", { id: a.productId }), ""],
  WorkloadProposed: (a) => [t("ev.WorkloadProposed", { id: a.productId }), ""],
  // since v2.1
  EnclaveImage: (a) => [t("ev.EnclaveImage"), tx("ev.d.image", { id: String(a.productId), img: <span className="whitespace-nowrap">{short(String(a.imageId))}</span> })],
  VerdictNotApplicable: (a) => [t("ev.VerdictNotApplicable", { id: a.sessionId }), t("ev.d.noPayment")],
  VerdictSkipped: (a) => [t("ev.VerdictSkipped"), t("ev.d.reason", { reason: skipReason(a.reason) })],
  RequestHashSalted: () => [t("ev.RequestHashSalted"), ""],
  ManifestURIUpdateProposed: (a) => [t("ev.ManifestURIUpdateProposed", { id: a.productId }), t("ev.d.applyAt", { uri: String(a.manifestURI ?? ""), when: fmtUnix(BigInt(String(a.applyAt ?? "0"))) })],
  ManifestURIUpdated: (a) => [t("ev.ManifestURIUpdated", { id: a.productId }), String(a.manifestURI ?? "")],
  // the operators' bond and the two levels (the API's second index)
  Bonded: (a) => [t("ev.Bonded"), t("ev.d.amountOp", { amt: usdc(a.amount), op: short(String(a.operator)) })],
  UnbondRequested: (a) => [t("ev.UnbondRequested"), t("ev.d.amountOp", { amt: usdc(a.amount), op: short(String(a.operator)) })],
  Withdrawn: (a) => [t("ev.Withdrawn"), t("ev.d.amountOp", { amt: usdc(a.amount), op: short(String(a.operator)) })],
  Slashed: (a) => [t("ev.Slashed"), t("ev.d.amountOp", { amt: usdc(a.amount), op: short(String(a.operator)) })],
  MachineAttested: (a) => [t("ev.MachineAttested"), t("ev.d.machine", { ppid: short(String(a.ppid)) })],
  MachineRevoked: (a) => [t("ev.MachineRevoked"), t("ev.d.machine", { ppid: short(String(a.ppid)) })],
  ProofOfCloudToken: (a) => [t("ev.ProofOfCloudToken"), t("ev.d.machine", { ppid: short(String(a.ppid)) })],
  PolicyProposed: (a) => [t("ev.PolicyProposed", { id: a.productId }), ""],
  PolicyApplied: (a) => [t("ev.PolicyApplied", { id: a.productId }), ""],
  SettlementProposed: () => [t("ev.SettlementProposed"), ""],
  SettlementAuthorized: () => [t("ev.SettlementAuthorized"), ""],
  SettlementRemoved: () => [t("ev.SettlementRemoved"), ""],
  AgentIdSet: (a) => [t("ev.AgentIdSet"), t("ev.d.operator", { op: short(String(a.operator)) })],
};

function Kpis({ s }: { s: Stats | null }) {
  const items: Array<[string, ReactNode, string?]> = [
    [t("ov.kpi.enclaves"), s ? fmtNum(s.enclaves) : "—"],
    [t("ov.kpi.active"), s ? fmtNum(s.enclavesActive) : "—"],
    [t("ov.kpi.products"), s ? `${s.productsActive ?? s.products}` : "—"],
    [t("ov.kpi.sessions"), s ? fmtNum(s.sessions) : "—"],
    [t("ov.kpi.settled"), s ? usdc(s.settledUsdc) : "—"],
    // pay per call (X402Settler): settled calls, and their amount when the API gives it
    [t("ov.kpi.x402"), s ? fmtNum(s.x402Calls ?? 0) : "—", s?.x402SettledUsdc !== undefined ? usdc(s.x402SettledUsdc) : undefined],
    [t("ov.kpi.verdicts"), s ? fmtNum(s.verdicts) : "—"],
    [t("ov.kpi.bountiesPaid"), s ? fmtNum(s.bountiesPaid) : "—"],
  ];
  // a grid of 2 (phone) or 4 columns: a 1 px gap over the frame's background draws the separators, on 2 or 4 rows
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge sm:grid-cols-4">
      {items.map(([k, v, sub], i) => (
        <div key={i} className="bg-ink px-4 py-3">
          <dt className="text-[12px] leading-tight text-muted">{k}</dt>
          <dd className="mt-1 font-mono text-[16px] text-text">
            {v}
            {sub && <span className="text-[12px] text-muted"> ({sub})</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Action({ icon: Icon, title, text, onClick }: { icon: any; title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex w-full items-center gap-3 border-b border-edge px-1 py-3.5 text-left last:border-0">
      <Icon size={18} className="shrink-0 text-accent" />
      <span className="flex-1">
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="block text-[13px] text-muted">{text}</span>
      </span>
      <ChevronRight size={16} className="text-muted transition group-hover:translate-x-0.5 group-hover:text-text" />
    </button>
  );
}

export default function Overview({ go }: { go: (r: string) => void }) {
  const [s, setS] = useState<Stats | null>(null);
  const [p, setP] = useState<Proof | null>(null);
  // null: loading; []: read, and EMPTY (a fresh deployment has emitted nothing yet), never confused
  const [act, setAct] = useState<ActivityEvent[] | null>(null);
  // errors are kept as is and put into words at display time (they follow the site's language)
  const [err, setErr] = useState<unknown>(null);
  const [actErr, setActErr] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    fetchProof().then((x) => { if (alive) setP(x); }).catch((e) => { if (alive) setErr(e ?? new Error("?")); });
    fetchStats().then((x) => { if (alive) setS(x); }).catch(() => {});
    fetchActivity(12)
      .then((x) => { if (alive) setAct(Array.isArray(x) ? x : []); })
      .catch((e) => { if (alive) setActErr(e ?? new Error("?")); });
    return () => { alive = false; };
  }, []);

  return (
    <>
      <PageHeader title={t(DCAP ? "ov.title.dcap" : "ov.title.dev")} lead={t("ov.lead")} />
      <Section>
        {err !== null ? <p className="text-[13px] text-bad">{t("ov.readError", { err: explainError(err) })}</p> : <ProofChain p={p} />}
      </Section>
      <Section title={t("ov.numbers.title")} lead={t("ov.numbers.lead")}>
        <Kpis s={s} />
      </Section>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Section title={t("ov.do.title")}>
          <div>
            <Action icon={MessageSquareLock} title={t("ov.do.ai.title")} text={t("ov.do.ai.text")} onClick={() => go("playground")} />
            <Action icon={Crosshair} title={t("ov.do.bounty.title")} text={t("ov.do.bounty.text")} onClick={() => go("primes")} />
            <Action icon={Server} title={t("ov.do.rent.title")} text={t("ov.do.rent.text")} onClick={() => go("operateur")} />
            <Action icon={PackagePlus} title={t("ov.do.publish.title")} text={t("ov.do.publish.text")} onClick={() => go("publier-produit")} />
          </div>
        </Section>
        <Section title={t("ov.activity.title")} lead={t("ov.activity.lead")}>
          <ul className="divide-y divide-edge rounded-xl border border-edge">
            {act === null && actErr === null && <li className="px-4 py-6 text-[13px] text-muted">{t("ov.activity.loading")}</li>}
            {act === null && actErr !== null && (
              <li className="px-4 py-6 text-[13px] text-bad [overflow-wrap:anywhere]">{t("ov.activity.error", { err: explainError(actErr) })}</li>
            )}
            {act !== null && act.length === 0 && <li className="px-4 py-6 text-[13px] text-muted">{t("ov.activity.empty")}</li>}
            {(act ?? []).map((e, i) => {
              const known = Object.prototype.hasOwnProperty.call(LABEL, e.name);
              const [label, base]: [string, ReactNode] = known ? LABEL[e.name]!(e.args) : [e.name, ""];
              // an event of the previous stack (v2.1, kept readable by the API) says so; its numbers are v2.1's
              const prev = !!e.stack && e.stack !== STACK_NAME;
              // a verified-level bounty has its own numbers (product 5's contract; product 7's on v2.1): the detail says so
              const lvl = e.contract === "SealedBountyVerified" ? (prev ? t("ev.d.verifiedLevelPrev", { stack: e.stack ?? "" }) : t("ev.d.verifiedLevel")) : "";
              const detail: ReactNode = lvl ? (base ? <>{base}, {lvl}</> : lvl) : base;
              const block = fmtNum(e.block);
              return (
                <li key={`${e.tx}-${i}`} className="flex flex-col items-start gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  {/* the title wraps rather than being cut; the short hash stays on one line (under the title on a phone, so
                      its 44 px buttons do not squeeze the text) */}
                  <div className="min-w-0">
                    <div className="break-words text-[13px] leading-snug">{prev && <Badge tone="muted">{e.stack}</Badge>} {label}</div>
                    {/* a long detail (a manifest's address) wraps instead of running under the hash */}
                    <div className="text-[12px] text-muted [overflow-wrap:anywhere]">{detail ? tx("ov.activity.detailBlock", { detail, n: block }) : t("common.block", { n: block })}</div>
                  </div>
                  <Hex value={e.tx} kind="tx" n={4} />
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </>
  );
}
