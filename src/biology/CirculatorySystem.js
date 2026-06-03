// Simplified circulatory system.
// Models blood flow through a graph of vessels (heart → organs → back).
// Uses Poiseuille flow approximation for each vessel segment.

const BLOOD_VISCOSITY = 0.003; // Pa·s (whole blood ~0.003)
const O2_CARRY_CAP = 1.0;     // normalized max O2 per unit flow

let _circCounter = 0;

class Vessel {
  constructor({ id, fromId, toId, radius = 0.005, length = 0.1 }) {
    this._id = id ?? `vessel_${++_circCounter}`;
    this._fromId = fromId;
    this._toId = toId;
    this._radius = radius;  // meters
    this._length = length;  // meters
    this._resistance = (8 * BLOOD_VISCOSITY * length) / (Math.PI * Math.pow(radius, 4));
    this._damaged = false;
    this._bleedRate = 0;    // L/s lost externally
    this._flowRate = 0;     // current L/s
    this._o2Content = 1.0;  // normalized
  }

  get id() { return this._id; }
  get fromId() { return this._fromId; }
  get toId() { return this._toId; }
  get resistance() { return this._resistance; }
  get flowRate() { return this._flowRate; }
  get o2Content() { return this._o2Content; }

  computeFlow(pressureDrop) {
    // Q = ΔP / R  (Poiseuille)
    this._flowRate = Math.max(0, pressureDrop / this._resistance);
    if (this._damaged) {
      this._bleedRate = this._flowRate * (this._bleedRate > 0 ? 0.3 : 0);
      this._flowRate *= (1 - this._bleedRate * 0.1);
    }
    return this._flowRate;
  }

  damage(severity) {
    this._damaged = true;
    this._bleedRate = severity;
    // Radius effectively shrinks due to trauma / vasoconstriction
    const newRadius = this._radius * (1 - severity * 0.5);
    this._resistance = (8 * BLOOD_VISCOSITY * this._length) / (Math.PI * Math.pow(newRadius, 4));
  }

  serialize() {
    return {
      id: this._id, fromId: this._fromId, toId: this._toId,
      radius: this._radius, length: this._length,
    };
  }
}

export class CirculatoryNode {
  constructor(id, organRef) {
    this.id = id;
    this.organ = organRef; // reference to Organ instance
    this._o2Level = 1.0;
    this._o2Demand = 0;    // set by muscle fatigue, etc.
    this._flowIn = 0;
  }

  get o2Level() { return this._o2Level; }

  update(incomingFlow, incomingO2, dt) {
    this._flowIn = incomingFlow;
    if (incomingFlow > 0) {
      this._o2Level = Math.min(1, this._o2Level + incomingFlow * incomingO2 * dt * 10);
    }
    // O2 consumption
    const consumption = this._o2Demand * dt * 0.1;
    this._o2Level = Math.max(0, this._o2Level - consumption);

    // Sync to organ
    if (this.organ) this.organ.o2Level = this._o2Level;
  }

  setDemand(v) { this._o2Demand = Math.max(0, v); }
}

export class CirculatorySystem {
  constructor() {
    this._nodes = new Map();   // id → CirculatoryNode
    this._vessels = new Map(); // id → Vessel
    this._adjacency = new Map(); // fromId → Vessel[]
    this._heart = null;
    this._totalBloodVolume = 5.0; // liters
    this._systemPressure = 100;   // mmHg baseline
  }

  get nodes() { return this._nodes; }
  get vessels() { return this._vessels; }

  setHeart(heartOrgan) {
    this._heart = heartOrgan;
    if (!this._nodes.has('heart')) {
      this._nodes.set('heart', new CirculatoryNode('heart', heartOrgan));
    }
  }

  addNode(id, organ = null) {
    const node = new CirculatoryNode(id, organ);
    this._nodes.set(id, node);
    return node;
  }

  addVessel(fromId, toId, opts = {}) {
    const vessel = new Vessel({ fromId, toId, ...opts });
    this._vessels.set(vessel.id, vessel);
    if (!this._adjacency.has(fromId)) this._adjacency.set(fromId, []);
    this._adjacency.get(fromId).push(vessel);
    return vessel;
  }

  getO2Level(nodeId) {
    return this._nodes.get(nodeId)?.o2Level ?? 1.0;
  }

  handleDamage(vesselId, severity) {
    this._vessels.get(vesselId)?.damage(severity);
  }

  update(dt) {
    if (!this._heart) return;

    const heartPressure = this._heart.pressure * this._systemPressure;

    // Simple BFS from heart through vessel graph, compute flow at each vessel
    const visited = new Set(['heart']);
    const queue = [{ nodeId: 'heart', pressure: heartPressure, o2: 1.0 }];

    while (queue.length > 0) {
      const { nodeId, pressure, o2 } = queue.shift();
      const vessels = this._adjacency.get(nodeId) ?? [];

      for (const vessel of vessels) {
        const returnPressure = pressure * 0.3; // veins return at ~30% of arterial pressure
        const flow = vessel.computeFlow(pressure - returnPressure);
        vessel._o2Content = o2 * (1 - 0.2); // O2 drops 20% per capillary bed

        const toNode = this._nodes.get(vessel.toId);
        if (toNode) {
          toNode.update(flow, vessel._o2Content, dt);
        }

        if (!visited.has(vessel.toId)) {
          visited.add(vessel.toId);
          queue.push({ nodeId: vessel.toId, pressure: returnPressure, o2: vessel._o2Content });
        }
      }
    }
  }

  serialize() {
    return {
      vessels: [...this._vessels.values()].map(v => v.serialize()),
      nodes: [...this._nodes.keys()],
    };
  }

  deserialize(data, organsMap) {
    for (const nodeId of (data.nodes ?? [])) {
      if (!this._nodes.has(nodeId)) {
        this.addNode(nodeId, organsMap?.get(nodeId) ?? null);
      }
    }
    for (const v of (data.vessels ?? [])) {
      this.addVessel(v.fromId, v.toId, { id: v.id, radius: v.radius, length: v.length });
    }
  }
}
