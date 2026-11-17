// The usage page: in the column, the visitor's wallet, then, when a part is focused, its steps turned into actions.
// Each step is a state of the flow (to do, in progress, done, failed), with its transaction and its explorer link;
// the step being opened or run highlights its element in the diagram (window.__s3d).
// The pieces are shared with the app pages (kit.tsx, acts.tsx, HeaderWallet.tsx).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLang } from '../../i18n'
import { short, usdc } from '../../data/fmt'
import { useCatalog } from '../../app/useCatalog'
import { RAIL_NAME } from '../../app/catalog'
import { parts, type Part } from '../data'
import { useUi, setUi, getUi } from './store'
import { w } from './strings'
import { play, exitFocus } from './kit'
import { UseActs, RentActs, PublishActs, Cctp } from './acts'

export { HeaderWallet } from './HeaderWallet'
export { exitFocus } from './kit'

/** The part open in the column (scene.ts writes it to #col[data-col]). */
function useView(): 'ensemble' | Part {
  const [v, setV] = useState<'ensemble' | Part>(() => (document.querySelector('#col')?.getAttribute('data-col') as Part) ?? 'ensemble')
  useEffect(() => {
    const col = document.querySelector('#col'); if (!col) return
    const mo = new MutationObserver(() => setV((col.getAttribute('data-col') as Part) ?? 'ensemble'))
    mo.observe(col, { attributes: true, attributeFilter: ['data-col'] })
    return () => mo.disconnect()
  }, [])
  return v
}


// ---------- the catalog, on the right in place of the scene, while a service is chosen (Use) ----------
const ledCls = (l: string) => (l === 'off' ? 'led' : `led led-${l}`)
export function ServiceCatalog() {
  const lang = useLang()
  const { catOpen, pid } = useUi()
  const rows = useCatalog()
  const list = useMemo(() => (rows ?? []).filter((r) => r.p.state !== 'Retired'), [rows])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    document.querySelector('#net')?.setAttribute('data-cat', catOpen ? '1' : '0')
    if (catOpen) { const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('.svc-b[aria-pressed="true"], .svc-b')?.focus({ preventScroll: true }), 280); return () => clearTimeout(t) }
  }, [catOpen])
  const close = () => { setUi({ catOpen: false }); document.getElementById('u-pick')?.focus() }
  const choose = (id: string) => { setUi({ pid: id, catOpen: false }); document.getElementById('u-pick')?.focus(); play('use', 2, 'todo', 'link.useArc', false) }
  return (
    <div className="net-cat" id="net-cat" ref={ref} data-on={catOpen ? '1' : '0'} inert={!catOpen ? true : undefined} aria-hidden={!catOpen} role="region" aria-labelledby="net-cat-h">
      <div className="net-cat-in">
        <div className="net-cat-top">
          <h2 className="net-cat-h" id="net-cat-h">{w('u.catTitle')}</h2>
          <button type="button" className="net-x" onClick={close} aria-label={w('u.catClose')} title={w('u.catClose')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13" /></svg></button>
        </div>
        <p className="lbl muted net-cat-l">{w('u.catLede')}</p>
        <ol className="bay">
          {list.map((r) => {
            const enc = r.encs.length
            return (
              <li key={r.p.id} className={`row svc is-${r.led}`}>
                <button type="button" className="svc-b" onClick={() => choose(r.p.id)} aria-pressed={r.p.id === pid} aria-label={w('u.chooseAria', { name: `${r.name}, #${r.p.id}` })} data-pid={r.p.id}>
                  <span className={`${ledCls(r.led)} svc-led`} aria-hidden="true" />
                  <span className="svc-id"><span className={`plate is-${r.led}`}>{r.name}</span><span className="lbl muted">{/^0x0{40}$/i.test(r.p.settlement) ? `#${r.p.id}` : `#${r.p.id}, ${RAIL_NAME[r.p.settlement.toLowerCase()] ?? short(r.p.settlement, 4)}`}</span></span>
                  <span className="svc-price mono">{Number(r.p.price) ? usdc(r.p.price, lang) : w('u.free')}</span>
                  <span className="svc-encs"><span className="diodes" aria-hidden="true">{r.encs.slice(0, 12).map((x) => <i key={x.e.signer} className={`d-${x.led}`} />)}</span><span className="lbl muted">{enc ? `${r.running} / ${enc}` : ''}</span></span>
                  <span className="svc-go" aria-hidden="true">{w('u.choose')}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

/** The panel's close button: back to the overview (the scene's overview()). */
export function CloseFocus() {
  useLang()
  return <button type="button" className="net-x net-x-panel" onClick={exitFocus} aria-label={w('x.close')} title={w('x.close')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13" /></svg></button>
}

/** The actions of the open part, below the panel title. */
export function Actions() {
  useLang()
  const v = useView()
  useEffect(() => { if (v !== 'use' && getUi().catOpen) setUi({ catOpen: false }) }, [v])
  // Escape: closes the catalog if open, otherwise leaves the focus
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.hd-w-pop')) return
      // capture phase and stopped: scene.ts also listens to Escape (back to the overview), the catalog comes first
      if (getUi().catOpen) { e.stopPropagation(); setUi({ catOpen: false }); document.getElementById('u-pick')?.focus(); return }
      if (v !== 'ensemble') { exitFocus(); document.querySelector<HTMLElement>('#choices .net-part')?.focus() }
    }
    addEventListener('keydown', k, true)
    return () => removeEventListener('keydown', k, true)
  }, [v])
  if (v === 'ensemble') return null
  // CCTP focus: the real balances read on the other chains
  if ((v as string) === 'arc' || (v as string) === 'demo') return null // Arc and demo focus have no actions
  if ((v as string) === 'cctp') return <div className="net-acts" data-part="cctp"><Cctp /></div>
  return <div className="net-acts" data-part={v}>{v === 'use' ? <UseActs label={parts().use.title} /> : v === 'rent' ? <RentActs label={parts().rent.title} /> : <PublishActs label={parts().publish.title} />}</div>
}
