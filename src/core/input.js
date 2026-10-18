const CODES = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake',
  ShiftLeft: 'run', ShiftRight: 'run',
  KeyF: 'enter',
  KeyE: 'action',
  KeyH: 'help',
  KeyR: 'restart',
  Escape: 'pause',
};

export class Input {
  constructor(dom) {
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this.orbit = { dx: 0, dy: 0, dragging: false, wheel: 0 };
    this._dom = dom;
    this._boundPause = false;

    addEventListener('keydown', (e) => {
      const a = CODES[e.code];
      if (!a) return;
      if (e.repeat) return;
      e.preventDefault();
      if (!this.down.has(a)) this.pressedThisFrame.add(a);
      this.down.add(a);
      if (a === 'pause') this._boundPause = true;
    });
    addEventListener('keyup', (e) => {
      const a = CODES[e.code];
      if (a) this.down.delete(a);
    });
    addEventListener('blur', () => this.down.clear());

    dom.addEventListener('pointerdown', (e) => {
      this.orbit.dragging = true;
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    });
    addEventListener('pointermove', (e) => {
      if (!this.orbit.dragging) return;
      this.orbit.dx += e.clientX - (this.orbit.lastX ?? e.clientX);
      this.orbit.dy += e.clientY - (this.orbit.lastY ?? e.clientY);
      this.orbit.lastX = e.clientX;
      this.orbit.lastY = e.clientY;
    });
    addEventListener('pointerup', () => { this.orbit.dragging = false; });
    dom.addEventListener('wheel', (e) => {
      this.orbit.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  held(action) { return this.down.has(action); }
  tapped(action) { return this.pressedThisFrame.has(action); }
  get paused() { return this._boundPause; }
  clearPause() { this._boundPause = false; }

  /** -1..1 steering / lateral axis */
  get steer() { return (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0); }
  get throttle() { return (this.down.has('up') ? 1 : 0) - (this.down.has('down') ? 1 : 0); }
  get moveAxis() {
    return {
      x: (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0),
      z: (this.down.has('up') ? 1 : 0) - (this.down.has('down') ? 1 : 0),
    };
  }

  /** Consume accumulated look deltas for one frame. */
  readLook() {
    const o = this.orbit;
    const out = { dx: o.dx, dy: o.dy, wheel: o.wheel };
    o.dx = 0; o.dy = 0; o.wheel = 0;
    return out;
  }

  endFrame() { this.pressedThisFrame.clear(); }
}
