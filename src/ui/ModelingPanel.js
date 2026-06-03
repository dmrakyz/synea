import * as THREE from 'three';
import { LatheModeler } from '../modeling/LatheModeler.js';
import { ExtrudeModeler } from '../modeling/ExtrudeModeler.js';
import { MAT } from '../biology/BioMaterials.js';

// Left panel for creating body part shapes via lathe or extrude tools.
// Provides a 2D canvas for profile/cross-section editing and exposes
// the finished geometry + selected material via onShapeCreated callback.

export class ModelingPanel {
  constructor(container, onShapeCreated) {
    this._container = container;
    this._onShapeCreated = onShapeCreated ?? (() => {});
    this._mode = 'lathe'; // 'lathe' | 'extrude' | 'preset'
    this._lathe = new LatheModeler();
    this._extrude = ExtrudeModeler.limb();
    this._selectedMat = 'BONE';
    this._canvas = null;
    this._ctx2d = null;
    this._draggingPoint = -1;
    this._el = this._build();
    container.appendChild(this._el);
    this.hide();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'modeling-panel';

    const matOptions = Object.entries(MAT).map(([k, v]) =>
      `<option value="${k}">${v.name}</option>`
    ).join('');

    el.innerHTML = `
      <div class="panel-header">
        <span>Modeler</span>
        <button id="model-close" class="icon-btn">×</button>
      </div>

      <div class="mode-tabs">
        <button class="mode-tab active" data-mode="preset">Presets</button>
        <button class="mode-tab" data-mode="lathe">Lathe</button>
        <button class="mode-tab" data-mode="extrude">Extrude</button>
      </div>

      <div id="model-preset" class="mode-panel">
        <p class="hint">Quick shapes:</p>
        <div class="preset-grid" id="preset-grid"></div>
      </div>

      <div id="model-lathe" class="mode-panel" style="display:none">
        <p class="hint">Tap canvas to add profile points. Drag to move. Shape revolves around Y axis.</p>
        <canvas id="lathe-canvas" width="220" height="280" style="border:1px solid #444;touch-action:none;cursor:crosshair;width:100%;max-width:220px;display:block;margin:0 auto"></canvas>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button id="lathe-clear" class="secondary-btn" style="flex:1">Clear</button>
          <input type="range" id="lathe-segs" min="6" max="32" value="16" style="flex:2" title="Segments">
        </div>
      </div>

      <div id="model-extrude" class="mode-panel" style="display:none">
        <p class="hint">Choose cross-section and taper for the extrude path.</p>
        <label class="field">Cross-section
          <select id="extrude-cs">
            <option value="circle">Circle</option>
            <option value="oval">Oval</option>
            <option value="triangle">Triangle</option>
          </select>
        </label>
        <label class="field">Radius: <input type="range" id="extrude-radius" min="0.01" max="0.3" step="0.01" value="0.05"> <span id="radius-val">0.05</span></label>
        <label class="field">Taper: <input type="range" id="extrude-taper" min="0.01" max="1" step="0.01" value="0.7"> <span id="taper-val">0.7</span></label>
        <label class="field">Twist: <input type="range" id="extrude-twist" min="0" max="6.28" step="0.1" value="0"> <span id="twist-val">0</span></label>
        <label class="field">Path points: Use 3D viewport in Extrude mode</label>
      </div>

      <label class="field" style="margin-top:8px">Material
        <select id="model-material">${matOptions}</select>
      </label>

      <button id="model-create" class="primary-btn" style="width:100%;margin-top:8px">Create Part</button>
    `;

    this._el = el;
    return el;
  }

  show() {
    this._container.style.display = '';
    this._el.style.display = '';
    this._bindEvents();
    this._buildPresets();
    this._initLatheCanvas();
  }

  hide() {
    this._el.style.display = 'none';
    this._container.style.display = 'none';
  }

