import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { GameLoop } from './GameLoop.js';
import { bus } from './EventBus.js';

import { RigidWorld } from '../physics/RigidWorld.js';
import { AerodynamicsSystem } from '../physics/Aerodynamics.js';
import { FluidSystem } from '../physics/FluidDrag.js';

import { Character } from '../biology/Character.js';

import { FirstPersonView } from '../simulation/FirstPersonView.js';
import { SpatialAudio } from '../simulation/SpatialAudio.js';
import { SimController } from '../simulation/SimController.js';

import { BuilderUI, BUILDER_MODES } from '../ui/BuilderUI.js';
import { ModelingPanel } from '../ui/ModelingPanel.js';
import { InspectorPanel } from '../ui/InspectorPanel.js';
import { WiringEditor } from '../ui/WiringEditor.js';
import { ControlMapper } from '../ui/ControlMapper.js';
import { SimHUD } from '../ui/SimHUD.js';

export class App {
  constructor() {
    this._mode = 'build'; // 'build' | 'simulate'
    this._settleTimer = 0;

    // Renderer
    this._renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('canvas-container').appendChild(this._renderer.domElement);
    window.loadingProgress?.step('scene');

    // Scene
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x1a1a2e);
    this._scene.fog = new THREE.FogExp2(0x1a1a2e, 0.05);

    // Environment
    const pmrem = new THREE.PMREMGenerator(this._renderer);
    const env = pmrem.fromScene(new RoomEnvironment()).texture;
    this._scene.environment = env;

    // Lighting
    const hemi = new THREE.HemisphereLight(0xffeebb, 0x444466, 0.8);
    this._scene.add(hemi);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    this._scene.add(dirLight);

    // Ground grid
    const grid = new THREE.GridHelper(20, 40, 0x444466, 0x333355);
    this._scene.add(grid);

