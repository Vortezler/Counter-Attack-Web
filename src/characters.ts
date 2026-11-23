/**
 * Third-person soldiers. CTs wear plate carriers, high-cut helmets and full-face gas masks;
 * Ts wear jackets, chest rigs, shemaghs and knit balaclavas. Every limb is jointed (hip, knee,
 * ankle, shoulder, elbow) and the arms reach the held weapon with two-bone IK, so hands stay on
 * the grip and foregrip as the weapon pitches and recoils.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Team } from "./world";

type Finish = "cloth" | "gloss";

/** Waist height: the torso pivots here, so crouching and leaning bend at the hips. */
const WAIST = 0.95;
/** Upper arm and forearm (to the palm) lengths. */
const L1 = 0.28,
  L2 = 0.25;
const ty = (v: number) => v - WAIST;

function add(
  host: THREE.Object3D,
  geo: THREE.BufferGeometry,
  color: string,
  x: number,
  y: number,
  z: number,
  finish: Finish = "cloth",
) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
  m.position.set(x, y, z);
  m.userData.finish = finish;
  host.add(m);
  return m;
}
/** A positioned, rotated frame whose meshes bake into the parent: used to build angled parts. */
function frame(
  host: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
) {
  const g = new THREE.Group();
  g.userData.assembly = true;
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz, "YXZ");
  host.add(g);
  return g;
}
const rbox = (w: number, h: number, d: number, r = 0.015) =>
  new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.05, h / 2.05, d / 2.05));
const ball = (r: number, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const tube = (top: number, bottom: number, len: number, seg = 10) =>
  new THREE.CylinderGeometry(top, bottom, len, seg);
const lathe = (pts: number[][], seg = 18) =>
  new THREE.LatheGeometry(
    pts.map(([r, h]) => new THREE.Vector2(r, h)),
    seg,
  );
/** A patch of sphere facing -z: `spread` radians either side, between polar angles `top` and `bottom`. */
const shell = (
  r: number,
  spread: number,
  top: number,
  bottom: number,
  w = 14,
  h = 8,
) =>
  new THREE.SphereGeometry(
    r,
    w,
    h,
    Math.PI * 1.5 - spread,
    spread * 2,
    top,
    bottom - top,
  );

let fabricMap: THREE.CanvasTexture | null = null;
/** A light weave-and-noise texture; vertex colours tint it per part. Shared by every soldier. */
function fabric() {
  if (fabricMap) return fabricMap;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#e8e8e8";
  g.fillRect(0, 0, 128, 128);
  let n = 11;
  const rng = () => (n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rng() < 0.5 ? "rgba(0,0,0,.075)" : "rgba(255,255,255,.09)";
    g.fillRect(rng() * 128, rng() * 128, 1 + rng() * 3, 1 + rng() * 3);
  }
  g.fillStyle = "rgba(0,0,0,.055)";
  for (let i = 0; i < 128; i += 2) {
    g.fillRect(i, 0, 1, 128);
    g.fillRect(0, i + 1, 128, 1);
  }
  fabricMap = new THREE.CanvasTexture(canvas);
  fabricMap.colorSpace = THREE.SRGBColorSpace;
  fabricMap.wrapS = fabricMap.wrapT = THREE.RepeatWrapping;
  fabricMap.repeat.set(3, 3);
  fabricMap.userData.shared = true;
  return fabricMap;
}

/**
 * Merges a group's meshes (and those of its assembly frames) into one cloth mesh and one
 * glossy mesh, with each part's colour baked into vertex colours.
 */
export function bake(group: THREE.Group, texture = true) {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert(),
    sets = new Map<Finish, THREE.BufferGeometry[]>(),
    meshes: THREE.Mesh[] = [];
  const collect = (o: THREE.Object3D) => {
    for (const c of o.children)
      if (c instanceof THREE.Mesh) meshes.push(c);
      else if (c.userData.assembly) collect(c);
  };
  collect(group);
  const matrix = new THREE.Matrix4();
  for (const mesh of meshes) {
    const g = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone();
    matrix.multiplyMatrices(inverse, mesh.matrixWorld);
    g.applyMatrix4(matrix);
    const n = g.getAttribute("position").count;
    if (!g.getAttribute("uv"))
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    for (const k of Object.keys(g.attributes))
      if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
    const c = (mesh.material as THREE.MeshBasicMaterial).color,
      colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const finish: Finish = mesh.userData.finish ?? "cloth";
    if (!sets.has(finish)) sets.set(finish, []);
    sets.get(finish)!.push(g);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  for (const c of [...group.children])
    if (c instanceof THREE.Mesh || c.userData.assembly) group.remove(c);
  for (const [finish, list] of sets) {
    const geo = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (!geo) continue;
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial(
        finish === "gloss"
          ? { vertexColors: true, roughness: 0.2, metalness: 0.35 }
          : {
              vertexColors: true,
              roughness: 0.92,
              map: texture ? fabric() : null,
            },
      ),
    );
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
}

export const palettes = {
  CT: {
    shirt: "#56656e",
    pants: "#4b5960",
    dark: "#3f4b51",
    gear: "#2f3a3e",
    pouch: "#3a474c",
    strap: "#262d30",
    glove: "#252829",
    boot: "#25231f",
    skin: "#c39a7b",
    helmet: "#3c494d",
    rubber: "#1c2022",
    lens: "#2a5560",
    filter: "#5b6248",
    accent: "#8d9b5c",
  },
  T: {
    shirt: "#8b7653",
    pants: "#4d4b3b",
    dark: "#6f5f43",
    gear: "#5d5337",
    pouch: "#6b6041",
    strap: "#3f3827",
    glove: "#39332a",
    boot: "#4e3c2a",
    skin: "#b6886a",
    knit: "#1f1f1e",
    scarf: "#8a7a5c",
    eye: "#efe9d6",
  },
};

interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  side: number;
}
interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
}

