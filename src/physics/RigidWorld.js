import * as CANNON from 'cannon-es';

export class RigidWorld {
  constructor() {
    this._world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
      broadphase: new CANNON.SAPBroadphase(),
      allowSleep: false,
    });
    this._world.solver.iterations = 20;
    this._world.solver.tolerance = 0.001;

    // Ground plane
    this._groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      position: new CANNON.Vec3(0, 0, 0),
    });
    this._groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this._groundBody.material = new CANNON.Material('ground');
    this._world.addBody(this._groundBody);

    // Default bone-ground contact material
    this._boneMat = new CANNON.Material('bone');
    const boneGround = new CANNON.ContactMaterial(this._boneMat, this._groundBody.material, {
      friction: 0.4,
      restitution: 0.1,
    });
    this._world.addContactMaterial(boneGround);

    this._bodies = new Set();
    this._constraints = new Set();
  }

  get world() { return this._world; }
  get ground() { return this._groundBody; }
  get defaultMaterial() { return this._boneMat; }

  addBody(body) {
    if (!body.material) body.material = this._boneMat;
    this._world.addBody(body);
    this._bodies.add(body);
    return body;
  }

  removeBody(body) {
    this._world.removeBody(body);
    this._bodies.delete(body);
  }

  addConstraint(c) {
    this._world.addConstraint(c);
    this._constraints.add(c);
    return c;
  }

  removeConstraint(c) {
    this._world.removeConstraint(c);
    this._constraints.delete(c);
  }

  step(dt) {
    this._world.step(1 / 60, dt, 3);
  }

  clear() {
    for (const c of this._constraints) this._world.removeConstraint(c);
    this._constraints.clear();
    for (const b of this._bodies) this._world.removeBody(b);
    this._bodies.clear();
  }

  // Create a fixed anchor body at a world position (mass=0, immovable)
  createAnchor(position) {
    const body = new CANNON.Body({
      mass: 0,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      shape: new CANNON.Sphere(0.01),
    });
    this.addBody(body);
    return body;
  }
}
