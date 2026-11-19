// Footer shared by the landing and the app.
import { t, useLang } from '../i18n'
import { Logo } from './Logo'
import { link } from '../links'

export function Footer({ replay = false }: { replay?: boolean } = {}) {
  useLang()
  // The footer does not repeat the header (which stays attached to the page). On the left, our logo then "Powered by"
// and the Arc kit logo (arc-logo-white.svg, unmodified, 50 px, clear space kept, set back from ours); on the
// right, the authors and the notice
  return (
    <footer className="foot">
      <div className="foot-l">
        <a className="logo" href={link.home} aria-label="ArcHive"><Logo height={84} /></a>
        <p className="foot-arc" aria-label={t('foot.powered')}><span className="lbl muted">{t('foot.by')}</span><img src="/arc-logo-white.svg" alt="Arc" width="146" height="50" /></p>
      </div>
      <div className="foot-r">
        <p className="foot-auth">{t('foot.authors')}</p>
        <p className="lbl muted">{t('foot.made')}</p>
        <p className="lbl muted">{t(replay ? 'foot.note.replay' : 'foot.note')}</p>
      </div>
    </footer>
  )
}