function buildTorso(torso: THREE.Group, ct: boolean) {
  const c = ct ? palettes.CT : palettes.T;
  const chest = add(
    torso,
    lathe(
      [
        [0, 0.93],
        [0.15, 0.94],
        [0.158, 1.02],
        [0.172, 1.14],
        [0.19, 1.27],
        [0.197, 1.36],
        [0.165, 1.43],
        [0.075, 1.47],
        [0, 1.475],
      ].map(([r, h]) => [r, ty(h)]),
    ),
    c.shirt,
    0,
    0,
    0,
  );
  chest.scale.z = 0.64;
  for (const s of [-1, 1])
    add(torso, ball(0.066, 10, 8), c.shirt, s * 0.19, ty(1.39), 0).scale.set(
      1,
      0.9,
      1.12,
    );
  if (ct) {
    const k = palettes.CT;
    add(torso, tube(0.072, 0.088, 0.055, 14), k.shirt, 0, ty(1.455), 0.005);
    // Plate carrier: front and back plates, cummerbund, shoulder straps.
    add(torso, rbox(0.34, 0.37, 0.07, 0.022), k.gear, 0, ty(1.2), -0.125);
    add(torso, rbox(0.33, 0.37, 0.06, 0.022), k.gear, 0, ty(1.21), 0.12);
    for (const s of [-1, 1]) {
      add(torso, rbox(0.05, 0.2, 0.2, 0.016), k.gear, s * 0.178, ty(1.11), 0);
      add(torso, rbox(0.075, 0.035, 0.27, 0.012), k.strap, s * 0.105, ty(1.425), 0);
    }
    // Triple rifle-mag pouch with flaps, admin pouch and a unit patch.
    for (const x of [-0.086, 0, 0.086]) {
      add(torso, rbox(0.074, 0.12, 0.05, 0.012), k.pouch, x, ty(1.105), -0.182);
      add(torso, rbox(0.077, 0.032, 0.055, 0.01), k.strap, x, ty(1.165), -0.183);
    }
    add(torso, rbox(0.17, 0.075, 0.04, 0.012), k.pouch, 0, ty(1.29), -0.172);
    add(torso, rbox(0.07, 0.042, 0.008, 0.003), k.accent, -0.055, ty(1.3), -0.193);
    // Radio with antenna and a hydration carrier on the back.
    add(torso, rbox(0.075, 0.15, 0.05, 0.012), k.pouch, -0.09, ty(1.27), 0.165);
    add(torso, tube(0.006, 0.006, 0.3, 6), k.rubber, -0.11, ty(1.47), 0.17);
    add(torso, rbox(0.2, 0.22, 0.04, 0.016), k.pouch, 0.03, ty(1.1), 0.163);
  } else {
    const k = palettes.T;
    // Shemagh wrapped round the neck, its tail hanging down the back.
    const scarf = add(torso, new THREE.TorusGeometry(0.074, 0.033, 8, 18), k.scarf, 0, ty(1.455), 0);
    scarf.rotation.x = Math.PI / 2;
    scarf.scale.set(1, 1.12, 1);
    const tail = add(torso, rbox(0.1, 0.17, 0.022, 0.008), k.scarf, 0.03, ty(1.36), 0.128);
    tail.rotation.x = 0.12;
    // Jacket placket, hip pockets, chest rig with AK mags.
    add(torso, rbox(0.026, 0.42, 0.012, 0.004), k.dark, 0, ty(1.16), -0.122);
    for (const s of [-1, 1])
      add(torso, rbox(0.1, 0.085, 0.02, 0.008), k.dark, s * 0.1, ty(0.99), -0.112);
    add(torso, rbox(0.31, 0.15, 0.05, 0.016), k.gear, 0, ty(1.14), -0.137);
    for (const x of [-0.09, 0, 0.09]) {
      add(torso, rbox(0.072, 0.15, 0.045, 0.012), k.pouch, x, ty(1.165), -0.17);
      const mag = add(torso, rbox(0.03, 0.065, 0.055, 0.006), "#35342f", x, ty(1.265), -0.17, "gloss");
      mag.rotation.x = -0.18;
    }
    add(torso, ball(0.04, 10, 8), "#4a5236", 0.17, ty(1.08), -0.09);
    // Harness: straps over the shoulders and crossed on the back.
    for (const s of [-1, 1]) {
      const front = add(torso, rbox(0.045, 0.2, 0.014, 0.005), k.strap, s * 0.1, ty(1.33), -0.124);
      front.rotation.x = 0.22;
      const back = add(torso, rbox(0.045, 0.44, 0.014, 0.005), k.strap, 0, ty(1.22), 0.124);
      back.rotation.z = s * 0.55;
    }
  }
}

