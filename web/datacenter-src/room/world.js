/* =================================================================== 4. the server room and its zones */
const Z = {
  hive: V3(0.45, 0, -1.1), gate: V3(-6.5, 0, -3.0), pad: V3(-6.0, 0, -0.6), dish: V3(-3.4, 1.4, -5.42),
  lab: V3(5.6, 0, -4.2), dock: V3(6.3, 0, 4.3), author: V3(-6.0, 0, 3.9), provider: V3(8.0, 0.9, -0.6),
};
const LABP = { robot: V3(6.55, 0, -4.12), screen: V3(6.55, 0, -4.95), engine: V3(4.55, 0, -4.55), vault: V3(5.35, 0, -2.85) };
const ARC_TOP = V3(-3.4, 1.55, -5.3);
const floaters = [], flyers = [];
let dishObj = null, providerObj = null;
let KIT;                                   // the Factory Kit atlas material: procedural racks shade exactly like the kit
const PX = 1 / 512;
function atlasUV(geo, u, vTop, vBot) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox; const pos = geo.attributes.position; const uv = geo.attributes.uv; const span = max.y - min.y || 1;
  for (let i = 0; i < pos.count; i++) { const t = (pos.getY(i) - min.y) / span; uv.setXY(i, u * PX, (vBot + (vTop - vBot) * t) * PX); }
  uv.needsUpdate = true; return geo;
}
const SW = { body: [48, 390, 506], light: [176, 390, 506], dark: [208, 392, 504], slate: [240, 390, 506], orange: [224, 140, 250], teal: [464, 392, 504] };
const paint = (geo, sw) => atlasUV(geo, ...SW[sw]);
function instanced(name, mats, tints) {
  const src = G[name] && G[name].scene; if (!src) return;
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src); const ctr = box.getCenter(new THREE.Vector3());
  const norm = new THREE.Matrix4().makeTranslation(-ctr.x, -box.min.y, -ctr.z);
  src.traverse((o) => {
    if (!o.isMesh) return;
    const local = norm.clone().multiply(o.matrixWorld);
    const im = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m.clone().multiply(local)));
    if (tints) tints.forEach((t, i) => im.setColorAt(i, t));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.receiveShadow = true; im.castShadow = false;
    scene.add(im);
  });
}
function roundedRect(w, d, r) {
  const s = new THREE.Shape(), x0 = -w / 2, z0 = -d / 2;
  s.moveTo(x0 + r, z0); s.lineTo(x0 + w - r, z0); s.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + r);
  s.lineTo(x0 + w, z0 + d - r); s.quadraticCurveTo(x0 + w, z0 + d, x0 + w - r, z0 + d);
  s.lineTo(x0 + r, z0 + d); s.quadraticCurveTo(x0, z0 + d, x0, z0 + d - r);
  s.lineTo(x0, z0 + r); s.quadraticCurveTo(x0, z0, x0 + r, z0);
  return s;
}
function buildRoom() {
  /* floor: the kit's tiles, a shade darker under the racks */
  const mats = [], tints = [];
  for (let ix = 0; ix < 16; ix++) for (let iz = 0; iz < 11; iz++) {
    const x = -7.5 + ix, z = -5 + iz;
    const hall = x > -2.6 && x < 3.4 && z > -4.6 && z < 2.6;
    const v = hall ? ((ix + iz) % 2 ? 0.9 : 0.87) : ((ix + iz) % 2 ? 1 : 0.965);
    mats.push(new THREE.Matrix4().makeTranslation(x, -0.3, z)); tints.push(new THREE.Color(v, v, v));
  }
  instanced('floor', mats, tints);
  const slab = new THREE.Mesh(paint(new RoundedBoxGeometry(16.7, 0.56, 11.7, 3, 0.16), 'slate'), KIT);
  slab.position.y = -0.3 - 0.28 + 0.02; slab.receiveShadow = true; scene.add(slab);
  /* walls: back wall with the dock door, right wall with the door to the AI model gateway */
  for (let i = 0; i < 16; i++) { const x = -7.5 + i; place(x === -6.5 ? 'wall-door-wide' : 'wall', x, -5.65, { s: 1, sy: 2 }); }
  for (let i = 0; i < 7; i++) { const z = -5 + i; place(z === -1 ? 'wall-door-wide' : 'wall', 8.15, z, { rot: -Math.PI / 2, sy: 2 }); }
  /* loading dock: belt, gate, refused bin, crates */
  place('conveyor-long', -6.5, -4.5, { rot: Math.PI / 2 });
  place('conveyor-long', -6.5, -2.5, { rot: Math.PI / 2 });
  place('conveyor', -6.5, -1.0, { rot: Math.PI / 2 });
  const gate = place('scanner-high', Z.gate.x, Z.gate.z, { rot: Math.PI / 2 });
  if (gate) gateGlow = ownMaterialsKit(gate);
  place('warning-traffic', -7.4, -2.55, { s: 0.72 });
  place('skip', -5.3, -3.55);
  place('indicator-special-lines', -6.5, 0.1, { y: 0.012, shadow: false });
  for (const x of [-5.15, -4.05]) place('indicator-special-arrow', x, 0.2, { rot: Math.PI / 2, y: 0.012, shadow: false, s: 0.8 });
  place('hand-truck', -5.45, -0.75, { rot: 0.7, s: 1.3 });
  place('shelf-boxes', -4.55, -5.05, { s: 1.25 });
  place('shelf-boxes', -1.9, -5.05, { s: 1.25 });
  place('container', -7.55, -1.55, { s: 0.85 });
  place('container', -7.55, -0.95, { s: 0.85 });
  scanLight = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.95), new THREE.MeshBasicMaterial({ color: '#FBBF24', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  scanLight.position.set(Z.gate.x, 0.9, Z.gate.z); scene.add(scanLight);
  /* the operators' bond vault */
  bondVault = new THREE.Group();
  const vb = new THREE.Mesh(paint(new RoundedBoxGeometry(0.9, 0.42, 0.7, 2, 0.06), 'light'), KIT); vb.position.y = 0.21; vb.castShadow = true;
  const vl = new THREE.Mesh(paint(new RoundedBoxGeometry(0.94, 0.08, 0.74, 2, 0.03), 'orange'), KIT); vl.position.y = 0.44;
  bondStack = new THREE.Group(); bondStack.position.y = 0.48;
  bondVault.add(vb, vl, bondStack); bondVault.position.set(-7.25, 0, 0.85); scene.add(bondVault);
  /* the link to Arc: a network cabinet with its uplink and the block board on the wall */
  const nc = new THREE.Mesh(paint(new RoundedBoxGeometry(0.7, 1.2, 0.5, 2, 0.04), 'dark'), KIT); nc.position.set(-3.4, 0.6, -5.15); nc.castShadow = true; scene.add(nc);
  for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.01), new THREE.MeshBasicMaterial({ color: '#3BE596' })); l.position.set(-3.6 + i * 0.12, 0.95, -4.895); scene.add(l); }
  boardBlock = ledBoard(2.4, 0.9, (g, w, h, n) => drawLed(g, w, h, tr('status.block', { n: '' }).trim().toUpperCase(), n, 'ARC TESTNET'), false);
  boardBlock.position.copy(Z.dish); boardBlock.position.z = -5.44;
  /* the counter: register, kiosk, menu board, the client's escrow */
  place('cash-register', 6.3, 4.3, { rot: Math.PI, s: 1.2 });
  place('chair', 6.3, 3.25, { rot: Math.PI });
  const board = menuBoard(); board.position.set(7.75, 0, 3.55); board.rotation.y = -0.75;
  escrow = new THREE.Group();
  const eb = new THREE.Mesh(paint(new RoundedBoxGeometry(0.62, 0.36, 0.5, 2, 0.05), 'light'), KIT); eb.position.y = 0.18; eb.castShadow = true; escrow.add(eb);
  const eband = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.05, 0.52), new THREE.MeshStandardMaterial({ color: '#5B8CFF' })); eband.position.y = 0.3; escrow.add(eband);
  escrow.userData.stack = new THREE.Group(); escrow.userData.stack.position.y = 0.4; escrow.add(escrow.userData.stack);
  escrow.position.set(7.55, 0, 2.35); scene.add(escrow);
  /* the total settled (sessions and paid calls; operators get 95 % of it), never "paid to operators" */
  boardPaid = ledBoard(2.4, 0.9, (g, w, h, v) => drawLed(g, w, h, 'SETTLED ON ARC', v, 'USDC · ARC TESTNET'), false);
  boardPaid.position.set(7.98, 1.45, 0.55); boardPaid.rotation.y = -Math.PI / 2;
  /* the robot notary's lab */
  place('machine-window', LABP.engine.x, LABP.engine.z);
  place('computer-system', LABP.screen.x, LABP.screen.z, { s: 1.15 });
  place('cables', 5.6, -3.65, { s: 0.55, shadow: false });
  labGlow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: '#8DB0FF', transparent: true, opacity: 0, depthWrite: false }));
  labGlow.position.copy(LABP.engine).setY(0.75); scene.add(labGlow);
  vault = new THREE.Group();
  const vbox = new THREE.Mesh(paint(new RoundedBoxGeometry(0.8, 0.5, 0.6, 2, 0.06), 'dark'), KIT); vbox.position.y = 0.25; vbox.castShadow = true;
  const vband = new THREE.Mesh(paint(new RoundedBoxGeometry(0.84, 0.08, 0.64, 2, 0.03), 'orange'), KIT); vband.position.y = 0.36;
  vaultStack = new THREE.Group(); vaultStack.position.y = 0.52;
  vault.add(vbox, vband, vaultStack); vault.position.copy(LABP.vault); scene.add(vault);
  /* the product author's desk */
  deskSet(Z.author.x, Z.author.z, 0, { laptop: true });
  /* the door to the AI model gateway (the model runs at RedPill, in its own attested enclave) */
  providerObj = new THREE.Group(); providerObj.position.copy(Z.provider); scene.add(providerObj);
}
/* the client side and the back office: the queue at the counter, the tube that carries each request to the back,
   the technician's desk and the shelf of service modules */
