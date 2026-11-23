/**
 * Set pieces and dressing for the freight yard, jungle ruins and steel works maps.
 *
 * `render.ts` hands over its batching helpers, so everything here shares the procedural PBR
 * surfaces, weathering and contact shading of the rest of the world and merges into the same
 * few draw calls. A box whose style is listed in `drawsBox` is drawn only here; its collision,
 * material (bullet penetration, impact and footstep sounds) and radar footprint still come from
 * the map definition.
 */
import * as THREE from "three";
import type { Box, MapDef } from "./world";

export interface SceneryKit {
  add(
    geo: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    color: string,
    key?: string,
    rot?: number,
  ): void;
  cub(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
    key?: string,
    rot?: number,
  ): void;
  rod(from: THREE.Vector3, to: THREE.Vector3, r: number, color: string): void;
  rng(): number;
  scene: THREE.Scene;
}

const custom = new Set<string>([
  "railcar",
  "tanker",
  "bogie",
  "loco",
  "column",
  "idol",
  "plank",
  "shelf",
  "pallet",
  "forklift",
  "tree",
]);
/** Boxes drawn here instead of by the generic box renderer: set pieces and thin ground cover. */
export const drawsBox = (b: Box) =>
  (!!b.style && custom.has(b.style)) || (b.style === "floor" && b.h < 0.1);

const hash = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const tmp = new THREE.Color();
/** An irregular leafy lump: an icosphere pushed in and out by a hash of each vertex position. */
function lump(r: number, rough = 0.28) {
  const g = new THREE.IcosahedronGeometry(r, 1),
    pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i),
      k = 1 + (hash(Math.round(x * 97) + y * 13.1, Math.round(z * 89) - y * 7.7) - 0.5) * 2 * rough;
    pos.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  g.computeVertexNormals();
  return g;
}
const shade = (hex: string, k: number) =>
  "#" + tmp.set(hex).multiplyScalar(k).getHexString();

