export class GameLoop {
  constructor(updateFn, renderFn) {
    this._update = updateFn;
    this._render = renderFn;
    this._running = false;
    this._raf = null;
    this._lastTime = 0;
    this._dt = 0;
    this._elapsed = 0;
    this._fixedStep = 1 / 60;
    this._accumulator = 0;
    this._maxDt = 0.05; // cap at 50ms to prevent spiral of death
  }

  get dt() { return this._dt; }
  get elapsed() { return this._elapsed; }
  get fixedStep() { return this._fixedStep; }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  stop() {
    this._running = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  _tick(now) {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._tick.bind(this));

    this._dt = Math.min((now - this._lastTime) / 1000, this._maxDt);
    this._lastTime = now;
    this._elapsed += this._dt;
    this._accumulator += this._dt;

    // Fixed-step physics updates
    while (this._accumulator >= this._fixedStep) {
      this._update(this._fixedStep, this._elapsed);
      this._accumulator -= this._fixedStep;
    }

    // Interpolation alpha (for smooth rendering between physics steps)
    const alpha = this._accumulator / this._fixedStep;
    this._render(alpha, this._elapsed);
  }
}
