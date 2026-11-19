// The action of a Services sheet ("Use it"), loaded with the sheet: the real signed flows, unchanged, prefilled with a
// working example. Private AI: one paid call to #3 (the Use flow), a prepaid session (#1) in My space; Sealed Bounty:
// posting a bounty (the bounty page's form), hunting in My space; Attested Copilot: the copilot panel; a product with
// no family: the Use flow for it. The wallet button is the header's; the visitor stays on the sheet.
import { useEffect } from 'react'
import { t, useLang } from '../i18n'
import { UseActs } from '../network/actions/acts'
import { setUi, useWallet, onArc } from '../network/actions/store'
import { BountyCreate } from '../app/BountyPage'
import '../network/actions/actions.css'

const space = (tab: string) => `${import.meta.env.BASE_URL}space.html?tab=${tab}`

function Connect() {
  const s = useWallet()
  if (onArc(s)) return null
  return <p className="vt-use-w"><button type="button" className="btn btn-line btn-s" onClick={() => document.getElementById('connect')?.click()}><span>{t('vit.connect')}</span></button><span className="lbl muted">{t('vit.connect.d')}</span></p>
}

export default function UseBlock({ fam, pid, back }: { fam: string | null; pid: string | null; back: () => void }) {
  useLang()
  const callPid = fam === 'private-ai' ? '3' : fam ? null : pid
  useEffect(() => { if (callPid) setUi({ pid: callPid, catOpen: false }) }, [callPid])
  if (fam === 'attested-copilot') return (
    <div className="vt-use-b">
      <p className="vt-use-d">{t('vit.cp.d')}</p>
      <p><button type="button" className="btn btn-main" onClick={() => document.querySelector<HTMLButtonElement>('.cp-launch')?.click()}><span>{t('vit.cp.b')}</span></button></p>
    </div>
  )
  if (fam === 'bounty') return (
    <div className="vt-use-b acts">
      <p className="vt-use-d">{t('vit.b.d')}</p>
      <Connect />
      <BountyCreate />
      <p className="vt-use-alt"><a className="tlink" href={space('bounties')}>{t('vit.b.hunt')}</a></p>
    </div>
  )
  if (callPid) return (
    <div className="vt-use-b acts">
      <p className="vt-use-d">{fam ? t('vit.ai.d') : t('vit.p.d')}</p>
      <Connect />
      <UseActs label={t('vit.use')} onPick={back} sheet />
      {fam === 'private-ai' ? <p className="vt-use-alt"><a className="tlink" href={space('sessions')}>{t('vit.ai.sess')}</a></p> : null}
    </div>
  )
  return null
}