function buildHead(head: THREE.Group, ct: boolean) {
  const H = 0.12;
  if (ct) {
    const k = palettes.CT;
    add(head, tube(0.05, 0.056, 0.1, 12), "#2a3236", 0, -0.01, 0.008);
    add(head, ball(0.1, 16, 12), k.rubber, 0, H, 0).scale.set(1, 1.17, 1.1);
    add(head, rbox(0.12, 0.07, 0.12, 0.03), k.rubber, 0, H - 0.07, -0.025);
    // Full-face mask: rubber seal, twin angled lenses with rims, side filter, exhale valve.
    add(head, shell(0.112, 1.15, 1.05, 2.45, 16, 10), k.rubber, 0, H, -0.004).scale.set(1, 1.16, 1.12);
    for (const s of [-1, 1]) {
      const lens = add(head, tube(0.03, 0.03, 0.012, 16), k.lens, s * 0.041, H + 0.016, -0.122, "gloss");
      lens.rotation.set(Math.PI / 2, -s * 0.38, 0, "YXZ");
      const rim = add(head, new THREE.TorusGeometry(0.031, 0.0075, 6, 18), "#2d3234", s * 0.041, H + 0.016, -0.121);
      rim.rotation.set(0, -s * 0.38, 0);
    }
    const filter = frame(head, -0.062, H - 0.058, -0.104, Math.PI / 2, 0.75, 0);
    add(filter, tube(0.025, 0.025, 0.03, 12), k.rubber, 0, 0.032, 0);
    add(filter, tube(0.043, 0.043, 0.066, 16), k.filter, 0, -0.012, 0);
    add(filter, tube(0.036, 0.036, 0.012, 16), "#30352a", 0, -0.05, 0);
    const valve = frame(head, 0.012, H - 0.074, -0.122, Math.PI / 2, -0.15, 0);
    add(valve, tube(0.024, 0.029, 0.032, 12), k.rubber, 0, 0, 0);
    add(valve, tube(0.019, 0.019, 0.008, 12), "#41474a", 0, -0.019, 0);
    // High-cut helmet with rails, NVG shroud and comms ear cups.
    const helm = add(
      head,
      new THREE.SphereGeometry(0.129, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.53),
      k.helmet,
      0,
      H + 0.024,
      0.008,
    );
    helm.scale.set(1, 0.98, 1.08);
    helm.rotation.x = 0.3;
    const rim = add(head, new THREE.TorusGeometry(0.128, 0.008, 6, 26), k.helmet, 0, H + 0.02, 0.008);
    rim.rotation.x = Math.PI / 2 + 0.3;
    rim.scale.set(1, 1.08, 1);
    const shroud = add(head, rbox(0.055, 0.04, 0.028, 0.008), "#2a2f30", 0, H + 0.105, -0.115);
    shroud.rotation.x = 0.55;
    for (const s of [-1, 1]) {
      const rail = add(head, rbox(0.014, 0.026, 0.11, 0.005), "#2a2f30", s * 0.126, H + 0.045, 0.006);
      rail.rotation.x = 0.3;
      const cup = add(head, tube(0.043, 0.043, 0.036, 16), "#2b3031", s * 0.112, H - 0.004, 0.012);
      cup.rotation.z = Math.PI / 2;
    }
    add(head, rbox(0.07, 0.045, 0.012, 0.004), k.accent, 0, H + 0.07, 0.137).rotation.x = -0.5;
  } else {
    const k = palettes.T;
    // Knit balaclava: the skull and jaw are knit; only the eye slit shows skin.
    add(head, tube(0.05, 0.056, 0.1, 12), k.knit, 0, -0.01, 0.008);
    add(head, ball(0.1, 16, 12), k.knit, 0, H, 0).scale.set(1, 1.17, 1.1);
    add(head, rbox(0.12, 0.07, 0.12, 0.03), k.knit, 0, H - 0.07, -0.025);
    add(head, rbox(0.026, 0.042, 0.03, 0.01), k.knit, 0, H - 0.012, -0.114);
    for (const s of [-1, 1])
      add(head, ball(0.022, 8, 6), k.knit, s * 0.1, H, 0.005).scale.set(0.55, 1, 0.8);
    add(head, shell(0.1015, 0.62, 1.32, 1.66, 14, 3), k.skin, 0, H, 0).scale.set(1, 1.17, 1.1);
    for (const [top, bottom] of [
      [1.24, 1.33],
      [1.65, 1.74],
    ])
      add(head, shell(0.1035, 0.66, top, bottom, 14, 2), "#191918", 0, H, 0).scale.set(1, 1.17, 1.1);
    for (const s of [-1, 1]) {
      // Eyes sit deep in the slit under a shadowed brow.
      add(head, ball(0.0105, 8, 6), k.eye, s * 0.034, H + 0.008, -0.1).scale.z = 0.6;
      add(head, ball(0.0068, 8, 6), "#2a1e14", s * 0.034, H + 0.008, -0.1065, "gloss").scale.z = 0.5;
      const lid = add(head, rbox(0.03, 0.008, 0.012, 0.003), "#7a5843", s * 0.034, H + 0.02, -0.103);
      lid.rotation.z = s * -0.12;
    }
    // Rolled knit edge at the neck.
    add(head, tube(0.062, 0.066, 0.03, 14), "#262625", 0, -0.005, 0.008);
  }
}

