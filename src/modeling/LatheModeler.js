import * as THREE from 'three';

// Creates 3D solids of revolution by rotating a 2D profile around the Y axis.
// Profile points are in the XY plane (x = radius, y = height).
// Used for: torso, head, bulbs, horns, egg shapes, symmetric body segments.

export class LatheModeler {
  constructor() {
    this._points = [];          // [{x, y}] in profile space (x>=0)
    this._segments = 24;        // radial segments
    this._phiStart = 0;
    this._phiLength = Math.PI * 2;
  }

  get points() { return this._points; }
  get segments() { return this._segments; }
  set segments(v) { this._segments = Math.max(6, Math.min(64, v)); }

  addPoint(x, y) {
    // Enforce x >= 0 (lathe requires non-negative radius)
    this._points.push({ x: Math.abs(x), y });
    this._sort();
  }

  removePoint(index) {
    this._points.splice(index, 1);
  }

  movePoint(index, x, y) {
    if (index < 0 || index >= this._points.length) return;
    this._points[index] = { x: Math.abs(x), y };
    this._sort();
  }

  // Sort by Y so profile goes from bottom to top
  _sort() {
    this._points.sort((a, b) => a.y - b.y);
  }

  // Build THREE.LatheGeometry from current profile points
  build() {
    if (this._points.length < 2) return null;

    const threePoints = this._points.map(p => new THREE.Vector2(p.x, p.y));
    const geo = new THREE.LatheGeometry(threePoints, this._segments, this._phiStart, this._phiLength);
    geo.computeVertexNormals();

    return geo;
  }

  // Build a preview mesh (semi-transparent) for the builder viewport
  buildPreview() {
    const geo = this.build();
    if (!geo) return null;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x88aaff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    return new THREE.Mesh(geo, mat);
  }

  // Default profile presets
  static capsuleProfile(radius, height, steps = 8) {
    const m = new LatheModeler();
    const r = radius, h = height;
    // Bottom hemisphere
    for (let i = 0; i <= steps / 2; i++) {
      const angle = -Math.PI / 2 + (Math.PI / 2) * (i / (steps / 2));
      m.addPoint(r * Math.cos(angle), -h/2 + r * Math.sin(angle) + r);
    }
    // Cylinder section
    m.addPoint(r, h / 2 - r);
    // Top hemisphere
    for (let i = 0; i <= steps / 2; i++) {
      const angle = (Math.PI / 2) * (i / (steps / 2));
      m.addPoint(r * Math.cos(angle), h/2 - r + r * Math.sin(angle));
    }
    return m;
  }

  static torsoProfile(r = 0.2, h = 0.5) {
    const m = new LatheModeler();
    // Slightly hour-glass shape
    const pts = [
      [r * 0.6, 0],
      [r * 0.85, h * 0.15],
      [r, h * 0.4],
      [r * 0.7, h * 0.6],  // waist
      [r * 0.9, h * 0.8],
      [r * 0.7, h],
    ];
    for (const [x, y] of pts) m.addPoint(x, y);
    return m;
  }

  static headProfile(r = 0.15, h = 0.25) {
    const m = new LatheModeler();
    const pts = [
      [r * 0.3, 0],       // neck
      [r * 0.7, h * 0.1],
      [r, h * 0.35],       // widest part
      [r * 0.95, h * 0.6],
      [r * 0.8, h * 0.8],
      [r * 0.4, h],        // top of skull
    ];
    for (const [x, y] of pts) m.addPoint(x, y);
    return m;
  }

  static finProfile(length = 0.3, maxWidth = 0.08) {
    const m = new LatheModeler();
    // Triangle-like fin when viewed from the side
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const w = maxWidth * Math.sin(t * Math.PI);
      m.addPoint(w, t * length);
    }
    return m;
  }

  serialize() {
    return { points: this._points.slice(), segments: this._segments };
  }

  static deserialize(data) {
    const m = new LatheModeler();
    m._points = data.points ?? [];
    m._segments = data.segments ?? 24;
    return m;
  }
}
