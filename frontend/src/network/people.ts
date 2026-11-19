// The actors (the client at the counter, the operator at the dock, the developer at the desk), as architectural
// model silhouettes: adult proportions (1.75 m), a single light graphite material, no face or accessories.
// All segments of all characters are instances of a single capsule: one draw call, a single set
// of animations (computed poses: seated, typing, walking, two-handed carry, insertion gesture).
// Rigged figures: a high-end architectural model figurine, lacquered, continuous forms, faceless
// (joined metaballs, 13 independent bones), lacquered graphite by default. Each actor is a rigged clone;
// on each frame, each bone is placed on its joint (joints()), its rest direction turned by the heading
// then brought onto the current direction: the same rule as in the Blender script that validated the test poses.
// Low-poly faceted figure, black (rigid parts, 896 triangles); no hand or
// elbow above the shoulder (joints()).
// The instanced capsules remain as a fallback if the model fails to load.
import * as THREE from 'three'
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js'

export interface Pose {
  x: number; z: number; heading: number
  pelvisY: number; lean: number
  hipL: number; hipR: number; kneeL: number; kneeR: number
  shL: number; shR: number; elL: number; elR: number; spread: number
  headYaw: number; headPitch: number
  // hand targets (island frame): the arms reach them by inverse kinematics; gaze; forearm
  // pronation (0: palm towards the thigh, 1: palm down, at the keyboard)
  ikL?: THREE.Vector3 | null; ikR?: THREE.Vector3 | null; look?: THREE.Vector3 | null; pron?: number
}
export const standing = (x: number, z: number, heading: number): Pose => ({
  x, z, heading, pelvisY: 0.94, lean: 0, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shL: 0.06, shR: 0.06, elL: 0.12, elR: 0.12, spread: 0.1, headYaw: 0, headPitch: 0, ikL: null, ikR: null, look: null, pron: 0,
})

const SEG = 13
// the mesh rest pose (REST): standing, arms slightly apart
const REST: Pose = { ...standing(0, 0, 0), spread: 0.55, shL: 0.08, shR: 0.08, elL: 0.14, elR: 0.14 }
type J = ReturnType<People['joints']>
const BONES: [string, (j: J) => THREE.Vector3, (j: J) => THREE.Vector3][] = [
  ['pelvis', (j) => j.pelvis, (j) => j.chest], ['chest', (j) => j.chest, (j) => j.neck], ['head', (j) => j.neck, (j) => j.neck.clone().setY(j.neck.y + 0.2)],
  ['thigh_L', (j) => j.lL.h, (j) => j.lL.k], ['shin_L', (j) => j.lL.k, (j) => j.lL.a], ['foot_L', (j) => j.lL.a, (j) => j.lL.toe],
  ['thigh_R', (j) => j.lR.h, (j) => j.lR.k], ['shin_R', (j) => j.lR.k, (j) => j.lR.a], ['foot_R', (j) => j.lR.a, (j) => j.lR.toe],
  ['upper_L', (j) => j.aL.s, (j) => j.aL.e], ['fore_L', (j) => j.aL.e, (j) => j.aL.w],
  ['upper_R', (j) => j.aR.s, (j) => j.aR.e], ['fore_R', (j) => j.aR.e, (j) => j.aR.w],
]
export const PRON = Number(new URLSearchParams(location.search).get('pron') ?? 1.35)
interface Skin { root: THREE.Object3D; bones: THREE.Bone[]; rigInv: THREE.Matrix4; rigQi: THREE.Quaternion }
// hand and elbow stay at least ARM_TOP below the shoulder (standing)
const ARM_TOP = 0.2
const L = { thigh: 0.45, shin: 0.43, upper: 0.29, fore: 0.27, hipW: 0.095, shW: 0.19, torso: 0.5, neck: 0.1 }

