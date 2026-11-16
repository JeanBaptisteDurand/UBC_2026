import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { encodeAek, maskAek, generateSessionKey } from "@arcvault/sdk";
import { useArc } from "../useArc";
import { fetchSessions, fetchOperatorKeys, fetchOperatorKeysSigned, createOperatorKey, revokeOperatorKey, isSignatureSpent, type Session, type OperatorKey } from "../api";
import { signAction } from "../operatorActions";
import { dropReadAccess, readSignature, requestReadAccess, useReadAccess } from "../readAccess";
import { INFERENCE_PRODUCT, closeOutcome, parseUsdc, skipReason, useVerifiedEnclave, waitOk } from "../arc";
import { ENCLAVE_URL } from "../config";
import { PageHeader, Section, Card, Table, Td, Badge, Btn, Field, Status, NeedWallet, Empty, EnclaveCheckView, usdc, short } from "../ui";
import { MsgError, fail, isFailure, msg, show, type Msg } from "../msg";
import { fmtDateTime, fmtUnix, t, type StaticKey } from "../i18n";

function KeyReveal({ aek, onDone, note }: { aek: string; onDone: () => void; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 rounded-lg border border-good/40 bg-good/5 p-4">
      <div className="text-[13px] font-medium text-good">{t("keys.reveal.title")}</div>
      <p className="mt-1 text-[12px] text-muted">{note ?? t("keys.reveal.note")}</p>
      <div className="mt-3 break-all rounded-md border border-edge bg-ink px-3 py-2 font-mono text-[12px]">{aek}</div>
      <div className="mt-3 flex gap-2">
        <Btn onClick={() => { navigator.clipboard?.writeText(aek); setCopied(true); }}>{copied ? t("keys.reveal.copied") : t("keys.reveal.copy")}</Btn>
        <Btn kind="ghost" onClick={onDone}>{t("common.savedKey")}</Btn>
      </div>
    </div>
  );
}

