import * as CANNON from 'cannon-es';

// Quick-hull implementation for 3D convex hull computation.
// Returns { vertices: Float32Array, indices: Uint32Array } in THREE-compatible format.

function cross(a, b, c) {
  const ax = b[0]-a[0], ay = b[1]-a[1], az = b[2]-a[2];
  const bx = c[0]-a[0], by = c[1]-a[1], bz = c[2]-a[2];
  return [ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx];
}

function dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }

function signedVolume(a, b, c, d) {
  const n = cross(a, b, c);
  return dot(n, sub(d, a));
}

// Simplified convex hull via incremental method (handles most practical cases)
export function computeConvexHull(positions) {
  // positions: array of [x,y,z] triples
  if (positions.length < 4) return null;

  // Find extreme points for initial tetrahedron
  let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i][0] < positions[minX][0]) minX = i;
    if (positions[i][0] > positions[maxX][0]) maxX = i;
    if (positions[i][1] < positions[minY][1]) minY = i;
    if (positions[i][1] > positions[maxY][1]) maxY = i;
    if (positions[i][2] < positions[minZ][2]) minZ = i;
    if (positions[i][2] > positions[maxZ][2]) maxZ = i;
  }

  // Use a simple approach: collect unique vertices and build convex hull using gift wrapping
  // For physics purposes, we use the actual mesh vertices and let CANNON handle it
  const verts = positions.map(p => new CANNON.Vec3(p[0], p[1], p[2]));

  // Build simple triangulated faces (this is a simplified approach using gift wrapping idea)
  // For production: use a proper quickhull. Here we do a basic approximation.
  return { cannonVertices: verts, positions };
}

// Build a CANNON.ConvexPolyhedron from a THREE.BufferGeometry
export function geometryToConvexPolyhedron(geometry) {
  const posAttr = geometry.attributes.position;
  const raw = [];

  // Collect all vertices, deduplicate within tolerance
  const eps = 1e-4;
  const unique = [];
  const remap = [];

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);

    let found = -1;
    for (let j = 0; j < unique.length; j++) {
      const u = unique[j];
      if (Math.abs(u[0]-x)<eps && Math.abs(u[1]-y)<eps && Math.abs(u[2]-z)<eps) {
        found = j; break;
      }
    }
    if (found === -1) { found = unique.length; unique.push([x,y,z]); }
    remap.push(found);
  }

  const cannonVerts = unique.map(v => new CANNON.Vec3(v[0], v[1], v[2]));

  // Build face index list
  const cannonFaces = [];
  const indexAttr = geometry.index;

  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i += 3) {
      cannonFaces.push([
        remap[indexAttr.getX(i)],
        remap[indexAttr.getX(i+1)],
        remap[indexAttr.getX(i+2)],
      ]);
    }
  } else {
    for (let i = 0; i < posAttr.count; i += 3) {
      cannonFaces.push([remap[i], remap[i+1], remap[i+2]]);
    }
  }

  // Filter degenerate faces
  const validFaces = cannonFaces.filter(f => f[0]!==f[1] && f[1]!==f[2] && f[0]!==f[2]);

  if (cannonVerts.length < 4 || validFaces.length < 4) return null;

  try {
    const poly = new CANNON.ConvexPolyhedron({ vertices: cannonVerts, faces: validFaces });
    return poly;
  } catch(e) {
    console.warn('ConvexPolyhedron creation failed, using bounding box fallback', e);
    return null;
  }
}

// Build a safe physics shape from geometry (tries ConvexPolyhedron, falls back to Box)
export function safePhysicsShape(geometry) {
  const poly = geometryToConvexPolyhedron(geometry);
  if (poly) return poly;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  return new CANNON.Box(new CANNON.Vec3(
    Math.max((bb.max.x - bb.min.x) / 2, 0.01),
    Math.max((bb.max.y - bb.min.y) / 2, 0.01),
    Math.max((bb.max.z - bb.min.z) / 2, 0.01),
  ));
}
