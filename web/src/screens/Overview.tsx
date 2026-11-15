import { useEffect, useState, type ReactNode } from "react";
import { MessageSquareLock, Crosshair, Server, PackagePlus, ChevronRight } from "lucide-react";
import { testnet } from "@arcvault/sdk";
import { fetchStats, fetchActivity, fetchProof, type Stats, type ActivityEvent, type Proof } from "../api";
import { PageHeader, Section, Hex, usdc, short } from "../ui";
import { skipReason } from "../arc";
import { explainError } from "../errors";
import { fmtNum, fmtUnix, t, tx } from "../i18n";

const DCAP = testnet.attestation === "dcap";

/** Un maillon de la chaîne de preuves : une alvéole qui s'allume quand le fait est prouvé on-chain. */
function Link_({ n, title, what, proven, last, children }: { n: number; title: string; what: string; proven: boolean; last?: boolean; children: ReactNode }) {
  return (
    <li className="relative flex flex-col items-start gap-2">
      {/* trait vers le maillon suivant (sur une ligne, en très grand écran : à 1024 px, trois maillons par ligne) */}
      {!last && <span aria-hidden className={`absolute left-11 top-[21px] hidden h-px w-[calc(100%-44px+24px)] xl:block ${proven ? "bg-good/60" : "bg-edge"}`} />}
      <span className={`hex relative z-10 grid h-11 w-11 place-items-center font-mono text-[13px] font-medium ${proven ? "bg-good text-ink" : "bg-edge text-muted"}`}>{n}</span>
      <div className="text-[14px] font-semibold leading-snug">{title}</div>
      {/* une raison longue (octets d'un revert, adresse) passe à la ligne au lieu d'élargir la page */}
      <p className="max-w-full text-[12px] leading-snug text-muted [overflow-wrap:anywhere]">{what}</p>
      <div className="min-h-[18px]">{children}</div>
    </li>
  );
}

function ProofChain({ p }: { p: Proof | null }) {
  // maillon 1 : l'image n'est « épinglée » que si l'API a vérifié le manifeste de l'auteur contre son empreinte on-chain
  // (manifestVerified === true) ; sinon elle renvoie une image par défaut, qui ne prouve rien et n'est pas montrée
  const pinned = p?.manifestVerified === true;
  const digest = pinned ? p?.image?.split("@")[1] ?? null : null;
  const e = p?.enclave;
  // une chaîne : un maillon ne s'allume que si le précédent est prouvé (jamais « 4 sans 3 »)
  const p1 = pinned && !!digest;
  const p2 = p1 && !!e;
  const p3 = p2 && !!p?.registerTx;
  const p4 = p3 && !!e?.active;
  const p5 = p4 && !!p?.settleTx;
  const p6 = p5 && !!p?.verdictTx;
  const lag = p?.index?.lagBlocks ?? 0;
  return (
    <>
      <ol className="relative grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 xl:grid-cols-6">
        <Link_ n={1} title={t("ov.l1.title")} what={t(p && !p1 ? "ov.l1.unverified" : "ov.l1.what")} proven={p1}><Hex value={digest} kind="none" n={8} /></Link_>
        <Link_ n={2} title={t("ov.l2.title")} what={t("ov.l2.what")} proven={p2}><Hex value={e?.workloadId} kind="none" /></Link_>
        <Link_ n={3} title={t(DCAP ? "ov.l3.title.dcap" : "ov.l3.title.dev")} what={t(DCAP ? "ov.l3.what.dcap" : "ov.l3.what.dev")} proven={p3}><Hex value={p?.registerTx} kind="tx" /></Link_>
        <Link_ n={4} title={t("ov.l4.title")} what={t(e?.active === false ? "ov.l4.expired" : "ov.l4.what")} proven={p4}><Hex value={e?.signer} kind="address" /></Link_>
        <Link_ n={5} title={t("ov.l5.title")} what={p?.settleUsdc ? t("ov.l5.paid", { amt: usdc(p.settleUsdc) }) : t("ov.l5.none")} proven={p5}><Hex value={p?.settleTx} kind="tx" /></Link_>
        <Link_ n={6} last title={t("ov.l6.title")} what={verdictWhat(p)} proven={p6}><Hex value={p?.verdictTx ?? p?.verdictStatusTx} kind="tx" /></Link_>
      </ol>
      {lag > 600 && <p className="mt-4 text-[12px] text-warn">{t("ov.lag", { n: fmtNum(lag) })}</p>}
    </>
  );
}

/** Le maillon 6 en mots : le verdict écrit ; sinon (API du 9/11, pile v2.1) pourquoi la session montrée n'en a pas —
 *  close sans paiement (sans objet), écriture sautée (avec la raison), fermée sans verdict, ou encore ouverte. */
