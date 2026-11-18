// Clicking a slot opens its service in place. The page does not scroll: the camera approaches the slot
// (stage.ts reads world.svc), the panel slides in from the right over the page, the address becomes that of the
// service page (history.pushState: a reload opens service.html, readable on its own). Escape, the browser Back or
// the back button close the panel; the camera returns and the scroll resumes exactly where it was (it never
// moved: Lenis is stopped and the root does not scroll while open).
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useLive } from '../data/live'
import { productLabel, priceText, stateText, slotLabel, buildWall, NSLOTS, type Sled } from '../data/wall'
import { short, pct, num } from '../data/fmt'
import { t, useLang } from '../i18n'
import { link, serviceHref, networkFor } from '../links'
import { getLenis } from '../clock'
import { world, setLock } from '../world'
import { leaveTo } from './veil'

/** Service page address of a slot: its product, otherwise its slot */
export const svcHref = (i: number) => { const p = world.wall.sleds[i]?.product; return p ? `/service.html?p=${p.id}` : `/service.html?slot=${i}` }

const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
export const useSvc = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => (world.svc.open ? world.svc.slot : -1))

let back: HTMLElement | null = null
function apply(i: number) {
  world.svc.open = true; world.svc.slot = i
  setLock(-1); world.arming = 0
  getLenis()?.stop()
  document.documentElement.classList.add('svc-open')
  emit()
}
function shut() {
  if (!world.svc.open) return
  world.svc.open = false
  document.documentElement.classList.remove('svc-open')
  getLenis()?.start()
  emit()
  back?.focus?.({ preventScroll: true }); back = null
}
/** Where a slot leads: its service's page (description, and a button to use it), an enclave without a read product to
 *  the catalog of services, a free slot to Network's Rent part */
export const slotHref = (i: number) => {
  const s = world.wall.sleds[i], p = s?.product
  return p ? serviceHref(p.id) : s?.enclave ? link.catalog : networkFor('rent')
}
/** A slot (mouse, touch, keyboard) opens its service's page; the in-place panel is no longer used */
export function openService(i: number) {
  if (i < 0) return
  leaveTo(slotHref(i))
}
/** Former in-place opening, kept for service.html links */
export function openServiceInPlace(i: number) {
  if (i < 0) return
  if (world.svc.open && world.svc.slot === i) return
  back = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
  const replace = world.svc.open
  apply(i)
  const st = { svc: i }
  if (replace) history.replaceState(st, '', svcHref(i)); else history.pushState(st, '', svcHref(i))
}
/** Closes: through history if opening left an entry there (Back and the button do the same) */
export function closeService() {
  if (!world.svc.open) return
  if ((history.state as { svc?: number } | null)?.svc !== undefined) history.back()
  else shut()
}
if (typeof window !== 'undefined') {
  addEventListener('popstate', (e) => {
    const s = (e.state as { svc?: number } | null)?.svc
    if (typeof s === 'number' && s >= 0) apply(s)
    else shut()
  })
}

