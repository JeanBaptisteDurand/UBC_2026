// Network-paused banner. When the API reads 0 active enclaves, every page says so calmly, under the live
// reading of the header, with the link to the replayed demo (a real run, recorded). Nothing when an enclave
// is active, nor before the first reading (no guessing). Its height adds to --hd (styles.css): the page never
// goes under it.
import { useLayoutEffect, useRef } from 'react'
import { useLive } from '../data/live'
import { t, useLang } from '../i18n'
import { link } from '../links'

export function PauseBand() {
  useLang()
  const paused = useLive((s) => s.stats?.enclavesActive === 0)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = document.documentElement
    const el = ref.current
    if (!paused || !el) return
    const put = () => root.style.setProperty('--pause-h', `${el.offsetHeight}px`)
    put()
    root.dataset.paused = '1'
    const ro = new ResizeObserver(put)
    ro.observe(el)
    return () => { ro.disconnect(); root.style.removeProperty('--pause-h'); delete root.dataset.paused }
  }, [paused])
  if (!paused) return null
  return (
    <div className="pause lbl" ref={ref} role="status">
      <span className="led led-amber" aria-hidden="true" />
      <p className="pause-t">
        <span className="pause-long">{t('pause.t')} {t('pause.more')}</span>
        <span className="pause-short">{t('pause.short')}</span>
        {' '}<a className="tlink pause-a" href={link.demo}>{t('pause.link')}</a>
      </p>
    </div>
  )
}