function verdictWhat(p: Proof | null): string {
  if (p?.verdictAgentId) return t("ov.l6.what", { agent: p.verdictAgentId, score: String(p.verdictResponse) });
  const id = p?.verdictSession ?? "?";
  switch (p?.verdictStatus) {
    case "not_applicable": return t("ov.l6.na", { id });
    // la raison est remise en mots ICI, depuis les octets du revert (skipReason, dans la langue du site) : jamais la
    // phrase anglaise de l'API ; une API sans les octets donne sa raison décodée (« Nom(args) ») ou rien
    case "skipped": return t("ov.l6.skipped", { id, reason: skippedReason(p) });
    case "none": return t("ov.l6.noneClosed", { id });
    case "pending": return t("ov.l6.pending", { id });
  }
  return t("ov.l6.none");
}

/** La raison d'un verdict sauté, dans la langue du site : d'après ses octets (verdictReasonData, API du 9/11) ; à défaut,
 *  les deux phrases connues de l'API (revert vide, données illisibles) traduites, ou une erreur nommée telle quelle. */
function skippedReason(p: Proof): string {
  if (typeof p.verdictReasonData === "string") return skipReason(p.verdictReasonData);
  const r = p.verdictReason ?? "";
  if (r === "empty revert (no reason given)") return skipReason("0x");
  if (!r || r === "unreadable revert data") return skipReason(null);
  return /^0x[0-9a-fA-F]*$/.test(r) ? skipReason(r) : r;
}

/** Le libellé et le détail d'un événement des contrats, dans la langue du site (un hash court ne se coupe pas). */
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
  // pile v2
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
  // pile v2.1
  EnclaveImage: (a) => [t("ev.EnclaveImage"), tx("ev.d.image", { id: String(a.productId), img: <span className="whitespace-nowrap">{short(String(a.imageId))}</span> })],
  VerdictNotApplicable: (a) => [t("ev.VerdictNotApplicable", { id: a.sessionId }), t("ev.d.noPayment")],
  VerdictSkipped: (a) => [t("ev.VerdictSkipped"), t("ev.d.reason", { reason: skipReason(a.reason) })],
  RequestHashSalted: () => [t("ev.RequestHashSalted"), ""],
  ManifestURIUpdateProposed: (a) => [t("ev.ManifestURIUpdateProposed", { id: a.productId }), t("ev.d.applyAt", { uri: String(a.manifestURI ?? ""), when: fmtUnix(BigInt(String(a.applyAt ?? "0"))) })],
  ManifestURIUpdated: (a) => [t("ev.ManifestURIUpdated", { id: a.productId }), String(a.manifestURI ?? "")],
};

function Kpis({ s }: { s: Stats | null }) {
  const items: Array<[string, ReactNode, string?]> = [
    [t("ov.kpi.enclaves"), s ? fmtNum(s.enclaves) : "—"],
    [t("ov.kpi.active"), s ? fmtNum(s.enclavesActive) : "—"],
    [t("ov.kpi.products"), s ? `${s.productsActive ?? s.products}` : "—"],
    [t("ov.kpi.sessions"), s ? fmtNum(s.sessions) : "—"],
    [t("ov.kpi.settled"), s ? usdc(s.settledUsdc) : "—"],
    // paiement à l'appel (X402Settler) : appels réglés, et leur montant quand l'API le donne (9/11)
    [t("ov.kpi.x402"), s ? fmtNum(s.x402Calls ?? 0) : "—", s?.x402SettledUsdc !== undefined ? usdc(s.x402SettledUsdc) : undefined],
    [t("ov.kpi.verdicts"), s ? fmtNum(s.verdicts) : "—"],
    [t("ov.kpi.bountiesPaid"), s ? fmtNum(s.bountiesPaid) : "—"],
  ];
  // une grille de 2 (téléphone) ou 4 colonnes : 1 px d'écart sur le fond du cadre trace les séparations, sur 2 ou 4 lignes
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
  // null : lecture en cours ; [] : lue, et VIDE (un déploiement neuf n'a encore rien émis) — jamais confondus
  const [act, setAct] = useState<ActivityEvent[] | null>(null);
  // les erreurs sont gardées telles quelles et mises en mots à l'affichage (elles suivent la langue du site)
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
              const [label, detail]: [string, ReactNode] = known ? LABEL[e.name]!(e.args) : [e.name, ""];
              const block = fmtNum(e.block);
              return (
                <li key={`${e.tx}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  {/* le titre passe à la ligne plutôt que d'être coupé ; le hash court reste sur une ligne */}
                  <div className="min-w-0">
                    <div className="break-words text-[13px] leading-snug">{label}</div>
                    {/* un long détail (adresse d'un manifeste) passe à la ligne au lieu de passer sous le hash */}
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
