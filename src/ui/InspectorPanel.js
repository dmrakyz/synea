import { MAT } from '../biology/BioMaterials.js';
import { JOINT_TYPES } from '../biology/Joint.js';
import { EYE_TYPES } from '../biology/Eye.js';

// Right-side panel showing properties of the selected element.
// Generates form controls dynamically based on element type.

export class InspectorPanel {
  constructor(container, onChange) {
    this._container = container;
    this._onChange = onChange ?? (() => {});
    this._current = null;
    this._el = this._build();
    container.appendChild(this._el);
    this.hide();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'inspector-panel';
    el.innerHTML = `
      <div class="panel-header">
        <span id="inspector-title">Inspector</span>
        <button id="inspector-close" class="icon-btn">×</button>
      </div>
      <div id="inspector-body"></div>
    `;
    el.querySelector('#inspector-close').addEventListener('click', () => this.hide());
    return el;
  }

  show(element) {
    this._current = element;
    this._container.style.display = '';
    this._el.style.display = '';
    this._render();
  }

  hide() {
    this._el.style.display = 'none';
    this._container.style.display = 'none';
    this._current = null;
  }

  refresh() {
    if (this._current) this._render();
  }

  _render() {
    const el = this._current;
    if (!el) return;
    const body = document.getElementById('inspector-body');
    const title = document.getElementById('inspector-title');

    let html = '';

    // Determine element type
    if (el.constructor.name === 'Muscle' || el.type?.startsWith('MUSCLE')) {
      title.textContent = 'Muscle';
      html = this._muscleForm(el);
    } else if (el.constructor.name === 'Joint') {
      title.textContent = 'Joint';
      html = this._jointForm(el);
    } else if (el.constructor.name === 'Eye') {
      title.textContent = 'Eye';
      html = this._eyeForm(el);
    } else if (el.constructor.name === 'Ear') {
      title.textContent = 'Ear';
      html = this._earForm(el);
    } else if (el.organType) {
      title.textContent = el.organType.charAt(0).toUpperCase() + el.organType.slice(1);
      html = this._organForm(el);
    } else {
      title.textContent = 'Body Part';
      html = this._bodyPartForm(el);
    }

    body.innerHTML = html;
    this._bindFormEvents(el);
  }

  _bodyPartForm(el) {
    const matOptions = Object.entries(MAT).map(([k, v]) =>
      `<option value="${k}" ${el.materialId === k ? 'selected' : ''}>${v.name}</option>`
    ).join('');

    return `
      <label class="field">Name
        <input type="text" data-prop="name" value="${el.name ?? ''}">
      </label>
      <label class="field">Material
        <select data-prop="material">${matOptions}</select>
      </label>
      <label class="field">Mass: <span id="mass-val">${el.mass?.toFixed(2) ?? '?'} kg</span></label>
      <div class="field-group">
        <label>Health</label>
        <div class="bar-mini"><div class="bar-fill" style="width:${(el.health ?? 1)*100}%;background:#88ff88"></div></div>
      </div>
      <button class="danger-btn" data-action="delete">Delete Part</button>
    `;
  }

  _muscleForm(el) {
    return `
      <label class="field">Name
        <input type="text" data-prop="name" value="${el.name ?? ''}">
      </label>
      <label class="field">Control Group
        <input type="text" data-prop="controlGroup" value="${el.controlGroup ?? ''}">
      </label>
      <label class="field">Type
        <select data-prop="muscleType">
          ${['MUSCLE_SKELETAL','MUSCLE_CARDIAC','MUSCLE_SMOOTH','MUSCLE_SPHINCTER'].map(t =>
            `<option value="${t}" ${el.type === t ? 'selected' : ''}>${t.replace('MUSCLE_','')}</option>`
          ).join('')}
        </select>
      </label>
      <label class="field">Activation: <span id="act-val">${((el.activation ?? 0)*100).toFixed(0)}%</span>
        <input type="range" min="0" max="1" step="0.01" data-prop="activation" value="${el.activation ?? 0}">
      </label>
      <label class="field">Fatigue: <span>${((el.fatigue ?? 0)*100).toFixed(0)}%</span></label>
      <button class="danger-btn" data-action="delete">Delete Muscle</button>
    `;
  }

  _jointForm(el) {
    const typeOptions = Object.values(JOINT_TYPES).map(t =>
      `<option value="${t}" ${el.type === t ? 'selected' : ''}>${t}</option>`
    ).join('');
    const limits = el.limits ?? {};
    return `
      <label class="field">Type <select data-prop="jointType">${typeOptions}</select></label>
      <label class="field">Low Limit: <input type="range" min="-180" max="0" data-prop="lowLimit" value="${Math.round((limits.low ?? -1.57)*180/Math.PI)}"> <span id="low-val">${Math.round((limits.low ?? -1.57)*180/Math.PI)}°</span></label>
      <label class="field">High Limit: <input type="range" min="0" max="180" data-prop="highLimit" value="${Math.round((limits.high ?? 1.57)*180/Math.PI)}"> <span id="high-val">${Math.round((limits.high ?? 1.57)*180/Math.PI)}°</span></label>
      <button class="danger-btn" data-action="delete">Delete Joint</button>
    `;
  }

