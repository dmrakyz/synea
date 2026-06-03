import * as THREE from 'three';

// Creates 3D shapes by extruding a cross-section along a 3D Catmull-Rom spline path.
// Used for: limbs, tails, tentacles, spines, tongues, antennae.
// Cross-section: a 2D shape (circle, oval, irregular polygon)
// Path: array of 3D control points forming a Catmull-Rom spline

export class ExtrudeModeler {
  constructor() {
    this._pathPoints = [];    // THREE.Vector3[]
    this._crossSection = ExtrudeModeler.circleCrossSection(0.05, 8);
    this._pathSegments = 24;  // subdivisions along path
    this._taper = 1.0;        // scale factor at end (1.0 = no taper, 0.1 = tapers to thin point)
    this._twist = 0;          // total twist in radians along path
  }

  get pathPoints() { return this._pathPoints; }
  get crossSection() { return this._crossSection; }
  set crossSection(cs) { this._crossSection = cs; }
  set taper(v) { this._taper = Math.max(0.01, v); }
  get taper() { return this._taper; }
  set twist(v) { this._twist = v; }
  get twist() { return this._twist; }

  addPathPoint(v3) { this._pathPoints.push(v3.clone()); }
  removePathPoint(index) { this._pathPoints.splice(index, 1); }
  movePathPoint(index, v3) {
    if (index >= 0 && index < this._pathPoints.length) this._pathPoints[index].copy(v3);
  }

  // Build geometry
  build() {
    if (this._pathPoints.length < 2) return null;

    const curve = new THREE.CatmullRomCurve3(this._pathPoints, false, 'catmullrom', 0.5);
    const tubePoints = curve.getPoints(this._pathSegments);

    const crossPts = this._crossSection; // [{x, y}]
    const csCount = crossPts.length;
    const ringCount = tubePoints.length;

    const positions = new Float32Array(ringCount * csCount * 3);
    const normals = new Float32Array(ringCount * csCount * 3);
    const uvs = new Float32Array(ringCount * csCount * 2);

    const frames = curve.computeFrenetFrames(this._pathSegments, false);

    for (let ri = 0; ri < ringCount; ri++) {
      const t = ri / (ringCount - 1);
      const scale = 1 + (this._taper - 1) * t;
      const twistAngle = this._twist * t;
      const cosT = Math.cos(twistAngle), sinT = Math.sin(twistAngle);

      const P = tubePoints[ri];
      const N = frames.normals[ri];
      const B = frames.binormals[ri];

      for (let ci = 0; ci < csCount; ci++) {
        const { x: cx, y: cy } = crossPts[ci];
        // Apply twist
        const rx = cx * cosT - cy * sinT;
        const ry = cx * sinT + cy * cosT;
        const wx = rx * scale;
        const wy = ry * scale;

        const idx = ri * csCount + ci;
        positions[idx * 3 + 0] = P.x + N.x * wx + B.x * wy;
        positions[idx * 3 + 1] = P.y + N.y * wx + B.y * wy;
        positions[idx * 3 + 2] = P.z + N.z * wx + B.z * wy;

        // Normal = radial direction
        normals[idx * 3 + 0] = N.x * rx + B.x * ry;
        normals[idx * 3 + 1] = N.y * rx + B.y * ry;
        normals[idx * 3 + 2] = N.z * rx + B.z * ry;

        uvs[idx * 2 + 0] = ci / (csCount - 1);
        uvs[idx * 2 + 1] = t;
      }
    }

    // Build index buffer (quads → 2 triangles)
    const indices = [];
    for (let ri = 0; ri < ringCount - 1; ri++) {
      for (let ci = 0; ci < csCount; ci++) {
        const a = ri * csCount + ci;
        const b = ri * csCount + (ci + 1) % csCount;
        const c = (ri + 1) * csCount + (ci + 1) % csCount;
        const d = (ri + 1) * csCount + ci;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    // End caps
    const startCap = ringCount * csCount;
    const endCap = ringCount * csCount + 1;
    // (Simplified: just use center of each ring)

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return geo;
  }

  buildPreview() {
    const geo = this.build();
    if (!geo) return null;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xaaffaa,
      transparent: true, opacity: 0.5,
      side: THREE.DoubleSide, roughness: 0.8,
    });
    return new THREE.Mesh(geo, mat);
  }

  // Cross-section helpers
  static circleCrossSection(radius = 0.05, segments = 8) {
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
    }
    return pts;
  }

  static ovalCrossSection(rx = 0.08, ry = 0.04, segments = 8) {
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) });
    }
    return pts;
  }

  static triangleCrossSection(r = 0.05) {
    return [
      { x: r, y: 0 },
      { x: -r / 2, y: r * 0.866 },
      { x: -r / 2, y: -r * 0.866 },
    ];
  }

  // Presets
  static tail(length = 0.8, baseRadius = 0.06, tipRadius = 0.01) {
    const em = new ExtrudeModeler();
    em._crossSection = ExtrudeModeler.circleCrossSection(baseRadius, 8);
    em._taper = tipRadius / baseRadius;
    em._pathSegments = 32;
    for (let i = 0; i <= 5; i++) {
      em.addPathPoint(new THREE.Vector3(0, -i * length / 5, 0));
    }
    return em;
  }

  static limb(length = 0.4, radius = 0.04) {
    const em = new ExtrudeModeler();
    em._crossSection = ExtrudeModeler.circleCrossSection(radius, 8);
    em._taper = 0.7;
    em._pathSegments = 16;
    em.addPathPoint(new THREE.Vector3(0, 0, 0));
    em.addPathPoint(new THREE.Vector3(0, -length / 2, 0));
    em.addPathPoint(new THREE.Vector3(0, -length, 0));
    return em;
  }

  serialize() {
    return {
      pathPoints: this._pathPoints.map(p => ({ x: p.x, y: p.y, z: p.z })),
      crossSection: this._crossSection,
      pathSegments: this._pathSegments,
      taper: this._taper,
      twist: this._twist,
    };
  }

  static deserialize(data) {
    const em = new ExtrudeModeler();
    em._pathPoints = (data.pathPoints ?? []).map(p => new THREE.Vector3(p.x, p.y, p.z));
    em._crossSection = data.crossSection ?? ExtrudeModeler.circleCrossSection(0.05, 8);
    em._pathSegments = data.pathSegments ?? 24;
    em._taper = data.taper ?? 1.0;
    em._twist = data.twist ?? 0;
    return em;
  }
}
