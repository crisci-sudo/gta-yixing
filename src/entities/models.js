import * as THREE from 'three';

const MAT = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
const GLASS = MAT(0x1b2733);
const CHROME = MAT(0x2a2e35);
const RUBBER = MAT(0x15171a);

const shadowGeo = new THREE.PlaneGeometry(2, 2);
let shadowTex;
function shadowTexture() {
  if (shadowTex) return shadowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,.62)');
  grd.addColorStop(0.55, 'rgba(0,0,0,.30)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(cv);
  return shadowTex;
}

export function blobShadow(radius = 1.15, opacity = 0.34) {
  const m = new THREE.Mesh(
    shadowGeo,
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(radius * 1.35);
  m.position.y = 0.04;
  return m;
}

const SPECS = {
  sedan: { L: 4.4, W: 1.86, body: 0.78, cabin: [2.05, 0.6, 1.68], zc: -0.25, wheel: 0.37, power: 13.5, top: 40, brake: 26, steerMax: 0.6, wheelbase: 3.0, grip: 8.2, mass: 1.0, name: '义兴 500' },
  coupe: { L: 4.3, W: 1.92, body: 0.66, cabin: [1.75, 0.5, 1.66], zc: -0.45, wheel: 0.38, power: 16.5, top: 47, brake: 30, steerMax: 0.55, wheelbase: 2.9, grip: 9.4, mass: 0.95, name: '疾风 GT' },
  van: { L: 5.1, W: 2.0, body: 1.5, cabin: [2.4, 1.3, 1.9], zc: 0.5, wheel: 0.42, power: 10, top: 31, brake: 22, steerMax: 0.55, wheelbase: 3.4, grip: 7.0, mass: 1.45, name: '长风货运' },
  taxi: { L: 4.5, W: 1.86, body: 0.8, cabin: [2.05, 0.62, 1.7], zc: -0.2, wheel: 0.37, power: 15, top: 43, brake: 26, steerMax: 0.6, wheelbase: 3.0, grip: 8.2, mass: 1.05, name: '义兴出租' },
  police: { L: 4.7, W: 1.94, body: 0.82, cabin: [2.1, 0.58, 1.72], zc: -0.25, wheel: 0.39, power: 20, top: 52, brake: 30, steerMax: 0.6, wheelbase: 3.1, grip: 9.0, mass: 1.1, name: '巡逻者' },
};

export const carSpec = (kind) => SPECS[kind] || SPECS.sedan;
export const CAR_KINDS = Object.keys(SPECS);

/** Box-art car facing +Z. Returns { group, wheels, frontPivots, lights }. */
export function makeCar(kind, colorHex) {
  const s = carSpec(kind);
  const g = new THREE.Group();
  const paint = MAT(colorHex);
  const dark = MAT(0x1d2128);

  const body = new THREE.Mesh(new THREE.BoxGeometry(s.W, s.body, s.L), paint);
  body.position.y = 0.34 + s.wheel * 0.55;
  g.add(body);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(s.cabin[1], s.cabin[1] * 0.62, s.cabin[0]), kind === 'van' ? paint : GLASS);
  cab.position.set(0, body.position.y + s.body / 2 + s.cabin[1] * 0.31 - 0.05, s.zc);
  g.add(cab);

  if (kind !== 'van') {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(s.cabin[1] * 0.9, 0.12, s.cabin[0] * 0.86), paint);
    roof.position.set(0, cab.position.y + s.cabin[1] * 0.31 + 0.03, s.zc);
    g.add(roof);
  }

  if (kind === 'van') {
    const win = new THREE.Mesh(new THREE.BoxGeometry(s.cabin[1] + 0.02, 0.42, 0.06), GLASS);
    win.position.set(0, cab.position.y, s.zc + s.cabin[0] / 2 + 0.02);
    g.add(win);
  }

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(s.W + 0.04, 0.16, s.L * 0.86), dark);
  skirt.position.y = 0.3;
  g.add(skirt);

  const head = MAT(0xfff4d0, { emissive: 0xffeec0, emissiveIntensity: 0.8 });
  const tail = MAT(0x6b1111, { emissive: 0xff2222, emissiveIntensity: 0.7 });
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.1), head);
    h.position.set(sx * s.W * 0.32, body.position.y + 0.05, s.L / 2 - 0.02);
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.1), tail);
    t.position.set(sx * s.W * 0.32, body.position.y + 0.08, -s.L / 2 + 0.02);
    g.add(t);
  }

  const wheels = [], frontPivots = [];
  const wgeo = new THREE.CylinderGeometry(s.wheel, s.wheel, 0.26, 12);
  const hub = new THREE.CylinderGeometry(s.wheel * 0.42, s.wheel * 0.42, 0.28, 8);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * (s.W / 2 - 0.06), s.wheel, sz * (s.L / 2 - s.wheel - 0.55));
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(wgeo, RUBBER);
    tyre.rotation.z = Math.PI / 2;
    const rim = new THREE.Mesh(hub, CHROME);
    rim.rotation.z = Math.PI / 2;
    spin.add(tyre, rim);
    pivot.add(spin);
    g.add(pivot);
    wheels.push(spin);
    if (sz > 0) frontPivots.push(pivot);
  }

  g.add(blobShadow(Math.max(s.L, s.W) * 0.6, 0.3));
  const lights = { head: [], tail: [] };
  return { group: g, wheels, frontPivots, lights, spec: s };
}