const QUEUE = [[6.3, 5.02], [5.4, 5.3], [4.65, 5.3], [3.9, 5.3]];
const SEATS = [[1.25, 4.4], [2.15, 4.4]], ENTRY_FAR = [-1.6, 5.45];
const ENTRY = [2.0, 5.3], EXIT = [[7.25, 5.5], [8.15, 5.55]];
const TECH_HOME = [3.98, 0.55], SHELF_SPOT = [3.85, -0.75], AISLE_X = 3.15;
let tubeCurve = null, TUBE_IN = null, TUBE_OUT = null;
function buildBackOffice() {
  /* queue posts and ropes */
  const chrome = new THREE.MeshStandardMaterial({ color: '#C9D0DE', roughness: 0.3, metalness: 0.7 });
  const rope = new THREE.MeshStandardMaterial({ color: '#C0394B', roughness: 0.7 });
  const xs = [3.45, 4.25, 5.05, 5.8], zs = [4.9, 5.7];
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.82, 10).translate(0, 0.41, 0), chrome, xs.length * zs.length);
  const bases = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.12, 0.03, 14).translate(0, 0.015, 0), chrome, xs.length * zs.length);
  const ropes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 8).rotateZ(Math.PI / 2), rope, (xs.length - 1) * zs.length);
  let n = 0, r = 0; const m = new THREE.Matrix4();
  for (const z of zs) {
    xs.forEach((x, i) => {
      posts.setMatrixAt(n, m.makeTranslation(x, 0, z)); bases.setMatrixAt(n, m.makeTranslation(x, 0, z)); n++;
      if (i) { const a = xs[i - 1]; ropes.setMatrixAt(r++, new THREE.Matrix4().compose(V3((a + x) / 2, 0.74, z), new THREE.Quaternion(), V3(x - a, 1, 1))); }
    });
  }
  for (const im of [posts, bases, ropes]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = true; scene.add(im); }
  place('pottedPlant', 7.75, 5.4, { s: 1.6 });
  place('rugRectangle', 1.7, 4.75, { s: 1.3, shadow: false });
  for (const [x, z] of SEATS) place('bench', x, z - 0.06, { s: 1.7 });
  place('pottedPlant', 0.45, 4.3, { s: 1.4 });
  /* the tube: from the counter, up and over, down to the technician's desk */
  TUBE_IN = V3(6.95, 1.02, 3.7); TUBE_OUT = V3(4.75, 1.02, 1.3);
  tubeCurve = new THREE.CatmullRomCurve3([TUBE_IN.clone(), V3(6.95, 2.0, 3.7), V3(6.35, 2.2, 2.85), V3(5.15, 2.2, 1.65), V3(4.75, 2.0, 1.3), TUBE_OUT.clone()], false, 'centripetal');
  const glass = new THREE.MeshStandardMaterial({ color: '#A8C6FF', emissive: new THREE.Color('#2A4A8F'), transparent: true, opacity: 0.5, roughness: 0.1, metalness: 0, depthWrite: false });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(tubeCurve, 80, 0.08, 14, false), glass); tube.renderOrder = 3; scene.add(tube);
  for (const k of [0.12, 0.3, 0.5, 0.7, 0.88]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.016, 8, 18), chrome); ring.position.copy(tubeCurve.getPointAt(k)); ring.lookAt(ring.position.clone().add(tubeCurve.getTangentAt(k))); scene.add(ring); }
  for (const end of [TUBE_IN, TUBE_OUT]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.98, 18), chrome); post.position.set(end.x, 0.49, end.z); post.castShadow = true; scene.add(post);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 18), new THREE.MeshBasicMaterial({ color: '#5B8CFF' })); band.position.set(end.x, 0.82, end.z); scene.add(band);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 20), chrome); foot.position.set(end.x, 0.02, end.z); scene.add(foot);
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.08, 14), chrome); mouth.position.set(end.x, 1.03, end.z); scene.add(mouth);
  }
  /* the technician's desk and the shelf of service modules (one per product, in its colour) */
  deskSet(4.6, 0.55, -Math.PI / 2);
  const shelf = new THREE.Group(); shelf.position.set(4.6, 0, -0.75); shelf.rotation.y = -Math.PI / 2; scene.add(shelf);
  for (const x of [-0.42, 0.42]) { const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.3, 0.42), CABMAT.trim); side.position.set(x, 0.65, 0); side.castShadow = true; shelf.add(side); }
  const ids = Object.keys(PRODUCT_HEX);
  [0.32, 0.72, 1.12].forEach((y, row) => {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.03, 0.42), CABMAT.trim); board.position.set(0, y - 0.03, 0); shelf.add(board);
    for (let i = 0; i < 3; i++) {
      const id = ids[(row * 3 + i) % ids.length];
      const mod = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.08, 0.3, 2, 0.01), moduleMaterial(id)); mod.position.set(-0.26 + i * 0.26, y + 0.04, 0); mod.castShadow = true; shelf.add(mod);
    }
  });
}
/* a real workstation (Kenney Furniture Kit): desk, screens (or a laptop), keyboard, chair. The user stands on the
   group's +z side and looks toward -z; `rot` turns the whole set. */
