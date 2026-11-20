# Turn the engine page (base.template.html) into the server room: swap in the room's blocks (room/*.js) and apply the
# room's patches. Each patch checks that its text is there, most of them exactly once, so a change in the engine stops
# the build instead of being lost.
# usage: make_room.py <this folder> <out file>
import os, sys
R, OUT = sys.argv[1], sys.argv[2]
s = open(os.path.join(R, 'base.template.html'), encoding='utf-8').read()
rd = lambda n: open(os.path.join(R, 'room', n), encoding='utf-8').read()
def between(text, a, b, new):
    i = text.index(a); j = text.index(b, i)
    return text[:i] + new + text[j:]
def rep(text, a, b, n=1):
    assert text.count(a) == n, (a[:60], text.count(a)); return text.replace(a, b)
s = rep(s, '<title>ArcHive Base</title>', '<title>ArcHive Datacenter</title>')
s = rep(s, "A live 3D base built from Kenney's Space Kit: every pod is a real ArcHive enclave on Arc testnet. Replay the network's real history, then explore its state.", "A live 3D server room: every rack is a real ArcHive enclave on Arc testnet. Take the tour, replay the network's real history, then explore its state.")
s = rep(s, 'aria-label="3D base: hexagonal pods are real ArcHive enclaves on Arc testnet"', 'aria-label="3D server room: every rack is a real ArcHive enclave on Arc testnet"')
s = rep(s, '<div class="brand glass" aria-label="ArcHive Base">', '<div class="brand glass" aria-label="ArcHive Datacenter">')
s = rep(s, "const packs = [['space', 'm/space.json', ''], ['chars', 'm/chars.json', 'm/chars/']];", "const packs = ['factory', 'station', 'shop', 'space', 'chars'].map((k) => [k, `m/${k}.json`, `m/${k}/`]);")
s = rep(s, "function place(name, x, z, { rot = 0, s = 1, y = 0, parent = scene, shadow = true, clone = true } = {}) {", "function place(name, x, z, { rot = 0, s = 1, sy, y = 0, parent = scene, shadow = true, clone = true } = {}) {")
s = rep(s, "const inner = new THREE.Group(); inner.add(c); inner.scale.setScalar(s);", "const inner = new THREE.Group(); inner.add(c); inner.scale.set(s, sy ?? s, s);")
s = between(s, '/* =================================================================== 4. the island and the zones */', '/* =================================================================== 7. effects */', rd('world.js') + '\n')
s = between(s, '/* =================================================================== 8. characters */', "/* =================================================================== 10. the network's state, rebuilt from events */", rd('actors.js') + '\n')
s = between(s, '/* the choreography of each kind of beat */', '/* =================================================================== 12. the director: replay, then the state now */', rd('choreo.js'))
s = between(s, 'const PRESET = {', 'let lastFocusAt', rd('extra.js'))
s = between(s, "/* x-ray: see through one pod's dome to the sealed core */", '/* =================================================================== 16. picking */', rd('xray.js'))
s = rep(s, "updateLayers(dt);\n  updateConfetti(dt);", "updateLayers(dt);\n  rackTick(dt);\n  updateConfetti(dt);")
s = rep(s, "for (let i = 0; i < 260; i++)", "for (let i = 0; i < 0; i++)")
s = rep(s, "  if (boardBlock) boardBlock.userData.set('');\n  updateReplayButton();", "  if (boardBlock) boardBlock.userData.set('');\n  for (const mb of menuBoards) mb.userData.redraw();\n  updateReplayButton();")
s = rep(s, '<p id="load-text">Landing on the base</p>', '<p id="load-text">Opening the server room</p>')
s = rep(s, "tr('errors.models') || 'The base could not load its 3D models.'", "tr('errors.models') || 'The server room could not load its 3D models.'")
s = rep(s, '/* the overview frames the island and the model gateway, leaving room for the HUD */', '/* the overview frames the whole room, leaving space for the HUD */')
s = rep(s, "a pod forwards your question", "the enclave forwards your question")
s = rep(s, "The pod checks that gateway", "The enclave checks that gateway")
s = rep(s, "un module transmet votre question", "l'enclave transmet votre question")
s = rep(s, "Le module vérifie cette passerelle", "L'enclave vérifie cette passerelle")
s = rep(s, "  if (boardBlock) { boardBlock.userData.set(''); refreshHud(); }", "  if (boardBlock) { boardBlock.userData.set(''); refreshHud(); }\n  for (const mb of menuBoards) mb.userData.redraw();")
# --- the live room (new keys get a rack, new events play as they happen) and the archive (Find, rack history)
s = between(s, '/* live: works when the page is served', '/* =================================================================== 13. camera', rd('live.js'))
s = rep(s, "  await loadPacks();\n  buildWorld();", "  await Promise.all([loadPacks(), liveBoot()]);\n  buildWorld();")
s = rep(s, "  applyWords();\n  probeLive();\n", "  applyWords();\n")
s = rep(s, "/* panels: pod card, zone popup, legend, about, settings */", rd('archive.js') + "/* panels: pod card, zone popup, legend, about, settings */")
s = rep(s, "    const a = el('a', { class: 'link', href: `${EXPLORER}/address/${info.id}`, target: '_blank', rel: 'noopener' }, tr('pod.explorer') + ' ↗');\n    p.appendChild(a);",
        "    p.appendChild(rackHistory(info));\n    const a = el('a', { class: 'link', href: `${EXPLORER}/address/${info.id}`, target: '_blank', rel: 'noopener' }, tr('pod.explorer') + ' ↗');\n    p.appendChild(a);")
