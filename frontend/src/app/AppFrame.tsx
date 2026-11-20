// Frame of the app pages: the landing's two-row header, without the scene. The first row holds the logo, the menu
// (current page marked) and the wallet; the second, the live reading of Arc testnet. The bottom rule is first the
// loading bar (the API, then the Arc block), then the page scroll progress.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLive, blockTime, ago } from '../data/live'
import { num, usdc } from '../data/fmt'
import { t, useLang, type TKey } from '../i18n'
import { link } from '../links'
import { onTick } from '../clock'
import { Logo } from '../ui/Logo'
import { SelLayer } from '../ui/Sel'
import { PageCursor } from '../ui/PageCursor'
import { reveal } from '../ui/motion'
import { loadP, installPageExit } from '../ui/pageload'
import { MainNav, BridgeNav } from '../ui/MainNav'
import { useMenu, MenuButton, Drawer } from '../ui/Menu'
import { HeaderWallet } from '../network/actions/HeaderWallet'
import '../network/actions/actions.css'

export type AppPage = 'use' | 'service' | 'demo' | 'rent' | 'publish' | 'network' | 'bounty' | 'sessions' | 'operator' | 'doc' | 'space' | 'bridge'

/** replay: the replayed demo reads nothing live; the second row shows the recording */
/** wallet: the visitor's wallet button, the same on every app page (the replayed demo has none). The copilot bubble
 *  follows, except on the demo and on the Network page, whose scene uses the corners. */
/** sectionText: a section name the page holds itself (the doc page keeps its strings apart from i18n.ts) */
export function AppHeader({ page, section, sectionText, replay, wallet }: { page: AppPage; section: TKey; sectionText?: string; replay?: { block: number; date: string }; wallet?: ReactNode }) {
  const walletEl = wallet ?? (replay ? null : <HeaderWallet />)
  const lang = useLang()
  const [open, setOpen] = useMenu()
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
  // the bar: the page's loading (carried over from the page before, full when the page is ready), then the scroll
  // position; on a link to another page it becomes the loading bar again (ui/pageload.ts, MOTION.md M9)
  useEffect(() => { installPageExit() }, [])
  // the page height is read only when the scroll, the size or the loading state changed (no layout read per frame)
  const lastR = useRef('')
  useEffect(() => onTick(() => {
    const L = loadP()
    const key = `${scrollY}|${innerWidth}|${innerHeight}|${L}|${document.body.childElementCount}`
    if (key === lastR.current) return
    lastR.current = key
    const max = document.documentElement.scrollHeight - innerHeight
    const p = L < 1 ? L : max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 1
    if (bar.current) { bar.current.style.transform = `scaleX(${p.toFixed(4)})`; bar.current.dataset.load = L < 1 ? '1' : '0' }
  }), [])
  // motion rule M2 on arrival: the page's content rises block by block under a header that never moves (M1)
  useEffect(() => { requestAnimationFrame(() => reveal(document.querySelector('main'))) }, [])
  const navPage = page === 'network' ? 'network' : page === 'service' ? 'catalog' : page === 'doc' ? 'doc' : page === 'bridge' ? 'bridge' : 'other'
  const nav = <MainNav page={navPage} />
  return (
    <header className="hd app-hd-bar" data-front-free>
      <div className="hd-row1">
        <a className="logo" href={link.home} aria-label="ArcHive"><Logo /></a>
        <nav className="hd-nav" aria-label={t('nav.main')}>{nav}</nav>
        <div className="hd-side">
          {/* the bridge, at the right next to the wallet (hidden under 1100 px: it is in the menu) */}
          <div className="hd-nav hd-br"><BridgeNav current={page === 'bridge'} /></div>
          {walletEl}
          <MenuButton open={open} set={setOpen} />
        </div>
      </div>
      {replay ? (
        <div className="hd-row2 lbl" aria-live="off">
          {/* the narrowest phones keep the recorded block, whole; the network name goes (styles.css, under 360 px) */}
          <span className="band-i band-net-r"><b>{t('band.net')}</b></span>
          <span className="band-i">{t('demo.band')} <span className="nowrap">{replay.date}</span></span>
          <span className="band-i">{t('demo.band.block')} <span className="mono tnum nowrap">{num(replay.block, lang)}</span></span>
          <span className="band-sec"><span className="sec-n">{sectionText ?? t(section)}</span></span>
        </div>
      ) : (
      <div className="hd-row2 lbl" aria-live="off">
        <span className="band-i"><b>{t('band.net')}</b></span>
        <span className="band-i">{t('band.block')} <span className="mono tnum nowrap">{block ? num(block, lang) : t('band.reading')}</span></span>
        {/* as on the landing: a live count of verified machines with no ceiling, never a share of the registered ones */}
        <span className="band-i band-mach">
          <span className="band-v">{stats ? <><span className="mono tnum">{num(stats.enclavesActive, lang)}</span> {t(stats.enclavesActive === 1 ? 'band.mach1' : 'band.mach')}</> : <>{t('band.mach.r')} <span className="mono">{t('band.reading')}</span></>}</span>
          <span aria-hidden="true">·</span>
          <span>{t('band.open')}</span>
        </span>
        <span className="band-i band-pay">{t('band.paid')} <span className="mono tnum nowrap">{pay ? `${usdc(pay.args.amount ?? pay.args.paidDelta, lang)}, ${t('word.block')} ${num(pay.block, lang)}${payAt ? `, ${ago(payAt, lang)}` : ''}` : activity ? t('end.none') : t('band.reading')}</span></span>
        <span className="band-sec"><span className="sec-n">{sectionText ?? t(section)}</span></span>
      </div>
      )}
      <div className="prog" aria-hidden="true"><div className="prog-bar" ref={bar} /></div>
      {open ? <Drawer nav={<MainNav page={navPage} drawer />} close={() => setOpen(false)} /> : null}
      <SelLayer />
      <PageCursor />
      <CopilotMount />
    </header>
  )
}

/** AskHive (src/copilot), mounted after the first render on every app page, Network included: a separate
 *  React root attached to <body> (copilot/mount.tsx) */
function CopilotMount() {
  // at once, not on an idle callback: the 3D room of the Network pages keeps the browser busy for seconds, and the
  // launcher was missing all that time; its module is fetched before the room's assets
  useEffect(() => { void import('../copilot/mount').then((m) => m.mountCopilot()) }, [])
  return null
}
