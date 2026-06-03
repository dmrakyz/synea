// Simulation HUD: swipe zones, action buttons, status bars.
// Fires events via callbacks when inputs change.

export class SimHUD {
  constructor(container) {
    this._container = container;
    this._el = null;
    this._inputState = { up: 0, down: 0, left: 0, right: 0, btnA: 0, btnB: 0 };
    this._listeners = new Map();
    this._activePointers = new Map(); // pointerId → zone
    this._build();
  }

  get inputState() { return { ...this._inputState }; }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
  }

  _emit(event, data) {
    this._listeners.get(event)?.forEach(fn => fn(data));
  }

  _build() {
    this._el = document.createElement('div');
    this._el.id = 'sim-hud';
    this._el.innerHTML = `
      <div id="sim-top-bar">
        <button id="btn-back-build" class="sim-top-btn">← Build</button>
        <div id="sim-status">
          <div class="status-bar" id="bar-stamina" title="Stamina">
            <span class="bar-label">♥</span>
            <div class="bar-fill" id="fill-stamina"></div>
          </div>
          <div class="status-bar" id="bar-o2" title="O₂">
            <span class="bar-label">~</span>
            <div class="bar-fill" id="fill-o2" style="background:#88ccff"></div>
          </div>
        </div>
        <button id="btn-reset-sim" class="sim-top-btn">⟳</button>
      </div>

      <div class="sim-zone" id="zone-up" data-zone="up">
        <div class="zone-icon">↑</div>
      </div>
      <div class="sim-zone" id="zone-down" data-zone="down">
        <div class="zone-icon">↓</div>
      </div>
      <div class="sim-zone" id="zone-left" data-zone="left">
        <div class="zone-icon">←</div>
      </div>
      <div class="sim-zone" id="zone-right" data-zone="right">
        <div class="zone-icon">→</div>
      </div>

      <div id="sim-action-btns">
        <button class="action-btn" id="btn-action-a" data-zone="btnA">A</button>
        <button class="action-btn" id="btn-action-b" data-zone="btnB">B</button>
      </div>
    `;
    this._container.appendChild(this._el);
    this._hide();
    this._bindEvents();
  }

  _bindEvents() {
    // Swipe zones
    const zones = this._el.querySelectorAll('.sim-zone');
    zones.forEach(z => {
      const zoneName = z.dataset.zone;
      z.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._activePointers.set(e.pointerId, zoneName);
        this._setZone(zoneName, 1);
        z.classList.add('active');
      }, { passive: false });
    });

    // Action buttons
    const btns = this._el.querySelectorAll('.action-btn');
    btns.forEach(btn => {
      const zoneName = btn.dataset.zone;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._activePointers.set(e.pointerId, zoneName);
        this._setZone(zoneName, 1);
        btn.classList.add('active');
      }, { passive: false });
    });

    // Global pointer up/cancel
    this._el.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this._el.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    this._el.addEventListener('pointermove', (e) => e.preventDefault(), { passive: false });

    // Back / Reset
    document.getElementById('btn-back-build')?.addEventListener('click', () => this._emit('back'));
    document.getElementById('btn-reset-sim')?.addEventListener('click', () => this._emit('reset'));
  }

  _onPointerUp(e) {
    const zoneName = this._activePointers.get(e.pointerId);
    if (!zoneName) return;
    this._activePointers.delete(e.pointerId);

    // Check if any other pointer still holds this zone
    const stillHeld = [...this._activePointers.values()].includes(zoneName);
    if (!stillHeld) {
      this._setZone(zoneName, 0);
      const el = this._el.querySelector(`[data-zone="${zoneName}"]`);
      el?.classList.remove('active');
    }
  }

  _setZone(name, value) {
    this._inputState[name] = value;
    this._emit('input', { key: name, value });
  }

  updateBars({ stamina = 1, o2 = 1 } = {}) {
    const fs = document.getElementById('fill-stamina');
    const fo = document.getElementById('fill-o2');
    if (fs) { fs.style.width = (stamina * 100) + '%'; fs.style.background = `hsl(${stamina * 120}, 70%, 45%)`; }
    if (fo) fo.style.width = (o2 * 100) + '%';
  }

  show() { this._el.style.display = ''; }
  _hide() { this._el.style.display = 'none'; }
  hide() { this._hide(); this._activePointers.clear(); Object.keys(this._inputState).forEach(k => this._inputState[k] = 0); }

  dispose() { this._el.remove(); }
}
