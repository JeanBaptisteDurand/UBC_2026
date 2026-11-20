/* live: the room follows Arc as it happens.
   Served over HTTP (ArcHive's own site, or any static host: the read API answers with CORS open), it reads the API on
   load and every 20 s. A new enclave key gets its rack, and each new event plays as it happens, stamped with the real
   time of its block. Opened as a file, or when the API cannot be reached, the room shows the recorded state. */
const RPC = (DATA.chain && DATA.chain.rpc) || 'https://rpc.testnet.arc.io';
const KIND = {
  EnclaveRegistered: 'attest', EnclaveImage: 'attest', MachineBound: 'attest', EnclaveInvalidated: 'fault', EnclaveRetired: 'retire',
  BondReserved: 'bond', BondReleased: 'bond', ExposureConsumed: 'bond', Bonded: 'bond', UnbondRequested: 'bond', Slashed: 'fault',
  CallSettled: 'pay', Settled: 'pay', BountyPaid: 'pay', SessionOpened: 'session', SessionClosed: 'session',
  BountyCreated: 'bounty', ClaimAccepted: 'bounty', ExploitDelivered: 'bounty', ClaimRefuted: 'fault', Recorded: 'verdict',
  MachineAttested: 'level', ProofOfCloudToken: 'level', PolicyProposed: 'level', PolicyApplied: 'level',
};
const kindOf = (c, n) => KIND[n] || (c === 'ProductRegistry' ? 'product' : 'admin');
const lc = (a) => String(a == null ? '' : a).toLowerCase();
const keyOf = (e) => `${lc(e.tx)}:${Number(e.li)}`;
const known = new Set(DATA.timeline.map(keyOf));
const isoOf = (s) => (Number(s) > 0 ? new Date(Number(s) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);
const canLive = () => location.protocol !== 'file:';
const MINOR = ['SettlementAuthorized', 'SettlementProposed', 'CallerProposed', 'CallerAuthorized', 'AgentIdSet', 'ExposureConsumed', 'BondReserved', 'BondReleased', 'MachineBound', 'EnclaveImage'];
const liveQueue = [];
let liveBusy = false, livePolling = false, liveStats = null, bootClosed = false, liveBusySince = 0;
/* the counters of the status bar (net) follow the API as soon as it answers, in the "now" view, whatever is playing:
   the recorded numbers of 12 Nov never stay under a "live" badge, even while a beat keeps liveBusy set */
function applyLiveCounters(S) {
  if (!S) return;
  Object.assign(DATA.stats, S);
  if (director.mode !== 'now') return;
  Object.assign(net, {
    paid: Number(S.settledUsdc) / 1e6, sessionPaid: Number(S.sessionSettledUsdc) / 1e6, refunded: Number(S.refundedUsdc) / 1e6,
    calls: Number(S.x402Calls), callsUsdc: Number(S.x402SettledUsdc) / 1e6, sessions: Number(S.sessions), verdicts: Number(S.verdicts),
    bountyPool: Number(S.bountyPool) / 1e6, bountiesPaid: Number(S.bountiesPaid), bountyPaid: Number(S.bountyPaidUsdc) / 1e6,
  });
}
/* a zone's fact read live from the API (the recorded facts date from 12 Nov); empty when the page shows the recorded
   state, and the recorded fact is shown instead */
function liveZoneFact(zone) {
  const S = liveStats;
  if (!director.liveOk || !S) return '';
  const n = (x) => fmtInt(Number(x || 0)), u = (x) => fmtUsdc(Number(x || 0) / 1e6);
  return tr(`zones.${zone}.liveFact`, {
    enclaves: n(S.enclaves), active: n(S.enclavesActive), verdicts: n(S.verdicts), calls: n(S.x402Calls), sessions: n(S.sessions),
    settled: u(S.settledUsdc), bountiesPaid: n(S.bountiesPaid), bountyPaid: u(S.bountyPaidUsdc), refuted: n(S.claimsRefuted),
    slashed: u(S.bondSlashedUsdc), bonded: u(S.bondPostedUsdc), bounties: n(S.bounties), open: n(S.bountiesOpen),
  }) || '';
}

async function getJson(path, ms = 5000) {
  const r = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(ms), cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
function podInfoOf(id) { const k = lc(id); return k ? DATA.pods.find((p) => lc(p.id) === k) || null : null; }
function bountyProduct(id) { const b = (DATA.bounties || []).find((x) => String(x.id) === String(id)); return b ? String(b.productId) : null; }

/* the real time of each block, from Arc's public RPC (one batched call); an estimate from the last known block otherwise */
async function blockTimes(blocks) {
  const out = new Map();
  const list = [...new Set(blocks)].slice(0, 50);
  if (!list.length) return out;
  try {
    const body = list.map((b, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getBlockByNumber', params: ['0x' + b.toString(16), false] }));
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    for (const x of Array.isArray(j) ? j : []) if (x && x.result && x.result.timestamp) out.set(list[x.id], parseInt(x.result.timestamp, 16));
  } catch { /* estimated below */ }
  return out;
}

/* the API's newest events that the room has not seen yet, in the timeline's own shape, oldest first */
async function freshEvents(activity) {
  const ref = DATA.timeline[DATA.timeline.length - 1] || { b: 0, t: Math.floor(Date.now() / 1000) };
  const raw = (activity || [])
    .filter((e) => Number(e.block) > ref.b && !known.has(`${lc(e.tx)}:${Number(e.logIndex)}`))
    .sort((a, b) => Number(a.block) - Number(b.block) || Number(a.logIndex) - Number(b.logIndex));
  if (!raw.length) return [];
  const times = await blockTimes(raw.map((e) => Number(e.block)));
  const spb = Number((DATA.chain || {}).secPerBlock) || 0.5086;
  return raw.map((ev) => {
    const a = {};
    for (const [k, v] of Object.entries(ev.args || {})) if (v == null || typeof v !== 'object') a[k] = v;
    const b = Number(ev.block);
    const p = a.productId != null ? String(a.productId) : a.bountyId != null ? bountyProduct(a.bountyId) : null;
    let e = a.signer || null;
    if (!e && ev.name === 'CallSettled') {
      const q = DATA.pods.find((x) => x.active && String(x.product) === p && lc(x.operator) === lc(a.operator));
      e = q ? q.id : null;
    }
    const info = e ? podInfoOf(e) : null; if (info) e = info.id;
    return { t: times.get(b) || Math.round(ref.t + (b - ref.b) * spb), b, tx: ev.tx, li: Number(ev.logIndex), c: ev.contract, n: ev.name, k: kindOf(ev.contract, ev.name), p, e, a, live: true };
  });
}

/* every key the registry knows: states, dates and levels refreshed, new keys added (with a rack when the room is built) */
function mergeEnclaves(list, levels, built, quiet) {
  const lv = new Map(((levels && levels.enclaves) || []).map((x) => [lc(x.signer), x]));
  for (const x of list || []) {
    const L = lv.get(lc(x.signer));
    const reg = isoOf(x.registeredAt), exp = isoOf(x.expiresAt);
    let info = podInfoOf(x.signer);
    if (!info) {
      info = {
        id: x.signer, short: short(x.signer), product: String(x.productId), operator: x.operator, active: !!x.active,
        status: x.active ? 'active' : 'expired (registration not renewed)', fault: [], level: L ? L.level : null, ppid: L ? L.ppid : null,
        last: reg, first: reg, expires: exp, regs: 1, workload: short(String(x.workloadId || '')), bond: null, end: null, health: null, live: true,
        /* while the page is open, a new key waits (up to a minute) for its registration to play as an arrival */
        pending: built && !quiet ? Date.now() : 0,
      };
      if (built) addPod(info); else DATA.pods.push(info);
      continue;
    }
    info.active = !!x.active;
    if (reg) info.last = reg;
    if (exp) info.expires = exp;
    if (L && L.level) info.level = L.level;
    if (L && L.ppid) info.ppid = L.ppid;
    if (x.active) info.status = 'active';
    else if (info.status === 'active') info.status = 'expired (registration not renewed)';
  }
}
/* new events join the timeline (so a replay includes them) and update the cards they concern */
function absorb(fresh) {
  for (const e of fresh) {
    DATA.timeline.push(e); known.add(keyOf(e));
    const info = e.e ? podInfoOf(e.e) : null;
    if (!info) continue;
    if (e.n === 'EnclaveInvalidated') info.status = `invalidated (${(e.a || {}).reason || 'workload-retired'})`;
    if (e.n === 'EnclaveRetired') info.status = 'retired by its operator';
    if (e.n === 'EnclaveRegistered') info.regs = DATA.timeline.filter((x) => x.n === 'EnclaveRegistered' && lc(x.e) === lc(info.id)).length;
  }
}
const waiting = (info) => !!info.pending && Date.now() - info.pending < 60000;
/* a key that appears while the page is open gets its own rack */
function addPod(info) {
  DATA.pods.push(info);
  const pod = makePod(info); pods.set(info.id, pod);
  const s = takeSocket(); if (s) PLAN.set(info.id, s);
  return pod;
}

/* on load, before the room is built: the recorded history plus everything that happened since */
async function liveBoot() {
  director.liveOk = false;
  if (!canLive()) return;
  try {
    const [idx, stats, encl, levels, act] = await Promise.all([
      getJson('index', 8000), getJson('stats', 8000), getJson('enclaves', 8000), getJson('levels', 8000).catch(() => null), getJson('activity?limit=100', 8000),
    ]);
    if (bootClosed) {
      /* the room was built without waiting for the API: the live data joins through the regular refresh */
      director.liveOk = true; director.liveHead = Number(idx.head); director.liveAt = performance.now();
      refreshLive({ quiet: true }); return;
    }
    mergeEnclaves(encl, levels, false);
    /* Arc's real pace (seconds per block), measured between the last recorded event and the head now */
    const ref = DATA.timeline[DATA.timeline.length - 1];
    const pace = ref && Number(idx.head) - ref.b > 1000 ? (Date.now() / 1000 - ref.t) / (Number(idx.head) - ref.b) : 0;
    if (pace > 0.1 && pace < 5) DATA.chain.secPerBlock = Number(pace.toFixed(4));
    const fresh = await freshEvents(act);
    absorb(fresh);
    liveStats = stats; applyLiveCounters(stats);
    director.liveOk = true; director.liveHead = Number(idx.head); director.liveAt = performance.now();
  } catch (err) { console.warn('ArcHive live data unavailable, showing the recorded state:', String(err && err.message || err)); director.liveOk = false; }
}
/* kept for older callers: the probe now happens in liveBoot */
async function probeLive() { refreshHud(); }

/* every 20 s: new keys, new events (queued and played in order), then the state the chain reports */
async function refreshLive({ quiet = false } = {}) {
  if (!director.liveOk || livePolling) return;
  /* a beat that never finished (an animation stalled in a hidden tab) must not freeze the live room: after a minute,
     the queue is dropped and the room settles on the chain's state */
  if (liveBusy && Date.now() - liveBusySince > 60000) { liveBusy = false; liveQueue.length = 0; }
  livePolling = true;
  try {
    const [idx, stats, encl, levels, act] = await Promise.all([
      getJson('index'), getJson('stats'), getJson('enclaves'), getJson('levels').catch(() => null), getJson('activity?limit=40'),
    ]);
    director.liveHead = Number(idx.head); director.liveAt = performance.now();
    mergeEnclaves(encl, levels, true, quiet);
    const fresh = await freshEvents(act);
    if (fresh.length) {
      const first = DATA.timeline.length;
      absorb(fresh);
      BEATS = buildBeats();
      if (director.mode === 'now' && !quiet) {
        liveQueue.push(...BEATS.filter((b) => b.idx >= first));
        toast(fresh.length === 1 ? tr('toasts.liveNew1') : tr('toasts.liveNew', { n: fresh.length }));
      } else if (director.mode === 'now' && !liveBusy) {
        /* joined quietly (on load, or after the API came back): the ticker shows the newest events, not 12 Nov's */
        showLatestTicks();
      }
    }
    liveStats = stats;
    applyLiveCounters(stats);
    director.liveStamp = Date.now();
    if (director.mode === 'now') { if (liveQueue.length) drainLive(); else if (!liveBusy) settleLive(); }
  } catch { /* keep the last good state */ } finally { livePolling = false; }
  refreshHud();
}
/* the API did not answer on load: try again every 20 s, and join quietly when it does */
let liveRetrying = false;
async function liveRetry() {
  if (liveRetrying || director.liveOk || !canLive()) return;
  liveRetrying = true;
  try {
    const idx = await getJson('index', 8000);
    director.liveOk = true; director.liveHead = Number(idx.head); director.liveAt = performance.now();
    await refreshLive({ quiet: true });
  } catch { /* still unreachable: next try in 20 s */ } finally { liveRetrying = false; }
}
/* plays the queued live beats one by one, the camera following unless the viewer turned it off or reads a card */
async function drainLive() {
  if (liveBusy) return;
  liveBusy = true; liveBusySince = Date.now();
  try {
    while (liveQueue.length) {
      if (director.mode !== 'now' || tourStep >= 0) { liveQueue.length = 0; break; }
      const b = liveQueue.shift();
      const pend = b.pod ? podInfoOf(b.pod) : null; if (pend) pend.pending = 0;
      const minor = MINOR.includes(b.main.n);
      director.follow = store.get('follow') !== '0' && !panelState;
      await playBeat(b, { fast: minor, camera: !minor });
      await wait(minor ? 0.1 : 0.6);
    }
  } finally { liveBusy = false; director.follow = false; }
  settleLive();
}
/* the room as the chain reports it now: racks seated, lights set, counters from the API */
function settleLive() {
  if (director.mode !== 'now' || liveBusy) return;
  applyLiveCounters(liveStats);
  for (const info of DATA.pods) {
    const pod = pods.get(info.id); if (!pod) continue;
    const s = PLAN.get(info.id);
    if (waiting(info)) continue;
    if (s && !pod.shown) seatPod(pod, s);
    if (!s && pod.shown) { pod.grp.visible = false; pod.shown = false; }
    if (!pod.shown) continue;
    const fault = (info.fault || []).length > 0;
    const want = info.active ? (pod.state === 'session' ? 'session' : 'live') : fault ? 'fault' : 'retired';
    if (pod.state !== want) setPodState(pod, want);
    pod.verified = info.level === 'verified';
  }
  setClock(Math.floor(Date.now() / 1000));
  refreshHud();
}

