import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Joint, JOINT_TYPES } from '../biology/Joint.js';
import { Muscle } from '../biology/Muscle.js';
import { BodyPart } from '../biology/BodyPart.js';
import { Bone } from '../biology/Bone.js';
import { createOrgan } from '../biology/Organ.js';
import { Eye } from '../biology/Eye.js';
import { Ear } from '../biology/Ear.js';

export const BUILDER_MODES = {
  SELECT: 'select',
  MODEL: 'model',
  SKELETON: 'skeleton',
  TISSUE: 'tissue',
  ORGANS: 'organs',
  WIRING: 'wiring',
  CONTROLS: 'controls',
};

export class BuilderUI {
  constructor({ renderer, scene, character, physicsWorld, modelingPanel, inspectorPanel, wiringEditor, controlMapper, camera }) {
    this._renderer = renderer;
    this._scene = scene;
    this._character = character;
    this._physicsWorld = physicsWorld;
    this._modelingPanel = modelingPanel;
    this._inspectorPanel = inspectorPanel;
    this._wiringEditor = wiringEditor;
    this._controlMapper = controlMapper;
    this._camera = camera;

    this._mode = BUILDER_MODES.SELECT;
    this._selectedEl = null;
    this._hoveredEl = null;
    this._pendingPlacement = null; // { geo, materialId, ghost }
    this._pendingJointA = null;
    this._pendingMuscleA = null;
    this._pendingAnchorA = null;
    this._longPressTimer = null;

    this._raycaster = new THREE.Raycaster();
    this._raycaster.params.Line.threshold = 0.05;

    // Ground plane for raycasting placement
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._orbit = new OrbitControls(camera, renderer.domElement);
    this._orbit.enableDamping = true;
    this._orbit.dampingFactor = 0.1;
    this._orbit.minPolarAngle = 0.1;
    this._orbit.maxPolarAngle = Math.PI / 2 - 0.05;
    this._orbit.enablePan = true;
    this._orbit.panSpeed = 0.7;
    this._orbit.screenSpacePanning = true;

    this._el = this._buildTopBar();
    this._ghost = null; // ghost mesh for placement preview

    this._onDown = this._onPointerDown.bind(this);
    this._onMove = this._onPointerMove.bind(this);
    this._onUp = this._onPointerUp.bind(this);
    renderer.domElement.addEventListener('pointerdown', this._onDown, { capture: true });
    renderer.domElement.addEventListener('pointermove', this._onMove);
    renderer.domElement.addEventListener('pointerup', this._onUp, { capture: true });

    this._onModelShape = null; // will be set by App
    this._listeners = {}; // event → fn
  }

  get mode() { return this._mode; }
  get orbit() { return this._orbit; }
  get selectedEl() { return this._selectedEl; }

  on(event, fn) { this._listeners[event] = fn; }
  _emit(event, data) { this._listeners[event]?.(data); }

