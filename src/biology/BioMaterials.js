export const MAT = {
  BONE: {
    id: 'BONE', name: 'Bone',
    density: 1500, youngsModulus: 15e9, damping: 0.1,
    frictionCoeff: 0.4, restitution: 0.1,
    dragCoeff: 0.5, color: 0xf5deb3,
    rigid: true, soft: false,
    fatigueRate: 0, healRate: 0.005,
  },
  CARTILAGE: {
    id: 'CARTILAGE', name: 'Cartilage',
    density: 1100, youngsModulus: 1e6, damping: 0.5,
    frictionCoeff: 0.01, restitution: 0.3,
    dragCoeff: 0.4, color: 0xb0e0e6,
    rigid: false, soft: true,
    fatigueRate: 0, healRate: 0.01,
  },
  MUSCLE_SKELETAL: {
    id: 'MUSCLE_SKELETAL', name: 'Skeletal Muscle',
    density: 1060, youngsModulus: 2e5, damping: 0.4,
    frictionCoeff: 0.3, restitution: 0.1,
    dragCoeff: 0.6, color: 0xcc4444,
    rigid: false, soft: true,
    fatigueRate: 0.1, healRate: 0.02,
    stiffness: 800, contractFactor: 0.65, restFactor: 1.0,
    maxActivationSpeed: 0.8,
  },
  MUSCLE_CARDIAC: {
    id: 'MUSCLE_CARDIAC', name: 'Cardiac Muscle',
    density: 1060, youngsModulus: 1e5, damping: 0.5,
    frictionCoeff: 0.3, restitution: 0.1,
    dragCoeff: 0.6, color: 0xcc2222,
    rigid: false, soft: true,
    fatigueRate: 0.01, healRate: 0.03,
    stiffness: 400, contractFactor: 0.75, restFactor: 1.0,
    bpm: 70, autonomous: true,
  },
  MUSCLE_SMOOTH: {
    id: 'MUSCLE_SMOOTH', name: 'Smooth Muscle',
    density: 1060, youngsModulus: 5e4, damping: 0.6,
    frictionCoeff: 0.3, restitution: 0.05,
    dragCoeff: 0.6, color: 0xaa3333,
    rigid: false, soft: true,
    fatigueRate: 0.02, healRate: 0.04,
    stiffness: 200, contractFactor: 0.8, restFactor: 1.0,
    maxActivationSpeed: 0.2,
  },
  MUSCLE_SPHINCTER: {
    id: 'MUSCLE_SPHINCTER', name: 'Sphincter',
    density: 1060, youngsModulus: 5e4, damping: 0.6,
    frictionCoeff: 0.3, restitution: 0.05,
    dragCoeff: 0.6, color: 0x993333,
    rigid: false, soft: true,
    fatigueRate: 0.02, healRate: 0.04,
    stiffness: 300, contractFactor: 0.5, restFactor: 1.0,
  },
  FAT: {
    id: 'FAT', name: 'Fat',
    density: 920, youngsModulus: 1e4, damping: 0.8,
    frictionCoeff: 0.2, restitution: 0.05,
    dragCoeff: 0.7, color: 0xffd700,
    rigid: false, soft: true,
    fatigueRate: 0, healRate: 0.005,
    energyDensity: 37e6, // J/kg
  },
  SKIN: {
    id: 'SKIN', name: 'Skin',
    density: 1100, youngsModulus: 1.7e5, damping: 0.4,
    frictionCoeff: 0.5, restitution: 0.05,
    dragCoeff: 0.3, color: 0xffcc99,
    rigid: false, soft: true,
    fatigueRate: 0, healRate: 0.015,
  },
  SCALE: {
    id: 'SCALE', name: 'Scale',
    density: 1200, youngsModulus: 5e8, damping: 0.2,
    frictionCoeff: 0.1, restitution: 0.2,
    dragCoeff: 0.2, color: 0x4a7c6f,
    rigid: true, soft: false,
    fatigueRate: 0, healRate: 0.002,
  },
  CHITIN: {
    id: 'CHITIN', name: 'Chitin',
    density: 1300, youngsModulus: 6e9, damping: 0.15,
    frictionCoeff: 0.25, restitution: 0.15,
    dragCoeff: 0.4, color: 0x8b7355,
    rigid: true, soft: false,
    fatigueRate: 0, healRate: 0.001,
  },
  FEATHER: {
    id: 'FEATHER', name: 'Feather',
    density: 300, youngsModulus: 1e6, damping: 0.3,
    frictionCoeff: 0.1, restitution: 0.05,
    dragCoeff: 0.05, liftCoeff: 1.2,
    color: 0xffffff,
    rigid: false, soft: true,
    fatigueRate: 0, healRate: 0.003,
  },
  FIN: {
    id: 'FIN', name: 'Fin',
    density: 1050, youngsModulus: 5e5, damping: 0.4,
    frictionCoeff: 0.15, restitution: 0.05,
    dragCoeff: 0.1, liftCoeff: 0.8,
    color: 0x87ceeb,
    rigid: false, soft: true,
    fatigueRate: 0.01, healRate: 0.01,
  },
};

export function getMaterial(id) {
  return MAT[id] ?? MAT.BONE;
}

export const MATERIAL_COLORS = Object.fromEntries(
  Object.entries(MAT).map(([k, v]) => [k, v.color])
);
