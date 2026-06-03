import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { getMaterial } from './BioMaterials.js';

let _muscleCounter = 0;

const MUSCLE_TYPES = ['MUSCLE_SKELETAL', 'MUSCLE_CARDIAC', 'MUSCLE_SMOOTH', 'MUSCLE_SPHINCTER'];

export class Muscle {
  constructor({ id, partA, partB, anchorLocalA, anchorLocalB, type = 'MUSCLE_SKELETAL', controlGroup = 'default', name } = {}) {
    this._id = id ?? `muscle_${++_muscleCounter}`;
    this._name = name ?? 'Muscle';
    this._partA = partA;  // BodyPart
    this._partB = partB;  // BodyPart
    this._anchorLocalA = anchorLocalA ?? new THREE.Vector3();
    this._anchorLocalB = anchorLocalB ?? new THREE.Vector3();
    this._type = type;
    this._controlGroup = controlGroup;
    this._matDef = getMaterial(type);

    this._activation = 0;
    this._fatigue = 0;
    this._health = 1.0;

    // Compute initial natural length
    this._naturalLength = this._computeCurrentLength();

    // Visual
    this._lineGeo = new LineGeometry();
    this._lineMat = new LineMaterial({
      color: 0xcc4444,
      linewidth: 3,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    });
    this._line = new Line2(this._lineGeo, this._lineMat);
    this._line.userData.muscleId = this._id;
    this._updateVisual();

    // Cardiac muscles have autonomous rhythm
    if (this._matDef.autonomous) {
      this._phase = Math.random() * Math.PI * 2;
    }
  }

  get id() { return this._id; }
  get name() { return this._name; }
  set name(v) { this._name = v; }
  get type() { return this._type; }
  get controlGroup() { return this._controlGroup; }
  set controlGroup(v) { this._controlGroup = v; }
  get activation() { return this._activation; }
  get fatigue() { return this._fatigue; }
  get health() { return this._health; }
  get line() { return this._line; }
  get partA() { return this._partA; }
  get partB() { return this._partB; }
  get anchorLocalA() { return this._anchorLocalA; }
  get anchorLocalB() { return this._anchorLocalB; }

  set activation(v) {
    const maxSpeed = this._matDef.maxActivationSpeed ?? 1;
    this._activation = Math.max(0, Math.min(1, v));
  }

  _getWorldAnchor(part, localPos) {
    const body = part.physicsBody;
    const localCannon = new CANNON.Vec3(localPos.x, localPos.y, localPos.z);
    const worldPos = new CANNON.Vec3();
    body.pointToWorldFrame(localCannon, worldPos);
    return worldPos;
  }

  _computeCurrentLength() {
    if (!this._partA || !this._partB) return 1;
    const wA = this._getWorldAnchor(this._partA, this._anchorLocalA);
    const wB = this._getWorldAnchor(this._partB, this._anchorLocalB);
    return wA.distanceTo(wB);
  }

  applyForces(dt = 1/60) {
    if (this._health <= 0) return;

    // Autonomous cardiac rhythm
    let act = this._activation;
    if (this._matDef.autonomous && this._matDef.bpm) {
      this._phase += dt * (this._matDef.bpm / 60) * Math.PI * 2;
      act = Math.max(0, Math.sin(this._phase));
    }

    const effectiveAct = Math.max(act * (1 - this._fatigue * 0.5), 0.05); // passive tone 5%

    const matDef = this._matDef;
    const stiffness = matDef.stiffness ?? 800;
    const damping = matDef.damping ?? 12;
    const restFactor = matDef.restFactor ?? 1.0;
    const contractFactor = matDef.contractFactor ?? 0.65;

    const wA = this._getWorldAnchor(this._partA, this._anchorLocalA);
    const wB = this._getWorldAnchor(this._partB, this._anchorLocalB);

    const rVec = new CANNON.Vec3();
    wB.vsub(wA, rVec);
    const currentLength = rVec.length();
    if (currentLength < 1e-6) return;

    const restLength = this._naturalLength * (restFactor + (contractFactor - restFactor) * act);

    const rUnit = rVec.scale(1 / currentLength);
    const vA = this._partA.physicsBody.velocity;
    const vB = this._partB.physicsBody.velocity;
    const relVel = vB.dot(rUnit) - vA.dot(rUnit);

    const extension = currentLength - restLength;
    const forceMag = (stiffness * extension + damping * relVel) * effectiveAct;
    const force = rUnit.scale(forceMag);

    // Offset from body CoM for torque generation
    const offA = new CANNON.Vec3();
    wA.vsub(this._partA.physicsBody.position, offA);
    const offB = new CANNON.Vec3();
    wB.vsub(this._partB.physicsBody.position, offB);

    this._partA.physicsBody.applyForce(force, offA);
    const negForce = force.scale(-1);
    this._partB.physicsBody.applyForce(negForce, offB);

    // Fatigue accumulation for skeletal muscles
    if (this._type === 'MUSCLE_SKELETAL' && act > 0.1) {
      this._fatigue = Math.min(1, this._fatigue + act * (matDef.fatigueRate ?? 0.001) * dt);
    } else {
      this._fatigue = Math.max(0, this._fatigue - (matDef.healRate ?? 0.01) * dt);
    }
  }

  _updateVisual() {
    if (!this._partA || !this._partB) return;
    const wA = this._getWorldAnchor(this._partA, this._anchorLocalA);
    const wB = this._getWorldAnchor(this._partB, this._anchorLocalB);
    this._lineGeo.setPositions([wA.x, wA.y, wA.z, wB.x, wB.y, wB.z]);
    this._line.computeLineDistances();

    // Color: blue (relaxed) → red (contracted)
    const t = this._activation;
    const r = Math.round(68 + t * 187);
    const g = Math.round(68 - t * 68);
    const b = Math.round(170 - t * 170);
    this._lineMat.color.setRGB(r/255, g/255, b/255);
  }

  update(dt) {
    this._updateVisual();
    if (this._matDef.autonomous) {
      this.applyForces(dt);
    }
  }

  dispose() {
    this._lineGeo.dispose();
    this._lineMat.dispose();
  }

  serialize() {
    return {
      id: this._id,
      name: this._name,
      type: this._type,
      controlGroup: this._controlGroup,
      partAId: this._partA?.id,
      partBId: this._partB?.id,
      anchorLocalA: { x: this._anchorLocalA.x, y: this._anchorLocalA.y, z: this._anchorLocalA.z },
      anchorLocalB: { x: this._anchorLocalB.x, y: this._anchorLocalB.y, z: this._anchorLocalB.z },
      naturalLength: this._naturalLength,
    };
  }

  static deserialize(data, partsMap) {
    const partA = partsMap.get(data.partAId);
    const partB = partsMap.get(data.partBId);
    if (!partA || !partB) return null;

    const m = new Muscle({
      id: data.id,
      name: data.name,
      partA, partB,
      anchorLocalA: new THREE.Vector3(data.anchorLocalA.x, data.anchorLocalA.y, data.anchorLocalA.z),
      anchorLocalB: new THREE.Vector3(data.anchorLocalB.x, data.anchorLocalB.y, data.anchorLocalB.z),
      type: data.type,
      controlGroup: data.controlGroup,
    });
    if (data.naturalLength) m._naturalLength = data.naturalLength;
    return m;
  }
}
