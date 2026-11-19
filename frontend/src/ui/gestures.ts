// Reveal gestures:
// 1. the leading rule (the only lettering gesture): an ink rule draws under the title, then the title rises from
//    behind it;
// 2. the unfolding cartouche: cards and sheets open row by row from their rule;
// 3. the drawn dimension: figures and counters arrive at the end of a dimension line that draws itself.
// All start from an element in the flow and end readable; with reduced motion, the final state directly.
// The trigger reads the single clock (on-screen position), not an IntersectionObserver: a scroll jump
// (link, ?s=) never leaves a block hidden.
import { useEffect } from 'react'
import { REDUCED, onTick } from '../clock'

export function useIn(ref: React.RefObject<HTMLElement | null>, frac = 0.84) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // re-read every 6 frames: a block mounted after the data arrives (rows of a state section) also enters
    let k = 0
    const off = onTick(() => {
      if (k++ % 6) return
      // a section far from the screen is not read (no forced layout for nothing)
      const sr = el.getBoundingClientRect()
      if (!REDUCED && (sr.top > innerHeight * 1.5 || sr.bottom < -innerHeight)) return
      const left = [...el.querySelectorAll<HTMLElement>('.ttl:not(.in),.unfold:not(.in),.cote-in:not(.in)')]
      if (!left.length) return
      if (REDUCED) { left.forEach((x) => x.classList.add('in')); return }
      const lim = innerHeight * frac
      left.forEach((x) => {
        const r = x.getBoundingClientRect()
        if (r.top < lim && r.bottom > 0) x.classList.add('in')
        // already passed (jump downwards): set directly
        else if (r.bottom <= 0) x.classList.add('in')
      })
    })
    return off
  }, [ref, frac])
}
