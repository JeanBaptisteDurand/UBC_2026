// The live catalog, recomputed only when a reading changes (a single source for the page).
import { useMemo } from 'react'
import { useLive } from '../data/live'
import { useLang } from '../i18n'
import { catalog } from './catalog'

export function useCatalog() {
  const lang = useLang()
  const products = useLive((s) => s.products)
  const enclaves = useLive((s) => s.enclaves)
  const activity = useLive((s) => s.activity)
  const bounties = useLive((s) => s.bounties)
  // state read on Arc (banned operators, replaced or stopped enclaves), the same as the wall
  const chain = useLive((s) => s.chain)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => catalog({ products, enclaves, activity, bounties, chain }), [products, enclaves, activity, bounties, chain, lang])
}
