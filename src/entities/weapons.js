import * as THREE from 'three';

const MAT = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

/** Slot order is the number-key order, so 1..6 always maps to the same weapon. */
export const WEAPON_ORDER = ['fists', 'bat', 'pistol', 'smg', 'molotov', 'launcher'];

export const WEAPONS = {
  fists: {
    id: 'fists', name: '拳头', kind: 'melee', slot: 1,
    dmg: 13, rate: 0.34, reach: 2.4, arc: 1.15, combo: [0.9, 1.0, 1.9],
  },
  bat: {
    id: 'bat', name: '球棒', kind: 'melee', slot: 2,
    dmg: 38, rate: 0.62, reach: 3.2, arc: 1.6,
  },
  pistol: {
    id: 'pistol', name: '手枪', kind: 'gun', slot: 3,
    dmg: 27, rate: 0.29, range: 140, spread: 0.013, auto: false, start: 54, reload: 0,
  },
  smg: {
    id: 'smg', name: '冲锋枪', kind: 'gun', slot: 4,
    dmg: 14, rate: 0.085, range: 105, spread: 0.052, auto: true, start: 0,
  },
  molotov: {
    id: 'molotov', name: '燃烧瓶', kind: 'throw', slot: 5,
    dmg: 46, blast: 6.2, range: 26, auto: false, start: 0, fuse: 1.25,
  },
  launcher: {
    id: 'launcher', name: '火箭筒', kind: 'missile', slot: 6,
    dmg: 150, blast: 9.5, range: 220, rate: 1.15, auto: false, start: 0, homing: 1.9,
  },
};

export const AMMO_MAX = { pistol: 240, smg: 480, molotov: 12, launcher: 8 };

/** Pickup payload sizes — one crate is a meaningful top-up, not a full arsenal. */
export const PICKUP_AMOUNT = { pistol: 42, smg: 120, molotov: 3, launcher: 2, bat: 0 };

const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  sph: new THREE.SphereGeometry(1, 8, 7),
};

const put = (parent, g, m, sx, sy, sz, x, y, z, rx = 0) => {
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  parent.add(mesh);
  return mesh;
};

/** Grip-relative model; the muzzle sits at `tip` in local units so flashes line up. */
export function makeWeaponMesh(id) {
  const g = new THREE.Group();
  const steel = MAT(0x2b2f36);
  const dark = MAT(0x15181c);
  const wood = MAT(0x8a5a2b);
  let tip = 0.34;

  if (id === 'pistol') {
    put(g, geo.box, steel, 0.06, 0.13, 0.09, 0, -0.02, 0.02);
    put(g, geo.box, dark, 0.05, 0.05, 0.22, 0, 0.05, 0.12);
  } else if (id === 'smg') {
    put(g, geo.box, steel, 0.07, 0.1, 0.34, 0, 0.02, 0.16);
    put(g, geo.box, dark, 0.06, 0.16, 0.08, 0, -0.08, 0.06);
    put(g, geo.box, dark, 0.05, 0.13, 0.06, 0, -0.06, 0.2);
    tip = 0.35;
  } else if (id === 'bat') {
    put(g, geo.cyl, wood, 0.045, 0.62, 0.045, 0, 0.16, 0.1, Math.PI / 2);
    put(g, geo.cyl, MAT(0x5a3a1c), 0.055, 0.16, 0.055, 0, 0.16, -0.16, Math.PI / 2);
    tip = 0.5;
  } else if (id === 'molotov') {
    put(g, geo.sph, MAT(0x7a4a22), 0.075, 0.09, 0.075, 0, 0.02, 0.1);
    put(g, geo.box, MAT(0xd8d2c4), 0.05, 0.05, 0.05, 0, 0.1, 0.1);
    tip = 0.14;
  } else if (id === 'launcher') {
    put(g, geo.cyl, MAT(0x3c4a3a), 0.075, 0.62, 0.075, 0, 0.03, 0.16, Math.PI / 2);
    put(g, geo.cyl, MAT(0x22282a), 0.09, 0.12, 0.09, 0, 0.03, 0.44, Math.PI / 2);
    put(g, geo.box, dark, 0.05, 0.12, 0.07, 0, -0.08, 0.08);
    tip = 0.52;
  }
  g.userData.tip = tip;
  return g;
}

/** Floating world pickup: a lit crate the player walks into. */
export function makePickupMesh(id) {
  const g = new THREE.Group();
  const color = id === 'launcher' ? 0x4a6a3a : id === 'molotov' ? 0xc4562a : id === 'smg' ? 0x3a5a8a : 0x8a7a3a;
  put(g, geo.box, MAT(color), 0.5, 0.34, 0.5, 0, 0.3, 0);
  put(g, geo.box, MAT(0xffd98a, { emissive: 0xffb43c, emissiveIntensity: 0.9 }), 0.54, 0.06, 0.54, 0, 0.5, 0);
  const halo = put(g, geo.sph, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.2, depthWrite: false,
  }), 0.9, 0.9, 0.9, 0, 0.34, 0);
  g.userData.halo = halo;
  g.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false })
  ).rotateX(-Math.PI / 2));
  g.children[g.children.length - 1].position.y = 0.03;
  return g;
}
