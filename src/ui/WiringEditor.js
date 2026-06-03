import * as THREE from 'three';

// Wiring editor: draw neural (axon) and vascular (vessel) connections
// between organs in the 3D scene by drag-and-drop.

export class WiringEditor {
  constructor({ scene, character, renderer, camera }) {
    this._scene = scene;
    this._character = character;
    this._renderer = renderer;
    this._camera = camera;
    this._active = false;
    this._wireType = 'neural'; // 'neural' | 'vascular'
    this._pendingFrom = null;  // {partId, organ}

    // Visual pending line (ghost)
    this._ghostLine = null;
    this._ghostGeo = null;
    this._connections = []; // { line, fromId, toId, type }

    this._raycaster = new THREE.Raycaster();
    this._el = this._buildPanel();

    this._onDown = this._onPointerDown.bind(this);
    this._onMove = this._onPointerMove.bind(this);
    this._onUp = this._onPointerUp.bind(this);
  }

  get active() { return this._active; }

  activate() {
    this._active = true;
    this._el.style.display = '';
    this._renderer.domElement.addEventListener('pointerdown', this._onDown);
    this._renderer.domElement.addEventListener('pointermove', this._onMove);
    this._renderer.domElement.addEventListener('pointerup', this._onUp);
    // Rebuild connection visuals
    this._rebuildVisuals();
  }

  deactivate() {
    this._active = false;
    this._el.style.display = 'none';
    this._renderer.domElement.removeEventListener('pointerdown', this._onDown);
    this._renderer.domElement.removeEventListener('pointermove', this._onMove);
    this._renderer.domElement.removeEventListener('pointerup', this._onUp);
    this._cancelPending();
  }

