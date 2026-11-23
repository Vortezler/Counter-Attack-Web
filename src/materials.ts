/**
 * Procedural surface materials for the maps: tileable albedo, normal and roughness maps for
 * plaster, sandstone, masonry, board-formed concrete, planks, corrugated metal, tiles, cobbles
 * and more. Everything is generated from shared tileable noise fields, once per session.
 *
 * Albedo stays near-neutral and light: the world builder multiplies it by per-vertex tints
 * (theme colour, weathering, ground grime), so a surface's hue comes from the map theme and
 * its character comes from here.
 */
import * as THREE from "three";

const N = 512,
  MASK = N - 1;

export interface Surface {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  /** World metres covered by one repeat of the texture. */
  scale: number;
  normalScale: number;
  metalness: number;
}

function hash(x: number, y: number, s: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (v: number) => v & MASK;

/** Tileable fractal value noise with separate lattice periods per axis, normalised to 0..1. */
function field(px: number, py: number, octaves: number, seed: number) {
  const out = new Float32Array(N * N),
    xa = new Int32Array(N),
    xb = new Int32Array(N),
    sx = new Float32Array(N);
  let amp = 1,
    total = 0;
  for (let o = 0; o < octaves; o++) {
    const fx = px << o,
      fy = py << o,
      lattice = new Float32Array(fx * fy);
    for (let j = 0; j < fy; j++)
      for (let i = 0; i < fx; i++) lattice[j * fx + i] = hash(i, j, seed + o);
    for (let x = 0; x < N; x++) {
      const gx = (x / N) * fx,
        x0 = Math.floor(gx),
        t = gx - x0;
      xa[x] = x0 % fx;
      xb[x] = (x0 + 1) % fx;
      sx[x] = t * t * (3 - 2 * t);
    }
    total += amp;
    for (let y = 0; y < N; y++) {
      const gy = (y / N) * fy,
        y0 = Math.floor(gy),
        ty = gy - y0,
        sy = ty * ty * (3 - 2 * ty),
        ra = (y0 % fy) * fx,
        rb = ((y0 + 1) % fy) * fx,
        row = y * N;
      for (let x = 0; x < N; x++) {
        const a = lattice[ra + xa[x]],
          b = lattice[ra + xb[x]],
          c = lattice[rb + xa[x]],
          d = lattice[rb + xb[x]],
          s = sx[x],
          top = a + (b - a) * s,
          bottom = c + (d - c) * s;
        out[row + x] += amp * (top + (bottom - top) * sy);
      }
    }
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++)
    out[i] = Math.min(1, Math.max(0, (out[i] / total - 0.5) * 1.9 + 0.5));
  return out;
}

let shared: Record<"low" | "mid" | "high" | "streak" | "rows", Float32Array> | null = null;
function fields() {
  return (shared ??= {
    low: field(4, 4, 5, 11),
    mid: field(16, 16, 4, 23),
    high: field(64, 64, 3, 37),
    /** Varies across x quickly and down y slowly: drips, grain and streaks. */
    streak: field(32, 2, 4, 53),
    rows: field(2, 32, 3, 71),
  });
}
const at = (f: Float32Array, x: number, y: number) => f[wrap(y) * N + wrap(x)];

/** Tileable Worley noise: nearest and second-nearest feature distances in cell units, plus the cell id. */
function worley(cells: number, seed: number) {
  const size = N / cells,
    f1 = new Float32Array(N * N),
    f2 = new Float32Array(N * N),
    id = new Float32Array(N * N),
    fxs = new Float32Array(cells * cells),
    fys = new Float32Array(cells * cells),
    ids = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      fxs[j * cells + i] = 0.15 + 0.7 * hash(i, j, seed);
      fys[j * cells + i] = 0.15 + 0.7 * hash(j, i, seed + 1);
      ids[j * cells + i] = hash(i, j, seed + 2);
    }
  for (let y = 0; y < N; y++) {
    const cy = Math.floor(y / size),
      ly = y / size;
    for (let x = 0; x < N; x++) {
      const cx = Math.floor(x / size),
        lx = x / size;
      let a = 9,
        b = 9,
        best = 0;
      for (let j = -1; j <= 1; j++) {
        const gy = cy + j,
          wy = (gy + cells) % cells;
        for (let i = -1; i <= 1; i++) {
          const gx = cx + i,
            c = wy * cells + ((gx + cells) % cells),
            dx = gx + fxs[c] - lx,
            dy = gy + fys[c] - ly,
            d = Math.sqrt(dx * dx + dy * dy);
          if (d < a) {
            b = a;
            a = d;
            best = ids[c];
          } else if (d < b) b = d;
        }
      }
      const k = y * N + x;
      f1[k] = a;
      f2[k] = b;
      id[k] = best;
    }
  }
  return { f1, f2, id };
}

