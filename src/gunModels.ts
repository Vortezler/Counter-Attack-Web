/**
 * Textured gun models from the CC0 "3D Low-Poly Guns Pack" by Polyy (polyy.ai), shrunk for
 * the web (see public/models/LICENSE-polyy-guns.txt). Each is turned so the muzzle points
 * down -z, scaled to the real gun's length, and shifted so its pistol grip sits where the
 * hands and the third-person rig expect it: on the origin's vertical, at the same height and
 * depth as the procedural models' grips.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTFParser } from "three/addons/loaders/GLTFLoader.js";

interface Fit {
  file: string;
  /** Overall length of the real gun, muzzle to buttstock, in metres. */
  length: number;
  /** Which model axis the barrel runs along, and which way the muzzle faces on it (the pack's
   * readme says -x, but most files point +x / +z; the polymer pistol is the exception). */
  axis: "x" | "z";
  muzzle: 1 | -1;
  /** Pistol grip centre (wrist of the stock on the shotgun), relative to the fitted model's
   * bounding-box centre: height and depth (+z toward the stock). Measured on a 5 cm grid. */
  grip: [number, number];
  /** The detachable magazine, same frame as `grip`: [bottom, top, front, back]. */
  mag?: [number, number, number, number];
  /** Where shells go in (shotguns), same frame: [height, depth]. */
  port?: [number, number];
}
const fits: Record<string, Fit> = {
  ak: { file: "wood_furniture_assault_rifle", length: 0.88, axis: "x", muzzle: 1, grip: [-0.022, 0.225], mag: [-0.161, 0.005, -0.043, 0.124] },
  m4a4: { file: "modern_tactical_carbine", length: 0.8, axis: "x", muzzle: 1, grip: [-0.081, 0.16], mag: [-0.21, -0.012, -0.091, 0.031] },
  m4: { file: "modern_tactical_carbine", length: 0.8, axis: "x", muzzle: 1, grip: [-0.081, 0.16], mag: [-0.21, -0.012, -0.091, 0.031] },
  aug: { file: "bullpup_rifle", length: 0.76, axis: "z", muzzle: 1, grip: [-0.116, 0.017], mag: [-0.2, -0.04, 0.04, 0.13] },
  p90: { file: "compact_submachine_gun", length: 0.55, axis: "x", muzzle: 1, grip: [-0.088, 0.18], mag: [-0.194, -0.006, -0.096, 0.006] },
  glock: { file: "compact_polymer_pistol", length: 0.19, axis: "x", muzzle: -1, grip: [-0.036, 0.0625], mag: [-0.08, -0.05, 0.035, 0.09] },
  deagle: { file: "six_shot_revolver", length: 0.29, axis: "z", muzzle: 1, grip: [-0.037, 0.111] },
  awp: { file: "bolt_action_sniper_rifle", length: 1.18, axis: "x", muzzle: 1, grip: [-0.05, 0.316], mag: [-0.1, -0.01, 0.076, 0.216] },
  ssg: { file: "bolt_action_sniper_rifle", length: 1.06, axis: "x", muzzle: 1, grip: [-0.045, 0.284], mag: [-0.09, -0.009, 0.068, 0.194] },
  nova: { file: "pump_action_shotgun", length: 1.0, axis: "x", muzzle: 1, grip: [-0.017, 0.268], port: [-0.01, 0.09] },
  xm: { file: "pump_action_shotgun", length: 1.0, axis: "x", muzzle: 1, grip: [-0.017, 0.268], port: [-0.01, 0.09] },
  negev: { file: "belt_fed_light_machine_gun", length: 1.0, axis: "x", muzzle: 1, grip: [-0.085, 0.259], mag: [-0.195, 0.03, -0.029, 0.098] },
};
/** Where the procedural models put the pistol grip: hands and IK targets are tuned to it. */
const GRIP = new THREE.Vector3(0, -0.075, 0.035);
const loaded = new Map<string, THREE.Object3D>();
let pending: Promise<void> | null = null;

