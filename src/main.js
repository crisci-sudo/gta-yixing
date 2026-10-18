import * as THREE from 'three';
import { Input } from './core/input.js';
import { CameraRig } from './core/camera.js';
import { Puffs } from './core/effects.js';
import { clamp, damp, dist2, fmtMoney, pick } from './core/math.js';
import { City, roadAt, HALF } from './world/city.js';
import { setupEnvironment, addSkylineRing } from './world/environment.js';
import { Player } from './systems/player.js';
import { makeVehicle, resolvePair } from './entities/vehicle.js';
import { TrafficCar } from './entities/traffic.js';
import { Pedestrian } from './entities/ped.js';
import { WantedSystem } from './systems/wanted.js';
import { MissionSystem } from './systems/mission.js';
import { Hud } from './ui/hud.js';

window.__started = true;

const TRAFFIC_N = 26;
const PED_N = 36;
const PARKED_N = 30;
const SIM_R = 260;          // AI only ticks inside this radius
const FIXED = 1 / 60;
const KINDS = ['sedan', 'sedan', 'sedan', 'van', 'coupe', 'taxi'];

const PRECINCT = { x: roadAt(1), z: roadAt(6) };
const HOSPITAL = { x: roadAt(6), z: roadAt(1) };

const laneYaw = (p) => (p.axis === 'x' ? (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (p.dir > 0 ? 0 : Math.PI));

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.4, 2600);
    this.input = new Input(this.canvas);

    this.city = new City();
    this.rig = new CameraRig(
      this.camera,
      (x, z, r) => this.city.isBlocked(x, z, r),
      (x, z, r) => this.city.roofAt(x, z, r)
    );
    this.running = false;
    this.paused = false;
    this.transition = false;
    this.acc = 0;
    this.last = 0;
    this.time = 0;
    this.money = 500;
    this.fps = 60;
    this._threats = [];
    this._scratch = [];
    this._nearVehicle = null;
    this._jobPrompt = null;
  }

  // ------------------------------------------------------------------ setup
  build() {
    this.scene.add(this.city.build());
    setupEnvironment(this.scene, this.renderer);
    addSkylineRing(this.scene, HALF + 260);
    this.puffs = new Puffs(this.scene);
    this.hud = new Hud(this.city);
    this.player = new Player(this.city, this.scene);

    this.parked = [];
    for (let i = 0; i < PARKED_N; i++) {
      const p = this.city.randomCurbPoint(this.city.rng);
      const v = makeVehicle(pick(this.city.rng, KINDS), undefined, p.x, p.z, laneYaw(p));
      v.parked = true;
      this.parked.push(v);
      this.scene.add(v.mesh);
    }

    this.traffic = [];
    for (let i = 0; i < TRAFFIC_N; i++) {
      const t = new TrafficCar(this.city);
      this.traffic.push(t);
      this.scene.add(t.v.mesh);
    }

    this.peds = [];
    for (let i = 0; i < PED_N; i++) {
      const ped = new Pedestrian(i + 1, this.city);
      this.peds.push(ped);
      this.scene.add(ped.mesh);
    }

    this.wanted = new WantedSystem(this.city, this.scene, {
      onStars: (n, was) => {
        this.hud.stars(n);
        if (n > was) this.hud.toast(`${'★'.repeat(n)} 通缉升级`, 'bad', 1500);
      },
      onCrime: (label) => this.hud.toast(label, '', 900),
      onCleared: (msg) => this.hud.toast(msg, 'good', 1600),
      onBust: () => this._busted(),
    });

    this.missions = new MissionSystem(this.city, this.scene, {
      onObjective: (text, prog) => this.hud.objective(text, prog),
      onPrompt: (text) => { this._jobPrompt = text; },
      onStart: (name) => this.hud.toast(`${name} 开始`, '', 1500),
      onReward: (amount, name) => {
        this.money += amount;
        this.hud.money(this.money);
        this.hud.toast(`${name} 完成 · ${fmtMoney(amount)}`, 'good', 2200);
        this.hud.objective(null);
      },
      onFail: (why) => {
        this.hud.toast(`任务失败 · ${why}`, 'bad', 2000);
        this.hud.objective(null);
      },
      addHeat: (h, why) => this.wanted.addCrime(h, why),
    });

    // Guaranteed start: the player on the pavement with a car parked at the kerb beside them.
    const near = this.city.randomWalkablePoint(this.city.rng);
    this.player.spawn(near.x, near.z);
    const kerb = this.city.nearestLanePoint(near.x, near.z);
    const kx = kerb.x - near.x, kz = kerb.z - near.z;
    const kl = Math.hypot(kx, kz) || 1;
    this.starter = makeVehicle('coupe', 0xe0b03a, near.x + (kx / kl) * 3.6, near.z + (kz / kl) * 3.6, kerb.axis === 'x' ? Math.PI / 2 : 0);
    this.starter.parked = true;
    this.parked.push(this.starter);
    this.scene.add(this.starter.mesh);
    this.rig.snap(this.player, this.player.yaw);
    this.hud.money(this.money);
    this.hud.stars(0);
  }

  // ------------------------------------------------------------------ loop
  start() {
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  frame(ts) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));
    const dt = (ts - this.last) / 1000;
    this.last = ts;
    this.fps = damp(this.fps, 1 / Math.max(0.001, dt), 1.5, 0.12);

    if (this.input.tapped('pause')) this.paused = !this.paused;
    document.getElementById('pause').classList.toggle('on', this.paused);
    if (this.paused) { this.input.endFrame(); this.renderer.render(this.scene, this.camera); return; }

    this.acc += clamp(dt, 0, 0.12);
    let steps = 0;
    while (this.acc >= FIXED && steps < 5) {
      this.step(FIXED);
      this.acc -= FIXED;
      steps++;
      this.input.endFrame();
    }
    // With no substep consumed, taps must survive until the next simulation tick.

    this.renderer.render(this.scene, this.camera);
  }

  step(dt) {
    this.time += dt;
    const p = this.player;
    const inp = this.input;

    if (inp.tapped('help')) this.hud.toggleHelp();
    if (inp.tapped('restart')) this._recoverToStreet();
    if (inp.tapped('enter')) this._switchVehicle();
    if (inp.tapped('action')) this.missions.accept();

    const car = p.vehicle;
    if (car) {
      const out = car.update(dt, {
        throttle: inp.throttle,
        steer: inp.steer,
        hand: inp.held('handbrake'),
        brake: false,
        active: !car.dead,
      }, this.city);
      if (out.impact > 7) this.rig.shake = Math.min(1.4, out.impact * 0.075);
      if (car.drifting > 0.34 && car.speed > 9) {
        const f = car.forward, r = car.right;
        this.puffs.spawn(car.x - f.x * 1.6 + r.x * 0.8, 0.3, car.z - f.z * 1.6 + r.z * 0.8,
          { color: 0xdfe2e6, size: 0.5, vy: 0.9, ttl: 0.55, grow: 3.4 });
      }
      if (car.dead && Math.random() < dt * 9) {
        const f = car.forward;
        this.puffs.spawn(car.x + f.x * 1.4, 0.9, car.z + f.z * 1.4,
          { color: 0x2c2c30, size: 0.6, vy: 1.8, ttl: 1.5, grow: 2.6, opacity: 0.42 });
      }
      p.followVehicle();
    } else {
      p.footUpdate(dt, inp.moveAxis, this.rig.yaw, inp.held('run'), this._footObstacles());
    }

    this._updateWorld(dt);
    this._collideVehicles();
    this._checkPeds();
    this._checkPlayerRunOver();
    this.wanted.update(dt, {
      x: p.x, z: p.z, vx: p.vx, vz: p.vz, speed: p.speed, onFoot: p.onFoot, vehicle: p.vehicle,
    }, this.time);

    this.missions.update(dt, p, this.time, this.wanted.stars);
    this.puffs.update(dt);
    if (p.dead) this._wasted();

    this._camera(dt);
    this._hud(car);
  }

  // ------------------------------------------------------------- subsystems
  _allVehicles(out = this._scratch) {
    out.length = 0;
    for (const t of this.traffic) out.push(t.v);
    for (const v of this.parked) out.push(v);
    for (const c of this.wanted.cops) out.push(c.v);
    if (this.player.vehicle) out.push(this.player.vehicle);
    return out;
  }

  _footObstacles() {
    const out = [];
    const p = this.player;
    for (const v of this._allVehicles()) {
      if (dist2(p.x, p.z, v.x, v.z) > 900) continue;
      out.push({ x: v.x, z: v.z, r: v.boundingRadius() * 0.62 });
    }
    return out;
  }

  _updateWorld(dt) {
    const p = this.player;
    for (const t of this.traffic) {
      if (dist2(p.x, p.z, t.v.x, t.v.z) > SIM_R * SIM_R) {
        if (t.v.dead) t.respawn();
        continue;
      }
      t.update(dt, this._trafficNear(t), p);
    }

    this._threats.length = 0;
    for (const v of this._allVehicles()) {
      if (dist2(p.x, p.z, v.x, v.z) > 6000) continue;
      if (v.speed > 1.2) this._threats.push(v);
    }
    for (const ped of this.peds) {
      if (dist2(p.x, p.z, ped.x, ped.z) > SIM_R * SIM_R) continue;
      ped.update(dt, this._threats);
    }
  }

  _trafficNear(self) {
    const out = this._nearCache || (this._nearCache = []);
    out.length = 0;
    for (const t of this.traffic) {
      if (t === self) continue;
      if (dist2(self.v.x, self.v.z, t.v.x, t.v.z) > 500) continue;
      out.push(t.v);
    }
    for (const v of this.parked) {
      if (dist2(self.v.x, self.v.z, v.x, v.z) > 400) continue;
      out.push(v);
    }
    for (const c of this.wanted.cops) out.push(c.v);
    if (this.player.vehicle) out.push(this.player.vehicle);
    return out;
  }

  _collideVehicles() {
    const list = this._allVehicles();
    const pv = this.player.vehicle;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (a.parked && b.parked) continue;
        if (dist2(a.x, a.z, b.x, b.z) > 42) continue;
        const closing = resolvePair(a, b);
        if (closing < 6) continue;
        const dmg = (closing - 5) * 1.35;
        a.damage(dmg);
        b.damage(dmg);
        if (a === pv || b === pv) {
          this.rig.shake = Math.min(1.3, closing * 0.07);
          const other = a === pv ? b : a;
          if (other.isPolice) this.wanted.addCrime(0.5, '撞击警车');
          else if (closing > 14) this.wanted.addCrime(0.15);
        }
      }
      if (a === pv && a.dead && a.speed < 1.2 && !this._wreckNotice) {
        this._wreckNotice = true;
        this.hud.toast('车辆报废', 'bad', 1500);
        this._switchVehicle();
      }
    }
    if (pv && !pv.dead) this._wreckNotice = false;
  }

  _checkPeds() {
    const p = this.player;
    const pv = p.vehicle;
    const list = this._allVehicles(this._scratch2 || (this._scratch2 = []));
    for (const ped of this.peds) {
      if (!ped.alive) continue;
      if (dist2(p.x, p.z, ped.x, ped.z) > 6000) continue;
      for (const v of list) {
        if (v.speed < 6.5) continue;
        const rr = v.boundingRadius() * 0.74 + 0.5;
        if (dist2(v.x, v.z, ped.x, ped.z) > rr * rr) continue;
        ped.hit(v.speed);
        this.puffs.spawn(ped.x, 1, ped.z, { color: 0xc9ced6, size: 0.4, vy: 1.2, ttl: 0.6 });
        if (v === pv) {
          this.wanted.addCrime(v.speed > 15 ? 1.3 : 0.85, '撞倒行人');
          this.rig.shake = 0.5;
          this.money = Math.max(0, this.money - 80);
          this.hud.money(this.money);
        }
        break;
      }
    }
  }

  /** Being clipped by moving metal hurts on foot, whoever the driver is. */
  _checkPlayerRunOver() {
    const p = this.player;
    if (p.onFoot && !p.dead) {
      for (const v of this._allVehicles()) {
        if (v.speed < 6) continue;
        const rr = v.boundingRadius() * 0.8 + 0.55;
        if (dist2(v.x, v.z, p.x, p.z) > rr * rr) continue;
        p.damage(v.speed * 2.4);
        this.rig.shake = 1.2;
        this.puffs.spawn(p.x, 1, p.z, { color: 0xffd0d0, size: 0.35, vy: 1.4, ttl: 0.5 });
        break;
      }
    }
  }

  _camera(dt) {
    const p = this.player;
    const car = p.vehicle;
    this.rig.setMode(car ? 'car' : 'foot');
    const look = this.input.readLook();
    look.dragging = this.input.orbit.dragging;
    this.rig.update(
      dt,
      { x: p.x, y: car ? 0.85 : 0, z: p.z },
      car ? car.yaw : p.yaw,
      car ? car.speed : p.speed * 0.5,
      look
    );
  }

  _hud(car) {
    const p = this.player;
    let gear = '—', label = '步行', armour = 0;
    const kmh = p.kmh;
    if (car) {
      label = car.name || car.kind;
      armour = car.health;
      if (car.dead) gear = '×';
      else if (car.longVel < -0.7) gear = 'R';
      else if (kmh < 1) gear = 'N';
      else gear = String(1 + Math.min(4, Math.floor(kmh / 26)));
    }
    this.hud.dash({ kmh, gear, label, body: p.health, armour, drift: car ? car.drifting : 0 });
    this.hud.stars(this.wanted.stars, this.wanted.bust, this.wanted.heat);

    let prompt = null;
    if (p.onFoot) {
      this._nearVehicle = p.nearestVehicle(this._allVehicles(), 5.2);
      if (this._nearVehicle) prompt = `按 F 上车 · ${this._nearVehicle.name}`;
    } else {
      this._nearVehicle = null;
      prompt = '按 F 下车';
    }
    if (!prompt && this._jobPrompt) prompt = this._jobPrompt;
    if (this.missions.active) prompt = null;
    this.hud.prompt(prompt);

    const m = this.missions.active;
    this.hud.minimap({ x: p.x, z: p.z, yaw: p.yaw }, {
      jobs: this.missions.jobs,
      cops: this.wanted.cops,
      parked: this.parked,
      objective: m && m.targets.length ? m.targets[m.index] : null,
      landmark: this.city.landmark,
      time: this.time,
    });
  }

  // ------------------------------------------------------------------ events
  _switchVehicle() {
    const p = this.player;
    if (p.vehicle) {
      const v = p.vehicle;
      p.exit();
      v.parked = true;
      this.parked.push(v);
      this.rig.snap(p, p.yaw);
      return;
    }
    const v = p.nearestVehicle(this._allVehicles(), 5.2) || this._nearVehicle;
    if (!v) return;
    if (v.dead) { this.hud.toast('这辆车已经报废了', '', 1200); return; }

    // Detach the car from whichever AI owned it, then account for the theft.
    const t = this.traffic.find((x) => x.v === v);
    if (t) {
      this.scene.remove(v.mesh);
      this.traffic.splice(this.traffic.indexOf(t), 1);
      this.wanted.addCrime(0.85, '偷车');
    } else if (v.parked) {
      this.parked.splice(this.parked.indexOf(v), 1);
      this.wanted.addCrime(v === this.starter ? 0 : 0.3, v === this.starter ? '' : '偷车');
    }
    const cop = this.wanted.cops.find((c) => c.v === v);
    if (cop) {
      this.wanted._retire(cop);
      this.wanted.addCrime(2, '抢走警车');
    }

    v.parked = false;
    p.enter(v);
    this.rig.snap(v, v.yaw);
    this.hud.toast(`已坐上 ${v.name}`, '', 1100);
  }

  _recoverToStreet() {
    const p = this.player;
    const lane = this.city.nearestLanePoint(p.x, p.z);
    if (p.vehicle) p.vehicle.place(lane.x, lane.z, p.vehicle.yaw);
    else { p.x = lane.x; p.z = lane.z; p.ped.x = p.x; p.ped.z = p.z; p.ped.sync(); }
    this.hud.toast('已回到街道', '', 1000);
  }

  _busted() {
    if (this.transition) return;
    this.transition = true;
    const loss = Math.round(this.money * 0.15);
    this.money -= loss;
    this.hud.money(this.money);
    this.hud.toast('被 逮 捕', 'bad', 2600);
    this.wanted.clear();
    this.missions.fail('被捕');
    this._respawnAt(PRECINCT, loss);
  }

  _wasted() {
    if (this.transition) return;
    this.transition = true;
    const loss = Math.round(this.money * 0.1);
    this.money -= loss;
    this.hud.money(this.money);
    this.hud.toast('你 死 了', 'bad', 2600);
    this.missions.fail('死亡');
    this.wanted.clear();
    this._respawnAt(HOSPITAL, loss);
  }

  _respawnAt(at, loss) {
    setTimeout(() => {
      const p = this.player;
      if (p.vehicle) {
        const v = p.vehicle;
        p.exit();
        v.parked = true;
        this.parked.push(v);
      }
      p.spawn(clamp(at.x + 7, -HALF + 4, HALF - 4), clamp(at.z + 7, -HALF + 4, HALF - 4));
      this.rig.snap(p, p.yaw);
      this.transition = false;
      this.hud.objective(null);
      if (loss > 0) this.hud.toast(`支出 ${fmtMoney(loss)}`, '', 1400);
    }, 950);
  }
}

// ------------------------------------------------------------------ bootstrap
const game = new Game();
try {
  game.build();
} catch (err) {
  window.__broken?.(err?.stack || String(err));
  throw err;
}
window.__game = game;

const boot = document.getElementById('boot');
const menu = document.getElementById('menu');
boot.style.display = 'none';
menu.style.display = 'flex';

document.getElementById('start').addEventListener('click', () => {
  menu.style.display = 'none';
  game.hud.show(true);
  game.hud.toggleHelp(true);
  game.start();
});
document.getElementById('resume').addEventListener('click', () => {
  game.paused = false;
  game.input.clearPause();
});
addEventListener('resize', () => {
  game.camera.aspect = innerWidth / innerHeight;
  game.camera.updateProjectionMatrix();
  game.renderer.setSize(innerWidth, innerHeight);
});
addEventListener('blur', () => { if (game.running) game.paused = true; });
