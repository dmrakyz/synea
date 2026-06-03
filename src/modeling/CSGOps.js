import * as THREE from 'three';

// BSP-based Constructive Solid Geometry for THREE.BufferGeometry.
// Supports: union, subtract, intersect.
// Based on the algorithm by Evan Wallace (madebyevan.com/csg).

// --- Polygon / Vertex primitives ---

class CSGVertex {
  constructor(pos, normal, uv) {
    this.pos = pos.clone();
    this.normal = normal ? normal.clone() : new THREE.Vector3();
    this.uv = uv ? uv.clone() : new THREE.Vector2();
  }
  clone() { return new CSGVertex(this.pos, this.normal, this.uv); }
  flip() { this.normal.negate(); }
  interpolate(other, t) {
    return new CSGVertex(
      this.pos.clone().lerp(other.pos, t),
      this.normal.clone().lerp(other.normal, t).normalize(),
      this.uv.clone().lerp(other.uv, t),
    );
  }
}

class CSGPlane {
  constructor(normal, w) {
    this.normal = normal;
    this.w = w;
  }
  static fromPoints(a, b, c) {
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    return new CSGPlane(n, n.dot(a));
  }
  clone() { return new CSGPlane(this.normal.clone(), this.w); }
  flip() { this.normal.negate(); this.w = -this.w; }

  splitPolygon(poly, coplanarFront, coplanarBack, front, back) {
    const EPS = 1e-5;
    const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

    let ptype = 0;
    const types = poly.vertices.map(v => {
      const t = this.normal.dot(v.pos) - this.w;
      const type = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
      ptype |= type;
      return type;
    });

    switch (ptype) {
      case COPLANAR:
        (this.normal.dot(poly.plane.normal) > 0 ? coplanarFront : coplanarBack).push(poly);
        break;
      case FRONT: front.push(poly); break;
      case BACK: back.push(poly); break;
      case SPANNING: {
        const f = [], b = [];
        const verts = poly.vertices;
        for (let i = 0; i < verts.length; i++) {
          const j = (i + 1) % verts.length;
          const ti = types[i], tj = types[j];
          const vi = verts[i], vj = verts[j];
          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(vi);
          if ((ti | tj) === SPANNING) {
            const t = (this.w - this.normal.dot(vi.pos)) / this.normal.dot(vj.pos.clone().sub(vi.pos));
            const v = vi.interpolate(vj, t);
            f.push(v);
            b.push(v.clone());
          }
        }
        if (f.length >= 3) front.push(new CSGPolygon(f));
        if (b.length >= 3) back.push(new CSGPolygon(b));
        break;
      }
    }
  }
}

class CSGPolygon {
  constructor(vertices) {
    this.vertices = vertices;
    this.plane = CSGPlane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
  }
  clone() { return new CSGPolygon(this.vertices.map(v => v.clone())); }
  flip() { this.vertices.reverse().forEach(v => v.flip()); this.plane.flip(); }
}

class CSGNode {
  constructor(polygons) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons) this.build(polygons);
  }

  clone() {
    const node = new CSGNode();
    if (this.plane) node.plane = this.plane.clone();
    if (this.front) node.front = this.front.clone();
    if (this.back) node.back = this.back.clone();
    node.polygons = this.polygons.map(p => p.clone());
    return node;
  }

  invert() {
    this.polygons.forEach(p => p.flip());
    if (this.plane) this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    [this.front, this.back] = [this.back, this.front];
  }

  clipPolygons(polygons) {
    if (!this.plane) return polygons.slice();
    let front = [], back = [];
    polygons.forEach(p => this.plane.splitPolygon(p, front, back, front, back));
    if (this.front) front = this.front.clipPolygons(front);
    if (this.back) back = this.back.clipPolygons(back);
    else back = [];
    return front.concat(back);
  }

  clipTo(bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }

  allPolygons() {
    let p = this.polygons.slice();
    if (this.front) p = p.concat(this.front.allPolygons());
    if (this.back) p = p.concat(this.back.allPolygons());
    return p;
  }

  build(polygons) {
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane.clone();
    const front = [], back = [];
    polygons.forEach(p => this.plane.splitPolygon(p, this.polygons, this.polygons, front, back));
    if (front.length) { if (!this.front) this.front = new CSGNode(); this.front.build(front); }
    if (back.length) { if (!this.back) this.back = new CSGNode(); this.back.build(back); }
  }
}

