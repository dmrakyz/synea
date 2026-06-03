import * as CANNON from 'cannon-es';

const WATER_DENSITY = 1025; // kg/m³ (seawater)
const GRAVITY = 9.82;

// Applies buoyancy and hydrodynamic drag to a rigid body.
export class FluidBody {
  constructor({ body, volume, crossSectionArea, materialDensity, dragCoeff = 0.5, liftCoeff = 0 }) {
    this._body = body;
    this._volume = volume;             // m³
    this._area = crossSectionArea;     // m² (frontal cross-section)
    this._matDensity = materialDensity;
    this._cd = dragCoeff;
    this._cl = liftCoeff;
    this._waterSurfaceY = 0;
    this._submergedFraction = 0;
  }

  get submergedFraction() { return this._submergedFraction; }

  setWaterSurface(y) { this._waterSurfaceY = y; }

  // Call each physics frame
  applyForces() {
    const pos = this._body.position;
    const vel = this._body.velocity;

    // Estimate submersion fraction based on body Y vs water surface
    // Rough approximation: assume body height ~= cube root of volume
    const bodyRadius = Math.cbrt(this._volume * 3 / (4 * Math.PI));
    const bottomY = pos.y - bodyRadius;
    const topY = pos.y + bodyRadius;

    if (topY < this._waterSurfaceY) {
      this._submergedFraction = 1.0;
    } else if (bottomY > this._waterSurfaceY) {
      this._submergedFraction = 0.0;
    } else {
      this._submergedFraction = (this._waterSurfaceY - bottomY) / (2 * bodyRadius);
    }

    if (this._submergedFraction <= 0) return;

    // Buoyancy: upward force = rho_water * g * V_submerged
    const buoyancyMag = WATER_DENSITY * GRAVITY * this._volume * this._submergedFraction;
    this._body.applyForce(new CANNON.Vec3(0, buoyancyMag, 0), CANNON.Vec3.ZERO);

    // Hydrodynamic drag: F = -0.5 * rho * v^2 * Cd * A * v_unit
    const speed2 = vel.x*vel.x + vel.y*vel.y + vel.z*vel.z;
    if (speed2 < 1e-6) return;
    const speed = Math.sqrt(speed2);
    const dragMag = 0.5 * WATER_DENSITY * speed2 * this._cd * this._area * this._submergedFraction;
    const dragForce = new CANNON.Vec3(-vel.x / speed * dragMag, -vel.y / speed * dragMag, -vel.z / speed * dragMag);
    this._body.applyForce(dragForce, CANNON.Vec3.ZERO);

    // Added mass effect: resist lateral acceleration of fins/tails
    // Approximated by a linear velocity damping
    if (this._cl > 0) {
      const latDamp = 0.5 * WATER_DENSITY * this._area * this._cl * this._submergedFraction;
      this._body.linearDamping = Math.min(0.95, latDamp * 0.01);
    }
  }
}

// Manages fluid bodies and water surface level
export class FluidSystem {
  constructor() {
    this._bodies = [];
    this._waterSurfaceY = -100; // default: no water
  }

  get waterSurfaceY() { return this._waterSurfaceY; }
  setWaterSurface(y) {
    this._waterSurfaceY = y;
    for (const b of this._bodies) b.setWaterSurface(y);
  }

  addBody(fluidBody) {
    fluidBody.setWaterSurface(this._waterSurfaceY);
    this._bodies.push(fluidBody);
  }

  removeBody(fluidBody) {
    const i = this._bodies.indexOf(fluidBody);
    if (i >= 0) this._bodies.splice(i, 1);
  }

  update() {
    for (const b of this._bodies) b.applyForces();
  }

  clear() {
    this._bodies = [];
  }
}