s = rep(s, "  } else if (kind === 'zone') {", "  } else if (kind === 'find') {\n    findPanel(p, arg);\n  } else if (kind === 'zone') {")
s = rep(s, "    for (const t of tr('about.paras') || []) p.appendChild(el('p', {}, t));\n    p.appendChild(el('p', { class: 'fact' }, `${tr('status.stale', { time: fmtDate(isoToUnix(DATA.capturedAt)) })} · ${DATA.timeline.length} events`));",
        "    (tr('about.paras') || []).forEach((t, i) => p.appendChild(el('p', {}, director.liveOk && i === 1 ? tr('about.liveReplay', { n: fmtInt(DATA.timeline.length) }) : director.liveOk && i === 2 ? tr('about.live') : t)));\n    p.appendChild(el('p', { class: 'fact' }, `${director.liveOk ? tr('status.live') : tr('status.stale', { time: fmtDate(isoToUnix(DATA.capturedAt)) })} · ${tr('about.events', { n: fmtInt(DATA.timeline.length) })}`));")
s = rep(s, '<button class="ibtn" id="btn-legend"', '<button class="ibtn" id="btn-find" type="button" aria-label="Find"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg></button>\n  <button class="ibtn" id="btn-legend"')
s = rep(s, "$('#btn-lang').addEventListener('click'", "$('#btn-find').addEventListener('click', () => (panelState && panelState.kind === 'find' ? closePanel() : openPanel('find', '')));\n$('#btn-lang').addEventListener('click'")
s = rep(s, "  $('#btn-settings').setAttribute('aria-label', tr('buttons.settings'));", "  $('#btn-settings').setAttribute('aria-label', tr('buttons.settings'));\n  $('#btn-find').setAttribute('aria-label', tr('buttons.find'));")
s = rep(s, "addEventListener('keydown', (e) => {\n", "addEventListener('keydown', (e) => {\n  if (e.key === '/' && tourStep < 0 && !/^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) { e.preventDefault(); openPanel('find', ''); return; }\n")
s = rep(s, "/* tour card */", """.panel input.find { width: 100%; box-sizing: border-box; margin: 2px 0 8px; padding: 10px 12px; border-radius: 11px; border: 1px solid var(--line); background: rgba(190, 200, 255, .08); color: var(--text); font: inherit; font-size: 14px; }
.panel input.find::placeholder { color: var(--muted); }
.panel input.find:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.panel .small { font-size: 12.5px; }
.panel h3 { margin: 14px 0 6px; font-size: 12.5px; font-weight: 700; color: var(--muted); }
.panel .rows { display: flex; flex-direction: column; gap: 2px; }
.panel .row { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 9px; align-items: start; padding: 5px 2px; }
.panel .row > i { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; }
.panel .row .what { display: block; padding: 0; border: 0; background: none; color: var(--text); text-align: left; font: inherit; font-size: 13.5px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.panel .row button.what { cursor: pointer; }
.panel .row button.what:hover, .panel .row button.what:focus-visible { color: var(--accent); }
.panel .row small { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; font-variant-numeric: tabular-nums; }
.panel .row small a { color: var(--muted); }
.panel .hist { margin: 4px 0 8px; }

/* tour card */""")
s = rep(s, "window.__base = { scene, camera, renderer, pods, net, director, view, startReplay, endReplay, focus, openPanel, get tourStep() { return tourStep; } };",
        "window.__base = { scene, camera, renderer, pods, net, director, view, startReplay, endReplay, focus, openPanel, refreshLive, liveQueue, DATA, get BEATS() { return BEATS; }, get tourStep() { return tourStep; }, debug: { arrive, serve, machineArrives, clientLeaves, swingDoor, PLAN: () => PLAN, sockets, crew: () => crew, client: () => client } };")
