// The usage page: in the column, the visitor's wallet, then, when a part is focused, its steps turned into actions.
// Each step is a state of the flow (to do, in progress, done, failed), with its transaction and its explorer link;
// the step being opened or run highlights its element in the diagram (window.__s3d).
// The pieces are shared with the app pages (kit.tsx, acts.tsx, HeaderWallet.tsx).
import { useEffect, useState } from 'react'
import { useLang, t } from '../../i18n'
import { link } from '../../links'
import { parts, type Part } from '../data'
import { w } from './strings'
import { exitFocus } from './kit'
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


/** The panel's close button: back to the overview (the scene's overview()). */
export function CloseFocus() {
  useLang()
  return <button type="button" className="net-x net-x-panel" onClick={exitFocus} aria-label={w('x.close')} title={w('x.close')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13" /></svg></button>
}

/** The actions of the open part, below the panel title. */
export function Actions() {
  useLang()
  const v = useView()
  // Escape: leaves the focus
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.hd-w-pop')) return
      if (v !== 'ensemble') { exitFocus(); document.querySelector<HTMLElement>('#choices .net-part')?.focus() }
    }
    addEventListener('keydown', k, true)
    return () => removeEventListener('keydown', k, true)
  }, [v])
  if (v === 'ensemble') return null
  // CCTP focus: the real balances read on the other chains
  if ((v as string) === 'arc' || (v as string) === 'demo') return null // Arc and demo focus have no actions
  if ((v as string) === 'cctp') return <div className="net-acts" data-part="cctp"><Cctp /></div>
  // Use: the services live on the Services page (the rack, each sheet with its action); here, one way there, then the
  // steps of a paid call (they follow the diagram and its demo); picking a service also goes there
  if (v === 'use') return (
    <div className="net-acts" data-part="use">
      <div className="net-go-cat">
        <p className="net-go-cat-t">{t('net.cat.t')}</p>
        <a className="btn btn-main" href={link.catalog}><span>{t('net.cat.b')}</span><span aria-hidden="true">→</span></a>
      </div>
      <UseActs label={parts().use.title} onPick={() => { location.href = link.catalog }} />
    </div>
  )
  return <div className="net-acts" data-part={v}>{v === 'rent' ? <RentActs label={parts().rent.title} /> : <PublishActs label={parts().publish.title} />}</div>
}
