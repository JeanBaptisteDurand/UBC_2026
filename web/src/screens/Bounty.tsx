import { useEffect, useMemo, useState } from "react";
import { type Address, type Hex, encodeFunctionData, parseAbi, parseEventLogs, toHex, zeroAddress } from "viem";
import {
  testnet, predicateHash, encodeExploitTx, generateX25519, sealedBountyAbi,
  type Predicate, type ProvenClaim,
} from "@arcvault/sdk";
import { useArc } from "../useArc";
import { useAccount } from "wagmi";
import { fetchBounties, bountyKey, type Bounty as BountyItem } from "../api";
import { BOUNTY_PRODUCT, VERIFIED_BOUNTY, arcForLevel, bountyLevelOf, parseUsdc, trackTxs, waitOk, type BountyLevel } from "../arc";
import { Card, Btn, Field, Mono, Status, Steps, Table, Td, Badge, Empty, Hex as HexVal, usdc, type StepState } from "../ui";
import { O3_URL, O3V_URL } from "../config";
import { MsgError, errorMsg, fail, failWith, msg, renderShown, type Msg, type Shown } from "../msg";
import { fmtNum, fmtUnix, t, tx } from "../i18n";

export const DEMO_PREDICATE: Predicate = {
  combine: "OR",
  clauses: [{ type: "ERC20_DROP", token: testnet.usdc, holder: testnet.demoVault, min: "1000000" }],
};
/** Le hash épinglé on-chain par les primes de démonstration : l'exploit de démo ne se prouve que contre celles-là. */
export const DEMO_PREDICATE_HASH = predicateHash(DEMO_PREDICATE);
/** Palier de démonstration : une perte d'au moins 1 USDC paie 1 USDC (plus les frais réseau et opérateurs). */
const TIER_MIN_LOSS = 1_000_000n;
const TIER_AMOUNT = 1_000_000n;
const DEMO_VAULT_ABI = parseAbi(["function migrate(address to)"]);

/** L'exploit de démonstration : la faille volontaire du coffre DemoVault (migrate sans contrôle d'accès), qui vide
 *  le coffre vers le chasseur. L'enclave le REJOUE pour de vrai sur un fork d'Arc ; rien ne bouge sur la chaîne. */
export function demoExploitTxs(payee: Address): Hex[] {
  return [encodeExploitTx({ to: testnet.demoVault, data: encodeFunctionData({ abi: DEMO_VAULT_ABI, functionName: "migrate", args: [payee] }) })];
}

const now = () => BigInt(Math.floor(Date.now() / 1000));

export default function Bounty() {
  return (
    <div className="space-y-6">
      <Card title={t("bounty.card.title")} sub={t("bounty.card.sub")}>
        <Mono>{t("bounty.card.predicate")}</Mono>
      </Card>
      <ProtocolPanel />
      <HunterPanel />
    </div>
  );
}

