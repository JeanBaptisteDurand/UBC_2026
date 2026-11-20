/* =================================================================== 8. characters (they can carry a server in both hands) */
const agents = [];
class Agent {
  constructor(name, x, z, heading = 0) {
    const g = G[name];
    this.ok = !!g;
    this.group = new THREE.Group(); this.group.userData.agent = true; scene.add(this.group);
    this.pos = new THREE.Vector2(x, z); this.heading = heading; this.want = heading; this.path = null; this.speed = 0.95; this.walked = 0; this.carry = false;
    if (!g) return;
    this.root = SkeletonUtils.clone(g.scene);
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    this.group.add(this.root);
    this.torso = this.root.getObjectByName('torso') || this.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.acts = {};
    const find = (n) => THREE.AnimationClip.findByName(g.animations, n);
    const arms = /^arm-(left|right)\./;
    const add = (key, clip, once) => { if (!clip) return; const a = this.mixer.clipAction(clip); if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } this.acts[key] = a; };
    for (const n of ['idle', 'walk', 'interact-right', 'interact-left', 'sit']) add(n, find(n));
    for (const n of ['pick-up', 'emote-yes', 'emote-no']) add(n, find(n), true);
    if (find('walk')) add('walk-legs', new THREE.AnimationClip('walk-legs', find('walk').duration, find('walk').tracks.filter((t) => !arms.test(t.name))));
    if (find('idle')) add('idle-legs', new THREE.AnimationClip('idle-legs', find('idle').duration, find('idle').tracks.filter((t) => !arms.test(t.name))));
    if (find('holding-both')) add('hold', new THREE.AnimationClip('hold', find('holding-both').duration, find('holding-both').tracks.filter((t) => arms.test(t.name))));
    this.base = null; this.baseKey = 'idle'; this.setBase('idle', 0); this.sync(); agents.push(this);
  }
  setBase(key, fade = 0.22) {
    if (!this.ok) return;
    this.baseKey = key;
    const k = this.carry && (key === 'walk' || key === 'idle') ? `${key}-legs` : key;
    const next = this.acts[k]; if (!next || next === this.base) return;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    if (this.base) this.base.fadeOut(fade);
    this.base = next;
  }
  setCarry(on) {
    if (!this.ok || this.carry === on) return;
    this.carry = on;
    const h = this.acts.hold; if (h) { if (on) h.reset().setEffectiveWeight(1).fadeIn(0.18).play(); else h.fadeOut(0.18); }
    const k = this.baseKey; this.base = null;
    for (const a of [this.acts.walk, this.acts.idle, this.acts['walk-legs'], this.acts['idle-legs']]) if (a && a.isRunning()) a.fadeOut(0.18);
    this.setBase(k, 0.18);
  }
  walk(points) { this.cancel(); this.path = points.map((p) => new THREE.Vector2(p[0], p[1])); this.seg = 0; this.walked = 0; this.setBase('walk'); return new Promise((r) => { this.done = r; }); }
  cancel() { if (this.done) { const r = this.done; this.done = null; r(false); } this.path = null; }
  place(x, z, h) { this.cancel(); this.pos.set(x, z); this.heading = this.want = h; this.setBase('idle', 0); this.sync(); }
  face(a) { this.want = a; }
  update(dt) {
    if (!this.ok) return;
    if (this.path) {
      let step = this.speed * dt * speed();
      while (step > 1e-6 && this.path) {
        const tgt = this.path[this.seg]; const d = tgt.clone().sub(this.pos); const L = d.length();
        if (L < 1e-4) { this.seg += 1; if (this.seg >= this.path.length) { this.path = null; this.setBase('idle'); const r = this.done; this.done = null; if (r) r(true); } continue; }
        const mv = Math.min(step, L); d.divideScalar(L); this.pos.addScaledVector(d, mv); this.walked += mv; step -= mv; this.want = Math.atan2(d.x, d.y);
      }
    }
    let diff = this.want - this.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); this.heading += diff * (1 - Math.exp(-dt * 10));
    this.mixer.update(dt * Math.min(PACE, 2)); this.sync();
  }
  sync() { this.group.position.set(this.pos.x, 0, this.pos.y); this.group.rotation.y = this.heading; }
}
function bubbleFor(agent) {
  const el = document.createElement('div'); el.className = 'bubble';
  const o = new CSS2DObject(el); o.center.set(0.5, 1); o.position.set(0, 1.0, 0); agent.group.add(o);
  let id = 0;
  agent.say = (text, sec = 2.4) => { el.textContent = text; el.classList.add('on'); const my = ++id; wait(sec).then(() => { if (my === id) el.classList.remove('on'); }); };
  agent.hush = () => { id += 1; el.classList.remove('on'); };
}
let crew, crew2, clerk, client, robot, hunter, author;
const CREW_HOME = TECH_HOME;

