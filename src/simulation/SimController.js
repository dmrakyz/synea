// Maps touch/button inputs to muscle activation control groups.
// Input sources: swipe zones (sustained touch), buttons (A/B), tilt (DeviceOrientation).
// Activation ramps smoothly on touch-down and decays on touch-up.

const RAMP_UP = 0.05;   // seconds to ramp from 0 to 1
const RAMP_DOWN = 0.15; // seconds to ramp from 1 to 0
const DT = 1 / 60;

export class SimController {
  constructor(character) {
    this._character = character;
    this._bindings = new Map(); // groupName → { inputKey, curve }
    this._rawInput = {
      up: 0, down: 0, left: 0, right: 0,
      btnA: 0, btnB: 0, tiltX: 0, tiltY: 0,
    };
    this._smoothed = { ...this._rawInput };
    this._handlers = [];
    this._tiltEnabled = false;
  }

  get bindings() { return this._bindings; }

  addBinding(groupName, inputKey, curve = 'linear') {
    this._bindings.set(groupName, { inputKey, curve });
  }

  removeBinding(groupName) {
    this._bindings.delete(groupName);
  }

  // Called by SimHUD when input state changes
  setRaw(key, value) {
    if (key in this._rawInput) this._rawInput[key] = Math.max(0, Math.min(1, value));
  }

  // Enable device tilt as input (requires permission on iOS)
  async enableTilt() {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') return;
    }
    const handler = (e) => {
      this._rawInput.tiltX = Math.max(-1, Math.min(1, e.gamma / 45));
      this._rawInput.tiltY = Math.max(-1, Math.min(1, e.beta / 45));
    };
    window.addEventListener('deviceorientation', handler);
    this._handlers.push({ event: 'deviceorientation', fn: handler, target: window });
    this._tiltEnabled = true;
  }

  update() {
    // Smooth raw inputs
    for (const key of Object.keys(this._smoothed)) {
      const target = this._rawInput[key] ?? 0;
      const current = this._smoothed[key];
      const step = target > current ? DT / RAMP_UP : DT / RAMP_DOWN;
      this._smoothed[key] = Math.abs(target - current) < step
        ? target
        : current + Math.sign(target - current) * step;
    }

    // Map to character activations
    for (const [group, binding] of this._bindings) {
      let raw = this._smoothed[binding.inputKey] ?? 0;
      raw = this._applyCurve(raw, binding.curve);
      this._character.setActivation(group, raw);
    }
  }

  _applyCurve(v, curve) {
    switch (curve) {
      case 'linear': return v;
      case 'exponential': return v * v;
      case 'step': return v > 0.5 ? 1 : 0;
      case 'smooth': return v * v * (3 - 2 * v); // smoothstep
      default: return v;
    }
  }

  serialize() {
    return {
      bindings: [...this._bindings.entries()].map(([g, b]) => ({ group: g, ...b })),
    };
  }

  deserialize(data) {
    for (const b of (data.bindings ?? [])) {
      this.addBinding(b.group, b.inputKey, b.curve);
    }
  }

  dispose() {
    for (const { event, fn, target } of this._handlers) {
      target.removeEventListener(event, fn);
    }
    this._handlers = [];
  }
}
