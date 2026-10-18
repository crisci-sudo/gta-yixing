import { makePed } from './models.js';
import { clamp, damp, wrapAngle, rrange, dist2 } from '../core/math.js';

const WALK = 1.3, RUN = 3.6;

export class Walker {
  constructor(seed, x, z, style = null) {
    const m = makePed(seed, style);
    this.mesh = m.group;
    this.limbs = m.limbs;
    this.hand = m.limbs.armR;      // held weapons hang off the right forearm
    this.x = x; this.z = z;
    this.yaw = 0;
    this.phase = (seed % 7) * 0.9;
    this.speed = 0;
    this.up = 1;
  }

  /** Walk cycle: limb swing amplitude scales with ground speed. */
  animate(dt, groundSpeed, pose) {
    this.speed = groundSpeed;
    if (pose === 'down') { this.phase += dt * 2; return; }
    const rate = groundSpeed > 2.4 ? 10 : groundSpeed > 0.2 ? 5.4 : 1.1;
    this.phase += dt * rate;
    const amp = clamp(groundSpeed / 3.2, 0, 1);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    this.limbs.legL.rotation.x = s * 0.72 * amp;
    this.limbs.legR.rotation.x = -s * 0.72 * amp;
    this.limbs.armL.rotation.x = -s * 0.55 * amp;
    this.limbs.armR.rotation.x = s * 0.55 * amp;
    this.mesh.position.y = Math.abs(c) * 0.045 * amp;
  }

  sync() {
    this.mesh.position.x = this.x;
    this.mesh.position.z = this.z;
    this.mesh.rotation.y = this.yaw;
  }

  collapse(dt) {
    this.up = damp(this.up, 0, 9, dt);
    this.mesh.rotation.x = (1 - this.up) * -Math.PI / 2;
    this.mesh.position.y = 0.12 * (1 - this.up);
    this.sync2();
  }

  sync2() {
    this.mesh.position.x = this.x;
    this.mesh.position.z = this.z;
    this.mesh.rotation.y = this.yaw;
  }
}

/** Civilian: wanders pavement rings, panics out of the way of fast metal. */
export class Pedestrian extends Walker {
  constructor(seed, city) {
    const p = city.randomWalkablePoint();
    super(seed, p.x, p.z);
    this.city = city;
    this.seat = seed;
    this.state = 'walk';
    this.timer = rrange(Math.random, 1, 6);
    this.goal = city.randomWalkablePoint();
    this.alive = true;
    this.downTimer = 0;
    this.maxSpeed = WALK;
  }

  _respawn() {
    const p = this.city.randomWalkablePoint();
    this.x = p.x; this.z = p.z;
    this.goal = this.city.randomWalkablePoint();
    this.alive = true;
    this.up = 1;
    this.state = 'walk';
    this.mesh.rotation.x = 0;
    this.mesh.position.y = 0;
    this.sync();
  }

  hit(power) {
    if (!this.alive) return false;
    this.alive = false;
    this.state = 'down';
    this.downTimer = power > 14 ? 7 : 5;
    this.yaw += rrange(Math.random, -0.8, 0.8);
    return true;
  }

  update(dt, threats) {
    if (!this.alive) {
      this.collapse(dt);
      this.downTimer -= dt;
      if (this.downTimer <= 0) this._respawn();
      return;
    }

    // Flee anything heavy and quick bearing down on us.
    let flee = null, bestD = 121;   // 11m, squared
    for (const t of threats) {
      const d = dist2(this.x, this.z, t.x, t.z);
      if (d > bestD) continue;
      const closing = (this.x - t.x) * t.vx + (this.z - t.z) * t.vz;
      if (t.speed < 6 && closing < 0) continue;
      bestD = d;
      flee = t;
    }
    if (flee) {
      this.state = 'flee';
      this.maxSpeed = RUN;
      const dx = this.x - flee.x, dz = this.z - flee.z;
      const l = Math.hypot(dx, dz) || 1;
      this.goal = { x: this.x + (dx / l) * 16, z: this.z + (dz / l) * 16 };
    } else if (this.state === 'flee') {
      this.state = 'walk';
      this.maxSpeed = WALK;
    }

    const dx = this.goal.x - this.x, dz = this.goal.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.4) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.goal = this.city.randomWalkablePoint();
        this.timer = rrange(Math.random, 0.5, 4);
      }
    } else {
      const want = wrapAngle(Math.atan2(dx, dz));
      this.yaw = damp(this.yaw, want, 7, dt);
      const sp = this.state === 'flee' ? this.maxSpeed : this.maxSpeed * (0.8 + ((this.seat % 5) * 0.06));
      let nx = this.x + Math.sin(this.yaw) * sp * dt;
      let nz = this.z + Math.cos(this.yaw) * sp * dt;
      const res = this.city.collide(nx, nz, 0.42);
      if (res.hit) {
        this.x = nx = res.x; this.z = nz = res.z;
        // Slide along the obstacle's tangent rather than grinding into it.
        const side = ((this.seat >> 1) % 2) ? 1 : -1;
        this.yaw = wrapAngle(Math.atan2(-res.nz * side, res.nx * side));
        if (Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < 3) {
          this.goal = this.city.randomWalkablePoint();
        }
      }
      this.x = nx; this.z = nz;
      this.animate(dt, sp, this.state);
      this.sync();
      return;
    }
    this.animate(dt, 0, this.state);
    this.sync();
  }
}
