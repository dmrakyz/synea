import * as CANNON from 'cannon-es';
import * as THREE from 'three';

// Spring-mass soft body simulation.
// Creates a lattice of CANNON particle bodies linked by spring constraints.
// The visual THREE.Mesh is skinned to the nearest particles.

class Spring {
  constructor(bodyA, bodyB, restLength, stiffness, damping) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    this.restLength = restLength;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  applyForce() {
    const rVec = new CANNON.Vec3();
    this.bodyB.position.vsub(this.bodyA.position, rVec);
    const len = rVec.length();
    if (len < 1e-6) return;

    const rUnit = rVec.scale(1 / len);
    const relVelA = this.bodyA.velocity.dot(rUnit);
    const relVelB = this.bodyB.velocity.dot(rUnit);
    const relVel = relVelB - relVelA;

    const extension = len - this.restLength;
    const forceMag = this.stiffness * extension + this.damping * relVel;
    const force = rUnit.scale(forceMag);

    this.bodyA.applyForce(force, new CANNON.Vec3(0, 0, 0));
    this.bodyB.applyForce(force.negate(), new CANNON.Vec3(0, 0, 0));
  }
}

export class SoftBody {
  constructor({ geometry, mass, stiffness = 300, damping = 5, resolution = 3 }) {
    this._mesh = null;
    this._stiffness = stiffness;
    this._damping = damping;
    this._particles = [];
    this._springs = [];
    this._skinWeights = []; // per-vertex: [{particleIndex, weight}]

    this._buildLattice(geometry, mass, resolution);
    this._buildSkinWeights(geometry);
  }

  _buildLattice(geometry, totalMass, resolution) {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);
    const center = new THREE.Vector3();
    bb.getCenter(center);

    const nx = Math.max(resolution, 2);
    const ny = Math.max(resolution, 2);
    const nz = Math.max(resolution, 2);
    const massPerParticle = totalMass / (nx * ny * nz);

    this._grid = { nx, ny, nz };
    const idx = (ix, iy, iz) => ix + nx * iy + nx * ny * iz;

    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const x = center.x + (ix / (nx-1) - 0.5) * size.x;
          const y = bb.min.y + (iy / (ny-1)) * size.y;
          const z = center.z + (iz / (nz-1) - 0.5) * size.z;

          const body = new CANNON.Body({
            mass: massPerParticle,
            shape: new CANNON.Sphere(0.02),
            position: new CANNON.Vec3(x, y, z),
            linearDamping: 0.1,
            angularDamping: 0.9,
          });
          body.collisionFilterMask = 0; // soft body particles don't collide with each other
          this._particles.push(body);
        }
      }
    }

    // Create springs between adjacent particles
    const addSpring = (a, b) => {
      const pa = this._particles[a].position;
      const pb = this._particles[b].position;
      const rest = pa.distanceTo(pb);
      this._springs.push(new Spring(this._particles[a], this._particles[b], rest, this._stiffness, this._damping));
    };

    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const i = idx(ix, iy, iz);
          if (ix+1 < nx) addSpring(i, idx(ix+1, iy, iz));
          if (iy+1 < ny) addSpring(i, idx(ix, iy+1, iz));
          if (iz+1 < nz) addSpring(i, idx(ix, iy, iz+1));
          // Shear springs
          if (ix+1 < nx && iy+1 < ny) addSpring(i, idx(ix+1, iy+1, iz));
          if (ix+1 < nx && iz+1 < nz) addSpring(i, idx(ix+1, iy, iz+1));
          if (iy+1 < ny && iz+1 < nz) addSpring(i, idx(ix, iy+1, iz+1));
        }
      }
    }
  }

  _buildSkinWeights(geometry) {
    const posAttr = geometry.attributes.position;
    const maxWeights = 4;

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i), vy = posAttr.getY(i), vz = posAttr.getZ(i);
      const dists = this._particles.map((p, idx) => ({
        idx,
        d: Math.sqrt((p.position.x-vx)**2 + (p.position.y-vy)**2 + (p.position.z-vz)**2),
      }));
      dists.sort((a, b) => a.d - b.d);

      const top = dists.slice(0, maxWeights);
      const totalInv = top.reduce((s, e) => s + (1 / (e.d + 1e-6)), 0);
      this._skinWeights.push(top.map(e => ({ idx: e.idx, w: (1 / (e.d + 1e-6)) / totalInv })));
    }
  }

  get particles() { return this._particles; }
  get springs() { return this._springs; }

  setMesh(mesh) { this._mesh = mesh; }

  addToWorld(rigidWorld) {
    for (const p of this._particles) rigidWorld.addBody(p);
  }

  removeFromWorld(rigidWorld) {
    for (const p of this._particles) rigidWorld.removeBody(p);
  }

  applyForces() {
    for (const s of this._springs) s.applyForce();
  }

  syncMesh() {
    if (!this._mesh) return;
    const posAttr = this._mesh.geometry.attributes.position;
    const worldInvMat = new THREE.Matrix4().copy(this._mesh.matrixWorld).invert();

    for (let i = 0; i < posAttr.count; i++) {
      const weights = this._skinWeights[i];
      let wx = 0, wy = 0, wz = 0;
      for (const { idx, w } of weights) {
        const p = this._particles[idx].position;
        wx += p.x * w; wy += p.y * w; wz += p.z * w;
      }
      // Transform from world to local mesh space
      const worldPos = new THREE.Vector3(wx, wy, wz).applyMatrix4(worldInvMat);
      posAttr.setXYZ(i, worldPos.x, worldPos.y, worldPos.z);
    }
    posAttr.needsUpdate = true;
    this._mesh.geometry.computeVertexNormals();
  }

  setPosition(worldPos) {
    const offset = new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z);
    // Compute centroid of particles
    const centroid = new CANNON.Vec3();
    for (const p of this._particles) centroid.vadd(p.position, centroid);
    centroid.scale(1 / this._particles.length, centroid);
    const delta = offset.vsub(centroid);
    for (const p of this._particles) {
      p.position.vadd(delta, p.position);
      p.velocity.set(0, 0, 0);
    }
  }
}
