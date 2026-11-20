/* the choreography of each kind of beat */
let crewBusy = Promise.resolve();
/* every scene belongs to one run of the director: when a new replay starts (or the viewer skips to now), the scenes of the
   old run stop at their next step and tidy up, instead of fighting the new run for the same characters */
const ABORT = new Error('scene superseded');
function guard() { const tk = director.tok; return async (p) => { const v = await p; if (tk !== director.tok) throw ABORT; return v; }; }
function resetStage() {
  crewBusy = Promise.resolve();
  for (const s of sockets) { s.doorK = 0; if (s.door) s.door.rotation.y = 0; }
  if (crew.ok) { crew.setCarry(false); crew.place(TECH_HOME[0], TECH_HOME[1], Math.PI / 2); crew.setBase('sit', 0); }
  if (crew2.ok) { crew2.setCarry(false); crew2.place(-4.55, -4.35, Math.PI); crew2.setBase('interact-left'); }
  if (clerk.ok) clerk.setBase('idle');
}
const productShort = (id) => tr(`products.${id}.short`) || productName(id);
/* where the technician stands to work on a cabinet: in its front aisle */
const frontZ = (s) => s.pos.z + FRONT_Z + 0.38;
/* the technician works from the cabinet's right-hand side, so the open bay stays in view (the camera looks from the front left) */
const WORK_DX = 0.36;
function routeTo(s, from = SHELF_SPOT) {
  const fz = frontZ(s);
  return [[AISLE_X, from[1]], [AISLE_X, fz], [s.pos.x + WORK_DX, fz]];
}
function scanOn(color) {
  if (!scanLight) return;
  scanLight.material.color.set(color);
  tween(1.0, (k) => { scanLight.material.opacity = 0.5 * Math.sin(k * Math.PI); }, (k) => k);
}
async function toArc(from, color, fast) {
  const q = capsule(color); q.position.copy(from);
  await flyAlong(q, arcPath(q.position, ARC_TOP, 1.3), fast ? 0.3 : 0.9);
  scene.remove(q);
  ringPulse(V3(ARC_TOP.x, 0.02, -4.9), '#9DB7FF', { r1: 1.2, dur: 0.8 });
}
/* a capsule rides the glass tube between the counter and the technician's desk */
function tubeRide(obj, back, fast) {
  return tween(fast ? 0.45 : 1.3, (k) => obj.position.copy(tubeCurve.getPointAt(back ? 1 - k : k)), easeInOut);
}
function ticket(color) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 12), new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.35), roughness: 0.4 }));
  t.castShadow = true; scene.add(t); return t;
}
/* an operator starts an enclave: the order reaches the technician through the tube; he takes the service's module
   from the shelf, opens a cabinet, slides it in and closes the door; Arc checks the enclave's quote; the rack lights up */
