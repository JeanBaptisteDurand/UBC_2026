// The main navigation, the same on every page (the logo leads to the landing): Network, then its three parts (Service = use a service,
// Rent = rent a machine, Publish = publish a service). On the Network page the parts switch in place (the scene's own
// buttons), elsewhere they open network.html?focus=<part>. The current entry follows the open part (#col data-col).
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { link, networkFor } from '../links'
import { useWallet } from '../network/actions/store'
import { bt, BRIDGE_HREF } from '../bridge/strings'
import '../bridge/nav.css'

type Cur = 'home' | 'network' | 'catalog' | 'use' | 'rent' | 'publish' | 'doc' | 'bridge' | ''
const PARTS = ['use', 'rent', 'publish'] as const

/** The Bridge entry (CCTP, USDC from another testnet to Arc): at the right of the header, before the language and the
 *  wallet (Frame.tsx, AppFrame.tsx), and last in the phone menu. Open only with a wallet connected, greyed out and
 *  not clickable without one (bridge/nav.css). */
export function BridgeNav({ current = false }: { current?: boolean }) {
  const w = useWallet()
  const walletOn = w.phase === 'connected' && !!w.address
  return walletOn ? (
    <a className="nav-br" href={BRIDGE_HREF} aria-current={current ? 'page' : undefined} title={bt('nav.t')}>{bt('nav')}</a>
  ) : (
    // its hint is in the text (nav-br-h), not in a title too; a tap does nothing, and does not close the phone menu
    // (Menu.tsx closes the drawer on any of its links)
    <a className="nav-br" role="link" aria-disabled="true" tabIndex={0} onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>{bt('nav')}<span className="nav-br-h">{bt('nav.off')}</span></a>
  )
}

/** drawer: the phone menu's copy, which also holds the Bridge entry (on wide screens it sits at the right) */
export function MainNav({ page, drawer = false }: { page: 'home' | 'network' | 'catalog' | 'doc' | 'bridge' | 'other'; drawer?: boolean }) {
  const [cur, setCur] = useState<Cur>(page === 'home' ? 'home' : page === 'catalog' ? 'catalog' : page === 'doc' ? 'doc' : page === 'bridge' ? 'bridge' : '')
  useEffect(() => {
    if (page !== 'network') return
    const col = document.getElementById('col')
    const read = () => { const v = col?.dataset.col ?? 'ensemble'; setCur(v === 'use' || v === 'rent' || v === 'publish' ? v : 'network') }
    read()
    if (!col) return
    const mo = new MutationObserver(read); mo.observe(col, { attributes: true, attributeFilter: ['data-col'] })
    return () => mo.disconnect()
  }, [page])
  const at = (k: Cur) => (k === cur ? { 'aria-current': 'page' as const } : {})
  // on Network, the scene switches the part itself (its buttons carry data-view)
  const inPlace = (v: string) => (ev: React.MouseEvent) => {
    if (page !== 'network' || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return
    const b = document.querySelector<HTMLButtonElement>(v === 'ensemble' ? '#panel .back[data-view="ensemble"]' : `#choices button[data-view="${v}"]`)
    if (!b) return
    ev.preventDefault(); b.click()
  }
  return (
    <>
      <a href={link.network} {...at('network')} onClick={inPlace('ensemble')}>{t('net.name')}</a>
      <a href={link.catalog} {...at('catalog')}>{t('nav.catalog')}</a>
      {PARTS.map((k) => (
        <a key={k} href={networkFor(k)} {...at(k)} onClick={inPlace(k)} title={t(`nav.${k}.t`)}>{t(`nav.${k}.n`)}</a>
      ))}
      {/* the documentation: how Arc checks every machine, chapter by chapter; the same menu on every page, the
          landing included (owner, 19/11) */}
      <a href={link.doc} {...at('doc')}>Doc</a>
      {drawer ? <BridgeNav current={cur === 'bridge'} /> : null}
    </>
  )
}
