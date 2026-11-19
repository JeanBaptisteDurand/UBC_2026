// demo.html is no longer a page of its own: the demo plays in the Network page's 3D room (network.html?focus=demo),
// with its text for each part (network/demo-parts.ts). The old address (links, posts) lands there at once, its
// language and part kept (?lang=fr, ?part=request); without JavaScript, demo.html's own refresh does the same.
const q = new URLSearchParams(location.search)
const to = new URL('network.html', location.href)
to.searchParams.set('focus', 'demo')
for (const k of ['lang', 'part']) { const v = q.get(k); if (v) to.searchParams.set(k, v) }
location.replace(to.pathname + to.search + location.hash)
