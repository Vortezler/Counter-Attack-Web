/**
 * Knife models. Every knife shares one frame: the handle runs along z through the origin
 * (roughly z = -0.05 at the guard to z = +0.06 at the pommel) and the blade points down -z,
 * flat in the y-z plane with its edge toward -y. Blades are lofted from a spine, an edge and a
 * thickness along a (possibly curved) centreline, with a flat grind and a brighter bevel.
 *
 * Meshes tagged `userData.blade` take the knife's finish; bevels stay bare polished steel.
 * A group in `userData.spin` (with `userData.spinAxis`) is what turns during an inspect flourish.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { KnifeModel } from "./cosmetics";

interface BladeSpec {
  length: number;
  /** Where the blade leaves the guard. */
  z0: number;
  /** Height of the spine above the centreline at t (0 = guard, 1 = tip). */
  spine: (t: number) => number;
  /** Depth of the edge below the centreline. */
  edge: (t: number) => number;
  /** Half-thickness at the spine. */
  thick: (t: number) => number;
  /** The centreline turns down by this angle (radians) by t: claws curve. */
  bend?: (t: number) => number;
  /** Fraction of the blade height (from the edge) where the flat grind meets the bevel. */
  grind?: number;
  /** Close the tip end (for square-nosed blades). */
  capTip?: boolean;
}
/** Builds the flats (finishable) and bevels (bare edge) as two geometries. */
function loft(spec: BladeSpec) {
  const N = 40,
    rows: number[][][] = [],
    grind = spec.grind ?? 0.52;
  let y = 0,
    z = spec.z0;
  const step = spec.length / N;
  for (let i = 0; i <= N; i++) {
    const t = i / N,
      a = spec.bend?.(t) ?? 0,
      uy = Math.cos(a),
      uz = -Math.sin(a),
      top = spec.spine(t),
      bottom = -spec.edge(t),
      h = top - bottom,
      g = bottom + h * grind,
      th = spec.thick(t) * Math.min(1, h / 0.012),
      e = 0.00018 * Math.min(1, h / 0.012);
    const at = (off: number, x: number) => [x, y + uy * off, z + uz * off];
    rows.push([at(top, th), at(g, th), at(bottom, e), at(bottom, -e), at(g, -th), at(top, -th)]);
    // March the centreline forward along its current direction.
    y += -Math.sin(a) * step;
    z += -Math.cos(a) * step;
  }
  const strip = (pairs: [number, number][], caps: boolean) => {
    const pos: number[] = [],
      index: number[] = [];
    for (const [a, b] of pairs) {
      const base = pos.length / 3;
      for (const row of rows) pos.push(...row[a], ...row[b]);
      for (let i = 0; i < N; i++) {
        const k = base + i * 2;
        index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    if (caps)
      for (const row of [rows[0], rows[N]]) {
        const base = pos.length / 3;
        for (const p of row) pos.push(...p);
        for (let k = 1; k < 5; k++) index.push(base, base + k, base + k + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  };
  return {
    flats: strip(
      [
        [0, 1],
        [4, 5],
        [5, 0],
      ],
      !!spec.capTip,
    ),
    bevels: strip(
      [
        [1, 2],
        [2, 3],
        [3, 4],
      ],
      false,
    ),
  };
}
const mat = (color: number | string, roughness: number, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
const steel = (color: number, roughness: number, metalness = 1) => mat(color, roughness, metalness);
function mesh(host: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  host.add(o);
  return o;
}
function blade(host: THREE.Object3D, spec: BladeSpec, flat = 0xaeb4b9, edge = 0xe4e8eb) {
  const { flats, bevels } = loft(spec);
  const f = mesh(host, flats, steel(flat, 0.32));
  f.userData.blade = true;
  mesh(host, bevels, steel(edge, 0.14));
  return f;
}
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.05, h / 2.05, d / 2.05));
/** A lathed grip along z between z0 and z1, radius from `radius(f)`, squashed to an oval. */
function grip(host: THREE.Object3D, z0: number, z1: number, radius: (f: number) => number, m: THREE.Material, oval = 0.76, y = -0.004) {
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const f = i / 24;
    profile.push(new THREE.Vector2(radius(f), z0 + f * (z1 - z0)));
  }
  const geo = new THREE.LatheGeometry(profile, 20);
  geo.rotateX(Math.PI / 2);
  geo.scale(oval, 1, 1);
  geo.translate(0, y, 0);
  return mesh(host, geo, m);
}
const ease = (a: number, b: number, t: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));

/** The original standard-issue fixed blade. */
function combat(g: THREE.Group) {
  blade(g, {
    length: 0.19,
    z0: -0.048,
    spine: (t) => {
      const s = t * 0.19,
        clip = Math.max(0, (s - 0.12) / 0.07);
      return 0.011 - 0.0095 * clip ** 0.9;
    },
    edge: (t) => {
      const s = t * 0.19,
        belly = Math.max(0, (s - 0.085) / 0.105);
      return 0.019 - 0.0205 * (1 - Math.sqrt(Math.max(0, 1 - belly * belly)));
    },
    thick: (t) => 0.0021 * (1 - 0.5 * t),
  });
  mesh(g, rbox(0.017, 0.044, 0.0075, 0.003), steel(0x3b4045, 0.4, 0.85), 0, -0.004, -0.051);
  grip(g, -0.048, 0.052, (f) => 0.0118 + 0.0016 * f + 0.0011 * Math.max(0, Math.sin(f * Math.PI * 4.5)) * (1 - f), mat(0x24282a, 0.82));
  for (const z of [-0.012, 0.012, 0.036]) {
    const band = mesh(g, new THREE.TorusGeometry(0.0128 + (z + 0.048) * 0.016, 0.0009, 4, 20), mat(0x15181a, 0.9), 0, -0.004, z);
    band.scale.set(0.79, 1.02, 1);
  }
  const pommel = mesh(g, new THREE.CylinderGeometry(0.0122, 0.0108, 0.011, 18), steel(0x3b4045, 0.4, 0.85), 0, -0.004, 0.0575);
  pommel.rotation.x = Math.PI / 2;
  pommel.scale.set(0.8, 1, 1);
  const loop = mesh(g, new THREE.TorusGeometry(0.0045, 0.0013, 6, 14), steel(0x3b4045, 0.4, 0.85), 0, -0.004, 0.066);
  loop.rotation.y = Math.PI / 2;
}
/** Chisel-pointed tanto with a black-oxide blade, oval guard and cord-wrapped grip. */
function tanto(g: THREE.Group) {
  blade(
    g,
    {
      length: 0.18,
      z0: -0.05,
      spine: (t) => 0.012 - 0.003 * ease(0.93, 1, t),
      edge: (t) => 0.017 - 0.026 * ease(0.74, 1, t),
      thick: (t) => 0.0024 * (1 - 0.35 * t),
      grind: 0.42,
    },
    0x2c3034,
    0xd5dade,
  );
  const guard = mesh(g, new THREE.CylinderGeometry(0.02, 0.02, 0.005, 24), steel(0x2a2c2e, 0.35, 0.9), 0, -0.003, -0.051);
  guard.rotation.x = Math.PI / 2;
  guard.scale.set(0.8, 1, 1);
  grip(g, -0.048, 0.056, () => 0.0118, mat(0x1d1f21, 0.6), 0.78);
  // Cord wrap: crossing diamonds of flat cord over the core.
  const cord = mat(0x3b3f45, 0.95);
  for (let i = 0; i < 8; i++) {
    const z = -0.04 + i * 0.0125;
    for (const s of [-1, 1]) {
      // Two tilted rings per turn cross over the top and bottom: the diamond pattern.
      const band = mesh(g, new THREE.TorusGeometry(0.0123, 0.0016, 4, 20), cord, 0, -0.004, z);
      band.rotation.x = s * 0.42;
      band.scale.set(0.79, 1, 1);
    }
  }
  const cap = mesh(g, new THREE.CylinderGeometry(0.0122, 0.011, 0.01, 18), steel(0x2a2c2e, 0.35, 0.9), 0, -0.004, 0.06);
  cap.rotation.x = Math.PI / 2;
  cap.scale.set(0.8, 1, 1);
}
/** Big clip-point bowie with a brass guard and a stacked-leather grip. */
function bowie(g: THREE.Group) {
  blade(g, {
    length: 0.235,
    z0: -0.05,
    spine: (t) => 0.013 - 0.015 * ease(0.62, 1, t) ** 1.3,
    edge: (t) => {
      const b = ease(0.55, 1, t);
      return 0.02 - 0.018 * (1 - Math.sqrt(Math.max(0, 1 - b * b)));
    },
    thick: (t) => 0.0026 * (1 - 0.45 * t),
    grind: 0.48,
  });
  // False edge along the clip.
  const brass = steel(0xb8913f, 0.3, 1);
  mesh(g, rbox(0.012, 0.058, 0.008, 0.003), brass, 0, -0.004, -0.052);
  for (const s of [-1, 1]) {
    const knob = mesh(g, new THREE.SphereGeometry(0.0055, 12, 8), brass, 0, -0.004 + s * 0.029, -0.052);
    knob.scale.set(1.1, 1, 1);
  }
  const leathers = [0x5a3a22, 0x6b4729, 0x4a2f1b];
  for (let i = 0; i < 14; i++) {
    const z = -0.046 + i * 0.0072,
      ring = mesh(g, new THREE.CylinderGeometry(0.0128, 0.0128, 0.0072, 16), mat(leathers[i % 3], 0.85), 0, -0.004, z);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(0.78, 1, 1);
  }
  mesh(g, rbox(0.022, 0.03, 0.006, 0.002), brass, 0, -0.004, -0.0475);
  const pommel = mesh(g, new THREE.SphereGeometry(0.0145, 16, 10), brass, 0, -0.004, 0.058);
  pommel.scale.set(0.8, 0.95, 0.75);
}
/** Broad square-nosed cleaver with a riveted slab grip. */
function cleaver(g: THREE.Group) {
  blade(g, {
    length: 0.165,
    z0: -0.045,
    spine: () => 0.009,
    edge: (t) => 0.058 + 0.006 * Math.sin(Math.PI * t),
    thick: () => 0.0028,
    grind: 0.28,
    capTip: true,
  });
  // Hanging hole near the nose.
  const hole = mesh(g, new THREE.CylinderGeometry(0.0065, 0.0065, 0.0062, 16), mat(0x0b0c0d, 0.9), 0, -0.002, -0.19);
  hole.rotation.z = Math.PI / 2;
  const wood = mat(0x4b2c1d, 0.7);
  for (const s of [-1, 1]) mesh(g, rbox(0.0075, 0.024, 0.105, 0.004), wood, s * 0.0055, -0.002, 0.006);
  mesh(g, rbox(0.004, 0.026, 0.11, 0.001), steel(0x9aa1a6, 0.35, 1), 0, -0.002, 0.006);
  for (const z of [-0.028, 0.006, 0.04])
    for (const s of [-1, 1]) {
      const rivet = mesh(g, new THREE.CylinderGeometry(0.0032, 0.0032, 0.002, 12), steel(0xc9cdd0, 0.25, 1), s * 0.0095, -0.002, z);
      rivet.rotation.z = Math.PI / 2;
    }
}
/** Hooked karambit: a claw blade curving down, a short grip and a finger ring at the end. */
function karambit(g: THREE.Group) {
  const spin = new THREE.Group(),
    pivot = new THREE.Vector3(0, -0.004, 0.068);
  spin.position.copy(pivot);
  g.add(spin);
  const inner = new THREE.Group();
  inner.position.copy(pivot).multiplyScalar(-1);
  spin.add(inner);
  blade(inner, {
    length: 0.115,
    z0: -0.038,
    spine: (t) => 0.0085 * (1 - t ** 1.25) + 0.0006,
    edge: (t) => 0.0135 * (1 - t) ** 0.85 - 0.0006,
    thick: (t) => 0.0024 * (1 - 0.5 * t),
    bend: (t) => 1.25 * t ** 1.6,
    grind: 0.45,
  });
  const scale = mat(0x23272b, 0.65);
  grip(inner, -0.036, 0.05, (f) => 0.0112 + 0.0012 * Math.sin(f * Math.PI * 3) * (1 - f), scale, 0.72);
  mesh(inner, rbox(0.016, 0.03, 0.006, 0.002), steel(0x3b4045, 0.35, 0.9), 0, -0.003, -0.038);
  const ring = mesh(inner, new THREE.TorusGeometry(0.0165, 0.0045, 10, 28), steel(0x3b4045, 0.35, 0.9), 0, -0.004, 0.068);
  ring.rotation.y = Math.PI / 2;
  g.userData.spin = spin;
  g.userData.spinAxis = new THREE.Vector3(1, 0, 0);
}
/** Butterfly knife: skeleton handle halves on pivot pins; the latch half and blade flip. */
function butterfly(g: THREE.Group) {
  const pivotZ = -0.046,
    spin = new THREE.Group();
  spin.position.set(0, -0.002, pivotZ);
  g.add(spin);
  const inner = new THREE.Group();
  inner.position.set(0, 0.002, -pivotZ);
  spin.add(inner);
  blade(inner, {
    length: 0.13,
    z0: -0.05,
    spine: (t) => 0.0095 - 0.011 * ease(0.66, 1, t) ** 1.2,
    edge: (t) => {
      const b = ease(0.5, 1, t);
      return 0.0125 - 0.014 * (1 - Math.sqrt(Math.max(0, 1 - b * b)));
    },
    thick: (t) => 0.0021 * (1 - 0.4 * t),
  });
  // Skeleton halves: a rounded bar with slots cut through, extruded flat.
  const half = () => {
    const shape = new THREE.Shape(),
      L = 0.112,
      H = 0.024,
      r = 0.007;
    shape.moveTo(r, -H / 2);
    shape.lineTo(L - r, -H / 2);
    shape.quadraticCurveTo(L, -H / 2, L, -H / 2 + r);
    shape.lineTo(L, H / 2 - r);
    shape.quadraticCurveTo(L, H / 2, L - r, H / 2);
    shape.lineTo(r, H / 2);
    shape.quadraticCurveTo(0, H / 2, 0, H / 2 - r);
    shape.lineTo(0, -H / 2 + r);
    shape.quadraticCurveTo(0, -H / 2, r, -H / 2);
    for (let i = 0; i < 4; i++) {
      const x0 = 0.018 + i * 0.022,
        hole = new THREE.Path();
      hole.absellipse(x0 + 0.008, 0, 0.0085, 0.0055, 0, Math.PI * 2, false, 0);
      shape.holes.push(hole);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.0055, bevelEnabled: true, bevelSize: 0.0008, bevelThickness: 0.0008, bevelSegments: 1, curveSegments: 10 });
    geo.rotateY(-Math.PI / 2);
    return geo;
  };
  const handle = steel(0x30343a, 0.4, 0.85);
  // The safe half stays in the hand; the latch half flips with the blade.
  mesh(g, half(), handle, -0.0022, -0.004, -0.05);
  const latchHalf = mesh(inner, half(), handle, 0.0077, -0.004, -0.05);
  void latchHalf;
  const latch = mesh(inner, rbox(0.012, 0.006, 0.014, 0.002), steel(0xb8bec2, 0.3, 1), 0.0025, -0.012, 0.059);
  void latch;
  for (const z of [pivotZ, 0.058]) {
    const pin = mesh(g, new THREE.CylinderGeometry(0.0028, 0.0028, 0.016, 12), steel(0xc9cdd0, 0.25, 1), 0.0028, -0.004, z);
    pin.rotation.z = Math.PI / 2;
  }
  g.userData.spin = spin;
  g.userData.spinAxis = new THREE.Vector3(1, 0, 0);
}
const builders: Record<KnifeModel, (g: THREE.Group) => void> = { combat, tanto, bowie, cleaver, karambit, butterfly };
/** A knife model in the shared knife frame. */
export function knifeModel(model: KnifeModel = "combat") {
  const g = new THREE.Group();
  (builders[model] ?? combat)(g);
  g.userData.knife = model;
  return g;
}