function buildArm(shoulder: THREE.Group, elbow: THREE.Group, side: number, ct: boolean) {
  const c = ct ? palettes.CT : palettes.T;
  add(shoulder, ball(0.06, 10, 8), c.shirt, 0, 0, 0);
  add(shoulder, tube(0.058, 0.049, 0.25, 10), c.shirt, 0, -0.14, 0);
  if (ct) {
    add(shoulder, rbox(0.03, 0.085, 0.075, 0.009), palettes.CT.dark, side * 0.054, -0.11, 0);
    add(shoulder, rbox(0.008, 0.04, 0.05, 0.003), palettes.CT.accent, side * 0.07, -0.1, 0);
  }
  add(elbow, ball(0.049, 10, 8), c.shirt, 0, 0, 0);
  if (ct) {
    add(elbow, tube(0.048, 0.04, 0.2, 10), c.shirt, 0, -0.105, 0);
    add(elbow, tube(0.043, 0.042, 0.035, 10), c.glove, 0, -0.195, 0);
  } else {
    // Sleeves rolled to the elbow.
    add(elbow, tube(0.055, 0.053, 0.05, 10), palettes.T.dark, 0, -0.012, 0);
    add(elbow, tube(0.041, 0.033, 0.2, 10), palettes.T.skin, 0, -0.115, 0);
  }
  add(elbow, rbox(0.068, 0.088, 0.036, 0.014), c.glove, 0, -L2, 0);
  const fingers = add(elbow, rbox(0.064, 0.055, 0.03, 0.012), c.glove, 0, -L2 - 0.058, -0.014);
  fingers.rotation.x = 0.65;
  const thumb = add(elbow, new THREE.CapsuleGeometry(0.012, 0.035, 3, 6), c.glove, -side * 0.036, -L2 + 0.008, -0.02);
  thumb.rotation.z = side * 0.6;
}

