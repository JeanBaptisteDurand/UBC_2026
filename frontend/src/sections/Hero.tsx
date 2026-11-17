// 1. The hero: the headline (a single key), the support line, the three buttons (which move down with the scroll).
// The wall is on the right, face on, and overflows.
import { useRef } from 'react'
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
        <a className="tlink hero-demo" href={link.demo}><span className="hero-demo-r" aria-hidden="true" />{t('end.demo')}</a>
        {/* the wall is the catalog: every lit sled is a service; the full list, in the same sled faces, is one click away */}
        <a className="tlink hero-demo hero-cat" href={link.services}><span className="hero-demo-r" aria-hidden="true" />{t('hero.cat')}</a>
        <p className="sr-only" id="wall-keys">{t('hero.hint.keys')}</p>
        {/* the buttons close the column: moving down, they never pass over any hero text. Under them, the copilot
            bar, as wide as the three buttons together: on the first screen it replaces the floating copilot button,
            which only appears once the page has scrolled */}
        <div className="hero-acts">
          <div className="ctas">
            <Slot k="use" home /><Slot k="rent" home /><Slot k="publish" home />
          </div>
          <a className="btn btn-line hero-cp" href="#copilot" data-slot="COPILOT">
            <span className="hero-cp-mk" aria-hidden="true"><i /></span>
            <span className="hero-cp-t">{t('hero.copilot')}</span>
            <span className="hero-cp-k">{t('hero.copilot.k')}</span>
          </a>
        </div>
        <WallMirror />
      </div>
    </section>
  )
}