s = rep(s, "    if (!pod || !s) continue;\n    seatPod(pod, s);", "    if (!pod || !s || waiting(info)) continue;\n    seatPod(pod, s);")
s = rep(s, "      if (fresh) { go('pad'); pushTick('attest', caption('register', vars), b); await arrive(pod, fast); }\n      else if (pod) { pushTick('attest', caption('renew', vars), b); await renew(pod, fast); }",
        "      /* the first registration of a key always reads as its arrival, even if its rack was already seated */\n      const firstReg = !!pod && BEATS.find((x) => x.main.n === 'EnclaveRegistered' && x.pod === b.pod) === b;\n      if (fresh) { go('pad'); pushTick('attest', caption('register', vars), b); await arrive(pod, fast); }\n      else if (pod) { pushTick('attest', caption(firstReg ? 'register' : 'renew', vars), b); await renew(pod, fast); }")
s = rep(s, """  clearTicks();
  const recent = BEATS.slice(-4);
  for (const b of recent) {
    const pod = b.pod ? pods.get(b.pod) : null; const m = b.main;
    const key = m.n === 'EnclaveRegistered' ? 'renew' : m.n === 'MachineBound' ? 'machine_bound' : m.n === 'EnclaveImage' ? 'image' : null;
    if (key) pushTick('attest', caption(key, { pod: pod ? short(pod.id) : short(b.pod || ''), product: '' }), b);
  }""", """  clearTicks();
  for (const b of BEATS.slice(-4)) pushTick(b.main.k || 'attest', beatCaption(b), b);""")
s = rep(s, "    if (director.mode !== 'now' || tok !== director.tok) return;\n    applySnapshotState();", "    if (director.mode !== 'now' || tok !== director.tok || liveBusy) return;\n    applySnapshotState();")
s = rep(s, "Math.floor((performance.now() - director.liveAt) / 1000 / 0.5086)", "Math.floor((performance.now() - director.liveAt) / 1000 / ((DATA.chain && DATA.chain.secPerBlock) || 0.5086))")
# --- the story: clients ask at the counter, the request goes to the back, a technician starts the enclave
s = rep(s, "const TOUR_FOCUS = ['overview', 'pad', 'gate', 'pod', 'layers', 'dock', 'lab', 'overview'];", "const TOUR_FOCUS = ['overview', 'dock', 'noc', 'pod', 'layers', 'dish', 'lab', 'overview'];")
s = rep(s, "  if (f !== 'pod') focus(f);\n}", "  if (f !== 'pod') focus(f);\n  tourDemo(f);\n}")
assert "if (fresh) { go('pad');" in s
s = s.replace("if (fresh) { go('pad');", "if (fresh) { go('noc');")
assert s.count("badge(V3(0, 1.25, 0)") >= 2
s = s.replace("badge(V3(0, 1.25, 0)", "badge(V3(0, 1.95, 0)")
s = rep(s, "      if (sp) await serve(sp, { amount: 0, ai: true, fast, rounds: 2 });", "      if (sp) await serve(sp, { amount: 0, ai: true, fast, rounds: 2, leave: false });")
s = rep(s, "      if (sp) { if (sp.state === 'session') setPodState(sp, 'live'); net.openSessions.delete((m.a || {}).sessionId); }", "      if (sp) { if (sp.state === 'session') setPodState(sp, 'live'); net.openSessions.delete((m.a || {}).sessionId); }\n      if (!fast && client && client.ok) clientLeaves();")
s = rep(s, "  .status { font-size: 11.5px; border-radius: 16px; flex-wrap: wrap; justify-content: center; white-space: normal; padding: 4px 6px; }\n  .status > span { padding: 3px 8px; border-right: 0; }",
        "  .status { font-size: 11.5px; border-radius: 16px; left: 12px; right: 12px; transform: none; max-width: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); white-space: normal; padding: 5px 6px; }\n  .status > span { padding: 3px 8px; border-right: 0; min-width: 0; }")
