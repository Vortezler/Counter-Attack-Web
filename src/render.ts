import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Box, MapDef, Team, Vec3 } from "./world";

export interface RenderActor extends Vec3 {
  id: number;
  yaw: number;
  team: Team;
  alive: boolean;
  crouched?: boolean;
  moving?: boolean;
  last?: Vec3;
}
export interface RenderFrame {
  camera: Vec3 & { yaw: number; pitch: number };
  actors: RenderActor[];
  viewId: number;
  weapon: string;
  kick?: number;
  reload?: number;
  move?: number;
  time?: number;
  zoom?: number;
  fov?: number;
  shadows?: boolean;
  debug?: boolean;
  bomb?: Vec3 | null;
  grenades?: (Vec3 & { type?: string; id?: number })[];
  hitboxLines?: Float32Array;
  reducedMotion?: boolean;
  spectating?: boolean;
  alpha?: number;
}

const dark = "#282e2d",
  gunmetal = "#414947",
  matte = "#343b39",
  grip = "#514e40";
function piece(
  host: THREE.Object3D,
  geo: THREE.BufferGeometry,
  color: string,
  x: number,
  y: number,
  z: number,
) {
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.75,
      metalness: color === gunmetal ? 0.32 : 0.05,
    }),
  );
  m.position.set(x, y, z);
  host.add(m);
  return m;
}
function part(
  host: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
) {
  return piece(host, new THREE.BoxGeometry(w, h, d), color, x, y, z);
}
function barrel(
  host: THREE.Object3D,
  r: number,
  len: number,
  color: string,
  x: number,
  y: number,
  z: number,
) {
  const m = piece(
    host,
    new THREE.CylinderGeometry(r, r, len, 10),
    color,
    x,
    y,
    z,
  );
  m.rotation.x = Math.PI / 2;
  return m;
}
function gun(id: string) {
  const g = new THREE.Group();
  if (id === "he" || id === "flash") {
    const flash = id === "flash";
    piece(
      g,
      flash
        ? new THREE.CylinderGeometry(0.052, 0.052, 0.17, 12)
        : new THREE.IcosahedronGeometry(0.078, 1),
      flash ? "#a5a69b" : "#68724e",
      0,
      0,
      0,
    );
    part(g, 0.06, 0.057, 0.062, matte, 0, 0.086, 0);
    part(g, 0.018, 0.12, 0.025, gunmetal, 0.046, 0.04, 0);
    const ring = piece(
      g,
      new THREE.TorusGeometry(0.031, 0.006, 5, 12),
      "#bec0aa",
      -0.034,
      0.1,
      0.013,
    );
    ring.rotation.y = 0.3;
    if (flash)
      for (const y of [-0.055, 0.055])
        piece(
          g,
          new THREE.CylinderGeometry(0.054, 0.054, 0.015, 12),
          matte,
          0,
          y,
          0,
        );
    return g;
  }
  if (id === "bomb") {
    for (let i = 0; i < 4; i++)
      part(g, 0.074, 0.11, 0.25, "#938567", -0.11 + i * 0.076, 0, 0);
    for (const z of [-0.078, 0.078]) part(g, 0.32, 0.12, 0.034, grip, 0, 0, z);
    part(g, 0.15, 0.035, 0.15, dark, 0, 0.077, 0);
    part(g, 0.098, 0.007, 0.036, "#789079", 0, 0.099, -0.037);
    for (let i = 0; i < 9; i++)
      part(
        g,
        0.017,
        0.008,
        0.013,
        "#9fa997",
        -0.031 + (i % 3) * 0.031,
        0.1,
        Math.floor(i / 3) * 0.025,
      );
    return g;
  }
  const pistol = id === "deagle" || id === "glock",
    heavy = id === "deagle",
    ak = id === "ak",
    sniper = id === "awp",
    lmg = id === "negev";
  if (pistol) {
    const length = heavy ? 0.31 : 0.245;
    part(
      g,
      heavy ? 0.061 : 0.053,
      0.054,
      length,
      heavy ? "#8c9189" : gunmetal,
      0,
      0.054,
      -length / 2 + 0.035,
    );
    part(
      g,
      0.052,
      0.043,
      length * 0.83,
      dark,
      0,
      0.018,
      -length * 0.38 + 0.025,
    );
    const handle = part(g, 0.052, 0.138, 0.078, grip, 0, -0.059, 0.001);
    handle.rotation.x = -0.22;
    for (let i = 0; i < 6; i++)
      part(g, 0.054, 0.006, 0.065, dark, 0, -0.111 + i * 0.019, 0.006);
    for (let i = 0; i < 6; i++)
      part(g, 0.055, 0.035, 0.003, matte, 0, 0.055, 0.018 - i * 0.008);
    part(g, 0.044, 0.012, 0.081, matte, 0, -0.054, -0.061);
    part(g, 0.044, 0.063, 0.012, matte, 0, -0.029, -0.098);
    barrel(g, 0.02, 0.018, dark, 0, 0.054, -length + 0.032);
    part(g, 0.012, 0.019, 0.016, dark, 0, 0.093, -length + 0.056);
    part(g, 0.041, 0.012, 0.018, matte, 0, 0.089, 0.02);
  } else {
    const body = sniper ? "#637057" : ak ? matte : lmg ? "#6b705a" : dark;
    part(g, 0.075, 0.092, 0.29, body, 0, 0.029, -0.018);
    part(g, 0.067, 0.028, 0.275, gunmetal, 0, 0.088, -0.025);
    const stock = part(
      g,
      0.069,
      0.085,
      0.175,
      ak ? "#896341" : body,
      0,
      0.016,
      0.165,
    );
    stock.rotation.x = 0.045;
    part(g, 0.078, 0.11, 0.031, matte, 0, 0.012, 0.26);
    const handle = part(
      g,
      0.053,
      0.136,
      0.068,
      ak ? "#76593d" : grip,
      0,
      -0.071,
      0.067,
    );
    handle.rotation.x = -0.23;
    const mag = part(
      g,
      lmg ? 0.135 : 0.056,
      lmg ? 0.108 : 0.15,
      lmg ? 0.138 : 0.085,
      lmg ? "#77765a" : matte,
      0,
      -0.086,
      -0.092,
    );
    mag.rotation.x = ak ? 0.2 : 0.05;
    for (let i = 0; i < 3; i++)
      part(
        mag,
        lmg ? 0.138 : 0.059,
        0.009,
        lmg ? 0.14 : 0.087,
        gunmetal,
        0,
        -0.037 + i * 0.024,
        0,
      );
    part(
      g,
      0.072,
      0.069,
      sniper ? 0.23 : 0.17,
      ak ? "#a47b4e" : body,
      0,
      0.022,
      -0.236,
    );
    for (let i = 0; i < (ak ? 3 : 7); i++)
      part(
        g,
        0.075,
        0.052,
        0.012,
        ak ? "#8a6642" : gunmetal,
        0,
        0.028,
        -0.17 - i * 0.02,
      );
    barrel(
      g,
      0.014,
      sniper ? 0.4 : 0.2,
      gunmetal,
      0,
      0.037,
      sniper ? -0.49 : -0.39,
    );
    if (id === "m4") barrel(g, 0.025, 0.21, matte, 0, 0.037, -0.54);
    if (sniper) {
      barrel(g, 0.034, 0.19, dark, 0, 0.148, -0.051);
      barrel(g, 0.045, 0.055, gunmetal, 0, 0.148, 0.046);
      barrel(g, 0.052, 0.083, matte, 0, 0.148, -0.148);
      part(g, 0.036, 0.064, 0.041, gunmetal, 0, 0.104, -0.075);
      barrel(g, 0.022, 0.055, matte, 0, 0.037, -0.7);
    } else {
      part(g, 0.017, 0.057, 0.015, gunmetal, 0, 0.074, -0.378);
      part(g, 0.045, 0.011, 0.018, matte, 0, 0.1, -0.378);
      if (!ak)
        for (let i = 0; i < 11; i++)
          part(g, 0.047, 0.009, 0.011, gunmetal, 0, 0.108, 0.095 - i * 0.019);
    }
  }
  return g;
}
function heldWeapon(id: string) {
  const rig = new THREE.Group(),
    model = gun(id);
  rig.add(model);
  const hand = (x: number, y: number, z: number, left: boolean) => {
    const glove = piece(
      rig,
      new THREE.SphereGeometry(1, 8, 6),
      "#554e3c",
      x,
      y,
      z,
    );
    glove.scale.set(0.053, 0.071, 0.072);
    glove.rotation.x = 0.24;
    for (let i = 0; i < 3; i++) {
      const finger = part(
        rig,
        0.013,
        0.021,
        0.056,
        "#645b46",
        x + (left ? 0.038 : -0.038),
        y + 0.035 - i * 0.026,
        z - 0.011,
      );
      finger.rotation.y = left ? 0.23 : -0.23;
    }
    const sleeve = piece(
      rig,
      new THREE.CylinderGeometry(0.052, 0.08, 0.35, 8),
      left ? "#696a52" : "#626951",
      x + (left ? -0.051 : 0.06),
      y - 0.122,
      z + 0.135,
    );
    sleeve.rotation.x = -0.91;
    sleeve.rotation.z = left ? -0.3 : 0.36;
  };
  hand(0.038, -0.083, 0.033, false);
  const small = ["he", "flash", "bomb", "glock", "deagle"].includes(id);
  hand(
    small ? -0.043 : -0.038,
    small ? -0.104 : -0.038,
    small ? -0.025 : -0.195,
    true,
  );
  return rig;
}
function humanoid(team: Team) {
  const root = new THREE.Group(),
    ct = team === "CT",
    uniform = ct ? "#586b74" : "#a88059",
    vest = ct ? "#384a50" : "#665944",
    legs: THREE.Group[] = [];
  for (const x of [-0.135, 0.135]) {
    const leg = new THREE.Group();
    root.add(leg);
    leg.position.set(x, 0.79, 0);
    legs.push(leg);
    part(leg, 0.19, 0.38, 0.2, uniform, 0, -0.18, 0);
    part(leg, 0.16, 0.3, 0.17, uniform, 0, -0.49, 0);
    part(leg, 0.18, 0.15, 0.26, "#3c3930", 0, -0.704, -0.025);
    part(leg, 0.16, 0.16, 0.07, vest, 0, -0.385, -0.095);
  }
  part(root, 0.41, 0.53, 0.23, uniform, 0, 1.05, 0);
  part(root, 0.46, 0.35, 0.28, vest, 0, 1.18, 0);
  for (const x of [-0.13, 0, 0.13])
    part(root, 0.107, 0.155, 0.07, ct ? "#62716b" : "#83775b", x, 1.1, -0.142);
  const head = piece(
    root,
    new THREE.SphereGeometry(0.159, 10, 7),
    ct ? "#907f67" : "#a88665",
    0,
    1.57,
    0,
  );
  head.scale.z = 0.88;
  if (ct) {
    const helm = piece(
      root,
      new THREE.SphereGeometry(0.181, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.63),
      "#4a5d62",
      0,
      1.62,
      0,
    );
    helm.scale.y = 0.82;
    part(root, 0.243, 0.066, 0.039, "#393e39", 0, 1.59, -0.127);
  } else {
    part(root, 0.274, 0.084, 0.06, "#6d6553", 0, 1.52, -0.11);
    part(root, 0.285, 0.081, 0.22, "#967654", 0, 1.688, 0);
  }
  for (const side of [-1, 1]) {
    const arm = part(
      root,
      0.14,
      0.33,
      0.15,
      uniform,
      side * 0.265,
      1.18,
      -0.04,
    );
    arm.rotation.x = -0.35;
    const forearm = part(
      root,
      0.12,
      0.12,
      0.28,
      uniform,
      side * 0.225,
      1.04,
      -0.17,
    );
    forearm.rotation.y = side * 0.3;
  }
  part(root, 0.087, 0.095, 0.47, dark, 0.13, 1.105, -0.26);
  barrel(root, 0.02, 0.25, matte, 0.13, 1.12, -0.6);
  // One draw per rigid body group preserves the leg animation while keeping the bot budget low.
  function flatten(group: THREE.Group) {
    const gs: THREE.BufferGeometry[] = [];
    for (const obj of [...group.children]) {
      if (!(obj instanceof THREE.Mesh)) continue;
      obj.updateMatrix();
      const g = obj.geometry.index
        ? obj.geometry.toNonIndexed()
        : obj.geometry.clone();
      g.applyMatrix4(obj.matrix);
      const n = g.getAttribute("position").count,
        c = obj.material.color,
        colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      gs.push(g);
      obj.geometry.dispose();
      obj.material.dispose();
      group.remove(obj);
    }
    const geo = mergeGeometries(gs, false);
    gs.forEach((g) => g.dispose());
    if (geo) {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      );
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }
  legs.forEach(flatten);
  flatten(root);
  return { root, legs, team };
}
function seeded(initial: number) {
  let n = initial;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
function makeCanvas(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d")! };
}
function texture(kind: string) {
  const { canvas, ctx } = makeCanvas(128, 128),
    rng = seeded(kind.length * 83);
  const base =
    (
      {
        wood: "#b5a48c",
        sand: "#ded5c1",
        stone: "#d6cfbd",
        metal: "#afb3ad",
        tile: "#c9c6b6",
        plaster: "#e7e3d8",
        concrete: "#d3ccbd",
        dirt: "#d1c3a9",
        cardboard: "#c6ae84",
        glass: "#9aaea7",
        foliage: "#879276",
      } as Record<string, string>
    )[kind] || "#d4cec0";
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 9500; i++) {
    ctx.fillStyle =
      rng() < 0.52 ? "rgba(31,27,21,.045)" : "rgba(255,253,236,.065)";
    ctx.fillRect(rng() * 128, rng() * 128, 0.4 + rng() * 2, 0.5 + rng() * 2);
  }
  if (kind === "stone" || kind === "tile" || kind === "sand") {
    ctx.strokeStyle =
      kind === "tile"
        ? "rgba(75,69,54,.34)"
        : kind === "stone"
          ? "rgba(73,65,46,.22)"
          : "rgba(80,70,55,.085)";
    ctx.lineWidth = 1;
    for (let y = 0; y < 128; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(128, y + 0.5);
      ctx.stroke();
      for (let x = y % 64 === 0 ? 0 : 32; x < 128; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 32);
        ctx.stroke();
      }
    }
  } else if (kind === "wood" || kind === "metal") {
    for (let i = 0; i < 128; i += kind === "wood" ? 2 : 12) {
      ctx.fillStyle =
        kind === "metal"
          ? "rgba(28,42,40,.18)"
          : `rgba(65,47,29,${0.038 + rng() * 0.08})`;
      ctx.fillRect(i, 0, kind === "metal" ? 3 : 1, 128);
    }
    if (kind === "wood")
      for (let i = 0; i < 128; i += 32) {
        ctx.fillStyle = "rgba(48,33,24,.42)";
        ctx.fillRect(i, 0, 1.6, 128);
      }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function sky(dust: boolean) {
  const { canvas, ctx } = makeCanvas(16, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, dust ? "#44738a" : "#547e9c");
  g.addColorStop(0.37, dust ? "#98b9bd" : "#a3c4cf");
  g.addColorStop(0.53, dust ? "#efcf9d" : "#ddceb4");
  g.addColorStop(1, "#8a775c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(canvas);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function stamp(text: string, fg: string, bg?: string) {
  const { canvas, ctx } = makeCanvas(256, 128);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, 240, 112);
  }
  ctx.font = "bold " + (text.length > 3 ? 38 : 94) + "px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = fg;
  ctx.fillText(text, 128, 66, 230);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
type Batch = { geo: THREE.BufferGeometry[]; mat: THREE.Material };
const axes = new THREE.Vector3(0, 1, 0);
function worldMeshes(map: MapDef, scene: THREE.Scene) {
  const dust = map.id === "dust2",
    rng = seeded(dust ? 418 : 673),
    batch = new Map<string, Batch>();
  const basic = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
  });
  batch.set("plain", { geo: [], mat: basic });
  function add(
    geo: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    color: string,
    key = "plain",
    rot = 0,
  ) {
    if (geo.index) {
      const orig = geo;
      geo = orig.toNonIndexed();
      orig.dispose();
    }
    if (!geo.getAttribute("uv"))
      geo.setAttribute(
        "uv",
        new THREE.BufferAttribute(
          new Float32Array(geo.getAttribute("position").count * 2),
          2,
        ),
      );
    geo.rotateY(rot);
    geo.translate(x, y, z);
    const pos = geo.getAttribute("position"),
      nor = geo.getAttribute("normal"),
      uv = geo.getAttribute("uv");
    const c = new THREE.Color(color),
      colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(nor.getX(i)),
        ay = Math.abs(nor.getY(i)),
        az = Math.abs(nor.getZ(i));
      if (key !== "plain") {
        uv.setXY(
          i,
          (ax > az && ax > ay ? pos.getZ(i) : pos.getX(i)) * 0.45,
          (ay > ax && ay > az ? pos.getZ(i) : pos.getY(i)) * 0.45,
        );
      }
      const shade = 1 - Math.max(0, 1 - pos.getY(i) / 3) * 0.13;
      colors[i * 3] = c.r * shade;
      colors[i * 3 + 1] = c.g * shade;
      colors[i * 3 + 2] = c.b * shade;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (!batch.has(key))
      batch.set(key, {
        geo: [],
        mat: new THREE.MeshStandardMaterial({
          map: texture(key),
          vertexColors: true,
          roughness: 0.94,
        }),
      });
    batch.get(key)!.geo.push(geo);
  }
  const cub = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    c: string,
    key = "plain",
    rot = 0,
  ) => add(new THREE.BoxGeometry(w, h, d), x, y, z, c, key, rot);
  const cyl = (
    x: number,
    y: number,
    z: number,
    r1: number,
    r2: number,
    h: number,
    c: string,
    n = 12,
  ) => add(new THREE.CylinderGeometry(r1, r2, h, n), x, y, z, c);
  function rod(from: THREE.Vector3, to: THREE.Vector3, r: number, c: string) {
    const diff = to.clone().sub(from),
      mid = to.clone().add(from).multiplyScalar(0.5),
      g = new THREE.CylinderGeometry(r, r, diff.length(), 5);
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(axes, diff.normalize()),
    );
    add(g, mid.x, mid.y, mid.z, c);
  }
  const texMaterials = new Map<string, THREE.MeshBasicMaterial>();
  function label(
    txt: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    yaw: number,
    floor = false,
    fg = "#a93e28",
    bg?: string,
  ) {
    const k = txt + fg + bg;
    if (!texMaterials.has(k))
      texMaterials.set(
        k,
        new THREE.MeshBasicMaterial({
          map: stamp(txt, fg, bg),
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          toneMapped: false,
        }),
      );
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      texMaterials.get(k)!,
    );
    mesh.rotation.y = yaw;
    if (floor) mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    scene.add(mesh);
  }
  function facade(b: Box, dx: number, dz: number) {
    const span = dx ? b.d : b.w,
      angle = Math.atan2(dx, dz),
      cx = b.x + (dx * b.w) / 2,
      cz = b.z + (dz * b.d) / 2;
    const X = (u: number, v: number) => cx + dz * u + dx * v,
      Z = (u: number, v: number) => cz - dx * u + dz * v;
    const visible = (u: number) =>
      map.nodes.some(
        (n) =>
          Math.abs(n.x - X(u, 2.5)) < 2.55 && Math.abs(n.z - Z(u, 2.5)) < 2.55,
      );
    const rect = (
      u: number,
      y: number,
      v: number,
      w: number,
      h: number,
      d: number,
      col: string,
      k = "plain",
    ) => cub(X(u, v), y, Z(u, v), w, h, d, col, k, angle);
    const palette = dust
      ? ["#5a716a", "#765b3f", "#476666", "#726852"]
      : ["#496d78", "#526e75", "#56765f", "#6a4e45"];
    let signed = false;
    for (let u = -(span - 5) / 2; u < span / 2; u += 5) {
      if (!visible(u)) continue;
      const clr = palette[Math.floor(rng() * palette.length)];
      const arch = rng() < 0.4;
      if (rng() < 0.38) {
        const tileColor = dust
          ? "#b4a084"
          : rng() < 0.6
            ? "#84a3aa"
            : "#b48d79";
        rect(u, 0.39, 0.012, 4.96, 0.78, 0.033, tileColor, "plaster");
        rect(u, 0.81, 0.029, 4.97, 0.06, 0.045, dust ? "#c9b593" : "#b7b6a1");
      }
      rect(u, 1.16, 0.025, 1.44, 2.32, 0.075, "#6f604b");
      rect(u, 1.1, 0.08, 1.16, 2.18, 0.07, clr, "wood");
      rect(u, 0.11, 0.19, 1.66, 0.22, 0.38, "#ac9d82", "stone");
      if (arch) {
        const geo = new THREE.CircleGeometry(0.69, 14, 0, Math.PI);
        add(geo, X(u, 0.09), 2.18, Z(u, 0.09), "#74664e", "plain", angle);
        const ring = new THREE.RingGeometry(0.69, 0.87, 14, 1, 0, Math.PI);
        add(ring, X(u, 0.12), 2.18, Z(u, 0.12), "#d9bd98", "plain", angle);
      } else rect(u, 2.34, 0.08, 1.65, 0.19, 0.18, "#cdb99a", "stone");
      rect(u + 0.39, 1.05, 0.13, 0.06, 0.1, 0.04, "#bdad84");
      for (const ww of [-1.12, 1.12]) {
        const y = Math.min(b.h - 1.2, 3.85 + rng() * 0.35);
        rect(u + ww, y, 0.035, 1.15, 1.52, 0.1, "#a5947c");
        rect(u + ww, y, 0.081, 0.94, 1.32, 0.1, "#333e39");
        rect(u + ww - 0.61, y, 0.12, 0.24, 1.34, 0.11, clr, "wood");
        rect(u + ww + 0.61, y, 0.12, 0.24, 1.34, 0.11, clr, "wood");
        rect(u + ww, y - 0.75, 0.15, 1.49, 0.13, 0.32, "#d2c3a5");
        if (rng() < 0.6) {
          rect(u + ww, y, 0.15, 0.06, 1.34, 0.05, "#786e57");
          rect(u + ww, y - 0.17, 0.15, 0.94, 0.06, 0.05, "#786e57");
        }
      }
      if (!signed && rng() < 0.18) {
        const signs = dust
          ? ["ATELIER", "ÉPICERIE", "MARCHÉ"]
          : ["CAFÉ", "BAZAR", "MARCHÉ"];
        label(
          signs[Math.floor(rng() * 3)],
          X(u, 0.17),
          2.86,
          Z(u, 0.17),
          2.26,
          0.7,
          angle,
          false,
          "#e2d6ab",
          clr,
        );
        signed = true;
      } else if (rng() < 0.27) {
        const awning = new THREE.BoxGeometry(2.15, 0.1, 1.0);
        awning.rotateX(0.12);
        add(
          awning,
          X(u, 0.52),
          2.7,
          Z(u, 0.52),
          dust ? "#8c7753" : "#ad7961",
          "plain",
          angle,
        );
        rect(u, 2.57, 0.97, 2.16, 0.18, 0.08, dust ? "#756442" : "#96654e");
      } else if (rng() < 0.16)
        rect(u + 1.58, 2.1, 0.12, 0.65, 0.89, 0.24, "#9b9f94", "metal");
    }
  }
  const dustWalls = [
    "#e9c89d",
    "#e1bf93",
    "#e4ceb0",
    "#d7b48a",
    "#d1b18d",
    "#ddc9a8",
  ];
  const mirageWalls = [
    "#d8b5a1",
    "#e0c7ad",
    "#a6bac0",
    "#dbc0a9",
    "#b3bfb9",
    "#d7ae96",
  ];
  for (const b of map.boxes) {
    const { x, y, z, w, h, d, mat, style } = b;
    const palette = dust ? dustWalls : mirageWalls;
    const tint =
      style === "building"
        ? palette[Math.floor(rng() * palette.length)]
        : style === "floor"
          ? dust
            ? "#d3bd96"
            : "#c9baa4"
          : mat === "wood"
            ? "#9e794b"
            : mat === "metal"
              ? "#607878"
              : mat === "concrete"
                ? "#adab9a"
                : mat === "glass"
                  ? "#87a7a3"
                  : "#d4be9c";
    cub(x, y, z, w, h, d, tint, mat);
    if (style === "building") {
      cub(
        x,
        h - 0.15,
        z,
        w + 0.12,
        0.24,
        d + 0.12,
        dust ? "#b6a17d" : "#b8a391",
        "stone",
      );
      const lip = dust ? "#dfc4a0" : "#d3c4b0";
      cub(x, h + 0.16, z + d / 2 - 0.1, w, 0.32, 0.2, lip);
      cub(x, h + 0.16, z - d / 2 + 0.1, w, 0.32, 0.2, lip);
      cub(x - w / 2 + 0.1, h + 0.16, z, 0.2, 0.32, d, lip);
      cub(x + w / 2 - 0.1, h + 0.16, z, 0.2, 0.32, d, lip);
      if (rng() < 0.36) {
        cub(x, h + 0.5, z, 1.42, 0.95, 0.9, "#a3a298", "metal");
        cub(x, h + 1, z, 1.49, 0.12, 0.95, "#bdbbb1");
      }
      if (rng() < 0.18) {
        cyl(x + 0.7, h + 0.9, z - 0.6, 0.034, 0.045, 1.8, "#6a6d61");
        cub(x + 0.7, h + 1.66, z - 0.6, 1.75, 0.045, 0.045, "#777969");
      }
      facade(b, 0, 1);
      facade(b, 0, -1);
      facade(b, 1, 0);
      facade(b, -1, 0);
    } else if (style === "crate") {
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          cub(
            x + sx * (w / 2 - 0.045),
            y,
            z + sz * (d / 2 - 0.045),
            0.13,
            h + 0.04,
            0.13,
            "#735b3a",
            "wood",
          );
      for (const sy of [-1, 1]) {
        cub(
          x,
          y + sy * (h / 2 - 0.08),
          z,
          w + 0.03,
          0.15,
          d + 0.03,
          "#977a50",
          "wood",
        );
      }
      for (const sz of [-1, 1]) {
        const g = new THREE.BoxGeometry(
          Math.hypot(w * 0.88, h * 0.74),
          0.11,
          0.065,
        );
        g.rotateZ(Math.atan2(h * 0.74, w * 0.88));
        add(g, x, y, z + sz * (d / 2 + 0.01), "#8b6d47", "wood");
      }
    } else if (style === "door") {
      for (const f of [-1, 1])
        for (const k of [-0.9, 0, 0.9])
          cub(
            x,
            y + k,
            z + f * (d / 2 + 0.015),
            w + 0.02,
            0.1,
            0.05,
            "#585640",
          );
    }
  }
  for (const r of map.ramps) {
    const p = (x: number, z: number) =>
      r.y +
      r.h *
        (0.5 +
          (r.up === "N"
            ? -z / r.d
            : r.up === "S"
              ? z / r.d
              : r.up === "E"
                ? x / r.w
                : -x / r.w));
    const corners = [
      [-r.w / 2, -r.d / 2],
      [-r.w / 2, r.d / 2],
      [r.w / 2, r.d / 2],
      [r.w / 2, -r.d / 2],
    ];
    const vs: number[] = [];
    const put = (i: number, top: boolean) => {
      const [x, z] = corners[i];
      vs.push(x, top ? p(x, z) : r.y, z);
    };
    for (const i of [0, 1, 2, 0, 2, 3]) put(i, true);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      put(i, true);
      put(i, false);
      put(j, true);
      put(j, true);
      put(i, false);
      put(j, false);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(vs, 3));
    g.computeVertexNormals();
    add(g, r.x, 0, r.z, "#c5b29a", "stone");
  }
  if (map.id !== "range") {
    const spawn = map.spawns.CT[0];
    for (const east of [-1, 1]) {
      const candidates = map.boxes.filter(
        (b) =>
          b.style === "building" &&
          Math.sign(b.x - spawn.x) === east &&
          b.z - b.d / 2 > spawn.z + 2 &&
          b.z - b.d / 2 < spawn.z + 15,
      );
      candidates.sort(
        (a, b) =>
          Math.abs(a.x - spawn.x) +
          Math.abs(a.z - a.d / 2 - spawn.z) -
          Math.abs(b.x - spawn.x) -
          Math.abs(b.z - b.d / 2 - spawn.z),
      );
      const wall = candidates[0];
      if (wall) {
        const pos =
          wall.x +
          Math.max(
            -wall.w / 2 + 1.2,
            Math.min(wall.w / 2 - 1.2, spawn.x - wall.x),
          );
        label(
          east === 1 ? "A" : "B",
          pos,
          1.76,
          wall.z - wall.d / 2 - 0.18,
          1.75,
          1.35,
          Math.PI,
          false,
          east === 1 ? "#a5422f" : "#547e78",
        );
      }
    }
    for (const letter of ["A", "B"] as const) {
      const site = map.sites[letter],
        fg = letter === "A" ? "#9e4730" : "#715634";
      label(letter, site.x, site.y + 0.024, site.z, 4.3, 2.7, 0, true, fg);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          cub(
            site.x + sx * 1.8,
            site.y + 0.014,
            site.z + sz * 1.85,
            1,
            0.021,
            0.095,
            fg,
          );
          cub(
            site.x + sx * 2.26,
            site.y + 0.014,
            site.z + sz * 1.46,
            0.095,
            0.021,
            0.85,
            fg,
          );
        }
      const wall = map.boxes
        .filter((b) => b.style === "building")
        .sort(
          (l, r) =>
            Math.hypot(l.x - site.x, l.z - site.z) -
            Math.hypot(r.x - site.x, r.z - site.z),
        )[0];
      const dx = site.x - wall.x,
        dz = site.z - wall.z,
        alongX = Math.abs(dx) / wall.w > Math.abs(dz) / wall.d;
      const nx = alongX ? Math.sign(dx) : 0,
        nz = alongX ? 0 : Math.sign(dz);
      label(
        letter,
        wall.x + nx * (wall.w / 2 + 0.24),
        2.5,
        wall.z + nz * (wall.d / 2 + 0.24),
        2.9,
        2.1,
        Math.atan2(nx, nz),
        false,
        fg,
      );
    }
    for (const [tx, tz] of [
      [56, 14],
      [84, 43],
      [19, 24],
      [28, 81],
      [78, 78],
    ]) {
      const base = map.boxes.find(
        (b) =>
          b.style === "building" &&
          Math.abs(b.x - tx) < b.w / 2 &&
          Math.abs(b.z - tz) < b.d / 2,
      );
      if (!base) continue;
      const start = new THREE.Vector3(tx, base.h + 0.6, tz),
        end = new THREE.Vector3(tx + 9, base.h + 0.9, tz + 5);
      let from = start;
      for (let i = 1; i <= 7; i++) {
        const t = i / 7,
          to = start.clone().lerp(end, t);
        to.y -= Math.sin(t * Math.PI) * 1.1;
        rod(from, to, 0.022, "#514c3d");
        from = to;
      }
    }
    for (const lane of [
      spawn,
      ...map.callouts.filter(
        (c) =>
          c.name === "Long A" || c.name === "Mid" || c.name === "Apartments",
      ),
    ]) {
      const nearby = map.boxes.filter(
        (b) => b.style === "building" && Math.abs(b.z - (lane.z + 6)) < 10,
      );
      const left = nearby
        .filter((b) => b.x < lane.x)
        .sort((a, b) => Math.abs(a.x - lane.x) - Math.abs(b.x - lane.x))[0];
      const right = nearby
        .filter((b) => b.x > lane.x)
        .sort((a, b) => Math.abs(a.x - lane.x) - Math.abs(b.x - lane.x))[0];
      if (!left || !right) continue;
      const z = lane.z + 5;
      for (let j = 0; j < 3; j++) {
        const a = new THREE.Vector3(
          left.x,
          Math.min(6.8, left.h) - j * 0.12,
          z + j * 0.24,
        );
        const b = new THREE.Vector3(
          right.x,
          Math.min(7.4, right.h) - j * 0.16,
          z + 2.2 + j * 0.32,
        );
        let from = a;
        for (let i = 1; i <= 12; i++) {
          const u = i / 12,
            to = a.clone().lerp(b, u);
          to.y -= Math.sin(u * Math.PI) * (0.8 + j * 0.16);
          rod(from, to, 0.02, "#45493e");
          from = to;
        }
      }
    }
    for (let i = 0; i < 36; i++) {
      const theta = i * 2.39996,
        rad = 83 + rng() * 20,
        x = 52 + Math.sin(theta) * rad,
        z = 52 + Math.cos(theta) * rad,
        h = 8 + rng() * 15,
        w = 6 + rng() * 9;
      cub(
        x,
        h / 2,
        z,
        w,
        h,
        7 + rng() * 6,
        dust ? "#c6b392" : "#baa99b",
        "plaster",
      );
      if (i % 6 === 0) {
        cyl(x, h + 3, z, 1.15, 1.32, 6, "#c6b393");
        cyl(x, h + 5.8, z, 1.55, 1.5, 0.4, "#d6c2a1");
        add(
          new THREE.SphereGeometry(1.25, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
          x,
          h + 6,
          z,
          dust ? "#81958c" : "#869b9e",
        );
        cyl(x, h + 7.4, z, 0.04, 0.12, 1.5, "#ac9a77");
      }
    }
    // Palm silhouettes rise behind the playable walls, keeping walkable space clear.
    for (let i = 0; i < 23; i++) {
      const angle = i * 2.39,
        rad = i % 2 ? 59 : 70,
        x = 52 + Math.cos(angle) * rad,
        z = 52 + Math.sin(angle) * rad,
        h = 7 + rng() * 7;
      cyl(x, h / 2, z, 0.2, 0.42, h, "#8a7660", 8);
      for (let j = 0; j < 11; j++) {
        const a = (j * Math.PI * 2) / 11 + rng() * 0.25,
          len = 3.0 + rng() * 2.4;
        const verts: number[] = [];
        function leaf(t: number, s: number) {
          const ww = Math.sin(t * Math.PI) * 0.5 * s;
          return [
            Math.cos(a) * len * t - Math.sin(a) * ww,
            Math.sin(t * Math.PI) * 1.15 - t * 1.8,
            Math.sin(a) * len * t + Math.cos(a) * ww,
          ];
        }
        for (let q = 0; q < 8; q++) {
          const t = q / 8,
            u = (q + 1) / 8;
          for (const [tt, ss] of [
            [t, -1],
            [u, 1],
            [t, 1],
            [t, -1],
            [u, -1],
            [u, 1],
          ])
            verts.push(...leaf(tt, ss));
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        g.computeVertexNormals();
        add(g, x, h, z, j % 2 ? "#607456" : "#71805c");
      }
    }
  } else {
    label("25 M", 36, 3.65, 17.055, 3, 1.5, 0, false, "#393c32", "#dbd2b6");
    for (let i = 0; i < 6; i++)
      label(
        ["WOOD", "PLASTER", "METAL", "STONE", "GLASS", "BOARD"][i],
        2 + i * 4.15,
        1.6,
        32.7,
        2.2,
        0.75,
        0,
        false,
        "#e9dbb3",
        "#444c43",
      );
  }
  for (const { geo, mat } of batch.values()) {
    if (!geo.length) continue;
    const merged = mergeGeometries(geo, false);
    geo.forEach((g) => g.dispose());
    if (merged) {
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
  }
}

function releaseTree(root: THREE.Object3D) {
  const geometry = new Set<THREE.BufferGeometry>(),
    material = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.geometry) return;
    geometry.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      material.add(mat);
      const t = (mat as THREE.MeshStandardMaterial).map;
      if (t) textures.add(t);
    }
  });
  geometry.forEach((g) => g.dispose());
  material.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}