/** Police livery: white body, black doors, flashing light bar. */
export function makePoliceCar() {
  const c = makeCar('police', 0xf1f3f6);
  const black = MAT(0x1b2430);
  for (const sx of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 1.5), black);
    door.position.set(sx * 0.98, 1.05, -0.1);
    c.group.add(door);
  }
  const bar = new THREE.Group();
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.28), MAT(0xff3030, { emissive: 0xff2020, emissiveIntensity: 1 }));
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.28), MAT(0x3050ff, { emissive: 0x3050ff, emissiveIntensity: 1 }));
  red.position.x = -0.32; blue.position.x = 0.32;
  bar.add(red, blue);
  bar.position.set(0, 1.62, -0.25);
  c.group.add(bar);
  c.lights.bar = bar;
  c.lights.red = red;
  c.lights.blue = blue;
  return c;
}

const SKINS = [0xd9a066, 0xc8895a, 0x8d5a3b, 0xf0c9a0];
const SHIRTS = [0xd23c3c, 0x2f6fd0, 0x2fa36b, 0xd8a02c, 0x7b3fa0, 0xdedede, 0x37404a, 0xe06b2f];
const PANTS = [0x2b3038, 0x40485a, 0x1d1f24, 0x6b5a44];

/** Simple articulated ped facing +Z, limbs pivoted for a walk cycle. */
export function makePed(seed = 1, style = null) {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 8) / 16777216;
  const skin = MAT(SKINS[Math.floor(rnd() * SKINS.length)]);
  const shirt = MAT(style?.shirt ?? SHIRTS[Math.floor(rnd() * SHIRTS.length)]);
  const pants = MAT(style?.pants ?? PANTS[Math.floor(rnd() * PANTS.length)]);

  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.66, 0.26), shirt);
  torso.position.y = 1.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8), skin);
  head.position.y = 1.62;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), MAT(0x241d18));
  hair.position.y = 1.64;
  g.add(torso, head, hair);
  if (style?.cap) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.36), MAT(style.cap));
    cap.position.set(0, 1.75, 0.03);
    g.add(cap);
  }

  const limb = (w, h, d, mat, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.y = -h / 2;
    pivot.add(m);
    g.add(pivot);
    return pivot;
  };
  const armL = limb(0.13, 0.56, 0.14, shirt, -0.3, 1.42);
  const armR = limb(0.13, 0.56, 0.14, shirt, 0.3, 1.42);
  const legL = limb(0.17, 0.78, 0.18, pants, -0.13, 0.83);
  const legR = limb(0.17, 0.78, 0.18, pants, 0.13, 0.83);
  g.add(blobShadow(0.62, 0.3));
  return { group: g, limbs: { armL, armR, legL, legR }, head, torso };
}