/** The circle a battle royale match shrinks toward, drawn as a translucent wall. */
export const zoneWall: { mesh: THREE.Mesh | null } = { mesh: null };
export function showZone(x: number, z: number, r: number, visible: boolean) {
  const m = zoneWall.mesh;
  if (!m) return;
  m.visible = visible && r > 0.5;
  if (!m.visible) return;
  m.position.set(x, 0, z);
  m.scale.set(r, 1, r);
  (m.material as THREE.MeshBasicMaterial).map!.offset.y =
    (performance.now() / 9000) % 1;
}
function makeZone(scene: THREE.Scene) {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "rgba(255,120,80,0)");
  grad.addColorStop(0.55, "rgba(255,110,70,0.22)");
  grad.addColorStop(1, "rgba(255,90,60,0.55)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  for (let y = 0; y < 128; y += 16) {
    g.fillStyle = "rgba(255,190,150,0.18)";
    g.fillRect(0, y, 4, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  const geo = new THREE.CylinderGeometry(1, 1, 40, 96, 1, true);
  geo.translate(0, 20, 0);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  mesh.visible = false;
  mesh.renderOrder = 3;
  scene.add(mesh);
  zoneWall.mesh = mesh;
}

export function mapScenery(map: MapDef, kit: SceneryKit) {
  const { add, cub, rod } = kit;
  const rnd = kit.rng;
  makeZone(kit.scene);
  const jungle = map.id === "canopy",
    yard = map.id === "switchyard",
    works = map.id === "foundry";

  /** Helpers in a box's own frame: `u` runs along its long side, `v` across it. */
  function frame(b: Box) {
    const alongX = b.w >= b.d,
      L = alongX ? b.w : b.d,
      W = alongX ? b.d : b.w;
    const at = (u: number, v: number): [number, number] =>
      alongX ? [b.x + u, b.z + v] : [b.x + v, b.z + u];
    const box = (
      u: number,
      y: number,
      v: number,
      l: number,
      h: number,
      wd: number,
      color: string,
      key = "metal",
    ) => {
      const [x, z] = at(u, v);
      cub(x, y, z, alongX ? l : wd, h, alongX ? wd : l, color, key);
    };
    const cyl = (
      axis: "along" | "across" | "up",
      u: number,
      y: number,
      v: number,
      r: number,
      l: number,
      color: string,
      key = "metal",
      n = 14,
    ) => {
      const g = new THREE.CylinderGeometry(r, r, l, n);
      const x = axis === "along" ? alongX : !alongX;
      if (axis !== "up") {
        if (x) g.rotateZ(Math.PI / 2);
        else g.rotateX(Math.PI / 2);
      }
      const [px, pz] = at(u, v);
      add(g, px, y, pz, color, key);
    };
    return { alongX, L, W, at, box, cyl };
  }

  // ---------------------------------------------------------------- freight stock
  function coupler(f: ReturnType<typeof frame>, e: number, y: number) {
    f.box(e * (f.L / 2 + 0.28), y, 0, 0.56, 0.2, 0.26, "#262523");
    f.box(e * (f.L / 2 + 0.6), y, 0, 0.16, 0.34, 0.36, "#2b2927");
  }
  function boxcar(b: Box) {
    const f = frame(b),
      { L, W } = f,
      y0 = b.y - b.h / 2,
      y1 = b.y + b.h / 2,
      h = b.h;
    const palette = ["#7b3526", "#3d5b6e", "#5b6a3a", "#86532a", "#6a6e70", "#6e2f2a"];
    const c = palette[Math.floor(hash(b.x, b.z) * palette.length)];
    f.box(0, b.y, 0, L, h, W, c, "freight");
    // Side posts every metre or so.
    const ribs = Math.max(6, Math.round(L / 0.95));
    for (let i = 0; i <= ribs; i++) {
      const u = -L / 2 + 0.2 + (i * (L - 0.4)) / ribs;
      if (Math.abs(u) < 1.5) continue;
      for (const s of [-1, 1])
        f.box(u, b.y, s * (W / 2 + 0.035), 0.08, h - 0.14, 0.07, shade(c, 0.8), "freight");
    }
    for (const s of [-1, 1]) {
      f.box(0, y0 + 0.09, s * (W / 2 + 0.05), L, 0.18, 0.1, shade(c, 0.55));
      f.box(0, y1 - 0.06, s * (W / 2 + 0.05), L, 0.12, 0.1, shade(c, 0.72));
      // Sliding door on its rails, with a latch bar.
      f.box(0.2, b.y - 0.04, s * (W / 2 + 0.09), 2.7, h - 0.36, 0.06, shade(c, 0.93), "freight");
      for (const k of [-0.9, 0, 0.9])
        f.box(0.2 + k, b.y - 0.04, s * (W / 2 + 0.125), 0.07, h - 0.4, 0.03, shade(c, 0.78));
      f.box(0, y1 - 0.2, s * (W / 2 + 0.14), 5.8, 0.07, 0.07, "#34322f");
      f.box(0, y0 + 0.2, s * (W / 2 + 0.14), 5.8, 0.06, 0.07, "#34322f");
      f.box(1.5, b.y, s * (W / 2 + 0.15), 0.05, 0.8, 0.05, "#262524");
      // Reporting marks and capacity plate, then rust weeping down from the roof seams.
      f.box(-L / 2 + 2.1, y0 + 0.62, s * (W / 2 + 0.073), 1.7, 0.36, 0.012, "#ddd6c4", "plain");
      f.box(-L / 2 + 2.1, y0 + 0.36, s * (W / 2 + 0.073), 1.1, 0.12, 0.012, "#ddd6c4", "plain");
      f.box(L / 2 - 2.3, y0 + 0.7, s * (W / 2 + 0.073), 0.9, 0.5, 0.012, "#c9c2ae", "plain");
      for (let k = 0; k < 4; k++) {
        const u = -L / 2 + 0.8 + hash(b.x + k, s) * (L - 1.6);
        if (Math.abs(u - 0.2) < 1.5) continue;
        const len = 0.5 + hash(k, b.x) * 1.4;
        f.box(u, y1 - 0.15 - len / 2, s * (W / 2 + 0.072), 0.06 + hash(b.z, k) * 0.08, len, 0.012, "#4c2a1c", "plain");
      }
    }
    // Curved roof with a timber running board.
    const r = (W / 2 + 0.08) / Math.sin(0.55);
    const roof = new THREE.CylinderGeometry(r, r, L + 0.1, 18, 1, true, Math.PI / 2 - 0.55, 1.1);
    if (f.alongX) roof.rotateZ(Math.PI / 2);
    else {
      roof.rotateZ(Math.PI / 2);
      roof.rotateY(Math.PI / 2);
    }
    add(roof, b.x, y1 + 0.02 - r * Math.cos(0.55), b.z, shade(c, 0.66), "freight");
    f.box(0, y1 + 0.02, 0, L + 0.08, 0.04, W + 0.1, shade(c, 0.6));
    f.box(0, y1 + r * (1 - Math.cos(0.55)) + 0.04, 0, L - 0.3, 0.05, 0.5, "#5d4a35", "wood");
    for (const e of [-1, 1]) {
      // Corrugated end, ladder, brake wheel and coupler.
      for (let k = 0; k < 6; k++)
        f.box(e * (L / 2 + 0.035), y0 + 0.3 + k * 0.52, 0, 0.07, 0.08, W - 0.2, shade(c, 0.78));
      for (const v of [W / 2 - 0.2, W / 2 - 0.65])
        f.box(e * (L / 2 + 0.13), b.y - 0.25, v, 0.05, h - 0.4, 0.05, "#2b2a28");
      for (let k = 0; k < 7; k++)
        f.box(e * (L / 2 + 0.13), y0 + 0.25 + k * 0.4, W / 2 - 0.42, 0.04, 0.04, 0.48, "#2b2a28");
      if (e > 0) {
        const wheel = new THREE.TorusGeometry(0.26, 0.025, 6, 16);
        if (f.alongX) wheel.rotateY(Math.PI / 2);
        const [x, z] = f.at(L / 2 + 0.16, -0.6);
        add(wheel, x, y1 - 0.5, z, "#2b2a28");
      }
      f.box(e * (L / 2 + 0.08), y0 - 0.06, 0, 0.16, 0.22, W, "#2a2927");
      coupler(f, e, 0.92);
    }
    // Underframe: centre sill, brake cylinder and air reservoir.
    f.box(0, y0 - 0.12, 0, L - 5.4, 0.24, 0.45, "#232322");
    f.cyl("along", -1, y0 - 0.32, 0.6, 0.17, 1.6, "#2d2c2a");
    f.cyl("along", 1.2, y0 - 0.3, -0.55, 0.22, 1.2, "#2d2c2a");
  }
  function tanker(b: Box) {
    const f = frame(b),
      { L, W } = f,
      y0 = b.y - b.h / 2;
    const palette = ["#1e1f1f", "#d8d4c8", "#9aa1a3", "#2e4b5a"];
    const c = palette[Math.floor(hash(b.z, b.x) * palette.length)];
    const r = Math.min(W / 2, (b.h - 0.35) / 2),
      cy = y0 + 0.3 + r;
    f.box(0, y0 + 0.12, 0, L, 0.24, W * 0.72, "#262624");
    for (const e of [-1, 1]) {
      f.box(e * (L / 2 - 1.7), y0 + 0.42, 0, 0.5, 0.5, W * 0.8, "#262624");
      f.box(e * (L / 2 - 0.05), y0 + 0.1, 0, 0.12, 0.25, W, "#2a2927");
      coupler(f, e, 0.92);
    }
    f.cyl("along", 0, cy, 0, r, L - 1.2, c, "freight", 30);
    for (const e of [-1, 1]) {
      const head = new THREE.SphereGeometry(r, 24, 14);
      head.scale(f.alongX ? 0.32 : 1, 1, f.alongX ? 1 : 0.32);
      const [x, z] = f.at(e * (L / 2 - 0.6), 0);
      add(head, x, cy, z, c, "freight");
    }
    for (const k of [-0.36, -0.12, 0.12, 0.36])
      f.cyl("along", k * L, cy, 0, r + 0.025, 0.1, shade(c, 0.6), "metal", 30);
    // Manway dome, walkway and the ladders up to it.
    f.cyl("up", 0, cy + r + 0.1, 0, 0.42, 0.4, c, "metal", 18);
    f.cyl("up", 0, cy + r + 0.32, 0, 0.47, 0.06, "#303030", "metal", 18);
    f.box(0, cy + r - 0.02, 0, 2.4, 0.05, 1.7, "#3a3936");
    for (const s of [-1, 1]) {
      for (const u of [-1.15, 1.15])
        f.box(u, cy + r + 0.5, s * 0.82, 0.04, 1.0, 0.04, "#c7a43a");
      f.box(0, cy + r + 0.98, s * 0.82, 2.3, 0.04, 0.04, "#c7a43a");
      for (const u of [-0.25, 0.25])
        f.box(u, (y0 + 0.3 + cy + r) / 2, s * (r + 0.08), 0.04, cy + r - y0 - 0.3, 0.04, "#2b2a28");
      for (let k = 0; k < 7; k++)
        f.box(0, y0 + 0.45 + k * 0.4, s * (r + 0.09), 0.5, 0.035, 0.035, "#2b2a28");
      // Hazard placard and capacity stencil.
      f.box(-L / 2 + 2.2, cy, s * (r + 0.005), 0.55, 0.55, 0.02, "#d9862b", "plain");
      f.box(L / 2 - 3, cy - 0.35, s * (r - 0.06), 1.6, 0.22, 0.02, shade(c, c === "#d8d4c8" ? 0.4 : 1.8), "plain");
    }
  }
  function bogie(b: Box) {
    const f = frame(b),
      gauge = 0.72,
      wr = 0.38,
      wy = 0.33 + wr;
    for (const a of [-0.9, 0.9]) {
      for (const s of [-1, 1]) {
        f.cyl("across", a, wy, s * gauge, wr, 0.1, "#2a2826", "metal", 18);
        f.cyl("across", a, wy, s * (gauge - 0.07), wr + 0.04, 0.03, "#33302d", "metal", 18);
        f.box(a, wy, s * (gauge + 0.2), 0.34, 0.3, 0.16, "#2f2d2a");
      }
      f.cyl("across", a, wy, 0, 0.065, 1.6, "#3a3836");
    }
    for (const s of [-1, 1]) {
      f.box(0, wy + 0.02, s * (gauge + 0.14), 2.45, 0.26, 0.12, "#262523");
      for (const u of [-0.22, 0, 0.22])
        f.cyl("up", u, wy - 0.12, s * (gauge + 0.14), 0.07, 0.28, "#5a5650");
    }
    f.box(0, wy + 0.16, 0, 0.45, 0.26, 2.1, "#2b2a28");
  }
  function loco(b: Box) {
    const f = frame(b),
      { L, W } = f,
      y0 = b.y - b.h / 2,
      y1 = b.y + b.h / 2,
      deck = y0 + 0.78;
    const palette = ["#c99a2e", "#b4432e", "#2f5d7c"];
    const c = palette[Math.floor(hash(b.x, b.z) * palette.length)];
    // Frame, deck and the yellow-and-black pilots at each end.
    f.box(0, y0 + 0.5, 0, L, 0.42, W - 0.1, "#262624");
    f.box(0, deck - 0.03, 0, L, 0.06, W, "#3a3a37");
    for (const e of [-1, 1]) {
      f.box(e * (L / 2 - 0.06), y0 + 0.45, 0, 0.12, 0.52, W, "#d6ae2c", "plain");
      for (let k = 0; k < 6; k++)
        f.box(e * (L / 2 - 0.05), y0 + 0.45, -W / 2 + 0.25 + k * 0.5, 0.13, 0.5, 0.2, "#1b1b1b", "plain");
      f.cyl("along", e * (L / 2 + 0.02), y0 + 1.3, 0, 0.12, 0.08, "#efe7c4", "plain", 12);
      for (const s of [-1, 1])
        f.box(e * (L / 2 - 0.4), y0 + 0.15, s * (W / 2 - 0.15), 0.6, 0.05, 0.3, "#2b2b28");
    }
    // Long hood with access doors, louvres, fans and the exhaust stack.
    const hoodL = L - 5.4,
      hoodU = -L / 2 + 0.45 + hoodL / 2,
      hoodTop = y0 + 3.05,
      hoodW = 2.4;
    f.box(hoodU, (deck + hoodTop) / 2, 0, hoodL, hoodTop - deck, hoodW, c, "freight");
    f.box(hoodU, hoodTop + 0.04, 0, hoodL + 0.06, 0.08, hoodW + 0.06, shade(c, 0.75));
    for (let u = hoodU - hoodL / 2 + 0.6; u < hoodU + hoodL / 2 - 0.4; u += 1.05)
      for (const s of [-1, 1]) {
        f.box(u, (deck + hoodTop) / 2, s * (hoodW / 2 + 0.01), 0.03, hoodTop - deck - 0.2, 0.02, shade(c, 0.7));
        if (Math.round(u * 3) % 2)
          f.box(u + 0.5, deck + 1.6, s * (hoodW / 2 + 0.012), 0.7, 0.5, 0.02, "#2a2b2a");
      }
    for (const k of [0.25, 0.75])
      f.cyl("up", hoodU - hoodL / 2 + hoodL * k * 0.5 + 0.3, hoodTop + 0.12, 0, 0.55, 0.12, "#2d2e2e", "metal", 16);
    f.cyl("up", hoodU + hoodL * 0.15, hoodTop + 0.35, 0, 0.15, 0.6, "#1f1f1f", "metal", 10);
    // Cab with windows, sun visors and horn.
    const cabU = L / 2 - 3.1,
      cabH = y1 - deck;
    f.box(cabU, deck + cabH / 2, 0, 3, cabH, 2.9, c, "freight");
    f.box(cabU, y1 + 0.05, 0, 3.25, 0.1, 3.05, shade(c, 0.7));
    for (const s of [-1, 1]) {
      f.box(cabU + 0.3, y1 - 0.75, s * 1.46, 1.7, 0.8, 0.04, "#1c2528", "glass");
      for (const e of [-1, 1])
        f.box(cabU + e * 1.51, y1 - 0.8, s * 0.7, 0.04, 0.7, 1.0, "#1c2528", "glass");
      f.box(cabU + 0.3, y1 - 0.3, s * 1.5, 1.8, 0.05, 0.12, "#2a2a28");
      f.box(0, deck + 0.04, s * (W / 2 - 0.06), L - 0.3, 0.08, 0.1, "#d6ae2c", "plain");
    }
    f.cyl("along", cabU, y1 + 0.22, 0.6, 0.07, 0.6, "#3a3a38");
    // Short hood, handrails and the walkway.
    f.box(L / 2 - 1, deck + 0.75, 0, 1.2, 1.5, 2.1, c, "freight");
    for (const s of [-1, 1]) {
      f.box(0, deck + 1.0, s * (W / 2 - 0.05), L - 1.6, 0.045, 0.045, "#e0c24a", "plain");
      for (let u = -L / 2 + 0.8; u <= L / 2 - 0.8; u += 1.55)
        f.box(u, deck + 0.5, s * (W / 2 - 0.05), 0.045, 1.0, 0.045, "#e0c24a", "plain");
    }
    // Two three-axle trucks and the fuel tank slung between them.
    for (const e of [-1, 1]) {
      const bu = e * (L / 2 - 2.7);
      for (const a of [-1.15, 0, 1.15])
        for (const s of [-1, 1]) {
          f.cyl("across", bu + a, 0.5, s * 0.72, 0.47, 0.13, "#2a2826", "metal", 18);
          f.cyl("across", bu + a, 0.5, s * 0.66, 0.51, 0.03, "#33302d", "metal", 18);
        }
      for (const s of [-1, 1]) {
        f.box(bu, 0.55, s * 0.95, 3.7, 0.42, 0.14, "#2b2a28");
        for (const a of [-0.6, 0.6])
          f.cyl("up", bu + a, 0.78, s * 0.95, 0.09, 0.3, "#55524c");
      }
    }
    f.box(0, 0.7, 0, 3.6, 0.7, 2.2, "#262624");
  }

  // ---------------------------------------------------------------- ruins
  const stone = jungle ? "#9b9884" : "#a39d8b";
  const moss = (x: number, y: number, z: number, w: number, d: number) =>
    cub(x, y, z, w, 0.035, d, jungle ? "#4b6a30" : "#5c6c43", "foliage");
  function column(b: Box) {
    const y0 = b.y - b.h / 2,
      top = b.y + b.h / 2,
      w = b.w,
      tall = b.h > 3;
    cub(b.x, y0 + 0.16, b.z, w, 0.32, w, shade(stone, 0.86), "stone");
    cub(b.x, y0 + 0.36, b.z, w * 0.9, 0.08, w * 0.9, shade(stone, 0.95), "stone");
    const shaftTop = tall ? top - 0.36 : top;
    cub(b.x, (y0 + 0.4 + shaftTop) / 2, b.z, w * 0.8, shaftTop - y0 - 0.4, w * 0.8, stone, "stone");
    // Carved bands and vertical channels.
    for (let y = y0 + 1.05; y < shaftTop - 0.3; y += 0.9)
      cub(b.x, y, b.z, w * 0.86, 0.1, w * 0.86, shade(stone, 0.92), "stone");
    for (const [sx, sz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      cub(
        b.x + sx * w * 0.405,
        (y0 + 0.4 + shaftTop) / 2,
        b.z + sz * w * 0.405,
        sx ? 0.012 : 0.1,
        shaftTop - y0 - 0.6,
        sz ? 0.012 : 0.1,
        shade(stone, 0.62),
        "plain",
      );
    if (tall) {
      cub(b.x, top - 0.27, b.z, w * 0.96, 0.18, w * 0.96, shade(stone, 0.93), "stone");
      cub(b.x, top - 0.08, b.z, w, 0.16, w, stone, "stone");
      moss(b.x + 0.1, top + 0.005, b.z - 0.05, w * 0.7, w * 0.55);
    } else {
      // Broken shaft: a jagged cap of tilted fragments.
      for (let i = 0; i < 3; i++) {
        const g = new THREE.BoxGeometry(w * (0.3 + 0.15 * i), 0.18, w * (0.45 - 0.08 * i));
        g.rotateZ((hash(b.x, i) - 0.5) * 0.5);
        add(g, b.x + (i - 1) * 0.12, shaftTop - 0.02 + i * 0.05, b.z + (hash(i, b.z) - 0.5) * 0.2, shade(stone, 0.9 + 0.05 * i), "stone", hash(b.z, i) * 3);
      }
      moss(b.x, shaftTop - 0.08, b.z, w * 0.75, w * 0.75);
    }
    moss(b.x - 0.1, y0 + 0.33, b.z + 0.08, w * 0.8, w * 0.6);
  }
  function idol(b: Box) {
    const y0 = b.y - b.h / 2,
      top = b.y + b.h / 2;
    // Face the middle of the map.
    const dx = 52.5 - b.x,
      dz = 52.5 - b.z,
      alongZ = Math.abs(dz) > Math.abs(dx),
      sign = Math.sign(alongZ ? dz : dx) || 1;
    const put = (lat: number, y: number, fwd: number, lw: number, h: number, fd: number, c: string, key = "stone") =>
      alongZ
        ? cub(b.x + lat, y, b.z + sign * fwd, lw, h, fd, c, key)
        : cub(b.x + sign * fwd, y, b.z + lat, fd, h, lw, c, key);
    const w = Math.min(b.w, b.d);
    cub(b.x, y0 + 0.25, b.z, b.w, 0.5, b.d, shade(stone, 0.84), "stone");
    const hw = w * 0.84,
      hh = b.h - 0.5 - 0.42,
      hy = y0 + 0.5;
    cub(b.x, hy + hh / 2, b.z, hw, hh, hw, stone, "stone");
    cub(b.x, hy + hh + 0.12, b.z, w * 0.95, 0.24, w * 0.95, shade(stone, 0.9), "stone");
    cub(b.x, hy + hh + 0.33, b.z, w * 0.68, 0.18, w * 0.68, shade(stone, 0.95), "stone");
    const f = hw / 2;
    put(0, hy + hh * 0.74, f + 0.05, hw * 0.86, 0.13, 0.1, shade(stone, 0.95));
    for (const s of [-1, 1]) {
      put(s * hw * 0.2, hy + hh * 0.62, f + 0.012, hw * 0.24, 0.13, 0.03, "#2b2a22", "plain");
      put(s * (f + 0.06), hy + hh * 0.55, 0, 0.12, hh * 0.38, hw * 0.3, shade(stone, 0.9));
      put(s * hw * 0.34, hy + hh * 0.32, f + 0.03, 0.1, hh * 0.3, 0.06, shade(stone, 0.85));
    }
    put(0, hy + hh * 0.47, f + 0.08, hw * 0.18, hh * 0.3, 0.16, shade(stone, 0.97));
    put(0, hy + hh * 0.26, f + 0.012, hw * 0.44, 0.08, 0.03, "#2b2a22", "plain");
    put(0, hy + hh * 0.2, f + 0.04, hw * 0.5, 0.07, 0.08, shade(stone, 0.92));
    moss(b.x, top - 0.05, b.z, w * 0.5, w * 0.5);
    moss(b.x + 0.15, y0 + 0.505, b.z - 0.1, b.w * 0.85, b.d * 0.5);
  }

  // ---------------------------------------------------------------- timber and warehouse
  const woods = ["#8a6a45", "#7d5f3d", "#94744d", "#735737", "#86653f"];
  function plank(b: Box) {
    const f = frame(b),
      { L, W } = f,
      y0 = b.y - b.h / 2,
      top = b.y + b.h / 2;
    if (b.mat === "plaster") {
      // Office partition: drywall below, a window band, then a header.
      f.box(0, y0 + 0.6, 0, L, 1.2, W, "#cfcac0", "plaster");
      f.box(0, y0 + 1.75, 0, L, 1.1, W * 0.4, "#2b363a", "glass");
      for (let u = -L / 2 + 0.03; u <= L / 2; u += 1.2)
        f.box(u, y0 + 1.75, 0, 0.06, 1.1, W + 0.02, "#6f7678");
      f.box(0, y0 + 1.22, 0, L, 0.05, W + 0.04, "#8a8f90");
      f.box(0, (y0 + 2.3 + top) / 2, 0, L, top - y0 - 2.3, W, "#cfcac0", "plaster");
      f.box(0, y0 + 0.05, 0, L, 0.1, W + 0.02, "#3b3f40");
      return;
    }
    const n = Math.max(3, Math.round(L / 0.19)),
      bw = L / n;
    for (let i = 0; i < n; i++) {
      const u = -L / 2 + bw * (i + 0.5),
        hh = b.h - hash(b.x + i, b.z) * 0.14;
      f.box(u, y0 + hh / 2, 0, bw - 0.014, hh, W * 0.7, woods[Math.floor(hash(i, b.x + b.z) * woods.length)], "wood");
    }
    for (const s of [-1, 1])
      for (const y of [0.35, b.h - 0.45])
        f.box(0, y0 + y, s * (W * 0.35 + 0.025), L - 0.1, 0.12, 0.05, "#5e4730", "wood");
    for (const e of [-1, 1])
      f.box(e * (L / 2 - 0.05), y0 + (b.h + 0.08) / 2, 0, 0.1, b.h + 0.08, W + 0.04, "#4e3a26", "wood");
  }
  function cartons(x0: number, z0: number, y: number, w: number, d: number, h: number, seed: number) {
    // Fill a footprint with a few rows of cardboard boxes, varied slightly in size and tone.
    const nx = Math.max(1, Math.round(w / 0.6)),
      nz = Math.max(1, Math.round(d / 0.6)),
      ny = Math.max(1, Math.round(h / 0.45));
    const cw = w / nx,
      cd = d / nz,
      ch = h / ny;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++)
        for (let k = 0; k < ny; k++) {
          const r = hash(seed + i * 3.1 + k, j + seed),
            tone = r < 0.33 ? "#b88c5c" : r < 0.66 ? "#a97f50" : "#c39a69";
          cub(x0 - w / 2 + cw * (i + 0.5), y + ch * (k + 0.5), z0 - d / 2 + cd * (j + 0.5), cw - 0.025, ch - 0.02, cd - 0.025, tone, "cardboard");
          if (r > 0.7)
            cub(x0 - w / 2 + cw * (i + 0.5), y + ch * (k + 1) - 0.005, z0 - d / 2 + cd * (j + 0.5), cw - 0.02, 0.012, 0.06, "#d6c48a", "plain");
        }
  }
  function palletBase(x: number, y: number, z: number, w: number, d: number) {
    cub(x, y + 0.13, z, w, 0.025, d, "#8a6943", "wood");
    for (const k of [-0.42, 0, 0.42]) cub(x, y + 0.07, z + k * d, w, 0.09, 0.1, "#7a5b38", "wood");
    for (let i = 0; i < 5; i++) cub(x - w / 2 + (w * (i + 0.5)) / 5, y + 0.01, z, 0.12, 0.022, d, "#7f6040", "wood");
  }
  function pallet(b: Box) {
    const y0 = b.y - b.h / 2;
    palletBase(b.x, y0, b.z, b.w, b.d);
    const h = b.h - 0.15;
    if (b.mat === "cardboard") {
      cartons(b.x, b.z, y0 + 0.15, b.w - 0.06, b.d - 0.06, h, b.x + b.z);
      return;
    }
    // A stack of sawn timber or sleepers with spacer sticks between the layers.
    const alongX = b.w >= b.d,
      L = alongX ? b.w : b.d,
      W = alongX ? b.d : b.w;
    const layers = Math.max(1, Math.round(h / 0.24));
    for (let k = 0; k < layers; k++) {
      const y = y0 + 0.15 + (k * h) / layers,
        lh = h / layers - 0.04;
      const n = Math.max(2, Math.round(W / 0.26));
      for (let i = 0; i < n; i++) {
        const v = -W / 2 + (W * (i + 0.5)) / n,
          c = woods[Math.floor(hash(i + k, b.x) * woods.length)];
        if (alongX) cub(b.x, y + lh / 2, b.z + v, L, lh, W / n - 0.02, shade(c, 0.85), "wood");
        else cub(b.x + v, y + lh / 2, b.z, W / n - 0.02, lh, L, shade(c, 0.85), "wood");
      }
      for (const u of [-0.4, 0, 0.4])
        if (alongX) cub(b.x + u * L, y + h / layers - 0.02, b.z, 0.06, 0.04, W, "#6a5034", "wood");
        else cub(b.x, y + h / layers - 0.02, b.z + u * L, W, 0.04, 0.06, "#6a5034", "wood");
    }
  }
  function shelf(b: Box) {
    const f = frame(b),
      { L, W } = f,
      y0 = b.y - b.h / 2;
    for (const u of [-L / 2 + 0.04, L / 2 - 0.04]) {
      for (const v of [-W / 2 + 0.04, W / 2 - 0.04])
        f.box(u, b.y, v, 0.08, b.h, 0.08, "#2f5f9e");
      for (let y = 0.5; y < b.h; y += 0.7) f.box(u, y0 + y, 0, 0.04, 0.04, W - 0.08, "#2f5f9e");
    }
    const levels = [0.1, 1.12, 2.16].filter((l) => l < b.h - 0.4);
    levels.forEach((lv, i) => {
      for (const v of [-1, 1]) f.box(0, y0 + lv, v * (W / 2 - 0.04), L, 0.12, 0.06, "#e0762b");
      f.box(0, y0 + lv + 0.07, 0, L - 0.1, 0.02, W - 0.1, "#7a7e80");
      const room = (levels[i + 1] ?? b.h) - lv - 0.25;
      const [x, z] = f.at(0, 0);
      palletBase(x, y0 + lv + 0.08, z, f.alongX ? L - 0.25 : W - 0.2, f.alongX ? W - 0.2 : L - 0.25);
      const fill = room * (0.55 + hash(b.x + i, b.z) * 0.4);
      cartons(x, z, y0 + lv + 0.23, f.alongX ? L - 0.35 : W - 0.3, f.alongX ? W - 0.3 : L - 0.35, fill, b.x * 3 + i);
    });
  }
  function forklift(b: Box) {
    const f = frame(b),
      { L, W } = f,
      y0 = b.y - b.h / 2,
      c = "#e0a91f",
      body = L - 0.7;
    f.box(-L / 2 + body / 2, y0 + 0.62, 0, body, 0.62, W, c, "freight");
    f.box(-L / 2 + 0.25, y0 + 0.78, 0, 0.5, 0.95, W, shade(c, 0.85), "freight");
    for (let k = 0; k < 4; k++)
      f.box(-L / 2 - 0.005, y0 + 0.45 + k * 0.2, 0, 0.012, 0.09, W - 0.1, "#1d1d1d", "plain");
    f.box(-0.3, y0 + 1.0, 0, 0.45, 0.12, 0.5, "#232323", "plain");
    f.box(-0.5, y0 + 1.25, 0, 0.1, 0.45, 0.5, "#232323", "plain");
    for (const u of [-0.6, 0.25])
      for (const s of [-1, 1]) f.box(u, y0 + 1.5, s * (W / 2 - 0.08), 0.06, 1.75, 0.06, "#2a2a2a");
    f.box(-0.18, y0 + 2.36, 0, 1.0, 0.05, W - 0.1, "#2a2a2a");
    for (let k = 0; k < 5; k++) f.box(-0.18 + (k - 2) * 0.2, y0 + 2.39, 0, 0.03, 0.03, W - 0.15, "#2a2a2a");
    const mast = L / 2 - 0.62;
    for (const s of [-1, 1]) f.box(mast, y0 + 1.2, s * 0.36, 0.1, 2.3, 0.1, "#333333");
    for (const y of [0.4, 1.4, 2.3]) f.box(mast, y0 + y, 0, 0.08, 0.08, 0.8, "#333333");
    f.box(mast + 0.08, y0 + 0.45, 0, 0.06, 0.55, 0.95, "#333333");
    for (const s of [-1, 1]) f.box(L / 2 - 0.28, y0 + 0.08, s * 0.27, 0.56, 0.05, 0.12, "#3a3a3a");
    f.cyl("across", body - L / 2 - 0.35, y0 + 0.29, 0, 0.29, W - 0.02, "#1b1b1b", "plain", 16);
    f.cyl("across", -L / 2 + 0.38, y0 + 0.23, 0, 0.23, W - 0.02, "#1b1b1b", "plain", 16);
    f.cyl("up", 0.05, y0 + 1.25, 0, 0.14, 0.03, "#1b1b1b", "plain", 12);
  }
  function tree(b: Box) {
    const y0 = b.y - b.h / 2;
    const trunk = new THREE.CylinderGeometry(0.4, 0.62, 8.4, 11);
    add(trunk, b.x, y0 + 4.2, b.z, "#5c4b3b", "wood");
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5 + hash(b.x, i) * 0.8,
        fin = new THREE.BoxGeometry(0.14, 1.3, 1.1);
      fin.translate(0, 0, 0.75);
      fin.rotateY(a);
      add(fin, b.x, y0 + 0.62, b.z, "#56463a", "wood");
    }
    const greens = ["#3d5c2b", "#4a6b31", "#35532a", "#527239"];
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + hash(b.z, i),
        to = new THREE.Vector3(b.x + Math.cos(a) * 2.2, y0 + 7.6 + i * 0.4, b.z + Math.sin(a) * 2.2);
      rod(new THREE.Vector3(b.x, y0 + 5.6 + i * 0.5, b.z), to, 0.12, "#56463a");
    }
    for (let i = 0; i < 13; i++) {
      const a = i * 2.39 + hash(b.x, b.z + i),
        rad = i ? 1.2 + hash(i, b.x) * 1.9 : 0,
        r = 1.0 + hash(b.z, i) * 0.9;
      add(lump(r), b.x + Math.cos(a) * rad, y0 + 8.2 + hash(i, b.z) * 2.2 - rad * 0.25, b.z + Math.sin(a) * rad, greens[i % 4], "foliage", a);
    }
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + hash(b.x + i, 3),
        rad = 1.2 + hash(i, b.z) * 1.6,
        len = 1.8 + hash(b.x, i + 9) * 3;
      cub(b.x + Math.cos(a) * rad, y0 + 8.1 - len / 2, b.z + Math.sin(a) * rad, 0.05, len, 0.05, "#3b5a29", "foliage");
    }
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + hash(b.z, i + 4),
        rad = 1.2 + hash(i, b.x + 2) * 0.9,
        g = new THREE.IcosahedronGeometry(0.42 + hash(i, b.z) * 0.25, 0);
      g.scale(1, 0.55, 1);
      add(g, b.x + Math.cos(a) * rad, y0 + 0.2, b.z + Math.sin(a) * rad, i % 2 ? "#4f7334" : "#5d7f3c", "foliage");
    }
  }
  function ground(b: Box) {
    const top = b.y + b.h / 2;
    if (b.mat === "wood") {
      // Level crossing: timber boards laid parallel to the rails.
      const n = Math.round(b.d / 0.26);
      for (let i = 0; i < n; i++)
        cub(b.x, top - 0.03, b.z - b.d / 2 + (b.d * (i + 0.5)) / n, b.w, 0.06, b.d / n - 0.02, woods[i % woods.length], "wood");
      return;
    }
    const color =
      b.mat === "dirt"
        ? jungle
          ? "#6a5a40"
          : yard
            ? "#7a746a"
            : "#6e6455"
        : b.mat === "stone"
          ? "#a39b89"
          : b.mat === "metal"
            ? "#70777a"
            : "#8c877d";
    const key = b.mat === "stone" ? "stone-floor" : b.mat;
    cub(b.x, b.y, b.z, b.w, b.h, b.d, color, key);
    if (b.mat === "metal") {
      // Tread-plate seams.
      for (let x = b.x - b.w / 2 + 1.2; x < b.x + b.w / 2; x += 1.2)
        cub(x, top + 0.004, b.z, 0.03, 0.008, b.d, "#4b5052", "plain");
      for (let z = b.z - b.d / 2 + 2.4; z < b.z + b.d / 2; z += 2.4)
        cub(b.x, top + 0.004, z, b.w, 0.008, 0.03, "#4b5052", "plain");
    }
    if (jungle && b.mat === "dirt") {
      // Leaf litter and low growth at the edges of the path.
      for (let i = 0; i < Math.max(2, (b.w * b.d) / 18); i++) {
        const edge = hash(b.x + i, b.z) < 0.5,
          x = b.x + (edge ? (hash(i, b.x) < 0.5 ? -1 : 1) * (b.w / 2 - 0.25) : (hash(i, b.z) - 0.5) * b.w * 0.9),
          z = b.z + (edge ? (hash(b.z, i) - 0.5) * b.d * 0.9 : (hash(b.x, i) < 0.5 ? -1 : 1) * (b.d / 2 - 0.25));
        const g = new THREE.IcosahedronGeometry(0.28 + hash(i, i) * 0.2, 0);
        g.scale(1, 0.45, 1);
        add(g, x, top + 0.08, z, i % 3 ? "#4e7032" : "#61813c", "foliage");
      }
    }
  }

  for (const b of map.boxes) {
    if (!drawsBox(b)) continue;
    switch (b.style) {
      case "railcar":
        boxcar(b);
        break;
      case "tanker":
        tanker(b);
        break;
      case "bogie":
        bogie(b);
        break;
      case "loco":
        loco(b);
        break;
      case "column":
        column(b);
        break;
      case "idol":
        idol(b);
        break;
      case "plank":
        plank(b);
        break;
      case "shelf":
        shelf(b);
        break;
      case "pallet":
        pallet(b);
        break;
      case "forklift":
        forklift(b);
        break;
      case "tree":
        tree(b);
        break;
      default:
        ground(b);
    }
  }

  // ---------------------------------------------------------------- map dressing
  /** Calls `fn` for each 5 m stretch of building wall that faces a walkable tile. */
  function walls(fn: (x: number, z: number, nx: number, nz: number, top: number, b: Box) => void) {
    for (const b of map.boxes) {
      if (b.style !== "building") continue;
      for (const [nx, nz] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const span = nx ? b.d : b.w;
        for (let u = -(span - 5) / 2; u < span / 2; u += 5) {
          const x = b.x + (nx ? (nx * b.w) / 2 : u),
            z = b.z + (nz ? (nz * b.d) / 2 : u);
          const open = map.nodes.some(
            (n) => Math.abs(n.x - (x + nx * 2.5)) < 2.55 && Math.abs(n.z - (z + nz * 2.5)) < 2.55,
          );
          if (open) fn(x, z, nx, nz, b.h, b);
        }
      }
    }
  }
  /** A box placed against a wall: `u` along it, `out` away from it. */
  const onWall = (
    x: number,
    z: number,
    nx: number,
    nz: number,
    u: number,
    y: number,
    out: number,
    lw: number,
    h: number,
    depth: number,
    c: string,
    key = "plain",
  ) =>
    nx
      ? cub(x + nx * out, y, z + u, depth, h, lw, c, key)
      : cub(x + u, y, z + nz * out, lw, h, depth, c, key);

  if (yard) {
    const crossings: [number, number][] = [
      [37.5, 67.5],
      [67.5, 67.5],
      [22.5, 57.5],
      [52.5, 57.5],
      [82.5, 57.5],
    ];
    for (const tz of [57.5, 67.5]) {
      for (let x = 10.35; x < 94.8; x += 0.62) {
        if (crossings.some(([cx, cz]) => cz === tz && Math.abs(cx - x) < 2.35)) continue;
        cub(x, 0.1, tz, 0.22, 0.12, 2.5, woods[Math.floor(hash(x, tz) * woods.length)], "wood");
        if (hash(tz, x) < 0.5)
          for (const s of [-1, 1]) cub(x, 0.17, tz + s * 0.72, 0.18, 0.025, 0.24, "#3d3a36", "metal");
      }
      for (const s of [-1, 1]) {
        cub(52.5, 0.165, tz + s * 0.72, 85, 0.03, 0.16, "#47423c", "metal");
        cub(52.5, 0.24, tz + s * 0.72, 85, 0.13, 0.05, "#57524a", "metal");
        cub(52.5, 0.315, tz + s * 0.72, 85, 0.04, 0.085, "#9b988f", "metal");
      }
    }
    // Platform edge: a painted safety line and tactile strip.
    cub(52.5, 0.036, 70.45, 65, 0.012, 0.22, "#d6b33c", "plain");
    cub(52.5, 0.036, 70.85, 65, 0.012, 0.45, "#c7c1b1", "tile");
    // Lamp posts against the station wall.
    for (const x of [32, 45, 60, 72]) {
      cub(x, 2.2, 74.7, 0.14, 4.4, 0.14, "#2f3a36", "metal");
      cub(x, 4.35, 74.1, 0.08, 0.08, 1.2, "#2f3a36", "metal");
      cub(x, 4.25, 73.5, 0.5, 0.16, 0.32, "#3b4642", "metal");
      cub(x, 4.16, 73.5, 0.42, 0.02, 0.26, "#f3e6b8", "plain");
      cub(x, 2.6, 74.55, 0.5, 0.7, 0.04, "#1f3b5c", "plain");
    }
    // Downpipes, cable boxes and track-side signage on the yard walls.
    walls((x, z, nx, nz, top) => {
      const r = hash(x, z);
      if (r < 0.28) onWall(x, z, nx, nz, -1.6, top / 2, 0.08, 0.12, top - 0.3, 0.12, "#4b4d49", "metal");
      else if (r < 0.42) onWall(x, z, nx, nz, 1.2, 1.5, 0.12, 0.7, 0.9, 0.22, "#6c7470", "metal");
      else if (r < 0.5) onWall(x, z, nx, nz, 0.2, 2.6, 0.03, 1.6, 0.5, 0.04, "#e6dfcf", "plain");
    });
  } else if (jungle) {
    // Vines, moss and carved panels on every wall that faces a path.
    walls((x, z, nx, nz, top) => {
      const r = hash(x, z);
      const vines = 1 + Math.floor(r * 4);
      for (let i = 0; i < vines; i++) {
        const u = (hash(x + i, z) - 0.5) * 4.4,
          len = 1.4 + hash(z, x + i) * (top - 1.8);
        onWall(x, z, nx, nz, u, top - len / 2 + 0.2, 0.035, 0.035, len, 0.03, "#4a4a2c", "wood");
        // Leaves cluster thickly at the top of each vine and thin out toward the tip.
        const leaves = 5 + Math.floor(len * 1.6);
        for (let k = 0; k < leaves; k++) {
          const t = (k / leaves) ** 1.5,
            g = new THREE.IcosahedronGeometry(0.09 + (1 - t) * 0.13 * (0.6 + hash(i, k + x)), 0);
          g.scale(1.3, 0.75, 0.45);
          const side = (k % 2 ? 1 : -1) * (0.05 + hash(k, z) * 0.12),
            y = top + 0.1 - t * len,
            px = nx ? x + nx * 0.08 : x + u + side,
            pz = nz ? z + nz * 0.08 : z + u + side;
          add(g, px, y, pz, ["#4b6c31", "#3f6129", "#56783a"][k % 3], "foliage", hash(k, i) * 3);
        }
      }
      // Creeper spilling over the wall top.
      if (r < 0.5) {
        const u0 = (hash(z, 9) - 0.5) * 3;
        for (let k = 0; k < 7; k++) {
          const u = u0 + (hash(k, x) - 0.5) * 1.6,
            y = top + 0.15 - hash(x, k + z) * 1.1,
            g = lump(0.22 + hash(k, z) * 0.2, 0.35);
          g.scale(1, 1, 0.55);
          add(g, nx ? x + nx * 0.12 : x + u, y, nz ? z + nz * 0.12 : z + u, k % 2 ? "#3e5f2a" : "#4b6c31", "foliage", nx ? Math.PI / 2 : 0);
        }
      }
      onWall(x, z, nx, nz, (r - 0.5) * 2, top + 0.34, 0.1, 2 + r * 2.5, 0.06, 0.35, "#4a6a2f", "foliage");
      if (r > 0.55) {
        // A weathered relief: a stepped frame with glyph blocks.
        const y = 1.6 + hash(z, z) * 0.6;
        onWall(x, z, nx, nz, 0, y, 0.03, 2.4, 1.7, 0.06, shade(stone, 0.92), "stone");
        onWall(x, z, nx, nz, 0, y, 0.06, 1.9, 1.2, 0.05, shade(stone, 0.8), "stone");
        for (let gx = -1; gx <= 1; gx++)
          for (let gy = -1; gy <= 1; gy += 2)
            if (hash(gx + x, gy + z) > 0.25)
              onWall(x, z, nx, nz, gx * 0.55, y + gy * 0.3, 0.09, 0.36, 0.36, 0.04, shade(stone, 0.97), "stone");
      }
      // Ferns at the foot of the wall.
      for (let i = 0; i < 2; i++) {
        const g = new THREE.IcosahedronGeometry(0.35 + hash(x, i) * 0.25, 0);
        g.scale(1, 0.5, 1);
        const u = (hash(z + i, x) - 0.5) * 4,
          px = nx ? x + nx * 0.3 : x + u,
          pz = nz ? z + nz * 0.3 : z + u;
        add(g, px, 0.15, pz, i ? "#4f7334" : "#5f803c", "foliage");
      }
    });
  } else if (works) {
    const pipeColors = ["#8a8f8d", "#c9a227", "#9c3b2f", "#5d6f7a"];
    walls((x, z, nx, nz, top) => {
      const r = hash(x, z);
      if (r < 0.45) {
        // A pipe run along the wall on brackets, sometimes with a drop and a valve.
        const y = 3.0 + hash(z, x) * 0.9,
          rad = 0.1 + hash(x, x) * 0.1,
          c = pipeColors[Math.floor(hash(x + 1, z) * pipeColors.length)];
        const g = new THREE.CylinderGeometry(rad, rad, 5, 12);
        if (nx) g.rotateX(Math.PI / 2);
        else g.rotateZ(Math.PI / 2);
        add(g, x + nx * (rad + 0.12), y, z + nz * (rad + 0.12), c, "metal");
        for (const u of [-1.8, 0, 1.8])
          onWall(x, z, nx, nz, u, y - rad - 0.03, 0.12, 0.06, 0.06, rad * 2 + 0.24, "#3a3d3e", "metal");
        if (r < 0.18) {
          const d = new THREE.CylinderGeometry(rad, rad, y, 12);
          add(d, x + nx * (rad + 0.12) + (nz ? 1.2 : 0), y / 2, z + nz * (rad + 0.12) + (nx ? 1.2 : 0), c, "metal");
          const wheel = new THREE.TorusGeometry(0.2, 0.025, 6, 14);
          if (nz) wheel.rotateY(Math.PI / 2);
          wheel.rotateY(nx ? Math.PI / 2 : 0);
          add(wheel, x + nx * (rad * 2 + 0.3) + (nz ? 1.2 : 0), 1.3, z + nz * (rad * 2 + 0.3) + (nx ? 1.2 : 0), "#b3302a");
        }
      } else if (r < 0.62) {
        onWall(x, z, nx, nz, 1.1, 1.4, 0.1, 0.6, 0.8, 0.2, "#7b8384", "metal");
        onWall(x, z, nx, nz, 1.1, 1.6, 0.21, 0.4, 0.12, 0.02, "#d6b33c", "plain");
      }
      if (hash(z, x + 3) < 0.35)
        for (let k = 0; k < 5; k++)
          onWall(x, z, nx, nz, -2 + k * 0.5, 0.3, 0.02, 0.25, 0.6, 0.02, k % 2 ? "#1d1d1d" : "#d6b33c", "plain");
    });
    // Warehouse floor markings and the overhead crane runway.
    for (const zl of [17.6, 32.4]) cub(77.5, 0.012, zl, 22, 0.01, 0.12, "#d6b33c", "plain");
    for (const xl of [66.6, 78.4]) cub(xl, 0.012, 25, 0.12, 0.01, 14.6, "#d6b33c", "plain");
    for (const zl of [15.6, 34.4]) cub(77.5, 4.15, zl, 25, 0.32, 0.22, "#c9a227", "metal");
    cub(74, 3.95, 25, 0.5, 0.42, 19, "#c9a227", "metal");
    cub(74, 3.6, 25, 0.6, 0.35, 0.6, "#3a3d3e", "metal");
    rod(new THREE.Vector3(74, 3.45, 25), new THREE.Vector3(74, 2.3, 25), 0.015, "#2a2a2a");
    cub(74, 2.25, 25, 0.3, 0.12, 0.2, "#c9a227", "metal");
    // Ducting above the vents roof.
    const duct = new THREE.CylinderGeometry(0.45, 0.45, 15, 16);
    duct.rotateX(Math.PI / 2);
    add(duct, 66.5, 4.4, 52.5, "#9aa0a1", "metal");
  }

  // ---------------------------------------------------------------- backdrops
  const ring = (n: number, r0: number, r1: number, fn: (x: number, z: number, i: number) => void) => {
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + rnd() * 0.3,
        r = r0 + rnd() * (r1 - r0);
      fn(52.5 + Math.cos(a) * r, 52.5 + Math.sin(a) * r, i);
    }
  };
  function shed(x: number, z: number, w: number, h: number, d: number, c: string) {
    cub(x, h / 2, z, w, h, d, c, "plaster");
    const teeth = Math.max(2, Math.round(w / 5));
    for (let k = 0; k < teeth; k++) {
      const prism = new THREE.CylinderGeometry(2.4, 2.4, d, 3);
      prism.rotateX(Math.PI / 2);
      prism.scale(w / teeth / 4.1, 0.75, 1);
      add(prism, x - w / 2 + (w * (k + 0.5)) / teeth, h + 0.9, z, k % 2 ? "#5d6264" : "#6a6f70", "metal");
    }
  }
  if (yard || works) {
    ring(22, 78, 105, (x, z, i) =>
      shed(x, z, 12 + rnd() * 12, 7 + rnd() * 7, 9 + rnd() * 8, yard ? (i % 2 ? "#8a5444" : "#7a5a48") : i % 2 ? "#8f9393" : "#a19c92"),
    );
    // Floodlight masts.
    for (const [x, z] of [
      [-18, 20],
      [125, 85],
      [60, -24],
    ]) {
      cub(x, 14, z, 0.6, 28, 0.6, "#5e6466", "metal");
      cub(x, 28.4, z, 3.2, 1.4, 0.5, "#3b4143", "metal");
      cub(x, 28.4, z + 0.27, 2.9, 1.1, 0.04, "#efe6c4", "plain");
    }
  }
  if (yard) {
    // Water tower and a gantry crane over a distant container terminal.
    const tx = -24,
      tz = 66;
    for (const [sx, sz] of [
      [-1.6, -1.6],
      [1.6, -1.6],
      [-1.6, 1.6],
      [1.6, 1.6],
    ])
      rod(new THREE.Vector3(tx + sx * 1.4, 0, tz + sz * 1.4), new THREE.Vector3(tx + sx, 14, tz + sz), 0.16, "#4d4a45");
    add(new THREE.CylinderGeometry(3.4, 3.4, 5, 20), tx, 16.5, tz, "#6b4c3a", "wood");
    add(new THREE.ConeGeometry(3.7, 2, 20), tx, 20, tz, "#4a4f52", "metal");
    for (const x of [128, 146]) cub(x, 16, 20, 1.4, 32, 1.4, "#b84a2c", "metal");
    cub(137, 31, 20, 26, 2, 2.2, "#b84a2c", "metal");
    cub(137, 33, 6, 4, 2.6, 34, "#b84a2c", "metal");
    for (let i = 0; i < 9; i++)
      cub(124 + (i % 3) * 3, 1.3 + Math.floor(i / 3) * 2.6, 32 + (i % 2) * 7, 2.44, 2.6, 6, ["#7a3526", "#2f5d7c", "#5b6a3a", "#86532a"][i % 4], "metal");
  }
  if (works) {
    // Smokestacks, the blast furnace and a row of silos.
    for (const [x, z, h] of [
      [-30, 10, 48],
      [-22, 92, 40],
      [140, 60, 52],
    ]) {
      add(new THREE.CylinderGeometry(1.6, 2.4, h, 18), x, h / 2, z, "#8e8a82", "concrete");
      for (const k of [0.82, 0.9]) add(new THREE.CylinderGeometry(1.75, 1.75, 1.6, 18), x, h * k, z, "#a8382c", "plain");
    }
    add(new THREE.CylinderGeometry(9, 11, 26, 24), 128, 13, 100, "#5d5f5c", "metal");
    add(new THREE.ConeGeometry(9, 6, 24), 128, 29, 100, "#4c4e4c", "metal");
    rod(new THREE.Vector3(128, 26, 100), new THREE.Vector3(96, 44, 120), 1.2, "#6b6e6c");
    for (let i = 0; i < 4; i++) {
      add(new THREE.CylinderGeometry(4, 4, 18, 20), 20 + i * 9, 9, -32, "#b3b1aa", "metal");
      add(new THREE.ConeGeometry(4.1, 3, 20), 20 + i * 9, 19.5, -32, "#9a9890", "metal");
    }
  }
  if (jungle) {
    // A wall of rainforest around the ruins, and a stepped pyramid above the trees.
    const greens = ["#2f4a25", "#3a5a2c", "#2b4322", "#466a33"];
    ring(70, 60, 98, (x, z, i) => {
      const h = 10 + rnd() * 10;
      add(new THREE.CylinderGeometry(0.4, 0.7, h, 7), x, h / 2, z, "#4e4034", "wood");
      for (let k = 0; k < 5; k++)
        add(lump(2 + rnd() * 2.2, 0.3), x + (rnd() - 0.5) * 5, h + rnd() * 2.4 - 0.5, z + (rnd() - 0.5) * 5, greens[(i + k) % 4], "foliage", rnd() * 6);
    });
    ring(26, 120, 160, (x, z, i) => {
      const g = new THREE.SphereGeometry(18 + rnd() * 14, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 0.55, 1);
      add(g, x, -2, z, greens[i % 4], "foliage");
    });
    const px = 52.5,
      pz = -48;
    for (let k = 0; k < 6; k++) {
      const s = 44 - k * 7;
      cub(px, 3 + k * 6, pz, s, 6, s, shade(stone, 0.85 - k * 0.03), "stone");
      moss(px, 6.02 + k * 6, pz + s / 2 - 1.5, s * 0.9, 2.4);
    }
    cub(px, 41, pz, 9, 4, 9, shade(stone, 0.8), "stone");
    cub(px, 41, pz + 4.55, 2.4, 2.8, 0.2, "#1d1c17", "plain");
    // The great stair up the north face.
    const stair = new THREE.BoxGeometry(6, 1.2, Math.hypot(36, 17.5));
    stair.rotateX(Math.atan2(36, 17.5));
    add(stair, px, 18, pz + 13.2, shade(stone, 0.75), "stone");
  }
}