s = rep(s, "  .ticker { left: 12px; right: 12px; width: auto; bottom: calc(env(safe-area-inset-bottom, 0px) + 108px); padding: 8px 10px 6px; }",
        "  .ticker { left: 12px; right: 12px; width: auto; bottom: calc(env(safe-area-inset-bottom, 0px) + 118px); padding: 8px 10px 6px; }")
s = rep(s, "  await Promise.all([loadPacks(), liveBoot()]);\n", "  /* never wait more than 3.5 s for the live data: past that, the room opens on the recorded state and the live data joins later */\n  await Promise.all([loadPacks(), Promise.race([liveBoot(), new Promise((r) => setTimeout(r, 3500))])]);\n  bootClosed = true;\n")
s = rep(s, "  liveTick += dt; if (liveTick > 20 && director.liveOk) { liveTick = 0; refreshLive(); }", "  liveTick += dt; if (liveTick > 20) { liveTick = 0; if (director.liveOk) refreshLive(); else liveRetry(); }")
s = rep(s, "      pulseLayer('product');\n      for (const p of pods.values()) if (p.shown && p.state === 'live') ringPulse(p.grp.position, '#FCD34D', { r1: 1.2, dur: 0.8 });",
        "      pulseLayer('product');\n      if (b.evs.some((e) => e.n === 'MachineAttested' || e.n === 'ProofOfCloudToken')) { go('gate'); await machineArrives(fast); }\n      for (const p of pods.values()) if (p.shown && p.state === 'live') ringPulse(p.grp.position, '#FCD34D', { r1: 1.2, dur: 0.8 });")
s = rep(s, "  for (const a of agents) a.update(dt);\n", "  for (const a of agents) a.update(dt);\n  if (!REDUCE) queueLife(dt);\n")
s = rep(s, "      if (key === 'unbond') pushTick('bond', caption(key, vars), b);", "      if (key === 'unbond') pushTick('bond', caption(key, vars), b);\n      if (m.n === 'MachineBound' && pod) pod.verified = true;")
# a superseded replay must not switch off the new replay's skip; scenes are reset when a run starts or the viewer skips
assert s.count("    if (tok !== director.tok) { SKIP = false; return; }") == 2
s = s.replace("    if (tok !== director.tok) { SKIP = false; return; }", "    if (tok !== director.tok) return;")
s = rep(s, "  resetNet(); unseatAll();\n", "  resetNet(); unseatAll(); resetStage();\n")
s = rep(s, "  const tok = director.tok;\n  hideAct();\n", "  const tok = director.tok;\n  hideAct();\n  if (!natural) resetStage();\n")
s = rep(s, "    p.glow.material.opacity = lit ? 0.35 + 0.55 * pulse : 0.3;", "    p.glow.material.opacity = lit ? 0.4 + 0.5 * pulse : 0;")
s = rep(s, "      if (author.ok) { author.setBase('interact-left'); wait(1.2).then(() => author.setBase('interact-right')); }", "      if (author.ok && !fast) author.say(tr('speech.publish'), 1.4);")
# phones: zone labels only for the zone the tour is showing (in the overview they overflow and overlap)
s = rep(s, "  for (const z of zoneLabels) z.el.classList.toggle('off', f !== 'overview' && z.key !== f);", "  for (const z of zoneLabels) z.el.classList.toggle('off', f !== 'overview' && z.key !== f);\n  document.body.classList.toggle('tour-zone', f !== 'overview');")
s = rep(s, "  for (const z of zoneLabels) z.el.classList.remove('off');", "  for (const z of zoneLabels) z.el.classList.remove('off');\n  document.body.classList.remove('tour-zone');")
s = rep(s, "  .zlabel { font-size: 10.5px; }\n}", "  .zlabel { font-size: 10.5px; display: none; }\n  body.tour-zone .zlabel:not(.off) { display: block; }\n}")
# phones: the event ticker (4 px wider on each side) ran past the tour card, so it hides while the card is open
s = rep(s, "  .tour { bottom: calc(env(safe-area-inset-bottom, 0px) + 96px); padding: 15px 16px 14px; }", "  .tour { bottom: calc(env(safe-area-inset-bottom, 0px) + 122px); padding: 15px 16px 14px; }\n  body:has(#tour.on) .ticker { visibility: hidden; }")
# real rack models: their own pack, and the loader leaves their materials as authored (no flat Kenney look)
s = rep(s, "  const packs = ['factory', 'station', 'shop', 'space', 'chars'].map((k) => [k, `m/${k}.json`, `m/${k}/`]);",
        "  const packs = ['factory', 'station', 'shop', 'space', 'chars'].concat(RACK_STYLE !== 'code' ? ['racks'] : []).map((k) => [k, `m/${k}.json`, `m/${k}/`]);")
