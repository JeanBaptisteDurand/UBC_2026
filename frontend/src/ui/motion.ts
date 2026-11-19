// The site's motion rules (design/MOTION.md, owner 19/11: "des règles d'animation et de transition qui soient
// toujours vraies", like the cursor). One grammar for every page:
//  M1 the header never moves: page to page, it stays in place (cross-document view transition, styles.css);
//  M2 new content always arrives the same way: its blocks rise 10 px and fade in, 360 ms, staggered 40 ms in
//     reading order, at most 10 staggered (the rest arrives with the last one), only what is on screen;
//  M3 old content leaves without travelling: a 140 ms fade (page change) or at once (content swap in a column);
//  M4 a section that opens grows to its height in 280 ms, then its content arrives by M2;
//  M5 reduced motion: opacity only, 120 ms, no stagger, no travel;
//  M6 durations come from the tokens (180 hover, 280 state, 360 reveal, 600 scene), one curve (productive).
export const EASE = 'cubic-bezier(.22, 1, .36, 1)'
export const REVEAL = { ms: 360, stagger: 40, max: 10, dy: 10 }
const BLOCK = 'h1, h2, h3, h4, p, ul, ol, dl, table, figure, pre, blockquote, details, form, hr, img, .btn, [data-rv]'
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** M2: the blocks of `root` (outermost matches only, on screen, in reading order) rise and fade in */
export function reveal(root: Element | null | undefined, delay = 0) {
  if (!root || typeof (root as HTMLElement).animate !== 'function') return
  const all = [...root.querySelectorAll<HTMLElement>(BLOCK)]
  const set = new Set(all)
  const blocks = all.filter((el) => {
    if (el.closest('[data-rv-skip]')) return false
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (set.has(p as HTMLElement)) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight + 40
  })
  const rm = reduced()
  blocks.forEach((el, k) => {
    const kk = Math.min(k, REVEAL.max)
    el.animate(rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: `translateY(${REVEAL.dy}px)` }, { opacity: 1, transform: 'none' }], {
      duration: rm ? 120 : REVEAL.ms, delay: rm ? 0 : delay + kk * REVEAL.stagger, easing: EASE, fill: 'backwards',
    })
  })
}

/** M4: a body that opens grows from 0 to its height, then its content arrives (M2) */
export function grow(el: HTMLElement | null) {
  if (!el || typeof el.animate !== 'function') return
  if (reduced()) { reveal(el); return }
  const h = el.scrollHeight
  el.animate([{ height: '0px', overflow: 'hidden' }, { height: `${h}px`, overflow: 'hidden' }], { duration: 280, easing: EASE })
  reveal(el, 120)
}
