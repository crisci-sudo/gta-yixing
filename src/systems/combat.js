import * as THREE from 'three';
import { WEAPONS, WEAPON_ORDER, AMMO_MAX, PICKUP_AMOUNT, makeWeaponMesh, makePickupMesh } from '../entities/weapons.js';
import { Thug } from '../entities/thug.js';
import { hasLineOfSight } from './police.js';
import { clamp, damp, wrapAngle, dist2, rint, rrange, pick } from '../core/math.js';

const MELEE_CONE = 0.55;         // cos of the half-angle a swing can connect through
const LOCK_CONE = 0.9;           // soft aim: targets within ~25 degrees of the barrel
const TRACER_LIFE = 0.07;

/** Thin pooled beams so you can see where the bullets went. */
class Tracers {
  constructor(scene, n = 18) {
    this.geo = new THREE.BoxGeometry(0.05, 0.05, 1);
    this.pool = [];
    this.live = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
        color: 0xffd98a, transparent: true, opacity: 0,
      }));
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
  }

  spawn(ax, ay, az, bx, by, bz, color = 0xffd98a, width = 1) {
    const m = this.pool.find((p) => !this.live.some((l) => l.m === p));
    if (!m) return;
    const len = Math.max(0.4, Math.hypot(bx - ax, by - ay, bz - az));
    m.visible = true;
    m.material.color.setHex(color);
    m.material.opacity = 0.85;
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    m.scale.set(width, width, len);
    m.lookAt(bx, by, bz);
    this.live.push({ m, life: 0 });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      t.life += dt;
      if (t.life >= TRACER_LIFE) {
        t.m.visible = false;
        this.live.splice(i, 1);
      } else {
        t.m.material.opacity = 0.85 * (1 - t.life / TRACER_LIFE);
      }
    }
  }
}

/** Guns, fists, firebombs and rockets — plus the gang that wants you dead. */
export class CombatSystem {
  constructor(city, scene, puffs, hooks = {}) {
    this.city = city;
    this.scene = scene;
    this.puffs = puffs;
    this.hooks = hooks;

    this.owned = { fists: true, pistol: true };
    this.ammo = { pistol: WEAPONS.pistol.start, smg: 0, molotov: 0, launcher: 0, bat: 0 };
    this.current = WEAPONS.fists;
    this.cool = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.aimYaw = 0;
    this.recoil = 0;
    this.trigger = false;

    this.tracers = new Tracers(scene);
    this.projectiles = [];
    this.booms = [];
    this.pickups = [];
    this.thugs = [];
    this._held = null;

    this._spawnPickups();
    this._spawnThugs();
  }

  // ------------------------------------------------------------- inventory
  get firearm() { return this.current.kind === 'gun' || this.current.kind === 'missile'; }

  _attach(id) {
    if (this._held) { this._held.parent?.remove(this._held); this._held = null; }
    if (id === 'fists') return;
    const mesh = makeWeaponMesh(id);
    mesh.position.set(0, -0.52, 0.03);
    this.hands.add(mesh);
    this._held = mesh;
  }

  /** Called by the player once its body model exists. */
  bind(player) {
    this.player = player;
    this.hands = player.ped.hand;
    this._attach(this.current.id);
  }

  select(id) {
    const w = WEAPONS[id];
    if (!w || !this.owned[id] || id === this.current.id) return false;
    this.current = w;
    this.cool = Math.max(this.cool, 0.22);
    this.combo = 0;
    this._attach(id);
    this.hooks.onSelect?.(w);
    return true;
  }

  selectSlot(slot) {
    const id = WEAPON_ORDER.find((k) => WEAPONS[k].slot === slot);
    if (!id) return false;
    if (!this.owned[id]) { this.hooks.onEmptyHand?.(`${WEAPONS[id].name} · 还没有`); return false; }
    return this.select(id);
  }

  cycle(dir = 1) {
    const list = WEAPON_ORDER.filter((k) => this.owned[k]);
    const i = list.indexOf(this.current.id);
    const next = list[(i + dir + list.length) % list.length];
    return this.select(next);
  }

  rounds(id) { return id === 'fists' || id === 'bat' ? Infinity : this.ammo[id] || 0; }

  give(id, amount = PICKUP_AMOUNT[id]) {
    if (!WEAPONS[id]) return 0;
    const fresh = !this.owned[id];
    this.owned[id] = true;
    if (id === 'fists' || id === 'bat') { if (fresh) this.hooks.onSelect?.(WEAPONS[id]); return 0; }
    this.ammo[id] = clamp((this.ammo[id] || 0) + (amount || 1), 0, AMMO_MAX[id] || 999);
    if (fresh && this.current.id === 'fists') this.select(id);
    return this.ammo[id];
  }

