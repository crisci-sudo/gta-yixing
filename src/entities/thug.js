import { Walker } from './ped.js';
import { makeWeaponMesh } from './weapons.js';
import { clamp, damp, wrapAngle, rrange, pick, dist2 } from '../core/math.js';

const JACKETS = [0x1d232b, 0x2a1f28, 0x14282b, 0x33221a, 0x232838];
const TROUSERS = [0x191c22, 0x2c2a26, 0x20252e];

const MELEE_SPEED = 4.5;
const SHOOT_MIN = 7, SHOOT_MAX = 21;

/** Hostile gang member: loiters on its corner, then throws punches or empties a clip. */
export class Thug extends Walker {
  constructor(seed, city, rng = Math.random) {
    const p = city.randomWalkablePoint();
    super(seed, p.x, p.z, {
      shirt: pick(rng, JACKETS),
      pants: pick(rng, TROUSERS),
      cap: pick(rng, [0x101418, 0x3a1c1c, 0x1c2a3a]),
    });
    this.city = city;
    this.rng = rng;
    this.home = { x: p.x, z: p.z };
    this.goal = { x: p.x, z: p.z };
    this.armed = rng() < 0.42;
    this.health = this.maxHealth = this.armed ? 55 : 70;
    this.alive = true;
    this.aggro = false;
    this.loseTimer = 0;
    this.cool = rrange(rng, 0.3, 1.2);
    this.windup = 0;
    this.swing = 0;
    this.downTimer = 0;
    this.timer = 0;

    if (this.armed) {
      const w = makeWeaponMesh('pistol');
      w.position.set(0, -0.5, 0.02);
      this.hand.add(w);
      this.gun = w;
    }
    this.mesh.rotation.x = 0;
  }

  get radius() { return 0.5; }

  /** @returns true when this blow killed him. */
  hit(dmg, fromYaw) {
    if (!this.alive) return false;
    this.health -= dmg;
    this.aggro = true;
    this.loseTimer = 0;
    if (fromYaw !== undefined) this.yaw = wrapAngle(this.yaw + clamp(fromYaw - this.yaw, -0.5, 0.5) * 0.2);
    if (this.health <= 0) {
      this.alive = false;
      this.downTimer = 8;
      this.yaw += rrange(this.rng, -0.9, 0.9);
      return true;
    }
    return false;
  }

  _respawn() {
    // Never pop back up next to the player — pick a fresh corner across town.
    for (let a = 0; a < 24; a++) {
      const p = this.city.randomWalkablePoint();
      if (dist2(p.x, p.z, this._px ?? p.x, this._pz ?? p.z) < 10000) continue;
      this.x = p.x; this.z = p.z;
      this.home = { x: p.x, z: p.z };
      this.goal = { x: p.x, z: p.z };
      this.health = this.maxHealth;
      this.alive = true;
      this.aggro = false;
      this.up = 1;
      this.mesh.rotation.x = 0;
      this.mesh.position.y = 0;
      this.sync();
      return;
    }
  }

  update(dt, player, hooks) {
    if (!this.alive) {
      this.collapse(dt);
      this.downTimer -= dt;
      if (this.downTimer <= 0) this._respawn();
      return;
    }
    this._px = player.x; this._pz = player.z;

    const dx = player.x - this.x, dz = player.z - this.z;
    const d = Math.hypot(dx, dz) || 0.001;
    const toward = Math.atan2(dx, dz);

    if (this.aggro) {
      if (d > 62) { this.loseTimer += dt; if (this.loseTimer > 4) this._dropAggro(); }
      else this.loseTimer = 0;
    } else if (d < 26 && player.weaponFirearm && hooks.hostileToPlayer) {
      this.aggro = true;
    }

    this.cool -= dt;
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 3.4);
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) hooks.thugHits(this, player, this.armed ? 9 : 12);
    }

    let ground = 0;
    if (this.aggro && !player.dead) {
      const canSee = hooks.lineOfSight(this.x, this.z, player.x, player.z);
      if (this.armed && canSee && d < SHOOT_MAX && d > SHOOT_MIN * 0.55) {
        // Hold a firing distance instead of dog-piling into melee.
        const want = d < SHOOT_MIN ? -1 : d > SHOOT_MAX * 0.85 ? 1 : 0;
        ground = this._move(dt, want * 2.6, toward);
        if (this.cool <= 0 && d < SHOOT_MAX) {
          this.cool = rrange(this.rng, 0.85, 1.5);
          this.swing = 1;
          hooks.thugShoots(this, player);
        }
      } else if (d > 2.2) {
        ground = this._move(dt, MELEE_SPEED, toward);
      } else if (this.cool <= 0) {
        this.cool = 1.05;
        this.windup = 0.26;
        this.swing = 1;
      }
      this.yaw = damp(this.yaw, wrapAngle(toward), 9, dt);
    } else {
      // Loiter: drift back toward the corner he was posted on.
      const hx = this.home.x - this.x, hz = this.home.z - this.z;
      const hd = Math.hypot(hx, hz);
      this.timer -= dt;
      if (hd > 5.5 || this.timer > 3.5) {
        if (this.timer <= 0 || hd > 9) {
          this.goal = { x: this.home.x + rrange(this.rng, -4, 4), z: this.home.z + rrange(this.rng, -4, 4) };
          this.timer = rrange(this.rng, 1.5, 5);
        }
        const gx = this.goal.x - this.x, gz = this.goal.z - this.z;
        this.yaw = damp(this.yaw, wrapAngle(Math.atan2(gx, gz)), 5, dt);
        ground = this._move(dt, 1.15, Math.atan2(gx, gz));
      } else {
        this.yaw = damp(this.yaw, wrapAngle(this.yaw + Math.sin(this.phase * 0.3) * 0.5), 2, dt);
        ground = this._move(dt, 0, this.yaw);
      }
    }

    this.animate(dt, ground, 'walk');
    // Weapon pose overrides the idle arm swing.
    const aim = this.armed && this.aggro ? -1.35 : 0;
    this.limbs.armR.rotation.x = damp(this.limbs.armR.rotation.x, aim - this.swing * 1.1, 14, dt);
    this.sync();
  }

  _dropAggro() {
    this.aggro = false;
    this.home = { x: this.x, z: this.z };
  }

  /** Step along `heading`, sliding off anything solid. Returns ground speed. */
  _move(dt, sp, heading) {
    if (Math.abs(sp) < 0.05) return 0;
    const nx = this.x + Math.sin(heading) * sp * dt;
    const nz = this.z + Math.cos(heading) * sp * dt;
    const res = this.city.collide(nx, nz, this.radius);
    this.x = res.x; this.z = res.z;
    const lim = this.city.clampInside(this.x, this.z, 1.2);
    this.x = lim.x; this.z = lim.z;
    if (res.hit) {
      this.yaw = wrapAngle(Math.atan2(-res.nz, res.nx));
      return sp * 0.4;
    }
    return sp;
  }
}
