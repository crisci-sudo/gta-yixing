import { makeCar, makePoliceCar } from './models.js';
import { clamp, damp, wrapAngle } from '../core/math.js';

export const PAINT = [0xc8443c, 0x2f66c4, 0x38a06a, 0xd9a52e, 0x804fb0, 0xe4e6ea, 0x2c313b, 0xd06a2c, 0x6f7d8c, 0x9c3f5f];

let nextId = 1;

/** Arcade ground vehicle: forward-thrust + lateral grip, handbrake breaks traction. */
export class Vehicle {
  constructor(kind, color, x, z, yaw = 0) {
    const built = kind === 'police' ? makePoliceCar() : makeCar(kind, color);
    this.id = nextId++;
    this.kind = kind;
    this.spec = built.spec;
    this.name = this.spec.name;
    this.mesh = built.group;
    this.wheels = built.wheels;
    this.frontPivots = built.frontPivots;
    this.lights = built.lights;
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = yaw;

    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = 0; this.vz = 0;
    this.steer = 0;
    this.yawRate = 0;
    this.health = 100;
    this.dead = false;
    this.drifting = 0;
    this.occupied = null;      // 'player' | 'ai' | null
    this.isPolice = kind === 'police';
    this.ai = null;
    this.radius = this.spec.W * 0.66;
    this.engineOn = true;
    this.lastImpact = 0;
    this.smoke = null;
  }

