import * as THREE from 'three';
import { Organ } from './Organ.js';

let _earCounter = 0;

export class Ear extends Organ {
  constructor(options = {}) {
    super({
      ...options,
      organType: 'ear',
      materialId: 'CARTILAGE',
    });

    this._earIndex = ++_earCounter;
    this._size = options.size ?? 0.05;         // physical size, affects freq response
    this._shape = options.earShape ?? 'round';  // 'round' | 'cupped' | 'flat' | 'large'
    this._sensitivity = options.sensitivity ?? 1.0;
    this._channel = options.channel ?? (this._earIndex % 2 === 1 ? 'left' : 'right');

    // Web Audio API nodes — created lazily when audio context is available
    this._pannerNode = null;
    this._gainNode = null;
    this._filterNode = null;
    this._audioContext = null;
  }

  get earIndex() { return this._earIndex; }
  get channel() { return this._channel; }
  get pannerNode() { return this._pannerNode; }
  get gainNode() { return this._gainNode; }
  get sensitivity() { return this._sensitivity; }
  get size() { return this._size; }

  // Call once when AudioContext is ready
  initAudio(audioContext) {
    this._audioContext = audioContext;

    this._pannerNode = audioContext.createPanner();
    this._pannerNode.panningModel = 'HRTF';
    this._pannerNode.distanceModel = 'inverse';
    this._pannerNode.refDistance = 1;
    this._pannerNode.maxDistance = 100;
    this._pannerNode.rolloffFactor = 1;
    this._pannerNode.coneInnerAngle = 360;
    this._pannerNode.coneOuterAngle = 0;
    this._pannerNode.coneOuterGain = 0;

    this._gainNode = audioContext.createGain();
    this._gainNode.gain.value = this._sensitivity;

    // Frequency response based on ear shape
    this._filterNode = audioContext.createBiquadFilter();
    this._applyFreqResponse();

    // Signal chain: panner → filter → gain → destination
    this._pannerNode.connect(this._filterNode);
    this._filterNode.connect(this._gainNode);
    // gainNode is connected to audioContext.destination by SpatialAudio
  }

  _applyFreqResponse() {
    if (!this._filterNode) return;
    switch (this._shape) {
      case 'large':  // large pinna → bass boost
        this._filterNode.type = 'lowshelf';
        this._filterNode.frequency.value = 300;
        this._filterNode.gain.value = 6;
        break;
      case 'cupped': // cupped → focused mid range
        this._filterNode.type = 'peaking';
        this._filterNode.frequency.value = 2000;
        this._filterNode.Q.value = 1;
        this._filterNode.gain.value = 4;
        break;
      case 'flat':   // small/flat → treble
        this._filterNode.type = 'highshelf';
        this._filterNode.frequency.value = 4000;
        this._filterNode.gain.value = 3;
        break;
      default:       // round → flat response
        this._filterNode.type = 'allpass';
        break;
    }
  }

  // Sync panner position to world position of this organ
  update(dt) {
    super.update(dt);
    if (!this._pannerNode || !this._isAlive) return;

    const pos = this._mesh.getWorldPosition(new THREE.Vector3());
    this._pannerNode.positionX.setValueAtTime(pos.x, this._audioContext.currentTime);
    this._pannerNode.positionY.setValueAtTime(pos.y, this._audioContext.currentTime);
    this._pannerNode.positionZ.setValueAtTime(pos.z, this._audioContext.currentTime);

    // Orientation: forward direction of ear
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this._mesh.quaternion);
    this._pannerNode.orientationX.setValueAtTime(forward.x, this._audioContext.currentTime);
    this._pannerNode.orientationY.setValueAtTime(forward.y, this._audioContext.currentTime);
    this._pannerNode.orientationZ.setValueAtTime(forward.z, this._audioContext.currentTime);
  }

  dispose() {
    super.dispose();
    if (this._pannerNode) { this._pannerNode.disconnect(); }
    if (this._gainNode) { this._gainNode.disconnect(); }
    if (this._filterNode) { this._filterNode.disconnect(); }
  }

  serialize() {
    return {
      ...super.serialize(),
      type: 'Ear',
      organType: 'ear',
      size: this._size,
      earShape: this._shape,
      sensitivity: this._sensitivity,
      channel: this._channel,
    };
  }

  static deserialize(data) {
    return new Ear({
      id: data.id,
      name: data.name,
      materialId: data.materialId,
      mass: data.mass,
      position: data.position,
      quaternion: data.quaternion,
      size: data.size,
      earShape: data.earShape,
      sensitivity: data.sensitivity,
      channel: data.channel,
    });
  }
}
