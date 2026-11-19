import { ENCLAVE_URL } from "../config";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { parseEventLogs, type Address, type Hex } from "viem";
import { testnet, operatorBondAbi, productRegistryAbi, type EnclaveView } from "@arcvault/sdk";
import { Check, Copy } from "lucide-react";
import { useArc } from "../useArc";
import {
  fetchEnclaves, fetchMachines, fetchMachinesSigned, fetchMachineDetail, fetchPairing, approvePairing, removeMachine, fetchProducts,
  fetchOperatorKeys, isSignatureSpent, ApiError, type Machine, type OperatorKey, type Signed,
} from "../api";
import { signAction, registerMachineEnclave, registeredMsg, askCopilot, sendTx } from "../operatorActions";
import { dropReadAccess, readExpiresAt, readSignature, requestReadAccess, useReadAccess } from "../readAccess";
import { INFERENCE_PRODUCT, dcapGasLabel, parseUsdc, verifiedLabel, waitOk } from "../arc";
import { PageHeader, Section, Card, Btn, Field, Stat, Status, Table, Td, Badge, Hex as HexVal, NeedWallet, Empty, usdc, short, addrLink } from "../ui";
import { MsgError, fail, failWith, isFailure, msg, type Msg } from "../msg";
import { fmtNum, fmtTime, fmtUnix, t, tx, type StaticKey } from "../i18n";
import { LevelsCard } from "./Levels";

