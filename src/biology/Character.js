import { NervousSystem } from './NervousSystem.js';
import { CirculatorySystem } from './CirculatorySystem.js';
import { Muscle } from './Muscle.js';
import { Joint } from './Joint.js';
import { BodyPart } from './BodyPart.js';
import { Bone } from './Bone.js';
import { createOrgan, deserializeOrgan, Heart } from './Organ.js';
import { Eye } from './Eye.js';
import { Ear } from './Ear.js';

export class Character {
  constructor(rigidWorld) {
    this._rigidWorld = rigidWorld;

    this.parts    = new Map(); // id → BodyPart (includes Bone, Organ, Eye, Ear)
    this.joints   = new Map(); // id → Joint
    this.muscles  = new Map(); // id → Muscle
    this.controlGroups = new Map(); // groupName → Set<Muscle>

    this.nervousSystem = new NervousSystem();
    this.circulatorySystem = new CirculatorySystem();

    this._eyes = [];
    this._ears = [];
    this._brain = null;
    this._heart = null;
    this._lungs = null;
    this._stomach = null;

    this._stamina = 1.0;
    this._o2Saturation = 1.0;
  }

  get eyes() { return this._eyes; }
  get ears() { return this._ears; }
  get brain() { return this._brain; }
  get heart() { return this._heart; }
  get stamina() { return this._stamina; }
  get o2Saturation() { return this._o2Saturation; }

  // --- Part management ---

  addPart(part) {
    this.parts.set(part.id, part);
    this._rigidWorld.addBody(part.physicsBody);

    if (part instanceof Eye) this._eyes.push(part);
    if (part instanceof Ear) this._ears.push(part);

    // Register special organs
    if (part.organType === 'heart') {
      this._heart = part;
      this.circulatorySystem.setHeart(part);
    }
    if (part.organType === 'brain') this._brain = part;
    if (part.organType === 'lungs') this._lungs = part;
    if (part.organType === 'stomach') this._stomach = part;

    return part;
  }

  removePart(id) {
    const part = this.parts.get(id);
    if (!part) return;
    this._rigidWorld.removeBody(part.physicsBody);

    // Remove connected joints and muscles
    for (const [jid, joint] of this.joints) {
      if (joint.partA.id === id || joint.partB.id === id) this.removeJoint(jid);
    }
    for (const [mid, muscle] of this.muscles) {
      if (muscle.partA.id === id || muscle.partB.id === id) this.removeMuscle(mid);
    }

    if (part instanceof Eye) this._eyes = this._eyes.filter(e => e !== part);
    if (part instanceof Ear) this._ears = this._ears.filter(e => e !== part);
    if (this._heart === part) this._heart = null;
    if (this._brain === part) this._brain = null;

    part.dispose();
    this.parts.delete(id);
  }

  // --- Joint management ---

  addJoint(joint) {
    this.joints.set(joint.id, joint);
    this._rigidWorld.addConstraint(joint.constraint);
    joint.partA.addJoint?.(joint);
    joint.partB.addJoint?.(joint);
    return joint;
  }

  removeJoint(id) {
    const joint = this.joints.get(id);
    if (!joint) return;
    this._rigidWorld.removeConstraint(joint.constraint);
    joint.partA.removeJoint?.(joint);
    joint.partB.removeJoint?.(joint);
    joint.dispose();
    this.joints.delete(id);
  }

  // --- Muscle management ---

  addMuscle(muscle) {
    this.muscles.set(muscle.id, muscle);
    const group = muscle.controlGroup;
    if (!this.controlGroups.has(group)) this.controlGroups.set(group, new Set());
    this.controlGroups.get(group).add(muscle);
    return muscle;
  }

  removeMuscle(id) {
    const muscle = this.muscles.get(id);
    if (!muscle) return;
    const group = this.controlGroups.get(muscle.controlGroup);
    if (group) { group.delete(muscle); if (group.size === 0) this.controlGroups.delete(muscle.controlGroup); }
    muscle.dispose();
    this.muscles.delete(id);
  }

