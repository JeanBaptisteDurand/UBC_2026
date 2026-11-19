// Copilot mounting, one line per page entry (main, network, service, doc, space):
//   import('./copilot/mount').then((m) => m.mountCopilot())
// A separate React root, attached to <body> (outside the page's own root). On arrival from a copilot navigation, the
// remaining gestures (state.ts, takeQueue) resume once the page is ready, with the panel open.
import { createRoot } from 'react-dom/client'
import './copilot.css'
import { Copilot, play } from './Copilot'
import { takeQueue, reloadState, setState } from './state'
import { uiStepOf, type UiStep } from './api'
import { waitReady } from './driver'
import { pageOf } from './page'
import { restore } from './wallet'

export function mountCopilot() {
  if (document.getElementById('cp-root')) return
  const host = document.createElement('div')
  host.id = 'cp-root'
  document.body.appendChild(host)
  createRoot(host).render(<Copilot />)
  void restore()
  // a page restored from the browser cache (Back) re-reads the tab's conversation
  addEventListener('pageshow', (e) => { if (e.persisted) reloadState() })
  // a "#copilot" link (the Copilot service's "Use it") opens the panel
  const hash = () => { if (location.hash === '#copilot') { setState({ open: true }); history.replaceState(null, '', location.pathname + location.search) } }
  hash(); addEventListener('hashchange', hash)
  const q = takeQueue()
  if (q && q.target === pageOf()) {
    // the rest is revalidated like a server response, then replayed once the page is ready (first read done)
    const steps = q.steps.map((s) => uiStepOf(s.tool, { ...(s.args as unknown as Record<string, unknown>) })).filter((s): s is UiStep => !!s)
    // the gesture lock (showing) holds from load: no question is sent before the resume ends
    setState({ open: true, showing: true })
    void waitReady(q.target === 'home' ? 9000 : 6000).then(() => play(q.msgId, steps)).finally(() => setState({ showing: false }))
  }
}