  // ------------------------------------------------------------ world dressing
  _spawnPickups() {
    const kit = ['bat', 'smg', 'molotov', 'launcher', 'pistol', 'smg', 'molotov', 'launcher', 'pistol'];
    for (const id of kit) {
      const p = this.city.randomWalkablePoint(Math.random);
      const mesh = makePickupMesh(id);
      mesh.position.set(p.x, 0, p.z);
      this.scene.add(mesh);
      this.pickups.push({ id, x: p.x, z: p.z, mesh, cool: 0, spin: Math.random() * 6 });
    }
  }

  _spawnThugs() {
    const rng = Math.random;
    for (let i = 0; i < 11; i++) {
      const t = new Thug(i + 41, this.city, rng);
      this.scene.add(t.mesh);
      this.thugs.push(t);
    }
  }

  // ------------------------------------------------------------------ shooting
  /** Everything a bullet can hit, as flat {x,z,r,ref,kind} records. */
  _candidates(world, ox, oz, range) {
    const out = [];
    const push = (x, z, r, ref, kind) => {
      if (dist2(ox, oz, x, z) > range * range) return;
      out.push({ x, z, r, ref, kind });
    };
    for (const t of this.thugs) if (t.alive) push(t.x, t.z, 0.55, t, 'thug');
    for (const ped of world.peds) if (ped.alive) push(ped.x, ped.z, 0.5, ped, 'ped');
    for (const c of world.cops) push(c.v.x, c.v.z, c.v.boundingRadius(), { v: c.v, cop: c, hp: 40 }, 'car');
    for (const t of world.traffic) if (!t.v.dead) push(t.v.x, t.v.z, t.v.boundingRadius(), { v: t.v, hp: 40 }, 'car');
    for (const v of world.parked) if (!v.dead) push(v.x, v.z, v.boundingRadius(), { v, hp: 40 }, 'car');
    if (world.playerVehicle) push(world.playerVehicle.x, world.playerVehicle.z, world.playerVehicle.boundingRadius(), { v: world.playerVehicle, hp: 40, mine: true }, 'car');
    return out;
  }

  /** Ray/sphere march in 2D: nearest thing along the barrel, capped by walls. */
  _cast(world, ox, oz, dx, dz, range, skipSelf) {
    const wall = this.city.rayHit(ox, oz, dx, dz, range);
    let best = null, bt = wall;
    for (const c of this._candidates(world, ox, oz, range)) {
      const along = (c.x - ox) * dx + (c.z - oz) * dz;
      if (along < 0.2 || along > bt) continue;
      const px = ox + dx * along - c.x, pz = oz + dz * along - c.z;
      if (Math.hypot(px, pz) > c.r) continue;
      const entry = along - Math.sqrt(Math.max(0, c.r * c.r - px * px - pz * pz));
      if (entry < 0.2 || entry > bt) continue;
      if (skipSelf && c === skipSelf) continue;
      bt = entry; best = c;
    }
    return { target: best, dist: bt, wall: bt >= wall };
  }

  /** Soft aim: steal the closest target the barrel is already pointing at. */
  _lock(world, ox, oz, yaw, range) {
    let best = null, bestErr = LOCK_CONE;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    for (const c of this._candidates(world, ox, oz, range)) {
      const vx = c.x - ox, vz = c.z - oz;
      const d = Math.hypot(vx, vz) || 0.001;
      const dot = (vx / d) * dx + (vz / d) * dz;
      if (dot < bestErr) continue;
      if (!hasLineOfSight(this.city, ox, oz, c.x, c.z)) continue;
      bestErr = dot; best = c;
    }
    return best;
  }

  muzzle() {
    const p = this.player;
    const yaw = this.aimYaw;
    const lift = p.onFoot ? 1.32 : 1.25;
    return {
      x: p.x + Math.sin(yaw) * 0.6, y: lift, z: p.z + Math.cos(yaw) * 0.6,
      dx: Math.sin(yaw), dz: Math.cos(yaw),
    };
  }

