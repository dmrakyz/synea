import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BodyPart } from './BodyPart.js';
import { geometryToConvexPolyhedron } from '../modeling/ConvexHull.js';

export class Bone extends BodyPart {
  constructor(options = {}) {
    super({ ...options, materialId: options.materialId ?? 'BONE' });
    this._isRigid = true;
    this._marrowBloodRate = options.marrowBloodRate ?? 0.01; // blood cells/sec
    this._joints = new Set(); // Joint objects connected to this bone
  }

  get isRigid() { return true; }
  get marrowBloodRate() { return this._marrowBloodRate; }
  get connectedJoints() { return this._joints; }

  addJoint(joint) { this._joints.add(joint); }
  removeJoint(joint) { this._joints.delete(joint); }

  serialize() {
    return { ...super.serialize(), type: 'Bone', marrowBloodRate: this._marrowBloodRate };
  }

  static deserialize(data) {
    const part = new Bone({
      id: data.id,
      name: data.name,
      materialId: data.materialId ?? 'BONE',
      mass: data.mass,
      position: data.position,
      quaternion: data.quaternion,
      marrowBloodRate: data.marrowBloodRate ?? 0.01,
    });
    // Restore geometry from stored data
    if (data.geometryData?.type === 'lathe') {
      // Will be reconstructed by LatheModeler
    } else if (data.geometryData?.type === 'boundingBox') {
      const { min, max } = data.geometryData;
      const w = max.x - min.x, h = max.y - min.y, d = max.z - min.z;
      part._geometry.dispose();
      part._geometry = new THREE.BoxGeometry(w, h, d);
      part._mesh.geometry = part._geometry;
    }
    return part;
  }
}

// Factory helpers for common bone shapes
export function createCapsuleBone({ radius = 0.1, height = 0.5, position, name, materialId }) {
  const geometry = new THREE.CapsuleGeometry(radius, height - 2 * radius, 4, 8);
  geometry.computeBoundingBox();

  // CANNON capsule approximation: cylinder + 2 spheres
  const body = new CANNON.Body({ mass: 0 }); // mass set by BodyPart
  const cyl = new CANNON.Cylinder(radius, radius, height - 2 * radius, 8);
  body.addShape(cyl);
  body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(0, (height - 2 * radius) / 2, 0));
  body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(0, -(height - 2 * radius) / 2, 0));

  const bone = new Bone({ name, materialId, geometry, position });
  // Override physics body with compound capsule
  bone._body.shapes = body.shapes;
  bone._body.shapeOffsets = body.shapeOffsets;
  bone._body.shapeOrientations = body.shapeOrientations;

  return bone;
}

export function createBoxBone({ w = 0.2, h = 0.3, d = 0.2, position, name, materialId }) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  return new Bone({ name, materialId, geometry, position });
}

export function createSphereBone({ radius = 0.15, position, name, materialId }) {
  const geometry = new THREE.SphereGeometry(radius, 16, 12);
  return new Bone({ name, materialId, geometry, position });
}
