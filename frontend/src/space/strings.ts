// My space strings, in English (the site is English only). Kept apart from i18n.ts; the tabs reuse the strings of the pages they hold (strings-x.ts).
import { useLang } from '../i18n'

const EN = {
  'sp.title': 'ArcHive. My space',
  'sp.sec': 'My space',
  'sp.nav': 'My space',
  'sp.skip': 'Skip to my space',
  'sp.h.a': 'My ', 'sp.h.b': 'space', 'sp.h.c': '.',
  'sp.lede': 'Everything tied to your wallet on Arc: the bounties you posted or hunt, your prepaid sessions, the machines you rent out and the services you published. No account: your address is your profile.',
  'sp.connect': 'Connect a wallet to see what is yours on Arc.',
  'sp.connect.b': 'Connect wallet',
  'sp.wrong': 'Switch the wallet to Arc testnet to read what is yours.',
  'sp.reading': 'Reading what {a} holds on Arc',
  'sp.as': 'Signed in as {a}',
  'sp.tabs': 'My space',
  'sp.t.bounties': 'My bounties',
  'sp.t.sessions': 'My sessions',
  'sp.t.machines': 'My machines',
  'sp.t.services': 'My services',
  'sp.empty.h': 'Nothing on Arc for this address yet.',
  'sp.empty.d': 'Use a service, rent out a machine or publish your own: it will show here.',
  'sp.empty.use': 'Use a service',
  'sp.empty.rent': 'Rent out your machine',
  'sp.empty.pub': 'Publish your service',
  // My services
  'sp.s.lede': 'The products this address proposed on ProductRegistry, read live.',
  'sp.s.none': 'This address has not published a service.',
  'sp.s.h.p': 'Product',
  'sp.s.h.state': 'State',
  'sp.s.h.price': 'Price',
  'sp.s.h.share': 'Your share',
  'sp.s.row': 'Product #{id}',
  'sp.s.st.Proposed': 'Proposed',
  'sp.s.st.Active': 'Active',
  'sp.s.st.Retired': 'Retired',
  'sp.s.on': 'activates {when}',
  'sp.s.activate': 'Activate',
  'sp.s.activating': 'Sign the activation in your wallet',
  'sp.s.activated': 'Activated on Arc.',
  'sp.s.open': 'Open its sheet',
  'sp.s.paid': 'What you received is in your address’s transfers on the explorer.',
  'sp.s.paid.a': 'See the transfers',
  'sp.s.publish': 'Publish another service',
}
type K = keyof typeof EN

export type SpKey = K
export function useSt() {
  const lang = useLang()
  const S: Record<K, string> = EN
  return { lang, s: (k: K, v?: Record<string, string | number>) => S[k].replace(/\{(\w+)\}/g, (_, x) => String(v?.[x] ?? '')) }
}
/** outside React (the header link) */
export const spText = (_lang: string, k: K): string => EN[k]
