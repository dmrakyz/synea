import * as THREE from 'three';

// Cage deformation: wraps a mesh in a low-poly control cage.
// Dragging cage vertices deforms the mesh via trilinear interpolation.

export class MeshDeformer {
  constructor(geometry, cageResolution = 3) {
    this._geometry = geometry;
    this._resolution = cageResolution;

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    this._bbMin = bb.min.clone();
    this._bbMax = bb.max.clone();
    this._bbSize = new THREE.Vector3().subVectors(this._bbMax, this._bbMin);

    // Build cage
    this._cage = this._buildCage();
    this._cageInitial = this._cage.map(v => v.clone());

    // Precompute per-vertex cage weights
    this._weights = this._computeWeights();

    // Store original positions
    const posAttr = geometry.attributes.position;
    this._originalPositions = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      this._originalPositions[i*3+0] = posAttr.getX(i);
      this._originalPositions[i*3+1] = posAttr.getY(i);
      this._originalPositions[i*3+2] = posAttr.getZ(i);
    }

    // Cage visual
    this._cageMesh = this._buildCageMesh();
    this._controlHandles = this._buildHandles();
  }

  get cageMesh() { return this._cageMesh; }
  get controlHandles() { return this._controlHandles; }
  get cageVertices() { return this._cage; }

  _buildCage() {
    const { x: sx, y: sy, z: sz } = this._bbSize;
    const { x: mx, y: my, z: mz } = this._bbMin;
    const r = this._resolution;
    const verts = [];
    for (let iz = 0; iz <= r; iz++) {
      for (let iy = 0; iy <= r; iy++) {
        for (let ix = 0; ix <= r; ix++) {
          verts.push(new THREE.Vector3(
            mx + (ix / r) * sx,
            my + (iy / r) * sy,
            mz + (iz / r) * sz,
          ));
        }
      }
    }
    return verts;
  }

  _cageIndex(ix, iy, iz) {
    const r = this._resolution;
    return ix + (r+1) * iy + (r+1) * (r+1) * iz;
  }

  _computeWeights() {
    const posAttr = this._geometry.attributes.position;
    const r = this._resolution;
    const weights = [];

    for (let vi = 0; vi < posAttr.count; vi++) {
      const px = posAttr.getX(vi), py = posAttr.getY(vi), pz = posAttr.getZ(vi);

      // Normalize to [0,1] in cage space
      const u = Math.max(0, Math.min(1, (px - this._bbMin.x) / this._bbSize.x));
      const v = Math.max(0, Math.min(1, (py - this._bbMin.y) / this._bbSize.y));
      const w = Math.max(0, Math.min(1, (pz - this._bbMin.z) / this._bbSize.z));

      // Find cage cell
      const ix = Math.min(Math.floor(u * r), r - 1);
      const iy = Math.min(Math.floor(v * r), r - 1);
      const iz = Math.min(Math.floor(w * r), r - 1);

      // Local coords within cell [0,1]
      const lu = u * r - ix;
      const lv = v * r - iy;
      const lw = w * r - iz;

      // 8 corners of the cell with trilinear weights
      const corners = [];
      for (let dz = 0; dz <= 1; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
          for (let dx = 0; dx <= 1; dx++) {
            const wx = dx === 0 ? (1-lu) : lu;
            const wy = dy === 0 ? (1-lv) : lv;
            const wz = dz === 0 ? (1-lw) : lw;
            corners.push({
              idx: this._cageIndex(ix+dx, iy+dy, iz+dz),
              w: wx * wy * wz,
            });
          }
        }
      }
      weights.push(corners);
    }
    return weights;
  }

  // Move a cage vertex and update mesh
  moveCageVertex(index, newPosition) {
    this._cage[index].copy(newPosition);
    this._updateMesh();
    this._updateCageMesh();
    this._updateHandles();
  }

  _updateMesh() {
    const posAttr = this._geometry.attributes.position;
    for (let vi = 0; vi < posAttr.count; vi++) {
      const origX = this._originalPositions[vi*3+0];
      const origY = this._originalPositions[vi*3+1];
      const origZ = this._originalPositions[vi*3+2];

      let dx = 0, dy = 0, dz = 0;
      for (const { idx, w } of this._weights[vi]) {
        const delta = this._cage[idx].clone().sub(this._cageInitial[idx]);
        dx += delta.x * w;
        dy += delta.y * w;
        dz += delta.z * w;
      }
      posAttr.setXYZ(vi, origX + dx, origY + dy, origZ + dz);
    }
    posAttr.needsUpdate = true;
    this._geometry.computeVertexNormals();
  }

  _buildCageMesh() {
    const r = this._resolution;
    const count = (r+1) * (r+1) * (r+1);
    const positions = new Float32Array(count * 3);
    const indices = [];

    for (let i = 0; i < this._cage.length; i++) {
      positions[i*3+0] = this._cage[i].x;
      positions[i*3+1] = this._cage[i].y;
      positions[i*3+2] = this._cage[i].z;
    }

    // Add edges
    for (let iz = 0; iz <= r; iz++) {
      for (let iy = 0; iy <= r; iy++) {
        for (let ix = 0; ix < r; ix++) {
          indices.push(this._cageIndex(ix, iy, iz), this._cageIndex(ix+1, iy, iz));
        }
      }
    }
    for (let iz = 0; iz <= r; iz++) {
      for (let ix = 0; ix <= r; ix++) {
        for (let iy = 0; iy < r; iy++) {
          indices.push(this._cageIndex(ix, iy, iz), this._cageIndex(ix, iy+1, iz));
        }
      }
    }
    for (let iy = 0; iy <= r; iy++) {
      for (let ix = 0; ix <= r; ix++) {
        for (let iz = 0; iz < r; iz++) {
          indices.push(this._cageIndex(ix, iy, iz), this._cageIndex(ix, iy, iz+1));
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);

    const mat = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.5 });
    return new THREE.LineSegments(geo, mat);
  }

  _updateCageMesh() {
    const posAttr = this._cageMesh.geometry.attributes.position;
    for (let i = 0; i < this._cage.length; i++) {
      posAttr.setXYZ(i, this._cage[i].x, this._cage[i].y, this._cage[i].z);
    }
    posAttr.needsUpdate = true;
  }

  _buildHandles() {
    const handles = [];
    const geo = new THREE.SphereGeometry(0.015, 8, 6);
    for (let i = 0; i < this._cage.length; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(this._cage[i]);
      mesh.userData.cageIndex = i;
      handles.push(mesh);
    }
    return handles;
  }

  _updateHandles() {
    for (let i = 0; i < this._controlHandles.length; i++) {
      this._controlHandles[i].position.copy(this._cage[i]);
    }
  }

  dispose() {
    this._cageMesh.geometry.dispose();
    this._cageMesh.material.dispose();
    for (const h of this._controlHandles) {
      h.geometry.dispose();
      h.material.dispose();
    }
  }
}
