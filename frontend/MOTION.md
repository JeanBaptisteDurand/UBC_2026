# Motion and transitions: the site's rules

The site follows a small set of motion rules. They always hold, like the cursor. The aim is coherence, not effect: the
header is always visible, and a page change happens inside the page, under the header.

These rules apply to every page except the landing film, whose scroll is its own motion. The code lives in
`src/ui/motion.ts` (`reveal`, `grow`) and `src/styles.css` (the view transition). A new page or a new content swap
uses them. It never invents its own entrance.

| Id | Rule | Where it is wired |
|---|---|---|
| M1 | **The header never moves.** From page to page it stays in place (cross-document view transition, `.hd` named `site-hd`, no animation on it). App pages render their first frame synchronously (`flushSync`, `blocking="render"`), so the header is on screen from the first frame. | `styles.css` (end), page entries, `*.html` |
| M2 | **New content always arrives the same way:** its blocks (headings, paragraphs, lists, tables, figures, buttons) rise 10 px and fade in, 360 ms, staggered 40 ms in reading order, at most 10 staggered, only what is on screen. | arrival of every app page (`AppHeader`), Services column (a sled, a chapter, the intro), Doc chapters, My space tabs, Network parts |
| M3 | **Old content leaves without travelling:** a 140 ms fade on page change, at once inside a column. | `styles.css` (view transition) |
| M4 | **A section that opens grows** to its height in 280 ms, then its content arrives by M2. Closing is immediate. | Services table of contents |
| M5 | **Reduced motion:** opacity only, 120 ms, no stagger, no travel; no page transition. | `motion.ts`, `styles.css` |
| M6 | **One clock:** 180 ms hover, 280 ms state, 360 ms reveal, 600 ms scene; one curve, `cubic-bezier(.22, 1, .36, 1)`. | tokens `--t1 --t2 --t3 --productive` |
| M7 | **The cursor** is the same on every page (square, axes, stretch onto controls, loading onto a sled): `ui/PageCursor.tsx`, landing `ui/Frame.tsx`. | `AppHeader` |
| M8 | **Nothing else enters on its own:** no bounce, no scale-in, no parallax on text, no animated counters; live numbers simply change. | review |
| M9 | **Changing page never blanks the screen.** A click on a link to another page brings a veil in the page colour down over the content, in 220 ms. The veil starts under the header (`var(--hd)`), so the header stays. Its bar becomes the loading bar and keeps filling while the next page loads, with the old page still on screen. The next page picks the bar up where it was and fills it as it loads. When the page is ready (its data and its 3D scene, `window.__frontReady`), the bar is full, then it shows the scroll position. This holds on every page, the landing included. | `ui/veil.ts`, `ui/pageload.ts`, both headers, `styles.css` |