s = rep(s, "  for (const g of Object.values(G)) {\n    g.scene.traverse((o) => {", "  for (const [gname, g] of Object.entries(G)) {\n    if (RACK_MODELS.includes(gname)) continue;\n    g.scene.traverse((o) => {")
s = rep(s, "const has = (n) => !!G[n];", "const has = (n) => !!G[n];\nconst RACK_DEFAULT = 'data_center_rack';")
# the top centre moves out of the way of the tools on laptop screens (hud.js)
s = rep(s, 'window.__base = {', rd('hud.js') + 'window.__base = {')
# phones: the icon buttons lose their words, but the way to the console keeps them (an arrow alone says nothing)
s = rep(s, '  .ibtn .txt { display: none; }\n', '  .ibtn .txt { display: none; }\n  .ibtn.primary .txt { display: inline; }\n')
# small phones (360 px, common on Android): the first row of tools touched the brand; slightly smaller buttons
s = rep(s, '@media (prefers-reduced-motion: reduce) {', '@media (max-width: 380px) {\n  .ibtn { min-width: 35px; height: 35px; padding: 0 8px; border-radius: 12px; }\n  .ibtn svg { width: 17px; height: 17px; }\n  .tools { gap: 5px; }\n}\n@media (prefers-reduced-motion: reduce) {')
# the ticker opens on the latest real events: a first visit starts with the tour, not a replay, and it stayed empty
s = rep(s, "  director.mode = 'now';\n  applyWords();\n", "  director.mode = 'now';\n  applyWords();\n  showLatestTicks();\n")
# --- touch and short screens, Skip, the first replay block, live zone facts, devices without WebGL
# touch screens: 44 px targets 8 px apart, ticker and status text at 12 px or more; landscape phones and other short
# screens (under 500 px tall): one line of status that scrolls, no ticker, a compact tour card and a side panel
s = rep(s, '@media (prefers-reduced-motion: reduce) {', """@media (pointer: coarse) {
  .ibtn { min-width: 44px; height: 44px; }
  .tools { gap: 8px; }
  .btn-tour, .tbtn, .seg button, .stepper button { min-height: 44px; }
  .panel .x { width: 44px; height: 44px; }
  .panel .row { min-height: 44px; align-items: center; }
  .ticker h3 { font-size: 12px; }
  .tick small, .tick a { font-size: 12px; }
  .tick a { display: inline-block; padding: 4px 0; }
  .status { font-size: 12.5px; }
  .mode { font-size: 12px; }
  .panel input.find { font-size: 16px; }
}
@media (pointer: coarse) and (max-width: 380px) {
  .ibtn { min-width: 44px; height: 44px; padding: 0 9px; }
  .ibtn svg { width: 18px; height: 18px; }
  .tools { gap: 6px; }
}
@media (min-width: 761px) and (max-width: 1000px) and (min-height: 501px) {
  .status { flex-wrap: wrap; justify-content: center; white-space: normal; border-radius: 16px; row-gap: 2px; }
  .ticker { bottom: calc(env(safe-area-inset-bottom, 0px) + 156px); }
}
@media (max-height: 500px) {
  .topcenter { display: none; }
  .topleft { top: calc(env(safe-area-inset-top, 0px) + 8px); gap: 6px; }
  .brand span { display: none; }
  .brand { padding: 6px 11px 6px 8px; }
  .brand b { font-size: 15px; }
  .btn-tour { padding: 6px 13px; }
  .tools { top: calc(env(safe-area-inset-top, 0px) + 8px); max-width: 64vw; }
  .ibtn .txt { display: none; }
  .ibtn.primary .txt { display: inline; }
  .ticker { display: none; }
  .status { left: max(12px, env(safe-area-inset-left, 0px)); right: max(12px, env(safe-area-inset-right, 0px)); transform: none; max-width: none;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 8px); display: flex; justify-content: flex-start; white-space: nowrap; overflow-x: auto;
    font-size: 12px; padding: 3px 6px; border-radius: 14px; }
  .status > span { padding: 3px 8px; border-right: 1px solid var(--line); flex: none; min-width: max-content; }
  .status > span:last-child { border-right: 0; }
  .status .opt { display: inline-flex; }
  .tour { left: auto; right: max(12px, env(safe-area-inset-right, 0px)); bottom: calc(env(safe-area-inset-bottom, 0px) + 50px);
    transform: translateY(12px); width: min(420px, 54vw); max-height: calc(100dvh - 130px); overflow-y: auto; padding: 12px 14px 10px; }
  .tour.on { transform: none; }
  .tour .ico { display: none; }
  .tour h2 { font-size: 16px; margin-bottom: 4px; }
  .tour p { font-size: 14px; line-height: 1.45; }
  .tour footer { margin-top: 10px; }
  .panel { top: calc(env(safe-area-inset-top, 0px) + 64px); bottom: calc(env(safe-area-inset-bottom, 0px) + 50px); left: auto;
    right: max(12px, env(safe-area-inset-right, 0px)); width: min(380px, 50vw); max-height: none; }
  .toast { top: auto; bottom: calc(env(safe-area-inset-bottom, 0px) + 50px); transform: translate(-50%, 8px); }
  .toast.on { transform: translate(-50%, 0); }
  .zlabel { display: none; }
  body.tour-zone .zlabel:not(.off) { display: block; }
}
@media (prefers-reduced-motion: reduce) {""")
# Skip leaves the tour on the network NOW (live): the replay starts from an empty room and read "Arc block 0", which a
# visitor who skips the explanations took for a dead network; "Start exploring" at the end of the tour still replays
s = rep(s, "function endTour() {", "function endTour(replay = true) {")
s = rep(s, "  if (director.mode !== 'replay') startReplay(); else director.follow = true;",
        "  if (!replay) { if (director.mode === 'replay') endReplay(false); toast(tr('toasts.skipNow')); }\n"
        "  else if (director.mode !== 'replay') startReplay(); else director.follow = true;")
