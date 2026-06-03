import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { getMaterial } from './BioMaterials.js';
import { geometryToConvexPolyhedron } from '../modeling/ConvexHull.js';

let _idCounter = 0;
function genId(prefix = 'part') { return `${prefix}_${++_idCounter}_${Date.now().toString(36)}`; }

export class BodyPart {
  constructor({ id, geometry, materialId, position, quaternion, name, mass } = {}) {
    this._id = id ?? genId();
    this._name = name ?? 'Body Part';
    this._materialDef = getMaterial(materialId ?? 'BONE');
    this._materialId = materialId ?? 'BONE';

    // Three.js visual
    this._geometry = geometry ?? new THREE.SphereGeometry(0.2, 16, 12);
    this._threeMat = new THREE.MeshStandardMaterial({
      color: this._materialDef.color,
      roughness: this._materialDef.roughness ?? 0.7,
      metalness: this._materialDef.metalness ?? 0.05,
      envMapIntensity: 1.4,
    });
    this._mesh = new THREE.Mesh(this._geometry, this._threeMat);
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = true;
    this._mesh.userData.bodyPartId = this._id;

    // Compute mass from volume if not provided
    if (mass === undefined) {
      this._geometry.computeBoundingBox();
      const bb = this._geometry.boundingBox;
      const vol = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z);
      mass = Math.max(0.1, vol * this._materialDef.density);
    }
    this._mass = mass;

    // CANNON physics body
    let shape = geometryToConvexPolyhedron(this._geometry);
    if (!shape) {
      const bb = this._geometry.boundingBox ?? (() => { this._geometry.computeBoundingBox(); return this._geometry.boundingBox; })();
      shape = new CANNON.Box(new CANNON.Vec3(
        Math.max((bb.max.x - bb.min.x) / 2, 0.05),
        Math.max((bb.max.y - bb.min.y) / 2, 0.05),
        Math.max((bb.max.z - bb.min.z) / 2, 0.05),
      ));
    }

    this._body = new CANNON.Body({
      mass: this._mass,
      shape,
      linearDamping: 0.05,
      angularDamping: 0.1,
    });

    if (position) this._body.position.set(position.x, position.y, position.z);
    if (quaternion) this._body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

    // Sync mesh to initial position
    this._syncMeshToBody();

    // Attachment points (local positions for joint/muscle anchors)
    this._attachmentPoints = this._generateAttachmentPoints();

    // State
    this._selected = false;
    this._highlighted = false;
    this._health = 1.0;

