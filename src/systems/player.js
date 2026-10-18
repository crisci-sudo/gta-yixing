import { Walker } from '../entities/ped.js';
import { damp, wrapAngle, dist2 } from '../core/math.js';

const WALK = 4.3, RUN = 8.4;

/** The player: a kinematic walker that can hijack any vehicle within reach. */
export class Player {
  constructor(city, scene, seed = 7) {
    this.city = city;
    this.ped = new Walker(seed, 0, 0);
    scene.add(this.ped.mesh);
    this.scene = scene;
    this.onFoot = true;
    this.vehicle = null;
    this.health = 100;
    this.x = 0; this.z = 0; this.yaw = 0;
    this.vx = 0; this.vz = 0;
    this.invince = 0;
    this.dead = false;
  }

  get speed() { return this.vehicle ? this.vehicle.speed : Math.hypot(this.vx, this.vz); }
  get kmh() { return this.speed * 3.6; }

  spawn(x, z) {
    this.x = x; this.z = z;
    this.vx = this.vz = 0;
    this.health = 100;
    this.dead = false;
    this.invince = 2.2;
    if (this.vehicle) { this.vehicle.occupied = null; this.vehicle = null; }
    this.onFoot = true;
    this.ped.mesh.visible = true;
    this.ped.up = 1;
    this.ped.mesh.rotation.x = 0;
    this.ped.sync();
  }

  damage(amount) {
    if (this.invince > 0 || this.dead || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.dead = true;
    return true;
  }

  footUpdate(dt, axis, camYaw, sprint, obstacles) {
    const len = Math.hypot(axis.x, axis.z);
    if (len > 0.01) {
      const nx = axis.x / len, nz = axis.z / len;
      const cy = Math.sin(camYaw), cz = Math.cos(camYaw);
      // Camera basis: right of the view is (-cos yaw, sin yaw).
      const dx = cy * nz + -cz * nx;
      const dz = cz * nz + cy * nx;
      const speed = sprint ? RUN : WALK;
      this.vx = damp(this.vx, dx * speed, 12, dt);
      this.vz = damp(this.vz, dz * speed, 12, dt);
      this.yaw = damp(this.yaw, wrapAngle(this.yaw + wrapAngle(Math.atan2(dx, dz) - this.yaw)), 13, dt);
    } else {
      this.vx = damp(this.vx, 0, 14, dt);
      this.vz = damp(this.vz, 0, 14, dt);
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    for (const o of obstacles) {
      const d = Math.hypot(this.x - o.x, this.z - o.z);
      const min = o.r + 0.42;
      if (d > 0.001 && d < min) {
        this.x += ((this.x - o.x) / d) * (min - d);
        this.z += ((this.z - o.z) / d) * (min - d);
      }
    }
    const res = this.city.collide(this.x, this.z, 0.45);
    this.x = res.x; this.z = res.z;
    const lim = this.city.clampInside(this.x, this.z, 1.6);
    this.x = lim.x; this.z = lim.z;

    const ground = Math.hypot(this.vx, this.vz);
    this.ped.animate(dt, ground, 'walk');
    this.ped.x = this.x; this.ped.z = this.z; this.ped.yaw = this.yaw;
    this.ped.sync();
    if (this.invince > 0) this.invince -= dt;
    return ground;
  }

  nearestVehicle(vehicles, reach = 4.6) {
    let best = null, bd = Infinity;
    for (const v of vehicles) {
      if (v === this.vehicle || v.dead) continue;
      const d = dist2(this.x, this.z, v.x, v.z) - Math.pow(v.boundingRadius() * 0.55, 2);
      if (d < bd) { bd = d; best = v; }
    }
    return bd < reach * reach ? best : null;
  }

  enter(v) {
    this.vehicle = v;
    this.onFoot = false;
    v.occupied = 'player';
    this.ped.mesh.visible = false;
    this.yaw = v.yaw;
  }

  exit() {
    const v = this.vehicle;
    if (!v) return;
    const p = v.doorPoint();
    v.occupied = null;
    this.vehicle = null;
    this.onFoot = true;
    this.x = p.x; this.z = p.z;
    this.vx = v.vx * 0.35; this.vz = v.vz * 0.35;
    this.yaw = Math.atan2(-Math.cos(v.yaw), Math.sin(v.yaw));
    const res = this.city.collide(this.x, this.z, 0.5);
    this.x = res.x; this.z = res.z;
    this.ped.mesh.visible = true;
    this.ped.x = this.x; this.ped.z = this.z; this.ped.yaw = this.yaw;
    this.ped.up = 1;
    this.ped.mesh.rotation.x = 0;
    this.ped.sync();
  }

  /** Keep the avatar glued to the driver seat frame for camera/physics reads. */
  followVehicle() {
    const v = this.vehicle;
    if (!v) return;
    this.x = v.x; this.z = v.z; this.yaw = v.yaw;
    this.vx = v.vx; this.vz = v.vz;
  }
}
