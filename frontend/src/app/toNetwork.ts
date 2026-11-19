// Use, Rent and Publish are the three parts of the Network page (network.html?focus=use|rent|publish), where their
// steps are signed in place: the old use.html, rent.html and publish.html are only addresses now (links, posts, earlier
// answers of the assistant). They land on that part at once, without leaving the old address in the history, their
// query kept (?p=<product>, ?lang=); the old "Use it" of a service (use.html?act=<id>#act) picks that service (?p=<id>).
// Their sections (#act, #path) are not on Network: the hash is dropped, except #copilot (it opens the assistant).
// Without JavaScript, the page's own refresh does the same.
export function toNetwork(part: 'use' | 'rent' | 'publish') {
  const q = new URLSearchParams(location.search)
  const to = new URL(`${import.meta.env.BASE_URL}network.html`, location.origin)
  to.searchParams.set('focus', part)
  const act = q.get('act')
  if (part === 'use' && act && !q.get('p')) to.searchParams.set('p', act)
  q.forEach((v, k) => { if (k !== 'focus' && k !== 'act') to.searchParams.set(k, v) })
  if (location.hash === '#copilot') to.hash = location.hash
  location.replace(to.toString())
}