  _buildPanel() {
    const el = document.createElement('div');
    el.id = 'wiring-panel';
    el.innerHTML = `
      <div class="panel-header"><span>Wiring</span></div>
      <p class="hint">Tap an organ to start a connection, then tap another to complete it.</p>
      <div class="mode-tabs">
        <button class="wmode-tab active" data-wtype="neural">Neural</button>
        <button class="wmode-tab" data-wtype="vascular">Vascular</button>
      </div>
      <div id="wiring-status" class="hint" style="margin-top:8px">Ready</div>
      <button id="wiring-cancel" class="secondary-btn" style="width:100%;margin-top:8px;display:none">Cancel</button>
    `;

    el.querySelectorAll('.wmode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._wireType = tab.dataset.wtype;
        el.querySelectorAll('.wmode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._cancelPending();
      });
    });

    document.getElementById('wiring-cancel')?.addEventListener('click', () => this._cancelPending());
    document.body.appendChild(el);
    el.style.display = 'none';
    return el;
  }

  _getEventNDC(e) {
    const rect = this._renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  _raycastOrgans(ndc) {
    this._raycaster.setFromCamera(ndc, this._camera);
    const meshes = [];
    for (const part of this._character.parts.values()) {
      if (part.organType || part.constructor.name === 'Eye' || part.constructor.name === 'Ear') {
        meshes.push(part.mesh);
      }
    }
    const hits = this._raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const partId = hits[0].object.userData.bodyPartId;
    return this._character.parts.get(partId) ?? null;
  }

  _onPointerDown(e) {
    if (!this._active || e.button !== 0) return;
    const ndc = this._getEventNDC(e);
    const organ = this._raycastOrgans(ndc);
    if (!organ) return;

    e.stopPropagation();
    if (!this._pendingFrom) {
      // Start connection
      this._pendingFrom = organ;
      this._createGhostLine(organ);
      document.getElementById('wiring-status').textContent = `From: ${organ.name || organ.organType} → tap another organ`;
      document.getElementById('wiring-cancel').style.display = '';
    } else {
      // Complete connection
      if (organ.id !== this._pendingFrom.id) {
        this._completeConnection(this._pendingFrom, organ);
      }
      this._cancelPending();
    }
  }

  _onPointerMove(e) {
    if (!this._active || !this._pendingFrom || !this._ghostLine) return;
    // Update ghost line endpoint to mouse world position (at organ plane depth)
    const ndc = this._getEventNDC(e);
    this._raycaster.setFromCamera(ndc, this._camera);
    const fromPos = new THREE.Vector3().setFromMatrixPosition(this._pendingFrom.mesh.matrixWorld);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      this._camera.getWorldDirection(new THREE.Vector3()),
      fromPos,
    );
    const point = new THREE.Vector3();
    this._raycaster.ray.intersectPlane(plane, point);
    if (point) this._updateGhostLine(fromPos, point);
  }

  _onPointerUp(e) {}

  _createGhostLine(fromOrgan) {
    const fromPos = new THREE.Vector3().setFromMatrixPosition(fromOrgan.mesh.matrixWorld);
    this._ghostGeo = new THREE.BufferGeometry().setFromPoints([fromPos, fromPos.clone().add(new THREE.Vector3(0.01, 0, 0))]);
    const mat = new THREE.LineBasicMaterial({
      color: this._wireType === 'neural' ? 0xffff00 : 0xff4444,
      linewidth: 2,
    });
    this._ghostLine = new THREE.Line(this._ghostGeo, mat);
    this._scene.add(this._ghostLine);
  }

  _updateGhostLine(from, to) {
    if (!this._ghostGeo) return;
    const posArr = this._ghostGeo.attributes.position;
    posArr.setXYZ(0, from.x, from.y, from.z);
    posArr.setXYZ(1, to.x, to.y, to.z);
    posArr.needsUpdate = true;
  }

  _cancelPending() {
    if (this._ghostLine) {
      this._scene.remove(this._ghostLine);
      this._ghostLine = null;
      this._ghostGeo = null;
    }
    this._pendingFrom = null;
    document.getElementById('wiring-status').textContent = 'Ready';
    document.getElementById('wiring-cancel').style.display = 'none';
  }

  _completeConnection(fromOrgan, toOrgan) {
    const fromId = fromOrgan.id;
    const toId = toOrgan.id;
    const ns = this._character.nervousSystem;
    const cs = this._character.circulatorySystem;

    if (this._wireType === 'neural') {
      // Add nodes if not present
      if (!ns.nodes.has(fromId)) ns.addNode(fromId, { type: 'ganglion', label: fromOrgan.name, position: new THREE.Vector3().setFromMatrixPosition(fromOrgan.mesh.matrixWorld) });
      if (!ns.nodes.has(toId)) ns.addNode(toId, { type: 'ganglion', label: toOrgan.name, position: new THREE.Vector3().setFromMatrixPosition(toOrgan.mesh.matrixWorld) });
      const fromPos = new THREE.Vector3().setFromMatrixPosition(fromOrgan.mesh.matrixWorld);
      const toPos = new THREE.Vector3().setFromMatrixPosition(toOrgan.mesh.matrixWorld);
      const length = fromPos.distanceTo(toPos);
      ns.addAxon(fromId, toId, { conductionVelocity: 50, length });
    } else {
      // Vascular
      if (!cs.nodes.has(fromId)) cs.addNode(fromId, fromOrgan);
      if (!cs.nodes.has(toId)) cs.addNode(toId, toOrgan);
      const fromPos = new THREE.Vector3().setFromMatrixPosition(fromOrgan.mesh.matrixWorld);
      const toPos = new THREE.Vector3().setFromMatrixPosition(toOrgan.mesh.matrixWorld);
      const length = fromPos.distanceTo(toPos);
      cs.addVessel(fromId, toId, { radius: 0.005, length });
    }

    // Draw permanent connection line
    this._rebuildVisuals();
  }

  _rebuildVisuals() {
    // Remove old visual lines
    for (const c of this._connections) this._scene.remove(c.line);
    this._connections = [];

    // Neural axons
    const ns = this._character.nervousSystem;
    for (const axon of ns.axons) {
      const fromNode = ns.nodes.get(axon.fromId);
      const toNode = ns.nodes.get(axon.toId);
      if (!fromNode || !toNode) continue;
      const fromPart = this._character.parts.get(axon.fromId);
      const toPart = this._character.parts.get(axon.toId);
      if (!fromPart || !toPart) continue;

      const fromPos = new THREE.Vector3().setFromMatrixPosition(fromPart.mesh.matrixWorld);
      const toPos = new THREE.Vector3().setFromMatrixPosition(toPart.mesh.matrixWorld);
      const geo = new THREE.BufferGeometry().setFromPoints([fromPos, toPos]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.7 }));
      this._scene.add(line);
      this._connections.push({ line, fromId: axon.fromId, toId: axon.toId, type: 'neural' });
    }

    // Vascular vessels
    const cs = this._character.circulatorySystem;
    for (const vessel of cs.vessels.values()) {
      const fromPart = this._character.parts.get(vessel.fromId);
      const toPart = this._character.parts.get(vessel.toId);
      if (!fromPart || !toPart) continue;
      const fromPos = new THREE.Vector3().setFromMatrixPosition(fromPart.mesh.matrixWorld);
      const toPos = new THREE.Vector3().setFromMatrixPosition(toPart.mesh.matrixWorld);
      const geo = new THREE.BufferGeometry().setFromPoints([fromPos, toPos]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.7 }));
      this._scene.add(line);
      this._connections.push({ line, fromId: vessel.fromId, toId: vessel.toId, type: 'vascular' });
    }
  }

  update() {
    if (!this._active) return;
    // Update wiring line positions as bodies move
    // (Only needed if in wiring mode during simulation preview)
  }

  dispose() {
    this.deactivate();
    for (const c of this._connections) this._scene.remove(c.line);
    this._el.remove();
  }
}
