import * as THREE from 'three';

// Directed signal graph. Nodes are brain regions / ganglia.
// Edges (axons) carry signals with propagation delay = length / conductionVelocity.

let _nsCounter = 0;

class NeuralNode {
  constructor({ id, type, label, position }) {
    this._id = id ?? `nn_${++_nsCounter}`;
    this._type = type; // 'brain-motor' | 'brain-sensory' | 'ganglion' | 'muscle-endpoint'
    this._label = label ?? type;
    this._position = position ?? new THREE.Vector3();
    this._outputSignal = 0; // current output level 0-1
    this._noise = 0;
  }

  get id() { return this._id; }
  get type() { return this._type; }
  get label() { return this._label; }
  get position() { return this._position; }
  get outputSignal() { return this._outputSignal; }

  process(inputSignals, noise) {
    // Sum all inputs, clamp to 0-1, add noise
    const sum = inputSignals.reduce((s, v) => s + v, 0);
    this._outputSignal = Math.min(1, Math.max(0, sum + (Math.random() - 0.5) * noise));
    return this._outputSignal;
  }
}

class Axon {
  constructor({ fromId, toId, conductionVelocity = 50, length, weight = 1 }) {
    this._fromId = fromId;
    this._toId = toId;
    this._conductionVelocity = conductionVelocity; // m/s
    this._length = length ?? 0.5;  // meters
    this._delay = this._length / this._conductionVelocity; // seconds
    this._weight = weight; // signal strength multiplier
    this._queue = []; // { value, deliveryTime }
    this._damaged = false;
    this._damageLevel = 0; // 0-1
  }

  get fromId() { return this._fromId; }
  get toId() { return this._toId; }
  get delay() { return this._delay; }
  get damaged() { return this._damaged; }
  get damageLevel() { return this._damageLevel; }

  sendSignal(value, currentTime) {
    if (this._damaged) {
      if (Math.random() < this._damageLevel) return; // drop signal
    }
    this._queue.push({ value: value * this._weight, deliveryTime: currentTime + this._delay });
  }

  drainSignals(currentTime) {
    const delivered = [];
    this._queue = this._queue.filter(s => {
      if (s.deliveryTime <= currentTime) { delivered.push(s.value); return false; }
      return true;
    });
    return delivered;
  }

  damage(amount) {
    this._damageLevel = Math.min(1, this._damageLevel + amount);
    this._damaged = this._damageLevel > 0.2;
  }

  serialize() {
    return {
      fromId: this._fromId, toId: this._toId,
      conductionVelocity: this._conductionVelocity,
      length: this._length, weight: this._weight,
      damageLevel: this._damageLevel,
    };
  }
}

export class NervousSystem {
  constructor() {
    this._nodes = new Map();  // id → NeuralNode
    this._axons = [];         // Axon[]
    this._axonsByTo = new Map(); // toId → Axon[]
    this._t = 0;

    // Visual representations (tubes for axons, spheres for nodes)
    this._visual = new THREE.Group();
    this._visual.name = 'NervousSystem';
  }

  get visual() { return this._visual; }
  get nodes() { return this._nodes; }
  get axons() { return this._axons; }

  addNode(id, { type = 'ganglion', label, position } = {}) {
    const node = new NeuralNode({ id, type, label, position });
    this._nodes.set(id, node);
    return node;
  }

  removeNode(id) {
    this._nodes.delete(id);
    this._axons = this._axons.filter(a => a.fromId !== id && a.toId !== id);
    this._rebuildIndex();
  }

  addAxon(fromId, toId, opts = {}) {
    if (!this._nodes.has(fromId) || !this._nodes.has(toId)) return null;
    const axon = new Axon({ fromId, toId, ...opts });
    this._axons.push(axon);
    if (!this._axonsByTo.has(toId)) this._axonsByTo.set(toId, []);
    this._axonsByTo.get(toId).push(axon);
    return axon;
  }

  // Send a signal from a source node (e.g., from player input → motor cortex)
  sendSignal(fromId, value) {
    const node = this._nodes.get(fromId);
    if (!node) return;
    // Forward to all outgoing axons
    for (const axon of this._axons) {
      if (axon.fromId === fromId) axon.sendSignal(value, this._t);
    }
  }

  // Get the current output of a node (e.g., muscle endpoint)
  getSignal(nodeId) {
    const node = this._nodes.get(nodeId);
    return node ? node.outputSignal : 0;
  }

  _rebuildIndex() {
    this._axonsByTo.clear();
    for (const axon of this._axons) {
      if (!this._axonsByTo.has(axon.toId)) this._axonsByTo.set(axon.toId, []);
      this._axonsByTo.get(axon.toId).push(axon);
    }
  }

  update(dt) {
    this._t += dt;
    // Drain delivered signals and process each node
    for (const [id, node] of this._nodes) {
      const incoming = this._axonsByTo.get(id) ?? [];
      const signals = incoming.flatMap(a => a.drainSignals(this._t));
      if (signals.length > 0) node.process(signals, 0.02);
    }
  }

  serialize() {
    return {
      nodes: [...this._nodes.entries()].map(([id, n]) => ({
        id, type: n.type, label: n.label,
        position: { x: n.position.x, y: n.position.y, z: n.position.z },
      })),
      axons: this._axons.map(a => a.serialize()),
    };
  }

  deserialize(data) {
    for (const n of (data.nodes ?? [])) {
      this.addNode(n.id, {
        type: n.type, label: n.label,
        position: new THREE.Vector3(n.position.x, n.position.y, n.position.z),
      });
    }
    for (const a of (data.axons ?? [])) {
      this.addAxon(a.fromId, a.toId, {
        conductionVelocity: a.conductionVelocity,
        length: a.length, weight: a.weight,
      });
    }
  }
}
