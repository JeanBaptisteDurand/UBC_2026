# Motion and transitions: the site's locks

Owner, 19/11/2026: « mettre en place des règles d'animation et de transition qui soient toujours vraies et que tu
appliques à chaque fois, un peu comme ce qu'on a fait avec le curseur… des locks pour dire : si jamais il y a ça sur
une page, je le veux absolument ». « Je cherche pas quelque chose de particulièrement visuel, mais quelque chose de
cohérent. » « Le header doit toujours être visible… quand on passe d'une page à l'autre… la transition se passe à
l'intérieur de la page. »

These rules apply to every page except the landing's film (whose scroll is its own motion). The code lives in
`frontend/src/ui/motion.ts` (`reveal`, `grow`) and `styles.css` (view transition). A new page or a new
content swap uses them; it never invents its own entrance.

| Lock | Rule | Where it is wired |
|---|---|---|
| M1 | **The header never moves.** From page to page it stays in place (cross-document view transition, `.hd` named `site-hd`, no animation on it). App pages render their first frame synchronously (`flushSync`, `blocking="render"`) so the header is there at the first frame. | `styles.css` (end), page entries, `*.html` |
| M2 | **New content always arrives the same way:** its blocks (headings, paragraphs, lists, tables, figures, buttons) rise 10 px and fade in, 360 ms, staggered 40 ms in reading order, at most 10 staggered, only what is on screen. | arrival of every app page (`AppHeader`), Services column (a sled, a chapter, the intro), Doc chapters, My space tabs, Network parts |
| M3 | **Old content leaves without travelling:** a 140 ms fade on page change, at once inside a column. | `styles.css` (view transition) |
| M4 | **A section that opens grows** to its height in 280 ms, then its content arrives by M2. Closing is immediate. | Services table of contents |
| M5 | **Reduced motion:** opacity only, 120 ms, no stagger, no travel; no page transition. | `motion.ts`, `styles.css` |
| M6 | **One clock:** 180 ms hover, 280 ms state, 360 ms reveal, 600 ms scene; one curve, `cubic-bezier(.22, 1, .36, 1)`. | tokens `--t1 --t2 --t3 --productive` |
| M7 | **The cursor** is the same on every page (square, axes, stretch onto controls, loading onto a sled): `ui/PageCursor.tsx`, landing `ui/Frame.tsx`. | `AppHeader` |
| M8 | **Nothing else enters on its own:** no bounce, no scale-in, no parallax on text, no animated counters; live numbers simply change. | review |
