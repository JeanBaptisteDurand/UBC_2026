/* the top centre (act banner, journey stepper) never sits under the tools: on a laptop screen (1100 to ~1700 px)
   the tools bar reaches the middle of the screen, more so in French and during a replay. Centred when nothing is in
   the way, else centred in the free gap between the brand and the tools, else on a second row under the tools. */
const hudTop = $('.topcenter'), hudTools = $('.tools'), hudBrand = $('.topleft .brand');
function placeTopCenter() {
  const W = innerWidth;
  hudTop.style.left = ''; hudTop.style.top = ''; hudTop.style.maxWidth = '';
  if (W <= 1100) return; /* hidden by the CSS below that width */
  const L = hudBrand.getBoundingClientRect().right + 14;
  const tools = hudTools.getBoundingClientRect();
  const R = tools.left - 14;
  const want = Math.min(560, W * 0.46);
  if (W / 2 - want / 2 >= L && W / 2 + want / 2 <= R) return;
  if (R - L >= 380) { hudTop.style.left = `${Math.round((L + R) / 2)}px`; hudTop.style.maxWidth = `${Math.floor(Math.min(560, R - L))}px`; return; }
  hudTop.style.top = `${Math.round(tools.bottom + 10)}px`;
}
if ('ResizeObserver' in window) { const ro = new ResizeObserver(() => placeTopCenter()); ro.observe(hudTools); ro.observe(hudBrand); }
addEventListener('resize', placeTopCenter);
placeTopCenter();
