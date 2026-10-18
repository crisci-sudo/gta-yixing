import * as THREE from 'three';
import { clamp, damp, wrapAngle } from './math.js';

const PRESETS = {
  foot: { dist: 5.4, height: 1.0, look: 1.35, pitch: 0.26, follow: 2.6, fov: 62 },
  car: { dist: 9.2, height: 1.5, look: 1.5, pitch: 0.17, follow: 3.2, fov: 60 },
  cine: { dist: 13, height: 2.4, look: 1.4, pitch: 0.13, follow: 1.2, fov: 55 },
};

/** Third-person chase camera with user orbit, obstacle pull-in and speed FOV kick. */
export class CameraRig {
  constructor(camera, isBlocked, roofAt) {
    this.cam = camera;
    this.isBlocked = isBlocked || (() => false);
    this.roofAt = roofAt || (() => 0);
    this.mode = 'foot';
    this.yaw = 0;
    this.pitch = PRESETS.foot.pitch;
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.shake = 0;
    this.distScale = 1;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    // Keep the camera where it is horizontally so the cut is invisible.
    const p = PRESETS[mode];
    this.pitch = p.pitch;
  }

  snap(pos, heading) {
    this.yaw = heading;
    this.target.set(pos.x, pos.y || 0, pos.z);
    this.smoothTarget.copy(this.target);
  }

  update(dt, pos, heading, speed, look) {
    const p = PRESETS[this.mode] || PRESETS.foot;
    this.target.set(pos.x, pos.y, pos.z);

    // Re-align behind the subject unless the player is actively orbiting.
    if (!look.dragging) {
      const err = wrapAngle(heading - this.yaw);
      const rate = p.follow + Math.min(3, Math.abs(err) * 2.2);
      this.yaw = damp(this.yaw, this.yaw + err, rate, dt);
    }
    this.yaw = wrapAngle(this.yaw + look.dx * -0.0042);
    this.pitch = clamp(this.pitch + look.dy * 0.0026, 0.04, 0.85);
    this.distScale = clamp(this.distScale + look.wheel * 0.1, 0.6, 1.9);

    const kick = this.mode === 'car' ? speed * 0.055 : 0;
    const dist = (p.dist + kick) * this.distScale;
    const horiz = Math.cos(this.pitch) * dist;
    let cx = this.target.x - Math.sin(this.yaw) * horiz;
    let cz = this.target.z - Math.cos(this.yaw) * horiz;
    let cy = this.target.y + p.height + Math.sin(this.pitch) * dist;

    // Pull the camera in — and lift it — when a building would occlude the subject.
    const fullX = cx, fullZ = cz;
    let t = 1, found = false;
    for (let k = 1; k >= 0.3; k -= 0.07) {
      const bx = this.target.x + (fullX - this.target.x) * k;
      const bz = this.target.z + (fullZ - this.target.z) * k;
      if (!this.isBlocked(bx, bz, 0.6)) {
        t = k; cx = bx; cz = bz; found = true; break;
      }
    }
    if (!found) {
      t = 0.3;
      cx = this.target.x + (fullX - this.target.x) * t;
      cz = this.target.z + (fullZ - this.target.z) * t;
    }
    cy = this.target.y + p.height + Math.sin(this.pitch) * dist * t + (1 - t) * 4.6;
    const roof = this.roofAt(cx, cz, 0.6);
    if (roof > 0) cy = Math.max(cy, roof + 2.4);

    if (this.shake > 0.001) {
      this.shake = damp(this.shake, 0, 7, dt);
      cx += (Math.random() - 0.5) * this.shake;
      cy += (Math.random() - 0.5) * this.shake * 0.7;
      cz += (Math.random() - 0.5) * this.shake;
    }

    this.cam.position.set(clamp(cx, -1e4, 1e4), Math.max(0.85, cy), clamp(cz, -1e4, 1e4));
    const lead = this.mode === 'car' ? Math.min(3.4, speed * 0.11) : 0;
    this.smoothTarget.x = damp(this.smoothTarget.x, this.target.x + Math.sin(this.yaw) * lead, 9, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, this.target.z + Math.cos(this.yaw) * lead, 9, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, this.target.y + p.look, 8, dt);
    this.cam.lookAt(this.smoothTarget);

    const wantFov = p.fov + (this.mode === 'car' ? clamp(speed * 0.42, 0, 14) : 0);
    if (Math.abs(this.cam.fov - wantFov) > 0.05) {
      this.cam.fov = damp(this.cam.fov, wantFov, 4, dt);
      this.cam.updateProjectionMatrix();
    }
    return this.yaw;
  }

  /** Current horizontal look direction, used to project foot movement. */
  get lookYaw() { return this.yaw; }
}
