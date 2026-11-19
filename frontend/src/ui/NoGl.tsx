// No-WebGL fallback: the still image of the room (rendered in Blender, LEDs off and plates empty: no invented
// state) and, over it, the list of slots read live, with their LED.
import { useLive } from '../data/live'
import { short } from '../data/fmt'
import { t, useLang } from '../i18n'
import { world, useWallVersion } from '../world'
import { productLabel, stateText, slotLabel } from '../data/wall'

export function NoGl() {
  useLang(); useWallVersion()
  const products = useLive((s) => s.products)
  const bounties = useLive((s) => s.bounties)
  const sl = world.wall.sleds.filter((s) => s.enclave)
  return (
    <aside className="nogl-list" aria-labelledby="nogl-t" tabIndex={0}>
      <p className="lbl muted" id="nogl-t">{t('gl.off')}</p>
      <ul>
        {sl.map((s) => (
          <li key={s.i}>
            <span className={`led led-${s.led}`} aria-hidden="true" />
            <span className="nl-n">{productLabel(s.product, products, bounties) || t('svc.enclave')}</span>
            <span className="lbl muted">{stateText(s)}</span>
            <span className="mono muted">{slotLabel(s.i)}, {short(s.enclave?.operator, 4)}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
