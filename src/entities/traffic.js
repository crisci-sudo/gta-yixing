import { Vehicle, PAINT } from './vehicle.js';
import { clamp, damp, wrapAngle, moveTowardsAngle, rint, pick, chance, dist2 } from '../core/math.js';
import { GRID, roadAt, laneX, laneZ } from '../world/city.js';

/** Grid-graph AI driver: holds its lane, turns at intersections, brakes for what it cannot see through. */
export class TrafficCar {
  constructor(city, kind, color) {
    this.city = city;
    const s = city.randomLanePoint(Math.random);
    this.v = new Vehicle(kind || pick(Math.random, ['sedan', 'sedan', 'van', 'coupe', 'taxi']), color ?? pick(Math.random, PAINT), s.x, s.z, 0);
    this.v.occupied = 'ai';
    this.speed = 0;
    this.cruise = 12;
    this.reset();
  }

  reset() {
    const s = this.city.randomLanePoint(Math.random, 40, { x: 0, z: 0 });
    this.v.place(s.x, s.z, 0);
    this.axis = s.axis;
    this.idx = s.idx;
    this.dir = s.dir;
    const other = rint(Math.random, 0, GRID - 1);
    this.a = this.axis === 'x' ? { i: other, j: this.idx } : { i: this.idx, j: other };
    this._advance();
    this.stuck = 0;
    this._back = 0;
  }

  _advance() {
    // Continue straight most of the time, otherwise take a perpendicular street.
    const straight = chance(Math.random, 0.62);
    const { i, j } = this.to || this.a;
    if (!this.to) {
      // First leg: run the current axis to the far side of the map.
      const end = this.axis === 'x' ? (this.dir > 0 ? GRID - 1 : 0) : this.a.j;
      this.to = this.axis === 'x' ? { i: end, j: this.a.j } : { i: this.a.i, j: end };
      return;
    }
    let next;
    if (straight) {
      const step = this.axis === 'x' ? this.dir : 0;
      const step2 = this.axis === 'z' ? this.dir : 0;
      next = { i: clamp(i + step, 0, GRID - 1), j: clamp(j + step2, 0, GRID - 1) };
      if (next.i === i && next.j === j) next = this._turn(i, j);
    } else {
      next = this._turn(i, j);
    }
    this.a = { i, j };
    this.to = next;
    this.axis = next.i !== i ? 'x' : 'z';
    this.dir = Math.sign((this.axis === 'x' ? next.i : next.j) - (this.axis === 'x' ? i : j)) || this.dir;
  }

  _turn(i, j) {
    const opts = [];
    if (this.axis === 'x') {
      if (j > 0) opts.push({ i, j: j - 1 });
      if (j < GRID - 1) opts.push({ i, j: j + 1 });
    } else {
      if (i > 0) opts.push({ i: i - 1, j });
      if (i < GRID - 1) opts.push({ i: i + 1, j });
    }
    return opts.length ? pick(Math.random, opts) : { i: clamp(i + 1, 0, GRID - 1), j };
  }

  /** Point on our lane, look-ahead toward the next node. */
  _steerPoint() {
    const { a, to } = this;
    const ax = roadAt(a.i), az = roadAt(a.j);
    const bx = roadAt(to.i), bz = roadAt(to.j);
    if (this.axis === 'x') {
      const lane = laneZ(to.j, this.dir);
      const ahead = clamp(bx - this.dir * 6, Math.min(ax, bx), Math.max(ax, bx));
      return { x: ahead, z: lane };
    }
    const lane = laneX(to.i, this.dir);
    const ahead = clamp(bz - this.dir * 6, Math.min(az, bz), Math.max(az, bz));
    return { x: lane, z: ahead };
  }

  respawn() {
    this.v.health = 100;
    this.v.setEngine(true);
    this.reset();
  }

  _done() {
    const t = this.to;
    return dist2(this.v.x, this.v.z, roadAt(t.i), roadAt(t.j)) < 90;
  }

  update(dt, others, player) {
    const v = this.v;
    if (this._done()) this._advance();

    // Slow for intersections and squeeze around anything standing still.
    let target = this.v.dead ? 0 : this.cruise;
    const node = dist2(v.x, v.z, roadAt(this.to.i), roadAt(this.to.j));
    if (node < 900) target *= 0.62;

    const f0 = v.forward, r0 = v.right;
    let berth = 0, oncoming = false, hardStop = false;
    const scan = (o, isWalker) => {
      const dx = o.x - v.x, dz = o.z - v.z;
      const ahead = dx * f0.x + dz * f0.z;
      if (ahead < 0) return;
      const lat = dx * r0.x + dz * r0.z;
      const reach = isWalker ? 14 : 16;
      if (ahead > reach || Math.abs(lat) > 3.4) return;
      if (!isWalker && o.speed > 1.2 && o.vx * f0.x + o.vz * f0.z < -0.4) oncoming = true;
      const still = isWalker || o.dead || o.speed < 0.8;
      if (!still) {
        if (Math.abs(lat) < 2.6) target = Math.min(target, Math.max(0, (ahead - 6) * 2.2));
        return;
      }
      if (Math.abs(lat) > 2.0) return;
      if (ahead < 5.5) hardStop = true;
      else if (!berth && !oncoming) berth = lat >= 0 ? -2.3 : 2.3;
      target = Math.min(target, 5.5);
    };
    for (const o of others) if (o !== v) scan(o, false);
    if (player && player.onFoot && !player.dead) scan(player, true);

    const p = this._steerPoint();
    if (berth) { p.x += r0.x * berth; p.z += r0.z * berth; }
    const wantYaw = wrapAngle(Math.atan2(p.x - v.x, p.z - v.z));
    const turn = clamp(Math.abs(this.speed) / 6 + 0.35, 0.35, 1.4);
    v.yaw = moveTowardsAngle(v.yaw, wantYaw, turn * dt);
    if (berth) target = Math.max(target, oncoming || hardStop ? 0 : 2.4);
    if (hardStop) target = 0;
    if (Math.abs(wrapAngle(wantYaw - v.yaw)) > 0.5) target = Math.min(target, 6);

    const f = v.forward;
    if (this._back > 0) { this._back -= dt; target = -2.6; }
    const prev = this.speed;
    this.speed = damp(this.speed, target, target < this.speed ? 4.5 : 2.2, dt);
    v.vx = f.x * this.speed;
    v.vz = f.z * this.speed;
    v.x += v.vx * dt;
    v.z += v.vz * dt;
    const res = this.city.collide(v.x, v.z, v.radius);
    if (res.hit) { v.x = res.x; v.z = res.z; }
    v.drifting = 0;
    v.sync(this.speed, 0);

    // Unwedge: reverse out of a pinch close by, recycle silently when out of sight.
    if (Math.abs(this.speed) < 0.7 && Math.abs(prev) < 0.7) {
      this.stuck += dt;
      if (this.stuck > 6) {
        this.stuck = 0;
        if (player && dist2(v.x, v.z, player.x, player.z) < 8100) this._back = 1.4;
        else this.reset();
      }
    } else this.stuck = 0;
  }
}
