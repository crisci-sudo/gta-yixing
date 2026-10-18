import { clamp } from '../core/math.js';

/** Grid bucket of AABBs: {x0,z0,x1,z1,h,data} */
export class SpatialHash {
  constructor(cell = 24) {
    this.cell = cell;
    this.buckets = new Map();
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  insert(rect) {
    const c = this.cell;
    const x0 = Math.floor(rect.x0 / c), x1 = Math.floor(rect.x1 / c);
    const z0 = Math.floor(rect.z0 / c), z1 = Math.floor(rect.z1 / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this._key(cx, cz);
        let arr = this.buckets.get(k);
        if (!arr) this.buckets.set(k, (arr = []));
        if (!arr.includes(rect)) arr.push(rect);
      }
    }
  }

  /** Candidate rects whose bucket overlaps the circle's bounding box. */
  query(x, z, r) {
    const c = this.cell;
    const out = [];
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.buckets.get(this._key(cx, cz));
        if (arr) for (const rect of arr) if (!out.includes(rect)) out.push(rect);
      }
    }
    return out;
  }
}

/**
 * Pushes a ground-circle out of solid rects, accumulating penetration.
 * Returns the corrected position plus the dominant contact normal.
 */
export function resolveCircle(hash, x, z, r) {
  const rects = hash.query(x, z, r + 0.5);
  let hit = false, nx = 0, nz = 0, best = 0;

  for (let i = 0; i < 4 && rects.length; i++) {
    let moved = false;
    for (const q of rects) {
      const cx = clamp(x, q.x0, q.x1);
      const cz = clamp(z, q.z0, q.z1);
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;

      hit = true;
      let px, pz, depth;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        depth = r - d;
        px = (dx / d) * depth;
        pz = (dz / d) * depth;
      } else {
        // Center inside the rect: eject along the shallowest axis.
        const left = x - q.x0, right = q.x1 - x, back = z - q.z0, front = q.z1 - z;
        const m = Math.min(left, right, back, front);
        px = m === left ? -(left + r) : m === right ? right + r : 0;
        pz = m === back ? -(back + r) : m === front ? front + r : 0;
        depth = r + m;
      }
      x += px; z += pz;
      moved = true;
      if (depth > best) {
        best = depth;
        const len = Math.hypot(px, pz) || 1;
        nx = px / len; nz = pz / len;
      }
    }
    if (!moved) break;
  }
  return { x, z, hit, nx, nz };
}

export function blocksPoint(hash, x, z, r = 0) {
  for (const q of hash.query(x, z, r + 0.2)) {
    if (x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r) return true;
  }
  return false;
}