/** Fichier de clé lisible par la CLI (arcvault bounty reports <id> --key <fichier>). */
function downloadProtocolKey(bountyId: bigint, publicKey: Hex, privateKey: Hex) {
  const body = {
    kind: "arcvault-protocol-x25519", publicKey, privateKey, createdAt: new Date().toISOString(),
    note: t("bounty.keyNote", { id: bountyId }),
  };
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = t("bounty.keyFile", { id: bountyId });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProtocolPanel({ onCreated }: { onCreated?: () => void } = {}) {
  const base = useArc();
  const [productId, setProductId] = useState(BOUNTY_PRODUCT.toString());
  const [funding, setFunding] = useState("2");
  const [hours, setHours] = useState("24");
  const [out, setOut] = useState<Msg | null>(null);
  const [key, setKey] = useState<{ bountyId: bigint; publicKey: Hex; privateKey: Hex } | null>(null);

  async function create() {
    if (!base) return;
    setKey(null);
    try {
      if (!/^\d+$/.test(productId.trim())) throw new MsgError(msg("bounty.badProduct", { v: productId }));
      const pid = BigInt(productId.trim());
      const fund = parseUsdc(funding, "what.funding");
      const h = Number(hours.trim().replace(",", "."));
      if (!Number.isFinite(h) || h <= 0) throw new MsgError(msg("bounty.badHours", { v: hours }));
      setOut(msg("bounty.checking"));
      const p = await base.getProduct(pid);
      if (p.state !== "Active") throw new MsgError(msg("bounty.notActive", { id: pid, state: p.state }));
      // 19/11 : une prime se poste au niveau de son produit (produit 2 : SealedBounty ; produit 7 : SealedBountyVerified)
      const level = bountyLevelOf(p.settlement);
      if (!p.deterministic || !level) throw new MsgError(msg("bounty.notSealed", { id: pid }));
      const arc = arcForLevel(base, level);
      const [net, op] = await Promise.all([
        arc.pub.readContract({ address: arc.d.sealedBounty, abi: sealedBountyAbi, functionName: "networkBountyBps" }),
        arc.pub.readContract({ address: arc.d.sealedBounty, abi: sealedBountyAbi, functionName: "operatorBountyBps" }),
      ]) as [number, number];
      const total = TIER_AMOUNT + (TIER_AMOUNT * BigInt(Number(net) + Number(op))) / 10_000n;
      if (fund < total) {
        const fees = (Number(net) + Number(op)) / 100;
        throw new MsgError(msg("bounty.tooLow", { tier: () => usdc(TIER_AMOUNT), fees: () => fmtNum(fees), total: () => usdc(total) }));
      }
      // la clé X25519 du protocole naît ici : elle seule déchiffrera les rapports d'exploit livrés pour cette prime
      const k = generateX25519();
      setOut(msg("bounty.creating"));
      const r = await arc.createBounty({
        productId: pid, predicateHash: DEMO_PREDICATE_HASH, protocolX25519: k.publicKey,
        tierMinLoss: [TIER_MIN_LOSS], tierAmount: [TIER_AMOUNT], singleCap: TIER_AMOUNT, k: 1,
        targetToPause: testnet.demoVault, deadline: now() + BigInt(Math.round(h * 3600)), funding: fund,
      });
      setKey({ bountyId: r.bountyId, publicKey: k.publicKey, privateKey: toHex(k.privateKey) });
      setOut(msg("bounty.sent", { id: r.bountyId }));
      const rcpt = await waitOk(arc, r.tx, "tx.createBounty");
      const ev = parseEventLogs({ abi: sealedBountyAbi, logs: rcpt.logs, eventName: "BountyCreated" })[0];
      const id = ev ? ev.args.bountyId : r.bountyId;
      if (id !== r.bountyId) setKey({ bountyId: id, publicKey: k.publicKey, privateKey: toHex(k.privateKey) });
      setOut(msg("bounty.created", { id, amt: () => usdc(fund), tx: r.tx }));
      onCreated?.();
    } catch (e: any) {
      if (e?.name === "TxRevertedError") setKey(null); // aucune prime créée : la clé ne servirait à rien
      setOut(fail(e));
    }
  }
  return (
    <Card title={t("bounty.create.title")} sub={t("bounty.create.sub", { id: BOUNTY_PRODUCT })}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("bounty.f.product")} value={productId} onChange={setProductId} />
        <Field label={t("bounty.f.funding")} value={funding} onChange={setFunding} hint={t("bounty.f.fundingHint")} />
        <Field label={t("bounty.f.hours")} value={hours} onChange={setHours} hint={t("bounty.f.hoursHint")} />
      </div>
      <div className="mt-3 flex items-center gap-3"><Btn onClick={create} disabled={!base?.wallet}>{t("bounty.create")}</Btn></div>
      <Status msg={out} />
      {key && (
        <div className="mt-4 rounded-lg border border-good/40 bg-good/5 p-4">
          <div className="text-[13px] font-medium text-good">{t("bounty.key.title", { id: key.bountyId.toString() })}</div>
          <p className="mt-1 text-[12px] text-muted">
            {tx("bounty.key.text", {
              cmd: <span className="font-mono text-text">arcvault bounty reports {key.bountyId.toString()} --key {t("bounty.keyFile", { id: key.bountyId })}</span>,
            })}
          </p>
          <div className="mt-3 flex gap-2">
            <Btn onClick={() => downloadProtocolKey(key.bountyId, key.publicKey, key.privateKey)}>{t("bounty.key.download")}</Btn>
            <Btn kind="ghost" onClick={() => setKey(null)}>{t("common.savedKey")}</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Les primes publiées par l'adresse connectée : après l'échéance, le protocole retire ce qui reste du pool. */
export function MyBounties({ refreshKey = 0 }: { refreshKey?: number }) {
  const arc = useArc();
  const { address } = useAccount();
  const [rows, setRows] = useState<BountyItem[] | null>(null);
  const [note, setNote] = useState<Msg | null>(null);
  useEffect(() => {
    if (!address) return;
    fetchBounties().then((b) => setRows(b.filter((x) => x.protocol.toLowerCase() === address.toLowerCase()))).catch(() => setRows([]));
  }, [address, refreshKey]);
  if (!address) return null;
  async function withdraw(b: BountyItem) {
    if (!arc) return;
    // 19/11 : le retrait se fait sur le contrat du niveau de la prime
    const a = arcForLevel(arc, b.level);
    setNote(msg("bounty.withdrawing", { id: b.id }));
    try {
      const hash = await a.withdrawRemaining(b.id);
      setNote(msg("common.withdrawSent"));
      await waitOk(a, hash, "tx.withdraw");
      setRows((rs) => rs?.map((x) => (bountyKey(x) === bountyKey(b) ? { ...x, balance: 0n } : x)) ?? null);
      setNote(msg("bounty.withdrawnFrom", { amt: () => usdc(b.balance), id: b.id, tx: hash }));
    } catch (e) { setNote(fail(e)); }
  }
  const tNow = now();
  return (
    <>
      <Table head={[t("bounties.h.bounty"), t("bounties.h.pool"), t("bounty.mine.paid"), t("bounties.h.deadline"), t("bounties.h.status"), ""]}
        empty={rows && rows.length === 0 ? <Empty>{t("bounty.mine.empty")}</Empty> : undefined}>
        {!rows && <tr><Td className="text-muted">{t("bounty.mine.loading")}</Td></tr>}
        {rows?.map((b) => {
          const expired = b.deadline < tNow;
          return (
            <tr key={bountyKey(b)} className="hover:bg-panel/60">
              <Td main wrap><span className="whitespace-nowrap font-medium">{t("common.Bounty", { id: b.id.toString() })}</span> <span className="whitespace-nowrap text-[12px] text-muted">{t("common.product", { id: b.productId.toString() })}</span> <BountyLevelBadge level={b.level} /></Td>
              <Td label={t("bounties.h.pool")} className="font-mono">{usdc(b.balance)}</Td>
              {/* ce qui a VRAIMENT été versé (BountyPaid) ; une réclamation réfutée n'a rien payé */}
              <Td label={t("bounty.mine.paid")} className="font-mono">{b.paidOut && b.paidOut > 0n ? usdc(b.paidOut) : b.claimsRefuted > 0 ? t("bounties.refutedShort") : "—"}</Td>
              <Td label={t("bounties.h.deadline")} className="text-muted">{fmtUnix(b.deadline)}</Td>
              <Td label={t("bounties.h.status")}>{expired ? <Badge tone="muted">{t("common.expired")}</Badge> : b.paused ? <Badge tone="warn">{t("common.paused")}</Badge> : <Badge tone="good">{t("common.open")}</Badge>}</Td>
              <Td actions>{expired && b.balance > 0n
                ? <Btn kind="ghost" onClick={() => withdraw(b)} disabled={!arc?.wallet}>{t("bounty.mine.withdraw")}</Btn>
                : <span className="text-[12px] text-muted">{expired ? t("bounty.mine.empty_pool") : t("bounty.mine.afterDeadline")}</span>}</Td>
            </tr>
          );
        })}
      </Table>
      <Status msg={note} />
    </>
  );
}

/** Un paiement de prime dont le transfert avait été refusé reste en crédit dans le contrat de la prime : on le retire ici.
 *  19/11 : sur les deux contrats (SealedBounty et SealedBountyVerified). */
export function CreditNotice() {
  const arc = useArc();
  const { address } = useAccount();
  const [credits, setCredits] = useState<Record<BountyLevel, bigint>>({ open: 0n, verified: 0n });
  const [note, setNote] = useState<Msg | null>(null);
  const pub = arc?.pub;
  useEffect(() => {
    if (!pub || !address) { setCredits({ open: 0n, verified: 0n }); return; }
    const read = (a: string) => pub.readContract({ address: a as Address, abi: sealedBountyAbi, functionName: "credit", args: [address] }).then((c) => c as bigint).catch(() => 0n);
    Promise.all([read(testnet.sealedBounty), VERIFIED_BOUNTY ? read(VERIFIED_BOUNTY) : Promise.resolve(0n)])
      .then(([open, verified]) => setCredits({ open, verified })).catch(() => { /* lecture facultative */ });
  }, [pub, address]);
  const credit = credits.open + credits.verified;
  if (credit === 0n && !note) return null;
  async function withdraw() {
    if (!arc) return;
    setNote(msg("bounty.credit.withdrawing"));
    try {
      for (const level of ["open", "verified"] as const) {
        const amount = credits[level];
        if (amount === 0n) continue;
        const a = arcForLevel(arc, level);
        const hash = await a.withdrawCredit();
        setNote(msg("common.withdrawSent"));
        await waitOk(a, hash, "tx.withdrawCredit");
        setNote(msg("common.withdrawn", { amt: () => usdc(amount), tx: hash }));
        setCredits((c) => ({ ...c, [level]: 0n }));
      }
    } catch (e) { setNote(fail(e)); }
  }
  return (
    <div className="mb-6 rounded-xl border border-warn/40 bg-warn/5 px-4 py-3 text-[13px]">
      {credit > 0n && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span><span className="font-medium text-warn">{t("bounty.credit.amount", { amt: usdc(credit) })}</span> <span className="text-muted">{t("bounty.credit.text")}</span></span>
          <Btn onClick={withdraw} disabled={!arc?.wallet}>{t("bounty.credit.withdraw")}</Btn>
        </div>
      )}
      <Status msg={note} />
    </div>
  );
}

/** Les quatre étapes de la chasse ; leurs libellés ET leurs détails sont mis en mots à l'affichage (ils suivent la
 *  langue du site) : un détail est un message, ou une fonction qui rend une phrase avec ses liens. */
const STEP_KEYS = ["hunt.step.key", "hunt.step.replay", "hunt.step.accepted", "hunt.step.paid"] as const;
type StepRow = { state: StepState; detail?: Shown };
const freshSteps = (): StepRow[] => STEP_KEYS.map(() => ({ state: "todo" as StepState }));

/** 19/11 : le badge du niveau d'une prime (ouvert : SealedBounty ; vérifié : SealedBountyVerified, produit 7) */
export function BountyLevelBadge({ level }: { level: BountyLevel }) {
  return level === "verified" ? <Badge tone="good">{t("bounties.level.verified")}</Badge> : <Badge tone="muted">{t("bounties.level.open")}</Badge>;
}

export function HunterPanel({ initialBountyId = "1", level = "open" }: { initialBountyId?: string; level?: BountyLevel } = {}) {
  // 19/11 : la chasse se fait sur le contrat du niveau de la prime (même code, autre adresse) et avec son enclave
  const base = useArc();
  const arc = useMemo(() => (base ? arcForLevel(base, level) : null), [base, level]);
  const { address } = useAccount();
  const [bountyId, setBountyId] = useState(initialBountyId);
  useEffect(() => { setBountyId(initialBountyId); }, [initialBountyId]);
  const [o3Url, setO3Url] = useState(level === "verified" ? O3V_URL : O3_URL);
  useEffect(() => { setO3Url(level === "verified" ? O3V_URL : O3_URL); }, [level]);
  const [steps, setSteps] = useState<StepRow[]>(freshSteps);
  const [out, setOut] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const [proven, setProven] = useState<ProvenClaim | null>(null); // réclamation prouvée : de quoi relancer le paiement
  const [accepted, setAccepted] = useState(false); // acceptClaim confirmé : il ne reste qu'à livrer (deliver)
  const setStep = (i: number, state: StepState, detail?: Shown) =>
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, state, detail } : x)));

  /** Lecture de la prime sur Arc : est-elle chassable par l'exploit de démonstration ? (rien n'est envoyé) */
  async function precheck(id: bigint) {
    const b = await arc!.getBounty(id);
    if (b.protocol === zeroAddress) throw new MsgError(msg("hunt.noBounty", { id }));
    if (b.deadline < now()) throw new MsgError(msg("hunt.expired", { id, when: () => fmtUnix(b.deadline) }));
    if (b.paused) throw new MsgError(msg("hunt.paused", { id, n: () => fmtNum(b.pausedFromBlock) }));
    if (b.predicateHash.toLowerCase() !== DEMO_PREDICATE_HASH.toLowerCase()) {
      throw new MsgError(msg("hunt.otherRule", { id }));
    }
    const tiers = await arc!.bountyTiers(id);
    if (!tiers.some((x) => x.amount > b.paidAmount)) {
      throw new MsgError(msg("hunt.allPaid", { id, amt: () => usdc(b.paidAmount) }));
    }
  }

  /** acceptClaim (réserve le paiement, cP hors transaction) puis deliver (livre cP au protocole et paie), par le SDK. */
  async function pay(p: ProvenClaim) {
    if (!arc) return;
    let delivering = false;
    const tracked = trackTxs(arc, (e) => {
      const hash = e.hash;
      if (e.fn === "acceptClaim") {
        setStep(2, "doing", e.phase === "sign" ? msg("hunt.signAccept")
          : () => tx("hunt.acceptSent", { tx: <HexVal value={hash} kind="tx" n={4} /> }));
      } else if (e.fn === "deliver") {
        if (!delivering) { delivering = true; setAccepted(true); setStep(2, "done", msg("hunt.reservedOnly")); }
        setStep(3, "doing", e.phase === "sign" ? msg("hunt.signDeliver")
          : () => tx("hunt.deliverSent", { tx: <HexVal value={hash} kind="tx" n={4} /> }));
      }
    });
    try {
      const { acceptTx, deliverTx } = await tracked.acceptAndDeliver(p.claim, [p.signature], p.cP);
      setStep(2, "done", () => tx("hunt.reserved", { tx: <HexVal value={acceptTx} kind="tx" n={4} /> }));
      await delivered(deliverTx);
    } catch (e) {
      setStep(delivering ? 3 : 2, "fail", errorMsg(e));
    }
  }

  async function delivered(hash: Hex) {
    const rcpt = await waitOk(arc!, hash, "tx.deliver");
    const paid = parseEventLogs({ abi: sealedBountyAbi, logs: rcpt.logs, eventName: "BountyPaid" })[0];
    const amount = paid?.args.amount;
    setStep(3, "done", () => tx("hunt.delivered", {
      paid: amount !== undefined ? t("hunt.paidTo", { amt: usdc(amount) }) : t("hunt.paid"),
      tx: <HexVal value={hash} kind="tx" n={4} />,
    }));
  }

  /** acceptClaim confirmé mais deliver pas fait : livrer avant 24 h, sinon la réservation retourne au pool. */
  async function deliverOnly() {
    if (!arc || !proven) return;
    setBusy(true);
    try {
      setStep(3, "doing", msg("hunt.signDeliver"));
      const hash = await arc.deliver(proven.claim.bountyId, proven.claim.fingerprint, proven.cP);
      setStep(3, "doing", () => tx("hunt.deliverSent", { tx: <HexVal value={hash} kind="tx" n={4} /> }));
      await delivered(hash);
    } catch (e) { setStep(3, "fail", errorMsg(e)); } finally { setBusy(false); }
  }

  async function retryPay() {
    if (!proven) return;
    setBusy(true);
    try { await pay(proven); } finally { setBusy(false); }
  }

  async function hunt() {
    if (!arc || !address || busy) return;
    setSteps(freshSteps()); setProven(null); setAccepted(false);
    const raw = bountyId.trim();
    if (!/^\d+$/.test(raw)) { setOut(failWith(msg("hunt.badId", { v: bountyId }))); return; }
    const id = BigInt(raw);
    setBusy(true);
    try {
      setOut(msg("hunt.reading", { id }));
      await precheck(id);
      setOut(null);
    } catch (e) { setOut(fail(e)); setBusy(false); return; }

    let step = 0;
    try {
      // 1. clés de l'enclave confrontées à la chaîne, puis chiffrement : cP vers le protocole (clé lue on-chain),
      //    cE vers l'enclave VÉRIFIÉE. Jamais vers une clé lue telle quelle sur /pubkeys.
      setStep(0, "doing", msg("hunt.checkingKeys"));
      const payee = address as Address;
      const sealed = await arc.prepareExploit({
        bountyId: id, enclaveUrl: o3Url.trim(), payee, exploit: { predicate: DEMO_PREDICATE, txs: demoExploitTxs(payee), capital: 0n },
      });
      setStep(0, "done", () => tx("hunt.encrypted", {
        enclave: <HexVal value={sealed.enclave.signer} n={4} />, operator: <HexVal value={sealed.enclave.operator} n={4} />,
      }));

      // 2. rejeu dans l'enclave ; la réclamation signée est contrôlée avant tout envoi on-chain
      step = 1;
      setStep(1, "doing", msg("hunt.replaying"));
      const p = await arc.proveExploit(sealed);
      setProven(p);
      setStep(1, "done", msg("hunt.proven", { loss: () => usdc(p.claim.loss), tier: p.claim.tier, n: () => fmtNum(p.claim.blockN) }));

      // 3 et 4. paiement v2 en deux temps
      step = 2;
      await pay(p);
    } catch (e) {
      setStep(step, "fail", errorMsg(e));
    } finally { setBusy(false); }
  }

  const acceptFailed = !!proven && !accepted && steps[2]?.state === "fail";
  const deliverFailed = accepted && steps[3]?.state === "fail";
  const started = steps.some((s) => s.state !== "todo");

  return (
    <Card title={t("hunt.title")} sub={t("hunt.sub")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("hunt.f.bounty")} value={bountyId} onChange={setBountyId} />
        <Field label={t("hunt.f.url")} value={o3Url} onChange={setO3Url} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Btn onClick={hunt} disabled={!arc?.wallet || !address || busy}>{t("hunt.go")}</Btn>
        {acceptFailed && <Btn kind="ghost" onClick={retryPay} disabled={busy}>{t("hunt.retryPay")}</Btn>}
        {deliverFailed && <Btn kind="ghost" onClick={deliverOnly} disabled={busy}>{t("hunt.deliverOnly")}</Btn>}
      </div>
      <Status msg={out} />
      {started && <Steps steps={steps.map((s, i) => ({ state: s.state, detail: renderShown(s.detail), label: t(STEP_KEYS[i]!) }))} />}
      {deliverFailed && <p className="mt-2 text-[12px] text-warn">{t("hunt.deliverWarn")}</p>}
      {o3Url.includes("localhost") && (
        <p className="mt-3 text-xs text-warn">{tx("hunt.local", { cmd: <Mono>npm run o3</Mono> })}</p>
      )}
    </Card>
  );
}