async function arrive(pod, fast) {
  const s = PLAN.get(pod.id);
  if (!s) return;
  const install = () => { seatPod(pod, s); setPodState(pod, 'checking'); };
  const verify = async () => {
    await toArc(pod.grp.position.clone().setY(CAB.h + 0.1), '#FBBF24', fast);
    setPodState(pod, 'live'); ringPulse(s.pos, STATE_HEX.live, { r1: 1.2, dur: 0.8 });
  };
  if (fast || !crew.ok) { install(); await verify(); return; }
  const g = guard();
  const job = crewBusy.then(async () => {
    let order = null, mod = null;
    try {
      await g(Promise.resolve());
      order = ticket('#FFA034'); order.position.copy(TUBE_IN);
      clerk.setBase('interact-right'); await g(tubeRide(order, false, false)); scene.remove(order); order = null; clerk.setBase('idle');
      crew.face(Math.PI / 2); crew.say(tr('speech.start', { service: productShort(pod.info.product) }), 2.2);
      await g(wait(0.6));
      await g(crew.walk([SHELF_SPOT])); crew.face(Math.PI / 2); crew.setBase('interact-right', 0.12); await g(wait(0.45));
      mod = makeModule(pod.info.product); scene.add(mod);
      const fwd = new THREE.Vector3(Math.sin(crew.heading), 0, Math.cos(crew.heading));
      mod.position.set(crew.pos.x + fwd.x * 0.27, 0.3, crew.pos.y + fwd.z * 0.27); mod.rotation.set(0, crew.heading, 0); mod.scale.setScalar(0.62);
      crew.group.updateMatrixWorld(true); crew.torso.attach(mod);
      crew.setCarry(true); crew.setBase('idle', 0.15); await g(wait(0.15));
      const route = routeTo(s);
      follow('hive', pod);
      await g(crew.walk(route));
      crew.face(Math.PI + 0.45); await g(wait(0.25));
      await g(swingDoor(s, true));
      crew.setBase('interact-right', 0.15); await g(wait(0.2));
      scene.attach(mod); crew.setCarry(false);
      const from = mod.position.clone(); const to = V3(s.pos.x, SLOT_Y(BAY), s.pos.z + FRONT_Z + 0.02 - 0.21);
      const r0 = mod.rotation.y, s0 = mod.scale.x;
      await g(tween(0.55, (k) => { mod.position.lerpVectors(from, to, k); mod.rotation.y = r0 + (0 - r0) * k; mod.scale.setScalar(s0 + (1 - s0) * k); }));
      scene.remove(mod); mod = null; install();
      crew.setBase('idle'); await g(swingDoor(s, false, 0.45));
      await g(verify()); burst(s.pos.clone());
      crew.walk([...route.slice(0, -1).reverse(), [AISLE_X, TECH_HOME[1]], TECH_HOME]).then((ok) => { if (ok) { crew.face(Math.PI / 2); crew.setBase('sit', 0.3); } });
    } catch (e) {
      if (e !== ABORT) throw e;
      if (order) scene.remove(order);
      if (mod) mod.removeFromParent();
      crew.setCarry(false); crew.setBase('idle'); clerk.setBase('idle');
    }
  });
  crewBusy = job.catch(() => {});
  await job;
}
async function renew(pod, fast) {
  const prev = pod.state;
  setPodState(pod, 'checking');
  await toArc(pod.grp.position.clone().setY(CAB.h + 0.1), '#FBBF24', fast);
  setPodState(pod, prev === 'session' ? 'session' : prev === 'fault' ? 'fault' : 'live');
  ringPulse(pod.grp.position, STATE_HEX.live, { r1: 1.0, dur: 0.6 });
  await wait(fast ? 0.05 : 0.3);
}
function floorPath(a, b) {
  /* kept for older callers: a low path from a to a rack front, never through the racks */
  const front = V3(b.x, 0.12, b.z + 0.62);
  const pts = [a.clone(), V3(5.0, 0.12, 3.0), V3(3.3, 0.12, 2.15)];
  if (b.z < 0) pts.push(V3(3.3, 0.12, b.z + 0.62));
  pts.push(front, V3(b.x, 0.55, b.z + 0.38));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}
/* a client asks for a service: the sealed request goes to the back through the tube, on to the enclave's cabinet, and the
   signed answer comes back the same way; a paid call settles to the operator, and the client leaves */