const WEB = typeof window !== "undefined" ? window.location.origin : "https://archive.62-171-153-35.sslip.io";
/** Les contrôles d'archive-node doctor, nommés dans la langue du site (sinon le libellé envoyé par la machine). */
const CHECK_LABEL: Record<string, StaticKey> = {
  os: "op.check.os", node: "op.check.node", docker: "op.check.docker", tdx_guest: "op.check.tdx_guest", tsm_report: "op.check.tsm_report",
  dstack_socket: "op.check.dstack_socket", clock: "op.check.clock", rpc: "op.check.rpc", api: "op.check.api", port: "op.check.port",
  enclave_health: "op.check.enclave_health", attest: "op.check.attest", bond: "op.check.bond",
};
const checkLabel = (id: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(CHECK_LABEL, id) ? t(CHECK_LABEL[id]!) : undefined;
/** L'état d'une machine (battement de l'agent) dans la langue du site. */
const STATUS_LABEL: Record<string, StaticKey> = {
  running: "op.m.status.running", starting: "op.m.status.starting", error: "op.m.status.error", stopped: "op.m.status.stopped", paired: "op.m.status.paired",
};
const statusLabel = (s: string): string => (Object.prototype.hasOwnProperty.call(STATUS_LABEL, s) ? t(STATUS_LABEL[s]!) : s);

const PRODUCT = Number(INFERENCE_PRODUCT); // l'inférence privée de la pile v2 (produit 1)
// Uniquement du VRAI matériel Intel TDX : pas de mode « sans TDX » (une attestation simulée ne prouve rien).
const MODES = [
  { id: "cloud", title: "op.mode.cloud.title", text: "op.mode.cloud.text", product: PRODUCT, flags: "--tunnel" },
  { id: "bare", title: "op.mode.bare.title", text: "op.mode.bare.text", product: PRODUCT, flags: "--tunnel" },
  { id: "rent", title: "op.mode.rent.title", text: "op.mode.rent.text", product: PRODUCT, flags: "--tunnel" },
] as const satisfies ReadonlyArray<{ id: string; title: StaticKey; text: StaticKey; product: number; flags: string }>;

/** D'où vient une machine : appairée par code (le compte confirmé sur la machine), ajoutée ou reprise par le battement
 *  d'une clé arcop_ libre (aucune confirmation sur la machine), ou inconnu (clés illisibles, ou encore en lecture).
 *  L'API le dit (champ pairedBy) ; pour une machine d'avant ce champ, le site le déduit des clés publiques. */
type Origin = "pair" | "key" | "unknown" | "loading";

export function CopyLine({ cmd }: { cmd: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-edge bg-ink px-3 py-2">
      {/* 19/11 : sur téléphone, la commande passe à la ligne (rien de caché sous le bouton), entre ses mots d'abord (un mot
          n'est coupé que s'il est plus long que la ligne : une URL) ; plus large, une ligne qui défile */}
      <code className="min-w-0 whitespace-pre-wrap font-mono text-[12px] [overflow-wrap:anywhere] sm:overflow-x-auto sm:whitespace-nowrap sm:[overflow-wrap:normal]">{cmd}</code>
      <button aria-label={t("op.copyCmd")} title={t("op.copyCmd")} className="hexbtn -my-1.5 shrink-0 text-muted hover:text-text" onClick={() => { navigator.clipboard?.writeText(cmd); setOk(true); setTimeout(() => setOk(false), 1200); }}>
        {ok ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

/** « hive-7k2p qx9m », « HIVE-7K2PQX9M », « 7K2P-QX9M » → « HIVE-7K2P-QX9M » (8 caractères depuis le durcissement du 7/11) ; "" sinon. */
export function normalizePairCode(raw: string): string {
  const s = raw.toUpperCase().replace(/\s+/g, "").trim();
  const m = s.match(/^(?:HIVE-?)?([A-Z0-9]{4})-?([A-Z0-9]{4})$/);
  return m ? `HIVE-${m[1]}-${m[2]}` : "";
}

function codeFromHash(): string {
  const q = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(q).get("code")?.toUpperCase() ?? "";
}

function AddMachine({ onPaired }: { onPaired: () => void }) {
  const arc = useArc();
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("cloud");
  const [code, setCode] = useState(codeFromHash());
  const [found, setFound] = useState<{ hostname: string; mode: string; expiresAt: number } | null>(null);
  // la ligne d'état : un message (clé et valeurs), mis en mots à l'affichage dans la langue du moment
  const [out, setOut] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  // le compte qui vient d'approuver, en entier : la machine affiche le même avant de garder sa clé (« o » pour accepter)
  const [approved, setApproved] = useState<string | null>(null);
  const m = MODES.find((x) => x.id === mode)!;
  useEffect(() => {
    setFound(null);
    setOut((o) => (isFailure(o) ? null : o)); // un nouveau code efface l'erreur du précédent (pas le message de réussite)
    const c = normalizePairCode(code);
    if (!c) return;
    let alive = true;
    // le nom de la machine n'est révélé qu'APRÈS votre signature (durcissement) : on n'affiche ici que son mode
    fetchPairing(c)
      .then((p) => { if (alive) setFound({ hostname: p.hostnameHidden ? "" : p.hostname, mode: p.mode, expiresAt: Number(p.expiresAt) }); })
      .catch((e) => { if (alive) setOut(fail(e)); });
    return () => { alive = false; };
  }, [code]);

  async function approve() {
    if (!arc || busy) return;
    const c = normalizePairCode(code);
    if (!c) { setOut(failWith(msg("op.pair.badCode"))); return; }
    const seen = found; // le code était en attente quand on l'a cherché
    setBusy(true); setApproved(null);
    setOut(msg("op.pair.signing"));
    try {
      const s = await signAction(arc, { kind: "pair", code: c });
      const r = await approvePairing(c, s);
      // la machine affiche l'adresse complète qui l'a approuvée (en minuscules, comme ici) et ne garde sa clé qu'après « o »
      // (audit, faille n° 5) ; « n » la fait révoquer : un code approuvé par quelqu'un d'autre ne lui sert à rien
      setOut(msg("op.pair.approved", { host: r.hostname }));
      setApproved(s.address.toLowerCase());
      setCode(""); setFound(null); onPaired();
    } catch (e: any) {
      // l'API dit elle-même « déjà approuvé par un autre compte » (409 pair_already_approved, traduit par son code) ;
      // un code « inconnu ou expiré » (404) qui était en attente juste avant et a expiré depuis : on le dit ainsi
      if (e instanceof ApiError && e.status === 404 && (!e.code || e.code === "code_unknown") && seen && Date.now() >= seen.expiresAt) {
        setOut(failWith(msg("err.pairExpired")));
      } else setOut(fail(e));
    } finally { setBusy(false); }
  }

  return (
    <Card title={t("op.add.title")} sub={t("op.add.sub")}>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("op.add.typeAria")}>
        {MODES.map((x) => (
          <button key={x.id} role="radio" aria-checked={mode === x.id} onClick={() => setMode(x.id)}
            className={`rounded-lg border px-3 py-2.5 text-left transition ${mode === x.id ? "border-accent bg-accent/10" : "border-edge hover:border-muted/60"}`}>
            <span className="block text-[13px] font-medium">{t(x.title)}</span>
            <span className="mt-0.5 block text-[12px] leading-snug text-muted">{t(x.text)}</span>
          </button>
        ))}
      </div>
      {mode === "rent" && (
        <p className="mt-3 text-[13px] text-muted">
          {tx("op.add.rent", { link: <a className="text-accent hover:underline" href="https://cloud.phala.network" target="_blank" rel="noreferrer">Phala Cloud</a> })}
        </p>
      )}
      {/* grid-cols-1 et min-w-0 : sur téléphone, une longue commande défile dans sa ligne au lieu d'élargir la page */}
      <ol className="mt-4 grid grid-cols-1 gap-3">
        <li className="min-w-0"><div className="mb-1 text-[13px] text-muted">{t("op.add.s1")}</div><CopyLine cmd={`curl -fsSL ${WEB}/install.sh | sh`} /></li>
        <li className="min-w-0"><div className="mb-1 text-[13px] text-muted">{t("op.add.s2")}</div><CopyLine cmd="archive-node doctor" /></li>
        <li className="min-w-0"><div className="mb-1 text-[13px] text-muted">{t("op.add.s3")}</div><CopyLine cmd="archive-node pair" /></li>
        <li className="min-w-0"><div className="mb-1 text-[13px] text-muted">{t("op.add.s4")}</div><CopyLine cmd={`archive-node up --product ${m.product} ${m.flags}`} /></li>
      </ol>
      <div className="mt-5 border-t border-edge pt-4">
        <div className="text-[13px] font-medium">{t("op.add.approve")}</div>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="w-44"><Field label={t("op.add.code")} value={code} onChange={(v) => { setCode(v.toUpperCase().trim()); setApproved(null); }} placeholder="HIVE-7K2P-QX9M" /></div>
          <Btn onClick={approve} disabled={!arc || !found || busy}>{t("op.add.approveBtn")}</Btn>
          {found && (
            <span className="pb-2 text-[13px] text-muted">
              {t("op.add.found")}{found.hostname ? <>: <span className="text-text">{found.hostname}</span></> : t("op.add.foundHidden")} ({found.mode === "demo" ? t("op.add.noTdx") : found.mode.toUpperCase()})
            </span>
          )}
        </div>
        <Status msg={out} />
        {approved && (
          <div className="mt-3 rounded-lg border border-good/40 bg-good/5 p-3">
            <div className="text-[12px] text-muted">{t("op.pair.account")}</div>
            <div className="mt-1 break-all font-mono text-[14px] text-text">{approved}</div>
            <p className="mt-2 text-[12px] text-muted">{t("op.pair.check")}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

/** La lecture réservée (une signature, 10 min) : ce que les lignes de « Vos machines » partagent. */
type ReadAccess = { read: Signed | null; unlock: () => void; spent: () => void };

function OriginBadge({ origin, m }: { origin: Origin; m: Machine }) {
  if (origin === "loading") return null;
  const [label, title, tone]: [StaticKey, StaticKey, "good" | "warn" | "muted"] =
    origin === "pair" ? ["op.origin.pair", "op.origin.pairTitle", "good"]
      : origin === "key" ? ["op.origin.key", "op.origin.keyTitle", "warn"]
      : ["op.origin.unknown", "op.origin.unknownTitle", "muted"];
  // l'API nomme l'adresse qui a approuvé (et la clé libre d'une machine « key ») ; sans ce champ, le badge seul.
  // L'adresse courte et la clé ne se coupent jamais (la ligne passe à la ligne entre les mots, pas dans « 0x728bce…abf7 »)
  const by = m.pairedBy && m.approvedBy ? <span className="whitespace-nowrap">{short(m.approvedBy)}</span> : null;
  const who = !by ? null : m.pairedBy === "key" && m.viaKey
    ? tx("op.origin.byKey", { key: <span className="whitespace-nowrap">{m.viaKey}</span>, addr: by })
    : tx("op.origin.by", { addr: by });
  return (
    <span className="mt-1 block" title={t(title)}>
      <Badge tone={tone}>{t(label)}</Badge>
      {who && <span className="ml-1.5 font-mono text-[11px] text-muted">{who}</span>}
    </span>
  );
}

function MachineRow({ m, origin, onChanged, freeBond, minBond, access }: { m: Machine; origin: Origin; onChanged: () => void; freeBond?: bigint; minBond: bigint; access: ReadAccess }) {
  const arc = useArc();
  const [note, setNote] = useState<Msg | null>(null);
  const [open, setOpen] = useState(false);
  // une machine qui n'a pas été appairée par code : on demande confirmation avant de l'inscrire sous votre adresse
  const [confirming, setConfirming] = useState(false);
  const ago = m.lastSeen ? Math.round((Date.now() - m.lastSeen) / 60000) : null;
  // v2 : chaque nouvelle clé d'enclave réserve la caution minimale de son produit sur la caution LIBRE
  const bondOk = (freeBond ?? 0n) >= minBond;
  async function register(confirmed = false) {
    if (!arc || !m.enclaveUrl || !m.productId) return;
    if (origin !== "pair" && !confirmed) { setConfirming(true); return; }
    setConfirming(false);
    try {
      const r = await registerMachineEnclave(arc, BigInt(m.productId), m.enclaveUrl, setNote);
      setNote(registeredMsg(r)); onChanged();
    } catch (e: any) { setNote(fail(e)); }
  }
  async function remove() {
    if (!arc) return;
    try { await removeMachine(m.machineId, await signAction(arc, { kind: "removeMachine", machineId: m.machineId })); onChanged(); }
    catch (e: any) { setNote(fail(e)); }
  }
  return (
    <>
      <tr className="hover:bg-panel/60">
        <Td main wrap>
          <button className="text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
            <span className="font-medium">{m.hostname}</span>
            {m.hostnameHidden && <span className="ml-1 whitespace-nowrap text-[12px] text-muted" title={t("op.m.nameHiddenTitle")}>{t("op.m.nameHidden")}</span>}
            <span className="ml-1.5"><Badge tone={m.mode === "demo" ? "bad" : "accent"}>{m.mode === "demo" ? t("op.m.noTdx") : m.mode.toUpperCase()}</Badge></span>
            <span className="block text-[12px] text-muted">{open ? t("op.m.hide") : t("op.m.show")}</span>
          </button>
          <OriginBadge origin={origin} m={m} />
        </Td>
        <Td label={t("op.mach.h.status")}>
          <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 shrink-0 rounded-full ${m.online ? "bg-good" : "bg-edge"}`} />{m.online ? statusLabel(m.status) : ago != null ? t("op.m.offline", { n: fmtNum(ago) }) : t("op.m.neverSeen")}</span>
        </Td>
        <Td label={t("op.mach.h.doctor")}>{m.doctorOk === null ? <span className="text-muted">{t("op.m.pending")}</span> : m.failing && m.failing.length
          ? <span className="flex flex-wrap gap-1">{m.failing.map((f) => <Badge key={f} tone="bad">{checkLabel(f) ?? f}</Badge>)}</span>
          : <Badge tone="good">{t("op.m.allGreen")}</Badge>}</Td>
        <Td label={t("op.mach.h.onArc")}>{m.registered ? <Badge tone="good">{verifiedLabel()}</Badge>
          : <Btn onClick={() => register()} disabled={!arc?.wallet || !m.online || !m.enclaveUrl || !bondOk || m.mode === "demo" || confirming}>{m.mode === "demo" ? t("op.m.noTdxBtn") : bondOk ? t("op.m.register") : t("op.m.bondNeeded")}</Btn>}</Td>
        <Td actions>
          <Btn kind="ghost" onClick={() => askCopilot(t("op.m.debugAsk", { host: m.hostname, id: m.machineId, op: m.operator }))}>{t("op.m.debug")}</Btn>
          <Btn kind="danger" onClick={remove}>{t("op.m.remove")}</Btn>
        </Td>
      </tr>
      {(open || note || confirming) && (
        <tr className="dt-sub"><td colSpan={5} className="bg-ink/40 px-4 pb-3 pt-1">
          {confirming && (
            <div className="mt-2 rounded-lg border border-warn/40 bg-warn/5 p-3 text-[13px]" role="alert">
              <p className="text-warn">{t(origin === "key" ? "op.confirm.key" : "op.confirm.unknown", { url: m.enclaveUrl ?? "—" })}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn onClick={() => register(true)}>{t("op.confirm.go")}</Btn>
                <Btn kind="ghost" onClick={() => setConfirming(false)}>{t("common.cancel")}</Btn>
              </div>
            </div>
          )}
          {note && <Status msg={note} />}
          {open && <MachineDetail m={m} access={access} />}
        </td></tr>
      )}
    </>
  );
}

/** Diagnostic et journaux : réservés à l'opérateur, lus avec la signature de lecture (rafraîchis toutes les 15 s). */
function MachineDetail({ m, access }: { m: Machine; access: ReadAccess }) {
  const { read } = access;
  const [d, setD] = useState<Machine | null>(null);
  const [err, setErr] = useState<Msg | null>(null);
  useEffect(() => {
    setD(null);
    setErr(null);
    if (!read) return;
    let alive = true;
    const load = () => fetchMachineDetail(m.machineId, read)
      .then((x) => { if (alive) { setD(x); setErr(null); } })
      .catch((e) => {
        if (!alive) return;
        if (isSignatureSpent(e)) access.spent();
        else setErr(fail(e));
      });
    load();
    const timer = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, [m.machineId, read]);
  if (!read) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <span>{t("op.d.reserved")}</span>
        <Btn kind="ghost" onClick={access.unlock}>{t("op.d.sign")}</Btn>
        <span className="text-[12px]">{t("op.d.signNote")}</span>
      </div>
    );
  }
  const enclaveUrl = d?.enclaveUrl ?? m.enclaveUrl;
  const signer = d?.signer ?? m.signer;
  const productId = d?.productId ?? m.productId;
  return (
    <>
      {err && <Status msg={err} />}
      {!d && !err && <p className="mt-2 text-[13px] text-muted">{t("op.d.loading")}</p>}
      <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1.5 text-[12px] text-muted">{t("op.d.doctor")}</div>
          <ul className="space-y-1 text-[13px]">
            {(d?.doctor?.checks ?? []).map((c) => (
              <li key={c.id} className="flex gap-2"><span className={c.ok ? "text-good" : "text-bad"}>{c.ok ? "✓" : "✗"}</span><span><span className="text-text">{checkLabel(c.id) ?? c.label}</span> <span className="text-muted">{c.detail}</span></span></li>
            ))}
            {d && !d.doctor && <li className="text-muted">{t("op.d.noDoctor")}</li>}
          </ul>
          <div className="mt-3 space-y-1 text-[12px] text-muted">
            <div>{tx("op.d.enclave", { url: <span className="font-mono text-text">{enclaveUrl ?? "—"}</span> })}</div>
            <div>{tx("op.d.signer", { signer: signer ? <HexVal value={signer} /> : "—", id: productId ?? "—" })}</div>
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 text-[12px] text-muted">{t("op.d.logs")}</div>
          <pre className="max-h-48 overflow-auto rounded-lg border border-edge bg-ink p-2 font-mono text-[11px] leading-relaxed text-muted">{(d?.logs ?? []).slice(-30).join("\n") || "—"}</pre>
        </div>
      </div>
    </>
  );
}

export default function Operator({ go }: { go: (r: string) => void }) {
  const arc = useArc();
  const { address, isConnected } = useAccount();
  const [bal, setBal] = useState<bigint>();
  const [bond, setBond] = useState<bigint>();
  const [avail, setAvail] = useState<bigint>();
  const [free, setFree] = useState<bigint>();
  const [unlockAt, setUnlockAt] = useState<bigint>();
  const [agentId, setAgentId] = useState<bigint>();
  const [mine, setMine] = useState<EnclaveView[] | null>(null);
  const [machines, setMachines] = useState<Machine[] | null>(null);
  // les clés arcop_ de l'opérateur (vue publique : leur machine liée suffit) disent d'où vient chaque machine
  const [opKeys, setOpKeys] = useState<OperatorKey[] | "error" | null>(null);
  const keyChecked = useRef(new Set<string>());
  const [minBonds, setMinBonds] = useState<Map<string, bigint>>(new Map());
  const [bondAmt, setBondAmt] = useState("4");
  const [unbondAmt, setUnbondAmt] = useState("1");
  const [agentInput, setAgentInput] = useState("");
  const [productId, setProductId] = useState(INFERENCE_PRODUCT.toString());
  const [enclaveUrl, setEnclaveUrl] = useState(ENCLAVE_URL);
  // les lignes d'état : des messages (clé et valeurs), mis en mots à l'affichage dans la langue du moment
  const [status, setStatus] = useState<Msg | null>(null);
  const [idStatus, setIdStatus] = useState<Msg | null>(null);
  const [encStatus, setEncStatus] = useState<Msg | null>(null);
  const [regStatus, setRegStatus] = useState<Msg | null>(null);
  const [readMsg, setReadMsg] = useState<Msg | null>(null);
  // lecture réservée : une signature (10 min, gardée en mémoire de la page) ouvre noms, diagnostics et journaux
  const read = useReadAccess(address);
  const readUntil = readExpiresAt(address);

  const readBond = (functionName: "withdrawableAt" | "agentIdOf", op: Address) =>
    arc!.pub.readContract({ address: testnet.operatorBond, abi: operatorBondAbi, functionName, args: [op] }) as Promise<bigint>;

  async function unlock() {
    if (!arc) return;
    setReadMsg(msg("keys.op.signRead"));
    try { await requestReadAccess(arc); setReadMsg(null); } catch (e) { setReadMsg(fail(e)); }
  }
  function spent() { // l'API ne reconnaît plus la signature (échue, ou API redémarrée) : retour à la vue publique
    dropReadAccess();
    setReadMsg(msg("op.read.expired"));
  }
  const access = { read, unlock, spent };
  /** la liste complète avec la lecture signée en cours, sinon la vue publique (noms masqués, sans adresse http://IP) */
  function loadMachines() {
    if (!address) return;
    const r = readSignature(address);
    (r ? fetchMachinesSigned(r) : fetchMachines(address)).then(setMachines).catch((e) => {
      if (r && isSignatureSpent(e)) spent();
      else setMachines((cur) => cur ?? []);
    });
  }
  function loadKeys() {
    if (!address) return;
    fetchOperatorKeys(address).then(setOpKeys).catch(() => setOpKeys((k) => (Array.isArray(k) ? k : "error")));
  }

  async function refresh() {
    if (!arc || !address) return;
    arc.usdcBalance(address).then(setBal).catch(() => {});
    arc.bondOf(address).then(setBond).catch(() => {});
    arc.availableBond(address).then(setAvail).catch(() => {});
    arc.freeBond(address).then(setFree).catch(() => {});
    readBond("withdrawableAt", address).then(setUnlockAt).catch(() => {});
    readBond("agentIdOf", address).then(setAgentId).catch(() => {});
    fetchEnclaves().then((es) => setMine(es.filter((e) => e.operator.toLowerCase() === address.toLowerCase()))).catch(() => setMine([]));
    loadMachines();
    loadKeys();
    fetchProducts().then((ps) => setMinBonds(new Map(ps.map((p) => [p.id.toString(), p.minBond])))).catch(() => {});
  }
  useEffect(() => { refresh(); }, [arc, address]);
  useEffect(() => { setOpKeys(null); keyChecked.current = new Set(); }, [address]);
  useEffect(() => { // les machines se rafraîchissent seules (battements de cœur toutes les 30 s), et dès que la lecture change
    if (!address) return;
    loadMachines();
    const timer = setInterval(loadMachines, 10_000);
    return () => clearInterval(timer);
  }, [address, read]);
  // (API d'avant pairedBy) une machine apparue depuis la dernière lecture des clés (appairée dans un autre onglet, par
  // exemple) : on relit les clés UNE fois pour elle, avant de dire qu'elle a été ajoutée sans code
  useEffect(() => {
    if (!machines || !Array.isArray(opKeys)) return;
    const bound = new Set(opKeys.map((k) => k.machineId).filter(Boolean));
    const fresh = machines.filter((m) => !m.pairedBy && !bound.has(m.machineId) && !keyChecked.current.has(m.machineId));
    if (fresh.length) { for (const m of fresh) keyChecked.current.add(m.machineId); loadKeys(); }
  }, [machines, opKeys]);
  const originOf = (m: Machine): Origin => {
    // ce que l'API dit (pairedBy), sinon la déduction : une clé liée à la machine ne naît que d'un appairage par code
    if (m.pairedBy === "code") return "pair";
    if (m.pairedBy === "key") return "key";
    if (opKeys === null) return "loading";
    if (opKeys === "error") return "unknown";
    return opKeys.some((k) => k.machineId === m.machineId) ? "pair" : "key";
  };

  const pending = bond !== undefined && avail !== undefined && bond > avail ? bond - avail : 0n; // demandé en retrait
  const reserved = avail !== undefined && free !== undefined && avail > free ? avail - free : 0n; // réservé par les clés inscrites
  const unlocked = unlockAt !== undefined && BigInt(Math.floor(Date.now() / 1000)) >= unlockAt;
  const minBondOf = (pid: string | null) => minBonds.get(pid ?? "") ?? 1_000_000n;

  async function doBond() {
    if (!arc) return;
    setStatus(msg("op.bond.signing"));
    try {
      const hash = await arc.bond(parseUsdc(bondAmt, "what.bond"), "auth"); // EIP-3009 : une seule transaction
      setStatus(msg("op.bond.sent"));
      await waitOk(arc, hash, "tx.bond");
      setStatus(msg("op.bond.done", { tx: hash })); refresh();
    } catch (e: any) { setStatus(fail(e)); }
  }
  async function doUnbond() {
    if (!arc) return;
    try {
      const v = parseUsdc(unbondAmt, "what.withdrawal");
      if (free !== undefined && v > free) {
        const max = free;
        throw new MsgError(msg("op.unbond.tooMuch", { amt: () => usdc(max) }));
      }
      setStatus(msg("op.unbond.signing"));
      const hash = await arc.requestUnbond(v);
      setStatus(msg("op.unbond.sent"));
      await waitOk(arc, hash, "tx.unbondRequest");
      setStatus(msg("op.unbond.done", { amt: () => usdc(v), tx: hash })); refresh();
    } catch (e: any) { setStatus(fail(e)); }
  }
  async function doWithdraw() {
    if (!arc) return;
    const amount = pending;
    setStatus(msg("op.withdraw.signing"));
    try {
      const hash = await arc.withdrawBond();
      setStatus(msg("common.withdrawSent"));
      await waitOk(arc, hash, "tx.withdrawBond");
      setStatus(msg("common.withdrawn", { amt: () => usdc(amount), tx: hash })); refresh();
    } catch (e: any) { setStatus(fail(e)); }
  }
  async function doAgent() {
    if (!arc) return;
    const v = agentInput.trim();
    if (!/^\d+$/.test(v)) { setIdStatus(failWith(msg("op.agent.bad", { v: agentInput }))); return; }
    setIdStatus(msg("op.agent.signing"));
    try {
      const hash = await sendTx(arc, testnet.operatorBond, operatorBondAbi, "setAgentId", [BigInt(v)]);
      setIdStatus(msg("op.agent.done", { id: v, tx: hash })); setAgentInput(""); refresh();
    } catch (e: any) { setIdStatus(fail(e)); }
  }
  async function retire(signer: Address) {
    if (!arc) return;
    setEncStatus(msg("op.retire.signing", { e: short(signer) }));
    try {
      const hash = await arc.retireEnclave(signer);
      setEncStatus(msg("common.withdrawSent"));
      await waitOk(arc, hash, "tx.retireEnclave");
      setEncStatus(msg("op.retire.done", { e: short(signer), tx: hash })); refresh();
    } catch (e: any) { setEncStatus(fail(e)); }
  }
  async function doRegister() {
    if (!arc) return;
    try {
      if (!/^\d+$/.test(productId.trim())) throw new MsgError(msg("bounty.badProduct", { v: productId }));
      const r = await registerMachineEnclave(arc, BigInt(productId.trim()), enclaveUrl.trim(), setRegStatus);
      setRegStatus(registeredMsg(r)); refresh();
    } catch (e: any) { setRegStatus(fail(e)); }
  }

  return (
    <>
      <PageHeader
        title={t("op.title")}
        lead={t("op.lead")}
        actions={<Btn kind="ghost" onClick={() => go("cles")}>{t("op.keysBtn")}</Btn>}
      />
      <div className="mb-5"><LevelsCard /></div>
      {!isConnected ? <NeedWallet what={t("op.need")} /> : (
        <>
          <Section>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label={t("op.stat.usdc")} value={usdc(bal)} />
              <Stat label={t("op.stat.bond")} value={usdc(bond)} tone={(bond ?? 0n) > 0n ? "good" : undefined} />
              <Stat label={t("op.stat.free")} value={usdc(free)} />
              <Stat label={t("op.stat.online")} value={machines ? `${machines.filter((m) => m.online).length} / ${machines.length}` : "—"} tone={machines?.some((m) => m.online) ? "good" : undefined} />
            </div>
          </Section>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div className="min-w-0 space-y-5">
              <Card title={t("op.bond.title")} sub={t("op.bond.sub")}>
                <Field label={t("field.amount")} value={bondAmt} onChange={setBondAmt} />
                <div className="mt-3"><Btn onClick={doBond} disabled={!arc?.wallet}>{t("op.bond.btn")}</Btn></div>
                {reserved > 0n && <p className="mt-2 text-[12px] text-muted">{t("op.bond.reserved", { amt: usdc(reserved) })}</p>}
                <div className="mt-4 border-t border-edge pt-3">
                  <div className="text-[13px] font-medium">{t("op.unbond.title")}</div>
                  <p className="mt-0.5 text-[12px] text-muted">{t("op.unbond.text")}</p>
                  {pending > 0n && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
                      <span>{t("op.unbond.pending", { amt: usdc(pending), when: unlocked ? t("op.unbond.now") : unlockAt ? t("op.unbond.on", { when: fmtUnix(unlockAt) }) : t("op.unbond.readingDelay") })}</span>
                      <Btn onClick={doWithdraw} disabled={!arc?.wallet || !unlocked}>{t("op.unbond.withdraw")}</Btn>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="w-32"><Field label={t("field.amount")} value={unbondAmt} onChange={setUnbondAmt} /></div>
                    <Btn kind="ghost" onClick={doUnbond} disabled={!arc?.wallet || !free}>{t("op.unbond.request")}</Btn>
                  </div>
                </div>
                <Status msg={status} />
              </Card>
              <Card title={t("op.id.title")} sub={t("op.id.sub")}>
                <div className="text-[13px]">
                  {agentId !== undefined && agentId > 0n
                    ? tx("op.id.linked", { id: <span className="font-mono">{t("op.id.number", { id: agentId.toString() })}</span> })
                    : <span className="text-muted">{agentId === undefined ? t("common.reading") : t("op.id.none")}</span>}
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="w-40"><Field label="agentId" value={agentInput} onChange={setAgentInput} placeholder={t("op.id.placeholder")} /></div>
                  <Btn kind="ghost" onClick={doAgent} disabled={!arc?.wallet || !agentInput.trim()}>{t("op.id.link")}</Btn>
                </div>
                <p className="mt-2 text-[12px] text-muted">
                  {tx("op.id.note", { link: <a className="text-accent hover:underline" href={addrLink(testnet.erc8004Identity)} target="_blank" rel="noreferrer">{t("op.id.registry")}</a> })}
                </p>
                <Status msg={idStatus} />
              </Card>
            </div>
            <AddMachine onPaired={refresh} />
          </div>

          <Section title={t("op.mach.title")} lead={t("op.mach.lead", { gas: dcapGasLabel() })}
            right={read
              ? <span className="text-[12px] text-muted">{t("op.mach.readUntil", { time: readUntil ? fmtTime(readUntil) : "—" })}</span>
              : <Btn kind="ghost" onClick={unlock} disabled={!arc?.wallet}>{t("op.mach.unlock")}</Btn>}>
            {!read && machines?.some((m) => m.hostnameHidden) && (
              <p className="mb-2 text-[12px] text-muted">{t("op.mach.masked")}</p>
            )}
            <Status msg={readMsg} />
            <Table head={[t("op.mach.h.machine"), t("op.mach.h.status"), t("op.mach.h.doctor"), t("op.mach.h.onArc"), t("op.mach.h.actions")]}
              empty={machines && machines.length === 0 ? <Empty>{t("op.mach.empty")}</Empty> : undefined}>
              {!machines && <tr><Td className="text-muted">{t("op.mach.loading")}</Td></tr>}
              {machines?.map((m) => <MachineRow key={m.machineId} m={m} origin={originOf(m)} onChanged={refresh} freeBond={free} minBond={minBondOf(m.productId)} access={access} />)}
            </Table>
          </Section>

          <Section title={t("op.enc.title")} lead={t("op.enc.lead")}>
            <Table head={[t("op.enc.h.enclave"), t("op.enc.h.product"), "TCB", t("op.enc.h.until"), t("bounties.h.status"), ""]}
              empty={mine && mine.length === 0 ? <Empty>{t("op.enc.empty")}</Empty> : undefined}>
              {!mine && <tr><Td className="text-muted">{t("hive.loading")}</Td></tr>}
              {mine?.map((e) => (
                <tr key={e.signer}>
                  <Td main><HexVal value={e.signer} n={6} /></Td>
                  <Td label={t("op.enc.h.product")}>#{e.productId.toString()}</Td>
                  <Td label="TCB">{e.tcbStatus === 0 ? <Badge tone="good">{t("op.enc.tcbOk")}</Badge> : <Badge tone="warn">{t("op.enc.advisory", { n: e.tcbStatus })}</Badge>}</Td>
                  <Td label={t("op.enc.h.until")} className="text-muted">
                    {e.untilBlock > 0n ? t("common.block", { n: fmtNum(e.untilBlock) }) : "—"}
                    <span className="block text-[12px]">{t("common.approx", { when: fmtUnix(e.expiresAt) })}</span>
                  </Td>
                  <Td label={t("bounties.h.status")}>{e.active ? <Badge tone="good">{t("common.active")}</Badge> : <Badge tone="muted">{t("common.inactive")}</Badge>}</Td>
                  <Td actions>{e.active && <Btn kind="danger" onClick={() => retire(e.signer)} disabled={!arc?.wallet}>{t("op.enc.retire")}</Btn>}</Td>
                </tr>
              ))}
            </Table>
            <Status msg={encStatus} />
          </Section>

          <details className="mb-8 rounded-xl border border-edge px-5 py-4">
            <summary className="cursor-pointer text-[14px] font-medium">{t("op.manual.title")}</summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label={t("op.manual.product")} value={productId} onChange={setProductId} />
              <Field label={t("op.manual.url")} value={enclaveUrl} onChange={setEnclaveUrl} hint={t("op.manual.urlHint")} />
            </div>
            <p className="mt-2 text-[12px] text-muted">{t("op.manual.note", { gas: dcapGasLabel() })}</p>
            <div className="mt-3"><Btn onClick={doRegister} disabled={!arc?.wallet}>{t("op.manual.go")}</Btn></div>
            <Status msg={regStatus} />
          </details>
        </>
      )}
      <Section title={t("op.rules.title")} lead={t("op.rules.lead")}>
        <ul className="grid gap-2 text-[13px] text-muted sm:grid-cols-2">
          <li className="rounded-lg border border-edge px-3 py-2.5"><span className="block text-text">{t("op.rules.cap")}</span>{t("op.rules.capText")}</li>
          <li className="rounded-lg border border-edge px-3 py-2.5"><span className="block text-text">{t("op.rules.delay")}</span>{t("op.rules.delayText")}</li>
          <li className="rounded-lg border border-edge px-3 py-2.5"><span className="block text-text">{t("op.rules.slash")}</span>{t("op.rules.slashText")}</li>
          <li className="rounded-lg border border-edge px-3 py-2.5"><span className="block text-text">{t("op.rules.machine")}</span>{t("op.rules.machineText")}</li>
        </ul>
      </Section>
    </>
  );
}

/** Nombre entier d'un champ (unité facturée, poids de sortie), borné. `what` : la clé de son nom ("what.billingUnit"…). */
function intField(v: string, what: StaticKey, max = 1_000_000): number {
  const s = v.trim();
  if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > max) throw new MsgError(msg("pub.badInt", { what: msg(what), v, max: () => fmtNum(max) }));
  return Number(s);
}

export function ProposeCard() {
  const arc = useArc();
  const [price, setPrice] = useState("0.0001");
  const [minBond, setMinBond] = useState("1");
  const [unitTokens, setUnitTokens] = useState("1");
  const [outWeight, setOutWeight] = useState("1");
  const [deterministic, setDeterministic] = useState(false);
  const [settlement, setSettlement] = useState<Address>(testnet.sessionPay);
  const [workloadId, setWorkloadId] = useState<Hex>(("0x" + "00".repeat(32)) as Hex);
  const [out, setOut] = useState<Msg | null>(null);

  async function propose() {
    if (!arc) return;
    try {
      const unit = intField(unitTokens, "what.billingUnit");
      const weight = intField(outWeight, "what.outWeight");
      if (!/^0x[0-9a-fA-F]{64}$/.test(workloadId)) throw new MsgError(msg("pub.badWorkload"));
      setOut(msg("pub.signing"));
      const r = await arc.proposeProduct({
        manifestHash: ("0x" + "11".repeat(32)) as Hex, manifestURI: "ipfs://demo", workloadIds: [workloadId],
        deterministic, price: parseUsdc(price, "what.price"), bpsOperator: 8000, bpsAuthor: 1000, bpsNetwork: 1000,
        minBond: parseUsdc(minBond, "what.minBond"), exposureCap: parseUsdc("1000000", "what.cap"), settlement, param: ("0x" + "00".repeat(32)) as Hex, advisoryIds: [],
        unitTokens: unit, outWeight: weight,
      });
      setOut(msg("pub.proposed", { id: r.productId }));
      const rcpt = await waitOk(arc, r.tx, "tx.proposeProduct");
      const ev = parseEventLogs({ abi: productRegistryAbi, logs: rcpt.logs, eventName: "ProductProposed" })[0];
      const id = ev ? ev.args.productId : r.productId;
      const at = ev ? BigInt(ev.args.activatesAt) : 0n;
      const blockTime = (await arc.pub.getBlock()).timestamp;
      if (at > blockTime) {
        setOut(msg("pub.later", { id, when: () => fmtUnix(at) }));
        return;
      }
      setOut(msg("pub.activating", { id }));
      const hash = await arc.activateProduct(id);
      await waitOk(arc, hash, "tx.activateProduct");
      setOut(msg("pub.done", { id, tx: hash }));
    } catch (e: any) { setOut(fail(e)); }
  }

  return (
    <Card title={t("pub.card.title")} sub={t("pub.card.sub")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("pub.f.price")} value={price} onChange={setPrice} />
        <Field label={t("pub.f.minBond")} value={minBond} onChange={setMinBond} />
        <Field label={t("pub.f.unit")} value={unitTokens} onChange={setUnitTokens} hint={t("pub.f.unitHint")} />
        <Field label={t("pub.f.weight")} value={outWeight} onChange={setOutWeight} hint={t("pub.f.weightHint")} />
        <Field label={t("pub.f.workload")} value={workloadId} onChange={(v) => setWorkloadId(v as Hex)} />
        <label className="block">
          <span className="text-[13px] text-muted">{t("pub.f.mode")}</span>
          <select className="mt-1 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-[13px]" value={settlement} onChange={(e) => setSettlement(e.target.value as Address)}>
            <option value={testnet.sessionPay}>{t("pub.f.mode.session")}</option>
            <option value={testnet.x402Settler}>{t("pub.f.mode.x402")}</option>
            <option value={testnet.sealedBounty}>{t("pub.f.mode.bounty")}</option>
            {testnet.levels && <option value={testnet.levels.sealedBountyVerified}>{t("pub.f.mode.bountyVerified")}</option>}
          </select>
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px] text-muted">
        <input type="checkbox" checked={deterministic} onChange={(e) => setDeterministic(e.target.checked)} /> {t("pub.f.deterministic")}
      </label>
      <div className="mt-4"><Btn onClick={propose} disabled={!arc?.wallet}>{t("pub.go")}</Btn></div>
      <Status msg={out} />
    </Card>
  );
}
