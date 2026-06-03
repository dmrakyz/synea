import * as THREE from 'three';

// Manages Web Audio API spatial audio based on Ear organ placement.

export class SpatialAudio {
  constructor() {
    this._ctx = null;
    this._ears = [];
    this._masterGain = null;
    this._mergerNode = null;
    this._initialized = false;
    this._sounds = new Map(); // id → { source, gainNode }
  }

  get context() { return this._ctx; }
  get isReady() { return this._initialized; }

  // Must be called from a user gesture (touch/click) to unlock AudioContext
  async init() {
    if (this._initialized) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this._ctx.state === 'suspended') await this._ctx.resume();

    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = 1.0;
    this._masterGain.connect(this._ctx.destination);

    // Initialize all already-added ears
    for (const ear of this._ears) {
      ear.initAudio(this._ctx);
      if (ear.gainNode) ear.gainNode.connect(this._masterGain);
    }

    this._initialized = true;
  }

  addEar(ear) {
    this._ears.push(ear);
    if (this._initialized && this._ctx) {
      ear.initAudio(this._ctx);
      if (ear.gainNode) ear.gainNode.connect(this._masterGain);
    }
  }

  removeEar(ear) {
    this._ears = this._ears.filter(e => e !== ear);
    ear.dispose();
  }

  clear() {
    for (const ear of this._ears) ear.dispose();
    this._ears = [];
  }

  // Set listener position (average of all ears, or primary ear)
  updateListener(cameraPosition, cameraQuat) {
    if (!this._ctx) return;
    const listener = this._ctx.listener;
    listener.positionX?.setValueAtTime(cameraPosition.x, this._ctx.currentTime);
    listener.positionY?.setValueAtTime(cameraPosition.y, this._ctx.currentTime);
    listener.positionZ?.setValueAtTime(cameraPosition.z, this._ctx.currentTime);

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraQuat);

    listener.forwardX?.setValueAtTime(fwd.x, this._ctx.currentTime);
    listener.forwardY?.setValueAtTime(fwd.y, this._ctx.currentTime);
    listener.forwardZ?.setValueAtTime(fwd.z, this._ctx.currentTime);
    listener.upX?.setValueAtTime(up.x, this._ctx.currentTime);
    listener.upY?.setValueAtTime(up.y, this._ctx.currentTime);
    listener.upZ?.setValueAtTime(up.z, this._ctx.currentTime);
  }

  update() {
    for (const ear of this._ears) ear.update(0);
  }

  // Play a one-shot sound at a world position
  async playAt(audioBuffer, worldPos, opts = {}) {
    if (!this._ctx || !this._masterGain) return;
    const source = this._ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.loop = opts.loop ?? false;

    const panner = this._ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.setPosition(worldPos.x, worldPos.y, worldPos.z);

    const gain = this._ctx.createGain();
    gain.gain.value = opts.volume ?? 1.0;

    source.connect(panner);
    panner.connect(gain);
    gain.connect(this._masterGain);

    source.start(0);
    return source;
  }

  // Procedural heartbeat sound (oscillator-based, no audio file needed)
  startHeartbeat(bpm = 70) {
    if (!this._ctx || !this._masterGain) return;
    this._stopHeartbeat();

    const beatInterval = 60 / bpm;
    const playBeat = () => {
      if (!this._ctx) return;
      const now = this._ctx.currentTime;

      // Low thump: short burst of low-frequency oscillator
      const osc = this._ctx.createOscillator();
      osc.frequency.value = 80;
      osc.type = 'sine';
      const env = this._ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.4, now + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(env);
      env.connect(this._masterGain);
      osc.start(now);
      osc.stop(now + 0.2);

      // Second beat (dub)
      const osc2 = this._ctx.createOscillator();
      osc2.frequency.value = 60;
      osc2.type = 'sine';
      const env2 = this._ctx.createGain();
      env2.gain.setValueAtTime(0, now + 0.12);
      env2.gain.linearRampToValueAtTime(0.2, now + 0.14);
      env2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc2.connect(env2);
      env2.connect(this._masterGain);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.3);
    };

    playBeat();
    this._heartbeatTimer = setInterval(playBeat, beatInterval * 1000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
  }

  setMasterVolume(v) {
    if (this._masterGain) this._masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  dispose() {
    this._stopHeartbeat();
    this.clear();
    if (this._ctx) { this._ctx.close(); this._ctx = null; }
  }
}