async function serve(pod, opts = {}) {
  const live = [];
  try { await serveScene(pod, opts, guard(), live); }
  catch (e) { if (e !== ABORT) throw e; for (const o of live) scene.remove(o); clerk.setBase('idle'); }
}
async function serveScene(pod, { amount = 0, ai = false, fast = false, rounds = 1, leave = true } = {}, g, live) {
  const keep = (o) => { live.push(o); return o; };
  const c = client;
  const P = pod ? pod.info.product : null;
  if (c && c.ok && !fast) { c.face(Math.PI); c.say(tr('speech.ask', { service: P ? productShort(P) : '…' }), 2.0); c.setBase('interact-right'); }
  clerk.setBase('interact-right');
  await g(wait(fast ? 0.1 : 0.9));
  for (let r = 0; r < rounds; r++) {
    const q = keep(capsule('#5B8CFF')); q.position.copy(TUBE_IN);
    await g(tubeRide(q, false, fast));
    const target = pod ? pod.grp.position.clone().add(V3(0, SLOT_Y(BAY), FRONT_Z + 0.08)) : Z.hive.clone().setY(0.8);
    await g(flyAlong(q, arcPath(TUBE_OUT, target, 0.6), fast ? 0.3 : 0.8));
    scene.remove(q);
    if (pod) {
      pod.flash = 1;
      if (ai && ['1', '3', '4'].includes(pod.info.product)) {
        /* the AI question goes out to the model gateway (its own attested enclave) and back */
        const a = keep(capsule('#C4B5FD')); a.position.copy(target);
        await g(flyAlong(a, arcPath(a.position, Z.provider.clone(), 1.6), fast ? 0.35 : 0.9));
        await g(flyAlong(a, arcPath(a.position, target.clone(), 1.6), fast ? 0.35 : 0.9));
        scene.remove(a);
      } else await g(wait(fast ? 0.2 : 0.6));
    }
    const back = keep(capsule('#34D399')); back.position.copy(target);
    await g(flyAlong(back, arcPath(target, TUBE_OUT, 0.6), fast ? 0.3 : 0.8));
    await g(tubeRide(back, true, fast));
    scene.remove(back);
  }
  clerk.setBase('idle');
  if (c && c.ok && !fast) { c.setBase('idle'); c.say(tr('speech.thanks'), 1.6); }
  if (amount) await g(coinFly(V3(6.3, 0.9, 4.6), V3(crew.pos.x, 0.8, crew.pos.y), 2, 2.6));
  if (leave && c && c.ok && !fast) { await g(wait(0.6)); clientLeaves(); }
}
async function replayAtLab(pod, fast) {
  /* the hunter brings a sealed exploit; the robot replays it on a fork of Arc */
  if (hunter.ok) await Promise.race([hunter.walk([[3.6, 3.0], [3.35, -2.6], [3.95, -3.35]]), wait(fast ? 0.6 : 5.5)]);
  const ex = capsule('#F87171'); ex.position.set(hunter.pos.x, 0.75, hunter.pos.y);
  await flyAlong(ex, arcPath(ex.position, LABP.engine.clone().setY(0.9), 0.8), fast ? 0.3 : 0.8);
  scene.remove(ex);
  robot.setBase('interact-right');
  tween(0.5, (k) => { labGlow.material.opacity = 0.7 * k; });
  if (pod) pod.flash = 1;
  await wait(fast ? 0.5 : 2.0);
  tween(0.6, (k) => { labGlow.material.opacity = 0.7 * (1 - k); });
  robot.setBase('idle');
}
async function refute(liar, b, fast) {
  /* two other operators replay the same claim and prove it wrong; the liar's bond is seized */
  const honest = [...pods.values()].filter((p) => p.shown && p.info.product === (liar ? liar.info.product : '5') && p !== liar).slice(0, 2);
  for (const h of honest) {
    const c = capsule('#9DB7FF'); c.position.copy(h.grp.position).setY(1.5);
    flyAlong(c, arcPath(c.position, LABP.engine.clone().setY(1.0), 1.6), fast ? 0.4 : 1.1).then(() => scene.remove(c));
  }
  tween(0.5, (k) => { labGlow.material.opacity = 0.8 * k; });
  await wait(fast ? 0.5 : 1.4);
  robot.setBase('emote-no'); robot.say(tr('events.claim_refuted', { pod: liar ? short(liar.id) : '' }), 2.4);
  tween(0.6, (k) => { labGlow.material.opacity = 0.8 * (1 - k); });
  if (liar) {
    setPodState(liar, 'fault');
    ringPulse(liar.grp.position, STATE_HEX.fault, { r1: 2.0, dur: 1.2 });
    badge(V3(0, 1.95, 0), 'ERC-8004 · 0', STATE_HEX.fault, liar.grp);
    await coinFly(bondVault.position.clone().setY(0.6), V3(5.6, 0.6, 3.9), 2, 2.6);
  }
  await wait(fast ? 0.3 : 1.0); robot.setBase('idle');
}

