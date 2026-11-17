// Arc focus panel: what the protocol does on-chain, contract by contract
// (demo-strings.ts). One collapsible block per contract: role, functions and
// callers, events, rejections (error names from the code), v2.1 address linked to the Arc explorer.
import { addrUrl } from '../data/fmt'
import { CONTRACTS, ARC_INTRO, UI, tr } from './demo-strings'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function arcPanel(host: HTMLElement, show: boolean) {
  let box = host.querySelector<HTMLElement>('#arc-panel')
  if (!show) { if (box) box.hidden = true; return }
  if (!box) { box = document.createElement('div'); box.id = 'arc-panel'; box.className = 'arcp'; host.appendChild(box) }
  box.hidden = false
  const open = new Set([...box.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.id))
  box.innerHTML = `<p class="arcp-intro">${esc(tr(ARC_INTRO))}</p>` + CONTRACTS.map((c, i) => `
    <details class="arcp-c" data-id="${c.id}"${open.has(c.id) || (!open.size && i === 2) ? ' open' : ''}>
      <summary><span class="arcp-n mono">${String(i + 1).padStart(2, '0')}</span><span class="arcp-t">${esc(c.name)}</span>${c.addr ? `<span class="arcp-a mono">${short(c.addr)}</span>` : ''}</summary>
      <p class="arcp-r">${esc(tr(c.role))}</p>
      ${c.fns.map((f) => `<div class="arcp-f">
        <p class="arcp-sig mono">${esc(f.sig)}</p>
        <p class="arcp-d"><span class="arcp-k">${esc(tr(UI.calls))}</span> ${esc(tr(f.who))}. ${esc(tr(f.does))}</p>
        ${f.emits?.length ? `<p class="arcp-d"><span class="arcp-k">${esc(tr(UI.emits))}</span> <span class="mono">${f.emits.map(esc).join(', ')}</span></p>` : ''}
        ${f.checks?.length ? `<p class="arcp-d"><span class="arcp-k">${esc(tr(UI.errs))}</span> <span class="mono">${f.checks.map(esc).join(', ')}</span></p>` : ''}
      </div>`).join('')}
      ${c.note ? `<p class="arcp-d">${esc(tr(c.note))}</p>` : ''}
      ${c.addr ? `<p class="arcp-d"><span class="arcp-k">${esc(tr(UI.addr))}</span> <a class="tlink mono" href="${addrUrl(c.addr)}" target="_blank" rel="noreferrer">${esc(c.addr)}</a></p>` : ''}
    </details>`).join('')
}
