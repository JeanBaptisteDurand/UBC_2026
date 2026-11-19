// products.html → service.html: ?p=<product> opens that product, a #family that family (?c=<family>). An external module, so
// the site's script-src 'self' policy allows it (an inline script is refused there).
const q = new URLSearchParams(location.search)
const p = q.get('p')
const h = location.hash.slice(1)
location.replace('service.html' + (p ? '?p=' + encodeURIComponent(p) : /^[a-z0-9-]+$/.test(h) ? '?c=' + h : ''))

export {}
