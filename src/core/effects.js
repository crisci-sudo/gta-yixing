import * as THREE from 'three';

/** Tiny pooled puff sprites for tyre smoke, impact dust and engine wreck smoke. */
export class Puffs {
  constructor(scene, n = 34) {
    const geo = new THREE.SphereGeometry(0.5, 7, 6);
    this.pool = [];
    this.free = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xdddddd, transparent: true, opacity: 0, depthWrite: false,
      }));
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
      this.free.push(i);
    }
    this.live = [];
  }

  spawn(x, y, z, opts = {}) {
    if (!this.free.length) return;
    const i = this.free.pop();
    const m = this.pool[i];
    m.visible = true;
    m.position.set(x, y, z);
    m.scale.setScalar(opts.size || 0.7);
    m.material.color.setHex(opts.color ?? 0xe8e8ec);
    m.material.opacity = opts.opacity ?? 0.55;
    this.live.push({
      i, m, life: 0, ttl: opts.ttl ?? 0.9,
      vx: (opts.vx ?? 0) + (Math.random() - 0.5) * 0.9,
      vy: opts.vy ?? 1.5,
      vz: (opts.vz ?? 0) + (Math.random() - 0.5) * 0.9,
      grow: opts.grow ?? 2.1,
    });
  }

  update(dt) {
    for (let k = this.live.length - 1; k >= 0; k--) {
      const p = this.live[k];
      p.life += dt;
      if (p.life >= p.ttl) {
        p.m.visible = false;
        this.live.splice(k, 1);
        this.free.push(p.i);
        continue;
      }
      const t = p.life / p.ttl;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.vy *= 0.96;
      p.m.scale.setScalar(p.m.scale.x + p.grow * dt);
      p.m.material.opacity = (1 - t) * 0.5;
    }
  }
}
