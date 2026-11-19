// The old work pages (bounty, sessions, operator) moved into My space: send the visitor there, keeping the query
// (?p=, ?url=…) and the hash, without leaving the old address in the history.
export function toSpace(tab: 'bounties' | 'sessions' | 'machines') {
  const u = new URL(location.href)
  const to = new URL(`${import.meta.env.BASE_URL}space.html`, location.origin)
  u.searchParams.forEach((v, k) => to.searchParams.set(k, v))
  to.searchParams.set('tab', tab)
  to.hash = u.hash
  location.replace(to.toString())
}
