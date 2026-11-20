// 1. The hero: the headline (a single key), the support line, the three buttons (which move down with the scroll).
// The wall is on the right, face on, and overflows.
import { useCallback, useEffect, useRef, useState } from 'react'
import { onTick } from '../clock'
import { AskHiveMark } from '../copilot/AskHiveMark'
import { t, useLang, type TKey } from '../i18n'
import { useIn } from '../ui/gestures'
import { Slot, WallMirror } from '../ui/Frame'
import { withArcWords, ArcIgnite, plainAcc } from '../ui/ArcGlow'
import { link } from '../links'

/** A single lettering gesture across the page: the rule draws, then the title rises from behind it; in state
 *  sections the rule takes the colour of the section LED */
export function Title({ k, as = 'h2', vars, glow = true }: { k: TKey; as?: 'h1' | 'h2'; vars?: Record<string, string | number>; glow?: boolean }) {
  const lang = useLang()
  const Tag = as
  return (
    <Tag className={`${as === 'h1' ? 'h1' : 'h2'} ttl`} data-lang={lang} aria-label={plainAcc(t(k, vars))}>
      {/* only the part of the key marked {...} ignites (ui/ArcGlow.tsx, ArcIgnite), the rest stays
          white, weight 600 */}
      <span className="ttl-m" aria-hidden="true"><span className="ttl-t">{glow ? <ArcIgnite text={t(k, vars)} /> : plainAcc(t(k, vars))}</span></span>
      <span className="ttl-rule" aria-hidden="true" />
    </Tag>
  )
}

/** The headline (a single key), split after the comma. It fits entirely in the text column, on the dark
 *  background */
function Catch() {
  const lang = useLang()
  const full = t('hero.title')
  const hl = t('hero.hl').split(',')
  const k = full.indexOf(',')
  const a = k >= 0 ? full.slice(0, k + 1) : full, b = k >= 0 ? full.slice(k + 1).trim() : ''
  return (
    <h1 className="h1 catch ttl" aria-label={full} data-lang={lang} data-slot="CATCHPHRASE">
      {/* "machines" and "market" in glowing Arc blue (ui/ArcGlow.tsx) */}
      <span className="ttl-m c1" aria-hidden="true"><span className="ttl-t">{withArcWords(a, hl)}</span></span>
      <span className="ttl-m c2" aria-hidden="true"><span className="ttl-t">{withArcWords(b, hl)}</span></span>
      <span className="ttl-rule" aria-hidden="true" />
    </h1>
  )
}

/** The MCP server, ready to install from the first screen, under the agents' line: Claude Code's one-line command and
 *  the JSON config of the other clients (Cursor, any client that takes a remote server URL), as on the Services page's
 *  "Build on it" and in the copilot's MCP card. One quiet mono line each, with its copy button. */
const MCP_CMD = 'claude mcp add --transport http archive https://arc-hive.xyz/mcp'
const MCP_JSON = '{"mcpServers": {"archive": {"url": "https://arc-hive.xyz/mcp"}}}'
async function copyTo(text: string) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true } } catch { /* refused: the old way */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove(); return ok
  } catch { return false }
}
function McpLine({ text, title, what }: { text: string; title: string; what: string }) {
  useLang()
  const [done, setDone] = useState(false)
  const code = useRef<HTMLElement>(null)
  const tm = useRef(0)
  useEffect(() => () => clearTimeout(tm.current), [])
  const copy = () => void copyTo(text).then((ok) => {
    // refused (an in-app browser): the line is selected, to copy by hand
    if (!ok) { try { const r = document.createRange(); r.selectNodeContents(code.current!); getSelection()?.removeAllRanges(); getSelection()?.addRange(r) } catch { /* nothing to select */ } return }
    setDone(true); clearTimeout(tm.current); tm.current = window.setTimeout(() => setDone(false), 1600)
  })
  return (
    <div className="hero-mcp-r">
      <code className="mono hero-mcp-c" ref={code} title={title}>{text}</code>
      <button type="button" className="hero-mcp-b" onClick={copy} aria-label={`${t('p.copy')}: ${what}`}>{done ? t('p.copied') : t('p.copy')}</button>
    </div>
  )
}