function deskSet(x, z, rot, { laptop = false, chairAt = [0, 0.62], s = 1.45 } = {}) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
  const desk = place('desk', 0, 0, { s, parent: g });
  const top = desk ? desk.userData.size.y : 0.55;
  if (laptop) place('laptop', 0, -0.02, { s: s * 0.62, y: top, parent: g });
  else { place('computerScreen', -0.25, -0.16, { s, y: top, parent: g }); place('computerScreen', 0.25, -0.16, { s, y: top, parent: g }); }
  place('computerKeyboard', 0, 0.14, { s, y: top, parent: g });
  if (chairAt) place('chairDesk', chairAt[0], chairAt[1], { s: s * 0.95, parent: g, rot: Math.PI });
  return g;
}
function ownMaterialsKit(root) {
  let mat = null;
  root.traverse((o) => { if (o.isMesh) { if (!mat) mat = o.material.clone(); o.material = mat; } });
  return mat;
}
function menuBoard() {
  const grp = new THREE.Group();
  const frame = new THREE.Mesh(paint(new RoundedBoxGeometry(1.15, 1.32, 0.08, 2, 0.04), 'body'), KIT); frame.position.y = 1.12; frame.castShadow = true;
  const post = new THREE.Mesh(paint(new THREE.BoxGeometry(0.08, 0.5, 0.08), 'dark'), KIT); post.position.y = 0.25;
  const foot = new THREE.Mesh(paint(new RoundedBoxGeometry(0.5, 0.06, 0.32, 2, 0.02), 'orange'), KIT); foot.position.y = 0.03;
  const c = document.createElement('canvas'); c.width = 560; c.height = 640; const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  grp.userData.redraw = () => {
    g.clearRect(0, 0, 560, 640); g.fillStyle = '#23254A'; g.fillRect(0, 0, 560, 640);
    g.fillStyle = '#FFB23E'; g.font = '800 64px Chivo, sans-serif'; g.fillText(LANG === 'fr' ? 'Services' : 'Services', 40, 92);
    g.fillStyle = '#B9BEEE'; g.font = '500 32px Chivo, sans-serif'; g.fillText(LANG === 'fr' ? "payés à l'usage en USDC" : 'paid per use in USDC', 40, 140);
    [1, 3, 2, 4].forEach((id, i) => { const y = 245 + i * 98; g.fillStyle = PRODUCT_HEX[id]; g.beginPath(); g.arc(56, y - 16, 12, 0, Math.PI * 2); g.fill(); g.fillStyle = '#FFFFFF'; g.font = '700 44px Chivo, sans-serif'; g.fillText(tr(`products.${id}.short`), 88, y); });
    tex.needsUpdate = true;
  };
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.03, 1.18), new THREE.MeshBasicMaterial({ map: tex })); face.position.set(0, 1.12, 0.042);
  grp.add(frame, post, foot, face); scene.add(grp); menuBoards.push(grp);
  return grp;
}
const menuBoards = [];