/** Service page content: shared by the panel and by service.html */
export function ServiceBody({ pid, slot, sled, inPanel = false }: { pid?: string | null; slot?: number; sled?: Sled; inPanel?: boolean }) {
  const lang = useLang()
  const products = useLive((s) => s.products)
  const bounties = useLive((s) => s.bounties)
  const p = pid ? products?.find((x) => x.id === pid) : sled?.product
  const e = sled?.enclave
  return (
    <>
      {/* in the panel, the header already shows the slot */}
      {p ? <p className="lbl muted">{`${t('svc.page')} #${p.id}`}</p>
        : inPanel ? null
        : <p className="lbl muted">{slot !== undefined && slot >= 0 ? `${t('svc.slot')}, ${slotLabel(slot)}` : t('svc.page')}</p>}
      {/* reading title is named; an occupied slot without a read product shows its slot, not "Open slot" */}
      <h1 className="h2" tabIndex={-1} data-svc-h>{p ? productLabel(p, products, bounties) : pid ? (products ? t('svc.none') : t('svc.loading')) : sled ? (e ? t('svc.enclave') : t('plate.off')) : slot !== undefined && slot >= 0 ? t('svc.loadingSlot') : t('svc.loading')}</h1>
      {p ? <p className="body">{t('svc.soon')}</p> : sled && !e ? <p className="body">{t('card.empty')}</p> : null}
      {p || e ? (
        <dl className="svc-dl">
          {sled ? <div><dt>{t('card.state')}</dt><dd className="mono">{stateText(sled)}</dd></div> : null}
          {p ? <div><dt>{t('card.price')}</dt><dd className="mono">{priceText(p, bounties)}</dd></div> : null}
          {p ? <div><dt>{t('l1.author')}</dt><dd className="mono">{short(p.author, 4)}</dd></div> : null}
          {p ? <><div><dt>{t('rent.share')}</dt><dd className="mono">{pct(p.bpsOperator, lang)}</dd></div><div><dt>{t('split.author')}</dt><dd className="mono">{pct(p.bpsAuthor, lang)}</dd></div><div><dt>{t('publish.network')}</dt><dd className="mono">{pct(p.bpsNetwork, lang)}</dd></div></> : null}
          {e ? <div><dt>{t('card.operator')}</dt><dd className="mono">{short(e.operator, 4)}</dd></div> : null}
          {e ? <div><dt>{t('card.anchored')}</dt><dd className="mono">{t('card.block', { n: num(Number(e.anchorBlock), lang) ?? '' })}</dd></div> : null}
        </dl>
      ) : null}
      {p ? <a className="btn btn-main btn-s" href={serviceHref(p.id)} data-slot="USE"><span>{t('svc.use')}</span></a>
        : sled && !e ? <a className="btn btn-line btn-s" href={link.rent} data-slot="RENT"><span>{t('card.rent')}</span></a> : null}
    </>
  )
}

/** service.html read on its own: the product (?p=) or the slot (?slot=), read live. A slot outside the
 *  wall does not exist (undefined, the page says so) */
export function useStandaloneSled(slot: number) {
  const enclaves = useLive((s) => s.enclaves)
  const products = useLive((s) => s.products)
  const bounties = useLive((s) => s.bounties)
  const activity = useLive((s) => s.activity)
  const proof = useLive((s) => s.proof)
  const chain = useLive((s) => s.chain)
  if (!Number.isInteger(slot) || slot < 0 || slot >= NSLOTS || !enclaves) return undefined
  // the same pose as the landing wall (proof slot at the hero slot): ?slot= shows the same slot
  return buildWall(enclaves, products ?? [], bounties ?? [], activity ?? [], proof?.enclave?.signer, proof?.registerTx, chain).sleds[slot]
}

export function ServicePanel() {
  const open = useSvc()
  useLang()
  const box = useRef<HTMLDivElement>(null)
  const last = useRef(-1)
  if (open >= 0) last.current = open
  const i = last.current
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && world.svc.open) { e.preventDefault(); closeService() } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])
  useEffect(() => {
    if (open < 0) return
    const h = box.current?.querySelector<HTMLElement>('[data-svc-h]')
    const id = setTimeout(() => h?.focus({ preventScroll: true }), 80)
    return () => clearTimeout(id)
  }, [open])
  const sl = i >= 0 ? world.wall.sleds[i] : undefined
  return (
    <aside className={`svc-panel ${open >= 0 ? 'on' : ''}`} ref={box} role="dialog" aria-modal="true" aria-label={t('svc.panel')} aria-hidden={open < 0} inert={open < 0 ? true : undefined} data-ui data-front-free>
      <div className="svc-in">
        <div className="svc-top">
          <span className="lbl muted mono">{i >= 0 ? slotLabel(i) : ''}</span>
          <button className="svc-x" onClick={closeService} data-slot="BACK">{t('svc.close')}</button>
        </div>
        {i >= 0 ? <ServiceBody slot={i} sled={sl ?? { i, led: 'off' }} inPanel /> : null}
        {/* no keyboard hint on a touch screen */}
        <p className="lbl muted no-touch">{t('card.esc')}</p>
      </div>
    </aside>
  )
}