  _buildTopBar() {
    const bar = document.createElement('div');
    bar.id = 'builder-top-bar';

    const modeButtons = [
      { mode: BUILDER_MODES.SELECT,   icon: '↖', label: 'Select' },
      { mode: BUILDER_MODES.MODEL,    icon: '◈',  label: 'Model' },
      { mode: BUILDER_MODES.SKELETON, icon: '⌥',  label: 'Skeleton' },
      { mode: BUILDER_MODES.TISSUE,   icon: '♡',  label: 'Tissue' },
      { mode: BUILDER_MODES.ORGANS,   icon: '◉',  label: 'Organs' },
      { mode: BUILDER_MODES.WIRING,   icon: '⚡', label: 'Wiring' },
      { mode: BUILDER_MODES.CONTROLS, icon: '🎮', label: 'Controls' },
    ];

    bar.innerHTML = `
      <div id="mode-pills">
        ${modeButtons.map(b => `
          <button class="mode-pill ${b.mode === BUILDER_MODES.SELECT ? 'active' : ''}"
            data-mode="${b.mode}" title="${b.label}">${b.icon} ${b.label}</button>
        `).join('')}
      </div>
      <div id="builder-actions">
        <button id="btn-simulate" class="primary-btn">▶ Simulate</button>
        <button id="btn-save" class="icon-btn" title="Save">💾</button>
        <button id="btn-load" class="icon-btn" title="Load">📂</button>
      </div>
    `;

    document.body.appendChild(bar);

    bar.querySelectorAll('.mode-pill').forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });
    document.getElementById('btn-simulate').addEventListener('click', () => this._emit('simulate'));
    document.getElementById('btn-save').addEventListener('click', () => this._emit('save'));
    document.getElementById('btn-load').addEventListener('click', () => this._emit('load'));

    return bar;
  }

  setMode(mode) {
    this._cancelPending();
    this._mode = mode;

    // Update pill active state
    document.querySelectorAll('.mode-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Panel visibility
    this._modelingPanel.hide();
    this._inspectorPanel.hide();
    this._wiringEditor.deactivate();
    this._controlMapper.hide();

    switch (mode) {
      case BUILDER_MODES.MODEL:
        this._modelingPanel.show();
        break;
      case BUILDER_MODES.WIRING:
        this._wiringEditor.activate();
        break;
      case BUILDER_MODES.CONTROLS:
        this._controlMapper.show();
        break;
    }

    this._emit('modeChanged', mode);
  }

  // Called by ModelingPanel when user creates a shape
  beginPlacement(geometry, materialId) {
    this._cancelPending();
    const mat = new THREE.MeshStandardMaterial({ color: 0x88aaff, transparent: true, opacity: 0.5 });
    const ghost = new THREE.Mesh(geometry.clone(), mat);
    this._scene.add(ghost);
    this._pendingPlacement = { geometry, materialId, ghost };
    this._ghost = ghost;
    this._orbit.enabled = false;
  }

  _confirmPlacement(worldPos) {
    if (!this._pendingPlacement) return;
    const { geometry, materialId } = this._pendingPlacement;

    // Determine part type from materialId
    let part;
    const matId = materialId ?? 'BONE';

    if (matId === 'BONE' || matId === 'CARTILAGE' || matId === 'CHITIN' || matId === 'SCALE') {
      part = new Bone({ geometry: geometry.clone(), materialId: matId });
    } else if (matId === 'MUSCLE_SKELETAL' || matId === 'MUSCLE_SMOOTH' || matId === 'MUSCLE_CARDIAC') {
      part = new BodyPart({ geometry: geometry.clone(), materialId: matId });
    } else {
      part = new BodyPart({ geometry: geometry.clone(), materialId: matId });
    }

    // Lift part above ground by bounding box half-height
    geometry.computeBoundingBox();
    const halfH = (geometry.boundingBox.max.y - geometry.boundingBox.min.y) / 2;
    part.physicsBody.position.set(worldPos.x, Math.max(halfH, worldPos.y + halfH), worldPos.z);

    this._character.addPart(part);
    this._scene.add(part.mesh);

    this._cancelPlacement();
    this._selectElement(part);
    this._emit('partAdded', part);
  }

  _cancelPlacement() {
    if (this._ghost) { this._scene.remove(this._ghost); this._ghost.geometry.dispose(); this._ghost.material.dispose(); this._ghost = null; }
    this._pendingPlacement = null;
    this._orbit.enabled = true;
  }

  _cancelPending() {
    this._cancelPlacement();
    this._pendingJointA = null;
    this._pendingMuscleA = null;
    this._pendingAnchorA = null;
    document.getElementById('builder-hint')?.remove();
  }

  _getEventNDC(e) {
    const rect = this._renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  _getWorldPos(ndc, defaultY = 0) {
    this._raycaster.setFromCamera(ndc, this._camera);
    const point = new THREE.Vector3();
    this._raycaster.ray.intersectPlane(this._groundPlane, point);
    return point ?? new THREE.Vector3(0, defaultY, 0);
  }

  _raycastParts(ndc) {
    this._raycaster.setFromCamera(ndc, this._camera);
    const meshes = [...this._character.parts.values()].map(p => p.mesh);
    const hits = this._raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return { part: null, point: null };
    const partId = hits[0].object.userData.bodyPartId;
    return { part: this._character.parts.get(partId) ?? null, point: hits[0].point };
  }

  _raycastMuscles(ndc) {
    this._raycaster.setFromCamera(ndc, this._camera);
    const lines = [...this._character.muscles.values()].map(m => m.line);
    const hits = this._raycaster.intersectObjects(lines, false);
    if (hits.length === 0) return null;
    const muscleId = hits[0].object.userData.muscleId;
    return this._character.muscles.get(muscleId) ?? null;
  }

  _raycastJoints(ndc) {
    this._raycaster.setFromCamera(ndc, this._camera);
    const meshes = [...this._character.joints.values()].map(j => j.indicator);
    const hits = this._raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const jointId = hits[0].object.userData.jointId;
    return this._character.joints.get(jointId) ?? null;
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    const ndc = this._getEventNDC(e);
    const worldPos = this._getWorldPos(ndc);

    // Long-press detection
    this._longPressTimer = setTimeout(() => {
      this._longPressTimer = null;
      const { part } = this._raycastParts(ndc);
      if (part) this._onLongPress(part);
    }, 500);

    if (this._pendingPlacement) {
      e.stopPropagation();
      clearTimeout(this._longPressTimer);
      this._confirmPlacement(worldPos);
      return;
    }
  }

  _onPointerMove(e) {
    if (e.buttons !== 0) clearTimeout(this._longPressTimer);

    if (this._ghost) {
      const ndc = this._getEventNDC(e);
      const worldPos = this._getWorldPos(ndc);
      if (worldPos) {
        const geo = this._pendingPlacement?.geometry;
        if (geo) {
          geo.computeBoundingBox();
          const halfH = (geo.boundingBox.max.y - geo.boundingBox.min.y) / 2;
          this._ghost.position.set(worldPos.x, halfH, worldPos.z);
        }
      }
    }
  }

  _onPointerUp(e) {
    if (e.button !== 0) return;
    clearTimeout(this._longPressTimer);

    if (this._pendingPlacement) return; // handled in down
    if (this._orbit.enabled && e.type === 'pointerup') {
      // Small movement = tap (not orbit drag)
      const ndc = this._getEventNDC(e);
      this._handleTap(ndc);
    }
  }

  _handleTap(ndc) {
    const joint = this._raycastJoints(ndc);
    if (joint) { this._selectElement(joint); return; }

    const muscle = this._raycastMuscles(ndc);
    if (muscle) { this._selectElement(muscle); return; }

    const { part, point } = this._raycastParts(ndc);

    if (this._mode === BUILDER_MODES.SKELETON && part) {
      this._handleSkeletonTap(part, point);
      return;
    }

    if (this._mode === BUILDER_MODES.TISSUE && part) {
      this._handleTissueTap(part, point);
      return;
    }

    if (part) {
      this._selectElement(part);
    } else {
      this._deselectAll();
    }
  }

  _handleSkeletonTap(part, hitPoint) {
    if (!this._pendingJointA) {
      // Select first part
      this._pendingJointA = part;
      part.setSelected(true);
      this._showHint('Now tap another part to create a joint');
    } else if (part.id !== this._pendingJointA.id) {
      // Create joint
      const pA = this._pendingJointA;
      const pB = part;

      // Auto-pivot: midpoint between closest attachment points
      const { pivotA, pivotB } = this._closestAttachmentPair(pA, pB);

      const joint = new Joint({
        partA: pA, partB: pB,
        type: JOINT_TYPES.HINGE,
        pivotA, pivotB,
        axisA: { x: 1, y: 0, z: 0 },
        axisB: { x: 1, y: 0, z: 0 },
      });
      this._character.addJoint(joint);
      this._scene.add(joint.indicator);

      pA.setSelected(false);
      this._pendingJointA = null;
      this._selectElement(joint);
      this._removeHint();
    }
  }

  _handleTissueTap(part, hitPoint) {
    if (!this._pendingMuscleA) {
      this._pendingMuscleA = part;
      this._pendingAnchorA = this._nearestAttachmentLocal(part, hitPoint);
      part.setSelected(true);
      this._showHint('Now tap attachment point on another part for muscle end');
    } else if (part.id !== this._pendingMuscleA.id) {
      const anchorB = this._nearestAttachmentLocal(part, hitPoint);
      const muscle = new Muscle({
        partA: this._pendingMuscleA,
        partB: part,
        anchorLocalA: this._pendingAnchorA,
        anchorLocalB: anchorB,
        type: 'MUSCLE_SKELETAL',
        controlGroup: 'group_' + (this._character.controlGroups.size + 1),
      });
      this._character.addMuscle(muscle);
      this._scene.add(muscle.line);

      this._pendingMuscleA.setSelected(false);
      this._pendingMuscleA = null;
      this._pendingAnchorA = null;
      this._selectElement(muscle);
      this._removeHint();
    }
  }

  _closestAttachmentPair(partA, partB) {
    let minDist = Infinity, pivA = null, pivB = null;
    for (const apA of partA.attachmentPoints) {
      const wA = partA.getAttachmentWorldPos(apA.local);
      for (const apB of partB.attachmentPoints) {
        const wB = partB.getAttachmentWorldPos(apB.local);
        const d = wA.distanceTo(wB);
        if (d < minDist) { minDist = d; pivA = apA.local; pivB = apB.local; }
      }
    }
    const toCANNON = v => ({ x: v.x, y: v.y, z: v.z });
    return { pivotA: toCANNON(pivA ?? new THREE.Vector3()), pivotB: toCANNON(pivB ?? new THREE.Vector3()) };
  }

  _nearestAttachmentLocal(part, worldHitPoint) {
    let minD = Infinity, nearest = new THREE.Vector3();
    for (const ap of part.attachmentPoints) {
      const wPos = part.getAttachmentWorldPos(ap.local);
      const d = wPos.distanceTo(worldHitPoint);
      if (d < minD) { minD = d; nearest = ap.local.clone(); }
    }
    return nearest;
  }

  _selectElement(el) {
    this._deselectAll();
    this._selectedEl = el;
    el.setSelected?.(true);
    this._inspectorPanel.show(el);
  }

  _deselectAll() {
    if (this._selectedEl) {
      this._selectedEl.setSelected?.(false);
      this._selectedEl = null;
    }
    this._inspectorPanel.hide();
  }

  _onLongPress(part) {
    this._showContextMenu(part);
  }

  _showContextMenu(part) {
    const existing = document.getElementById('ctx-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'ctx-menu';
    menu.innerHTML = `
      <div class="ctx-item" data-action="delete">Delete</div>
      <div class="ctx-item" data-action="inspect">Inspect</div>
      <div class="ctx-item" data-action="place-organ">Add Organ Here</div>
    `;
    document.body.appendChild(menu);

    const pos = part.mesh.getWorldPosition(new THREE.Vector3());
    menu.style.left = '50%'; menu.style.top = '50%';
    menu.style.transform = 'translate(-50%,-50%)';

    menu.querySelectorAll('.ctx-item').forEach(item => {
      item.addEventListener('click', () => {
        switch (item.dataset.action) {
          case 'delete': this._deletePart(part); break;
          case 'inspect': this._selectElement(part); break;
          case 'place-organ': this._showOrganPicker(part); break;
        }
        menu.remove();
      });
    });

    document.addEventListener('pointerdown', () => menu.remove(), { once: true, capture: true });
  }

  _showOrganPicker(nearPart) {
    const sheet = document.createElement('div');
    sheet.id = 'organ-picker';
    const organs = ['heart','lungs','brain','stomach','eye','ear'];
    sheet.innerHTML = `
      <div class="panel-header"><span>Add Organ</span><button id="organ-picker-close" class="icon-btn">×</button></div>
      <div class="preset-grid">
        ${organs.map(o => `<button class="preset-btn" data-organ="${o}">${o}</button>`).join('')}
      </div>
    `;
    document.body.appendChild(sheet);
    document.getElementById('organ-picker-close')?.addEventListener('click', () => sheet.remove());

    sheet.querySelectorAll('[data-organ]').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.organ;
        const pos = nearPart.physicsBody.position;

        let organ;
        if (type === 'eye') {
          organ = new Eye({ name: 'Eye', position: { x: pos.x, y: pos.y + 0.1, z: pos.z + 0.05 } });
        } else if (type === 'ear') {
          organ = new Ear({ name: 'Ear', position: { x: pos.x + 0.1, y: pos.y + 0.05, z: pos.z } });
        } else {
          const geo = { heart: () => new (THREE.SphereGeometry)(0.06, 10, 8), lungs: () => new (THREE.BoxGeometry)(0.15, 0.12, 0.08), brain: () => new (THREE.SphereGeometry)(0.1, 12, 8), stomach: () => new (THREE.SphereGeometry)(0.07, 10, 8) }[type]?.();
          organ = createOrgan(type, { name: type.charAt(0).toUpperCase() + type.slice(1), position: { x: pos.x, y: pos.y, z: pos.z } });
        }

        if (organ) {
          this._character.addPart(organ);
          this._scene.add(organ.mesh);
          if (type === 'eye') this._emit('eyeAdded', organ);
          if (type === 'ear') this._emit('earAdded', organ);
        }
        sheet.remove();
      });
    });
  }

  _deletePart(part) {
    this._scene.remove(part.mesh);
    this._character.removePart(part.id);
    this._deselectAll();
  }

  _showHint(text) {
    this._removeHint();
    const el = document.createElement('div');
    el.id = 'builder-hint';
    el.textContent = text;
    document.body.appendChild(el);
  }

  _removeHint() {
    document.getElementById('builder-hint')?.remove();
  }

  update() {
    this._orbit.update();
  }

  dispose() {
    this._renderer.domElement.removeEventListener('pointerdown', this._onDown, { capture: true });
    this._renderer.domElement.removeEventListener('pointermove', this._onMove);
    this._renderer.domElement.removeEventListener('pointerup', this._onUp, { capture: true });
    this._orbit.dispose();
    this._el?.remove();
  }
}