/* zone labels anchored in 3D */
const zoneLabels = [];
function zoneLabel(key, pos) {
  const el = document.createElement('div'); el.className = 'zlabel'; el.dataset.zone = key;
  const o = new CSS2DObject(el); o.position.copy(pos); scene.add(o); zoneLabels.push({ key, el });
}
/* LED boards drawn on canvas; wall boards hang, floor boards stand */
function ledBoard(w, h, draw, legs) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
  const g = c.getContext('2d'); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const grp = new THREE.Group();
  const frame = new THREE.Mesh(new RoundedBoxGeometry(w + 0.16, h + 0.16, 0.1, 2, 0.04), new THREE.MeshStandardMaterial({ color: '#2b3040', roughness: 0.8 })); frame.castShadow = true;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex })); face.position.z = 0.055;
  grp.add(frame, face);
  if (legs) { const legL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.08), new THREE.MeshStandardMaterial({ color: '#acb5c5' })); legL.position.set(-w / 2 + 0.2, -h / 2 - 0.47, 0); const legR = legL.clone(); legR.position.x = w / 2 - 0.2; grp.add(legL, legR); }
  let key = '';
  grp.userData.set = (k, ...args) => { if (k === key) return; key = k; g.clearRect(0, 0, c.width, c.height); draw(g, c.width, c.height, ...args); tex.needsUpdate = true; };
  scene.add(grp); return grp;
}
function drawLed(g, w, h, title, value, sub) {
  g.fillStyle = '#12141c'; g.fillRect(0, 0, w, h);
  g.shadowColor = '#ffac33'; g.shadowBlur = 14; g.fillStyle = '#ffb347';
  g.font = '700 30px "Chivo Mono", monospace'; g.fillText(title, 24, 46);
  g.font = '700 62px "Chivo Mono", monospace'; g.fillText(value, 24, 116);
  if (sub) { g.shadowBlur = 0; g.fillStyle = '#c9a26a'; g.font = '500 22px "Chivo Mono", monospace'; g.fillText(sub, 24, h - 18); }
}
let boardBlock, boardPaid, gateGlow, scanLight, labGlow, vault, vaultStack, escrow, bondVault, bondStack;

/* =================================================================== 5. the server cabinets ("casiers") and the enclaves in them
   Every slot of the hall holds a real-looking cabinet at all times: black body, perforated door on a hinge, servers with
   drive bays. An enclave is what an operator starts inside one: a service module (the product's colour) slid into the
   empty bay, its LEDs, the status bar and lamp on top. A dark cabinet is a free slot. */
const ROWZ = [1.1, -1.1, -3.3];
const RX = (i) => 0.45 + (i - 2.5) * 0.72;
const CAB = { w: 0.64, h: 1.62, d: 0.78 };
const SLOT_Y = (j) => 0.3 + j * 0.2;
const BAY = 3;                                   // the bay that takes the service module
let FRONT_Z = CAB.d / 2;                         // the front face of a cabinet, in its own space (set again for a rack model)
/* real rack models from Sketchfab, used instead of the cabinets built in code ('?rack=' picks one when testing locally):
   NodeStar's "Data center rack" (Sketchfab Free Standard licence) and Spellkaze's "Server Rack" (CC BY) */
const RACK_MODELS = ['data_center_rack', 'server_rack'];
const RACK_SPEC = {
  data_center_rack: { rotY: Math.PI / 2, led: 'Mat_2', glass: 'Mat_1', inset: 0.06 },
  server_rack: { rotY: -Math.PI / 2, led: 'ServerMaterial', glass: null, inset: -0.02, fitW: 0.64 },
};
const RACK_STYLE = (() => { try { return new URLSearchParams(location.search).get('rack') || RACK_DEFAULT; } catch { return RACK_DEFAULT; } })();
let RACKT = null;
function greyCopy(tex) {
  /* the LED texture in grey, so each cabinet can tint its own LEDs in its state colour */
  const img = tex.image; const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height); const a = d.data;
  for (let i = 0; i < a.length; i += 4) { const y = Math.max(a[i], a[i + 1], a[i + 2]); a[i] = a[i + 1] = a[i + 2] = y; }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  for (const k of ['colorSpace', 'flipY', 'wrapS', 'wrapT', 'channel', 'rotation']) t[k] = tex[k];
  t.repeat.copy(tex.repeat); t.offset.copy(tex.offset); t.center.copy(tex.center); t.needsUpdate = true;
  return t;
}
function rackTemplate() {
  const spec = RACK_SPEC[RACK_STYLE]; const g = spec && G[RACK_STYLE];
  if (!g) return null;
  const src = g.scene.clone(true);
  const turn = new THREE.Group(); turn.rotation.y = spec.rotY; turn.add(src);
  const mid = new THREE.Group(); mid.add(turn); mid.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mid); const size = box.getSize(new THREE.Vector3()); const ctr = box.getCenter(new THREE.Vector3());
  const k = (CAB.h + 0.07) / size.y;
  const kx = spec.fitW ? spec.fitW / size.x : k;
  const t = new THREE.Group(); const wrap = new THREE.Group(); wrap.add(mid); t.add(wrap);
  mid.position.set(-ctr.x, -box.min.y, -ctr.z); wrap.scale.set(kx, k, kx);
  const glass = new THREE.MeshStandardMaterial({ color: '#b8c8ea', transparent: true, opacity: 0.26, roughness: 0.06, metalness: 0.25, depthWrite: false, side: THREE.DoubleSide });
  let ledMat = null;
  t.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    if (spec.glass && o.material.name === spec.glass) { o.material = glass; o.castShadow = false; o.renderOrder = 2; o.userData.isGlass = true; }
    if (o.material.name === spec.led) ledMat = o.material;
  });
  const grey = ledMat && ledMat.emissiveMap ? greyCopy(ledMat.emissiveMap) : null;
  splitDoor(t);
  return { t, spec, grey, size: new THREE.Vector3(size.x * kx, size.y * k, size.z * kx) };
}
/* the model's glass is one closed shell: its front panel becomes a door on a hinge (left edge), so the technician can
   open the cabinet. Triangles lying in the front plane are moved to the door; the rest of the shell stays. */
