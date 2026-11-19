// Camera and framing.
// Low perspective (the volume reads). A pose = target, azimuth, elevation, zoom (distance D0 / zoom),
// horizontal and vertical shift of the optical axis (the target falls at 50% + shift of the width, 50% - lift of
// the height: the frame stays centred on the free area right of the column, without distorting the perspective).
// On top of the pose: user (the automatic oscillation) and drag (the visitor's hand: bounded rotation and zoom,
// never below or behind).
import * as THREE from 'three'

export interface Pose { tx: number; ty: number; tz: number; az: number; el: number; zoom: number; shift: number; lift: number; fov: number }

export const BASE_AZ = 22, BASE_EL = 30
export const H0 = 4.2 // half-height of the frame at the target distance, in world units, at zoom 1
export const FOV = 28
export const D0 = H0 / Math.tan((FOV / 2) * Math.PI / 180)
export const EL_MIN = 5, EL_MAX = 58
const DEG = Math.PI / 180

export class Rig {
  cam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 400)
  pose: Pose = { tx: 0, ty: 1.6, tz: 0, az: BASE_AZ, el: BASE_EL, zoom: 1, shift: 0, lift: 0, fov: FOV }
  user = { az: 0, el: 0, zoom: 1 }
  drag = { az: 0, el: 0, zoom: 1 }
  w = 1; h = 1

  size(w: number, h: number) { this.w = Math.max(1, w); this.h = Math.max(1, h) }

  apply() {
    const p = this.pose
    const az = (p.az + this.user.az + this.drag.az) * DEG, el = THREE.MathUtils.clamp(p.el + this.user.el + this.drag.el, EL_MIN, EL_MAX) * DEG
    const c = this.cam
    const d = D0 / (p.zoom * this.user.zoom * this.drag.zoom)
    c.aspect = this.w / this.h; c.fov = p.fov
    c.position.set(p.tx + d * Math.cos(el) * Math.sin(az), p.ty + d * Math.sin(el), p.tz + d * Math.cos(el) * Math.cos(az))
    c.up.set(0, 1, 0)
    c.lookAt(p.tx, p.ty, p.tz)
    c.near = Math.max(0.05, d * 0.02); c.far = d + 120
    c.setViewOffset(this.w, this.h, -p.shift * this.w, p.lift * this.h, this.w, this.h)
    c.updateProjectionMatrix()
    c.updateMatrixWorld()
  }
  distance() { return D0 / (this.pose.zoom * this.user.zoom * this.drag.zoom) }

  // Zoom that fits a box in a fraction of the screen (fw, fh), target at the box centre (approximate: the
  // box seen at its target distance; fitScreen then corrects using the actual projections).
  fit(b: THREE.Box3, az: number, el: number, fw: number, fh: number) {
    const ctr = b.getCenter(new THREE.Vector3())
    const a = az * DEG, e = el * DEG
    const fwd = new THREE.Vector3(-Math.cos(e) * Math.sin(a), -Math.sin(e), -Math.cos(e) * Math.cos(a))
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize()
    let mx = 0, my = 0
    const v = new THREE.Vector3()
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(ctr)
      mx = Math.max(mx, Math.abs(v.dot(right))); my = Math.max(my, Math.abs(v.dot(up)))
    }
    const aspect = this.w / this.h
    const zx = (H0 * aspect * fw) / mx, zy = (H0 * fh) / my
    return { ctr, zoom: Math.min(zx, zy) }
  }

  // Projects a world point to canvas CSS pixels.
  project(v: THREE.Vector3, out: { x: number; y: number }) {
    const p = v.clone().project(this.cam)
    out.x = (p.x + 1) / 2 * this.w; out.y = (1 - p.y) / 2 * this.h
    return out
  }

  // Screen rectangle of a world box (the 8 corners projected).
  rect(b: THREE.Box3) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    const v = new THREE.Vector3(), o = { x: 0, y: 0 }
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
      this.project(v, o)
      x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x); y1 = Math.max(y1, o.y)
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }
}