  _bindEvents() {
    if (this._eventsBound) return;
    this._eventsBound = true;

    document.getElementById('model-close')?.addEventListener('click', () => this.hide());

    // Mode tabs
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._mode = tab.dataset.mode;
        document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.mode-panel').forEach(p => p.style.display = 'none');
        document.getElementById(`model-${this._mode}`)?.style.setProperty('display', '');
        if (this._mode === 'lathe') this._initLatheCanvas();
      });
    });

    // Extrude controls
    document.getElementById('extrude-radius')?.addEventListener('input', (e) => {
      const r = parseFloat(e.target.value);
      document.getElementById('radius-val').textContent = r.toFixed(2);
      const cs = document.getElementById('extrude-cs')?.value ?? 'circle';
      this._updateExtrudeCS(cs, r);
    });
    document.getElementById('extrude-taper')?.addEventListener('input', (e) => {
      this._extrude.taper = parseFloat(e.target.value);
      document.getElementById('taper-val').textContent = e.target.value;
    });
    document.getElementById('extrude-twist')?.addEventListener('input', (e) => {
      this._extrude.twist = parseFloat(e.target.value);
      document.getElementById('twist-val').textContent = parseFloat(e.target.value).toFixed(2);
    });
    document.getElementById('extrude-cs')?.addEventListener('change', (e) => {
      const r = parseFloat(document.getElementById('extrude-radius')?.value ?? 0.05);
      this._updateExtrudeCS(e.target.value, r);
    });

    document.getElementById('lathe-clear')?.addEventListener('click', () => {
      this._lathe = new LatheModeler();
      this._drawLatheCanvas();
    });
    document.getElementById('lathe-segs')?.addEventListener('input', (e) => {
      this._lathe.segments = parseInt(e.target.value);
    });

    document.getElementById('model-material')?.addEventListener('change', (e) => {
      this._selectedMat = e.target.value;
    });

    document.getElementById('model-create')?.addEventListener('click', () => this._createShape());
  }

  _updateExtrudeCS(type, r) {
    switch (type) {
      case 'circle': this._extrude.crossSection = ExtrudeModeler.circleCrossSection(r); break;
      case 'oval': this._extrude.crossSection = ExtrudeModeler.ovalCrossSection(r, r * 0.6); break;
      case 'triangle': this._extrude.crossSection = ExtrudeModeler.triangleCrossSection(r); break;
    }
  }

  _buildPresets() {
    const grid = document.getElementById('preset-grid');
    if (!grid || grid.children.length > 0) return;

    const presets = [
      { label: 'Capsule (S)', fn: () => LatheModeler.capsuleProfile(0.05, 0.3).build() },
      { label: 'Capsule (M)', fn: () => LatheModeler.capsuleProfile(0.1, 0.5).build() },
      { label: 'Torso', fn: () => LatheModeler.torsoProfile(0.2, 0.5).build() },
      { label: 'Head', fn: () => LatheModeler.headProfile(0.15, 0.25).build() },
      { label: 'Limb', fn: () => ExtrudeModeler.limb(0.4, 0.04).build() },
      { label: 'Tail', fn: () => ExtrudeModeler.tail(0.8, 0.06, 0.01).build() },
      { label: 'Fin', fn: () => LatheModeler.finProfile(0.3, 0.08).build() },
      { label: 'Box S', fn: () => new THREE.BoxGeometry(0.15, 0.15, 0.15) },
      { label: 'Box M', fn: () => new THREE.BoxGeometry(0.25, 0.35, 0.2) },
      { label: 'Sphere S', fn: () => new THREE.SphereGeometry(0.07, 12, 8) },
      { label: 'Sphere M', fn: () => new THREE.SphereGeometry(0.12, 16, 12) },
      { label: 'Organ', fn: () => new THREE.SphereGeometry(0.08, 12, 8) },
    ];

    for (const p of presets) {
      const btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.textContent = p.label;
      btn.addEventListener('click', () => {
        const geo = p.fn();
        if (geo) this._onShapeCreated(geo, this._selectedMat);
      });
      grid.appendChild(btn);
    }
  }

  _initLatheCanvas() {
    const canvas = document.getElementById('lathe-canvas');
    if (!canvas || this._canvas === canvas) return;
    this._canvas = canvas;
    this._ctx2d = canvas.getContext('2d');
    this._drawLatheCanvas();

    canvas.addEventListener('pointerdown', (e) => this._onLatheDown(e), { passive: false });
    canvas.addEventListener('pointermove', (e) => this._onLatheMove(e), { passive: false });
    canvas.addEventListener('pointerup', () => { this._draggingPoint = -1; });
  }

  _canvasToProfile(cx, cy) {
    // Canvas: 220×280; X axis = radius (0 to 0.5), Y axis = height (0 to 1)
    const W = 220, H = 280;
    return { x: cx / W * 0.5, y: (H - cy) / H };
  }

  _profileToCanvas(x, y) {
    const W = 220, H = 280;
    return { cx: x / 0.5 * W, cy: H - y * H };
  }

  _onLatheDown(e) {
    e.preventDefault();
    const rect = this._canvas.getBoundingClientRect();
    const scaleX = 220 / rect.width;
    const scaleY = 280 / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    // Check if near an existing point
    let nearest = -1, nearDist = 20;
    for (let i = 0; i < this._lathe.points.length; i++) {
      const p = this._lathe.points[i];
      const c = this._profileToCanvas(p.x, p.y);
      const d = Math.hypot(cx - c.cx, cy - c.cy);
      if (d < nearDist) { nearest = i; nearDist = d; }
    }

    if (nearest >= 0) {
      this._draggingPoint = nearest;
    } else {
      const { x, y } = this._canvasToProfile(cx, cy);
      this._lathe.addPoint(x, y);
      this._draggingPoint = this._lathe.points.length - 1;
      this._drawLatheCanvas();
    }
  }

  _onLatheMove(e) {
    if (this._draggingPoint < 0) return;
    e.preventDefault();
    const rect = this._canvas.getBoundingClientRect();
    const scaleX = 220 / rect.width;
    const scaleY = 280 / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const { x, y } = this._canvasToProfile(cx, cy);
    this._lathe.movePoint(this._draggingPoint, x, y);
    this._drawLatheCanvas();
  }

  _drawLatheCanvas() {
    const ctx = this._ctx2d;
    if (!ctx) return;
    const W = 220, H = 280;
    ctx.clearRect(0, 0, W, H);

    // Background grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= W; x += 22) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Axis line (Y axis = center)
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, H); ctx.stroke();

    const pts = this._lathe.points;
    if (pts.length < 2) {
      ctx.fillStyle = '#888';
      ctx.font = '12px sans-serif';
      ctx.fillText('Tap to add points', 10, H / 2);
      return;
    }

    // Draw profile line
    ctx.beginPath();
    ctx.strokeStyle = '#88aaff'; ctx.lineWidth = 2;
    for (let i = 0; i < pts.length; i++) {
      const c = this._profileToCanvas(pts[i].x, pts[i].y);
      if (i === 0) ctx.moveTo(c.cx, c.cy);
      else ctx.lineTo(c.cx, c.cy);
    }
    ctx.stroke();

    // Draw revolved silhouette (mirror on left)
    ctx.beginPath();
    ctx.strokeStyle = '#446688'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    for (let i = pts.length - 1; i >= 0; i--) {
      const c = this._profileToCanvas(-pts[i].x, pts[i].y);
      if (i === pts.length - 1) ctx.moveTo(c.cx + W, c.cy);
      else ctx.lineTo(c.cx + W, c.cy);
    }
    ctx.stroke(); ctx.setLineDash([]);

    // Draw control points
    for (let i = 0; i < pts.length; i++) {
      const c = this._profileToCanvas(pts[i].x, pts[i].y);
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = this._draggingPoint === i ? '#ffff00' : '#88aaff';
      ctx.fill();
    }
  }

  _createShape() {
    let geo = null;
    if (this._mode === 'lathe') {
      geo = this._lathe.build();
    } else if (this._mode === 'extrude') {
      if (this._extrude.pathPoints.length < 2) {
        this._extrude.addPathPoint(new THREE.Vector3(0, 0, 0));
        this._extrude.addPathPoint(new THREE.Vector3(0, -0.4, 0));
      }
      geo = this._extrude.build();
    }
    if (geo) this._onShapeCreated(geo, this._selectedMat);
  }

  setExtrudePath(pathPoints) {
    this._extrude._pathPoints = pathPoints.map(p => p.clone());
  }
}