function splitDoor(t) {
  t.updateMatrixWorld(true);
  let glassMesh = null;
  t.traverse((o) => { if (o.isMesh && o.userData.isGlass) glassMesh = o; });
  if (!glassMesh) return;
  const geo = glassMesh.geometry.index ? glassMesh.geometry.toNonIndexed() : glassMesh.geometry.clone();
  const pos = geo.attributes.position; const M = glassMesh.matrixWorld; const v = new THREE.Vector3();
  const zs = new Float32Array(pos.count); let zmax = -Infinity;
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); zs[i] = v.z; zmax = Math.max(zmax, v.z); }
  const keep = [], door = [];
  for (let i = 0; i < pos.count; i += 3) ((zs[i] > zmax - 0.012 && zs[i + 1] > zmax - 0.012 && zs[i + 2] > zmax - 0.012) ? door : keep).push(i);
  if (!door.length || !keep.length) return;
  const pick = (idxs) => {
    const out = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(geo.attributes)) {
      const arr = new Float32Array(idxs.length * 3 * a.itemSize); let o = 0;
      for (const i of idxs) for (let k = 0; k < 3; k++) for (let c = 0; c < a.itemSize; c++) arr[o++] = a.getComponent(i + k, c);
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    return out;
  };
  glassMesh.geometry = pick(keep);
  const dg = pick(door); dg.applyMatrix4(M); dg.computeBoundingBox();
  const bb = dg.boundingBox; dg.translate(-bb.min.x, 0, -bb.max.z);
  const hinge = new THREE.Group(); hinge.name = 'rack-door'; hinge.position.set(bb.min.x, 0, bb.max.z);
  const dm = new THREE.Mesh(dg, glassMesh.material); dm.renderOrder = 2; hinge.add(dm);
  /* a thin dark frame and a handle make the glass read as a door */
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
  const frameMat = new THREE.MeshStandardMaterial({ color: '#1b1e27', roughness: 0.5, metalness: 0.4 });
  for (const [fw, fh, fx, fy] of [[w, 0.025, w / 2, bb.min.y + 0.012], [w, 0.025, w / 2, bb.max.y - 0.012], [0.025, h, 0.012, (bb.min.y + bb.max.y) / 2], [0.025, h, w - 0.012, (bb.min.y + bb.max.y) / 2]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.012), frameMat); f.position.set(fx, fy, 0.004); hinge.add(f);
  }
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.16, 0.022), new THREE.MeshStandardMaterial({ color: '#c7cede', roughness: 0.3, metalness: 0.7 }));
  handle.position.set(w - 0.045, (bb.min.y + bb.max.y) / 2, 0.016); hinge.add(handle);
  t.add(hinge);
}
/* a cabinet's LEDs light in its enclave's state colour, and go dark when the cabinet is free */
function rackLights(sock, state) {
  if (!sock || !sock.led) return;
  const lit = state && state !== 'retired';
  sock.led.emissive.set(state ? (STATE_HEX[state] || '#ffffff') : '#000000');
  sock.led.emissiveIntensity = lit ? 1.7 : state === 'retired' ? 0.12 : 0;
  sock.ledState = state || null;
}
const sockets = [];
ROWZ.forEach((z) => { for (let i = 0; i < 6; i++) sockets.push({ pos: V3(RX(i), 0, z), pod: null }); });
const pods = new Map();
const hitPods = [];
const RG = {};
const CABMAT = {};
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function rackGeometry() {
  RACKT = rackTemplate();
  if (RACKT) FRONT_Z = RACKT.size.z / 2 - RACKT.spec.inset;
  RG.body = new RoundedBoxGeometry(CAB.w, CAB.h, CAB.d, 2, 0.025).translate(0, CAB.h / 2 + 0.05, 0);
  RG.top = new RoundedBoxGeometry(CAB.w + 0.03, 0.04, CAB.d + 0.03, 1, 0.012).translate(0, CAB.h + 0.07, 0);
  RG.kick = new THREE.BoxGeometry(CAB.w - 0.06, 0.05, CAB.d - 0.06).translate(0, 0.025, 0);
  RG.unit = new THREE.BoxGeometry(0.52, 0.17, 0.035);
  RG.bayHole = new THREE.PlaneGeometry(0.52, 0.17);
  /* the door: an outer frame with a window, extruded, hinged on its left edge */
  const fw = CAB.w - 0.02, fh = CAB.h - 0.06;
  const outer = new THREE.Shape(); outer.moveTo(0, 0); outer.lineTo(fw, 0); outer.lineTo(fw, fh); outer.lineTo(0, fh); outer.lineTo(0, 0);
  const hole = new THREE.Path(); hole.moveTo(0.045, 0.06); hole.lineTo(fw - 0.045, 0.06); hole.lineTo(fw - 0.045, fh - 0.06); hole.lineTo(0.045, fh - 0.06); hole.lineTo(0.045, 0.06);
  outer.holes.push(hole);
  RG.doorFrame = new THREE.ExtrudeGeometry(outer, { depth: 0.022, bevelEnabled: false }).translate(0, 0.08, 0);
  RG.doorMesh = new THREE.PlaneGeometry(fw - 0.09, fh - 0.12).translate(fw / 2, 0.08 + fh / 2, 0.011);
  RG.handle = new THREE.BoxGeometry(0.022, 0.2, 0.03).translate(fw - 0.03, 0.08 + fh * 0.55, 0.035);
  RG.led = new THREE.BoxGeometry(0.03, 0.022, 0.008);
  RG.bar = new THREE.BoxGeometry(0.5, 0.035, 0.03);
  RG.strip = new THREE.BoxGeometry(0.5, 0.04, 0.012);
  RG.module = new RoundedBoxGeometry(0.5, 0.16, 0.42, 2, 0.015);
  RG.moduleFace = new THREE.PlaneGeometry(0.44, 0.05);
  CABMAT.body = new THREE.MeshStandardMaterial({ color: '#262A37', roughness: 0.58, metalness: 0.22 });
  CABMAT.trim = new THREE.MeshStandardMaterial({ color: '#363C50', roughness: 0.5, metalness: 0.3 });
  CABMAT.kick = new THREE.MeshStandardMaterial({ color: '#15171F', roughness: 0.9 });
  CABMAT.handle = new THREE.MeshStandardMaterial({ color: '#AEB6C8', roughness: 0.35, metalness: 0.6 });
  /* server fronts: bezel, drive bays, vents (one canvas, shared) */
  CABMAT.unit = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.6, metalness: 0.1, map: canvasTex(256, 84, (g, w, h) => {
    g.fillStyle = '#9BA3B6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7E869A'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    for (let i = 0; i < 8; i++) { g.fillStyle = '#2B2F3C'; g.fillRect(10 + i * 22, 16, 18, 52); g.fillStyle = '#5E667B'; g.fillRect(12 + i * 22, 20, 14, 4); }
    g.fillStyle = '#3B4152'; for (let i = 0; i < 9; i++) g.fillRect(196 + (i % 3) * 16, 18 + Math.floor(i / 3) * 18, 10, 10);
  }) });
  CABMAT.bay = new THREE.MeshBasicMaterial({ color: '#0B0D13' });
  /* the perforated door: a tile of holes, repeated; through it the servers and their LEDs show */
  CABMAT.mesh = new THREE.MeshStandardMaterial({ color: '#FFFFFF', transparent: true, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false,
    map: canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(32,36,48,0.92)'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'destination-out';
      for (const [x, y] of [[16, 16], [48, 16], [0, 48], [32, 48], [64, 48]]) { g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill(); }
    }, [6, 15]) });
}
let unitsIM = null;
function buildSockets() {
  const units = [];
  for (const s of sockets) {
    const g = new THREE.Group(); g.position.copy(s.pos); scene.add(g);
    if (RACKT) {
      /* a real rack model: its own LED material per cabinet, tinted by the enclave's state */
      const m = RACKT.t.clone(true);
      m.traverse((o) => {
        if (!o.isMesh || o.material.name !== RACKT.spec.led) return;
        o.material = o.material.clone();
        if (RACKT.grey) { o.material.emissiveMap = RACKT.grey; o.material.needsUpdate = true; }
        s.led = o.material;
      });
      g.add(m); s.cab = g; s.door = m.getObjectByName('rack-door') || null; s.doorK = 0; s.ring = { visible: true };
      rackLights(s, null);
      continue;
    }
    const body = new THREE.Mesh(RG.body, CABMAT.body); body.castShadow = true; body.receiveShadow = true;
    const top = new THREE.Mesh(RG.top, CABMAT.trim); top.castShadow = true;
    const kick = new THREE.Mesh(RG.kick, CABMAT.kick);
    const bay = new THREE.Mesh(RG.bayHole, CABMAT.bay); bay.position.set(0, SLOT_Y(BAY), FRONT_Z + 0.002);
    const door = new THREE.Group(); door.position.set(-CAB.w / 2 + 0.01, 0, FRONT_Z + 0.035);
    const frame = new THREE.Mesh(RG.doorFrame, CABMAT.trim); frame.castShadow = true;
    const mesh = new THREE.Mesh(RG.doorMesh, CABMAT.mesh); mesh.renderOrder = 2;
    const handle = new THREE.Mesh(RG.handle, CABMAT.handle);
    door.add(frame, mesh, handle);
    g.add(body, top, kick, bay, door);
    s.cab = g; s.door = door; s.doorK = 0;
    for (let j = 0; j < 7; j++) if (j !== BAY) units.push(new THREE.Matrix4().makeTranslation(s.pos.x, SLOT_Y(j), s.pos.z + FRONT_Z + 0.012));
    s.ring = { visible: true };            // kept for older code: a cabinet stands in every slot, so there is no floor frame
  }
  /* what makes a hall look real: yellow cable trays over each row, perforated tiles in the cold aisles */
  const trayMat = new THREE.MeshStandardMaterial({ color: '#E5B336', roughness: 0.55, metalness: 0.35 });
  const cableMat = new THREE.MeshStandardMaterial({ color: '#2B3A5C', roughness: 0.8 });
  const perf = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.8, map: canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#B9BED3'; g.fillRect(0, 0, w, h); g.strokeStyle = '#9AA0B8'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
    g.fillStyle = '#7C8299'; for (let y = 8; y < h; y += 8) for (let x = 8; x < w; x += 8) { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
  }, [6, 1]) });
  const x0 = RX(0) - CAB.w / 2 - 0.1, x1 = RX(5) + CAB.w / 2 + 0.1;
  for (const z of ROWZ) {
    const tray = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.05, 0.26), trayMat); tray.position.set((x0 + x1) / 2, 1.9, z - 0.2); tray.castShadow = true; scene.add(tray);
    const bundle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, x1 - x0, 10).rotateZ(Math.PI / 2), cableMat); bundle.position.set((x0 + x1) / 2, 1.95, z - 0.2); scene.add(bundle);
    for (let i = 0; i < 6; i++) { const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), cableMat); drop.position.set(RX(i) - 0.15, 1.82, z - 0.2); scene.add(drop); }
    const tiles = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.62), perf); tiles.rotation.x = -Math.PI / 2; tiles.position.set((x0 + x1) / 2, 0.011, z + FRONT_Z + 0.33); tiles.receiveShadow = true; scene.add(tiles);
  }
  if (units.length) {
    unitsIM = new THREE.InstancedMesh(RG.unit, CABMAT.unit, units.length);
    units.forEach((m, i) => unitsIM.setMatrixAt(i, m));
    unitsIM.instanceMatrix.needsUpdate = true; unitsIM.computeBoundingSphere(); unitsIM.receiveShadow = true;
    scene.add(unitsIM);
  }
}
/* the door swings open toward the aisle, and back */
function swingDoor(s, open, dur = 0.55) {
  if (!s || !s.door) return Promise.resolve();
  const from = s.doorK, to = open ? 1 : 0;
  const angle = RACKT ? 1.22 : 1.75;  /* a glass door opened to 70 degrees still reads from the front-left camera */
  return tween(dur, (k) => { s.doorK = from + (to - from) * k; s.door.rotation.y = -angle * s.doorK; });
}
const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const VSEAL_MAT = new THREE.MeshStandardMaterial({ color: '#F5C542', emissive: new THREE.Color('#5a4300'), metalness: 0.6, roughness: 0.3 });
const MODMAT = {};
function moduleMaterial(product) {
  if (!MODMAT[product]) MODMAT[product] = new THREE.MeshStandardMaterial({ color: PRODUCT_HEX[product] || '#94A3B8', roughness: 0.45, metalness: 0.15 });
  return MODMAT[product];
}
/* the service module: what the technician slides into a cabinet to start an enclave */
function makeModule(product) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(RG.module, moduleMaterial(product)); body.castShadow = true;
  const face = new THREE.Mesh(RG.moduleFace, new THREE.MeshBasicMaterial({ color: '#FFFFFF' })); face.position.set(0, 0, 0.212);
  g.add(body, face); g.userData.face = face;
  return g;
}
function makePod(info) {
  const grp = new THREE.Group();
  const module = makeModule(info.product); module.position.set(0, SLOT_Y(BAY), FRONT_Z + 0.02 - 0.21);
  const leds = new THREE.InstancedMesh(RG.led, ledMat, 6);
  const m = new THREE.Matrix4();
  const LJ = [0, 1, 2, 4, 5, 6];
  for (let j = 0; j < 6; j++) { leds.setMatrixAt(j, m.makeTranslation(0.205, SLOT_Y(LJ[j]) + 0.035, FRONT_Z + 0.032)); leds.setColorAt(j, new THREE.Color('#34365C')); }
  leds.instanceMatrix.needsUpdate = true; leds.computeBoundingSphere();
  const bar = new THREE.Mesh(RG.bar, new THREE.MeshBasicMaterial({ color: STATE_HEX.live })); bar.position.set(0, CAB.h + 0.02, FRONT_Z + 0.03);
  const strip = new THREE.Mesh(RG.strip, new THREE.MeshBasicMaterial({ color: PRODUCT_HEX[info.product] || '#94A3B8' })); strip.position.set(0, 0.045, FRONT_Z + 0.02);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.2), new THREE.MeshBasicMaterial({ color: STATE_HEX.live, transparent: true, opacity: 0.5, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.014, FRONT_Z + 0.15);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 14), new THREE.MeshBasicMaterial({ color: STATE_HEX.live })); beacon.position.set(0.2, CAB.h + 0.14, 0.1);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.8, 0.86), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.9;
  /* the verified level: a gold seal on top (chip and datacenter declared on Arc) */
  const vseal = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 20), VSEAL_MAT); vseal.position.set(-0.17, CAB.h + 0.098, 0.1); vseal.visible = false;
  if (RACKT) leds.visible = false;
  grp.add(module, leds, bar, strip, glow, beacon, hit, vseal);
  scene.add(grp);
  const edgeMat = new THREE.MeshBasicMaterial({ color: STATE_HEX.live });      // kept for older code paths
  const pod = { id: info.id, info, grp, glow, beacon, bar, edgeMat, leds, strip, hit, module, vseal, state: 'retired', socket: null, verified: false, shown: false, flash: 0, mats: {} };
  hit.userData.pod = pod; hitPods.push(hit); grp.visible = false;
  return pod;
}
const SC = {}; for (const [k, v] of Object.entries(STATE_HEX)) SC[k] = new THREE.Color(v);
const OFF = new THREE.Color('#2f3252');
function setPodState(pod, state) {
  pod.state = state;
  const c = SC[state] || SC.retired; const lit = state !== 'retired';
  pod.bar.material.color.copy(lit ? c : OFF);
  pod.glow.material.color.copy(c); pod.glow.material.opacity = lit ? 0.62 : 0;
  pod.beacon.material.color.copy(c); pod.beacon.visible = lit;
  pod.strip.material.color.set(lit ? (PRODUCT_HEX[pod.info.product] || '#94A3B8') : '#5b607a');
  pod.module.userData.face.material.color.set(lit ? c : '#4a4f66');
  for (let j = 0; j < 6; j++) pod.leds.setColorAt(j, lit ? c : OFF);
  pod.leds.instanceColor.needsUpdate = true;
  if (pod.socket) rackLights(pod.socket, state);
}
function seatPod(pod, socket) {
  pod.socket = socket; socket.pod = pod; rackLights(socket, pod.state);
  pod.grp.position.copy(socket.pos); pod.grp.scale.setScalar(1);
  pod.grp.visible = true; pod.shown = true;
}
function unseatAll() {
  for (const p of pods.values()) { p.grp.visible = false; p.shown = false; if (p.socket) { p.socket.pod = null; rackLights(p.socket, null); } p.socket = null; }
}
function socketPlan() {
  const list = DATA.pods.slice();
  const live = list.filter((p) => p.active).sort((a, b) => Number(a.product) - Number(b.product));
  const rest = list.filter((p) => !p.active).sort((a, b) => Date.parse(a.first) - Date.parse(b.first));
  /* more keys than slots: the oldest grey racks go to the archive (still in the history and in Find); the liar always stays */
  while (live.length + rest.length > sockets.length) {
    const i = rest.findIndex((p) => !(p.fault || []).length);
    if (i < 0) break;
    rest.splice(i, 1);
  }
  const plan = new Map(); [...live, ...rest].slice(0, sockets.length).forEach((p, i) => plan.set(p.id, sockets[i]));
  return plan;
}
/* a slot for a key that appears while the page is open: a free one, else the oldest grey rack's */
function takeSocket() {
  const used = new Set(PLAN.values());
  const free = sockets.find((s) => !used.has(s));
  if (free) return free;
  const old = DATA.pods.filter((p) => PLAN.has(p.id) && !p.active && !(p.fault || []).length)
    .sort((a, b) => Date.parse(a.last || a.first) - Date.parse(b.last || b.first))[0];
  if (!old) return null;
  const s = PLAN.get(old.id); PLAN.delete(old.id);
  const pod = pods.get(old.id); if (pod) { pod.grp.visible = false; pod.shown = false; pod.socket = null; }
  s.pod = null; rackLights(s, null);
  return s;
}
let PLAN;
let ledTick = 0;
const tmpC = new THREE.Color();
function rackTick(dt) {
  ledTick += dt; if (ledTick < 0.12) return; ledTick = 0;
  for (const p of pods.values()) {
    if (!p.shown) continue;
    p.vseal.visible = !!p.verified && p.state !== 'retired';
    if (p.socket && p.socket.led) {
      const L = p.socket.led;
      if (p.state === 'live' || p.state === 'session') L.emissiveIntensity = 1.35 + Math.random() * 0.6;
      else if (p.state === 'checking' || p.state === 'fault') L.emissiveIntensity = Math.floor(simT * (p.state === 'checking' ? 6 : 3)) % 2 === 0 ? 1.8 : 0.2;
    }
    if (p.state === 'live' || p.state === 'session') {
      for (let j = 0; j < 6; j++) { if (Math.random() < 0.35) p.leds.setColorAt(j, Math.random() < 0.75 ? SC[p.state] : tmpC.copy(SC[p.state]).multiplyScalar(0.4)); }
      p.leds.instanceColor.needsUpdate = true;
    } else if (p.state === 'checking' || p.state === 'fault') {
      const on = Math.floor(simT * (p.state === 'checking' ? 6 : 3)) % 2 === 0;
      for (let j = 0; j < 6; j++) p.leds.setColorAt(j, on ? SC[p.state] : OFF);
      p.leds.instanceColor.needsUpdate = true; p.bar.material.color.copy(on ? SC[p.state] : OFF);
    }
  }
}

