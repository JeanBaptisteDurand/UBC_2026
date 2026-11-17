// Frame of the app pages: the landing's two-row header, without the scene. The first row holds the logo, the menu
// (current page marked) and the language; the second, the live reading of Arc testnet. The bottom rule is first the
// loading bar (the API, then the Arc block), then the page scroll progress.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLive, blockTime, ago } from '../data/live'
import { num, usdc } from '../data/fmt'
import { t, useLang, setLang, type TKey } from '../i18n'
import { link } from '../links'
import { onTick } from '../clock'
import { Logo } from '../ui/Logo'
import { SelLayer } from '../ui/Sel'
import { MainNav } from '../ui/MainNav'
import { HeaderWallet } from '../network/actions/HeaderWallet'
import '../network/actions/actions.css'

export type AppPage = 'use' | 'service' | 'demo' | 'rent' | 'publish' | 'network' | 'bounty' | 'sessions' | 'operator'

/** replay: the replayed demo reads nothing live; the second row shows the recording */
/** wallet: the visitor's wallet button, the same on every app page (the replayed demo has none). The copilot bubble
 *  follows, except on the demo and on the Network page, whose scene uses the corners. */
export function AppHeader({ page, section, replay, wallet }: { page: AppPage; section: TKey; replay?: { block: number; date: string }; wallet?: ReactNode }) {
  const walletEl = wallet ?? (replay ? null : <HeaderWallet />)
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const block = useLive((s) => s.block)
  const stats = useLive((s) => s.stats)
  const status = useLive((s) => s.status)
  const activity = useLive((s) => s.activity)
  const pay = activity?.find((a) => a.name === 'CallSettled' || a.name === 'Settled')
  const [payAt, setPayAt] = useState<number | null>(null)
  const [, setMin] = useState(0)
  useEffect(() => { let ok = true; setPayAt(null); if (pay?.block) blockTime(pay.block).then((v) => { if (ok) setPayAt(v) }); return () => { ok = false } }, [pay?.block])
  useEffect(() => { const id = setInterval(() => setMin((m) => m + 1), 60000); return () => clearInterval(id) }, [])
  const bar = useRef<HTMLDivElement>(null)
  const loadR = useRef(0)
  // loading: one third while awaiting the first response, two thirds at the API, full at the Arc block
  loadR.current = replay ? 1 : status === 'loading' ? 0.33 : block ? 1 : 0.66
  useEffect(() => onTick(() => {
    const L = loadR.current
    const max = document.documentElement.scrollHeight - innerHeight
    const p = L < 1 ? L : max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 1
    if (bar.current) { bar.current.style.transform = `scaleX(${p.toFixed(4)})`; bar.current.dataset.load = L < 1 ? '1' : '0' }
  }), [])
  const nav = <MainNav page={page === 'network' ? 'network' : 'other'} />
  return (
    <header className="hd app-hd-bar" data-front-free>
      <div className="hd-row1">
        <a className="logo" href={link.home} aria-label="ArcHive"><Logo /></a>
        <nav className="hd-nav" aria-label={t('nav.main')}>{nav}</nav>
        <div className="hd-side">
          <a className="hd-console" href={link.console}>{t('nav.console')}</a>
          <button className="lang" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} lang={lang === 'fr' ? 'en' : 'fr'} aria-label={t('lang.to')}>{lang === 'fr' ? 'EN' : 'FR'}</button>
          {walletEl}
          <button className="menu-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('nav.close') : t('nav.menu')}</button>
        </div>
      </div>
      {replay ? (
        <div className="hd-row2 lbl" aria-live="off">
          <span className="band-i"><b>{t('band.net')}</b></span>
          <span className="band-i">{t('demo.band')} <span className="nowrap">{replay.date}</span></span>
          <span className="band-i">{t('demo.band.block')} <span className="mono tnum nowrap">{num(replay.block, lang)}</span></span>
          <span className="band-sec"><span className="sec-n">{t(section)}</span></span>
        </div>
      ) : (
      <div className="hd-row2 lbl" aria-live="off">
        <span className="band-i"><b>{t('band.net')}</b></span>
        <span className="band-i">{t('band.block')} <span className="mono tnum nowrap">{block ? num(block, lang) : t('band.reading')}</span></span>
        <span className="band-i">{t('band.active')} <span className="mono tnum nowrap">{stats ? `${stats.enclavesActive} / ${stats.enclaves}` : t('band.reading')}</span></span>
        <span className="band-i band-pay">{t('band.paid')} <span className="mono tnum nowrap">{pay ? `${usdc(pay.args.amount ?? pay.args.paidDelta, lang)}, ${t('word.block')} ${num(pay.block, lang)}${payAt ? `, ${ago(payAt, lang)}` : ''}` : activity ? t('end.none') : t('band.reading')}</span></span>
        <span className="band-sec"><span className="sec-n">{t(section)}</span></span>
      </div>
      )}
      <div className="prog" aria-hidden="true"><div className="prog-bar" ref={bar} /></div>
      {open ? <nav className="hd-drawer" aria-label={t('nav.main')}>{nav}</nav> : null}
      <SelLayer />
      <CopilotMount />
    </header>
  )
}

/** The site copilot (src/copilot), mounted after the first render on every app page, Network included: a separate
 *  React root attached to <body> (copilot/mount.tsx) */
function CopilotMount() {
  useEffect(() => {
    const go = () => { void import('../copilot/mount').then((m) => m.mountCopilot()) }
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    if (ric) ric(go, { timeout: 1500 }); else setTimeout(go, 300)
  }, [])
  return null
}
