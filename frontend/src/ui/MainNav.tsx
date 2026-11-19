// The main navigation, the same on every page (the logo leads to the landing): Network, then its three parts (Service = use a service,
// Rent = rent a machine, Publish = publish a service). On the Network page the parts switch in place (the scene's own
// buttons), elsewhere they open network.html?focus=<part>. The current entry follows the open part (#col data-col).
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { link, networkFor } from '../links'

type Cur = 'home' | 'network' | 'catalog' | 'use' | 'rent' | 'publish' | 'doc' | ''
const PARTS = ['use', 'rent', 'publish'] as const

export function MainNav({ page }: { page: 'home' | 'network' | 'catalog' | 'doc' | 'other' }) {
  const [cur, setCur] = useState<Cur>(page === 'home' ? 'home' : page === 'catalog' ? 'catalog' : page === 'doc' ? 'doc' : '')
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
    </>
  )
}