  // --- Activation control ---

  setActivation(groupName, value) {
    const group = this.controlGroups.get(groupName);
    if (!group) return;
    for (const muscle of group) muscle.activation = value;
  }

  setAllActivations(value) {
    for (const muscle of this.muscles.values()) muscle.activation = value;
  }

  // --- Per-frame update ---

  applyMuscleForces(dt) {
    for (const muscle of this.muscles.values()) {
      if (!muscle.type.includes('CARDIAC')) { // cardiac handles itself
        muscle.applyForces(dt);
      }
    }
  }

  update(dt) {
    // Update organs
    for (const part of this.parts.values()) {
      if (typeof part.update === 'function') part.update(dt);
    }

    // Update nervous system
    this.nervousSystem.update(dt);

    // Update circulatory system
    this.circulatorySystem.update(dt);

    // Aggregate O2 saturation from lungs
    if (this._lungs) {
      this._o2Saturation = 0.6 + 0.4 * this._lungs.o2Output * this._lungs.health;
    }

    // Stamina: driven by heart pressure, O2, and energy store
    const heartPressure = this._heart ? this._heart.pressure : 0.5;
    const energyAvail = this._stomach ? this._stomach.energyStore : 1.0;
    this._stamina = Math.min(1, this._o2Saturation * heartPressure * energyAvail);

    // Update joints (visual indicators)
    for (const joint of this.joints.values()) joint.update();

    // Update muscle visuals
    for (const muscle of this.muscles.values()) muscle.update(dt);
  }

  syncPhysics() {
    for (const part of this.parts.values()) {
      part.syncToPhysics();
    }
  }

  // --- Pose management ---

  saveInitialPose() {
    for (const part of this.parts.values()) part.saveInitialPose?.();
  }

  resetPose() {
    for (const part of this.parts.values()) part.resetPose?.();
    this.setAllActivations(0);
  }

  // --- Serialization ---

  serialize() {
    const parts = [...this.parts.values()].map(p => p.serialize());
    const joints = [...this.joints.values()].map(j => j.serialize());
    const muscles = [...this.muscles.values()].map(m => m.serialize());
    return JSON.stringify({
      parts, joints, muscles,
      nervousSystem: this.nervousSystem.serialize(),
      circulatorySystem: this.circulatorySystem.serialize(),
    });
  }

  deserialize(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;

    // Clear existing
    for (const id of [...this.parts.keys()]) this.removePart(id);

    // Rebuild parts
    for (const pd of (data.parts ?? [])) {
      let part;
      switch (pd.type) {
        case 'Eye':   part = Eye.deserialize(pd); break;
        case 'Ear':   part = Ear.deserialize(pd); break;
        case 'Bone':  part = Bone.deserialize(pd); break;
        case 'Organ':
        case 'Heart':
        case 'Lungs':
        case 'Brain':
        case 'Stomach': part = deserializeOrgan(pd); break;
        default: part = BodyPart.deserialize(pd);
      }
      if (part) this.addPart(part);
    }

    // Rebuild joints
    for (const jd of (data.joints ?? [])) {
      const joint = Joint.deserialize(jd, this.parts);
      if (joint) this.addJoint(joint);
    }

    // Rebuild muscles
    for (const md of (data.muscles ?? [])) {
      const muscle = Muscle.deserialize(md, this.parts);
      if (muscle) this.addMuscle(muscle);
    }

    // Rebuild systems
    if (data.nervousSystem) this.nervousSystem.deserialize(data.nervousSystem);
    if (data.circulatorySystem) this.circulatorySystem.deserialize(data.circulatorySystem, this.parts);
  }

  getBoundingBox() {
    const positions = [];
    for (const part of this.parts.values()) {
      positions.push(part.physicsBody.position);
    }
    if (positions.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of positions) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
  }
}