/* the clients: a line at the counter; each one served walks away and the next steps up */
/* the clients: a line at the counter and two more waiting on the benches; each one served walks out, comes back a little
   later through the front, sits down, and lines up again when a place frees */
const queueLine = [], seated = [], offstage = [];
const freeSeat = () => SEATS.find((st) => !seated.some((a) => a.seat === st));
function sitDown(a, seat) {
  a.seat = seat; seated.push(a);
  a.walk([[seat[0], seat[1] + 0.6], seat]).then((ok) => { if (ok && a.seat === seat) { a.face(0); a.setBase('sit', 0.25); } });
}
function setupQueue() {
  ['character-male-d', 'character-female-a', 'character-male-b', 'character-female-c', 'character-male-e', 'character-male-f'].forEach((n, i) => {
    const a = new Agent(n, ENTRY[0], ENTRY[1], Math.PI / 2); bubbleFor(a); a.speed = 0.85;
    if (!a.ok) return;
    if (i < QUEUE.length) { a.place(QUEUE[i][0], QUEUE[i][1], i === 0 ? Math.PI : Math.PI / 2); queueLine.push(a); }
    else if (freeSeat()) { const st = freeSeat(); a.place(st[0], st[1], 0); a.seat = st; seated.push(a); a.setBase('sit', 0); }
    else { a.group.visible = false; offstage.push(a); }
  });
  client = queueLine[0] || new Agent('character-male-d', QUEUE[0][0], QUEUE[0][1], Math.PI);
  if (!client.say) bubbleFor(client);
}
function comeBack() {
  const a = offstage.shift(); const seat = freeSeat();
  if (!a) return;
  if (!seat) { offstage.push(a); return; }
  a.place(ENTRY_FAR[0], ENTRY_FAR[1], Math.PI / 2); a.group.visible = true;
  sitDown(a, seat);
}
function clientLeaves() {
  const c = queueLine.shift(); if (!c) return;
  c.hush();
  c.walk(EXIT).then(() => { c.group.visible = false; offstage.push(c); wait(5).then(comeBack); });
  queueLine.forEach((a, i) => a.walk([QUEUE[i]]).then((ok) => { if (ok) a.face(i === 0 ? Math.PI : Math.PI / 2); }));
  if (queueLine[0]) client = queueLine[0];
  wait(1.2).then(() => {
    if (!seated.length || queueLine.length >= QUEUE.length) return;
    const n = seated.shift(); n.seat = null; const i = queueLine.length; queueLine.push(n);
    n.setBase('idle', 0.2);
    n.walk([[n.pos.x, n.pos.y + 0.6], QUEUE[i]]).then((ok) => { if (ok) n.face(queueLine.indexOf(n) === 0 ? Math.PI : Math.PI / 2); });
  });
}

/* a server unit the crew carries from the belt to its rack */
const SERVER_GEO = {};
function makeServerBox() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(SERVER_GEO.body, KIT); body.position.y = 0.085; body.castShadow = true;
  const face = new THREE.Mesh(SERVER_GEO.face, KIT); face.position.set(0, 0.085, 0.232);
  const handle = new THREE.Mesh(SERVER_GEO.handle, KIT); handle.position.set(-0.17, 0.085, 0.245);
  const led = new THREE.Mesh(SERVER_GEO.led, new THREE.MeshBasicMaterial({ color: '#FBBF24' })); led.position.set(0.15, 0.085, 0.244);
  g.add(body, face, handle, led); g.userData.led = led; scene.add(g); return g;
}