function buildLeg(leg: Leg, side: number, ct: boolean) {
  const c = ct ? palettes.CT : palettes.T;
  add(leg.hip, ball(0.085, 10, 8), c.pants, 0, 0, 0);
  add(leg.hip, tube(0.085, 0.062, 0.42, 12), c.pants, 0, -0.21, 0);
  add(leg.hip, rbox(0.045, 0.13, 0.11, 0.014), c.dark, side * 0.077, -0.22, 0);
  add(leg.hip, rbox(0.047, 0.03, 0.115, 0.01), c.pants, side * 0.078, -0.16, 0);
  if (ct && side > 0) {
    // Drop-leg pistol holster on the right thigh.
    add(leg.hip, rbox(0.05, 0.17, 0.1, 0.014), palettes.CT.gear, 0.1, -0.15, 0.005);
    add(leg.hip, rbox(0.032, 0.065, 0.045, 0.008), "#1e2223", 0.1, -0.045, 0.025);
  }
  add(leg.knee, ball(0.062, 10, 8), c.pants, 0, 0, 0);
  add(leg.knee, tube(0.06, 0.047, 0.38, 12), c.pants, 0, -0.19, 0);
  if (ct) add(leg.knee, rbox(0.1, 0.12, 0.05, 0.02), palettes.CT.strap, 0, -0.01, -0.058);
  add(leg.ankle, rbox(0.1, 0.14, 0.13, 0.035), c.boot, 0, -0.005, 0.005);
  add(leg.ankle, rbox(0.104, 0.07, 0.25, 0.03), c.boot, 0, -0.045, -0.045);
  add(leg.ankle, rbox(0.11, 0.026, 0.262, 0.009), "#1a1916", 0, -0.067, -0.045);
}

export function humanoid(team: Team) {
  const ct = team === "CT",
    root = new THREE.Group(),
    fall = new THREE.Group(),
    body = new THREE.Group(),
    hips = new THREE.Group(),
    torso = new THREE.Group(),
    head = new THREE.Group(),
    held = new THREE.Group(),
    c = ct ? palettes.CT : palettes.T,
    legs: Leg[] = [],
    arms: Arm[] = [];
  root.add(fall);
  fall.add(body);
  body.add(hips, torso);
  torso.position.y = WAIST;
  torso.add(head, held);
  head.position.set(0, ty(1.49), 0);
  held.rotation.order = "YXZ";
  // Pelvis and belt.
  add(
    hips,
    lathe([
      [0, 0.79],
      [0.12, 0.8],
      [0.168, 0.85],
      [0.166, 0.94],
      [0.15, 0.99],
      [0, 0.995],
    ]),
    c.pants,
    0,
    0,
    0,
  ).scale.z = 0.7;
  add(hips, tube(0.171, 0.171, 0.055, 18), ct ? palettes.CT.strap : palettes.T.strap, 0, 0.955, 0).scale.z = 0.72;
  add(hips, rbox(0.06, 0.045, 0.02, 0.006), ct ? "#8f9186" : "#7b6a47", 0, 0.955, -0.126, "gloss");
  if (!ct) add(hips, rbox(0.08, 0.09, 0.05, 0.012), palettes.T.pouch, -0.15, 0.93, 0.06);
  buildTorso(torso, ct);
  buildHead(head, ct);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(),
      elbow = new THREE.Group();
    shoulder.position.set(side * 0.2, ty(1.4), 0.005);
    elbow.position.y = -L1;
    shoulder.add(elbow);
    torso.add(shoulder);
    buildArm(shoulder, elbow, side, ct);
    arms.push({ shoulder, elbow, side });
    const leg: Leg = {
      hip: new THREE.Group(),
      knee: new THREE.Group(),
      ankle: new THREE.Group(),
    };
    leg.hip.position.set(side * 0.095, 0.9, 0);
    leg.knee.position.y = -0.42;
    leg.ankle.position.y = -0.4;
    leg.hip.add(leg.knee);
    leg.knee.add(leg.ankle);
    body.add(leg.hip);
    buildLeg(leg, side, ct);
    legs.push(leg);
  }
  for (const g of [hips, torso, head]) bake(g);
  for (const a of arms) [a.shoulder, a.elbow].forEach((g) => bake(g));
  for (const l of legs) [l.hip, l.knee, l.ankle].forEach((g) => bake(g));
  return {
    root,
    fall,
    body,
    torso,
    head,
    held,
    item: "",
    legs,
    arms,
    team,
    crouch: 0,
    grip: { right: new THREE.Vector3(), left: null as THREE.Vector3 | null },
  };
}
export type Humanoid = ReturnType<typeof humanoid>;

