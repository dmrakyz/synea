import * as THREE from 'three';

// Composite first-person view from multiple eye cameras.
// Each Eye renders to its own WebGLRenderTarget.
// A full-screen quad shader composites all eye views onto the screen.

const COMPOSITE_VERT = `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const COMPOSITE_FRAG = `
uniform sampler2D uEyeTex0;
uniform sampler2D uEyeTex1;
uniform sampler2D uEyeTex2;
uniform sampler2D uEyeTex3;

uniform int uEyeCount;
uniform vec4 uRegion0;
uniform vec4 uRegion1;
uniform vec4 uRegion2;
uniform vec4 uRegion3;

uniform int uEyeType0;
uniform int uEyeType1;
uniform int uEyeType2;
uniform int uEyeType3;

uniform float uNoise;
uniform float uVignette;

in vec2 vUv;
out vec4 fragColor;

vec2 compoundOffset(vec2 uv, float scale) {
  vec2 grid = floor(uv * scale);
  vec2 center = (grid + 0.5) / scale;
  float angle = (sin(grid.x * 127.1 + grid.y * 311.7) * 0.5 + 0.5) * 0.1 - 0.05;
  float c = cos(angle), s = sin(angle);
  vec2 dir = uv - center;
  return center + vec2(c * dir.x - s * dir.y, s * dir.x + c * dir.y) * 0.95;
}

vec4 sampleEye(sampler2D tex, vec2 uv, int eyeType) {
  if (eyeType == 1) {
    vec2 d = uv - 0.5;
    float r2 = dot(d, d);
    uv = 0.5 + d * (1.0 + 0.3 * r2 + 0.15 * r2 * r2);
  } else if (eyeType == 2) {
    uv = compoundOffset(uv, 12.0);
  } else if (eyeType == 3) {
    float strength = 1.0 - smoothstep(0.0, 0.5, abs(uv.x - 0.5));
    uv.y = 0.5 + (uv.y - 0.5) * (1.0 + strength * 0.3);
  }
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec4 col = texture(tex, uv);
  if (eyeType == 4) {
    col.rgb = vec3(col.r * 0.1, col.g * 1.5 + col.b * 0.5, col.b * 0.1);
    col.rgb = pow(col.rgb, vec3(0.5));
  }
  return col;
}

void sampleRegion(sampler2D tex, vec4 region, int eyeType, inout vec4 color, inout float weight) {
  float x0 = region.x - region.z * 0.5;
  float x1 = region.x + region.z * 0.5;
  float y0 = region.y - region.w * 0.5;
  float y1 = region.y + region.w * 0.5;
  if (vUv.x >= x0 && vUv.x <= x1 && vUv.y >= y0 && vUv.y <= y1) {
    vec2 eyeUv = vec2((vUv.x - x0) / region.z, (vUv.y - y0) / region.w);
    color += sampleEye(tex, eyeUv, eyeType);
    weight += 1.0;
  }
}

