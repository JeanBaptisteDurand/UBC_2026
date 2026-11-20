/* x-ray: open one cabinet and slide its service module half out, to show the sealed chip inside */
let xrayPod = null;
function buildTray(product) {
  const t = makeModule(product);
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.34), new THREE.MeshStandardMaterial({ color: '#1F8A70', roughness: 0.6 })); pcb.position.set(0, 0.086, -0.02);
  const chip = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.035, 0.15, 2, 0.01), new THREE.MeshStandardMaterial({ color: '#2B2F3C', roughness: 0.5 })); chip.position.set(-0.06, 0.11, -0.02);
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.006, 0.08), new THREE.MeshBasicMaterial({ color: '#FFA034' })); core.position.set(-0.06, 0.13, -0.02);
  const sealGeo = new THREE.BoxGeometry(0.26, 0.12, 0.26);
  const seal = new THREE.Mesh(sealGeo, new THREE.MeshBasicMaterial({ color: '#5B86FF', transparent: true, opacity: 0.3, depthWrite: false })); seal.position.set(-0.06, 0.15, -0.02);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(sealGeo), new THREE.LineBasicMaterial({ color: '#9DB7FF' })); edges.position.copy(seal.position);
  t.add(pcb, chip, core, seal, edges);
  return t;
}
function xray(pod, on) {
  if (xrayPod) { xrayPod.module.visible = true; if (xrayPod.socket) swingDoor(xrayPod.socket, false, 0.4); }
  if (pulledTray) pulledTray.removeFromParent();
  xrayPod = on ? pod : null;
  if (!pod || !on) return;
  pulledTray = buildTray(pod.info.product);
  pod.module.visible = false;
  pod.grp.add(pulledTray);
  const z0 = FRONT_Z + 0.02 - 0.21;
  pulledTray.position.set(0, SLOT_Y(BAY), z0);
  if (pod.socket) swingDoor(pod.socket, true, 0.6);
  wait(0.45).then(() => { if (xrayPod === pod) tween(1.0, (k) => { pulledTray.position.z = z0 + 0.5 * k; }); });
}

