import * as THREE from 'three';
import { Organ } from './Organ.js';

export const EYE_TYPES = {
  STANDARD: 'standard',
  WIDE: 'wide',       // fisheye, barrel distortion
  COMPOUND: 'compound', // mosaic / hexagonal facets
  SLIT: 'slit',        // cat-like, enhanced center depth
  NIGHT: 'night',      // enhanced low-light, more noise
};

let _eyeCounter = 0;

export class Eye extends Organ {
  constructor(options = {}) {
    super({
      ...options,
      organType: 'eye',
      materialId: 'SKIN',
    });

    this._eyeType = options.eyeType ?? EYE_TYPES.STANDARD;
    this._fovAngle = options.fov ?? this._defaultFov();
    this._renderWidth = options.renderWidth ?? 512;
    this._renderHeight = options.renderHeight ?? 512;
    this._eyeIndex = ++_eyeCounter;

    // The THREE.js camera for this eye
    this._camera = new THREE.PerspectiveCamera(
      this._fovAngle,
      this._renderWidth / this._renderHeight,
      0.01,
      500,
    );

    // Render target
    this._renderTarget = new THREE.WebGLRenderTarget(this._renderWidth, this._renderHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    // Angular coverage in the composite view: where does this eye appear on screen
    // Default: centered. Will be updated by FirstPersonView based on eye positions.
    this._screenRegion = { cx: 0.5, cy: 0.5, width: 1.0, height: 1.0 }; // normalized 0-1

    // Color sensitivity (normalized response curves — future extension)
    this._colorSensitivity = options.colorSensitivity ?? { r: 1, g: 1, b: 1 };
    this._nightVision = this._eyeType === EYE_TYPES.NIGHT;
    this._sensitivity = options.sensitivity ?? 1.0;
  }

  get eyeType() { return this._eyeType; }
  get fovAngle() { return this._fovAngle; }
  get camera() { return this._camera; }
  get renderTarget() { return this._renderTarget; }
  get screenRegion() { return this._screenRegion; }
  set screenRegion(v) { this._screenRegion = v; }
  get eyeIndex() { return this._eyeIndex; }
  get nightVision() { return this._nightVision; }
  get sensitivity() { return this._sensitivity; }

  _defaultFov() {
    switch (this._eyeType) {
      case EYE_TYPES.WIDE: return 150;
      case EYE_TYPES.COMPOUND: return 180;
      case EYE_TYPES.SLIT: return 60;
      case EYE_TYPES.NIGHT: return 90;
      default: return 90;
    }
  }

  // Called each frame: sync camera position/orientation to physics body
  update(dt) {
    super.update(dt);
    if (!this._isAlive) return;

    // Sync camera to mesh world transform
    this._camera.position.setFromMatrixPosition(this._mesh.matrixWorld);
    this._camera.quaternion.setFromRotationMatrix(this._mesh.matrixWorld);
  }

  // Returns shader uniforms for this eye type (used by FirstPersonView compositor)
  getShaderUniforms() {
    return {
      eyeType: { value: Object.values(EYE_TYPES).indexOf(this._eyeType) },
      fov: { value: this._fovAngle },
      sensitivity: { value: this._sensitivity },
      nightVision: { value: this._nightVision ? 1 : 0 },
    };
  }

  dispose() {
    super.dispose();
    this._renderTarget.dispose();
  }

  serialize() {
    return {
      ...super.serialize(),
      type: 'Eye',
      organType: 'eye',
      eyeType: this._eyeType,
      fov: this._fovAngle,
      sensitivity: this._sensitivity,
    };
  }

  static deserialize(data) {
    return new Eye({
      id: data.id,
      name: data.name,
      materialId: data.materialId,
      mass: data.mass,
      position: data.position,
      quaternion: data.quaternion,
      eyeType: data.eyeType,
      fov: data.fov,
      sensitivity: data.sensitivity,
    });
  }
}