const pistols = new Set(["glock", "deagle"]),
  throwables = new Set(["he", "flash", "smoke", "molly", "bomb"]);
/** Where the weapon sits in torso space and where each hand grips it, in weapon space. */
export function hold(m: Humanoid, item: string) {
  m.item = item;
  const g = m.grip;
  if (item === "knife") {
    m.held.position.set(0.2, ty(1.12), -0.3);
    g.right.set(0, 0.012, 0.012);
    g.left = null;
  } else if (throwables.has(item)) {
    m.held.position.set(0.17, ty(1.2), -0.3);
    g.right.set(0, -0.02, 0.03);
    g.left = null;
  } else if (pistols.has(item)) {
    m.held.position.set(0.05, ty(1.34), -0.4);
    g.right.set(0, -0.075, 0.03);
    g.left = new THREE.Vector3(-0.022, -0.088, 0.004);
  } else {
    m.held.position.set(0.1, ty(1.37), -0.18);
    g.right.set(0, -0.075, 0.035);
    g.left = new THREE.Vector3(0, -0.035, ["awp", "ssg"].includes(item) ? -0.26 : -0.21);
  }
}

const DOWN = new THREE.Vector3(0, -1, 0),
  dir = new THREE.Vector3(),
  side = new THREE.Vector3(),
  elbowAt = new THREE.Vector3(),
  handAt = new THREE.Vector3(),
  target = new THREE.Vector3(),
  pole = new THREE.Vector3(),
  q1 = new THREE.Quaternion(),
  q2 = new THREE.Quaternion();
/** Two-bone IK in torso space: bends the elbow toward `hint` so the palm lands on `goal`. */
function reach(arm: Arm, goal: THREE.Vector3, hint: THREE.Vector3) {
  const s = arm.shoulder.position;
  dir.subVectors(goal, s);
  const d = THREE.MathUtils.clamp(dir.length(), Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.998);
  dir.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d),
    h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  side.copy(hint).sub(s);
  side.addScaledVector(dir, -side.dot(dir)).normalize();
  elbowAt.copy(s).addScaledVector(dir, a).addScaledVector(side, h);
  handAt.copy(s).addScaledVector(dir, d);
  q1.setFromUnitVectors(DOWN, dir.subVectors(elbowAt, s).normalize());
  arm.shoulder.quaternion.copy(q1);
  q2.setFromUnitVectors(DOWN, dir.subVectors(handAt, elbowAt).normalize());
  arm.elbow.quaternion.copy(q1.invert()).multiply(q2);
}

export interface Ragdoll {
  t0: number;
  dir: { x: number; z: number };
  head: boolean;
  side: number;
}
export interface PoseInput {
  moving: boolean;
  crouched: boolean;
  /** View pitch in radians, up positive. */
  pitch: number;
  /** Recoil offset of the weapon from the view, in radians. */
  kickPitch: number;
  kickYaw: number;
  /** A recent hit: seconds since it landed, the hitbox group and the bullet's travel in body space (+z is backwards). */
  flinch?: { age: number; group: string; x: number; z: number };
  /**
   * Kneeling at the bomb: seconds into the plant or defuse, and where the bomb sits on the
   * floor in body space (-z is forward, y is height above the feet).
   */
  task?: { kind: "plant" | "defuse"; age: number; kit: boolean; at: THREE.Vector3 };
}
/** Where a planter sets the C4 down, in body space. */
export const PLANT_SPOT = new THREE.Vector3(0.06, 0, -0.52);
const upAxis = new THREE.Vector3(),
  tilt = new THREE.Quaternion(),
  toTorso = new THREE.Matrix4(),
  goal = new THREE.Vector3();
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
/**
 * Drops to one knee over the bomb: left foot planted forward, right knee on the floor, torso
 * folded over so both hands reach it. Returns the hand goals in torso space.
 */