    // Ground mesh (for shadows)
    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 1, metalness: 0 });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this._scene.add(groundMesh);
    window.loadingProgress?.step('physics');

    // Camera
    this._camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 500);
    this._camera.position.set(0, 2, 5);

    // Systems
    this._rigidWorld = new RigidWorld();
    this._aeroSystem = new AerodynamicsSystem();
    this._fluidSystem = new FluidSystem();
    window.loadingProgress?.step('biology');
    this._character = new Character(this._rigidWorld);
    this._fpView = new FirstPersonView(this._renderer);
    this._fpView.setScene(this._scene);
    this._audio = new SpatialAudio();
    this._simController = new SimController(this._character);
    window.loadingProgress?.step('ui');

    // UI panels
    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');
    const bottomPanel = document.getElementById('bottom-panel');
    const uiOverlay = document.getElementById('ui-overlay');

    this._modelingPanel = new ModelingPanel(leftPanel, (geo, matId) => {
      this._builderUI?.beginPlacement(geo, matId);
    });

    this._inspectorPanel = new InspectorPanel(rightPanel, (el, prop, val) => {
      if (prop === 'action:delete') {
        if (el.constructor.name === 'Muscle') {
          this._scene.remove(el.line);
          this._character.removeMuscle(el.id);
        } else if (el.constructor.name === 'Joint') {
          this._scene.remove(el.indicator);
          this._character.removeJoint(el.id);
        } else {
          this._scene.remove(el.mesh);
          this._character.removePart(el.id);
        }
      }
    });

    this._wiringEditor = new WiringEditor({
      scene: this._scene,
      character: this._character,
      renderer: this._renderer,
      camera: this._camera,
    });

    this._controlMapper = new ControlMapper(bottomPanel, this._character, this._simController);

    this._simHUD = new SimHUD(uiOverlay);
    this._simHUD.on('back', () => this.enterBuildMode());
    this._simHUD.on('reset', () => this._character.resetPose());
    this._simHUD.on('input', ({ key, value }) => this._simController.setRaw(key, value));

    // Builder UI (after all panels exist)
    this._builderUI = new BuilderUI({
      renderer: this._renderer,
      scene: this._scene,
      character: this._character,
      physicsWorld: this._rigidWorld,
      modelingPanel: this._modelingPanel,
      inspectorPanel: this._inspectorPanel,
      wiringEditor: this._wiringEditor,
      controlMapper: this._controlMapper,
      camera: this._camera,
    });
    this._builderUI.on('simulate', () => this.enterSimulateMode());
    this._builderUI.on('save', () => this.saveCharacter());
    this._builderUI.on('load', () => this.loadCharacter());
    this._builderUI.on('partAdded', part => {});
    this._builderUI.on('eyeAdded', eye => this._fpView.addEye(eye));
    this._builderUI.on('earAdded', ear => this._audio.addEar(ear));

    // Game loop
    this._loop = new GameLoop(
      (dt, t) => this._update(dt, t),
      (alpha, t) => this._render(alpha, t),
    );

    // Resize
    window.addEventListener('resize', () => this._onResize());

    // Init audio on first touch
    document.addEventListener('pointerdown', () => this._audio.init(), { once: true });
  }

  boot() {
    window.loadingProgress?.step('boot');
    // Try to restore from localStorage
    const saved = localStorage.getItem('synea_character');
    if (saved) {
      try {
        this._loadCharacterFromJson(saved);
      } catch(e) {
        console.warn('Could not restore saved character', e);
      }
    }
    this._loop.start();
    console.log('[Synea] Booted. Ready to build!');
  }

  enterBuildMode() {
    if (this._mode === 'build') return;
    this._mode = 'build';

    this._character.resetPose();
    this._rigidWorld.world.gravity.set(0, -9.82, 0);

    this._simHUD.hide();
    document.getElementById('builder-top-bar').style.display = '';
    document.getElementById('left-panel').style.display = '';
    document.getElementById('right-panel').style.display = '';

    this._builderUI.orbit.enabled = true;
    this._settleTimer = 0;

    // Stop heartbeat sound
    this._audio._stopHeartbeat?.();
  }

  enterSimulateMode() {
    if (this._mode === 'simulate') return;

    // Init audio from user gesture context
    this._audio.init();

    this._mode = 'simulate';
    this._character.saveInitialPose();

    // Settle phase: reduced gravity for 0.5s
    this._rigidWorld.world.gravity.set(0, -9.82 * 0.3, 0);
    this._settleTimer = 0.5;

    document.getElementById('builder-top-bar').style.display = 'none';
    document.getElementById('left-panel').style.display = 'none';
    document.getElementById('right-panel').style.display = 'none';
    this._builderUI.orbit.enabled = false;

    // Rebuild FP view from eyes
    this._fpView.clear();
    for (const eye of this._character.eyes) {
      this._fpView.addEye(eye);
    }

    // Rebuild audio ears
    this._audio.clear();
    for (const ear of this._character.ears) {
      this._audio.addEar(ear);
    }

    // Start heartbeat if heart present
    if (this._character.heart) {
      this._audio.startHeartbeat(this._character.heart.bpm);
    }

    this._simHUD.show();
  }

  _update(dt, elapsed) {
    if (this._mode === 'simulate') {
      // Settle phase
      if (this._settleTimer > 0) {
        this._settleTimer -= dt;
        if (this._settleTimer <= 0) {
          this._rigidWorld.world.gravity.set(0, -9.82, 0);
        }
      }

      // Input → activations
      this._simController.update();

      // Muscle forces
      this._character.applyMuscleForces(dt);

      // Aerodynamics + fluid
      this._aeroSystem.update();
      this._fluidSystem.update();

      // Physics step
      this._rigidWorld.step(dt);

      // Biological systems
      this._character.update(dt);

      // Sync physics bodies → meshes
      this._character.syncPhysics();

      // Eye cameras update
      for (const eye of this._character.eyes) eye.update(dt);

      // Spatial audio
      if (this._character.eyes.length > 0) {
        const eyePos = this._character.eyes[0].mesh.getWorldPosition(new THREE.Vector3());
        this._audio.updateListener(eyePos, this._character.eyes[0].mesh.quaternion);
      }

      // HUD status bars
      this._simHUD.updateBars({
        stamina: this._character.stamina,
        o2: this._character.o2Saturation,
      });

      // Brain effects on view
      const brain = this._character.brain;
      if (brain) {
        this._fpView.setEffects({
          noise: brain.noiseLevel * 0.3,
          vignette: (1 - brain.consciousness) * 0.6,
        });
      }

      // Heartbeat audio sync
      if (this._character.heart) {
        // Already started, BPM update if changed
      }
    } else {
      // Build mode: don't step physics — keep bodies frozen
      this._character.update(dt);
      this._wiringEditor.update();
      this._builderUI.update();
    }
  }

  _render(alpha, elapsed) {
    if (this._mode === 'simulate' && this._fpView.isActive) {
      // Render from eye cameras → composite
      this._fpView.render();
    } else {
      // Standard builder or fallback sim render
      this._renderer.render(this._scene, this._camera);
    }
  }

  saveCharacter() {
    const json = this._character.serialize();
    localStorage.setItem('synea_character', json);

    // Download
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'character.json';
    a.click();
    URL.revokeObjectURL(url);
    this._showToast('Character saved!');
  }

  loadCharacter() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      this._loadCharacterFromJson(text);
    });
    input.click();
  }

  _loadCharacterFromJson(json) {
    // Clear existing scene objects
    for (const part of this._character.parts.values()) {
      this._scene.remove(part.mesh);
    }
    for (const joint of this._character.joints.values()) {
      this._scene.remove(joint.indicator);
    }
    for (const muscle of this._character.muscles.values()) {
      this._scene.remove(muscle.line);
    }

    this._character.deserialize(json);

    // Add all new objects to scene
    for (const part of this._character.parts.values()) {
      this._scene.add(part.mesh);
    }
    for (const joint of this._character.joints.values()) {
      this._scene.add(joint.indicator);
    }
    for (const muscle of this._character.muscles.values()) {
      this._scene.add(muscle.line);
    }

    // Rebuild FP view
    this._fpView.clear();
    for (const eye of this._character.eyes) this._fpView.addEye(eye);

    this._showToast('Character loaded!');
  }

  async loadExample(url) {
    try {
      const resp = await fetch(url);
      const json = await resp.text();
      this._loadCharacterFromJson(json);
    } catch(e) {
      console.error('Failed to load example:', e);
    }
  }

  _showToast(msg, duration = 2000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, duration);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }
}
