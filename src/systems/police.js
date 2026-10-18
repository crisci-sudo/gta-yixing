import { Vehicle } from '../entities/vehicle.js';
import { clamp, damp, wrapAngle, rrange, chance } from '../core/math.js';

/** Ramming pursuit AI: straight-lines the target, slides around anything that blocks it. */
export class PoliceUnit {
  constructor(city, x, z, yaw) {
    this.city = city;
    this.v = new Vehicle('police', 0xf2f4f7, x, z, yaw);
    this.v.occupied = 'police';
    this.spawnedAt = 0;
    this.blip = 0;
    this.juke = chance(Math.random, 0.35) ? rrange(Math.random, -1, 1) : 0;
    this.speed = 0;
    this.flash = 0;
    this.bumps = 0;
  }

  get x() { return this.v.x; }
  get z() { return this.v.z; }

  _clearOfBuildings(yaw, reach) {
    const f = { x: Math.sin(yaw), z: Math.cos(yaw) };
    for (let d = 3; d < reach; d += 3) {
      if (this.city.isBlocked(this.v.x + f.x * d, this.v.z + f.z * d, 1.1)) return false;
    }
    return true;
  }

  update(dt, player, stars, time) {
    const v = this.v;
    this.flash += dt;
    const aggressive = 0.55 + stars * 0.12;
    const maxSpeed = clamp(24 + stars * 4.5, 24, 47);

    const dx = player.x - v.x, dz = player.z - v.z;
    const dist = Math.hypot(dx, dz);
    let want = Math.atan2(dx, dz);
    if (this.juke) want += this.juke * clamp(dist / 60, 0, 0.5);

    // Try the direct line first, then fan out to either side for a clean approach.
    let yaw = want;
    if (!this._clearOfBuildings(v.yaw, Math.min(18, dist))) {
      for (const off of [0.55, -0.55, 1.1, -1.1, 1.7, -1.7]) {
        if (this._clearOfBuildings(wrapAngle(v.yaw + off), 12)) { yaw = wrapAngle(v.yaw + off); break; }
      }
    }

    const err = wrapAngle(yaw - v.yaw);
    v.yaw = wrapAngle(v.yaw + clamp(err, -1, 1) * dt * (1.6 + aggressive));

    const target = dist < 7 ? 0 : Math.min(maxSpeed, 10 + dist * 1.1) * (dist > 200 ? 1.25 : 1);
    this.speed = damp(this.speed, target, target > this.speed ? 2.6 : 5, dt);
    const f = v.forward;
    v.vx = f.x * this.speed;
    v.vz = f.z * this.speed;
    v.x += v.vx * dt;
    v.z += v.vz * dt;
    const res = this.city.collide(v.x, v.z, v.radius);
    if (res.hit) {
      v.x = res.x; v.z = res.z;
      this.speed *= 0.55;
      this.bumps += 1;
    }
    const lim = this.city.clampInside(v.x, v.z, 3);
    v.x = lim.x; v.z = lim.z;

    v.sync(this.speed, clamp(err, -0.5, 0.5));
    if (v.lights.bar) {
      const on = Math.sin(time * 9) > 0;
      v.lights.red.material.emissiveIntensity = on ? 2 : 0.15;
      v.lights.blue.material.emissiveIntensity = on ? 0.15 : 2;
    }
    return dist;
  }
}

/** Long-range LOS test against the solid city: sampled, cheap and good enough for police. */
export function hasLineOfSight(city, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const steps = Math.min(30, Math.ceil(len / 5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (city.isBlocked(ax + dx * t, az + dz * t, 0.4)) return false;
  }
  return true;
}