    // Save initial pose for reset
    this._initPosition = this._body.position.clone();
    this._initQuaternion = this._body.quaternion.clone();
  }

  get id() { return this._id; }
  get name() { return this._name; }
  set name(v) { this._name = v; }
  get mesh() { return this._mesh; }
  get physicsBody() { return this._body; }
  get materialDef() { return this._materialDef; }
  get materialId() { return this._materialId; }
  get mass() { return this._mass; }
  get health() { return this._health; }
  get attachmentPoints() { return this._attachmentPoints; }

  setMaterial(materialId) {
    this._materialId = materialId;
    this._materialDef = getMaterial(materialId);
    this._threeMat.color.setHex(this._materialDef.color);
  }

  setSelected(v) {
    this._selected = v;
    this._updateEmissive();
  }

  setHighlighted(v) {
    this._highlighted = v;
    this._updateEmissive();
  }

  _updateEmissive() {
    if (this._selected) {
      this._threeMat.emissive.setHex(0xffaa00);
      this._threeMat.emissiveIntensity = 0.4;
    } else if (this._highlighted) {
      this._threeMat.emissive.setHex(0x88aaff);
      this._threeMat.emissiveIntensity = 0.25;
    } else {
      this._threeMat.emissive.setHex(0x000000);
      this._threeMat.emissiveIntensity = 0;
    }
  }

  _generateAttachmentPoints() {
    this._geometry.computeBoundingBox();
    const bb = this._geometry.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const hx = (bb.max.x - bb.min.x) / 2;
    const hy = (bb.max.y - bb.min.y) / 2;
    const hz = (bb.max.z - bb.min.z) / 2;

    return [
      { id: 'top',    local: new THREE.Vector3(cx, bb.max.y, cz) },
      { id: 'bottom', local: new THREE.Vector3(cx, bb.min.y, cz) },
      { id: 'front',  local: new THREE.Vector3(cx, cy, bb.max.z) },
      { id: 'back',   local: new THREE.Vector3(cx, cy, bb.min.z) },
      { id: 'left',   local: new THREE.Vector3(bb.min.x, cy, cz) },
      { id: 'right',  local: new THREE.Vector3(bb.max.x, cy, cz) },
      { id: 'center', local: new THREE.Vector3(cx, cy, cz) },
    ];
  }

  // Get world position of an attachment point
  getAttachmentWorldPos(localPos) {
    const v = localPos.clone();
    return v.applyMatrix4(this._mesh.matrixWorld);
  }

  syncToPhysics() {
    this._syncMeshToBody();
  }

  _syncMeshToBody() {
    this._mesh.position.copy(this._body.position);
    this._mesh.quaternion.copy(this._body.quaternion);
  }

  resetPose() {
    this._body.position.copy(this._initPosition);
    this._body.quaternion.copy(this._initQuaternion);
    this._body.velocity.set(0, 0, 0);
    this._body.angularVelocity.set(0, 0, 0);
    this._body.force.set(0, 0, 0);
    this._body.torque.set(0, 0, 0);
    this._syncMeshToBody();
  }

  saveInitialPose() {
    this._initPosition = this._body.position.clone();
    this._initQuaternion = this._body.quaternion.clone();
  }

  takeDamage(amount) {
    this._health = Math.max(0, this._health - amount);
  }

  dispose() {
    this._geometry.dispose();
    this._threeMat.dispose();
  }

  serialize() {
    return {
      id: this._id,
      name: this._name,
      materialId: this._materialId,
      mass: this._mass,
      position: { x: this._body.position.x, y: this._body.position.y, z: this._body.position.z },
      quaternion: { x: this._body.quaternion.x, y: this._body.quaternion.y, z: this._body.quaternion.z, w: this._body.quaternion.w },
      geometryData: this._serializeGeometry(),
      type: 'BodyPart',
    };
  }

  _serializeGeometry() {
    // Store bounding box dimensions for reconstruction
    this._geometry.computeBoundingBox();
    const bb = this._geometry.boundingBox;
    return {
      type: 'boundingBox',
      min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
      max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
    };
  }

  static deserialize(data) {
    let geometry;
    if (data.geometryData?.type === 'boundingBox') {
      const { min, max } = data.geometryData;
      const w = max.x - min.x, h = max.y - min.y, d = max.z - min.z;
      const maxDim = Math.max(w, h, d);
      const minDim = Math.min(w, h, d);
      const elongation = h / Math.max(w, d);

      if (elongation > 1.8) {
        // Limb / tail segment: capsule along Y
        const r = Math.min(w, d) / 2;
        const cylLen = Math.max(h - 2 * r, 0);
        geometry = new THREE.CapsuleGeometry(r, cylLen, 6, 16);
      } else if (minDim / maxDim > 0.62) {
        // Roughly cubic / spherical: head, organs
        geometry = new THREE.SphereGeometry(maxDim / 2, 20, 14);
      } else {
        // Flat or boxy: torso, fins, plates
        geometry = new THREE.BoxGeometry(w, h, d);
      }
    } else {
      geometry = new THREE.SphereGeometry(0.2, 16, 12);
    }

    const part = new BodyPart({
      id: data.id,
      name: data.name,
      geometry,
      materialId: data.materialId,
      mass: data.mass,
      position: data.position,
      quaternion: data.quaternion,
    });
    return part;
  }
}