function CreateKey({ onCreated, onConfirmed }: { onCreated: (aek: string) => void; onConfirmed: () => void }) {
  const arc = useArc();
  const [deposit, setDeposit] = useState("2");
  const [hours, setHours] = useState("24");
  const [out, setOut] = useState<Msg | null>(null);
  // v2 : la clé est adossée à une session VERROUILLÉE sur l'enclave que le mandataire appellera (ENCLAVE_URL),
  // dont la clé est d'abord confrontée à la chaîne
  const [check, recheck] = useVerifiedEnclave(arc, ENCLAVE_URL, INFERENCE_PRODUCT);
  async function create() {
    if (!arc || check.state !== "ok") return;
    setOut(msg("chat.opening"));
    try {
      const amount = parseUsdc(deposit, "what.deposit");
      const h = Number(hours.trim().replace(",", "."));
      if (!Number.isFinite(h) || h <= 0) throw new MsgError(msg("keys.badHours", { v: hours }));
      const r = await arc.openSession({
        productId: INFERENCE_PRODUCT, deposit: amount, expiresInSeconds: Math.round(h * 3600), enclaveUrl: ENCLAVE_URL, enclave: check.keys.signer,
      });
      onCreated(encodeAek("arctest", r.sessionId, r.sessionKey.privateKey));
      setOut(msg("keys.sessionSent", { id: r.sessionId, tx: r.tx }));
      await waitOk(arc, r.tx, "tx.openSession");
      setOut(msg("keys.sessionOpen", { id: r.sessionId, enclave: short(r.enclave), tx: r.tx }));
      onConfirmed();
    } catch (e) { setOut(fail(e)); }
  }
  return (
    <Card title={t("keys.create.title")} sub={t("keys.create.sub")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="text-[13px]">
          <span className="text-muted">{t("keys.create.enclave")}</span>
          <div className="mt-1 rounded-lg border border-edge bg-ink px-3 py-2 font-mono text-[12px]">
            {check.state === "ok" ? t("keys.create.enclaveOk", { id: INFERENCE_PRODUCT, signer: check.keys.signer.slice(0, 10) })
              : check.state === "bad" ? t("keys.create.enclaveBad") : t("keys.create.enclaveChecking")}
          </div>
        </div>
        <Field label={t("field.deposit")} value={deposit} onChange={setDeposit} hint={t("keys.create.depositHint")} />
        <Field label={t("keys.create.hours")} value={hours} onChange={setHours} hint={t("keys.create.hoursHint")} />
      </div>
      <div className="mt-2"><EnclaveCheckView check={check} onRetry={recheck} /></div>
      <div className="mt-4"><Btn onClick={create} disabled={!arc?.wallet || check.state !== "ok"}>{t("keys.create.go")}</Btn></div>
      <Status msg={out} />
    </Card>
  );
}

function SessionRow({ s, onChanged, onNewKey }: { s: Session; onChanged: () => void; onNewKey: (aek: string) => void }) {
  const arc = useArc();
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState<Msg | null>(null);
  const left = s.deposit - s.paid;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const expired = s.expiresAt !== undefined && s.expiresAt > 0n && s.expiresAt <= now;
  async function run(label: StaticKey, fn: () => Promise<Msg>) {
    setNote(msg("common.labelBusy", { label: msg(label) }));
    try { const done = await fn(); setNote(msg("common.labelDone", { label: msg(label), done })); onChanged(); } catch (e) {
      setNote(fail(e));
    }
  }
  async function topUp(): Promise<Msg> {
    if (!arc) throw new MsgError(msg("err.connectWallet"));
    const hash = await arc.topUp(s.id, parseUsdc(amount, "what.topUp"));
    setNote(msg("keys.topUpConfirming"));
    await waitOk(arc, hash, "tx.topUp");
    return msg("keys.done", { tx: hash });
  }
  async function rotate(): Promise<Msg> {
    if (!arc) throw new MsgError(msg("err.connectWallet"));
    const k = generateSessionKey();
    const hash = await arc.rotateKey(s.id, k.address);
    setNote(msg("keys.rotateConfirming"));
    await waitOk(arc, hash, "tx.rotateKey");
    onNewKey(encodeAek("arctest", s.id, k.privateKey));
    return msg("keys.rotated", { tx: hash });
  }
  async function close(): Promise<Msg> {
    if (!arc) throw new MsgError(msg("err.connectWallet"));
    // v2 : clôture à l'échéance + 1 h de grâce (dernier règlement possible), ou plus tôt si l'enclave ne peut plus régler
    const c = await arc.sessionClosability(s.id);
    if (!c.closableNow) {
      throw new MsgError(msg("keys.tooEarly", { when: () => fmtUnix(c.atTime) }));
    }
    const hash = await arc.closeSession(s.id);
    setNote(msg("keys.closeConfirming"));
    const rcpt = await waitOk(arc, hash, "tx.closeSession");
    // v2.1 : la fermeture dit ce qu'est devenu le verdict ERC-8004 (écrit, sans objet faute de paiement, ou sauté)
    const o = closeOutcome(rcpt.logs);
    return o.outcome === "written" ? msg("keys.closed", { tx: hash })
      : o.outcome === "not_applicable" ? msg("keys.closedNoVerdict", { tx: hash })
      : o.outcome === "skipped" ? msg("keys.closedSkipped", { reason: () => skipReason(o.reasonData), tx: hash })
      : msg("keys.closedPlain", { tx: hash });
  }
  return (
    <>
      <tr className="hover:bg-panel/60">
        <Td main wrap>
          <span className="whitespace-nowrap font-medium">{t("common.Session", { id: s.id.toString() })}</span> <span className="whitespace-nowrap text-[12px] text-muted">{t("common.product", { id: s.productId.toString() })}</span>
          {s.enclave && <span className="block whitespace-nowrap text-[12px] text-muted">{t("ui.check.enclave", { v: short(s.enclave, 4) })}</span>}
        </Td>
        <Td label={t("keys.h.deposit")} className="font-mono">{usdc(s.deposit)}</Td>
        <Td label={t("keys.h.paid")} className="font-mono">{usdc(s.paid)}</Td>
        <Td label={t("keys.h.left")} className="font-mono">{s.closed ? "—" : usdc(left)}</Td>
        <Td label={t("bounties.h.status")}>
          {s.closed ? <Badge tone="muted">{t("common.closed")}</Badge> : expired ? <Badge tone="warn">{t("common.expired")}</Badge> : <Badge tone="good">{t("common.open")}</Badge>}
          {!s.closed && s.expiresAt !== undefined && s.expiresAt > 0n && <span className="block text-[12px] text-muted">{t(expired ? "keys.on" : "keys.until", { when: fmtUnix(s.expiresAt) })}</span>}
        </Td>
        <Td actions>
          {!s.closed && arc?.wallet && (
            <>
              <input aria-label={t("keys.topUpAria")} className="w-16 rounded-md border border-edge bg-ink px-2 py-1 font-mono text-[12px]" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Btn kind="ghost" onClick={() => run("keys.l.topUp", topUp)}>{t("keys.topUp")}</Btn>
              <Btn kind="ghost" onClick={() => run("keys.l.newKey", rotate)}>{t("keys.rotate")}</Btn>
              <Btn kind="danger" onClick={() => run("keys.l.close", close)}>{t("keys.close")}</Btn>
            </>
          )}
        </Td>
      </tr>
      {note && <tr className="dt-sub"><td colSpan={6} className={`break-words px-3 pb-2 text-[12px] ${isFailure(note) ? "text-bad" : "text-muted"}`}>{show(note)}</td></tr>}
    </>
  );
}

/** Clés opérateur (arcop_) : pour l'agent archive-node, la CLI et le serveur MCP. Elles rendent compte et
 *  diagnostiquent ; elles ne peuvent ni dépenser ni retirer la caution (seul le wallet signe). Leurs vrais libellés
 *  sont réservés à l'opérateur : la signature de lecture (10 min, partagée avec la page Opérateur) les affiche. */
function OperatorKeys({ address }: { address: string }) {
  const arc = useArc();
  const read = useReadAccess(address);
  const [keys, setKeys] = useState<OperatorKey[] | null>(null);
  // null : le nom proposé, dans la langue du moment (tant que l'utilisateur n'a rien tapé)
  const [typed, setLabel] = useState<string | null>(null);
  const label = typed ?? t("keys.op.defaultLabel");
  const [fresh, setFresh] = useState("");
  const [note, setNote] = useState<Msg | null>(null);
  const reload = () => {
    const r = readSignature(address);
    (r ? fetchOperatorKeysSigned(r) : fetchOperatorKeys(address)).then(setKeys).catch((e) => {
      if (r && isSignatureSpent(e)) { dropReadAccess(); setNote(msg("keys.op.expired")); }
      else setKeys((k) => k ?? []);
    });
  };
  useEffect(() => { reload(); }, [address, read]);
  async function unlock() {
    if (!arc) return;
    setNote(msg("keys.op.signRead"));
    try { await requestReadAccess(arc); setNote(null); } catch (e) { setNote(fail(e)); }
  }
  async function create() {
    if (!arc) return;
    setNote(msg("keys.op.signCreate"));
    try { const r = await createOperatorKey(label, await signAction(arc, { kind: "createKey" })); setFresh(r.key); setNote(null); reload(); }
    catch (e: any) { setNote(fail(e)); }
  }
  async function revoke(keyId: string) {
    if (!arc) return;
    try { await revokeOperatorKey(keyId, await signAction(arc, { kind: "revokeKey", keyId })); reload(); }
    catch (e: any) { setNote(fail(e)); }
  }
  const masked = !read && !!keys?.some((k) => k.restricted);
  // vue publique : l'API remplace le vrai libellé par un libellé générique (en français) ; on le dit dans la langue du site
  const labelOf = (k: OperatorKey) => (k.restricted ? t(k.machineId ? "keys.op.machineKey" : "keys.op.freeKey") : k.label);
  return (
    <Section title={t("keys.op.title")} lead={t("keys.op.lead")}
      right={masked ? <Btn kind="ghost" onClick={unlock} disabled={!arc?.wallet}>{t("keys.op.showNames")}</Btn> : undefined}>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-64"><Field label={t("keys.op.name")} value={label} onChange={setLabel} /></div>
        <Btn onClick={create} disabled={!arc}>{t("keys.op.create")}</Btn>
      </div>
      {fresh && <KeyReveal aek={fresh} onDone={() => setFresh("")} note={t("keys.op.note")} />}
      {masked && <p className="mb-2 text-[12px] text-muted">{t("keys.op.masked")}</p>}
      <Status msg={note} />
      <Table head={[t("keys.op.h.key"), t("keys.op.h.bound"), t("keys.op.h.created"), t("keys.op.h.used"), t("bounties.h.status"), ""]}
        empty={keys && keys.length === 0 ? <Empty>{t("keys.op.empty")}</Empty> : undefined}>
        {keys?.map((k) => (
          <tr key={k.keyId}>
            <Td main wrap><span className="whitespace-nowrap font-mono">arcop_{k.keyId}_…</span> <span className="text-[12px] text-muted">{labelOf(k)}</span></Td>
            <Td label={t("keys.op.h.bound")} wrap className="text-muted">{k.machineId ? t("keys.op.aMachine") : t("keys.op.free")}</Td>
            <Td label={t("keys.op.h.created")} className="text-muted">{fmtDateTime(k.createdAt)}</Td>
            <Td label={t("keys.op.h.used")} className="text-muted">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : t("common.never")}</Td>
            <Td label={t("bounties.h.status")}>{k.revoked ? <Badge tone="muted">{t("common.revoked")}</Badge> : <Badge tone="good">{t("common.active")}</Badge>}</Td>
            <Td actions>{!k.revoked && <Btn kind="danger" onClick={() => revoke(k.keyId)}>{t("keys.op.revoke")}</Btn>}</Td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

export default function Keys() {
  const { address, isConnected } = useAccount();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [aek, setAek] = useState("");
  const [lastMasked, setLastMasked] = useState("aek_arctest_<session>_<secret>");
  const reload = () => { if (address) fetchSessions(address).then(setSessions).catch(() => setSessions([])); };
  useEffect(reload, [address]);
  const reveal = (k: string) => { setAek(k); setLastMasked(maskAek(k)); reload(); };

  return (
    <>
      <PageHeader title={t("keys.title")} lead={t("keys.lead")} />
      {!isConnected ? <NeedWallet what={t("keys.need")} /> : (
        <>
          <Section>
            <CreateKey onCreated={reveal} onConfirmed={reload} />
            {aek && <KeyReveal aek={aek} onDone={() => setAek("")} />}
          </Section>
          <Section title={t("keys.sessions.title")} lead={t("keys.sessions.lead")}>
            <Table head={[t("keys.h.session"), t("keys.h.deposit"), t("keys.h.paid"), t("keys.h.left"), t("bounties.h.status"), t("keys.h.actions")]}
              empty={sessions && sessions.length === 0 ? <Empty>{t("keys.sessions.empty")}</Empty> : undefined}>
              {!sessions && <tr><Td className="text-muted">{t("keys.sessions.loading")}</Td></tr>}
              {sessions?.map((s) => <SessionRow key={s.id.toString()} s={s} onChanged={reload} onNewKey={reveal} />)}
            </Table>
          </Section>
          {address && <OperatorKeys address={address} />}
        </>
      )}
      <Section title={t("keys.loop.title")} lead={t("keys.loop.lead")}>
        {/* grid-cols-1 et min-w-0 : sur téléphone, le code défile dans son cadre au lieu d'élargir la page */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1.5 text-[13px] text-muted">{t("keys.loop.step1")}</div>
            <pre className="overflow-x-auto rounded-lg border border-edge bg-panel p-3 font-mono text-[12px] leading-relaxed">{`npm run arcvault -- proxy \\
  --key ${lastMasked} \\
  --enclave ${ENCLAVE_URL}
# ${t("keys.loop.listens")}`}</pre>
          </div>
          <div className="min-w-0">
            <div className="mb-1.5 text-[13px] text-muted">{t("keys.loop.step2")}</div>
            <pre className="overflow-x-auto rounded-lg border border-edge bg-panel p-3 font-mono text-[12px] leading-relaxed">{`from openai import OpenAI
client = OpenAI(base_url="http://localhost:8787/v1", api_key="local")

for question in questions:
    r = client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": question}],
    )
    print(r.choices[0].message.content)`}</pre>
          </div>
        </div>
      </Section>
    </>
  );
}
