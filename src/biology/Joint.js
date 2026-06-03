import * as THREE from 'three';
import * as CANNON from 'cannon-es';

let _jointCounter = 0;

export const JOINT_TYPES = {
  HINGE: 'hinge',
  CONE: 'cone',
  FIXED: 'fixed',
  BALL: 'ball',
};

export class Joint {
  constructor({ id, partA, partB, type = JOINT_TYPES.HINGE, pivotA, pivotB, axisA, axisB, limits } = {}) {
    this._id = id ?? `joint_${++_jointCounter}`;
    this._partA = partA;
    this._partB = partB;
    this._type = type;
    this._limits = limits ?? { low: -Math.PI / 2, high: Math.PI / 2, twist: Math.PI / 4 };

    // Pivot points in local space of each body
    this._pivotA = pivotA ? new CANNON.Vec3(pivotA.x, pivotA.y, pivotA.z) : new CANNON.Vec3();
    this._pivotB = pivotB ? new CANNON.Vec3(pivotB.x, pivotB.y, pivotB.z) : new CANNON.Vec3();

    // Axes in local space
    this._axisA = axisA ? new CANNON.Vec3(axisA.x, axisA.y, axisA.z) : new CANNON.Vec3(0, 1, 0);
    this._axisB = axisB ? new CANNON.Vec3(axisB.x, axisB.y, axisB.z) : new CANNON.Vec3(0, 1, 0);

    this._constraint = this._buildConstraint();

    // Visual indicator (small wireframe sphere at pivot)
    this._indicator = this._buildIndicator();
  }

  get id() { return this._id; }
  get type() { return this._type; }
  get constraint() { return this._constraint; }
  get indicator() { return this._indicator; }
  get partA() { return this._partA; }
  get partB() { return this._partB; }
  get limits() { return this._limits; }

  _buildConstraint() {
    const bA = this._partA.physicsBody;
    const bB = this._partB.physicsBody;

    switch (this._type) {
      case JOINT_TYPES.HINGE: {
        const c = new CANNON.HingeConstraint(bA, bB, {
          pivotA: this._pivotA,
          pivotB: this._pivotB,
          axisA: this._axisA,
          axisB: this._axisB,
        });
        c.collideConnected = false;
        if (this._limits) {
          c.enableMotor();
          c.setMotorSpeed(0);
          c.setMotorMaxForce(0);
        }
        return c;
      }

      case JOINT_TYPES.CONE: {
        const c = new CANNON.ConeTwistConstraint(bA, bB, {
          pivotA: this._pivotA,
          pivotB: this._pivotB,
          axisA: this._axisA,
          axisB: this._axisB,
          angle: this._limits.high ?? Math.PI / 4,
          twistAngle: this._limits.twist ?? Math.PI / 8,
        });
        c.collideConnected = false;
        return c;
      }

      case JOINT_TYPES.BALL: {
        const c = new CANNON.PointToPointConstraint(bA, this._pivotA, bB, this._pivotB);
        c.collideConnected = false;
        return c;
      }

      case JOINT_TYPES.FIXED:
      default: {
        const c = new CANNON.LockConstraint(bA, bB);
        c.collideConnected = false;
        return c;
      }
    }
  }

  _buildIndicator() {
    const geo = new THREE.SphereGeometry(0.04, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true, transparent: true, opacity: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.jointId = this._id;
    this._updateIndicatorPos();
    return mesh;
  }

  _updateIndicatorPos() {
    if (!this._indicator) return;
    // World position of pivot A
    const worldPivot = new CANNON.Vec3();
    this._partA.physicsBody.pointToWorldFrame(this._pivotA, worldPivot);
    this._indicator.position.set(worldPivot.x, worldPivot.y, worldPivot.z);
  }

  setLimits(limits) {
    this._limits = { ...this._limits, ...limits };
    // Re-building constraint is needed for limit changes — handled by Character
  }

  setMotorTarget(angle, maxForce = 10) {
    if (this._type === JOINT_TYPES.HINGE && this._constraint.enableMotor) {
      this._constraint.setMotorSpeed(angle);
      this._constraint.setMotorMaxForce(maxForce);
    }
  }

  update() {
    this._updateIndicatorPos();
  }

  dispose() {
    this._indicator.geometry.dispose();
    this._indicator.material.dispose();
  }

  serialize() {
    return {
      id: this._id,
      type: this._type,
      partAId: this._partA?.id,
      partBId: this._partB?.id,
      pivotA: { x: this._pivotA.x, y: this._pivotA.y, z: this._pivotA.z },
      pivotB: { x: this._pivotB.x, y: this._pivotB.y, z: this._pivotB.z },
      axisA: { x: this._axisA.x, y: this._axisA.y, z: this._axisA.z },
      axisB: { x: this._axisB.x, y: this._axisB.y, z: this._axisB.z },
      limits: this._limits,
    };
  }

  static deserialize(data, partsMap) {
    const partA = partsMap.get(data.partAId);
    const partB = partsMap.get(data.partBId);
    if (!partA || !partB) return null;

    return new Joint({
      id: data.id,
      partA, partB,
      type: data.type,
      pivotA: data.pivotA,
      pivotB: data.pivotB,
      axisA: data.axisA,
      axisB: data.axisB,
      limits: data.limits,
    });
  }
}