  /** One trigger pull / swing. Returns whether anything was consumed. */
  fire(world, aiming) {
    const w = this.current;
    if (this.cool > 0) return false;
    if (w.kind !== 'melee' && this.rounds(w.id) <= 0) {
      this.hooks.onEmptyHand?.(`${w.name} 没弹药了`);
      this.cool = 0.4;
      return false;
    }

    const p = this.player;
    this.aimYaw = aiming ? this.hooks.camYaw() : p.yaw;
    const m = this.muzzle();

    if (w.kind === 'melee') return this._swing(w, m, world);
    if (w.kind === 'gun') {
      this.ammo[w.id]--;
      this.cool = w.rate;
      this._shoot(w, m, world);
      return true;
    }
    if (w.kind === 'throw') {
      this.ammo[w.id]--;
      this.cool = w.rate || 0.8;
      this._throw(w, m, world, false);
      return true;
    }
    this.ammo[w.id]--;
    this.cool = w.rate;
    this._throw(w, m, world, true);
    this.hooks.shake?.(0.7);
    return true;
  }

  _swing(w, m, world) {
    this.cool = w.rate;
    this.combo = this.comboTimer > 0 ? (this.combo + 1) % 3 : 0;
    this.comboTimer = 1.15;
    const mult = w.combo ? w.combo[this.combo] : 1;
    this.hooks.swing?.(w.id, this.combo);

    const lock = this._lock(world, this.player.x, this.player.z, this.aimYaw, w.reach + 2.2);
    const hits = [];
    for (const c of this._candidates(world, this.player.x, this.player.z, w.reach + 1.2)) {
      const vx = c.x - this.player.x, vz = c.z - this.player.z;
      const d = Math.hypot(vx, vz) || 0.001;
      if (d > w.reach + c.r) continue;
      const dot = (vx / d) * Math.sin(this.aimYaw) + (vz / d) * Math.cos(this.aimYaw);
      if (dot < MELEE_CONE) continue;
      hits.push(c);
    }
    if (!hits.length && lock) hits.push(lock);
    for (const c of hits) this._land(c, w.dmg * mult, this.aimYaw, world, true);
    return hits.length > 0;
  }

  _shoot(w, m, world) {
    const lock = this._lock(world, this.player.x, this.player.z, this.aimYaw, w.range);
    let dx = m.dx, dz = m.dz;
    if (lock) {
      const vx = lock.x - m.x, vz = lock.z - m.z, d = Math.hypot(vx, vz) || 1;
      dx = vx / d; dz = vz / d;
    } else {
      dx += rrange(Math.random, -1, 1) * w.spread;
      dz += rrange(Math.random, -1, 1) * w.spread;
      const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    }
    this.recoil = 1;
    this.hooks.shake?.(w.id === 'pistol' ? 0.12 : 0.07);
    const hit = this._cast(world, m.x, m.z, dx, dz, w.range);
    const end = m.x === hit.dist ? m : { x: m.x + dx * hit.dist, y: 1.2, z: m.z + dz * hit.dist };
    this.tracers.spawn(m.x, m.y, m.z, end.x, hit.target ? 1.15 : end.y, end.z, 0xffe6a8, 0.8);
    this.puffs.spawn(m.x, m.y, m.z, { color: 0xffd27a, size: 0.34, vy: 0.4, ttl: 0.09, grow: 1.2 });
    if (hit.target) {
      this._land(hit.target, w.dmg, Math.atan2(dx, dz), world, false);
    } else {
      this.puffs.spawn(end.x, 1.2, end.z, { color: 0xbfc4cc, size: 0.22, vy: 1.1, ttl: 0.35, grow: 1.6 });
    }
    this.hooks.onShot?.(w, hit.target);
  }

  _throw(w, m, world, isRocket) {
    const lock = this._lock(world, this.player.x, this.player.z, this.aimYaw, isRocket ? w.range : w.range * 0.8);
    const speed = isRocket ? 42 : 13;
    const dx = lock ? (lock.x - m.x) : m.dx * 20;
    const dz = lock ? (lock.z - m.z) : m.dz * 20;
    const d = Math.hypot(dx, dz) || 1;
    const lift = isRocket ? 0.12 : clamp(d / 30, 0.25, 0.85);
    const mesh = new THREE.Mesh(
      isRocket ? new THREE.CylinderGeometry(0.11, 0.14, 0.9, 6) : new THREE.SphereGeometry(0.13, 7, 6),
      new THREE.MeshLambertMaterial({ color: isRocket ? 0x2f3a2c : 0x7a4a22 })
    );
    mesh.position.set(m.x, m.y, m.z);
    this.scene.add(mesh);
    this.projectiles.push({
      kind: isRocket ? 'rocket' : 'molotov',
      x: m.x, y: m.y, z: m.z,
      vx: (dx / d) * speed, vy: lift * speed * 0.42, vz: (dz / d) * speed,
      mesh, w, ttl: isRocket ? 5 : 3,
      lock: lock && isRocket ? lock.ref : null,
      spin: isRocket ? 0 : 1,
    });
    this.hooks.onShot?.(w, lock);
  }

