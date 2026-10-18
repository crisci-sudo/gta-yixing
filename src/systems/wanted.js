import { PoliceUnit, hasLineOfSight } from './police.js';
import { clamp, dist2, chance } from '../core/math.js';

const STAR_HEAT = [0.001, 1, 2, 3, 4, 5];

/** Crime → heat → stars → pursuit → arrest. The city's memory of what you did. */
export class WantedSystem {
  constructor(city, scene, hooks = {}) {
    this.city = city;
    this.scene = scene;
    this.hooks = hooks;
    this.cops = [];
    this.heat = 0;
    this.stars = 0;
    this.lastSeen = 0;
    this.bust = 0;
    this.maxCops = 9;
    this.alive = true;
  }

  addCrime(amount, label) {
    if (!this.alive || amount <= 0) return;
    const before = this.stars;
    this.heat = clamp(this.heat + amount, 0, 5.2);
    this.lastSeen = 0;
    if (this.stars !== before) this.hooks.onStars?.(this.stars, before, label);
    else if (label) this.hooks.onCrime?.(label);
  }

  clear(reason) {
    this.heat = 0;
    this.stars = 0;
    this.bust = 0;
    for (const c of this.cops) this.scene.remove(c.v.mesh);
    this.cops.length = 0;
    if (reason) this.hooks.onCleared?.(reason);
  }

  _syncStars() {
    let s = 0;
    for (let i = 1; i < STAR_HEAT.length; i++) if (this.heat >= STAR_HEAT[i]) s = i;
    this.stars = clamp(s, 0, 5);
  }

  _spawnEdge(player) {
    // Drop them in on a lane 90-190m out, never inside the line of sight they'd be noticed from.
    for (let a = 0; a < 14; a++) {
      const p = this.city.randomLanePoint(Math.random);
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < 85 || d > 210) continue;
      const yaw = Math.atan2(player.x - p.x, player.z - p.z);
      const cop = new PoliceUnit(this.city, p.x, p.z, yaw);
      this.scene.add(cop.v.mesh);
      this.cops.push(cop);
      return cop;
    }
    return null;
  }

  _retire(cop) {
    this.scene.remove(cop.v.mesh);
    const i = this.cops.indexOf(cop);
    if (i >= 0) this.cops.splice(i, 1);
  }

  update(dt, player, time) {
    this._syncStars();
    const want = Math.min(this.stars + (this.stars >= 4 ? 2 : 0), this.maxCops);

    if (this.stars > 0 && this.cops.length < want && chance(Math.random, dt * 0.9)) this._spawnEdge(player);

    let seen = false;
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const cop = this.cops[i];
      const d = Math.hypot(cop.x - player.x, cop.z - player.z);
      cop.update(dt, { x: player.x + player.vx * 0.6, z: player.z + player.vz * 0.6 }, this.stars, time);

      if (d < 130 && hasLineOfSight(this.city, cop.x, cop.z, player.x, player.z)) seen = true;
      if (d > 340 || (this.stars === 0 && d > 120)) this._retire(cop);
    }

    if (seen) this.lastSeen = 0;
    else this.lastSeen += dt;

    if (this.stars > 0 && this.lastSeen > 11) {
      const before = this.stars;
      this.heat = clamp(this.heat - dt * (0.055 + this.stars * 0.012), 0, 5.2);
      this._syncStars();
      if (this.stars !== before) this.hooks.onStars?.(this.stars, before, 'down');
      if (this.stars === 0) this.hooks.onCleared?.('摆脱了追缉');
    }

    // Arrest pressure: a cruiser hung off your bumper at walking pace.
    let pressure = 0;
    for (const cop of this.cops) {
      const d = Math.hypot(cop.x - player.x, cop.z - player.z);
      const reach = player.onFoot ? 3.4 : 6.4;
      if (d < reach) pressure = Math.max(pressure, 1 - d / reach);
    }
    if (this.stars > 0 && pressure > 0.1 && player.speed < 5.5) {
      this.bust = clamp(this.bust + dt * (0.45 + pressure * 0.85), 0, 1);
      if (this.bust >= 1) {
        this.bust = 0;
        this.hooks.onBust?.();
      }
    } else {
      this.bust = clamp(this.bust - dt * 0.5, 0, 1);
    }

    // Cops that box you in shave armour off the car.
    if (!player.onFoot && player.vehicle && this.stars > 0) {
      for (const cop of this.cops) {
        if (dist2(cop.x, cop.z, player.x, player.z) < 42 && player.speed > 12) {
          player.vehicle.damage(dt * 1.6);
        }
      }
    }

    return { cops: this.cops.length, bust: this.bust, seen };
  }

  nearestCop(player) {
    let best = null, bd = Infinity;
    for (const c of this.cops) {
      const d = dist2(c.x, c.z, player.x, player.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { unit: best, dist: Math.sqrt(bd) } : null;
  }
}