// --- CSG class ---

class CSG {
  constructor(polygons = []) { this.polygons = polygons; }

  clone() { return new CSG(this.polygons.map(p => p.clone())); }

  toPolygons() { return this.polygons; }

  union(csg) {
    const a = new CSGNode(this.clone().polygons);
    const b = new CSGNode(csg.clone().polygons);
    a.clipTo(b); b.clipTo(a);
    b.invert(); b.clipTo(a); b.invert();
    a.build(b.allPolygons());
    return new CSG(a.allPolygons());
  }

  subtract(csg) {
    const a = new CSGNode(this.clone().polygons);
    const b = new CSGNode(csg.clone().polygons);
    a.invert(); a.clipTo(b);
    b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
    a.build(b.allPolygons()); a.invert();
    return new CSG(a.allPolygons());
  }

  intersect(csg) {
    const a = new CSGNode(this.clone().polygons);
    const b = new CSGNode(csg.clone().polygons);
    a.invert(); b.clipTo(a); b.invert();
    a.clipTo(b); b.clipTo(a);
    a.build(b.allPolygons()); a.invert();
    return new CSG(a.allPolygons());
  }

  static fromGeometry(geometry) {
    const polygons = [];
    const posAttr = geometry.attributes.position;
    const normAttr = geometry.attributes.normal;
    const uvAttr = geometry.attributes.uv;
    const indexAttr = geometry.index;

    const getVert = (i) => {
      const pos = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      const norm = normAttr
        ? new THREE.Vector3(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i))
        : new THREE.Vector3();
      const uv = uvAttr ? new THREE.Vector2(uvAttr.getX(i), uvAttr.getY(i)) : new THREE.Vector2();
      return new CSGVertex(pos, norm, uv);
    };

    const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
    for (let t = 0; t < triCount; t++) {
      let a, b, c;
      if (indexAttr) {
        a = indexAttr.getX(t*3); b = indexAttr.getX(t*3+1); c = indexAttr.getX(t*3+2);
      } else {
        a = t*3; b = t*3+1; c = t*3+2;
      }
      const verts = [getVert(a), getVert(b), getVert(c)];
      // Skip degenerate triangles
      const ab = verts[1].pos.clone().sub(verts[0].pos);
      const ac = verts[2].pos.clone().sub(verts[0].pos);
      if (ab.cross(ac).lengthSq() < 1e-12) continue;
      polygons.push(new CSGPolygon(verts));
    }
    return new CSG(polygons);
  }

  toGeometry() {
    const positions = [];
    const normals = [];
    const uvs = [];

    for (const poly of this.polygons) {
      // Fan triangulation of n-gons
      for (let i = 1; i < poly.vertices.length - 1; i++) {
        const verts = [poly.vertices[0], poly.vertices[i], poly.vertices[i+1]];
        for (const v of verts) {
          positions.push(v.pos.x, v.pos.y, v.pos.z);
          normals.push(v.normal.x, v.normal.y, v.normal.z);
          uvs.push(v.uv.x, v.uv.y);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    return geo;
  }
}

// --- Public API ---

export function csgUnion(geoA, geoB) {
  try {
    const result = CSG.fromGeometry(geoA).union(CSG.fromGeometry(geoB));
    return result.toGeometry();
  } catch(e) {
    console.warn('CSG union failed:', e);
    return geoA;
  }
}

export function csgSubtract(geoA, geoB) {
  try {
    const result = CSG.fromGeometry(geoA).subtract(CSG.fromGeometry(geoB));
    return result.toGeometry();
  } catch(e) {
    console.warn('CSG subtract failed:', e);
    return geoA;
  }
}

export function csgIntersect(geoA, geoB) {
  try {
    const result = CSG.fromGeometry(geoA).intersect(CSG.fromGeometry(geoB));
    return result.toGeometry();
  } catch(e) {
    console.warn('CSG intersect failed:', e);
    return geoA;
  }
}