  // --------------------------------------------------------------- resolution
  _land(c, dmg, fromYaw, world, melee) {
    if (c.kind === 'ped') {
      if (c.ref.hit(dmg, fromYaw)) this.hooks.onKill?.('ped', c.ref);
      this.hooks.crime?.(melee ? 0.45 : 0.8, melee ? '街头斗殴' : '当街开枪');
    } else if (c.kind === 'thug') {
      const died = c.ref.hit(dmg, fromYaw);
      this.hooks.onHitMarker?.(died);
      if (died) this.hooks.onKill?.('thug', c.ref, dmg);
      else this.hooks.onHitMarker?.(false);
    } else if (c.kind === 'car') {
      const v = c.ref.v;
      if (c.ref.hp === undefined) return;
      c.ref.hp -= dmg;
      v.damage(melee ? dmg * 0.5 : dmg);
      this.hooks.onHitMarker?.(false);
      if (c.ref.hp <= 0 && !v.dead) {
        v.setEngine(false);
        this._queueBoom(v, c.ref.kind === 'cop' ? 3 : 2.2);
        if (c.ref.cop) this.hooks.crime?.(1.2, '击毁警车');
      }
      if (c.ref.mine) this.hooks.onSelfDamage?.(dmg);
    }
  }

  _queueBoom(v, delay = 2) {
    this.booms.push({ v, t: delay });
  }

