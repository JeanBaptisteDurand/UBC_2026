/* the camera's view of each zone: the point it looks at (t) and its zoom (z), read by focus() */
const PRESET = {
  overview: { t: V3(0.3, 0, 0.0), z: 1 },
  pad: { t: V3(-6.0, 0.5, -2.0), z: 1.75 },
  gate: { t: V3(-6.3, 0.7, -2.9), z: 2.2 },
  dish: { t: V3(-3.4, 1.0, -4.6), z: 2.0 },
  hive: { t: V3(0.45, 0.6, -1.1), z: 1.55 },
  layers: { t: V3(0.45, 1.9, -1.1), z: 1.35 },
  dock: { t: V3(4.7, 0.6, 4.0), z: 1.45 },
  noc: { t: V3(3.6, 0.7, 0.4), z: 1.7 },
  lab: { t: V3(5.5, 0.6, -3.9), z: 1.8 },
  author: { t: V3(-6.0, 0.5, 3.9), z: 2.0 },
  provider: { t: V3(7.3, 1.0, -0.8), z: 2.0 },
};