/** Running-bond blocks: distance to the nearest joint in pixels and a per-block random id. */
function blocks(x: number, y: number, rows: number, cols: (row: number) => number, seed: number) {
  const rowH = N / rows,
    row = Math.floor(y / rowH),
    n = cols(row),
    colW = N / n,
    shift = hash(row, 0, seed) * colW,
    xs = (x + shift) % N,
    col = Math.floor(xs / colW),
    fx = xs - col * colW,
    fy = y - row * rowH;
  return {
    edge: Math.min(fx, colW - fx, fy, rowH - fy),
    id: hash(col, row, seed + 5),
    fy: fy / rowH,
  };
}

interface Px {
  r: number;
  g: number;
  b: number;
  h: number;
  rough: number;
  /** How much the map theme's tint applies here: 0 keeps the texel's own colour (rust, brick, steel). */
  tint: number;
}
type Painter = (x: number, y: number, o: Px) => void;

/** A thin wandering crack line where a noise field crosses 0.5, kept to patches. */
function crack(x: number, y: number, ox: number, density: number) {
  const f = fields(),
    line = 1 - smooth(0, 0.012, Math.abs(at(f.mid, x + ox, y + 31) - 0.5));
  return line * smooth(density, density + 0.08, at(f.low, x + ox * 3, y + 77));
}