s = rep(s, "$('#tour-skip').addEventListener('click', endTour);", "$('#tour-skip').addEventListener('click', () => endTour(false));")
# the replay opens on its first block and date, not "Arc block 0" and the capture date
s = rep(s, "  resetNet(); unseatAll(); resetStage();", "  resetNet(); unseatAll(); resetStage();\n  if (BEATS[0]) { net.block = BEATS[0].b; net.t = BEATS[0].t; }")
# a zone's fact read live from the API when the page reads it (live.js, liveZoneFact)
s = rep(s, "    const f = tr(`zones.${arg}.fact`); if (f) p.appendChild(el('p', { class: 'fact' }, f));",
        "    const f = liveZoneFact(arg) || tr(`zones.${arg}.fact`); if (f) p.appendChild(el('p', { class: 'fact' }, f));")
# without WebGL (switched off, or a device without it): say so and point to the console's hive, instead of a loader
# that never ends
s = rep(s, "const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });",
        """function noWebgl() {
  $('#load-text').textContent = tr('errors.noWebgl') || "This device can't show the 3D room.";
  const sub = $('#load-sub'); sub.textContent = '';
  const a = document.createElement('a'); a.href = API.replace(/\\/api$/, '') + '/console/#/ruche';
  a.textContent = tr('errors.noWebglLink') || 'Open the console'; a.style.color = 'var(--accent)'; sub.appendChild(a);
  const bar = $('#load-bar'); if (bar && bar.parentElement) bar.parentElement.hidden = true;
}
if (!(() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })()) {
  noWebgl();
  throw new Error('WebGL unavailable');
}
const renderer = (() => {
  try { return new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { noWebgl(); throw e; }
})();""")
# --- touch screens: ticker links as 44 px targets, and a tap picks the nearest rack
# ticker: the separator before the transaction link gets its own span (touch screens move the link to the right of the line)
s = rep(s, "    meta.textContent = k.t ? fmtDate(k.t) + ' · ' : '';\n    if (k.tx) { const a = document.createElement('a');",
        "    meta.textContent = k.t ? fmtDate(k.t) : '';\n    if (k.tx && k.t) { const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = ' · '; meta.appendChild(sep); }\n    if (k.tx) { const a = document.createElement('a');")