  get forward() { return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }
  // right = forward x up in this left-handed-looking world; keeps D = screen-right.
  get right() { return { x: -Math.cos(this.yaw), z: Math.sin(this.yaw) }; }
  get longVel() { return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw); }
  get latVel() { return this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw); }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get kmh() { return this.speed * 3.6; }

  place(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = this.vz = 0; this.yawRate = 0; this.steer = 0;
    this.sync();
  }

  setEngine(alive) {
    this.dead = !alive;
    if (this.smoke) this.smoke.visible = !alive;
  }

  damage(amount) {
    if (amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.setEngine(false);
  }

  /** @param dt seconds, @param cmd {throttle, steer, hand, brake, active} */
  update(dt, cmd, city) {
    const s = this.spec;
    const active = cmd.active && !this.dead;
    const fwd = this.longVel;

    // --- steering: reduced lock as speed climbs so the car stays plantable.
    const wantSteer = active ? cmd.steer * s.steerMax * (1 - clamp(Math.abs(fwd) / s.top, 0, 1) * 0.62) : 0;
    this.steer = damp(this.steer, wantSteer, active ? 11 : 6, dt);

    // --- longitudinal
    let accel = 0;
    const throttle = active ? cmd.throttle : 0;
    if (throttle > 0.02) {
      accel = s.power * throttle * (1 - clamp(Math.max(0, fwd) / s.top, 0, 1));
    } else if (throttle < -0.02) {
      if (fwd > 1.2) accel = -s.brake * -throttle;                     // braking
      else accel = s.power * 0.55 * throttle * (1 - clamp(-fwd / (s.top * 0.34), 0, 1)); // reverse
    }
    if (cmd.brake && active) accel = -Math.sign(fwd) * s.brake * 1.15;
    if (cmd.hand && active) accel -= Math.sign(fwd) * 5.5;

    if (!active && Math.abs(fwd) > 0.05) accel = -Math.sign(fwd) * 2.6;  // engine braking / coasting

    const f = this.forward;
    this.vx += f.x * accel * dt;
    this.vz += f.z * accel * dt;

    // --- yaw from bicycle model. Positive steer turns toward the car's right,
    // which is decreasing yaw under the (sin y, cos y) forward convention.
    const targetRate = -(fwd / s.wheelbase) * Math.tan(this.steer) * (cmd.hand ? 1.25 : 1);
    this.yawRate = damp(this.yawRate, clamp(targetRate, -3.4, 3.4), 9, dt);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    // --- lateral grip: handbrake or overdriven steering sheds it and the car slides.
    const r = this.right;
    let lat = this.vx * r.x + this.vz * r.z;
    const grip = (cmd.hand && Math.abs(fwd) > 3) ? 1.5 : s.grip;
    lat *= Math.exp(-grip * dt);
    const long = this.vx * f.x + this.vz * f.z;
    const nx = f.x * long + r.x * lat, nz = f.z * long + r.z * lat;
    this.vx = nx; this.vz = nz;
    this.drifting = clamp((Math.abs(lat) - 1.6) / 6, 0, 1);

    // --- aero drag
    const drag = 0.32 + this.speed * 0.0065;
    this.vx *= Math.exp(-drag * dt);
    this.vz *= Math.exp(-drag * dt);

    // --- integrate + collide
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    let impact = 0;
    if (city) {
      const res = city.collide(this.x, this.z, this.radius);
      if (res.hit) {
        impact = Math.max(0, -(this.vx * res.nx + this.vz * res.nz));
        this.x = res.x; this.z = res.z;
        const into = this.vx * res.nx + this.vz * res.nz;
        this.vx -= res.nx * into * 1.35;
        this.vz -= res.nz * into * 1.35;
        // Scrape along the wall instead of sticking to it.
        this.yawRate *= 0.45;
      }
      const lim = city.clampInside(this.x, this.z, this.radius + 1);
      this.x = lim.x; this.z = lim.z;
    }
    if (impact > 6) {
      this.damage((impact - 6) * 1.9);
      this.lastImpact = impact;
      this.vx *= 0.55; this.vz *= 0.55;
    }

    // --- visuals
    this.mesh.position.set(this.x, 0, this.z);
    this.sync(fwd, this.steer);
    return { impact };
  }

  sync(fwd = this.longVel, steer = this.steer) {
    this.mesh.rotation.y = this.yaw;
    const spin = (fwd / this.spec.wheel) * (1 / 60);
    for (const w of this.wheels) w.rotation.y += spin;
    for (const p of this.frontPivots) p.rotation.y = -steer;
    const tilt = clamp(this.drifting * 0.05 + this.yawRate * 0.03, -0.09, 0.09);
    this.mesh.rotation.z = tilt;
  }

  /** Passenger anchor: the door side of the car. */
  doorPoint() {
    const r = this.right;
    return { x: this.x + r.x * (this.spec.W / 2 + 1.1), z: this.z + r.z * (this.spec.W / 2 + 1.1) };
  }

  nosePoint(t = this.spec.L / 2 + 0.4) {
    const f = this.forward;
    return { x: this.x + f.x * t, z: this.z + f.z * t };
  }

  boundingRadius() { return Math.max(this.spec.L, this.spec.W) * 0.48; }
}

/** Circle-vs-circle impulse between two vehicles; returns closing speed. Parked cars act as mass. */
export function resolvePair(a, b) {
  const ra = a.boundingRadius() * 0.62, rb = b.boundingRadius() * 0.62;
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const min = ra + rb;
  if (d === 0 || d >= min) return 0;
  const nx = dx / d, nz = dz / d;
  const ia = a.parked ? 0 : 1 / a.spec.mass;
  const ib = b.parked ? 0 : 1 / b.spec.mass;
  const tot = ia + ib;
  if (tot === 0) return 0;

  const overlap = min - d;
  a.x -= nx * overlap * (ia / tot);
  a.z -= nz * overlap * (ia / tot);
  b.x += nx * overlap * (ib / tot);
  b.z += nz * overlap * (ib / tot);

  const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (rel < 0) {
    const e = 0.25;
    const j = -(1 + e) * rel / tot;
    a.vx -= j * ia * nx; a.vz -= j * ia * nz;
    b.vx += j * ib * nx; b.vz += j * ib * nz;
    a.yawRate -= j * ia * 0.012;
    b.yawRate += j * ib * 0.012;
    return -rel;
  }
  return 0;
}

export function makeVehicle(kind, color, x, z, yaw) {
  return new Vehicle(kind, color === undefined ? PAINT[Math.floor(Math.random() * PAINT.length)] : color, x, z, yaw);
}
