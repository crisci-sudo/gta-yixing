import { clamp, fmtMoney } from '../core/math.js';
import { SIZE, HALF } from '../world/city.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(city) {
    this.city = city;
    this.el = {
      hud: $('hud'), money: $('money'), stars: $('stars'), heat: $('heat'),
      speedo: $('speedo'), gear: $('gear'), label: $('label'), drift: $('drift'),
      body: $('bodybar').firstElementChild, dmg: $('dmgbar').firstElementChild,
      objective: $('objective'), objtext: $('objtext'), objbar: $('objbar').firstElementChild,
      toast: $('toast'), prompt: $('prompt'), help: $('help'),
      map: $('minimap'), compass: $('compass'),
    };
    this.ctx = this.el.map.getContext('2d');
    this.R = 208;
    this.view = 96;          // metres from player to map edge
    this._stars = -1;
    this._toastTimer = 0;
  }

  show(on) { this.el.hud.classList.toggle('live', !!on); }
  toggleHelp(force) { this.el.help.classList.toggle('show', force === undefined ? !this.el.help.classList.contains('show') : force); }

  money(v) { this.el.money.textContent = fmtMoney(v); }

  stars(n, bust, heat) {
    if (n !== this._stars) {
      this._stars = n;
      this.el.stars.innerHTML = Array.from({ length: 5 }, (_, i) => (i < n ? '<b>★</b>' : '★')).join('');
    }
    this.el.heat.textContent = bust > 0.02
      ? `逮捕中 ${Math.round(bust * 100)}%`
      : heat > 0 && n > 0 ? '通缉生效' : '';
    this.el.stars.style.filter = bust > 0.02 ? 'drop-shadow(0 0 6px #ff4d4d)' : 'none';
  }

  dash({ kmh, gear, label, body, armour, drift }) {
    this.el.speedo.firstChild.textContent = Math.round(kmh);
    this.el.gear.textContent = gear;
    this.el.label.textContent = label;
    this.el.body.style.width = clamp(body, 0, 100) + '%';
    this.el.dmg.style.width = clamp(armour, 0, 100) + '%';
    this.el.drift.style.opacity = drift > 0.25 ? 1 : 0;
  }

  objective(text, progress) {
    if (!text) { this.el.objective.classList.remove('show'); return; }
    this.el.objective.classList.add('show');
    this.el.objtext.textContent = text;
    this.el.objbar.style.width = clamp((progress ?? 1) * 100, 0, 100) + '%';
  }

  prompt(text) {
    if (!text) { this.el.prompt.classList.remove('show'); return; }
    this.el.prompt.classList.add('show');
    if (this.el.prompt.textContent !== text) this.el.prompt.innerHTML = text;
  }

  toast(text, cls = '', ms = 2100) {
    const t = this.el.toast;
    t.textContent = text;
    t.className = 'show ' + cls;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.className = ''; }, ms);
  }

  /** North-rotating radar over the painted ground texture. */
  minimap(player, world) {
    const c = this.ctx, R = this.R;
    const k = R / this.view;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, R * 2, R * 2);
    c.save();
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#131619';
    c.fillRect(0, 0, R * 2, R * 2);

    c.translate(R, R);
    c.rotate(player.yaw);
    c.scale(k, k);
    c.translate(-player.x, -player.z);

    c.imageSmoothingEnabled = true;
    c.drawImage(this.city.groundCanvas, -HALF, -HALF, SIZE, SIZE);
    if (world.landmark) {
      c.fillStyle = 'rgba(255,255,255,.25)';
      c.beginPath();
      c.arc(world.landmark.x, world.landmark.z, 6, 0, Math.PI * 2);
      c.fill();
    }

    const blip = (x, z, color, rpx) => {
      c.beginPath();
      c.arc(x, z, rpx / k, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
    };
    for (const j of world.jobs || []) if (j.cool <= 0) blip(j.x, j.z, j.color, 5);
    if (world.objective) blip(world.objective.x, world.objective.z, '#7cff9f', 7);
    for (const cop of world.cops || []) blip(cop.x, cop.z, Math.sin(world.time * 8) > 0 ? '#5aa0ff' : '#ff5a5a', 5.5);
    for (const v of world.parked || []) blip(v.x, v.z, 'rgba(220,225,235,.45)', 3);

    c.restore();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.save();
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.clip();
    c.translate(R, R);
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6.5, 8);
    c.lineTo(0, 4.5);
    c.lineTo(-6.5, 8);
    c.closePath();
    c.fillStyle = '#ffffff';
    c.shadowColor = 'rgba(0,0,0,.7)';
    c.shadowBlur = 5;
    c.fill();
    c.restore();

    const names = ['N', 'E', 'S', 'W'];
    const idx = Math.round(((player.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 2)) % 4;
    this.el.compass.textContent = names[(idx + 2) % 4];
  }
}