export class People {
  mesh: THREE.InstancedMesh
  blobs: THREE.InstancedMesh
  poses: Pose[] = []
  // each character lives on a moving island; its poses are in the island frame
  parents: (THREE.Object3D | null)[] = []
  private P: THREE.Matrix4 | null = null
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)
  // parts modelled in Blender: the torso (segments 6 and 7) and the head (12) have their own mesh,
  // instanced, child of mesh; the limbs keep mesh (geometry replaced)
  private trunk: THREE.InstancedMesh | null = null
  private head: THREE.InstancedMesh | null = null
  private zero = new THREE.Matrix4().makeScale(0, 0, 0)
  private tmp = new THREE.Matrix4()
  // rigged figures
  private skins: Skin[] | null = null
  private restQ: THREE.Quaternion[] = []
  private restDir: THREE.Vector3[] = []
  // pre, a depth-only pass (before the hologram): only the nearest face of the figure lights up
  setSkinned(src: THREE.Object3D, mat: THREE.Material, pre?: THREE.Material) {
    const jr = this.joints(REST)
    this.skins = this.poses.map((_, n) => {
      const root = skClone(src); root.updateMatrixWorld(true)
      const bones = BONES.map(([nm]) => root.getObjectByName(nm) as THREE.Bone)
      if (bones.some((b) => !b)) throw new Error('os manquant')
      const rig = bones[0].parent!, rigW = rig.matrixWorld.clone(), rigQ = new THREE.Quaternion().setFromRotationMatrix(rigW)
      if (n === 0) BONES.forEach(([, a, b], i) => {
        // (clone: sub would modify the shared joint, and the next bone of the chain would start from a wrong point)
        this.restDir[i] = b(jr).clone().sub(a(jr)).normalize()
        this.restQ[i] = rigQ.clone().multiply(bones[i].quaternion)
      })
      // people.glb has no normals (facets computed in the shader); set some anyway, once, so that
      // the attribute exists as on the other meshes (without it, a long frame appeared at the start of the rack step)
      root.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && !m.userData.pre) {
        if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals()
        m.material = mat; m.frustumCulled = false; m.renderOrder = 7
        if (pre) { const d = new THREE.SkinnedMesh(m.geometry, pre); d.userData.pre = true; d.bind(m.skeleton, m.bindMatrix); d.frustumCulled = false; d.renderOrder = 6; m.parent!.add(d) }
      } })
      this.parents[n]?.add(root)
      return { root, bones, rigInv: rigW.clone().invert(), rigQi: rigQ.clone().invert() }
    })
    this.mesh.visible = false
    this.update()
  }
  private qt = new THREE.Quaternion(); private qa = new THREE.Quaternion(); private qh = new THREE.Quaternion(); private dv = new THREE.Vector3(); private rv = new THREE.Vector3(); private eu = new THREE.Euler()
  private poseSkin(n: number) {
    const sk = this.skins![n], p = this.poses[n], j = this.joints(p)
    this.qh.setFromAxisAngle(this.up, p.heading)
    BONES.forEach(([nm, a, b], i) => {
      const bone = sk.bones[i], A = a(j)
      if (nm === 'head') {
        let yaw = p.heading + p.headYaw, pitch = p.headPitch
        if (p.look) {
          this.dv.copy(p.look).sub(j.head); const hz = Math.hypot(this.dv.x, this.dv.z)
          let dy = Math.atan2(this.dv.x, this.dv.z) - p.heading; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI
          yaw = p.heading + THREE.MathUtils.clamp(dy, -1.2, 1.2); pitch = THREE.MathUtils.clamp(Math.atan2(-this.dv.y, hz), -0.5, 0.7)
        }
        this.qa.setFromEuler(this.eu.set(pitch, yaw, 0, 'YXZ'))
      } else {
        this.rv.copy(this.restDir[i]).applyQuaternion(this.qh); this.dv.copy(b(j)).sub(A).normalize()
        this.qa.setFromUnitVectors(this.rv, this.dv).multiply(this.qh)
        // pronation: the forearm rotates around its axis (palm down at the keyboard)
        if (nm === 'fore_L' || nm === 'fore_R') this.qa.premultiply(this.qt.setFromAxisAngle(this.dv, (nm === 'fore_L' ? -1 : 1) * PRON * (p.pron ?? 0)))
      }
      bone.quaternion.copy(sk.rigQi).multiply(this.qa).multiply(this.restQ[i])
      bone.position.copy(A).applyMatrix4(sk.rigInv)
    })
  }
  setParts(limb: THREE.BufferGeometry, trunk: THREE.BufferGeometry, head: THREE.BufferGeometry) {
    const n = this.poses.length
    const mat = new THREE.MeshStandardMaterial({ color: 0x949ca5, roughness: 0.8, metalness: 0.0 })
    this.mesh.geometry.dispose(); this.mesh.geometry = limb; this.mesh.material = mat
    this.trunk = new THREE.InstancedMesh(trunk, mat, n * 2); this.head = new THREE.InstancedMesh(head, mat, n)
    for (const m of [this.trunk, this.head]) { m.frustumCulled = false; this.mesh.add(m) }
    this.update()
  }
  constructor(n: number) {
    const g = new THREE.CapsuleGeometry(0.5, 1, 4, 10) // total height 2, radius 0.5
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x8e979f, roughness: 0.78, metalness: 0.05 }), n * SEG)
    this.mesh.frustumCulled = false
    const bm = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false, map: blobTex() })
    this.blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2), bm, n)
    this.blobs.frustumCulled = false
    for (let i = 0; i < n; i++) this.poses.push(standing(0, 0, 0))
  }
  // a capsule segment between two points (world frame), with thickness rx, rz
  private seg(i: number, a: THREE.Vector3, b: THREE.Vector3, rx: number, rz: number, yaw: number) {
    const d = this.v.subVectors(b, a); const len = d.length()
    d.normalize()
    this.q.setFromUnitVectors(this.up, d)
    // keep the thickness aligned with the body (rotation around the segment)
    const qy = new THREE.Quaternion().setFromAxisAngle(this.up, yaw)
    this.q.multiply(qy)
    const mid = a.clone().add(b).multiplyScalar(0.5)
    this.s.set(rx * 2, (len + Math.min(rx, rz) * 2) / 2, rz * 2)
    this.m.compose(mid, this.q, this.s)
    if (this.P) this.m.premultiply(this.P)
    this.mesh.setMatrixAt(i, this.m)
  }
  // A character's joints, in its own frame (facing +z), then in the world.
  joints(p: Pose) {
    const ch = Math.cos(p.heading), sh = Math.sin(p.heading)
    const W = (x: number, y: number, z: number) => new THREE.Vector3(p.x + x * ch + z * sh, y, p.z - x * sh + z * ch)
    const cl = Math.cos(p.lean), sl = Math.sin(p.lean)
    const P = { x: 0, y: p.pelvisY, z: 0 }
    const T = (x: number, y: number, z: number) => W(x, P.y + y * cl - z * sl, P.z + y * sl + z * cl) // torso frame, leaning forward
    const R = (x: number, y: number, z: number) => new THREE.Vector3(x * ch + z * sh, y, -x * sh + z * ch)
    const leg = (side: number, hip: number, knee: number) => {
      const h = W(side * L.hipW, P.y, 0)
      const k = W(side * L.hipW, P.y - L.thigh * Math.cos(hip), L.thigh * Math.sin(hip))
      const a2 = hip - knee
      const a = W(side * L.hipW, P.y - L.thigh * Math.cos(hip) - L.shin * Math.cos(a2), L.thigh * Math.sin(hip) + L.shin * Math.sin(a2))
      const toe = a.clone().add(R(0, 0, 0.14)); toe.y = Math.max(0.035, a.y - 0.03)
      return { h, k, a, toe }
    }
    // an arm hangs, turned forward by shp (shoulder) then el (elbow), spread from the body by spread
    const arm = (side: number, shp: number, el: number) => {
      const s = T(side * L.shW, L.torso - 0.06, 0)
      // never a hand or an elbow above the shoulder, whatever target the loop gives;
      // near the limit, the arm is never straight (bent-elbow gesture, no raised straight arm)
      // standing, the hand stays ARM_TOP below the shoulder; seated (at the keyboard), 10 cm is enough
      const standingUp = p.pelvisY > 0.7, cap = s.y - (standingUp ? ARM_TOP : 0.1)
      let tg = side > 0 ? p.ikL : p.ikR
      if (!tg) {
        const sx = side * Math.sin(p.spread) * 0.5
        const d1 = R(sx, -Math.cos(shp), Math.sin(shp)).normalize(), d2 = R(sx * 0.4, -Math.cos(shp + el), Math.sin(shp + el)).normalize()
        const e = s.clone().addScaledVector(d1, L.upper)
        const w = e.clone().addScaledVector(d2, L.fore)
        if (Math.max(e.y, w.y) <= cap) return { s, e, w }
        tg = w
      }
      // two segments of fixed length (never stretched: a target too far is brought within reach); the elbow bends
      // down and back, close to the body. A target requested near or above the shoulder (gesture towards
      // the gantry lamps, the dock screen) gives a soft gesture: the hand drops below the limit and only reaches
      // two thirds of the reach, elbow well bent; low targets (carried blade, keyboard) are unchanged
      const high = standingUp ? THREE.MathUtils.smoothstep(tg.y, s.y - 0.2, s.y + 0.1) : 0
      if (tg.y > cap) tg = tg.clone().setY(cap)
      const a = L.upper, b = L.fore, d = tg.clone().sub(s)
      const dist = THREE.MathUtils.clamp(d.length(), 0.08, (a + b) * THREE.MathUtils.lerp(0.998, 0.68, high)), dir = d.normalize()
      const ang = Math.acos(THREE.MathUtils.clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1))
      const pole = R(side * 0.22, -1, -0.55).normalize(); const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir)))
      if (perp.lengthSq() < 1e-6) perp.copy(R(side, 0, 0)); perp.normalize()
      const e = s.clone().addScaledVector(dir, a * Math.cos(ang)).addScaledVector(perp, a * Math.sin(ang))
      if (e.y > cap) e.y = cap
      const w = s.clone().addScaledVector(dir, dist)
      return { s, e, w }
    }
    const lL = leg(1, p.hipL, p.kneeL), lR = leg(-1, p.hipR, p.kneeR)
    const aL = arm(1, p.shL, p.elL), aR = arm(-1, p.shR, p.elR)
    const neck = T(0, L.torso + 0.02, 0), head = T(0, L.torso + 0.16, 0.02)
    return { W, lL, lR, aL, aR, neck, head, pelvis: W(0, P.y, 0), chest: T(0, L.torso * 0.62, 0) }
  }
  // a target pose is reached smoothly (k: fraction of the way done this frame; 1 = immediately); the
  // arms always go through their hand targets (for poses without a target, the hand is placed where the angle puts it)
  settle(n: number, t: Pose, k: number) {
    const tj = this.joints({ ...t, ikL: null, ikR: null })
    const tgL = t.ikL ?? tj.aL.w, tgR = t.ikR ?? tj.aR.w
    const look = t.look ?? tj.head.clone().add(new THREE.Vector3(Math.sin(t.heading + t.headYaw), -Math.tan(t.headPitch), Math.cos(t.heading + t.headYaw)).multiplyScalar(2))
    const c = this.poses[n]
    if (k >= 1 || !c.ikL) { Object.assign(c, t); c.ikL = tgL.clone(); c.ikR = tgR.clone(); c.look = look.clone(); return }
    for (const f of ['x', 'z', 'pelvisY', 'lean', 'hipL', 'hipR', 'kneeL', 'kneeR', 'shL', 'shR', 'elL', 'elR', 'spread', 'headYaw', 'headPitch', 'pron'] as const) (c as unknown as Record<string, number>)[f] += (((t as unknown as Record<string, number>)[f] ?? 0) - ((c as unknown as Record<string, number>)[f] ?? 0)) * k
    let dh = t.heading - c.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI
    c.heading += dh * k
    c.ikL!.lerp(tgL, k); c.ikR!.lerp(tgR, k); c.look!.lerp(look, k)
  }
  // Where the hands are (to carry the blade)
  hands(i: number) {
    const j = this.joints(this.poses[i])
    return j.aL.w.clone().add(j.aR.w).multiplyScalar(0.5)
  }
  update() {
    if (this.skins) {
      this.poses.forEach((p, n) => {
        this.P = this.parents[n]?.matrixWorld ?? null
        if (this.parents[n] && !this.parents[n]!.visible) { this.blobs.setMatrixAt(n, this.zero); return }
        this.poseSkin(n)
        this.m.compose(this.v.set(p.x, 0.006, p.z), this.q.identity(), this.s.set(p.pelvisY < 0.7 ? 1.25 : 1, 1, p.pelvisY < 0.7 ? 1.25 : 1))
        if (this.P) this.m.premultiply(this.P)
        this.blobs.setMatrixAt(n, this.m)
      })
      this.blobs.instanceMatrix.needsUpdate = true
      return
    }
    this.poses.forEach((p, n) => {
      this.P = this.parents[n]?.matrixWorld ?? null
      if (this.parents[n] && !this.parents[n]!.visible) { const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < SEG; i++) this.mesh.setMatrixAt(n * SEG + i, z); this.blobs.setMatrixAt(n, z); return }
      const j = this.joints(p), y = p.heading, b = n * SEG
      this.seg(b + 0, j.lL.h, j.lL.k, 0.075, 0.08, y); this.seg(b + 1, j.lL.k, j.lL.a, 0.058, 0.062, y); this.seg(b + 2, j.lL.a, j.lL.toe, 0.045, 0.04, y)
      this.seg(b + 3, j.lR.h, j.lR.k, 0.075, 0.08, y); this.seg(b + 4, j.lR.k, j.lR.a, 0.058, 0.062, y); this.seg(b + 5, j.lR.a, j.lR.toe, 0.045, 0.04, y)
      // pelvis and torso: wide and flat
      this.seg(b + 6, j.pelvis.clone().setY(j.pelvis.y - 0.04), j.chest, 0.16, 0.11, y)
      this.seg(b + 7, j.chest, j.neck, 0.2, 0.115, y)
      this.seg(b + 8, j.aL.s, j.aL.e, 0.05, 0.05, y); this.seg(b + 9, j.aL.e, j.aL.w, 0.042, 0.042, y)
      this.seg(b + 10, j.aR.s, j.aR.e, 0.05, 0.05, y); this.seg(b + 11, j.aR.e, j.aR.w, 0.042, 0.042, y)
      // head: an ovoid, slightly turned
      const hc = j.head
      this.m.compose(hc, this.q.setFromEuler(new THREE.Euler(p.headPitch, y + p.headYaw, 0, 'YXZ')), this.s.set(0.18, 0.12, 0.2))
      if (this.P) this.m.premultiply(this.P)
      this.mesh.setMatrixAt(b + 12, this.m)
      this.m.compose(this.v.set(p.x, 0.006, p.z), this.q.identity(), this.s.set(p.pelvisY < 0.7 ? 1.25 : 1, 1, p.pelvisY < 0.7 ? 1.25 : 1))
      if (this.P) this.m.premultiply(this.P)
      this.blobs.setMatrixAt(n, this.m)
    })
    if (this.trunk && this.head) {
      this.poses.forEach((_, n) => {
        const b = n * SEG
        for (const [src, dst, j] of [[6, this.trunk!, n * 2], [7, this.trunk!, n * 2 + 1], [12, this.head!, n]] as const) {
          this.mesh.getMatrixAt(b + src, this.tmp); dst.setMatrixAt(j, this.tmp); this.mesh.setMatrixAt(b + src, this.zero)
        }
      })
      this.trunk.instanceMatrix.needsUpdate = true; this.head.instanceMatrix.needsUpdate = true
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.blobs.instanceMatrix.needsUpdate = true
  }
}

function blobTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  return t
}

// ---------- Poses ----------
export function sitTyping(p: Pose, x: number, z: number, heading: number, t: number, typing: number) {
  Object.assign(p, standing(x, z, heading))
  p.pelvisY = 0.52; p.hipL = p.hipR = Math.PI / 2 - 0.05; p.kneeL = p.kneeR = Math.PI / 2 - 0.05
  p.lean = 0.12 * typing
  const k = typing * 0.05
  p.shL = 0.38 * typing + 0.05; p.shR = 0.38 * typing + 0.05
  p.elL = 1.1 * typing + 0.25 + k * Math.sin(t * 17); p.elR = 1.1 * typing + 0.25 + k * Math.sin(t * 19 + 1.3)
  p.spread = 0.1; p.headPitch = 0.12 * typing
}
// walk: phase in metres travelled (a 1.4 m stride for two steps)
export function walking(p: Pose, x: number, z: number, heading: number, dist: number, carry: number) {
  Object.assign(p, standing(x, z, heading))
  const ph = (dist / 1.4) * Math.PI * 2
  const s = Math.sin(ph)
  p.hipL = 0.38 * s; p.hipR = -0.38 * s
  p.kneeL = Math.max(0, 0.75 * Math.sin(ph - 1.2)); p.kneeR = Math.max(0, 0.75 * Math.sin(ph + Math.PI - 1.2))
  p.pelvisY = 0.94 - 0.025 * Math.abs(Math.cos(ph))
  p.shL = -0.3 * s * (1 - carry) + carry * 0.75; p.shR = 0.3 * s * (1 - carry) + carry * 0.75
  p.elL = 0.15 + carry * 0.75; p.elR = 0.15 + carry * 0.75
  p.spread = 0.1 + carry * 0.25
}
export function holding(p: Pose, x: number, z: number, heading: number, carry: number, reach: number) {
  Object.assign(p, standing(x, z, heading))
  p.lean = 0.25 * reach
  p.shL = p.shR = 0.06 + carry * 0.75 + reach * 0.45
  p.elL = p.elR = 0.12 + carry * 0.75 - reach * 0.55
  p.spread = 0.1 + carry * 0.25
  p.kneeL = p.kneeR = 0.12 * reach; p.hipL = p.hipR = 0.06 * reach
}
