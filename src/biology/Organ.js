import * as THREE from 'three';
import { BodyPart } from './BodyPart.js';

export class Organ extends BodyPart {
  constructor(options = {}) {
    super({ ...options, materialId: options.materialId ?? 'MUSCLE_SMOOTH' });
    this._organType = options.organType ?? 'generic';
    this._health = 1.0;
    this._maxHealth = 1.0;
    this._isAlive = true;
    this._connections = []; // nervous/circulatory connections
    this._nervousInputs = [];
    this._nervousOutputs = [];
    this._o2Level = 1.0;
    this._energyLevel = 1.0;
  }

  get organType() { return this._organType; }
  get isAlive() { return this._isAlive; }
  get o2Level() { return this._o2Level; }
  set o2Level(v) { this._o2Level = Math.max(0, Math.min(1, v)); }
  get energyLevel() { return this._energyLevel; }
  set energyLevel(v) { this._energyLevel = Math.max(0, Math.min(1, v)); }

  takeDamage(amount) {
    this._health = Math.max(0, this._health - amount);
    if (this._health <= 0) this._isAlive = false;
  }

  heal(amount) {
    if (!this._isAlive) return;
    this._health = Math.min(this._maxHealth, this._health + amount);
  }

  // Override in subclasses for biological behavior
  update(dt) {}

  serialize() {
    return {
      ...super.serialize(),
      type: 'Organ',
      organType: this._organType,
      health: this._health,
    };
  }
}

export class Heart extends Organ {
  constructor(options = {}) {
    super({ ...options, organType: 'heart', materialId: 'MUSCLE_CARDIAC' });
    this._bpm = options.bpm ?? 70;
    this._phase = 0;
    this._strokeVolume = 0.07; // L per beat
    this._pressure = 1.0; // normalized blood pressure
  }

  get bpm() { return this._bpm; }
  set bpm(v) { this._bpm = Math.max(20, Math.min(300, v)); }
  get pressure() { return this._pressure; }

  update(dt) {
    if (!this._isAlive) { this._pressure = 0; return; }
    this._phase += dt * (this._bpm / 60) * Math.PI * 2;
    // Pressure wave: systole peak, diastole valley
    this._pressure = 0.6 + 0.4 * Math.max(0, Math.sin(this._phase));
    // Energy consumption
    this._energyLevel = Math.max(0, this._energyLevel - 0.001 * dt);
  }

  serialize() {
    return { ...super.serialize(), type: 'Heart', organType: 'heart', bpm: this._bpm };
  }
}

export class Lungs extends Organ {
  constructor(options = {}) {
    super({ ...options, organType: 'lungs', materialId: 'MUSCLE_SMOOTH' });
    this._breathRate = options.breathRate ?? 15; // breaths/min
    this._phase = 0;
    this._o2Output = 1.0;
    this._capacity = options.capacity ?? 6.0; // liters
  }

  get breathRate() { return this._breathRate; }
  get o2Output() { return this._o2Output; }
  get breathPhase() { return this._phase; }

  update(dt) {
    if (!this._isAlive) { this._o2Output = 0; return; }
    this._phase += dt * (this._breathRate / 60) * Math.PI * 2;
    // Sinusoidal breath: 0=exhale, 1=inhale
    this._o2Output = 0.5 + 0.5 * Math.sin(this._phase);
  }

  serialize() {
    return { ...super.serialize(), type: 'Lungs', organType: 'lungs', breathRate: this._breathRate };
  }
}

export class Brain extends Organ {
  constructor(options = {}) {
    super({ ...options, organType: 'brain', materialId: 'SKIN' });
    this._consciousness = 1.0;
    this._noiseLevel = 0;
    this._regions = new Map(); // regionName → { active: bool, damage: 0-1 }
    // Default regions
    for (const r of ['motor', 'sensory', 'autonomic', 'cerebellum', 'brainstem']) {
      this._regions.set(r, { active: true, damage: 0 });
    }
  }

  get consciousness() { return this._consciousness; }
  get noiseLevel() { return this._noiseLevel; }

  takeDamage(amount) {
    super.takeDamage(amount);
    this._consciousness = Math.max(0, this._consciousness - amount * 2);
    this._noiseLevel = Math.min(1, this._noiseLevel + amount);
  }

  update(dt) {
    if (!this._isAlive) return;
    // Recover consciousness slowly
    this._consciousness = Math.min(1, this._consciousness + 0.01 * dt * this._o2Level);
    this._noiseLevel = Math.max(0, this._noiseLevel - 0.005 * dt);
  }

  isRegionFunctional(regionName) {
    const r = this._regions.get(regionName);
    return r && r.active && r.damage < 0.8;
  }

  serialize() {
    return { ...super.serialize(), type: 'Brain', organType: 'brain' };
  }
}

export class Stomach extends Organ {
  constructor(options = {}) {
    super({ ...options, organType: 'stomach', materialId: 'MUSCLE_SMOOTH' });
    this._energyStore = options.energyStore ?? 1.0; // 0-1
    this._digestRate = 0.005; // per second at rest
  }

  get energyStore() { return this._energyStore; }

  consume(amount) {
    this._energyStore = Math.max(0, this._energyStore - amount);
  }

  feed(amount) {
    this._energyStore = Math.min(1, this._energyStore + amount);
  }

  update(dt) {
    if (!this._isAlive) return;
    // Slowly release energy to body
    const release = this._digestRate * dt;
    if (this._energyStore > 0) {
      this._energyStore = Math.max(0, this._energyStore - release);
      this._energyLevel = Math.min(1, this._energyLevel + release);
    }
  }

  serialize() {
    return { ...super.serialize(), type: 'Stomach', organType: 'stomach', energyStore: this._energyStore };
  }
}

// Factory
export function createOrgan(organType, options = {}) {
  switch (organType) {
    case 'heart': return new Heart(options);
    case 'lungs': return new Lungs(options);
    case 'brain': return new Brain(options);
    case 'stomach': return new Stomach(options);
    default: return new Organ({ ...options, organType });
  }
}

export function deserializeOrgan(data) {
  const opts = {
    id: data.id, name: data.name,
    materialId: data.materialId,
    mass: data.mass,
    position: data.position,
    quaternion: data.quaternion,
  };
  switch (data.organType) {
    case 'heart': return new Heart({ ...opts, bpm: data.bpm });
    case 'lungs': return new Lungs({ ...opts, breathRate: data.breathRate });
    case 'brain': return new Brain(opts);
    case 'stomach': return new Stomach({ ...opts, energyStore: data.energyStore });
    default: return new Organ({ ...opts, organType: data.organType });
  }
}
