// Control mapper panel: binds character control groups to simulation inputs.

const INPUT_OPTIONS = [
  { key: '', label: '— none —' },
  { key: 'up', label: '↑ Swipe Up' },
  { key: 'down', label: '↓ Swipe Down' },
  { key: 'left', label: '← Swipe Left' },
  { key: 'right', label: '→ Swipe Right' },
  { key: 'btnA', label: 'Button A' },
  { key: 'btnB', label: 'Button B' },
  { key: 'tiltX', label: 'Tilt X (roll)' },
  { key: 'tiltY', label: 'Tilt Y (pitch)' },
];

const CURVE_OPTIONS = [
  { key: 'linear', label: 'Linear' },
  { key: 'smooth', label: 'Smooth' },
  { key: 'exponential', label: 'Exponential' },
  { key: 'step', label: 'Step (on/off)' },
];

export class ControlMapper {
  constructor(container, character, simController) {
    this._container = container;
    this._character = character;
    this._simController = simController;
    this._el = this._build();
    container.appendChild(this._el);
    this.hide();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'control-mapper';
    el.innerHTML = `
      <div class="panel-header">
        <span>Control Mapper</span>
        <button id="mapper-close" class="icon-btn">×</button>
      </div>
      <p class="hint">Assign muscle groups to inputs. During simulation, activating an input will contract the group's muscles.</p>
      <div id="mapper-rows"></div>
      <div style="margin-top:12px">
        <button id="mapper-tilt-btn" class="secondary-btn">Enable Tilt Controls</button>
      </div>
    `;
    el.querySelector('#mapper-close').addEventListener('click', () => this.hide());
    el.querySelector('#mapper-tilt-btn').addEventListener('click', () => {
      this._simController.enableTilt().then(() => {
        el.querySelector('#mapper-tilt-btn').textContent = 'Tilt Enabled ✓';
      });
    });
    return el;
  }

  show() {
    this._el.style.display = '';
    this._refresh();
  }

  hide() { this._el.style.display = 'none'; }

  _refresh() {
    const rows = document.getElementById('mapper-rows');
    if (!rows) return;
    rows.innerHTML = '';

    const groups = [...this._character.controlGroups.keys()];
    if (groups.length === 0) {
      rows.innerHTML = '<p class="hint">No control groups yet. Add muscles and assign them control groups in the Inspector.</p>';
      return;
    }

    for (const group of groups) {
      const binding = this._simController.bindings.get(group);
      const row = document.createElement('div');
      row.className = 'mapper-row';

      const inputOptions = INPUT_OPTIONS.map(o =>
        `<option value="${o.key}" ${binding?.inputKey === o.key ? 'selected' : ''}>${o.label}</option>`
      ).join('');

      const curveOptions = CURVE_OPTIONS.map(o =>
        `<option value="${o.key}" ${binding?.curve === o.key ? 'selected' : ''}>${o.label}</option>`
      ).join('');

      row.innerHTML = `
        <div class="mapper-group-name">${group}</div>
        <div class="mapper-controls">
          <select class="mapper-input" data-group="${group}">${inputOptions}</select>
          <select class="mapper-curve" data-group="${group}">${curveOptions}</select>
        </div>
      `;
      rows.appendChild(row);
    }

    // Bind events
    rows.querySelectorAll('.mapper-input').forEach(sel => {
      sel.addEventListener('change', () => {
        const group = sel.dataset.group;
        const inputKey = sel.value;
        const curveEl = rows.querySelector(`.mapper-curve[data-group="${group}"]`);
        const curve = curveEl?.value ?? 'linear';
        if (inputKey) {
          this._simController.addBinding(group, inputKey, curve);
        } else {
          this._simController.removeBinding(group);
        }
      });
    });

    rows.querySelectorAll('.mapper-curve').forEach(sel => {
      sel.addEventListener('change', () => {
        const group = sel.dataset.group;
        const inputEl = rows.querySelector(`.mapper-input[data-group="${group}"]`);
        const inputKey = inputEl?.value ?? '';
        if (inputKey) {
          this._simController.addBinding(group, inputKey, sel.value);
        }
      });
    });
  }
}
