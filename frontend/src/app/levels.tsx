// The two operator levels, read from GET /levels: an enclave's "verified" badge and the card of the two paths
// (screens/Levels.tsx). Nothing is shown that the API did not state: without /levels, no badge, and the card says so.
import { useLang } from '../i18n'
import { useLive } from '../data/live'
import { Cmd } from './parts'
import { x } from '../network/actions/strings-x'

/** an enclave's level: "verified", "open", "stale" (binding to redo), or null if the API does not say */
export function useLevelOf(signer?: string): 'verified' | 'open' | 'stale' | null {
  const lv = useLive((s) => s.levels)
  if (!signer || !lv?.enclaves) return null
  const e = lv.enclaves.find((v) => v.signer.toLowerCase() === signer.toLowerCase())
  if (!e) return null
  if (e.level === 'verified') return 'verified'
  return e.ppid && !e.bindingCurrent ? 'stale' : 'open'
}

export function LevelBadge({ signer }: { signer?: string }) {
  useLang()
  const l = useLevelOf(signer)
  if (!l) return null
  return <span className="lvl-b" data-l={l} title={x(`lvl.${l}.t` as 'lvl.open.t')}>{x(`lvl.${l}` as 'lvl.open')}</span>
}

/** a service is verified if the product requires it, or if at least one of its active enclaves is */
export function useServiceLevel(productId?: string): { requires?: 'verified' | 'open'; verified: number } | null {
  const lv = useLive((s) => s.levels)
  if (!productId || !lv?.enabled) return null
  const req = lv.products?.find((p) => String(p.productId) === productId)?.requires
  const verified = (lv.enclaves ?? []).filter((e) => e.productId === productId && e.level === 'verified').length
  return { requires: req, verified }
}

export function LevelsCard() {
  const lang = useLang()
  const lv = useLive((s) => s.levels)
  const verified = lv?.enclaves?.filter((e) => e.level === 'verified') ?? []
  const machines = new Set(verified.map((e) => e.ppid)).size
  return (
    <section className="work-sec lvl-card" aria-labelledby="lvl-h">
      <h2 className="work-h" id="lvl-h">{x('lvl.title')}</h2>
      <p className="lbl muted work-lede">{x('lvl.lede')}</p>
      <div className="lvl-cols">
        <div className="lvl-col">
          <h3 className="d-h">{x('lvl.c.open')}</h3>
          <p className="body">{x('lvl.c.open.d')}</p>
          <div className="na-cmds">
            <Cmd cmd="arcvault operator init --uri https://example.org/agent.json" />
            <Cmd cmd="arcvault operator bond --amount 10" />
            <Cmd cmd="arcvault operator register --vm <url> --product <id>" />
          </div>
        </div>
        <div className="lvl-col" data-l="verified">
          <h3 className="d-h">{x('lvl.c.verified')}</h3>
          <p className="body">{x('lvl.c.verified.d')}</p>
          <div className="na-cmds">
            <Cmd cmd="arcvault operator bind-machine --signer <enclave key>" />
            <Cmd cmd="arcvault operator proof-of-cloud --signer <enclave key>" />
            <Cmd cmd="arcvault operator level --signer <enclave key> --product <id>" />
          </div>
        </div>
      </div>
      <p className="lbl lvl-live" role="status">
        {lv === undefined ? x('state.reading') : lv === null || !lv.enabled ? x('lvl.none')
          : x('lvl.live', { n: verified.length, m: machines })}
        {lv?.verifiedBounty?.slashFrom ? ` ${x('lvl.slash', { when: new Date(lv.verifiedBounty.slashFrom * 1000).toLocaleString(lang) })}` : ''}
      </p>
    </section>
  )
}
