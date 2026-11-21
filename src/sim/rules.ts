import { catalog, type Gun } from "../config/weapons";
export const U = 0.0254,
  DT = 1 / 64,
  DEG = Math.PI / 180,
  GRAVITY = 800 * U,
  JUMP = 301.993 * U;
export const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));
export const capMoney = (n: number) => clamp(n, 0, 16000);
export const lossPay = (lost: number) => 1400 + Math.min(4, lost) * 500;
export function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const materials: Record<string, [number, number]> = {
  cardboard: [1.4, 0.08],
  foliage: [1.4, 0.08],
  glass: [1.2, 0.05],
  wood: [1, 0.12],
  plaster: [0.85, 0.14],
  sand: [0.7, 0.16],
  dirt: [0.7, 0.16],
  concrete: [0.65, 0.18],
  stone: [0.65, 0.18],
  metal: [0.5, 0.2],
  tile: [0.8, 0.14],
};
export function penetrate(
  power: number,
  gun: Gun,
  material: string,
  units: number,
) {
  const [mod, loss] = materials[material] ?? materials.concrete;
  const w = catalog[gun];
  return units > w.limit
    ? 0
    : Math.max(
        0,
        power * (1 - loss) - (units * units * (2 / w.pen)) / mod / 24,
      );
}
export type Group = "head" | "chest" | "stomach" | "arm" | "leg";
export function damage(
  base: number,
  gun: Gun,
  metres: number,
  group: Group,
  armor: number,
  helmet: boolean,
) {
  const w = catalog[gun];
  const multiplier = { head: 4, chest: 1, stomach: 1.25, arm: 1, leg: 0.75 }[
    group
  ];
  const raw = base * w.range ** (metres / (500 * U)) * multiplier;
  // Preserve the AWP's close-range chest one-shot on an armored target.
  const healthRatio = gun === "awp" ? w.armor : w.armor * 0.5;
  const used =
    armor > 0 && (group !== "head" || helmet)
      ? Math.min(armor, (raw - raw * healthRatio) * 0.5)
      : 0;
  return { hp: Math.round(raw - used * 2), armor: used };
}
export function velocity(
  vx: number,
  vz: number,
  dx: number,
  dz: number,
  speed: number,
  ground: boolean,
) {
  const length = Math.hypot(dx, dz);
  if (length > 1) {
    dx /= length;
    dz /= length;
  }
  if (ground) {
    const v = Math.hypot(vx, vz);
    const factor = v
      ? Math.max(0, 1 - (Math.max(v, 80 * U) * 5.2 * DT) / v)
      : 0;
    vx *= factor;
    vz *= factor;
  }
  const room = (ground ? speed : Math.min(speed, 30 * U)) - (vx * dx + vz * dz);
  const add = Math.max(0, Math.min(room, (ground ? 5.5 : 12) * speed * DT));
  return [vx + dx * add, vz + dz * add];
}
export interface NavPoint {
  x: number;
  z: number;
  links: number[];
}
export function nearest(nodes: NavPoint[], x: number, z: number) {
  let best = 0,
    cost = Infinity;
  nodes.forEach((n, i) => {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < cost) {
      cost = d;
      best = i;
    }
  });
  return best;
}
export function path(nodes: NavPoint[], start: number, end: number): number[] {
  const distance = (a: number, b: number) =>
    Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
  const open = new Set([start]),
    g = new Map([[start, 0]]),
    parent = new Map<number, number>();
  while (open.size) {
    let cur = -1,
      score = Infinity;
    for (const i of open) {
      const v = g.get(i)! + distance(i, end);
      if (v < score) {
        cur = i;
        score = v;
      }
    }
    if (cur === end) {
      const route = [cur];
      while (parent.has(cur)) {
        cur = parent.get(cur)!;
        route.unshift(cur);
      }
      return route;
    }
    open.delete(cur);
    for (const link of nodes[cur].links) {
      const v = g.get(cur)! + distance(cur, link);
      if (v < (g.get(link) ?? Infinity)) {
        g.set(link, v);
        parent.set(link, cur);
        open.add(link);
      }
    }
  }
  return [];
}
