// The scene language follows the page language (html[lang], set by the site i18n): English by default.
export type Lg = 'en' | 'fr'
export const lg = (): Lg => (document.documentElement.lang || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en'
export const tx = (en: string, fr: string) => (lg() === 'fr' ? fr : en)
export function onLang(f: () => void) { new MutationObserver(f).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] }) }