export class GameRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private hands = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(74, 1, 0.045, 420);
  private handsCam = new THREE.PerspectiveCamera(68, 1, 0.015, 3);
  private sun = new THREE.DirectionalLight(0xffe5bd, 2.0);
  private people = new Map<number, ReturnType<typeof humanoid>>();
  private arsenal = new Map<string, THREE.Group>();
  private currentGun = "";
  private bomb: THREE.Group;
  private throws: THREE.Mesh[] = [];
  private decals: THREE.Mesh[] = [];
  private tracers: { line: THREE.Line; ttl: number }[] = [];
  private debugTraces: {
    line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    ttl: number;
  }[] = [];
  private debugTraceIndex = 0;
  private trails = new Map<
    number,
    { line: THREE.Line; points: THREE.Vector3[]; last: number }
  >();
  private bursts: { mesh: THREE.Mesh; ttl: number; max: number }[] = [];
  private marks = 0;
  private traces = 0;
  private burstIndex = 0;
  private lastClock = 0;
  private lastW = 0;
  private lastH = 0;
  private wire: THREE.LineSegments | null = null;
  private hitboxWire: THREE.LineSegments | null = null;
  private muzzleLight: THREE.Mesh;
  private viewFlash = 0;
  private slowTime = 0;
  private degraded = false;
  private shadowSetting = true;
  constructor(
    public canvas: HTMLCanvasElement,
    public map: MapDef,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = sky(map.id === "dust2");
    this.scene.fog = new THREE.FogExp2(
      map.id === "dust2" ? 0xe1c49d : 0xcac0ad,
      0.0065,
    );
    this.scene.add(new THREE.HemisphereLight(0xd6e4e9, 0xaa9270, 2.25));
    this.sun.position.set(map.width * 0.5 - 42, 65, map.depth * 0.5 - 30);
    this.sun.target.position.set(map.width * 0.5, 0, map.depth * 0.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const shadow = this.sun.shadow.camera,
      size = Math.max(map.width, map.depth) * 0.66;
    shadow.left = -size;
    shadow.right = size;
    shadow.top = size;
    shadow.bottom = -size;
    shadow.near = 0.5;
    shadow.far = 175;
    this.sun.shadow.bias = -0.00022;
    this.sun.shadow.normalBias = 0.045;
    this.scene.add(this.sun, this.sun.target);
    worldMeshes(map, this.scene);
    this.hands.add(new THREE.HemisphereLight(0xe2edf3, 0xb1a584, 2.0));
    const key = new THREE.DirectionalLight(0xffe5be, 2.8);
    key.position.set(-2, 3, -2);
    this.hands.add(key);
    this.bomb = gun("bomb");
    this.bomb.visible = false;
    this.scene.add(this.bomb);
    const nadeMat = new THREE.MeshStandardMaterial({ color: 0x666d4d }),
      nadeGeo = new THREE.IcosahedronGeometry(0.09, 1);
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Mesh(nadeGeo, nadeMat);
      g.visible = false;
      this.throws.push(g);
      this.scene.add(g);
    }
    const markGeo = new THREE.IcosahedronGeometry(0.035, 0),
      markMat = new THREE.MeshBasicMaterial({ color: 0x514a38 });
    for (let i = 0; i < 128; i++) {
      const g = new THREE.Mesh(markGeo, markMat);
      g.visible = false;
      this.decals.push(g);
      this.scene.add(g);
    }
    const tracerMaterial = new THREE.LineBasicMaterial({
      color: 0xffda92,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    for (let i = 0; i < 10; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(6), 3),
      );
      const line = new THREE.Line(g, tracerMaterial);
      line.visible = false;
      line.frustumCulled = false;
      this.tracers.push({ line, ttl: 0 });
      this.scene.add(line);
    }
    const sphere = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 7; i++) {
      const mesh = new THREE.Mesh(
        sphere,
        new THREE.MeshBasicMaterial({
          color: 0xfcb65f,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.bursts.push({ mesh, ttl: 0, max: 0.3 });
    }
    this.muzzleLight = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.054, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd680, toneMapped: false }),
    );
    this.muzzleLight.visible = false;
    this.hands.add(this.muzzleLight);
    this.resize();
  }
  resize() {
    const w = Math.round(
      this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 640,
    );
    const h = Math.round(
      this.canvas.clientHeight ||
        this.canvas.parentElement?.clientHeight ||
        360,
    );
    if (this.lastW === w && this.lastH === h) return;
    this.lastW = w;
    this.lastH = h;
    this.renderer.setSize(Math.max(1, w), Math.max(1, h), false);
    this.camera.aspect = this.handsCam.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.handsCam.updateProjectionMatrix();
  }
  preview(time = 0) {
    this.resize();
    this.camera.fov = 47;
    this.camera.updateProjectionMatrix();
    const x = this.map.width * 0.77,
      z = this.map.depth * 0.36;
    this.camera.position.set(x + 13 + Math.sin(time * 0.045) * 1.5, 15, z + 18);
    this.camera.lookAt(x - 6, 3.5, z - 9);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }
  trace(from: Vec3, to: Vec3, kind: string) {
    if (this.debugTraces.length < 36) {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(6), 3),
      );
      const line = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({
          depthTest: false,
          transparent: true,
          opacity: 0.8,
        }),
      );
      line.frustumCulled = false;
      this.scene.add(line);
      this.debugTraces.push({ line, ttl: 0 });
    }
    const t =
        this.debugTraces[this.debugTraceIndex++ % this.debugTraces.length],
      a = t.line.geometry.getAttribute("position");
    a.setXYZ(0, from.x, from.y - 0.035, from.z);
    a.setXYZ(1, to.x, to.y, to.z);
    a.needsUpdate = true;
    t.line.material.color.set(
      kind === "blocked" ? 0xef634e : kind === "solid" ? 0xffcc51 : 0x8fea8c,
    );
    t.line.visible = true;
    t.ttl = 0.8;
  }
  impact(point: Vec3, normal: Vec3) {
    const d = this.decals[this.marks++ % this.decals.length];
    d.position.set(
      point.x + normal.x * 0.01,
      point.y + normal.y * 0.01,
      point.z + normal.z * 0.01,
    );
    d.visible = true;
  }
  shot(from: Vec3, to: Vec3, weapon = "", local = false) {
    if (weapon !== "m4" && weapon !== "M4A1-S") {
      const t = this.tracers[this.traces++ % this.tracers.length],
        a = t.line.geometry.getAttribute("position");
      a.setXYZ(0, from.x, from.y - 0.065, from.z);
      a.setXYZ(1, to.x, to.y, to.z);
      a.needsUpdate = true;
      t.line.visible = true;
      t.ttl = 0.056;
      if (
        local ||
        Math.hypot(
          from.x - this.camera.position.x,
          from.y - this.camera.position.y,
          from.z - this.camera.position.z,
        ) < 0.8
      )
        this.viewFlash = 0.045;
    }
  }
  burst(pos: Vec3, type: string) {
    const b = this.bursts[this.burstIndex++ % this.bursts.length];
    b.mesh.position.set(pos.x, pos.y, pos.z);
    b.mesh.visible = true;
    const mat = b.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(type.toLowerCase().includes("flash") ? 0xfff5d8 : 0xe9a25d);
    b.max = type === "bomb" ? 0.65 : 0.32;
    b.ttl = b.max;
  }
  private debugLines() {
    if (this.wire) return;
    for (const callout of this.map.callouts) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 48;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "#17221cdb";
      ctx.fillRect(0, 0, 256, 48);
      ctx.font = "600 25px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#e3f4c5";
      ctx.fillText(callout.name, 128, 24);
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(canvas),
          depthWrite: false,
        }),
      );
      label.position.set(callout.x, 3.8, callout.z);
      label.scale.set(3.8, 0.71, 1);
      this.scene.add(label);
    }
    const values: number[] = [];
    for (const n of this.map.nodes)
      for (const j of n.links) {
        const dest = this.map.nodes[j];
        values.push(n.x, n.y + 0.09, n.z, dest.x, dest.y + 0.09, dest.z);
      }
    for (const b of this.map.boxes) {
      if (b.style === "floor") continue;
      const box = new THREE.BoxGeometry(b.w, b.h, b.d),
        e = new THREE.EdgesGeometry(box);
      box.dispose();
      e.translate(b.x, b.y, b.z);
      values.push(...e.getAttribute("position").array);
      e.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
    this.wire = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({
        color: 0x76dfc7,
        transparent: true,
        opacity: 0.58,
      }),
    );
    this.scene.add(this.wire);
  }
  private drawHitboxes(vertices: Float32Array) {
    if (!this.hitboxWire) {
      this.hitboxWire = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0xeded7c }),
      );
      this.hitboxWire.frustumCulled = false;
      this.scene.add(this.hitboxWire);
    }
    const geometry = this.hitboxWire.geometry;
    let attribute = geometry.getAttribute("position") as
      THREE.BufferAttribute | undefined;
    if (!attribute || attribute.array.length < vertices.length) {
      geometry.dispose();
      attribute = new THREE.BufferAttribute(
        new Float32Array(vertices.length),
        3,
      );
      geometry.setAttribute("position", attribute);
    }
    attribute.array.set(vertices);
    attribute.needsUpdate = true;
    geometry.setDrawRange(0, vertices.length / 3);
  }
  render(f: RenderFrame) {
    this.resize();
    const now = performance.now() / 1000,
      elapsed = this.lastClock ? Math.min(0.15, now - this.lastClock) : 1 / 60;
    this.lastClock = now;
    const t = f.time ?? now;
    if (f.shadows !== this.shadowSetting) {
      this.shadowSetting = f.shadows ?? true;
      if (f.shadows === false) {
        this.degraded = false;
        this.slowTime = 0;
      }
    }
    this.slowTime =
      elapsed > 1 / 44
        ? this.slowTime + elapsed
        : Math.max(0, this.slowTime - elapsed * 2);
    if (this.slowTime > 3) this.degraded = true;
    this.sun.castShadow = this.shadowSetting && !this.degraded;
    if (f.debug) {
      this.debugLines();
      if (f.hitboxLines) this.drawHitboxes(f.hitboxLines);
      this.wire!.visible = true;
    } else if (this.wire) this.wire.visible = false;
    for (const tr of this.debugTraces) {
      tr.ttl -= elapsed;
      tr.line.visible = !!f.debug && tr.ttl > 0;
    }
    for (const [id, tr] of this.trails)
      if (!f.grenades?.some((g) => g.id === id)) {
        this.scene.remove(tr.line);
        releaseTree(tr.line);
        this.trails.delete(id);
      }
    for (const g of f.grenades ?? []) {
      if (g.id === undefined) continue;
      let tr = this.trails.get(g.id);
      if (!tr) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array(18 * 3), 3),
        );
        geo.setDrawRange(0, 0);
        const line = new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({
            color: 0xbfcdb0,
            transparent: true,
            opacity: 0.42,
          }),
        );
        line.frustumCulled = false;
        this.scene.add(line);
        tr = { line, points: [], last: -1 };
        this.trails.set(g.id, tr);
      }
      if (t - tr.last > 0.035) {
        tr.last = t;
        const p =
          tr.points.length >= 18 ? tr.points.shift()! : new THREE.Vector3();
        tr.points.push(p.set(g.x, g.y, g.z));
        const a = tr.line.geometry.getAttribute("position");
        tr.points.forEach((pt, i) => a.setXYZ(i, pt.x, pt.y, pt.z));
        a.needsUpdate = true;
        tr.line.geometry.setDrawRange(0, tr.points.length);
      }
    }
    const c = f.camera,
      k = f.kick ?? 0,
      move = f.reducedMotion ? 0 : Math.min(1, f.move ?? 0);
    this.camera.position.set(c.x, c.y + Math.sin(t * 13) * 0.013 * move, c.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(c.pitch, -c.yaw, 0, "YXZ");
    // Hor+ projection: a 90° horizontal field at 4:3 becomes 73.74° vertical.
    const base = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(f.fov ?? 90) / 2) * 0.75),
    );
    const zoom = f.zoom ?? 0,
      fov = zoom > 2 ? zoom : zoom === 2 ? 10 : zoom === 1 ? 40 : base;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    for (const p of f.actors) {
      let model = this.people.get(p.id);
      if (model && model.team !== p.team) {
        this.scene.remove(model.root);
        releaseTree(model.root);
        this.people.delete(p.id);
        model = undefined;
      }
      if (!model) {
        model = humanoid(p.team);
        this.people.set(p.id, model);
        this.scene.add(model.root);
      }
      model.root.visible = p.alive && p.id !== f.viewId;
      const last = p.last ?? p,
        alpha = f.alpha ?? 1;
      model.root.position.set(
        last.x + (p.x - last.x) * alpha,
        last.y + (p.y - last.y) * alpha,
        last.z + (p.z - last.z) * alpha,
      );
      model.root.rotation.y = -p.yaw;
      model.root.scale.y = p.crouched ? 0.75 : 1;
      for (let i = 0; i < 2; i++)
        model.legs[i].rotation.x = p.moving
          ? Math.sin(t * 10 + p.id + i * Math.PI) * 0.44
          : 0;
    }
    this.bomb.visible = !!f.bomb;
    if (f.bomb) this.bomb.position.set(f.bomb.x, f.bomb.y + 0.09, f.bomb.z);
    for (let i = 0; i < this.throws.length; i++) {
      const pos = f.grenades?.[i],
        g = this.throws[i];
      g.visible = !!pos;
      if (pos) g.position.set(pos.x, pos.y, pos.z);
    }
    for (const trace of this.tracers) {
      trace.ttl -= elapsed;
      trace.line.visible = trace.ttl > 0;
    }
    for (const b of this.bursts) {
      b.ttl -= elapsed;
      b.mesh.visible = b.ttl > 0;
      if (b.mesh.visible) {
        b.mesh.scale.setScalar(
          0.1 + (1 - b.ttl / b.max) * (b.max > 0.5 ? 5 : 2.4),
        );
        (b.mesh.material as THREE.MeshBasicMaterial).opacity =
          (b.ttl / b.max) * 0.66;
      }
    }
    if (this.currentGun !== f.weapon) {
      const old = this.arsenal.get(this.currentGun);
      if (old) old.visible = false;
      if (!this.arsenal.has(f.weapon)) {
        const rig = heldWeapon(f.weapon);
        this.arsenal.set(f.weapon, rig);
        this.hands.add(rig);
      }
      this.currentGun = f.weapon;
    }
    const rig = this.arsenal.get(f.weapon),
      reload = Math.max(0, Math.min(1, f.reload ?? 0)),
      dip = Math.sin(reload * Math.PI);
    if (rig) {
      rig.visible = !zoom && !f.spectating;
      const short = ["deagle", "glock", "he", "flash", "bomb"].includes(
        f.weapon,
      );
      rig.position.set(
        0.205 + Math.sin(t * 6.5) * 0.009 * move,
        -0.205 + Math.cos(t * 13) * 0.006 * move - 0.13 * dip,
        short ? -0.43 : -0.36,
      );
      rig.rotation.set(
        0.065 + Math.min(0.22, k * 0.045) - dip * 0.63,
        -0.1,
        0.028 + dip * 0.51,
      );
      rig.scale.setScalar(1.12);
      this.viewFlash -= elapsed;
      this.muzzleLight.visible =
        this.viewFlash > 0 && rig.visible && !f.reducedMotion;
      this.muzzleLight.position.set(
        rig.position.x - 0.018,
        rig.position.y + 0.066,
        rig.position.z - (short ? 0.26 : 0.47),
      );
    }
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.hands, this.handsCam);
  }
  dispose() {
    releaseTree(this.scene);
    releaseTree(this.hands);
    (this.scene.background as THREE.Texture)?.dispose();
    this.sun.shadow.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.people.clear();
    this.arsenal.clear();
    this.scene.clear();
    this.hands.clear();
  }
}