  _eyeForm(el) {
    const typeOptions = Object.values(EYE_TYPES).map(t =>
      `<option value="${t}" ${el.eyeType === t ? 'selected' : ''}>${t}</option>`
    ).join('');
    return `
      <label class="field">Name <input type="text" data-prop="name" value="${el.name ?? ''}"></label>
      <label class="field">Eye Type <select data-prop="eyeType">${typeOptions}</select></label>
      <label class="field">FOV: <input type="range" min="30" max="270" data-prop="fov" value="${el.fovAngle}"> <span id="fov-val">${el.fovAngle}°</span></label>
      <label class="field">Sensitivity: <input type="range" min="0.1" max="5" step="0.1" data-prop="sensitivity" value="${el.sensitivity}"> <span id="sens-val">${el.sensitivity}</span></label>
      <div class="field">Status: <strong>${el.isAlive ? '👁 Alive' : '💀 Dead'}</strong></div>
      <button class="danger-btn" data-action="delete">Remove Eye</button>
    `;
  }

  _earForm(el) {
    return `
      <label class="field">Name <input type="text" data-prop="name" value="${el.name ?? ''}"></label>
      <label class="field">Shape
        <select data-prop="earShape">
          ${['round','cupped','flat','large'].map(s => `<option value="${s}" ${el._shape === s ? 'selected':''}>${s}</option>`).join('')}
        </select>
      </label>
      <label class="field">Channel
        <select data-prop="channel">
          <option value="left" ${el.channel==='left'?'selected':''}>Left</option>
          <option value="right" ${el.channel==='right'?'selected':''}>Right</option>
          <option value="center">Center</option>
        </select>
      </label>
      <button class="danger-btn" data-action="delete">Remove Ear</button>
    `;
  }

  _organForm(el) {
    let extra = '';
    if (el.organType === 'heart') {
      extra = `<label class="field">BPM: <input type="range" min="20" max="300" data-prop="bpm" value="${el.bpm ?? 70}"> <span id="bpm-val">${el.bpm ?? 70}</span></label>`;
    } else if (el.organType === 'lungs') {
      extra = `<label class="field">Breath Rate: <input type="range" min="4" max="60" data-prop="breathRate" value="${el.breathRate ?? 15}"> <span></span></label>`;
    }
    return `
      <div class="field">Type: <strong>${el.organType}</strong></div>
      <div class="field">Health: <div class="bar-mini"><div class="bar-fill" style="width:${(el.health ?? 1)*100}%;background:#ff8888"></div></div></div>
      ${extra}
      <button class="danger-btn" data-action="delete">Remove Organ</button>
    `;
  }

  _bindFormEvents(el) {
    const body = document.getElementById('inspector-body');
    if (!body) return;

    body.querySelectorAll('input, select').forEach(input => {
      const update = () => {
        const prop = input.dataset.prop;
        const val = input.type === 'range' ? parseFloat(input.value) : input.value;
        this._applyProp(el, prop, val);

        // Update adjacent display spans
        const id = input.id;
        const nextSpan = input.nextElementSibling;
        if (nextSpan?.tagName === 'SPAN') {
          if (prop === 'fov') nextSpan.textContent = val + '°';
          else if (prop === 'lowLimit' || prop === 'highLimit') nextSpan.textContent = val + '°';
          else if (prop === 'bpm') nextSpan.textContent = val;
          else if (prop === 'sensitivity') nextSpan.textContent = val;
          else if (prop === 'activation') nextSpan.textContent = Math.round(val * 100) + '%';
        }
        this._onChange(el, prop, val);
      };
      input.addEventListener('input', update);
      input.addEventListener('change', update);
    });

    body.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._emit('action', { action: btn.dataset.action, element: el });
        this.hide();
      });
    });
  }

  _applyProp(el, prop, val) {
    switch (prop) {
      case 'name': el.name = val; break;
      case 'material': el.setMaterial?.(val); break;
      case 'controlGroup': el.controlGroup = val; break;
      case 'activation': el.activation = val; break;
      case 'bpm': if (el.bpm !== undefined) el.bpm = val; break;
      case 'fov': el._fovAngle = val; el.camera.fov = val; el.camera.updateProjectionMatrix(); break;
      case 'sensitivity': el._sensitivity = val; break;
      case 'lowLimit': el.setLimits?.({ low: val * Math.PI / 180 }); break;
      case 'highLimit': el.setLimits?.({ high: val * Math.PI / 180 }); break;
    }
  }

  // Simple event emitter on top of onChange
  _emit(type, data) {
    if (type === 'action') this._onChange(data.element, 'action:' + data.action, null);
  }
}