/* the tour stages the story once: a client asks at the counter; the request rides the tube to the technician */
function tourDemo(f) {
  if (f === 'dock' && client && client.ok) { client.face(Math.PI); client.say(tr('speech.ask', { service: productShort('1') }), 3.4); }
  if (f === 'noc' && tubeCurve) {
    const t = ticket('#FFA034'); t.position.copy(TUBE_IN);
    tubeRide(t, false, false).then(() => { scene.remove(t); if (crew.ok) crew.say(tr('speech.start', { service: productShort('1') }), 3.2); });
  }
}
/* the verified level: a datacenter machine comes in at the dock; the Arc gate reads its chip (PPID) and Proof of Cloud's
   declaration; the second technician carries it into the hall, and the enclaves it hosts get their gold seal */
async function machineArrives(fast) {
  const g = guard(); let box = null;
  try {
  box = makeServerBox(); box.position.set(-6.5, 0.4, -5.55);
  await g(tween(fast ? 0.35 : 1.3, (k) => { box.position.z = -5.55 + 2.55 * k; }));
  scanOn('#FCD34D');
  if (gateGlow) { gateGlow.emissive = new THREE.Color('#FCD34D').multiplyScalar(0.5); wait(1.2).then(() => gateGlow.emissive.setScalar(0)); }
  await g(toArc(V3(-6.5, 1.2, -3.0), '#FCD34D', fast));
  box.userData.led.material.color.set('#FCD34D');
  await g(tween(fast ? 0.3 : 1.0, (k) => { box.position.z = -3.0 + 2.15 * k; }));
  if (fast || !crew2.ok) { box.removeFromParent(); return; }
  const home = [crew2.pos.x, crew2.pos.y];
  await g(crew2.walk([[-5.2, -2.6], [-6.5, -0.15]]));
  crew2.face(Math.PI); crew2.setBase('pick-up', 0.12); await g(wait(0.3));
  const fwd = new THREE.Vector3(Math.sin(crew2.heading), 0, Math.cos(crew2.heading));
  box.position.set(crew2.pos.x + fwd.x * 0.27, 0.27, crew2.pos.y + fwd.z * 0.27); box.rotation.set(0, crew2.heading, 0);
  crew2.group.updateMatrixWorld(true); crew2.torso.attach(box);
  crew2.setCarry(true); crew2.setBase('idle', 0.15); await g(wait(0.15));
  follow('hive');
  await g(crew2.walk([[-4.2, -0.2], [-2.2, 0.0]]));
  crew2.face(Math.PI / 2); crew2.setBase('interact-right', 0.15); await g(wait(0.25));
  scene.attach(box); crew2.setCarry(false);
  const from = box.position.clone();
  await g(tween(0.6, (k) => { box.position.lerpVectors(from, V3(-1.6, 0.6, 0), k); box.scale.setScalar(1 - 0.9 * k); }));
  box.removeFromParent();
  crew2.setBase('idle');
  crew2.walk([[-4.2, -0.2], [-5.2, -2.6], home]).then((ok) => { if (ok) { crew2.face(Math.PI); crew2.setBase('interact-left'); } });
  } catch (e) {
    if (e !== ABORT) throw e;
    if (box) box.removeFromParent();
    if (crew2.ok) { crew2.setCarry(false); crew2.setBase('idle'); }
  }
}