/** the invitation to scroll, at the foot of the first screen; gone once the page has moved, and on a screen too short
 *  for it under the hero's text (the MCP lines come last): the cue never covers a line */
function ScrollCue() {
  const ref = useRef<HTMLDivElement>(null)
  // the room under the text is measured when the layout changes (ResizeObserver: no reading at each frame), and again
  // when the page is back at its top
  const fits = useCallback(() => {
    const el = ref.current
    const acts = el?.parentElement?.querySelector('.hero-acts')
    if (!el || !acts) return
    const v = acts.getBoundingClientRect().bottom + 8 <= el.getBoundingClientRect().top ? '1' : '0'
    if (el.dataset.room !== v) el.dataset.room = v
  }, [])
  useEffect(() => {
    const txt = ref.current?.parentElement?.querySelector('.txt')
    if (!txt || typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(() => { if (scrollY <= 40) fits() })
    ro.observe(txt); ro.observe(document.documentElement)
    return () => ro.disconnect()
  }, [fits])
  useEffect(() => onTick(() => {
    const el = ref.current; if (!el) return
    const v = scrollY > 40 ? '0' : '1'
    if (el.dataset.on !== v) { el.dataset.on = v; if (v === '1') fits() }
  }), [fits])
  return (
    <div className="scroll-cue" ref={ref} data-on="1" aria-hidden="true" data-front-free>
      <span className="scroll-cue-l"><i /></span><span className="lbl mono scroll-cue-t">{t('hero.scroll')}</span>
    </div>
  )
}

export function Hero() {
  const ref = useRef<HTMLElement>(null)
  useIn(ref, 1)
  useLang()
  // The light hero: no live line (it stays in the top bar), no legend of the four states, no "point at a slot" hint:
  // the enlarged headline, the support line, the three buttons. The keyboard hint stays for screen readers (the
  // wall is browsed with the arrow keys)
  return (
    <section className="sec hero" data-sec="hero" ref={ref} id="top">
      <div className="txt">
        <Catch />
        <p className="support">{t('hero.support')}</p>
        {/* the replayed demo, reachable from the first screen (the same link as in the last section) */}
        <a className="tlink hero-demo hero-live" href={link.demo}><svg className="hero-ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" className="hero-ic-ring" /><path d="M8.2 6.6 L13.8 10 L8.2 13.4 Z" className="hero-ic-play" /></svg><span>{t('end.demo')}</span></a>
        <p className="sr-only" id="wall-keys">{t('hero.hint.keys')}</p>
        {/* the buttons close the column: moving down, they never pass over any hero text. Under them, the copilot
            bar, as wide as the three buttons together: on the first screen it replaces the floating copilot button,
            which only appears once the page has scrolled */}
        <div className="hero-acts">
          <div className="ctas">
            <Slot k="use" home /><Slot k="rent" home /><Slot k="publish" home />
          </div>
          <a className="btn btn-line hero-cp" href="#copilot" data-slot="COPILOT">
            <AskHiveMark size={28} className="hero-cp-mk" />
            <span className="hero-cp-t">{t('hero.copilot')}</span>
            <span className="hero-cp-k">{t('hero.copilot.k')}</span>
          </a>
          {/* for AI agents: one quiet line under the copilot bar, no new button; it opens the Services chapter that holds
              the MCP address to copy */}
          <a className="hero-agent" href={`${link.catalog}?c=build`}>{t('hero.agent')}</a>
          <div className="hero-mcp" role="group" aria-label="Install the MCP server">
            <McpLine text={MCP_CMD} title="Claude Code" what="the Claude Code command" />
            <McpLine text={MCP_JSON} title="JSON config, for Cursor and any client that takes a remote server URL" what="the JSON config for other MCP clients" />
          </div>
        </div>
        <WallMirror />
      </div>
      {/* the invitation to scroll: a thin rule where a short segment runs down, and a mono label, in
          the header's grammar; it leaves as soon as the page moves */}
      <ScrollCue />
    </section>
  )
}
