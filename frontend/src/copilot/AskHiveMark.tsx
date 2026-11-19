// AskHive, the site assistant's mark (owner, 19/11): the A of the ArcHive logo with its diode (the right eye, Arc
// blue), a second diode left of the A (the left eye, the amber of the site's LEDs) and the arrow's curve carried on
// down under the A (the smile): the arrow's stem and the smile are one shape. Strokes in currentColor; the eyes glow
// (styles in styles.css, .ah-mark). Source drawing: workspace/archive/logo/askhive/askhive-1.svg.
export function AskHiveMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`ah-mark ${className}`} viewBox="-19 -1 95 107" width={size} height={size} aria-hidden="true" fill="currentColor">
      <g transform="translate(-251.59496,-69.811883)">
        <path d="m 289.20068,102.41979 a 19.833312,43.997907 0 0 0 -19.83338,43.9977 19.833312,43.997907 0 0 0 0.0359,2.64003 h 6.76806 a 12.922601,39.984684 0 0 1 12.91613,-38.72946 12.922601,39.984684 0 0 1 12.91635,38.72946 h 6.99465 a 19.833312,43.997907 0 0 0 0.0357,-2.64003 19.833312,43.997907 0 0 0 -19.83338,-43.9977 z" />
        <path d="m 321.51137,69.811882 c -3.05166,4.82369 -6.43796,10.20833 -9.51397,15.56196 l 0.0226,0.0255 c 0.0215,0.0243 0.65129,0.0284 2.74244,0.0862 1.67876,0.0465 2.11322,0.0619 2.1258,0.0755 -0.2356,3.63554 -0.54072,7.26857 -0.85739,10.89874 l 6.00194,-0.0148 c 0.87228,-9.72821 1.08341,-10.43679 1.03057,-10.6425 -0.0249,-0.0946 -0.16403,-0.0917 1.85128,-0.0357 1.55438,0.0429 2.25333,0.046 2.27175,0.0296 0.0106,-0.01 0.0197,-0.0191 0.021,-0.0225 v -5.1e-4 -5.1e-4 -5.1e-4 c -1.72978,-5.10941 -3.48641,-10.30468 -5.68284,-15.95912 -0.005,-7.4e-4 -0.009,-7.6e-4 -0.0129,-7.6e-4 z" />
        <path d="M 316.03652,96.401868 a 10.810425,55.654054 6.7928632 0 1 -1.28364,11.373982 10.810425,55.654054 6.7928632 0 1 -9.63817,41.19542 C 296.6200,169.2651 260.5305,177.0831 249.6349,153.4762 A 1.2500,1.2500 0 0 0 247.3651,154.5238 C 259.9368,181.7626 297.4232,171.0554 309.1403,148.9713 a 16.550672,61.39141 5.9928504 0 0 11.8923,-43.72963 16.550672,61.39141 5.9928504 0 0 1.00149,-8.839772 z" />
        <ellipse className="ah-eye ah-eye-b" cx="289.20071" cy="122.71992" rx="5.4" ry="5.2" />
        <ellipse className="ah-eye ah-eye-a" cx="256.5" cy="122.71992" rx="5.4" ry="5.2" />
      </g>
    </svg>
  )
}