void main() {
  vec4 color = vec4(0.0);
  float weight = 0.0;

  if (uEyeCount > 0) sampleRegion(uEyeTex0, uRegion0, uEyeType0, color, weight);
  if (uEyeCount > 1) sampleRegion(uEyeTex1, uRegion1, uEyeType1, color, weight);
  if (uEyeCount > 2) sampleRegion(uEyeTex2, uRegion2, uEyeType2, color, weight);
  if (uEyeCount > 3) sampleRegion(uEyeTex3, uRegion3, uEyeType3, color, weight);

  if (weight > 0.0) color /= weight;

  if (uNoise > 0.0) {
    float n = fract(sin(dot(vUv * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
    color.rgb = mix(color.rgb, vec3(n), uNoise);
  }
  if (uVignette > 0.0) {
    float vig = smoothstep(0.4, 0.0, length(vUv - 0.5));
    color.rgb = mix(color.rgb, vec3(0.0), uVignette * (1.0 - vig));
  }

  fragColor = color;
}
`;

export class FirstPersonView {
  constructor(renderer) {
    this._renderer = renderer;
    this._eyes = [];
    this._scene = null;

    // Full-screen quad for composite
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    this._compositeMat = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uEyeTex0: { value: null }, uEyeTex1: { value: null },
        uEyeTex2: { value: null }, uEyeTex3: { value: null },
        uEyeCount: { value: 0 },
        uRegion0: { value: new THREE.Vector4(0.5, 0.5, 1, 1) },
        uRegion1: { value: new THREE.Vector4(0.5, 0.5, 1, 1) },
        uRegion2: { value: new THREE.Vector4(0.5, 0.5, 1, 1) },
        uRegion3: { value: new THREE.Vector4(0.5, 0.5, 1, 1) },
        uEyeType0: { value: 0 }, uEyeType1: { value: 0 },
        uEyeType2: { value: 0 }, uEyeType3: { value: 0 },
        uNoise: { value: 0 },
        uVignette: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this._quadMesh = new THREE.Mesh(quadGeo, this._compositeMat);
    this._quadScene = new THREE.Scene();
    this._quadScene.add(this._quadMesh);
    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  get isActive() { return this._eyes.length > 0; }

  setScene(scene) { this._scene = scene; }

  addEye(eye) {
    if (this._eyes.length >= 4) { console.warn('FirstPersonView: max 4 eyes supported'); return; }
    this._eyes.push(eye);
    this._updateRegions();
    this._updateUniforms();
  }

  removeEye(eye) {
    this._eyes = this._eyes.filter(e => e !== eye);
    this._updateRegions();
    this._updateUniforms();
  }

  clear() { this._eyes = []; this._updateUniforms(); }

  // Compute screen regions based on eye positions and count
  _updateRegions() {
    const count = this._eyes.length;
    if (count === 0) return;

    if (count === 1) {
      // Single eye: full screen
      this._eyes[0].screenRegion = { cx: 0.5, cy: 0.5, width: 1.0, height: 1.0 };
    } else if (count === 2) {
      // Two eyes: estimate based on positions
      const e0 = this._eyes[0], e1 = this._eyes[1];
      const pos0 = e0.physicsBody.position;
      const pos1 = e1.physicsBody.position;
      const dx = pos1.x - pos0.x;
      // Horizontal separation → side-by-side with overlap
      const overlap = 0.2;
      e0.screenRegion = { cx: 0.35, cy: 0.5, width: 0.7 + overlap, height: 1.0 };
      e1.screenRegion = { cx: 0.65, cy: 0.5, width: 0.7 + overlap, height: 1.0 };
    } else {
      // 3-4 eyes: quadrant layout
      const regions = [
        { cx: 0.25, cy: 0.75, width: 0.5, height: 0.5 },
        { cx: 0.75, cy: 0.75, width: 0.5, height: 0.5 },
        { cx: 0.25, cy: 0.25, width: 0.5, height: 0.5 },
        { cx: 0.75, cy: 0.25, width: 0.5, height: 0.5 },
      ];
      for (let i = 0; i < Math.min(count, 4); i++) {
        this._eyes[i].screenRegion = regions[i];
      }
    }
  }

  _updateUniforms() {
    const u = this._compositeMat.uniforms;
    u.uEyeCount.value = Math.min(this._eyes.length, 4);
    const texKeys = ['uEyeTex0', 'uEyeTex1', 'uEyeTex2', 'uEyeTex3'];
    const regKeys = ['uRegion0', 'uRegion1', 'uRegion2', 'uRegion3'];
    const typeKeys = ['uEyeType0', 'uEyeType1', 'uEyeType2', 'uEyeType3'];
    const EYE_TYPE_MAP = { standard: 0, wide: 1, compound: 2, slit: 3, night: 4 };

    for (let i = 0; i < 4; i++) {
      const eye = this._eyes[i];
      if (eye) {
        u[texKeys[i]].value = eye.renderTarget.texture;
        const r = eye.screenRegion;
        u[regKeys[i]].value.set(r.cx, r.cy, r.width, r.height);
        u[typeKeys[i]].value = EYE_TYPE_MAP[eye.eyeType] ?? 0;
      } else {
        u[texKeys[i]].value = null;
      }
    }
  }

  // Set effect uniforms (called by App based on brain state)
  setEffects({ noise = 0, vignette = 0 } = {}) {
    this._compositeMat.uniforms.uNoise.value = noise;
    this._compositeMat.uniforms.uVignette.value = vignette;
  }

  // Render all eye cameras to their render targets, then composite
  render() {
    if (!this._scene || this._eyes.length === 0) return;

    for (const eye of this._eyes) {
      if (!eye.isAlive) continue;
      this._renderer.setRenderTarget(eye.renderTarget);
      this._renderer.render(this._scene, eye.camera);
    }
    this._renderer.setRenderTarget(null);
    this._renderer.render(this._quadScene, this._quadCamera);
  }

  // Build status: any eye region not covered by an eye = blind spot (returned as coverage %)
  getCoverage() {
    return this._eyes.filter(e => e.isAlive).length / Math.max(1, this._eyes.length);
  }

  dispose() {
    this._compositeMat.dispose();
    this._quadMesh.geometry.dispose();
  }
}
