import * as THREE from 'three';
import { SpatialHash, resolveCircle, blocksPoint } from './collision.js';
import { makeRng, rrange, rint, pick, chance, clamp } from '../core/math.js';

export const GRID = 8;          // blocks per axis
export const BLOCK = 58;        // building-block footprint
export const ROAD = 13;         // carriageway width (2 lanes, two-way)
export const CELL = BLOCK + ROAD;
export const SIZE = GRID * CELL;
export const HALF = SIZE / 2;
export const LANE = ROAD / 2 - 3.25;   // lane centre offset from road centre
export const PARK = LANE + 1.9;        // kerbside offset for a parked car
export const SIDEWALK = 5.2;           // pavement band around each block

const PX = 4096;
const SCALE = PX / SIZE;

const w = (local) => local - HALF;
export const roadAt = (i) => w(i * CELL + BLOCK + ROAD / 2);

/** Lane centre for traffic moving along +axis / -axis on road i. */
export const laneX = (i, dir) => roadAt(i) + (dir > 0 ? -LANE : LANE);
export const laneZ = (i, dir) => roadAt(i) + (dir > 0 ? LANE : -LANE);

const FACADES = [0x8d96a6, 0x6f7b8c, 0xa89b86, 0x5d6b7a, 0x94a3b8, 0x7a6a5f, 0xb0a48f];

export class City {
  constructor() {
    this.rng = makeRng(20261018);
    this.hash = new SpatialHash(26);
    this.rects = [];
    this.parks = [];
    this.parkingLots = [];
    this.landmark = null;
    this.group = new THREE.Group();
    this.groundCanvas = document.createElement('canvas');
    this.groundCanvas.width = this.groundCanvas.height = PX;
  }

  build() {
    this._planBlocks();
    this._paintGround();
    this._addGround();
    this._addBuildings();
    this._addProps();
    return this.group;
  }

  // ---------------------------------------------------------------- layout
  _planBlocks() {
    this.blockKinds = [];
    for (let i = 0; i < GRID; i++) {
      this.blockKinds[i] = [];
      for (let j = 0; j < GRID; j++) {
        const centreDist = Math.hypot(i - (GRID - 1) / 2, j - (GRID - 1) / 2) / (GRID / 2);
        const r = this.rng();
        let kind = 'city';
        if (i === 3 && j === 3) kind = 'landmark';
        else if (r < (centreDist > 0.72 ? 0.2 : 0.09)) kind = 'park';
        else if (r < (centreDist > 0.72 ? 0.3 : 0.14)) kind = 'lot';
        this.blockKinds[i][j] = { kind, centreDist };
      }
    }
  }

