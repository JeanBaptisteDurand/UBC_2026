// The live strip at the bottom of every page: every service registered on Arc, its state in the wall's colours
// (running now in green, waiting in amber, retired in red), read live and scrolling in an endless loop. One slot per
// service: the strip grows on its own when a service is published. A click picks the service in Network's Use part.
import { t, useLang } from '../i18n'
import { usdc, num } from '../data/fmt'
import { useCatalog } from '../app/useCatalog'
import { isSupersededRow, type SvcRow } from '../app/catalog'
import { link } from '../links'
import './ticker.css'

function Item({ r }: { r: SvcRow }) {
  const lang = useLang()
  const word = r.running ? t('tk.running', { n: num(r.running, lang) ?? '' }) : r.led === 'red' ? t('tk.retired') : t('tk.waiting')
  return (
    <a className="tk-i" data-led={r.led} href={`${link.services}&p=${encodeURIComponent(r.p.id)}`}>
      <i className="tk-led" aria-hidden="true" />
      <span className="tk-n">{r.name}</span>
      <span className="tk-w">{word}</span>
      <span className="tk-p">{Number(r.p.price) ? usdc(r.p.price, lang) : t('tk.free')}</span>
    </a>
  )
}

export function Ticker() {
  useLang()
  const rows = useCatalog()
  const list = (rows ?? []).filter((r) => !isSupersededRow(r))
  if (!list.length) return null
  const run = list.filter((r) => r.running > 0).length
  // the list twice in a row: the track slides by half its length, so the loop never shows a seam
  return (
    <aside className="tk" aria-label={t('tk.aria', { a: run, b: list.length })} data-ui data-front-free>
      <span className="tk-l"><i aria-hidden="true" />{t('tk.label')}</span>
      <div className="tk-v">
        <div className="tk-track" style={{ animationDuration: `${Math.max(24, list.length * 7)}s` }}>
          {[0, 1].map((k) => <div className="tk-set" key={k} aria-hidden={k === 1 ? true : undefined}>{list.map((r) => <Item key={r.p.id} r={r} />)}</div>)}
        </div>
      </div>
    </aside>
  )
}
