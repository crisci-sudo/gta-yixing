import * as THREE from 'three';
import { clamp, dist2, rrange, rint, pick, fmtMoney } from '../core/math.js';
import { HALF, roadAt, GRID } from '../world/city.js';

const JOB_COLORS = { delivery: 0x4fd8ff, rush: 0xffc53d, getaway: 0xff6ba0 };
const NAMES = {
  delivery: '货运快递',
  rush: '街区竞速',
  getaway: '突围护送',
};

function ring(color) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.TorusGeometry(1.9, 0.14, 6, 26),
    new THREE.MeshBasicMaterial({ color })
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.12;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.75, 1.75, 15, 18, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.y = 7.5;
  g.add(base, beam);
  g.userData = { base, beam };
  return g;
}

/** Static job boards around the city plus the one objective the player is currently chasing. */
export class MissionSystem {
  constructor(city, scene, hooks = {}) {
    this.city = city;
    this.scene = scene;
    this.hooks = hooks;
    this.jobs = [];
    this.active = null;
    this.targetObj = null;
    this.nearJob = null;
    this.completed = 0;
    this._placeJobs();
  }

  _placeJobs() {
    const spots = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j += 2) {
        if ((i + j) % 3 === 0) spots.push({ x: roadAt(i), z: roadAt(j) });
      }
    }
    const types = Object.keys(NAMES);
    for (let k = 0; k < 9; k++) {
      const s = pick(Math.random, spots);
      const x = clamp(s.x + rrange(Math.random, -4, 4), -HALF + 8, HALF - 8);
      const z = clamp(s.z + rrange(Math.random, -4, 4), -HALF + 8, HALF - 8);
      const type = types[k % types.length];
      const obj = ring(JOB_COLORS[type]);
      obj.position.set(x, 0, z);
      this.scene.add(obj);
      const hex = '#' + JOB_COLORS[type].toString(16).padStart(6, '0');
      this.jobs.push({ x, z, type, obj, cool: 0, color: hex });
    }
  }

  _showTarget(x, z, color = 0x7cff9f) {
    this._hideTarget();
    this.targetObj = ring(color);
    this.targetObj.position.set(x, 0, z);
    this.scene.add(this.targetObj);
  }

  _hideTarget() {
    if (this.targetObj) { this.scene.remove(this.targetObj); this.targetObj = null; }
  }

  _lanePointNear(fx, fz, min, max) {
    for (let a = 0; a < 40; a++) {
      const p = this.city.randomLanePoint(Math.random);
      const d = Math.hypot(p.x - fx, p.z - fz);
      if (d < min || d > max) continue;
      if (this.city.isBlocked(p.x, p.z, 2)) continue;
      return p;
    }
    return this.city.randomLanePoint(Math.random);
  }

  accept() {
    if (this.active || !this.nearJob) return false;
    const job = this.nearJob;
    job.cool = 40;
    const { x, z } = job;
    if (job.type === 'delivery') {
      const t = this._lanePointNear(x, z, 190, 420);
      this.active = {
        type: 'delivery', limit: 78, time: 78, reward: rint(Math.random, 1400, 2600),
        targets: [t], index: 0, needVehicle: true,
      };
      this._showTarget(t.x, t.z);
      this.hooks.onObjective?.(`开车把货送到标记点 · ${fmtMoney(this.active.reward)}`, this.active.time / this.active.limit);
    } else if (job.type === 'rush') {
      const chain = [];
      let cx = x, cz = z;
      for (let i = 0; i < 6; i++) {
        const p = this._lanePointNear(cx, cz, 90, 190);
        chain.push(p); cx = p.x; cz = p.z;
      }
      this.active = { type: 'rush', limit: 17, time: 17, reward: 900, targets: chain, index: 0, needVehicle: true };
      this._showTarget(chain[0].x, chain[0].z);
      this.hooks.onObjective?.('穿过所有检查点 · 1/6', 1);
    } else {
      this.active = { type: 'getaway', limit: 42, time: 42, reward: 3200, targets: [], index: 0, needVehicle: true };
      this._hideTarget();
      this.hooks.addHeat?.(2.6, '突围');
      this.hooks.onObjective?.('摆脱追缉，存活 42 秒', 1);
    }
    this.hooks.onStart?.(NAMES[job.type]);
    this.scene.remove(job.obj);
    return true;
  }

  fail(reason) {
    if (!this.active) return;
    this._hideTarget();
    this.active = null;
    this.hooks.onFail?.(reason);
  }

  _advance() {
    const m = this.active;
    m.index++;
    m.reward += m.type === 'rush' ? 260 : 0;
    if (m.type === 'rush') {
      m.time = m.limit;
      if (m.index >= m.targets.length) { this._complete(); return; }
      this._showTarget(m.targets[m.index].x, m.targets[m.index].z);
      this.hooks.onObjective?.(`穿过所有检查点 · ${m.index + 1}/${m.targets.length}`, 1);
    } else {
      this._complete();
    }
  }

  _complete() {
    const m = this.active;
    this.completed++;
    this._hideTarget();
    this.active = null;
    this.hooks.onReward?.(m.reward, NAMES[m.type]);
  }

  update(dt, player, elapsed, stars) {
    for (const j of this.jobs) {
      if (j.cool > 0) {
        j.cool -= dt;
        if (j.cool <= 0 && !this.scene.children.includes(j.obj)) this.scene.add(j.obj);
      }
      const pulse = 1 + Math.sin(elapsed * 2.4 + j.x) * 0.06;
      j.obj.userData.base.scale.setScalar(pulse);
      j.obj.visible = j.cool <= 0;
    }
    if (this.targetObj) {
      const s = 1 + Math.sin(elapsed * 5) * 0.08;
      this.targetObj.userData.base.scale.setScalar(s);
      this.targetObj.rotation.y = elapsed * 0.6;
    }

    if (this.active) {
      this.active.time -= dt;
      const m = this.active;
      if (m.type === 'getaway') {
        this.hooks.onObjective?.(`突围中 · 剩余 ${Math.ceil(m.time)} 秒`, m.time / m.limit);
        if (stars === 0) { this._complete(); return; }
      } else if (m.targets.length) {
        const t = m.targets[m.index];
        const d = Math.hypot(player.x - t.x, player.z - t.z);
        this.hooks.onObjective?.(
          `${m.type === 'rush' ? '检查点' : '目标'} ${m.index + 1}/${m.targets.length} · ${Math.round(d)}m · ${Math.ceil(m.time)}s`,
          clamp(m.time / m.limit, 0, 1)
        );
        if (d < 5.2) this._advance();
      }
      if (this.active && m.time <= 0) this.fail('时间耗尽');
      this.nearJob = null;
      return;
    }

    let best = null, bd = 121;   // 11 m board, squared
    for (const j of this.jobs) {
      if (j.cool > 0) continue;
      const d = dist2(player.x, player.z, j.x, j.z);
      if (d < bd) { bd = d; best = j; }
    }
    this.nearJob = best;
    if (best) this.hooks.onPrompt?.(`${NAMES[best.type]} · 按 E 接单`);
    else this.hooks.onPrompt?.(null);
  }
}
