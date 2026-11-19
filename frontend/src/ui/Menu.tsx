// The header menu under 1100 px (phones, tablets), shared by the landing header (Frame.tsx) and the app header
// (AppFrame.tsx): the Menu button, then the drawer with the main navigation (current page marked) and, on the
// narrowest phones (under 375 px, where the header row has no room for it), the language. The drawer closes on any of
// its links (Network switches its parts in place, so the drawer must close itself), on Escape, on a tap outside it (a
// dim layer under it) and when the window grows past 1100 px; the page behind does not scroll while it is open.
import { useEffect, useState, type ReactNode } from 'react'
import { t, useLang, setLang } from '../i18n'
import { getLenis } from '../clock'

export function useMenu() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.classList.add('menu-open')
    // the landing scrolls through Lenis: it stops with the page (the service panel does the same)
    const l = getLenis()
    l?.stop()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('keydown', key)
    const wide = matchMedia('(min-width: 1101px)')
    const grow = () => { if (wide.matches) setOpen(false) }
    wide.addEventListener('change', grow)
    return () => {
      root.classList.remove('menu-open')
      if (!root.classList.contains('svc-open')) l?.start()
      removeEventListener('keydown', key)
      wide.removeEventListener('change', grow)
    }
  }, [open])
  return [open, setOpen] as const
}

export function MenuButton({ open, set }: { open: boolean; set: (v: boolean) => void }) {
  return <button type="button" className="menu-btn" aria-expanded={open} aria-controls="hd-drawer" onClick={() => set(!open)}>{open ? t('nav.close') : t('nav.menu')}</button>
}

export function Drawer({ nav, close }: { nav: ReactNode; close: () => void }) {
  const lang = useLang()
  return (
    <>
      <div className="hd-scrim" aria-hidden="true" onClick={close} />
      <nav id="hd-drawer" className="hd-drawer" aria-label={t('nav.main')} onClick={(e) => { if ((e.target as Element).closest('a')) close() }}>
        {nav}
        {/* the language moves here only where the header row has no room for it (styles.css, 374 px) */}
        <div className="hd-drawer-x">
          <button type="button" className="hd-drawer-lang" lang={lang === 'fr' ? 'en' : 'fr'} aria-label={t('lang.to')} onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}>{lang === 'fr' ? 'English' : 'Français'}</button>
        </div>
      </nav>
    </>
  )
}