const painters: Record<string, () => Painter> = {
  plaster() {
    const f = fields();
    return (x, y, o) => {
      const m = at(f.low, x, y),
        chip = smooth(0.6, 0.66, at(f.low, x + 311, y + 57) * 0.75 + at(f.mid, x, y) * 0.25),
        rim = smooth(0.54, 0.6, at(f.low, x + 311, y + 57) * 0.75 + at(f.mid, x, y) * 0.25) - chip,
        drip = smooth(0.5, 0.85, at(f.streak, x + 37, y)) * at(f.low, x + 200, y + 90),
        trowel = at(f.rows, x + 90, y) * 0.5 + at(f.mid, x + 5, y + 9) * 0.5;
      let lum = 0.84 + 0.13 * m + 0.05 * (at(f.high, x, y) - 0.5) - 0.13 * drip - 0.08 * rim;
      let h = 0.78 + 0.08 * trowel + 0.04 * at(f.high, x, y) + 0.05 * rim;
      let r = 1,
        g = 0.985,
        b = 0.95;
      if (chip > 0) {
        // Exposed brick under the render where it has flaked away.
        const k = blocks(x, y, 40, () => 18, 9),
          mortar = k.edge < 1.6;
        const br = mortar ? 0.78 : 0.62 + 0.2 * k.id,
          bh = mortar ? 0.22 : 0.42 + 0.05 * at(f.high, x, y);
        r = mix(r, mortar ? 0.92 : 1.0, chip);
        g = mix(g, mortar ? 0.88 : 0.66, chip);
        b = mix(b, mortar ? 0.8 : 0.5, chip);
        lum = mix(lum, br, chip);
        h = mix(h, bh, chip);
      }
      const c = crack(x, y, 140, 0.6);
      lum *= 1 - 0.35 * c;
      h -= 0.12 * c;
      o.tint = 1 - chip;
      o.r = r * lum;
      o.g = g * lum;
      o.b = b * lum;
      o.h = h;
      o.rough = 0.88 + 0.08 * chip;
    };
  },
  sand() {
    // Sandstone block walls with eroded edges, sediment banding and pitting.
    const f = fields();
    return (x, y, o) => {
      const k = blocks(x, y, 6, (row) => 3 + (row % 2), 3),
        wobble = 2.5 + 2.5 * at(f.mid, x, y),
        mortar = k.edge < wobble,
        bevel = smooth(wobble, wobble + 5 + 6 * at(f.mid, x + 9, y), k.edge),
        band = Math.sin((y + at(f.low, x, y) * 40) * 0.32) * 0.025,
        pit = smooth(0.88, 0.96, at(f.high, x + 17, y + 3)) * smooth(0.45, 0.75, at(f.mid, x + 90, y + 4));
      let lum = 0.84 + 0.14 * k.id + band + 0.06 * (at(f.high, x, y) - 0.5) - 0.06 * pit;
      lum -= 0.1 * smooth(0.55, 0.9, at(f.streak, x + 60, y)) * at(f.low, x + 3, y);
      if (mortar) lum = 0.74 + 0.08 * at(f.high, x, y);
      o.r = lum;
      o.g = lum * (0.965 - 0.03 * k.id);
      o.b = lum * (0.89 - 0.05 * k.id);
      o.h = mortar ? 0.18 : 0.45 + 0.3 * bevel + 0.1 * at(f.mid, x, y) + 0.04 * at(f.high, x, y) - 0.06 * pit;
      o.rough = 0.95;
    };
  },
  stone() {
    // Rough-cut masonry: smaller irregular blocks, deep mortar, mixed grey and beige stones.
    const f = fields();
    return (x, y, o) => {
      const k = blocks(x, y, 10, (row) => 4 + ((row * 7) % 3), 17),
        mortar = k.edge < 3 + 2 * at(f.mid, x, y),
        bevel = smooth(3, 16, k.edge),
        face = at(f.mid, x + 70, y) * 0.6 + at(f.high, x, y) * 0.4,
        warm = hash(Math.floor(k.id * 1000), 3, 9);
      let lum = 0.72 + 0.2 * k.id + 0.12 * (face - 0.5);
      lum -= 0.12 * smooth(0.6, 0.9, at(f.streak, x + 11, y)) * at(f.low, x, y + 40);
      if (mortar) lum = 0.62 + 0.08 * at(f.high, x, y);
      o.r = lum * (mortar ? 0.97 : mix(0.94, 1.02, warm));
      o.g = lum * (mortar ? 0.94 : mix(0.94, 0.96, warm));
      o.b = lum * (mortar ? 0.86 : mix(0.95, 0.86, warm));
      o.h = mortar ? 0.08 : 0.3 + 0.45 * bevel + 0.22 * face;
      o.rough = 0.93;
    };
  },
  concrete() {
    // Board-formed panels: seams, form-tie holes, aggregate, pores and run-off stains.
    const f = fields();
    const pw = N / 4,
      ph = N / 2;
    return (x, y, o) => {
      const px = x % pw,
        py = y % ph,
        panel = hash(Math.floor(x / pw), Math.floor(y / ph), 4),
        seam = Math.min(px, pw - px, py, ph - py) < 1.6;
      let tie = 9;
      for (const tx of [0.25, 0.75])
        for (const ty of [0.2, 0.5, 0.8])
          tie = Math.min(tie, Math.hypot(px - tx * pw, py - ty * ph));
      const hole = tie < 4.2,
        ring = smooth(9, 4.2, tie) * (hole ? 0 : 1),
        pore = smooth(0.9, 0.97, at(f.high, x + 101, y + 7)) * smooth(0.4, 0.7, at(f.mid, x + 13, y + 61)),
        agg = at(f.high, x + 3, y + 300),
        run = smooth(0.5, 0.85, at(f.streak, x + 23, y)) * (1 - py / ph) * 0.8 + 0.2 * smooth(0.6, 0.9, at(f.streak, x + 23, y));
      let lum = 0.72 + 0.16 * at(f.low, x, y) + 0.06 * (panel - 0.5) + 0.07 * (agg - 0.5);
      lum -= 0.16 * run + 0.16 * pore + 0.05 * ring + 0.06 * smooth(0.55, 0.85, at(f.mid, x + 70, y + 20));
      if (seam) lum *= 0.8;
      if (hole) {
        lum = 0.3;
        o.tint = 0.2;
      }
      const c = crack(x, y, 260, 0.62);
      lum *= 1 - 0.3 * c;
      o.r = lum * 0.99;
      o.g = lum;
      o.b = lum * 1.015;
      o.h = hole ? 0.05 : seam ? 0.35 : 0.72 + 0.06 * at(f.mid, x, y) + 0.04 * agg - 0.12 * pore - 0.08 * ring - 0.1 * c;
      o.rough = 0.9 - 0.06 * run;
    };
  },
  wood() {
    // Vertical planks with grain, knots, dark gaps and nail heads.
    const f = fields();
    const pw = N / 6;
    return (x, y, o) => {
      const plank = Math.floor(x / pw),
        px = x - plank * pw,
        seed = hash(plank, 1, 77),
        gap = Math.min(px, pw - px) < 2,
        gx = x + Math.floor(seed * 300),
        grain = at(f.streak, gx, y + plank * 50),
        rings = 0.5 + 0.5 * Math.sin((grain * 9 + px * 0.06) * Math.PI * 2),
        kx = pw * (0.3 + 0.4 * seed),
        ky = N * hash(plank, 2, 77),
        kd = Math.hypot(px - kx, (wrap(y - ky + N / 2) - N / 2) * 0.35),
        knot = smooth(9, 2, kd),
        knotRing = 0.5 + 0.5 * Math.sin(kd * 1.6),
        nail = Math.min(Math.hypot(px - pw / 2, y - 22), Math.hypot(px - pw / 2, y - N + 22)) < 2.4;
      let lum = 0.78 + 0.14 * seed + 0.1 * (rings - 0.5) - 0.06 * at(f.high, x, y);
      lum = mix(lum, 0.45 + 0.2 * knotRing, knot * 0.8);
      lum -= 0.1 * smooth(0.55, 0.9, at(f.low, x + 5, y + 77));
      if (gap) lum = 0.22;
      o.r = nail ? 0.45 : lum;
      o.g = nail ? 0.45 : lum * 0.9;
      o.b = nail ? 0.47 : lum * 0.78;
      o.h = gap ? 0.05 : nail ? 0.95 : 0.7 + 0.06 * rings - 0.08 * knot + 0.04 * at(f.mid, x, y);
      o.rough = nail ? 0.45 : 0.82 - 0.06 * rings;
      if (nail) o.tint = 0;
    };
  },
  metal() {
    // Corrugated painted steel with rust blooms, run-off streaks and chipped paint.
    const f = fields();
    return (x, y, o) => {
      const ridge = 0.5 + 0.5 * Math.cos((x / N) * Math.PI * 2 * 16),
        rustField = at(f.low, x + 50, y + 80) * 0.65 + at(f.mid, x, y + 9) * 0.35,
        streak = smooth(0.62, 0.85, at(f.streak, x + 10, y)) * at(f.low, x + 9, y + 130),
        rust = Math.max(smooth(0.7, 0.8, rustField), 0.55 * streak) * (0.55 + 0.45 * at(f.mid, x + 33, y + 71)),
        chip = smooth(0.9, 0.95, at(f.high, x + 40, y + 2)) * (1 - rust);
      const paint = 0.9 + 0.06 * at(f.low, x, y) - 0.04 * (1 - ridge),
        rl = 0.75 + 0.2 * at(f.high, x, y);
      o.r = mix(mix(paint, 0.7, chip), 0.78 * rl, rust);
      o.g = mix(mix(paint, 0.7, chip), 0.47 * rl, rust);
      o.b = mix(mix(paint * 1.01, 0.72, chip), 0.3 * rl, rust);
      o.h = 0.2 + 0.6 * ridge + 0.05 * rust * at(f.high, x, y) - 0.04 * chip;
      o.rough = mix(mix(0.5, 0.35, chip), 0.92, rust);
      o.tint = 1 - Math.max(rust, chip);
    };
  },
  freight() {
    // Painted sheet steel on rolling stock: faded paint, grime, rust run-off and dark primer chips.
    const f = fields();
    return (x, y, o) => {
      const fade = at(f.low, x, y),
        grime = smooth(0.45, 0.9, at(f.streak, x + 70, y)) * 0.6,
        rustField = at(f.low, x + 50, y + 80) * 0.6 + at(f.mid, x, y + 9) * 0.4,
        streak = smooth(0.66, 0.88, at(f.streak, x + 10, y)) * at(f.low, x + 9, y + 130),
        rust = Math.max(smooth(0.74, 0.84, rustField), 0.6 * streak) * (0.5 + 0.5 * at(f.mid, x + 33, y + 71)),
        chip = smooth(0.93, 0.97, at(f.high, x + 40, y + 2)) * (1 - rust);
      const paint = (0.84 + 0.12 * fade) * (1 - 0.16 * grime);
      o.r = mix(mix(paint, 0.28, chip), 0.62, rust);
      o.g = mix(mix(paint, 0.27, chip), 0.36, rust);
      o.b = mix(mix(paint, 0.26, chip), 0.22, rust);
      o.h = 0.5 + 0.08 * at(f.mid, x, y) - 0.05 * chip + 0.06 * rust;
      o.rough = mix(0.62, 0.9, Math.max(rust, chip));
      o.tint = 1 - Math.max(rust, chip);
    };
  },
  tile() {
    // Glazed wall tiles.
    const f = fields();
    const t = N / 10;
    return (x, y, o) => {
      const tx = Math.floor(x / t),
        ty = Math.floor(y / t),
        px = x - tx * t,
        py = y - ty * t,
        id = hash(tx, ty, 31),
        grout = Math.min(px, t - px, py, t - py) < 2,
        bevel = smooth(2, 6, Math.min(px, t - px, py, t - py));
      const lum = grout ? 0.7 : 0.86 + 0.12 * id + 0.04 * (at(f.mid, x, y) - 0.5);
      o.r = lum;
      o.g = lum * 0.99;
      o.b = lum * 0.97;
      o.h = grout ? 0.2 : 0.55 + 0.35 * bevel;
      if (grout) o.tint = 0.3;
      o.rough = grout ? 0.95 : 0.28 + 0.15 * at(f.low, x, y);
    };
  },
  glass() {
    const f = fields();
    return (x, y, o) => {
      const dirt = smooth(0.45, 0.85, at(f.streak, x, y)) * 0.6 + 0.4 * at(f.low, x, y);
      const lum = 0.62 + 0.12 * dirt;
      o.r = lum * 0.95;
      o.g = lum;
      o.b = lum;
      o.h = 0.5;
      o.rough = 0.08 + 0.5 * dirt * dirt;
    };
  },
  cardboard() {
    const f = fields();
    return (x, y, o) => {
      const flute = 0.5 + 0.5 * Math.sin(y * 0.9),
        tape = Math.abs(x - N / 2) < 34,
        lum = 0.88 + 0.08 * at(f.low, x, y) - 0.05 * at(f.high, x, y);
      o.r = tape ? 0.95 : lum;
      o.g = tape ? 0.9 : lum * 0.95;
      o.b = tape ? 0.78 : lum * 0.86;
      o.h = tape ? 0.6 : 0.45 + 0.05 * flute;
      o.rough = tape ? 0.45 : 0.95;
      if (tape) o.tint = 0;
    };
  },
  dirt() {
    const f = fields(),
      w = worley(40, 5);
    return (x, y, o) => {
      const k = y * N + x,
        pebble = smooth(0.42, 0.3, w.f1[k]) * smooth(0.55, 0.7, w.id[k]);
      const lum = 0.74 + 0.16 * at(f.low, x, y) + 0.08 * (at(f.high, x, y) - 0.5);
      o.r = mix(lum, 0.8 + 0.15 * w.id[k], pebble);
      o.g = mix(lum * 0.94, 0.78 + 0.12 * w.id[k], pebble);
      o.b = mix(lum * 0.86, 0.72 + 0.1 * w.id[k], pebble);
      o.h = 0.4 + 0.15 * at(f.mid, x, y) + 0.4 * pebble;
      o.rough = 0.97;
    };
  },
  foliage() {
    const f = fields(),
      w = worley(24, 8);
    return (x, y, o) => {
      const k = y * N + x,
        leaf = smooth(0.0, 0.25, w.f2[k] - w.f1[k]);
      const lum = 0.7 + 0.25 * w.id[k] * leaf + 0.08 * at(f.mid, x, y);
      o.r = lum * 0.95;
      o.g = lum;
      o.b = lum * 0.9;
      o.h = 0.3 + 0.5 * leaf;
      o.rough = 0.8;
    };
  },
  /** Fine weathering for trims, frames and small fixtures. */
  grain() {
    const f = fields();
    return (x, y, o) => {
      const lum = 0.9 + 0.08 * at(f.mid, x, y) + 0.04 * (at(f.high, x, y) - 0.5) - 0.06 * smooth(0.6, 0.9, at(f.streak, x, y));
      o.r = lum;
      o.g = lum;
      o.b = lum * 0.98;
      o.h = 0.5 + 0.1 * at(f.high, x, y) + 0.05 * at(f.mid, x, y);
      o.rough = 0.85;
    };
  },
  "sand-floor"() {
    // Packed sand with wind ripples, scattered pebbles and darker trodden patches.
    const f = fields(),
      w = worley(48, 12);
    return (x, y, o) => {
      const k = y * N + x,
        pebble = smooth(0.2 + 0.14 * w.id[k], 0.1, w.f1[k]) * smooth(0.82, 0.86, w.id[k] * 0.7 + at(f.low, x + 40, y) * 0.3),
        ripple = 0.5 + 0.5 * Math.sin((x * 0.09 + at(f.low, x, y) * 28) + at(f.mid, x, y) * 3),
        trod = smooth(0.55, 0.85, at(f.low, x + 260, y + 130));
      const grit = smooth(0.78, 0.9, at(f.high, x + 211, y + 5)),
        lum =
          0.8 + 0.18 * at(f.low, x, y) + 0.1 * (at(f.high, x, y) - 0.5) + 0.05 * (ripple - 0.5) -
          0.1 * trod - 0.12 * grit;
      o.r = mix(lum, 0.72 + 0.2 * w.id[k], pebble);
      o.g = mix(lum * 0.965, 0.68 + 0.18 * w.id[k], pebble);
      o.b = mix(lum * 0.9, 0.6 + 0.15 * w.id[k], pebble);
      o.h = 0.4 + 0.12 * ripple * (1 - trod) + 0.1 * at(f.high, x, y) + 0.06 * grit + 0.35 * pebble;
      o.rough = 0.97 - 0.05 * trod;
      o.tint = 1 - 0.6 * pebble;
    };
  },
  "tile-floor"() {
    // Large stone pavers: worn centres, grout lines, corner chips.
    const f = fields();
    const t = N / 6;
    return (x, y, o) => {
      const tx = Math.floor(x / t),
        ty = Math.floor(y / t),
        px = x - tx * t,
        py = y - ty * t,
        id = hash(tx, ty, 61),
        edge = Math.min(px, t - px, py, t - py),
        grout = edge < 2.5 + 1.5 * at(f.mid, x, y),
        chip = smooth(0.82, 0.9, at(f.high, x + 9, y)) * smooth(14, 4, edge);
      let lum = grout ? 0.62 : 0.8 + 0.16 * id + 0.06 * (at(f.mid, x + 30, y) - 0.5);
      lum -= 0.12 * chip + 0.06 * smooth(0.6, 0.9, at(f.low, x, y + 40));
      const c = crack(x, y, 90, 0.66);
      lum *= 1 - 0.3 * c;
      o.r = lum;
      o.g = lum * (0.97 - 0.02 * id);
      o.b = lum * (0.92 - 0.04 * id);
      o.h = grout ? 0.15 : 0.55 + 0.25 * smooth(2, 10, edge) - 0.25 * chip - 0.08 * c;
      o.rough = grout ? 0.95 : 0.7 - 0.12 * smooth(10, t / 2, edge);
      if (grout) o.tint = 0.4;
    };
  },
  "concrete-floor"() {
    // Poured slabs: saw-cut joints, oil stains, aggregate and hairline cracks.
    const f = fields();
    const s = N / 2;
    return (x, y, o) => {
      const px = x % s,
        py = y % s,
        joint = Math.min(px, s - px, py, s - py) < 1.8,
        slab = hash(Math.floor(x / s), Math.floor(y / s), 8),
        oil = smooth(0.66, 0.8, at(f.low, x + 77, y + 211) * 0.7 + at(f.mid, x, y) * 0.3),
        agg = at(f.high, x, y),
        c = crack(x, y, 330, 0.58);
      let lum = 0.76 + 0.1 * at(f.low, x, y) + 0.05 * (slab - 0.5) + 0.07 * (agg - 0.5);
      lum -= 0.22 * oil + 0.06 * smooth(0.9, 0.97, at(f.high, x + 41, y + 9)) + 0.06 * smooth(0.5, 0.85, at(f.mid, x + 300, y + 17));
      lum *= 1 - 0.3 * c;
      if (joint) lum *= 0.62;
      o.r = lum;
      o.g = lum;
      o.b = lum * 1.01;
      o.h = joint ? 0.2 : 0.65 + 0.05 * at(f.mid, x, y) + 0.04 * agg - 0.1 * c;
      o.rough = 0.88 - 0.35 * oil;
      o.tint = 1 - 0.5 * oil;
    };
  },
  "stone-floor"() {
    // Cobbles: rounded stones bedded in sandy joints, tops polished by traffic.
    const f = fields(),
      w = worley(14, 21);
    return (x, y, o) => {
      const k = y * N + x,
        ridge = w.f2[k] - w.f1[k],
        joint = ridge < 0.07 + 0.04 * at(f.mid, x, y),
        dome = smooth(0.05, 0.4, ridge),
        id = w.id[k],
        warm = hash(Math.floor(id * 997), 1, 2);
      let lum = joint ? 0.6 + 0.08 * at(f.high, x, y) : 0.68 + 0.24 * id + 0.07 * (at(f.high, x, y) - 0.5);
      lum += joint ? 0 : 0.05 * dome;
      o.r = lum * (joint ? 1 : mix(0.95, 1.03, warm));
      o.g = lum * (joint ? 0.95 : mix(0.95, 0.96, warm));
      o.b = lum * (joint ? 0.84 : mix(0.95, 0.86, warm));
      o.h = joint ? 0.1 : 0.3 + 0.6 * dome + 0.05 * at(f.mid, x, y);
      o.rough = joint ? 0.97 : 0.78 - 0.18 * dome;
    };
  },
};

