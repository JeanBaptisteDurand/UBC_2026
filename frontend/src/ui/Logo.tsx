// ArcHive logo, paths kept as drawn.
// Colour: currentColor (white in the header). The arrow of the "A" leaves the frame at the top.
// In the viewBox the rectangle runs from y 22.41 to 83.40 (centre 52.91 of 83.40), the arrow goes up
// to 0; the header aligns the rectangle centre (styles.css, .logo-svg) with the axis of the menu links.
// The dot of the "A" (the ellipse) in bright Arc blue, the headline recipe (ui/ArcGlow.tsx): an almost white core,
// electric blue on the body, a near halo and a very low wide halo, in the --arc-* colours
import { useId } from 'react'
export const LOGO_RECT_MID = 52.91 / 83.40358
export function Logo({ height = 40 }: { height?: number }) {
  const id = 'lg' + useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg viewBox="0 0 152.477 83.40358" height={height} width={(height * 152.477) / 83.40358} aria-hidden="true" className="logo-svg" fill="currentColor" overflow="visible">
      <defs>
        <radialGradient id={`${id}-d`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: 'var(--arc-core)' }} />
          <stop offset="0.42" style={{ stopColor: 'var(--arc-core)' }} />
          <stop offset="0.78" style={{ stopColor: 'var(--arc-mid)' }} />
          <stop offset="1" style={{ stopColor: 'var(--arc-elec)' }} />
        </radialGradient>
        <filter id={`${id}-h`} x="-400%" y="-400%" width="900%" height="900%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="h0a" />
          <feComponentTransfer in="h0a" result="h0"><feFuncA type="linear" slope="3.2" /></feComponentTransfer>
          <feFlood style={{ floodColor: 'var(--arc-halo)', floodOpacity: 1 }} result="c0" />
          <feComposite in="c0" in2="h0" operator="in" result="g0" />
          <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="h1a" />
          <feComponentTransfer in="h1a" result="h1"><feFuncA type="linear" slope="5" /></feComponentTransfer>
          <feFlood style={{ floodColor: 'var(--arc-halo2)', floodOpacity: 0.85 }} result="c1" />
          <feComposite in="c1" in2="h1" operator="in" result="g1" />
          <feMerge><feMergeNode in="g1" /><feMergeNode in="g0" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g transform="translate(-251.59496,-69.811883)"><path d="m 251.59498,92.224345 v 60.991105 h 152.477 V 92.224345 Z m 1.9774,2.1171835 h 148.5222 v 56.7567425 h -148.5222 z M 269.4029,148.95 v 2.25 h 6.76806 v -2.25 z M 302.0034,148.95 v 2.25 h 7.137 v -2.25 z" /><ellipse cx="289.20071" cy="122.71992" rx="3.4187593" ry="3.2678368" fill={`url(#${id}-d)`} filter={`url(#${id}-h)`} className="logo-dot" /><path d="m 289.20068,102.41979 a 19.833312,43.997907 0 0 0 -19.83338,43.9977 19.833312,43.997907 0 0 0 0.0359,2.64003 h 6.76806 a 12.922601,39.984684 0 0 1 12.91613,-38.72946 12.922601,39.984684 0 0 1 12.91635,38.72946 h 6.99465 a 19.833312,43.997907 0 0 0 0.0357,-2.64003 19.833312,43.997907 0 0 0 -19.83338,-43.9977 z" /><g transform="matrix(0.98682093,0,0,0.98682093,21.460974,-142.17345)" ><path d="m 363.85507,276.11461 c 1.77235,0 3.2426,-0.60421 4.20934,-1.73208 l -1.06744,-1.2487 c -0.78548,0.86604 -1.83278,1.28899 -3.08148,1.28899 -2.11474,0 -3.62527,-1.24871 -3.86696,-3.12177 h 8.66037 c 0.0201,-0.18126 0.0403,-0.42295 0.0403,-0.58407 0,-3.28288 -2.1953,-5.49833 -5.27678,-5.49833 -3.08148,0 -5.35735,2.27587 -5.35735,5.43791 0,3.18218 2.29601,5.45805 5.74002,5.45805 z m -3.80654,-6.20324 c 0.22154,-1.83278 1.57095,-3.06135 3.42387,-3.06135 1.87306,0 3.22246,1.24871 3.42387,3.06135 z" /><path d="m 350.94506,275.99377 h 1.97376 l 4.67257,-10.67442 h -1.8932 l -3.74611,8.53953 -3.66556,-8.53953 h -2.01404 z" /><path d="m 343.49312,263.26503 c 0.76534,0 1.30913,-0.56393 1.30913,-1.28898 0,-0.68478 -0.56393,-1.22857 -1.30913,-1.22857 -0.72505,0 -1.28898,0.56393 -1.28898,1.26885 0,0.70491 0.56393,1.2487 1.28898,1.2487 z" /><path d="m 342.52639,275.99377 h 1.93347 v -10.67442 h -1.93347 z" /><path d="m 336.56482,275.99377 h 2.01404 v -14.09828 h -2.01404 v 6.06226 h -8.09644 v -6.06226 h -2.01404 v 14.09828 h 2.01404 v -6.28381 h 8.09644 z" /><path d="m 319.32466,276.11461 c 1.91333,0 3.50442,-0.80562 4.35032,-2.29601 l -1.47025,-0.92646 c -0.68477,1.04731 -1.73207,1.53068 -2.90022,1.53068 -2.0946,0 -3.66555,-1.45011 -3.66555,-3.76626 0,-2.27586 1.57095,-3.74611 3.66555,-3.74611 1.16815,0 2.21545,0.48337 2.90022,1.53067 l 1.47025,-0.9466 c -0.8459,-1.49039 -2.43699,-2.27587 -4.35032,-2.27587 -3.28289,0 -5.63932,2.25573 -5.63932,5.43791 0,3.18218 2.35643,5.45805 5.63932,5.45805 z" /><path d="m 306.65633,275.99377 h 1.93348 v -5.31707 c 0,-2.33629 1.28899,-3.60513 3.36344,-3.60513 0.14099,0 0.28197,0 0.44309,0.0201 v -1.87306 c -1.85291,0 -3.20232,0.6445 -3.88709,1.87306 v -1.77236 h -1.85292 z" /></g><path d="m 321.51137,69.811882 c -3.05166,4.82369 -6.43796,10.20833 -9.51397,15.56196 l 0.0226,0.0255 c 0.0215,0.0243 0.65129,0.0284 2.74244,0.0862 1.67876,0.0465 2.11322,0.0619 2.1258,0.0755 -0.2356,3.63554 -0.54072,7.26857 -0.85739,10.89874 l 6.00194,-0.0148 c 0.87228,-9.72821 1.08341,-10.43679 1.03057,-10.6425 -0.0249,-0.0946 -0.16403,-0.0917 1.85128,-0.0357 1.55438,0.0429 2.25333,0.046 2.27175,0.0296 0.0106,-0.01 0.0197,-0.0191 0.021,-0.0225 v -5.1e-4 -5.1e-4 -5.1e-4 c -1.72978,-5.10941 -3.48641,-10.30468 -5.68284,-15.95912 -0.005,-7.4e-4 -0.009,-7.6e-4 -0.0129,-7.6e-4 z" /><path d="m 316.03652,96.401868 a 10.810425,55.654054 6.7928632 0 1 -1.28364,11.373982 10.810425,55.654054 6.7928632 0 1 -9.63817,41.19542 h 4.02559 a 16.550672,61.39141 5.9928504 0 0 11.8923,-43.72963 16.550672,61.39141 5.9928504 0 0 1.00149,-8.839772 z" /></g>
    </svg>
  )
}
