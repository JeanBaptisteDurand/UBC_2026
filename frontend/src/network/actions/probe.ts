// A service's state, read without signing or inventing anything: a read of /pubkeys (enclave) or /health (copilot,
// API). In an insecure context, encrypted flows cannot start: this is reported before reading.
import { useEffect, useState } from 'react'
import { diagnose, secure, isNetErr } from '../../data/endpoints'

export type Probe = 'checking' | 'up' | 'offline' | 'cors' | 'insecure' | 'error'

const cache = new Map<string, { at: number; v: Promise<Probe> }>()
export function probe(url: string, path = '/pubkeys', needsSecure = true): Promise<Probe> {
  if (needsSecure && !secure()) return Promise.resolve('insecure')
  const u = `${url.replace(/\/+$/, '')}${path}`
  const c = cache.get(u)
  if (c && Date.now() - c.at < 20_000) return c.v
  const v = (async (): Promise<Probe> => {
    try {
      const r = await fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      if (r.ok) return 'up'
      return r.status === 502 || r.status === 503 || r.status === 504 || r.status === 404 ? 'offline' : 'error'
    } catch (e) {
      if ((e as Error)?.name === 'TimeoutError') return 'offline'
      return isNetErr(e) ? diagnose(u) : 'offline'
    }
  })()
  cache.set(u, { at: Date.now(), v })
  return v
}

/** A service's state, re-read every 30 s while the page is visible. */
export function useProbe(url: string | null, path = '/pubkeys', needsSecure = true): Probe {
  const [p, setP] = useState<Probe>('checking')
  useEffect(() => {
    if (!url) return
    let alive = true
    const run = () => { if (!document.hidden) probe(url, path, needsSecure).then((v) => { if (alive) setP(v) }) }
    run()
    const iv = setInterval(() => { cache.delete(`${url.replace(/\/+$/, '')}${path}`); run() }, 30_000)
    return () => { alive = false; clearInterval(iv) }
  }, [url, path, needsSecure])
  return p
}