# touch screens: a rack can be a few pixels wide (a portrait phone shows the whole room, racks 14 px apart): a tap within
# 24 px of a rack picks the rack whose centre is nearest, the one the finger aimed at (the ray picked the first hit box,
# often the rack in front); the mouse keeps the exact pick
s = rep(s, "canvas.addEventListener('pointermove', (e) => {", """const nearV = new THREE.Vector3();
function nearPod(x, y, r) {
  let best = null, bd = r;
  for (const h of hitPods) {
    if (!h.parent.visible) continue;
    h.getWorldPosition(nearV).project(camera);
    const d = Math.hypot(((nearV.x + 1) / 2) * innerWidth - x, ((1 - nearV.y) / 2) * innerHeight - y);
    if (d < bd) { bd = d; best = h.userData.pod; }
  }
  return best;
}
canvas.addEventListener('pointermove', (e) => {""")
s = rep(s, "  const h = pick(e.clientX, e.clientY);\n  if (!h) { closePanel(); return; }\n  director.follow = false;",
        "  let h = pick(e.clientX, e.clientY);\n  if (e.pointerType !== 'mouse') { const near = nearPod(e.clientX, e.clientY, 24); if (near) h = { pod: near }; }\n  if (!h) { closePanel(); return; }\n  director.follow = false;")
s = rep(s, '@media (prefers-reduced-motion: reduce) {', """/* Touch screens: each ticker line is a 44 px target, and its transaction link a 44 px square at the right of
   the line (the arrow opens the explorer; the hash stays in the rack's panel); zone labels at 12 px */
@media (pointer: coarse) {
  .tick { position: relative; padding-right: 50px; }
  .tick button { display: flex; align-items: center; min-height: 44px; }
  .tick small .sep, .panel .row small .sep { display: none; }
  .tick small a, .panel .row small a { position: absolute; top: 0; right: 0; bottom: 0; width: 44px; display: grid; place-items: center; padding: 0; font-size: 0; border-radius: 8px; text-decoration: none; }
  .tick small a::after, .panel .row small a::after { content: '\\2197'; font-size: 17px; line-height: 1; color: var(--muted); }
  /* the panel's lists (a rack's history, Find): each line a 44 px target, its transaction link a 44 px square at the right */
  .panel .row:has(small a) { position: relative; padding-right: 50px; }
  .panel .row button.what { display: flex; align-items: center; min-height: 44px; }
  .panel .link { min-height: 44px; align-items: center; }
  .zlabel { font-size: 12px; }
}
/* up to 1100 px wide, the tour card and the ticker share the bottom of the screen: the ticker waits for the end of the tour */
@media (max-width: 1100px) {
  body:has(#tour.on) .ticker { visibility: hidden; }
}
/* tablets (portrait): the status wraps on two or three rows; the tour card sits above them, and the AI gateway's label
   moves under the lab's (they touched) */
@media (min-width: 761px) and (max-width: 1000px) and (min-height: 501px) {
  .tour { bottom: calc(env(safe-area-inset-bottom, 0px) + 132px); }
  .zlabel[data-zone="provider"] { margin-top: 22px; }
}
/* short screens (landscape phones): the live badge comes first, and the bounties (or, under 760 px, both optional
   counts) give their place, so the line fits instead of being cut at the right edge */
@media (max-height: 500px) {
  .status .mode { order: -1; }
  .status > span { border-right: 0; border-left: 1px solid var(--line); }
  .status > span.mode { border-left: 0; }
  .status > span:has(#st-bounties) { display: none; }
}
@media (max-height: 500px) and (max-width: 760px) {
  .status .opt { display: none; }
}
@media (prefers-reduced-motion: reduce) {""")
open(OUT, 'w', encoding='utf-8').write(s)
print('room template', len(s))
