import * as CANNON from 'cannon-es';
import * as THREE from 'three';

const AIR_DENSITY = 1.225; // kg/m³ at sea level

// Lift coefficient as function of angle of attack (simplified thin-airfoil approximation)
// Stall occurs at ~15 degrees.
function liftCoefficient(alphaDeg, maxCl = 1.2) {
  const stallAngle = 15;
  if (Math.abs(alphaDeg) > stallAngle * 2) return 0;
  if (Math.abs(alphaDeg) <= stallAngle) {
    return maxCl * (alphaDeg / stallAngle);
  }
  // Post-stall: linear decrease
  const t = (Math.abs(alphaDeg) - stallAngle) / stallAngle;
  return Math.sign(alphaDeg) * maxCl * (1 - t);
}

function dragCoefficient(alphaDeg, minCd = 0.01, maxCd = 1.2) {
  const t = Math.min(Math.abs(alphaDeg) / 90, 1);
  return minCd + (maxCd - minCd) * t * t;
}

// Represents one aerodynamic surface (wing, fin, feather patch).
// Computes lift and drag based on velocity relative to surface normal.
export class AerodynamicSurface {
  constructor({ body, area, maxLiftCoeff = 1.2, minDragCoeff = 0.02, spanAxis = new THREE.Vector3(1, 0, 0) }) {
    this._body = body;       // CANNON.Body
    this._area = area;       // m²
    this._maxCl = maxLiftCoeff;
    this._minCd = minDragCoeff;
    this._spanAxis = spanAxis.normalize(); // local-space span direction
  }

  applyForces() {
    const v = this._body.velocity;
    const speed2 = v.x*v.x + v.y*v.y + v.z*v.z;
    if (speed2 < 0.0001) return;

    // Get surface normal in world space (up direction of the body)
    const localNormal = new CANNON.Vec3(0, 1, 0);
    const worldNormal = new CANNON.Vec3();
    this._body.quaternion.vmult(localNormal, worldNormal);
    const wn = new THREE.Vector3(worldNormal.x, worldNormal.y, worldNormal.z);

    const vel = new THREE.Vector3(v.x, v.y, v.z);
    const speed = vel.length();
    const velDir = vel.clone().normalize();

    // Angle of attack: angle between velocity and surface chord (90° - angle to normal)
    const sinAoA = velDir.dot(wn);
    const alphaDeg = (Math.PI / 2 - Math.acos(Math.abs(sinAoA))) * 180 / Math.PI * Math.sign(sinAoA);

    const q = 0.5 * AIR_DENSITY * speed2; // dynamic pressure
    const Cl = liftCoefficient(alphaDeg, this._maxCl);
    const Cd = dragCoefficient(alphaDeg, this._minCd);

    // Lift: perpendicular to velocity, in the plane defined by velocity and normal
    const liftDir = new THREE.Vector3().crossVectors(velDir, wn).normalize();
    const liftMag = q * Cl * this._area;

    // Drag: opposes velocity
    const dragMag = q * Cd * this._area;

    const lift = liftDir.multiplyScalar(liftMag);
    const drag = velDir.clone().multiplyScalar(-dragMag);
    const totalForce = lift.add(drag);

    this._body.applyForce(
      new CANNON.Vec3(totalForce.x, totalForce.y, totalForce.z),
      new CANNON.Vec3(0, 0, 0),
    );
  }
}

// Manages multiple aerodynamic surfaces on a character
export class AerodynamicsSystem {
  constructor() {
    this._surfaces = [];
  }

  addSurface(surface) {
    this._surfaces.push(surface);
  }

  removeSurface(surface) {
    const i = this._surfaces.indexOf(surface);
    if (i >= 0) this._surfaces.splice(i, 1);
  }

  update() {
    for (const s of this._surfaces) s.applyForces();
  }

  clear() {
    this._surfaces = [];
  }
}