  explode(x, y, z, radius, dmg, world, source) {
    this.puffs.spawn(x, y + 0.6, z, { color: 0xffb04a, size: 1.4, vy: 3.2, ttl: 0.5, grow: 7.5, opacity: 0.85 });
    this.puffs.spawn(x, y + 0.2, z, { color: 0x3a3a3e, size: 2.2, vy: 2.1, ttl: 1.5, grow: 6, opacity: 0.5 });
    this.hooks.shake?.(clamp(dmg / 90, 0.35, 1.4));
    this.hooks.crime?.(0.9, '引爆爆炸物');

    for (const c of this._candidates(world, x, z, radius + 2)) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > radius + c.r) continue;
      const fall = 1 - clamp((d - c.r) / radius, 0, 1);
      const amount = dmg * (0.35 + fall * 0.65);
      if (c.kind === 'car') {
        c.ref.v.damage(amount * (c.ref.mine ? 0.4 : 1));
        if (c.ref.mine) this.hooks.onSelfDamage?.(amount * 0.5);
        if (c.ref.v.dead && !this.booms.some((b) => b.v === c.ref.v)) this._queueBoom(c.ref.v, 1.6);
      } else if (c.kind === 'thug') {
        if (c.ref.hit(amount, Math.atan2(c.x - x, c.z - z))) this.hooks.onKill?.('thug', c.ref, amount);
      } else if (c.ref.hit(amount)) {
        this.hooks.onKill?.(c.kind, c.ref);
      }
      if (c.ref.hit && c.kind === 'ped') this.hooks.crime?.(0.4, '');
    }

    const p = this.player;
    const pd = Math.hypot(p.x - x, p.z - z);
    if (pd < radius + 1.5 && source !== 'player-immune') {
      const fall = 1 - clamp(pd / (radius + 1.5), 0, 1);
      p.damage(2 + dmg * fall * 0.5);
      this.hooks.onPlayerHurt?.(dmg * fall);
    }
  }

  // ------------------------------------------------------------------- update
  update(dt, world, aiming) {
    const p = this.player;
    this.cool -= dt;
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.recoil = damp(this.recoil, 0, 9, dt);
    this.tracers.update(dt);

    // Held trigger keeps automatic weapons running.
    if (aiming && this.trigger && (this.current.auto || this.current.kind === 'melee')) {
      this.fire(world, true);
    } else if (this.trigger && this.current.kind === 'gun' && !this.current.auto) {
      this.fire(world, true);
      this.trigger = false;
    }

    // Arm pose: raise the weapon while firing or aiming.
    const arm = p.ped.hand;
    const want = this.current.kind === 'melee'
      ? -0.2 - this.swingHold()
      : -1.3 - this.recoil * 0.35;
    arm.rotation.x = damp(arm.rotation.x, want, 13, dt);

    if (!p.onFoot) this.projectiles.length && this._updateProjectiles(dt, world);
    else this._updateProjectiles(dt, world);

    this._updateBooms(dt, world);
    this._updatePickups(dt, world);
    this._updateThugs(dt, world);
  }

  swingHold() { return this.comboTimer > 0.75 ? 0.9 : 0; }

  _updateProjectiles(dt, world) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const q = this.projectiles[i];
      q.ttl -= dt;
      if (q.kind === 'rocket') {
        // Gentle homing so a lock still lands on a moving target.
        const t = q.lock;
        if (t && (t.alive === undefined || t.alive) && dist2(q.x, q.z, t.x, t.z) < 6400) {
          const dx = t.x - q.x, dz = t.z - q.z, d = Math.hypot(dx, dz) || 1;
          q.vx = damp(q.vx, (dx / d) * 42, q.w.homing, dt);
          q.vz = damp(q.vz, (dz / d) * 42, q.w.homing, dt);
        }
        q.vy = damp(q.vy, 0, 2, dt);
      } else {
        q.vy -= 22 * dt;
      }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.mesh.position.set(q.x, q.y, q.z);
      q.mesh.rotation.z += dt * (q.spin ? 9 : 0);
      if (q.kind === 'rocket') {
        q.mesh.rotation.y = Math.atan2(q.vx, q.vz);
        this.puffs.spawn(q.x, q.y, q.z, { color: 0xd8d8dc, size: 0.3, vy: 0.6, ttl: 0.4, grow: 1.8 });
      }

      const hit = this._cast(world, q.x - q.vx * dt, q.z - q.vz * dt,
        Math.sin(Math.atan2(q.vx, q.vz)), Math.cos(Math.atan2(q.vx, q.vz)), 2.2, null);
      const stuck = this.city.isBlocked(q.x, q.z, 0.25);
      const low = q.y <= 0.16 && q.kind === 'molotov' ? true : q.y <= 0.1 && q.kind === 'rocket';
      if (q.ttl <= 0 || stuck || low || hit.target) {
        this.scene.remove(q.mesh);
        this.projectiles.splice(i, 1);
        this.explode(q.x, Math.max(0.4, q.y), q.z, q.w.blast, q.w.dmg, world, q.kind === 'rocket' ? 'player' : 'player');
      }
    }
  }

  _updateBooms(dt, world) {
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.t -= dt;
      if (Math.random() < dt * 12) {
        this.puffs.spawn(b.v.x + rrange(Math.random, -0.6, 0.6), 1.1, b.v.z + rrange(Math.random, -0.6, 0.6),
          { color: 0x2e2e32, size: 0.7, vy: 2.4, ttl: 1.1, grow: 2.4, opacity: 0.5 });
      }
      if (b.t <= 0) {
        this.booms.splice(i, 1);
        this.explode(b.v.x, 1, b.v.z, 8, 95, world, 'wreck');
        b.v.health = 0;
      }
    }
  }

  _updatePickups(dt, world) {
    const p = this.player;
    for (const k of this.pickups) {
      k.spin += dt * 1.8;
      k.mesh.rotation.y = k.spin;
      k.mesh.children[0].position.y = 0.3 + Math.sin(k.spin * 1.7) * 0.07;
      if (k.cool > 0) {
        k.cool -= dt;
        if (k.cool <= 0) {
          const at = this.city.randomWalkablePoint(Math.random);
          k.x = at.x; k.z = at.z;
          k.mesh.position.set(at.x, 0, at.z);
          k.mesh.visible = true;
        }
        continue;
      }
      if (!p.onFoot || dist2(p.x, p.z, k.x, k.z) > 4.5 * 4.5) continue;
      const before = this.rounds(k.id);
      const after = this.give(k.id);
      const got = k.id === 'bat' ? !before : after > before;
      if (!got) continue;
      this.hooks.onPickup?.(k.id, WEAPONS[k.id], after);
      k.mesh.visible = false;
      k.cool = rint(Math.random, 35, 70);
    }
  }

  _updateThugs(dt, world) {
    const p = this.player;
    for (const t of this.thugs) {
      if (dist2(p.x, p.z, t.x, t.z) > 190 * 190 && !t.aggro) continue;
      t.update(dt, p, this.thugHooks);
    }
    // Aggro the whole crew when one of them gets hit or when a gun goes off nearby.
    void world;
  }

  setThugHooks(h) { this.thugHooks = h; }
}
