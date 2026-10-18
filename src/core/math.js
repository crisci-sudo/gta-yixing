export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate independent smoothing: converges at a fixed half-life-ish rate. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export const TAU = Math.PI * 2;

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function angleDelta(a, b) {
  return wrapAngle(b - a);
}

export function moveTowardsAngle(a, b, maxStep) {
  const d = angleDelta(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

/** Deterministic PRNG so every reload builds the same city. */
export function makeRng(seed = 20261018) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rrange = (rng, lo, hi) => lo + rng() * (hi - lo);
export const rint = (rng, lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
export const chance = (rng, p) => rng() < p;

/** Squared planar distance — every call site compares against a squared radius. */
export const dist2 = (ax, az, bx, bz) => {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
};

export const fmtMoney = (n) => '$' + Math.max(0, Math.round(n)).toLocaleString('en-US');
