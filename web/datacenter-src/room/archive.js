/* the archive: find any rack or transaction the room has seen, and each rack's own history on Arc */
const REGISTER_KEYS = { ProductProposed: 'product_proposed', ProductActivated: 'product_activated', WorkloadRetired: 'image_retired', WorkloadAdded: 'image_allowed', WorkloadProposed: 'image_proposed', ProductUpdated: 'product_update', ProductUpdateProposed: 'product_update', ManifestURIUpdated: 'manifest_update', ManifestURIUpdateProposed: 'manifest_update', BondReserved: 'bond_reserved', BondReleased: 'bond_released', UnbondRequested: 'unbond', MachineBound: 'machine_bound', ExposureConsumed: 'exposure', EnclaveImage: 'image' };
/* the sentence the ticker shows for a transaction, as when it plays */
function beatCaption(b) {
  const m = b.main; const a = m.a || {};
  const P = (b.evs.find((e) => e.p) || {}).p;
  const vars = { pod: b.pod ? short(b.pod) : '', product: P ? productName(P) : '', amount: '', reason: a.reason, verdict: a.response };
  const usdc = (name, key) => fmtUsdc(sumAmount(b, name, key));
  switch (m.n) {
    case 'EnclaveRegistered': {
      const first = BEATS.find((x) => x.main.n === 'EnclaveRegistered' && x.pod && lc(x.pod) === lc(b.pod));
      return caption(first === b ? 'register' : 'renew', vars);
    }
    case 'EnclaveInvalidated': return caption('invalidated', vars);
    case 'EnclaveRetired': return caption('retired', vars);
    case 'CallSettled': return caption('call_settled', { ...vars, amount: usdc('CallSettled', 'amount') });
    case 'SessionOpened': return caption('session_opened', { ...vars, amount: fmtUsdc(Number(a.deposit || 0) / 1e6) });
    case 'Settled': return caption('settled', { ...vars, amount: usdc('Settled', 'paidDelta') });
    case 'SessionClosed': return caption('session_closed', { ...vars, amount: fmtUsdc(Number(a.refund || 0) / 1e6) });
    case 'BountyCreated': return caption('bounty_created', { ...vars, amount: fmtUsdc(Number(a.funding || 0) / 1e6) });
    case 'ClaimAccepted': return caption('claim_accepted', vars);
    case 'ExploitDelivered': case 'BountyPaid': {
      const paid = sumAmount(b, 'BountyPaid', 'amount');
      return paid ? caption('bounty_paid', { ...vars, amount: fmtUsdc(paid) }) : caption('exploit_delivered', vars);
    }
    case 'ClaimRefuted': return caption('claim_refuted', vars);
    case 'Bonded': return caption('bond_posted', { ...vars, amount: usdc('Bonded', 'amount') });
    case 'Slashed': return caption('slashed', { ...vars, amount: usdc('Slashed', 'amount') });
    case 'Recorded': return caption(Number(a.response) >= 50 ? 'verdict_ok' : 'verdict_bad', vars);
    case 'ProofOfCloudToken': return caption('poc_token', vars);
    case 'MachineAttested': return caption('poc_token', vars);
    case 'PolicyApplied': case 'PolicyProposed': return caption('policy', vars);
    default: return caption(REGISTER_KEYS[m.n] || 'admin', vars);
  }
}
/* one transaction: what happened, when, and its link to the explorer */
function txRow(b, inCard) {
  const row = el('div', { class: 'row' });
  const dot = el('i'); dot.style.background = EV_COLOR[b.main.k] || '#A6AED0';
  const body = el('div');
  const pod = b.pod ? pods.get(b.pod) : null;
  const what = el(inCard || !pod ? 'span' : 'button', inCard || !pod ? { class: 'what' } : { type: 'button', class: 'what' }, beatCaption(b));
  if (!inCard && pod) what.addEventListener('click', () => openRack(pod.id));
  /* the separator has its own span (touch screens move the link to the right of the line, as a 44 px arrow) */
  const meta = el('small', {}, fmtDate(b.t));
  meta.appendChild(el('span', { class: 'sep' }, ' · '));
  const a = el('a', { href: `${EXPLORER}/tx/${b.tx}`, target: '_blank', rel: 'noopener' }, short(b.tx) + ' ↗');
  meta.appendChild(a);
  body.append(what, meta); row.append(dot, body);
  return row;
}
/* one rack: its key, its service and its state */
function rackRow(info) {
  const pod = pods.get(info.id);
  /* the state the chain reports now, never the replay's (otherwise a live rack reads "Retired" during a replay) */
  const truth = info.active ? 'live' : (info.fault || []).length ? 'fault' : 'retired';
  const st = director.mode === 'replay' || !pod ? truth : info.active && pod.state === 'session' ? 'session' : truth;
  const row = el('div', { class: 'row' });
  const dot = el('i'); dot.style.background = STATE_HEX[st] || '#7B8194';
  const body = el('div');
  const what = el('button', { type: 'button', class: 'what' }, tr('pod.title', { short: short(info.id) }));
  what.addEventListener('click', () => openRack(info.id));
  const label = tr(`pod.statuses.${st === 'retired' && String(info.status || '').startsWith('expired') ? 'expired' : st}`) || st;
  body.append(what, el('small', {}, `${productName(info.product)} · ${label}`)); row.append(dot, body);
  return row;
}
function openRack(id) {
  const pod = pods.get(id); if (!pod) return;
  director.follow = false;
  if (pod.shown) focus('pod', pod);
  openPanel('pod', id);
}
/* the card's history: the rack's transactions on Arc, newest first */
function rackHistory(info) {
  const box = el('div', { class: 'hist' });
  const mine = BEATS.filter((b) => b.pod && lc(b.pod) === lc(info.id));
  if (!mine.length) return box;
  box.appendChild(el('h3', {}, `${tr('pod.history')} · ${mine.length === 1 ? tr('pod.historyCount1') : tr('pod.historyCount', { n: mine.length })}`));
  const rows = el('div', { class: 'rows' });
  for (const b of mine.slice(-5).reverse()) rows.appendChild(txRow(b, true));
  box.appendChild(rows);
  return box;
}
/* Find: by key, operator, chip, service or transaction hash; empty, it lists the racks in service and the latest transactions */
function findPanel(p, q0) {
  panelHead(tr('find.title'));
  const inp = el('input', { type: 'search', class: 'find', placeholder: tr('find.placeholder'), 'aria-label': tr('find.title'), autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  inp.value = q0 || '';
  const out = el('div', { class: 'found', 'aria-live': 'polite' });
  p.append(inp, el('p', { class: 'muted small' }, tr('find.hint', { n: fmtInt(BEATS.length) })), out);
  const section = (title, rows) => { out.appendChild(el('h3', {}, title)); const r = el('div', { class: 'rows' }); for (const x of rows) r.appendChild(x); out.appendChild(r); };
  const render = () => {
    const q = inp.value.trim().toLowerCase();
    if (panelState && panelState.kind === 'find') panelState.arg = inp.value;
    out.innerHTML = '';
    let racks = [], txs = [];
    if (q) {
      racks = DATA.pods.filter((info) => [info.id, info.operator, info.ppid, productName(info.product)].map(lc).join(' ').includes(q));
      for (let i = BEATS.length - 1; i >= 0 && txs.length < 8; i--) { const b = BEATS[i]; if (lc(b.tx).includes(q)) txs.push(b); }
    } else {
      racks = DATA.pods.filter((info) => info.active);
      txs = BEATS.slice(-6).reverse();
    }
    if (racks.length) section(tr(q ? 'find.racks' : 'find.live'), racks.slice(0, 8).map(rackRow));
    if (txs.length) section(tr(q ? 'find.txs' : 'find.recent'), txs.map((b) => txRow(b, false)));
    if (!racks.length && !txs.length) out.appendChild(el('p', { class: 'muted' }, tr('find.none')));
  };
  inp.addEventListener('input', render);
  render();
  if (matchMedia('(pointer: fine)').matches) setTimeout(() => inp.focus({ preventScroll: true }), 40);
}

