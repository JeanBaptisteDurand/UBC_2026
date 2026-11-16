import { getLang } from '../i18n'
// Hashes and addresses are truncated with an ellipsis; USDC amounts keep their real precision.
export const short = (h?: string | null, n = 6) => (h ? `${h.slice(0, n + 2)}…${h.slice(-4)}` : '')
export const usdc = (micro?: string | number | null, lang: string = getLang()) => {
  if (micro === undefined || micro === null || micro === '') return null
  const v = Number(micro) / 1e6
  const s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  const out = s.includes('.') ? s : v.toFixed(2)
  // Decimal comma in French, same precision
  return `${lang === 'fr' ? out.replace('.', ',') : out} USDC`
}
/** An amount already in USDC (gas cost), 4 decimals */
export const usdc4 = (v: number, lang: string = getLang()) => `${v.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} USDC`
export const num = (n?: number | null, lang = 'en') => (n === undefined || n === null || !Number.isFinite(n) ? null : n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US'))
/** "95%" in English, "95 %" in French (non-breaking space) */
export const pct = (bps: number, lang = 'en') => {
  const v = (bps / 100).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 })
  return lang === 'fr' ? `${v}\u00a0%` : `${v}%`
}
export const txUrl = (h: string) => `https://explorer.testnet.arc.io/tx/${h}`
export const addrUrl = (a: string) => `https://explorer.testnet.arc.io/address/${a}`