/* =================================================================== 6. the Arc layers over the racks */
const layers = [];
function buildLayers() {
  ['registry', 'product', 'bond'].forEach((key, i) => {
    const w = 5.6 - i * 0.2, d = 6.2 - i * 0.2;
    const shape = roundedRect(w, d, 0.35);
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(Math.PI / 2);
    const sheet = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#5B8CFF', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    sheet.renderOrder = 10 + i;
    const pts = shape.getPoints(8).map((p) => V3(p.x, 0, p.y));
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#9DB7FF', transparent: true, opacity: 0 }));
    edge.renderOrder = 20 + i;
    const g = new THREE.Group(); g.add(sheet, edge);
    const y = 1.95 + i * 0.36; g.position.set(Z.hive.x, y, Z.hive.z); scene.add(g);
    const lab = document.createElement('div'); lab.className = 'layerlabel'; lab.style.opacity = '0';
    const lo = new CSS2DObject(lab); lo.position.set(-w / 2 + 0.2, 0, d / 2 - 0.3 - i * 0.9); g.add(lo);
    layers.push({ key, g, sheet, edge, y, lab, pulse: 0 });
  });
}
function pulseLayer(key) { const L = layers.find((l) => l.key === key); if (L) L.pulse = 1; }
let layersDescend = 0;
function updateLayers(dt) {
  for (const [i, L] of layers.entries()) {
    L.pulse = Math.max(0, L.pulse - dt * 0.7);
    const k = easeOut(clamp01((layersDescend - i * 0.15) / 0.7));
    const tour = tourStep === 4;
    L.g.position.y = THREE.MathUtils.lerp(L.y + 8 + i * 1.5, L.y, tour ? k : 1);
    L.sheet.material.opacity = (tour ? 0.2 * k : 0) + 0.2 * L.pulse;
    L.edge.material.opacity = (tour ? 0.95 * k : 0) + 0.6 * L.pulse;
    L.lab.style.opacity = tour ? String(k) : String(Math.min(1, L.pulse * 1.6));
  }
}