/**
 * Decodes a GLB's embedded textures straight from its bytes. The stock loader goes through a
 * blob: URL fetch, which the page's Content-Security-Policy (rightly) refuses.
 */
function inlineImages(parser: GLTFParser) {
  const images = new Map<number, Promise<THREE.Texture>>();
  parser.loadImageSource = (index: number) => {
    let made = images.get(index);
    if (!made) {
      const source = parser.json.images[index];
      made = parser
        .getDependency("bufferView", source.bufferView)
        .then((bytes: ArrayBuffer) => createImageBitmap(new Blob([bytes], { type: source.mimeType })))
        .then((bitmap: ImageBitmap) => {
          const texture = new THREE.Texture(bitmap);
          texture.needsUpdate = true;
          return texture;
        });
      images.set(index, made);
    }
    return made.then((t) => t.clone());
  };
  return { name: "inline_images" };
}
/** Fetches every model once; resolves even if some fail, which then keep the procedural look. */
export function loadGunModels(base: string) {
  pending ??= (async () => {
    const loader = new GLTFLoader().register((parser) => inlineImages(parser)),
      files = [...new Set(Object.values(fits).map((f) => f.file))];
    await Promise.all(
      files.map(async (file) => {
        try {
          const gltf = await loader.loadAsync(`${base}models/${file}.glb`);
          gltf.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.castShadow = m.receiveShadow = true;
            const mat = m.material as THREE.MeshStandardMaterial;
            // Shared by every copy, so the renderer's per-model cleanup must leave them alone.
            m.geometry.userData.shared = true;
            mat.userData.shared = true;
            for (const t of [mat.map, mat.metalnessMap, mat.roughnessMap, mat.normalMap])
              if (t) t.userData.shared = true;
          });
          loaded.set(file, gltf.scene);
        } catch (err) {
          console.warn("Gun model unavailable, using the built-in one:", file, err);
        }
      }),
    );
  })();
  return pending;
}

/** A fitted copy of the textured model for `id`, or null when there is none (or not loaded). */
export function gunModel(id: string) {
  const fit = fits[id],
    source = fit && loaded.get(fit.file);
  if (!fit || !source) return null;
  const inner = source.clone(true),
    turn = new THREE.Group(),
    outer = new THREE.Group();
  turn.add(inner);
  // Barrel onto -z: a model along x turns a quarter, one along z turns around or not at all.
  turn.rotation.y = fit.axis === "x" ? (fit.muzzle < 0 ? -Math.PI / 2 : Math.PI / 2) : fit.muzzle < 0 ? 0 : Math.PI;
  turn.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(turn),
    size = box.getSize(new THREE.Vector3()),
    scale = fit.length / size.z;
  turn.scale.setScalar(scale);
  turn.updateMatrixWorld(true);
  box.setFromObject(turn);
  // Centre it, then slide so the grip lands on GRIP.
  const centre = box.getCenter(new THREE.Vector3());
  turn.position.set(-centre.x, -centre.y + GRIP.y - fit.grip[0], -centre.z + GRIP.z - fit.grip[1]);
  outer.add(turn);
  outer.userData.textured = true;
  // Magazine and loading port in the fitted frame, for the reload animation.
  const dy = GRIP.y - fit.grip[0],
    dz = GRIP.z - fit.grip[1],
    half = size.x * scale * 0.65;
  if (fit.mag)
    outer.userData.mag = new THREE.Box3(
      new THREE.Vector3(-half, fit.mag[0] + dy, fit.mag[2] + dz),
      new THREE.Vector3(half, fit.mag[1] + dy, fit.mag[3] + dz),
    );
  if (fit.port) outer.userData.port = new THREE.Vector3(0, fit.port[0] + dy, fit.port[1] + dz);
  return outer;
}
export const hasGunModel = (id: string) => !!fits[id] && loaded.has(fits[id].file);
