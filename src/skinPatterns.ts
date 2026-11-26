/**
 * Paints finish patterns onto canvases with Canvas 2D only, so the lobby can draw swatches
 * without Three.js. Every pattern tiles seamlessly: shapes that cross an edge are drawn again
 * on the far side, and per-pixel patterns use noise with a period equal to the tile.
 *
 * `color` holds the finish colour, alpha = how much of it covers the weapon. `aux` holds masks:
 * red = glow, green = wear (where paint has worn through to metal).
 */
import type { Finish } from "./cosmetics";

export interface PatternCanvases {
  color: HTMLCanvasElement;
  aux: HTMLCanvasElement;
}

function rng(seed: number) {
  let n = seed >>> 0 || 1;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** Value noise with a lattice of `period` cells across the tile, so it wraps at the edges. */
function periodicNoise(period: number, seed: number) {
  const r = rng(seed),
    grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (x: number, y: number) => grid[((y % period) + period) % period * period + ((x % period) + period) % period];
  return (u: number, v: number) => {
    const x = u * period,
      y = v * period,
      x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = x - x0,
      fy = y - y0,
      sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0),
      b = at(x0 + 1, y0),
      c = at(x0, y0 + 1),
      d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
/** Fractal noise built from periodic octaves (each doubles the lattice, so all still wrap). */
function fbm(base: number, octaves: number, seed: number) {
  const layers = Array.from({ length: octaves }, (_, i) => periodicNoise(base << i, seed + i * 101));
  return (u: number, v: number) => {
    let sum = 0,
      amp = 0.5,
      norm = 0;
    for (const n of layers) {
      sum += n(u, v) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}
const hex = (c: string): [number, number, number] => {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}
/** Draws `draw` nine times, offset by a tile in each direction, so shapes wrap. */
function wrapped(size: number, draw: (dx: number, dy: number) => void) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) draw(dx, dy);
}
/** Fills every pixel from `shade(u, v)` → [r, g, b, a] (0..255). */
function perPixel(c: HTMLCanvasElement, shade: (u: number, v: number, out: number[]) => void) {
  const g = c.getContext("2d")!,
    n = c.width,
    img = g.createImageData(n, n),
    d = img.data,
    out = [0, 0, 0, 255];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      out[3] = 255;
      shade(x / n, y / n, out);
      const i = (y * n + x) * 4;
      d[i] = out[0];
      d[i + 1] = out[1];
      d[i + 2] = out[2];
      d[i + 3] = out[3];
    }
  g.putImageData(img, 0, 0);
}
function mixColors(cols: [number, number, number][], t: number, out: number[]) {
  const x = Math.min(0.9999, Math.max(0, t)) * (cols.length - 1),
    i = Math.floor(x),
    f = x - i,
    a = cols[i],
    b = cols[Math.min(cols.length - 1, i + 1)];
  out[0] = lerp(a[0], b[0], f);
  out[1] = lerp(a[1], b[1], f);
  out[2] = lerp(a[2], b[2], f);
}

type Painter = (g: CanvasRenderingContext2D, s: number, f: Finish, r: () => number, glow: CanvasRenderingContext2D) => void;
const painters: Partial<Record<Finish["pattern"], Painter>> = {
  hex(g, s, f) {
    const cols = 16,
      rows = 18,
      w = s / cols,
      h = s / rows,
      rad = w / Math.sqrt(3),
      noise = fbm(3, 3, 17);
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0),
          cy = row * h,
          v = noise(cx / s, cy / s),
          idx = v < 0.38 ? 3 : v < 0.5 ? 1 : v < 0.62 ? 0 : 2;
        g.fillStyle = f.colors[idx % f.colors.length];
        wrapped(s, (dx, dy) => {
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 6 + (k * Math.PI) / 3;
            g.lineTo(cx + dx + Math.cos(a) * rad * 1.01, cy + dy + Math.sin(a) * rad * 1.08);
          }
          g.fill();
        });
      }
    // Fine seams between cells.
    g.strokeStyle = "rgba(0,0,0,.18)";
    g.lineWidth = s / 512;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0),
          cy = row * h;
        wrapped(s, (dx, dy) => {
          g.beginPath();
          for (let k = 0; k <= 6; k++) {
            const a = Math.PI / 6 + (k * Math.PI) / 3;
            g.lineTo(cx + dx + Math.cos(a) * rad, cy + dy + Math.sin(a) * rad * 1.07);
          }
          g.stroke();
        });
      }
  },
  digital(g, s, f, r) {
    const n = 32,
      cell = s / n,
      big = fbm(4, 2, 5),
      small = fbm(8, 2, 9);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = big(x / n, y / n) * 0.75 + small(x / n, y / n) * 0.25 + (r() - 0.5) * 0.06,
          idx = v < 0.4 ? 3 : v < 0.5 ? 1 : v < 0.6 ? 0 : 2;
        g.fillStyle = f.colors[idx];
        g.fillRect(x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
      }
  },
  splinter(g, s, f, r) {
    g.fillStyle = f.colors[0];
    g.fillRect(0, 0, s, s);
    for (let layer = 1; layer < f.colors.length; layer++) {
      g.fillStyle = f.colors[layer];
      for (let i = 0; i < 13 - layer * 2; i++) {
        const cx = r() * s,
          cy = r() * s,
          len = s * (0.18 + r() * 0.3),
          wid = s * (0.04 + r() * 0.08),
          a = -0.5 + r() * 0.35,
          pts: [number, number][] = [
            [-len / 2, 0],
            [-len * 0.1, -wid * (0.6 + r() * 0.6)],
            [len / 2, -wid * 0.2],
            [len * 0.2, wid * (0.5 + r() * 0.7)],
          ];
        wrapped(s, (dx, dy) => {
          g.beginPath();
          for (const [px, py] of pts)
            g.lineTo(cx + dx + px * Math.cos(a) - py * Math.sin(a), cy + dy + px * Math.sin(a) + py * Math.cos(a));
          g.fill();
        });
      }
    }
  },
  tiger(g, s, f, r) {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, f.colors[0]);
    grad.addColorStop(0.5, f.colors[2]);
    grad.addColorStop(1, f.colors[0]);
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    g.fillStyle = f.colors[1];
    const stripes = 9;
    for (let i = 0; i < stripes; i++) {
      const x0 = ((i + r() * 0.5) / stripes) * s,
        lean = (r() - 0.5) * s * 0.25,
        width = s * (0.018 + r() * 0.025),
        reach = 0.55 + r() * 0.45,
        top = r() * s;
      wrapped(s, (dx, dy) => {
        // A tapered brush stroke: wide in the middle, pointed at both ends, with a fork.
        g.beginPath();
        const steps = 14,
          len = s * reach;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps,
            y = top + t * len,
            x = x0 + lean * t + Math.sin(t * 7 + i) * s * 0.02,
            wv = width * Math.sin(Math.PI * t) ** 0.7;
          g.lineTo(x + dx - wv, y + dy);
        }
        for (let k = steps; k >= 0; k--) {
          const t = k / steps,
            y = top + t * len,
            x = x0 + lean * t + Math.sin(t * 7 + i) * s * 0.02,
            wv = width * Math.sin(Math.PI * t) ** 0.7;
          g.lineTo(x + dx + wv, y + dy);
        }
        g.fill();
        g.beginPath();
        const fy = top + len * 0.45,
          fx = x0 + lean * 0.45;
        g.moveTo(fx + dx, fy + dy - width);
        g.quadraticCurveTo(fx + dx + s * 0.06, fy + dy + s * 0.02, fx + dx + s * 0.09, fy + dy + s * 0.09);
        g.quadraticCurveTo(fx + dx + s * 0.04, fy + dy + s * 0.04, fx + dx, fy + dy + width);
        g.fill();
      });
    }
  },
  carbon(g, s, f) {
    const n = 8,
      cell = s / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const over = (x + y) % 4 < 2,
          grad = over ? g.createLinearGradient(x * cell, 0, (x + 1) * cell, 0) : g.createLinearGradient(0, y * cell, 0, (y + 1) * cell);
        grad.addColorStop(0, f.colors[0]);
        grad.addColorStop(0.5, f.colors[over ? 2 : 1]);
        grad.addColorStop(1, f.colors[0]);
        g.fillStyle = grad;
        g.fillRect(x * cell, y * cell, cell, cell);
      }
  },
  anodized(g, s, f) {
    const n = periodicNoise(4, 3),
      lines = periodicNoise(64, 8),
      a = hex(f.colors[0]),
      b = hex(f.colors[1]),
      c = hex(f.colors[2]);
    perPixel(g.canvas, (u, v, o) => {
      const t = n(u, v) * 0.6 + lines(u * 0.05, v) * 0.4;
      mixColors([b, a, c], t, o);
    });
  },
  fade(g, s, f) {
    // Read along the weapon's length by the shader; rows add a gentle diagonal wobble.
    const cols = f.colors.map(hex);
    perPixel(g.canvas, (u, v, o) => mixColors(cols, u + Math.sin(v * Math.PI * 2) * 0.04, o));
  },
  circuit(g, s, f, r, glow) {
    g.fillStyle = f.colors[0];
    g.fillRect(0, 0, s, s);
    const n = 24,
      cell = s / n;
    // Faint board texture.
    g.fillStyle = f.colors[1];
    for (let i = 0; i < 40; i++) g.fillRect(Math.floor(r() * n) * cell, Math.floor(r() * n) * cell, cell * (1 + Math.floor(r() * 3)), cell);
    for (const ctx of [g, glow]) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
    const dirs = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ];
    for (let t = 0; t < 30; t++) {
      let x = Math.floor(r() * n),
        y = Math.floor(r() * n),
        d = Math.floor(r() * 4) * 2;
      const pts: [number, number][] = [[x, y]];
      const steps = 4 + Math.floor(r() * 10);
      for (let k = 0; k < steps; k++) {
        if (r() < 0.3) d = (d + (r() < 0.5 ? 1 : 7)) % 8;
        x += dirs[d][0];
        y += dirs[d][1];
        pts.push([x, y]);
      }
      const width = cell * (r() < 0.3 ? 0.32 : 0.18);
      for (const [ctx, color, lw] of [
        [g, f.colors[2], width],
        [glow, "#fff", width],
      ] as const)
        wrapped(s, (dx, dy) => {
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = lw;
          ctx.beginPath();
          for (const [px, py] of pts) ctx.lineTo(px * cell + dx, py * cell + dy);
          ctx.stroke();
          for (const [px, py] of [pts[0], pts[pts.length - 1]]) {
            ctx.beginPath();
            ctx.arc(px * cell + dx, py * cell + dy, cell * 0.34, 0, Math.PI * 2);
            ctx.fill();
          }
        });
    }
  },
  magma(g, s, f, r, glow) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 26; i++) pts.push([r(), r()]);
    const rock = fbm(6, 4, 21),
      warm = fbm(3, 2, 4),
      dark = hex(f.colors[0]),
      mid = hex(f.colors[1]),
      hot = hex(f.colors[2]),
      white = hex(f.colors[3]);
    const img = g.getImageData(0, 0, s, s),
      gimg = glow.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const u = x / s,
          v = y / s;
        // Distance to the nearest and second-nearest cell centre on the torus.
        let d1 = 9,
          d2 = 9;
        const wu = u + (rock(u, v) - 0.5) * 0.06,
          wv = v + (rock(v, u) - 0.5) * 0.06;
        for (const [px, py] of pts) {
          let dx = Math.abs(wu - px),
            dy = Math.abs(wv - py);
          dx = Math.min(dx, 1 - dx);
          dy = Math.min(dy, 1 - dy);
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
        const edge = Math.sqrt(d2) - Math.sqrt(d1),
          seam = 1 - smooth(0.0, 0.018 + warm(u, v) * 0.02, edge),
          base = rock(u, v),
          o = [0, 0, 0];
        mixColors([dark, mid], base, o);
        const heat = seam;
        const hc = [lerp(hot[0], white[0], heat * heat), lerp(hot[1], white[1], heat * heat), lerp(hot[2], white[2], heat * heat)];
        const i = (y * s + x) * 4;
        img.data[i] = lerp(o[0], hc[0], heat);
        img.data[i + 1] = lerp(o[1], hc[1], heat);
        img.data[i + 2] = lerp(o[2], hc[2], heat);
        img.data[i + 3] = 255;
        gimg.data[i] = Math.min(255, heat * 255 * 1.1);
      }
    g.putImageData(img, 0, 0);
    glow.putImageData(gimg, 0, 0);
  },
  gilded(g, s, f, r) {
    const n = periodicNoise(6, 2),
      a = hex(f.colors[0]),
      b = hex(f.colors[1]),
      c = hex(f.colors[2]);
    perPixel(g.canvas, (u, v, o) => mixColors([b, a, c], 0.35 + n(u, v) * 0.5, o));
    // Engraved scrolls: spirals with leaf flicks, cut darker with a bright lip.
    const scroll = (cx: number, cy: number, rad: number, turn: number, dark: boolean) => {
      g.strokeStyle = dark ? "rgba(70,45,8,.85)" : "rgba(255,240,190,.55)";
      g.lineWidth = s * (dark ? 0.006 : 0.003);
      wrapped(s, (dx, dy) => {
        g.beginPath();
        for (let k = 0; k <= 60; k++) {
          const t = k / 60,
            ang = turn + t * Math.PI * 3.2,
            rr = rad * (1 - t * 0.85);
          g.lineTo(cx + dx + Math.cos(ang) * rr + (dark ? 0 : s * 0.002), cy + dy + Math.sin(ang) * rr + (dark ? 0 : s * 0.002));
        }
        g.stroke();
        for (let k = 0; k < 5; k++) {
          const ang = turn + k * 1.3,
            x = cx + dx + Math.cos(ang) * rad,
            y = cy + dy + Math.sin(ang) * rad;
          g.beginPath();
          g.moveTo(x, y);
          g.quadraticCurveTo(x + Math.cos(ang + 1) * rad * 0.5, y + Math.sin(ang + 1) * rad * 0.5, x + Math.cos(ang + 0.4) * rad * 0.7, y + Math.sin(ang + 0.4) * rad * 0.7);
          g.stroke();
        }
      });
    };
    for (let i = 0; i < 9; i++) {
      const cx = r() * s,
        cy = r() * s,
        rad = s * (0.06 + r() * 0.07),
        turn = r() * 6.28;
      scroll(cx, cy, rad, turn, true);
      scroll(cx, cy, rad, turn, false);
    }
  },
  waves(g, s, f) {
    g.fillStyle = f.colors[0];
    g.fillRect(0, 0, s, s);
    const rows = 8,
      per = 4,
      h = s / rows,
      w = s / per;
    for (let row = -1; row <= rows; row++)
      for (let col = 0; col < per; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0),
          cy = row * h + h;
        wrapped(s, (dx, dy) => {
          // Concentric scallops, darkest outside, with a pale foam rim.
          for (let k = 0; k < 4; k++) {
            g.fillStyle = k === 0 ? f.colors[2] : k % 2 ? f.colors[1] : f.colors[3];
            g.beginPath();
            g.arc(cx + dx, cy + dy, w * 0.62 - k * w * 0.13, Math.PI, 0);
            g.fill();
          }
          g.strokeStyle = f.colors[2];
          g.lineWidth = s * 0.004;
          for (let k = 1; k < 4; k++) {
            g.beginPath();
            g.arc(cx + dx, cy + dy, w * 0.62 - k * w * 0.13 - s * 0.006, Math.PI * 1.05, -0.05);
            g.stroke();
          }
        });
      }
  },
  hazard(g, s, f) {
    g.fillStyle = f.colors[0];
    g.fillRect(0, 0, s, s);
    g.fillStyle = f.colors[1];
    const n = 6,
      p = s / n;
    for (let i = -n; i < n * 2; i++) {
      g.beginPath();
      g.moveTo(i * p, 0);
      g.lineTo(i * p + p / 2, 0);
      g.lineTo(i * p + p / 2 + s, s);
      g.lineTo(i * p + s, s);
      g.fill();
    }
  },
  blossom(g, s, f, r) {
    const n = periodicNoise(3, 1),
      a = hex(f.colors[0]);
    perPixel(g.canvas, (u, v, o) => {
      const t = n(u, v) * 0.08;
      o[0] = a[0] - t * 255;
      o[1] = a[1] - t * 200;
      o[2] = a[2] - t * 180;
    });
    // Ink branches.
    g.strokeStyle = f.colors[3];
    g.lineCap = "round";
    const branch = (x: number, y: number, ang: number, len: number, wid: number, depth: number) => {
      const steps = 6;
      let px = x,
        py = y;
      for (let k = 0; k < steps; k++) {
        const nx = px + Math.cos(ang) * (len / steps),
          ny = py + Math.sin(ang) * (len / steps);
        g.lineWidth = wid * (1 - k / steps) + 1;
        wrapped(s, (dx, dy) => {
          g.beginPath();
          g.moveTo(px + dx, py + dy);
          g.lineTo(nx + dx, ny + dy);
          g.stroke();
        });
        px = nx;
        py = ny;
        ang += (r() - 0.5) * 0.6;
        if (depth > 0 && r() < 0.35) branch(px, py, ang + (r() < 0.5 ? 0.8 : -0.8), len * 0.5, wid * 0.5, depth - 1);
      }
      flowers.push([px, py]);
    };
    const flowers: [number, number][] = [];
    for (let i = 0; i < 3; i++) branch(r() * s, r() * s, r() * 6.28, s * 0.5, s * 0.018, 2);
    for (let i = 0; i < 14; i++) flowers.push([r() * s, r() * s]);
    for (const [fx, fy] of flowers) {
      const rad = s * (0.018 + r() * 0.016),
        turn = r() * 6.28;
      wrapped(s, (dx, dy) => {
        for (let k = 0; k < 5; k++) {
          const ang = turn + (k * Math.PI * 2) / 5;
          g.fillStyle = f.colors[1];
          g.beginPath();
          g.ellipse(fx + dx + Math.cos(ang) * rad, fy + dy + Math.sin(ang) * rad, rad * 0.75, rad * 0.5, ang, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = f.colors[2];
        g.beginPath();
        g.arc(fx + dx, fy + dy, rad * 0.4, 0, Math.PI * 2);
        g.fill();
      });
    }
  },
  prism(g, s, f, r) {
    // A mosaic of triangular facets in slightly different greys; the shader turns the greys
    // into a rainbow that slides as the view changes.
    const n = 10,
      cell = s / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        for (let k = 0; k < 2; k++) {
          const v = 150 + Math.floor(r() * 90);
          g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 12)})`;
          g.beginPath();
          if (k === 0) {
            g.moveTo(x * cell, y * cell);
            g.lineTo((x + 1) * cell + 0.5, y * cell);
            g.lineTo(x * cell, (y + 1) * cell + 0.5);
          } else {
            g.moveTo((x + 1) * cell + 0.5, y * cell);
            g.lineTo((x + 1) * cell + 0.5, (y + 1) * cell + 0.5);
            g.lineTo(x * cell, (y + 1) * cell + 0.5);
          }
          g.fill();
        }
  },
  folded(g, s, f) {
    const warp = fbm(4, 4, 33),
      a = hex(f.colors[0]),
      b = hex(f.colors[1]),
      c = hex(f.colors[2]);
    perPixel(g.canvas, (u, v, o) => {
      const w = warp(u, v),
        band = 0.5 + 0.5 * Math.sin((v + w * 0.35) * Math.PI * 2 * 9 + Math.sin(u * Math.PI * 2) * 2),
        fine = 0.5 + 0.5 * Math.sin((v + w * 0.4) * Math.PI * 2 * 27);
      mixColors([b, a, c], band * 0.75 + fine * 0.25, o);
    });
  },
  marble(g, s, f) {
    const warp = fbm(3, 5, 41),
      warp2 = fbm(4, 4, 77),
      cols = f.colors.map(hex);
    perPixel(g.canvas, (u, v, o) => {
      const q = warp(u, v),
        rr = warp2(u + q * 0.3, v + q * 0.3),
        t = 0.5 + 0.5 * Math.sin((u + rr * 1.4) * Math.PI * 2 * 2);
      mixColors(cols, t, o);
    });
  },
  topo(g, s, f) {
    const h = fbm(3, 4, 61),
      base = hex(f.colors[0]),
      line = hex(f.colors[1]),
      alt = hex(f.colors[2]);
    perPixel(g.canvas, (u, v, o) => {
      const e = h(u, v) * 14,
        k = Math.abs(e - Math.round(e)),
        major = Math.round(e) % 4 === 0,
        ink = 1 - smooth(major ? 0.05 : 0.03, major ? 0.09 : 0.06, k),
        bg = Math.floor(e) % 2 ? alt : base;
      o[0] = lerp(bg[0], line[0], ink);
      o[1] = lerp(bg[1], line[1], ink);
      o[2] = lerp(bg[2], line[2], ink);
    });
  },
  glitch(g, s, f, r, glow) {
    g.fillStyle = f.colors[0];
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += Math.max(1, s / 128)) {
      g.fillStyle = "rgba(255,255,255,.035)";
      g.fillRect(0, y, s, Math.max(1, s / 512));
    }
    for (let i = 0; i < 34; i++) {
      const y = r() * s,
        hgt = s * (0.006 + r() * 0.04),
        x = r() * s,
        w = s * (0.1 + r() * 0.6),
        col = f.colors[1 + Math.floor(r() * 3)],
        lit = col !== f.colors[3];
      for (const [ctx, c] of [
        [g, col],
        [glow, lit ? "#fff" : "#000"],
      ] as const)
        wrapped(s, (dx, dy) => {
          ctx.fillStyle = c;
          ctx.fillRect(x + dx, y + dy, w, hgt);
        });
    }
  },
};
/** Scuff mask: specks and scratches where paint wears through, denser for higher `amount`. */
function paintWear(aux: CanvasRenderingContext2D, s: number, amount: number, seed: number) {
  if (amount <= 0) return;
  const n = fbm(5, 4, seed),
    img = aux.getImageData(0, 0, s, s),
    d = img.data,
    cut = 0.72 - amount * 0.2;
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const v = n(x / s, y / s),
        i = (y * s + x) * 4;
      d[i + 1] = Math.max(d[i + 1], smooth(cut, cut + 0.05, v) * 255);
    }
  aux.putImageData(img, 0, 0);
  const r = rng(seed * 13 + 7);
  aux.strokeStyle = "rgb(0,255,0)";
  aux.globalCompositeOperation = "lighter";
  for (let i = 0; i < 26 * amount; i++) {
    const x = r() * s,
      y = r() * s,
      a = r() * 6.28,
      len = s * (0.02 + r() * 0.08);
    aux.lineWidth = Math.max(1, s / 700);
    wrapped(s, (dx, dy) => {
      aux.beginPath();
      aux.moveTo(x + dx, y + dy);
      aux.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
      aux.stroke();
    });
  }
  aux.globalCompositeOperation = "source-over";
}
const cache = new Map<string, PatternCanvases>();
/** The finish's colour and mask canvases at `size` pixels, cached. */
export function paintFinish(f: Finish, size = 512): PatternCanvases {
  const key = f.id + "@" + size,
    hit = cache.get(key);
  if (hit) return hit;
  const color = canvas(size),
    aux = canvas(size),
    g = color.getContext("2d", { willReadFrequently: true })!,
    a = aux.getContext("2d", { willReadFrequently: true })!;
  a.fillStyle = "#000";
  a.fillRect(0, 0, size, size);
  const seed = hashString(f.id);
  const paint = painters[f.pattern];
  if (paint) paint(g, size, f, rng(seed), a);
  else {
    g.clearRect(0, 0, size, size);
  }
  // Glow masks are drawn in white; keep them in the red channel only.
  if (f.glow) {
    const img = a.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i + 1] = 0;
      img.data[i + 2] = 0;
    }
    a.putImageData(img, 0, 0);
  }
  paintWear(a, size, f.wear ?? 0, seed);
  const out = { color, aux };
  cache.set(key, out);
  return out;
}
/** A small swatch for menus: the pattern, or a sample of steel for Factory. */
export function swatch(f: Finish, size = 96) {
  const c = canvas(size),
    g = c.getContext("2d")!;
  if (f.pattern === "factory") {
    const grad = g.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "#5b6266");
    grad.addColorStop(0.5, "#2f3437");
    grad.addColorStop(1, "#454b4e");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }
  const art = paintFinish(f, 192);
  if (f.pattern === "fade") g.drawImage(art.color, 0, 0, size, size);
  else {
    // A couple of repeats, so the swatch shows how the pattern reads at weapon scale.
    const tiles = f.scale > 30 ? 4 : f.scale > 5 ? 2 : 1.4;
    for (let x = 0; x < tiles; x++) for (let y = 0; y < tiles; y++) g.drawImage(art.color, (x * size) / tiles, (y * size) / tiles, size / tiles + 0.5, size / tiles + 0.5);
  }
  if (f.pattern === "prism") {
    const grad = g.createLinearGradient(0, 0, size, size);
    for (const [i, col] of ["#ff6ad5", "#ffd36b", "#6bffb8", "#6bc8ff", "#c56bff"].entries()) grad.addColorStop(i / 4, col);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = "source-over";
  }
  if (f.glow) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.35;
    g.drawImage(c, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  return c;
}