/* =================================================================== 9. world build */
const hitZones = []; let layerHit;
let pulledTray = null;
function buildWorld() {
  KIT = G['conveyor-long'].scene.getObjectByProperty('isMesh', true).material;
  SERVER_GEO.body = paint(new RoundedBoxGeometry(0.42, 0.16, 0.46, 2, 0.03), 'light');
  SERVER_GEO.face = paint(new THREE.BoxGeometry(0.38, 0.1, 0.012), 'dark');
  SERVER_GEO.handle = paint(new THREE.BoxGeometry(0.035, 0.11, 0.03), 'orange');
  SERVER_GEO.led = new THREE.BoxGeometry(0.05, 0.035, 0.01);
  rackGeometry();
  buildRoom();
  buildBackOffice();
  buildSockets();
  buildLayers();
  buildConfetti();
  /* zone labels */
  zoneLabel('pad', V3(-6.5, 1.55, -0.9));
  zoneLabel('gate', V3(Z.gate.x, 1.75, Z.gate.z));
  zoneLabel('dish', V3(Z.dish.x, 2.25, -5.3));
  zoneLabel('hive', V3(Z.hive.x, 1.9, 2.0));
  zoneLabel('dock', V3(5.3, 1.5, 3.85));
  zoneLabel('noc', V3(4.45, 1.75, -0.1));
  zoneLabel('lab', V3(5.5, 1.75, -4.4));
  zoneLabel('provider', V3(7.95, 2.25, -1.0));
  /* characters */
  crew = new Agent('character-worker', CREW_HOME[0], CREW_HOME[1], Math.PI / 2);
  if (crew.ok) crew.setBase('sit', 0);
  crew2 = new Agent('character-female-f', -4.55, -4.35, Math.PI);
  clerk = new Agent('character-female-d', 6.3, 3.62, 0);
  robot = new Agent('character-robot', LABP.robot.x, LABP.robot.z, Math.PI);
  hunter = new Agent('character-female-e', 3.3, 4.75, Math.PI);
  author = new Agent('character-male-a', Z.author.x, Z.author.z + 0.62, Math.PI);
  for (const a of [crew, crew2, clerk, robot, hunter, author]) bubbleFor(a);
  setupQueue();
  if (author.ok) author.setBase('sit');
  if (crew2.ok) crew2.setBase('interact-left');
  /* racks */
  PLAN = socketPlan();
  for (const info of DATA.pods) pods.set(info.id, makePod(info));
  /* hit boxes for the zones */
  for (const [key, c, w, d] of [['pad', V3(-6.4, 0, -1.6), 2.6, 4.8], ['gate', V3(Z.gate.x, 0, Z.gate.z), 2.2, 1.6], ['dish', V3(-3.4, 0, -5.0), 2.6, 1.2], ['lab', V3(5.6, 0, -4.0), 3.6, 3.2], ['dock', V3(5.6, 0, 4.6), 4.6, 2.6], ['noc', V3(4.3, 0, -0.1), 1.3, 2.6], ['author', Z.author, 1.8, 1.6], ['provider', V3(7.85, 0, -1.0), 0.8, 1.6]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.copy(c).setY(1.1); m.userData.zone = key; scene.add(m); hitZones.push(m);
  }
  const hz = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.4, 6.0), new THREE.MeshBasicMaterial({ visible: false }));
  hz.position.set(Z.hive.x, 2.3, Z.hive.z); hz.userData.zone = 'layers'; layerHit = hz; scene.add(hz);
}
function setStack(group, n, max = 12) {
  while (group.children.length > Math.min(n, max)) group.remove(group.children[group.children.length - 1]);
  while (group.children.length < Math.min(n, max)) {
    const i = group.children.length;
    const c = new THREE.Mesh(coinGeo, [coinRim, coinMat, coinMat]);
    c.position.set(((i % 3) - 1) * 0.22, Math.floor(i / 3) * 0.04, ((i % 2) - 0.5) * 0.12); c.castShadow = true;
    group.add(c);
  }
}
/* a little life in the line: someone looks around now and then (nothing here stands for data) */
let qlT = 0;
function queueLife(dt) {
  qlT += dt; if (qlT < 2.2) return; qlT = 0;
  const idle = queueLine.slice(1).filter((a) => a.ok && !a.path);
  if (!idle.length || Math.random() < 0.45) return;
  const a = idle[Math.floor(Math.random() * idle.length)];
  a.face(Math.PI / 2 + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6));
  wait(1.3 + Math.random()).then(() => { if (!a.path && queueLine.indexOf(a) > 0) a.face(Math.PI / 2); });
}