  // ------------------------------------------------------------ ground art
  _paintGround() {
    const c = this.groundCanvas.getContext('2d');
    const s = SCALE;
    const px = (world) => (world + HALF) * s;

    c.fillStyle = '#1d2025';
    c.fillRect(0, 0, PX, PX);

    const line = (x0, z0, x1, z1, color, width) => {
      c.strokeStyle = color;
      c.lineWidth = Math.max(1, width * s);
      c.beginPath();
      c.moveTo(px(x0), px(z0));
      c.lineTo(px(x1), px(z1));
      c.stroke();
    };
    const box = (x0, z0, x1, z1, color) => {
      c.fillStyle = color;
      c.fillRect(px(x0), px(z0), (x1 - x0) * s, (z1 - z0) * s);
    };

    // Blocks: pavement ring + concrete plot.
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const info = this.blockKinds[i][j];
        const x0 = w(i * CELL), z0 = w(j * CELL);
        const x1 = x0 + BLOCK, z1 = z0 + BLOCK;
        box(x0, z0, x1, z1, '#8d939c');
        const kind = info.kind;
        if (kind === 'park') {
          box(x0 + SIDEWALK, z0 + SIDEWALK, x1 - SIDEWALK, z1 - SIDEWALK, '#2f5b39');
          this.parks.push({ x0: x0 + SIDEWALK, z0: z0 + SIDEWALK, x1: x1 - SIDEWALK, z1: z1 - SIDEWALK });
        } else {
          box(x0 + SIDEWALK, z0 + SIDEWALK, x1 - SIDEWALK, z1 - SIDEWALK, kind === 'lot' ? '#464b54' : '#5a6069');
          if (kind === 'lot') this.parkingLots.push({ x0: x0 + SIDEWALK, z0: z0 + SIDEWALK, x1: x1 - SIDEWALK, z1: z1 - SIDEWALK });
        }
      }
    }

    // Centre lines + edge lines.
    for (let i = 0; i < GRID; i++) {
      const p = roadAt(i);
      const edge = -HALF - 2, far = HALF + 2;
      line(edge, p - 0.36, far, p - 0.36, '#b89327', 0.22);
      line(edge, p + 0.36, far, p + 0.36, '#b89327', 0.22);
      line(p - 0.36, edge, p - 0.36, far, '#b89327', 0.22);
      line(p + 0.36, edge, p + 0.36, far, '#b89327', 0.22);
      line(edge, p - ROAD / 2 + 0.35, far, p - ROAD / 2 + 0.35, 'rgba(255,255,255,.55)', 0.25);
      line(edge, p + ROAD / 2 - 0.35, far, p + ROAD / 2 - 0.35, 'rgba(255,255,255,.55)', 0.25);
      line(p - ROAD / 2 + 0.35, edge, p - ROAD / 2 + 0.35, far, 'rgba(255,255,255,.55)', 0.25);
      line(p + ROAD / 2 - 0.35, edge, p + ROAD / 2 - 0.35, far, 'rgba(255,255,255,.55)', 0.25);
    }

    // Dashed lane divider along the kerb side of each carriageway.
    c.setLineDash([3 * s, 4 * s]);
    for (let i = 0; i < GRID; i++) {
      const p = roadAt(i);
      line(-HALF, p - LANE * 2, HALF, p - LANE * 2, 'rgba(255,255,255,.22)', 0.2);
      line(-HALF, p + LANE * 2, HALF, p + LANE * 2, 'rgba(255,255,255,.22)', 0.2);
      line(p - LANE * 2, -HALF, p - LANE * 2, HALF, 'rgba(255,255,255,.22)', 0.2);
      line(p + LANE * 2, -HALF, p + LANE * 2, HALF, 'rgba(255,255,255,.22)', 0.2);
    }
    c.setLineDash([]);

    // Crosswalks at every intersection.
    const stripes = (cx, cz, axis) => {
      for (let k = -3; k <= 3; k++) {
        const off = k * (ROAD / 8);
        if (axis === 'x') line(cx + off - 0.5, cz, cx + off - 0.5, cz, '#cfd3da', 0);
        const t = 1.9;
        if (axis === 'x') {
          c.fillStyle = '#cfd3da';
          c.fillRect(px(cx + off - 0.55), px(cz - ROAD / 2 + 1.6), 1.1 * s, t * s);
          c.fillRect(px(cx + off - 0.55), px(cz + ROAD / 2 - 1.6 - t), 1.1 * s, t * s);
        } else {
          c.fillStyle = '#cfd3da';
          c.fillRect(px(cx - ROAD / 2 + 1.6), px(cz + off - 0.55), t * s, 1.1 * s);
          c.fillRect(px(cx + ROAD / 2 - 1.6 - t), px(cz + off - 0.55), t * s, 1.1 * s);
        }
      }
    };
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) stripes(roadAt(i), roadAt(j), 'x');
    }

    // District tint in the core so downtown reads differently.
    c.fillStyle = 'rgba(120,150,200,.06)';
    c.beginPath();
    c.arc(px(0), px(0), HALF * 0.42 * s, 0, Math.PI * 2);
    c.fill();
  }

  _addGround() {
    const tex = new THREE.CanvasTexture(this.groundCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    this.ground = mesh;

    // Outskirts: flat desert plain so the horizon isn't a texture edge.
    const far = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshLambertMaterial({ color: 0x39393b })
    );
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.06;
    this.group.add(mesh, far);
  }

  // ------------------------------------------------------------- buildings
  _facadeTextures() {
    // One 128px tile covers ~26m of facade: 8 windows wide, 8 floors tall.
    const make = (seed, base) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      const rng = makeRng(seed);
      g.fillStyle = '#' + base.toString(16).padStart(6, '0');
      g.fillRect(0, 0, 128, 128);
      g.globalAlpha = 0.1;
      for (let i = 0; i < 70; i++) {
        g.fillStyle = rng() > 0.5 ? '#ffffff' : '#000000';
        g.fillRect(rng() * 128, rng() * 128, 2 + rng() * 22, 1 + rng() * 2);
      }
      g.globalAlpha = 1;
      const lit = 0.3 + rng() * 0.3;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const ox = x * 16 + 3, oy = y * 16 + 4;
          g.fillStyle = rng() < lit ? '#ffdda0' : '#1c232c';
          g.fillRect(ox, oy, 10, 8);
          g.fillStyle = 'rgba(255,255,255,.14)';
          g.fillRect(ox, oy, 10, 1.6);
          g.fillStyle = 'rgba(0,0,0,.4)';
          g.fillRect(ox, oy + 6.4, 10, 1.6);
        }
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    };
    return FACADES.map((f, i) => new THREE.MeshLambertMaterial({ map: make(1000 + i * 37, f) }));
  }

  _addBuildings() {
    const mats = this._facadeTextures();
    this.mats = mats;
    const boxCache = new Map();
    const unit = new THREE.BoxGeometry(1, 1, 1);

    const addBox = (cx, cz, sx, sz, sy, mat) => {
      // UVs are re-scaled per footprint so windows keep a constant real-world pitch.
      const key = Math.round(sx * 4) + '_' + Math.round(sz * 4) + '_' + Math.round(sy * 4);
      let proto = boxCache.get(key);
      if (!proto) {
        proto = new THREE.BoxGeometry(sx, sy, sz);
        const uv = proto.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          const face = Math.floor(i / 4);
          let u = uv.getX(i), v = uv.getY(i);
          if (face === 2 || face === 3) { u *= sx / 26; v *= sz / 26; }
          else if (face < 2) { u *= sz / 26; v *= sy / 26; }
          else { u *= sx / 26; v *= sy / 26; }
          uv.setXY(i, u, v);
        }
        uv.needsUpdate = true;
        boxCache.set(key, proto);
      }
      const mesh = new THREE.Mesh(proto, mat);
      mesh.position.set(cx, sy / 2, cz);
      this.group.add(mesh);
      return mesh;
    };

    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const info = this.blockKinds[i][j];
        if (info.kind === 'park' || info.kind === 'lot') continue;
        const bx = w(i * CELL) + SIDEWALK, bz = w(j * CELL) + SIDEWALK;
        const span = BLOCK - SIDEWALK * 2;

        if (info.kind === 'landmark') {
          const h = 168;
          const mesh = addBox(bx + span / 2, bz + span / 2, span * 0.52, span * 0.52, h, mats[0]);
          const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.6, 34, 6), mats[1]);
          spire.position.set(bx + span / 2, h + 17, bz + span / 2);
          this.group.add(spire);
          this._solid(bx + span / 2 - span * 0.26, bz + span / 2 - span * 0.26, bx + span / 2 + span * 0.26, bz + span / 2 + span * 0.26, h, 'tower');
          this.landmark = { x: bx + span / 2, z: bz + span / 2, h };
          continue;
        }

        const cols = info.centreDist > 0.6 ? rint(this.rng, 1, 2) : rint(this.rng, 2, 3);
        const rows = info.centreDist > 0.6 ? rint(this.rng, 1, 2) : rint(this.rng, 2, 3);
        const gap = 3.2;
        const lotW = (span - gap * (cols - 1)) / cols;
        const lotD = (span - gap * (rows - 1)) / rows;

        for (let a = 0; a < cols; a++) {
          for (let b = 0; b < rows; b++) {
            if (chance(this.rng, 0.12)) continue;   // vacant lot / courtyard
            const inset = rrange(this.rng, 0, 2.4);
            const sx = lotW - inset, sz = lotD - rrange(this.rng, 0, 2.4);
            const cx = bx + a * (lotW + gap) + lotW / 2;
            const cz = bz + b * (lotD + gap) + lotD / 2;
            const downtown = 1 - info.centreDist;
            let h = rrange(this.rng, 8, 26) + downtown * downtown * rrange(this.rng, 10, 62);
            h = clamp(h, 7, 96);
            const mat = pick(this.rng, mats);
            addBox(cx, cz, sx, sz, h, mat);
            if (chance(this.rng, 0.4)) {
              const ph = rrange(this.rng, 1.2, 3.2);
              const pent = new THREE.Mesh(unit, mat);
              pent.scale.set(sx * 0.42, ph, sz * 0.42);
              pent.position.set(cx, h + ph / 2, cz);
              this.group.add(pent);
            }
            this._solid(cx - sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2, h, 'building');
          }
        }
      }
    }
  }

  _solid(x0, z0, x1, z1, h, kind) {
    const r = { x0, z0, x1, z1, h, kind };
    this.rects.push(r);
    this.hash.insert(r);
    return r;
  }

  // ----------------------------------------------------------------- props
  _addProps() {
    const rng = this.rng;
    const lampPos = [], treePos = [], hidrant = [];

    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x0 = w(i * CELL), z0 = w(j * CELL);
        // Kerb-side furniture sits inside the painted pavement band, not in the carriageway.
        for (let t = 8; t < BLOCK - 6; t += 17) {
          lampPos.push([x0 + 2.4, z0 + t], [x0 + t, z0 + 2.4]);
        }
        const info = this.blockKinds[i][j];
        if (info.kind === 'park') {
          for (let k = 0; k < 26; k++) {
            treePos.push([rrange(rng, x0 + 7, x0 + BLOCK - 7), rrange(rng, z0 + 7, z0 + BLOCK - 7)]);
          }
          for (let k = 0; k < 7; k++) {
            hidrant.push([rrange(rng, x0 + 6, x0 + BLOCK - 6), rrange(rng, z0 + 6, z0 + BLOCK - 6)]);
          }
        } else if (chance(rng, 0.55)) {
          treePos.push([x0 + 3.4, z0 + rrange(rng, 6, BLOCK - 6)]);
        }
      }
    }

    const instanced = (geo, mat, list, yFn) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      const o = new THREE.Object3D();
      list.forEach((p, i) => {
        o.position.set(p[0], yFn ? yFn(p) : 0, p[1]);
        o.rotation.set(0, rng() * Math.PI * 2, 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      this.group.add(m);
      return m;
    };

    instanced(new THREE.CylinderGeometry(0.13, 0.17, 6.4, 5), new THREE.MeshLambertMaterial({ color: 0x30343b }), lampPos, () => 3.2);
    instanced(new THREE.BoxGeometry(1.5, 0.28, 0.5), new THREE.MeshBasicMaterial({ color: 0xffd98a }), lampPos.map(p => [p[0] - 0.7, p[1] - 0.7]), () => 6.3);
    instanced(new THREE.CylinderGeometry(0.22, 0.3, 3.4, 5), new THREE.MeshLambertMaterial({ color: 0x4b3a24 }), treePos, () => 1.7);
    instanced(new THREE.SphereGeometry(2.1, 7, 6), new THREE.MeshLambertMaterial({ color: 0x2f6b3a }), treePos, () => 4.6);
    instanced(new THREE.CylinderGeometry(0.24, 0.28, 0.9, 6), new THREE.MeshLambertMaterial({ color: 0xc23b3b }), hidrant, () => 0.45);

    // Concrete barriers sealing the map edge keep the player inside the city.
    const barMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
    const bar = new THREE.BoxGeometry(6, 1.3, 1.1);
    for (let side = 0; side < 4; side++) {
      for (let t = -HALF; t < HALF; t += 6) {
        const m = new THREE.Mesh(bar, barMat);
        const o = HALF + 1;
        if (side === 0) m.position.set(t, 0.65, -o);
        if (side === 1) m.position.set(t, 0.65, o);
        if (side === 2) { m.position.set(-o, 0.65, t); m.rotation.y = Math.PI / 2; }
        if (side === 3) { m.position.set(o, 0.65, t); m.rotation.y = Math.PI / 2; }
        this.group.add(m);
      }
    }
    this._solid(-HALF - 3, -HALF - 3, HALF + 3, -HALF + 1.5, 1.3, 'wall');
    this._solid(-HALF - 3, HALF - 1.5, HALF + 3, HALF + 3, 1.3, 'wall');
    this._solid(-HALF - 3, -HALF - 3, -HALF + 1.5, HALF + 3, 1.3, 'wall');
    this._solid(HALF - 1.5, -HALF - 3, HALF + 3, HALF + 3, 1.3, 'wall');
  }

  // ---------------------------------------------------------------- queries
  isBlocked(x, z, r = 0) { return blocksPoint(this.hash, x, z, r); }

  /** Tallest solid covering a point — lets the camera escape above roofs instead of inside them. */
  roofAt(x, z, r = 0) {
    let h = 0;
    for (const q of this.hash.query(x, z, r + 0.2)) {
      if (x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r) h = Math.max(h, q.h);
    }
    return h;
  }

  collide(x, z, r) { return resolveCircle(this.hash, x, z, r); }

  /** How far a bullet at height `y` travels before it meets a wall. */
  rayHit(x, z, dx, dz, maxD, y = 1.35) {
    const step = 2;
    for (let d = step; d <= maxD; d += step) {
      const px = x + dx * d, pz = z + dz * d;
      for (const q of this.hash.query(px, pz, 0.4)) {
        if (px > q.x0 && px < q.x1 && pz > q.z0 && pz < q.z1 && q.h > y) return d - step * 0.5;
      }
    }
    return maxD;
  }

  onRoad(x, z, slack = 1.4) {
    const half = ROAD / 2 + slack;
    for (let i = 0; i < GRID; i++) {
      if (Math.abs(z - roadAt(i)) < half || Math.abs(x - roadAt(i)) < half) return true;
    }
    return false;
  }

  /** Random point on the pavement ring inside a block, clear of solids. */
  randomWalkablePoint(rng = Math.random) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const i = Math.floor(rng() * GRID), j = Math.floor(rng() * GRID);
      const x0 = w(i * CELL), z0 = w(j * CELL);
      const x1 = x0 + BLOCK, z1 = z0 + BLOCK;
      const along = x0 + 4 + rng() * (BLOCK - 8);
      const inset = 1.3 + rng() * 2.5;
      const side = Math.floor(rng() * 4);
      let x, z;
      if (side === 0) { x = along; z = z0 + inset; }
      else if (side === 1) { x = along; z = z1 - inset; }
      else if (side === 2) { x = x0 + inset; z = z0 + 4 + rng() * (BLOCK - 8); }
      else { x = x1 - inset; z = z0 + 4 + rng() * (BLOCK - 8); }
      if (!this.isBlocked(x, z, 0.8)) return { x, z };
    }
    return { x: 0, z: roadAt(4) };
  }

  /** Point on a lane, used to spawn traffic and police. */
  randomLanePoint(rng = Math.random, minDist = 0, from = null) {
    for (let a = 0; a < 30; a++) {
      const axis = rng() < 0.5 ? 'x' : 'z';
      const idx = Math.floor(rng() * GRID);
      const dir = rng() < 0.5 ? 1 : -1;
      const along = rrange(rng, -HALF + 10, HALF - 10);
      const p = axis === 'x'
        ? { x: along, z: laneZ(idx, dir), axis, idx, dir }
        : { x: laneX(idx, dir), z: along, axis, idx, dir };
      if (from && Math.hypot(p.x - from.x, p.z - from.z) < minDist) continue;
      if (!this.isBlocked(p.x, p.z, 1.2)) return p;
    }
    return { x: roadAt(0), z: roadAt(0), axis: 'x', idx: 0, dir: 1 };
  }

  /** Kerbside spot: same grid maths as a lane, but tucked against the pavement. */
  randomCurbPoint(rng = Math.random) {
    for (let a = 0; a < 30; a++) {
      const axis = rng() < 0.5 ? 'x' : 'z';
      const idx = Math.floor(rng() * GRID);
      const dir = rng() < 0.5 ? 1 : -1;
      const along = rrange(rng, -HALF + 12, HALF - 12);
      const off = dir > 0 ? PARK : -PARK;
      const p = axis === 'x'
        ? { x: along, z: roadAt(idx) + off, axis, idx, dir }
        : { x: roadAt(idx) - off, z: along, axis, idx, dir };
      if (!this.isBlocked(p.x, p.z, 1.2)) return p;
    }
    return { x: roadAt(0), z: roadAt(0), axis: 'x', idx: 0, dir: 1 };
  }

  nearestLanePoint(x, z) {
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < GRID; i++) {
      const d = Math.abs(x - roadAt(i));
      if (d < bd) { bd = d; bi = i; }
    }
    for (let j = 0; j < GRID; j++) {
      const d = Math.abs(z - roadAt(j));
      if (d < bd) { bd = d; bj = j; }
    }
    const dx = Math.abs(x - roadAt(bi)), dz = Math.abs(z - roadAt(bj));
    // The nearer carriageway decides which axis we are parked alongside.
    return dx < dz
      ? { axis: 'z', idx: bi, other: bj, x: roadAt(bi), z: clamp(z, -HALF, HALF) }
      : { axis: 'x', idx: bj, other: bi, x: clamp(x, -HALF, HALF), z: roadAt(bj) };
  }

  clampInside(x, z, margin = 1) {
    const lim = HALF + 2 - margin;
    return { x: clamp(x, -lim, lim), z: clamp(z, -lim, lim) };
  }

  /** Node intersections of the road graph. */
  node(i, j) { return { x: roadAt(i), z: roadAt(j), i, j }; }
}