const settings: Record<string, { scale: number; normal: number; metal?: number }> = {
  plaster: { scale: 3.2, normal: 1.1 },
  sand: { scale: 3, normal: 1.15 },
  stone: { scale: 2.6, normal: 1.8 },
  concrete: { scale: 4, normal: 1.2 },
  wood: { scale: 1.6, normal: 1.2 },
  metal: { scale: 3.6, normal: 1.5, metal: 0.45 },
  freight: { scale: 3.2, normal: 0.8, metal: 0.25 },
  tile: { scale: 1.6, normal: 0.9 },
  glass: { scale: 2, normal: 0.3, metal: 0.2 },
  cardboard: { scale: 1.2, normal: 0.8 },
  dirt: { scale: 3, normal: 1.3 },
  foliage: { scale: 1.5, normal: 1 },
  grain: { scale: 1.4, normal: 0.6 },
  "sand-floor": { scale: 4, normal: 2 },
  "tile-floor": { scale: 3, normal: 1.1 },
  "concrete-floor": { scale: 6, normal: 1 },
  "stone-floor": { scale: 2.6, normal: 1.7 },
};

function dataTexture(data: Uint8Array, srgb: boolean) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true;
  t.needsUpdate = true;
  return t;
}

const cache = new Map<string, Surface>();
/** The generated surface for a material key, built on first use and shared by every renderer. */
export function surface(kind: string): Surface {
  const hit = cache.get(kind);
  if (hit) return hit;
  const paint = (painters[kind] ?? painters.grain)(),
    cfg = settings[kind] ?? settings.grain,
    albedo = new Uint8Array(N * N * 4),
    rough = new Uint8Array(N * N * 4),
    normal = new Uint8Array(N * N * 4),
    height = new Float32Array(N * N),
    px: Px = { r: 0, g: 0, b: 0, h: 0, rough: 0, tint: 1 };
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      px.tint = 1;
      paint(x, y, px);
      const k = y * N + x,
        i = k * 4;
      albedo[i] = Math.min(255, Math.max(0, px.r * 255));
      albedo[i + 1] = Math.min(255, Math.max(0, px.g * 255));
      albedo[i + 2] = Math.min(255, Math.max(0, px.b * 255));
      albedo[i + 3] = Math.min(255, Math.max(0, px.tint * 255));
      const r = Math.min(255, Math.max(0, px.rough * 255));
      rough[i] = rough[i + 1] = rough[i + 2] = r;
      rough[i + 3] = 255;
      height[k] = px.h;
    }
  // Normals from the height field (central differences, wrapping so the tile stays seamless).
  const strength = 6;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const du = height[y * N + wrap(x + 1)] - height[y * N + wrap(x - 1)],
        dv = height[wrap(y + 1) * N + x] - height[wrap(y - 1) * N + x];
      let nx = -du * strength,
        ny = -dv * strength,
        nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * N + x) * 4;
      normal[i] = (nx * 0.5 + 0.5) * 255;
      normal[i + 1] = (ny * 0.5 + 0.5) * 255;
      normal[i + 2] = (nz * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  const s: Surface = {
    map: dataTexture(albedo, true),
    normalMap: dataTexture(normal, false),
    roughnessMap: dataTexture(rough, false),
    scale: cfg.scale,
    normalScale: cfg.normal,
    metalness: cfg.metal ?? 0,
  };
  cache.set(kind, s);
  return s;
}