function kneel(m: Humanoid, task: NonNullable<PoseInput["task"]>, t: number) {
  const k0 = Math.min(1, task.age / 0.35),
    k = k0 * k0 * (3 - 2 * k0),
    [left, right] = m.legs;
  left.hip.rotation.x = mix(left.hip.rotation.x, 1.55, k);
  left.knee.rotation.x = mix(left.knee.rotation.x, -1.85, k);
  left.ankle.rotation.x = mix(left.ankle.rotation.x, 0.3, k);
  right.hip.rotation.x = mix(right.hip.rotation.x, 0.3, k);
  right.knee.rotation.x = mix(right.knee.rotation.x, -1.9, k);
  right.ankle.rotation.x = mix(right.ankle.rotation.x, 0.95, k);
  right.hip.rotation.z = 0.12 * k;
  m.body.position.y = mix(m.body.position.y, -0.47, k);
  m.torso.rotation.set(mix(m.torso.rotation.x, -1.05, k), 0, 0);
  m.head.rotation.set(mix(m.head.rotation.x, 0.5, k), 0, 0);
  m.held.visible = k < 0.5;
  // Hands work at the bomb: the planter taps the keypad, the defuser works the wires.
  m.torso.updateMatrix();
  toTorso.copy(m.torso.matrix).invert();
  const lift = -m.body.position.y,
    tap = task.kind === "plant" ? Math.max(0, Math.sin(t * 19)) * 0.03 : Math.sin(t * 7) * 0.015,
    hands = [
      goal.set(task.at.x - 0.1, task.at.y + 0.1 + lift, task.at.z + 0.04).applyMatrix4(toTorso).clone(),
      goal
        .set(task.at.x + 0.05 + Math.sin(t * 3) * 0.02, task.at.y + 0.13 + tap + lift, task.at.z - 0.02)
        .applyMatrix4(toTorso)
        .clone(),
    ];
  return { hands, k };
}
export function pose(
  m: Humanoid,
  rag: Ragdoll | undefined,
  t: number,
  id: number,
  a: PoseInput,
  dt: number,
) {
  if (!rag) {
    m.fall.quaternion.identity();
    m.fall.position.set(0, 0, 0);
    m.held.visible = true;
    m.crouch += ((a.crouched ? 1 : 0) - m.crouch) * Math.min(1, dt * 14);
    const c = m.crouch,
      phase = t * 9 + id * 1.7,
      stride = a.moving ? 0.45 - 0.2 * c : 0;
    m.legs.forEach((leg, i) => {
      const p = phase + i * Math.PI,
        hip = c * 1.0 + Math.sin(p) * stride,
        knee = -c * 2.0 - (a.moving ? (0.08 + 0.65 * Math.max(0, Math.cos(p))) * (1 - 0.5 * c) : 0);
      leg.hip.rotation.set(hip, 0, 0);
      leg.knee.rotation.set(knee, 0, 0);
      leg.ankle.rotation.set(-(hip + knee) * (0.55 + 0.45 * c), 0, 0);
    });
    // Knees bent to 1 and -2 rad drop the hips 0.375 m, matching the crouched hitboxes.
    m.body.position.y =
      -0.375 * c - (a.moving ? Math.abs(Math.sin(phase)) * 0.018 : 0);
    const lean = -0.05 - 0.2 * c;
    m.torso.rotation.set(lean, 0, 0);
    m.head.rotation.set(THREE.MathUtils.clamp(a.pitch * 0.55, -0.6, 0.6) - lean, 0, 0);
    m.held.rotation.set(a.pitch + a.kickPitch - lean, -a.kickYaw, 0);
    const fl = a.flinch;
    if (fl && fl.age < 0.7) {
      // Hit reaction seen by other players: snaps away from the bullet, overshoots slightly, settles.
      // The victim's own camera never moves; their model is not drawn in first person.
      const f =
          (1 - Math.exp(-fl.age * 55)) * Math.exp(-fl.age * 7) * Math.cos(fl.age * 5),
        head = fl.group === "head",
        leg = fl.group === "leg";
      m.head.rotation.x += (head ? 0.95 : 0.18) * f * fl.z;
      m.head.rotation.z -= (head ? 0.7 : 0.12) * f * fl.x;
      m.head.rotation.y += (head ? 0.3 : 0) * f * fl.x;
      if (leg) {
        m.body.position.y -= 0.07 * f;
        m.torso.rotation.x -= 0.12 * f;
      } else {
        m.torso.rotation.x += (head ? 0.12 : 0.3) * f * fl.z;
        m.torso.rotation.z -= (head ? 0.06 : 0.22) * f * fl.x;
      }
      if (fl.group === "arm") m.torso.rotation.y += 0.28 * f * (fl.x < 0 ? -1 : 1);
    }
    const work = a.task ? kneel(m, a.task, t) : null;
    for (const arm of m.arms) {
      const grip = arm.side > 0 ? m.grip.right : m.grip.left;
      if (grip) target.copy(grip).applyEuler(m.held.rotation).add(m.held.position);
      else target.set(arm.side * 0.24, ty(1.0), -0.03);
      if (work) target.lerp(work.hands[arm.side > 0 ? 1 : 0], work.k);
      pole.set(
        arm.shoulder.position.x + arm.side * 0.35,
        arm.shoulder.position.y - 0.6,
        arm.side > 0 ? 0.25 : 0.05,
      );
      reach(arm, target, pole);
    }
    return;
  }
  m.crouch = 0;
  m.body.position.y = 0;
  m.torso.rotation.set(0, 0, 0);
  // Closed-form topple: gravity accelerates the fall about the feet, then the body bounces and settles.
  const age = Math.max(0, t - rag.t0),
    w0 = rag.head ? 2.6 : 1.4,
    alpha = 15,
    land = (-w0 + Math.sqrt(w0 * w0 + alpha * Math.PI)) / alpha;
  const theta =
    age < land
      ? w0 * age + 0.5 * alpha * age * age
      : Math.PI / 2 -
        0.16 * Math.abs(Math.sin((age - land) * 13)) * Math.exp(-(age - land) * 6);
  const ease = Math.min(1, age / 0.5),
    wobble = Math.sin(age * 15) * Math.exp(-age * 3.5);
  upAxis.set(rag.dir.z, 0, -rag.dir.x).normalize();
  tilt.setFromAxisAngle(upAxis, Math.min(Math.PI / 2, theta));
  m.fall.quaternion.copy(tilt);
  const slide = (rag.head ? 0.75 : 0.45) * (1 - Math.exp(-age * 5));
  m.fall.position.set(
    rag.dir.x * slide,
    0.13 * Math.sin(Math.min(Math.PI / 2, theta)),
    rag.dir.z * slide,
  );
  m.held.visible = false;
  m.head.rotation.set(
    0.55 * ease + wobble * 0.35,
    rag.side * 0.4 * ease,
    rag.side * 0.25 * ease,
  );
  m.arms.forEach((arm) => {
    const s = arm.side;
    arm.shoulder.rotation.set(
      -0.4 - 1.3 * ease + wobble * 0.6 * s,
      0,
      s * (0.25 + 1.05 * ease) + wobble * 0.5,
    );
    arm.elbow.rotation.set(-0.35 - 0.4 * ease, 0, 0);
  });
  m.legs.forEach((leg, i) => {
    const s = i ? 1 : -1;
    leg.hip.rotation.set((0.35 + 0.25 * rag.side * s) * ease + wobble * 0.3, 0, s * 0.22 * ease);
    leg.knee.rotation.set(-0.3 * ease, 0, 0);
    leg.ankle.rotation.set(0, 0, 0);
  });
}

/** The muzzle of a weapon model in its own space: the centre of its foremost vertices. */
export function muzzleOf(model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const inverse = model.matrixWorld.clone().invert(),
    v = new THREE.Vector3(),
    points: THREE.Vector3[] = [];
  let front = Infinity;
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      points.push(v.clone());
      front = Math.min(front, v.z);
    }
  });
  const tip = points.filter((p) => p.z < front + 0.012);
  const out = new THREE.Vector3();
  tip.forEach((p) => out.add(p));
  return tip.length ? out.divideScalar(tip.length) : out;
}
