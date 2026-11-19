// The 'How ArcHive works' demo: a single continuous shot in three acts, driven by a single GSAP timeline (one time t,
// labels per chapter and per beat). The scene computes everything from t (smoothed camera, room thread, tracked
// packet): playing, rewinding, jumping to a chapter glides instead of cutting. No modal or connector: a subtitle at
// the bottom, a label on the tracked object, a 'Details' drawer on demand (the step card, with its real
// transactions). Keyboard: ← → (previous or next beat, the playhead glides), space (play / pause), Escape
// (exit, scene.ts). Reduced motion: no gliding.
import './demo.css'
import gsap from 'gsap'
import { txUrl } from '../data/fmt'
import { DEMO_STEPS, BEATS, CHAPTERS, DEMO_LABEL, UI, UI15, BEAT_MORE, REC_HEAD, clientAt, tr, type Beat, type Sfx, type Rec } from './demo-strings'
import { lg } from './lang'
import { makeSound } from './sound'

export interface DemoApi {
  stage: HTMLElement; reduced: () => boolean; gl: boolean
  /** the scene settles at time t (demo seconds); returns the on-screen position of the tracked object */
  at: (t: number, beat: Beat, u: number, i: number) => { x: number; y: number } | null
  quit: () => void
  mobile: () => boolean
  dirty: () => void
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
export const T0: number[] = []; { let a = 0; for (const b of BEATS) { T0.push(a); a += b.d } }
export const TOTAL = BEATS.reduce((a, b) => a + b.d, 0)
export const beatAt = (t: number) => { let i = BEATS.length - 1; while (i > 0 && T0[i] > t + 1e-6) i--; return i }

export function makeDemo(api: DemoApi) {
  const st = { t: 0 }
  let open = false, cur = -1, drawer = false
  const tl = gsap.timeline({ paused: true })
  tl.to(st, { t: TOTAL, duration: TOTAL, ease: 'none' })
  BEATS.forEach((_, i) => tl.addLabel('b' + i, T0[i]))
  const chStart = CHAPTERS.map((_, c) => T0[BEATS.findIndex((b) => b.ch === c)])
  tl.eventCallback('onComplete', () => syncPlay())
  // sound, and its cues synced to the beats (packet departure and arrival, received, signature, drone)
  const snd = makeSound()
  const CUES: [number, Sfx][] = []
  BEATS.forEach((b, i) => {
    if (b.chase) { CUES.push([T0[i] + 0.05, b.chase.kind === 'sig' ? 'sign' : 'depart']); if (b.chase.kind !== 'sealed' && b.chase.kind !== 'sig') CUES.push([T0[i] + b.d * 0.95, b.chase.kind === 'usdc' ? 'pay' : 'tick']) }
    if (b.recv) CUES.push([T0[i] + b.d * 0.3, 'recv'])
    for (const [u, k] of b.sfx ?? []) CUES.push([T0[i] + b.d * u, k])
  })
  let lastT = 0, lastChars = -1

  const root = document.createElement('div'); root.className = 'dm dm15'; root.hidden = true
  root.innerHTML = `
    <div class="dm-top"><p class="dm-count mono" aria-live="polite"></p>
      <button type="button" class="dm-x" data-a="quit"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3 13 13M13 3 3 13" /></svg></button></div>
    <p class="dm-tag mono" aria-hidden="true"></p>
    <div class="dm-low"><p class="dm-sub" aria-live="polite"></p></div>
    <aside class="dm-drawer" hidden></aside>
    <div class="dm-ctl">
      <button type="button" class="dm-b" data-a="prev"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg></button>
      <button type="button" class="dm-b dm-play" data-a="play"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="dm-i-play" d="M5 3v10l8-5z" /><path class="dm-i-pause" d="M5 3v10M11 3v10" /></svg></button>
      <button type="button" class="dm-b" data-a="next"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg></button>
      <div class="dm-chap">${CHAPTERS.map((_, c) => `<button type="button" class="dm-seg" data-c="${c}" style="flex-grow:${((c < 2 ? chStart[c + 1] : TOTAL) - chStart[c]).toFixed(1)}"><span class="dm-seg-n"></span><span class="dm-seg-bar"><i></i></span></button>`).join('')}</div>
      <button type="button" class="dm-b dm-snd" data-a="sound"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="dm-i-spk" d="M2 6h3l4-3v10l-4-3H2z" /><path class="dm-i-on" d="M11 5.5c1 .8 1 4.2 0 5M12.8 4c1.8 1.6 1.8 6.4 0 8" /><path class="dm-i-off" d="m11 6 4 4M15 6l-4 4" /></svg></button>
      <button type="button" class="dm-b dm-det" data-a="details"></button>
    </div>
    <aside class="dm-side" aria-live="polite"><p class="dm-side-ch mono"></p><h3 class="dm-side-t"></h3><p class="dm-side-sub"></p><p class="dm-side-why"></p><p class="dm-side-tech mono"></p><div class="dm-side-real"></div></aside>`
  api.stage.appendChild(root)
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T
  const sub = $<HTMLElement>('.dm-sub'), tag = $<HTMLElement>('.dm-tag'), dr = $<HTMLElement>('.dm-drawer'), side = $<HTMLElement>('.dm-side')
  // the space taken by the side block (fraction of the width the scene shifts by): measured at start and on resize
  let sideK = 0
  const measure = () => { sideK = !open || side.offsetParent === null ? 0 : (side.offsetLeft + side.offsetWidth + 16) / (2 * Math.max(1, root.clientWidth)) }
  addEventListener('resize', () => { if (open) measure() })

  function texts() {
    $<HTMLElement>('.dm-det').textContent = tr(drawer ? UI15.close : UI15.details)
    for (const [a, k] of [['quit', UI.quit], ['prev', UI.prev], ['next', UI.next]] as const) root.querySelector<HTMLElement>(`[data-a="${a}"]`)!.setAttribute('aria-label', tr(k))
    $<HTMLElement>('.dm-play').setAttribute('aria-label', tr(tl.isActive() ? UI.pause : UI.play))
    const sb = $<HTMLElement>('.dm-snd'); sb.setAttribute('aria-label', tr(snd.muted ? UI15.soundOn : UI15.mute)); sb.setAttribute('aria-pressed', String(snd.muted)); sb.dataset.off = snd.muted ? '1' : '0'
    root.querySelectorAll<HTMLElement>('.dm-seg').forEach((b, c) => { (b.querySelector('.dm-seg-n') as HTMLElement).textContent = `${c + 1}. ${tr(CHAPTERS[c])}`; b.setAttribute('aria-label', `${tr(UI15.chapter)} ${c + 1}: ${tr(CHAPTERS[c])}`) })
  }
  // the values recorded on Arc testnet for the beat (replay.json): a heading, then one mono line per value with its
  // explorer link; FR numbers take a decimal comma
  const recV = (r: Rec) => { const v = typeof r.v === 'string' ? r.v : tr(r.v); return lg() === 'fr' ? v.replace(/(\d)\.(\d)/g, '$1,$2') : v }
  function recHtml(i: number) {
    const rs = BEAT_MORE[i]?.rec; if (!rs?.length) return ''
    return `<p class="dm-rec-h">${esc(tr(REC_HEAD))}</p>` + rs.map((r) => `<p class="dm-rec"><span class="dm-rec-k">${esc(tr(r.k))}</span><span class="dm-rec-v mono">${esc(recV(r))}</span>${r.tx ? `<a class="tlink mono dm-rec-tx" href="${txUrl(r.tx)}" target="_blank" rel="noreferrer">${esc(tr(UI.tx))} ${r.tx.slice(0, 10)}…</a>` : ''}</p>`).join('')
  }
  function drawerHtml(b: Beat) {
    const s = DEMO_STEPS[b.step]
    const row = (k: string, v: string, mono = false) => `<div class="dm-row"><dt>${esc(k)}</dt><dd${mono ? ' class="mono"' : ''}>${v}</dd></div>`
    return `<h3 class="dm-c-t">${esc(tr(s.title))}</h3><dl>` + row(tr(UI.who), esc(tr(s.who))) + (s.fn ? row(tr(UI.fn), esc(s.fn), true) : '') +
      (s.checks ? row(tr(UI.checks), esc(tr(s.checks))) : '') + row(tr(UI.writes), esc(tr(s.writes))) +
      (s.real ? row(tr(UI.real), esc(tr(s.real.text)) + (s.real.tx ? ` <a class="tlink mono" href="${txUrl(s.real.tx)}" target="_blank" rel="noreferrer">${tr(UI.tx)} ${s.real.tx.slice(0, 10)}…</a>` : '')) : '') + '</dl>' +
      (BEAT_MORE[cur]?.why ? `<p class="dm-c-why">${esc(tr(BEAT_MORE[cur].why!))}</p>` : '') + `<div class="dm-c-rec">${recHtml(cur)}</div>`
  }
  function beatChanged(i: number) {
    cur = i
    const b = BEATS[i]
    sub.textContent = tr(b.sub)
    const s = DEMO_STEPS[b.step]
    $<HTMLElement>('.dm-side-ch').textContent = `${tr(UI15.chapter)} ${b.ch + 1} / 3`
    $<HTMLElement>('.dm-side-t').textContent = tr(CHAPTERS[b.ch])
    $<HTMLElement>('.dm-side-sub').textContent = tr(b.sub)
    $<HTMLElement>('.dm-side-tech').textContent = b.tech ? tr(b.tech) : ''
    const more = BEAT_MORE[i]
    $<HTMLElement>('.dm-side-why').textContent = more?.why ? tr(more.why) : ''
    // the recorded values of the beat; without any, the step's real transaction as before
    $<HTMLElement>('.dm-side-real').innerHTML = more?.rec?.length ? recHtml(i) : s.real?.tx ? `<a class="tlink" href="${txUrl(s.real.tx)}" target="_blank" rel="noreferrer">${esc(tr(UI15.onArc))}</a>` : ''
    if (!api.reduced()) gsap.fromTo(side.querySelectorAll('.dm-side-sub, .dm-side-why, .dm-side-tech, .dm-side-real'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.06, ease: 'power2.out' })
    $<HTMLElement>('.dm-count').textContent = `${tr(DEMO_LABEL)}, ${tr(UI15.chapter).toLowerCase()} ${b.ch + 1} / 3`
    if (drawer) dr.innerHTML = drawerHtml(b)
    if (!api.reduced()) gsap.fromTo(sub, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' })
    if (api.reduced()) { api.stage.classList.remove('dm-fade'); void api.stage.offsetWidth; api.stage.classList.add('dm-fade') }
  }
  function syncPlay() { const on = tl.isActive() || (!tl.paused() && tl.progress() < 1); $<HTMLElement>('.dm-play').dataset.on = on ? '1' : '0'; if (open) { if (on) snd.resume(); else snd.pause() } texts() }
  // ← →: the playhead glides to the target beat (≤ 1.2 s), then playback resumes if it was playing
  function glide(to: number) {
    const was = !tl.paused()
    to = Math.max(0, Math.min(TOTAL - 0.01, to))
    if (api.reduced()) { tl.seek(to, false); if (!was) tl.pause(); syncPlay(); api.dirty(); return }
    const d = Math.min(1.2, Math.max(0.4, Math.abs(to - st.t) / 8))
    tl.pause(); gsap.to(tl, { time: to, duration: d, ease: 'power2.inOut', onUpdate: api.dirty, onComplete: () => { if (was) tl.play(); syncPlay() } })
  }
  function act(a: string) {
    if (a === 'quit') return api.quit()
    if (a === 'sound') { snd.setMuted(!snd.muted); if (!snd.muted) snd.start(); texts(); return }
    snd.start()
    if (a === 'play') { if (tl.progress() >= 1) tl.seek(0); tl.paused() ? tl.play() : tl.pause(); syncPlay(); return }
    if (a === 'details') { drawer = !drawer; dr.hidden = !drawer; if (drawer) dr.innerHTML = drawerHtml(BEATS[Math.max(0, cur)]); root.dataset.drawer = drawer ? '1' : '0'; texts(); return }
    const i = beatAt(st.t)
    if (a === 'next') glide(T0[Math.min(BEATS.length - 1, i + 1)])
    if (a === 'prev') glide(T0[st.t - T0[i] > 1 ? i : Math.max(0, i - 1)])
  }
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a], .dm-seg'); if (!b) return
    if (b.classList.contains('dm-seg')) { glide(chStart[Number(b.dataset.c)]); return }
    act(b.dataset.a!)
  })
  addEventListener('keydown', (e) => {
    if (!open || e.defaultPrevented || (e.target as HTMLElement).closest?.('input, textarea, select')) return
    if (e.key === 'ArrowRight') { e.preventDefault(); act('next') } else if (e.key === 'ArrowLeft') { e.preventDefault(); act('prev') } else if (e.key === ' ') { e.preventDefault(); act('play') }
  })

  // every frame: the scene settles at time t; the text follows the current time
  function frame() {
    if (!open) return
    const i = beatAt(st.t), b = BEATS[i], u = Math.max(0, Math.min(1, (st.t - T0[i]) / b.d))
    if (i !== cur) beatChanged(i)
    root.querySelectorAll<HTMLElement>('.dm-seg').forEach((s, c) => {
      const a = chStart[c], z = c < 2 ? chStart[c + 1] : TOTAL
      ;(s.querySelector('i') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, (st.t - a) / (z - a))).toFixed(4)})`
      s.dataset.on = b.ch === c ? '1' : '0'
    })
    // sound: cues crossed during normal playback (never during a glide or jump), typing, the trail
    const playing = tl.isActive()
    if (playing && st.t > lastT && st.t - lastT < 0.35) for (const [ct, k] of CUES) if (ct > lastT && ct <= st.t) snd.fx(k)
    if (b.type) { const c = clientAt(i, u), n = c.phase === 1 ? Math.floor(c.k * 56) : -1; if (playing && n > lastChars && lastChars >= 0) snd.fx('key'); lastChars = n } else lastChars = -1
    snd.trail(playing && b.chase ? Math.sin(Math.PI * u) : 0, b.chase ? u : 0)
    lastT = st.t
    const p = api.at(st.t, b, u, i)
    if (p && b.tag) {
      tag.textContent = tr(b.tag)
      tag.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -150%)`
      tag.style.opacity = u < 0.06 || u > 0.97 ? '0' : '1'
    } else tag.style.opacity = '0'
  }
  return {
    get open() { return open }, frame,
    get t() { return st.t },
    start() { open = true; root.hidden = false; cur = -1; lastT = 0; lastChars = -1; snd.start(); measure(); tl.seek(0, false); if (!api.reduced()) tl.play(); else tl.pause(); syncPlay(); texts(); api.dirty() },
    stop() { open = false; root.hidden = true; tl.pause(); gsap.killTweensOf(tl); snd.pause(); sideK = 0 },
    side: () => sideK,
    lang() { if (open) { cur = -1; texts() } },
    seek(t: number) { tl.pause(); tl.seek(t, false); syncPlay(); api.dirty() },
    playing: () => !tl.paused(),
    step: () => DEMO_STEPS[BEATS[Math.max(0, beatAt(st.t))].step],
  }
}
