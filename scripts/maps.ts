import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  maps,
  mapIds,
  type GridMapId,
  type MapDef,
  type Vec3,
} from "../src/world";

const runSpeed = 250 * 0.0254;
function nearest(map: MapDef, p: Pick<Vec3, "x" | "z">) {
  let id = 0,
    best = Infinity;
  map.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - p.x, n.z - p.z);
    if (d < best) {
      id = i;
      best = d;
    }
  });
  return id;
}
function distances(m: MapDef, start: number) {
  const d = m.nodes.map(() => Infinity),
    todo = new Set([start]);
  d[start] = 0;
  while (todo.size) {
    let current = -1;
    for (const i of todo) if (current < 0 || d[i] < d[current]) current = i;
    todo.delete(current);
    const from = m.nodes[current];
    for (const next of from.links) {
      const to = m.nodes[next],
        candidate =
          d[current] + Math.hypot(from.x - to.x, from.z - to.z, from.y - to.y);
      if (candidate < d[next]) {
        d[next] = candidate;
        todo.add(next);
      }
    }
  }
  return d;
}
function check(m: MapDef) {
  const error = (s: string) => {
    throw new Error(m.name + " · " + s);
  };
  function solid(p: Vec3) {
    return m.boxes.some(
      (b) =>
        Math.abs(b.x - p.x) < b.w / 2 + 0.405 &&
        Math.abs(b.z - p.z) < b.d / 2 + 0.405 &&
        p.y + 0.8 > b.y - b.h / 2 + 0.001 &&
        p.y + 0.8 < b.y + b.h / 2 - 0.001,
    );
  }
  for (const [i, n] of m.nodes.entries()) {
    if (solid(n))
      error(
        "node " +
          i +
          " in solid (" +
          Math.floor(n.x / 5) +
          "," +
          Math.floor(n.z / 5) +
          ")",
      );
    for (const j of n.links) {
      if (!m.nodes[j]?.links.includes(i))
        error("one-way link " + i + " to " + j);
      const b = m.nodes[j];
      for (let k = 1; k < 32; k++) {
        const t = k / 32;
        if (
          solid({
            x: n.x + (b.x - n.x) * t,
            y: n.y + (b.y - n.y) * t,
            z: n.z + (b.z - n.z) * t,
          })
        )
          error(
            "blocked link " +
              i +
              " to " +
              j +
              " (" +
              [n.x, n.z, b.x, b.z].map((v) => Math.floor(v / 5)).join(",") +
              ")",
          );
      }
    }
  }
  for (const team of ["T", "CT"] as const)
    for (const p of m.spawns[team]) {
      if (solid(p)) error(team + " spawn in solid");
      const d = distances(m, nearest(m, p));
      if (d.some((v) => !Number.isFinite(v)))
        error(team + " spawn cannot reach all nodes");
    }
  const all: Partial<Record<GridMapId, [string, string[], number, number][]>> =
    {
      dust2: [
        [
          "T to A via Long",
          ["T Spawn", "Long Doors", "Long A", "A Site"],
          12,
          14,
        ],
        [
          "T to B via Tunnels",
          ["T Spawn", "Lower Tunnels", "Upper Tunnels", "B Site"],
          13,
          15,
        ],
        ["T to Mid Doors", ["T Spawn", "Mid Doors"], 8, 9],
        ["CT to A", ["CT Spawn", "A Site"], 6, 7],
        ["CT to B", ["CT Spawn", "B Site"], 5, 7],
      ],
      mirage: [
        ["T to A via Palace", ["T Spawn", "Palace", "A Site"], 11, 13],
        ["T to B via Apartments", ["T Spawn", "Apartments", "B Site"], 12, 14],
        ["CT to A", ["CT Spawn", "A Site"], 6, 8],
      ],
      nuke: [
        ["T to A via Lobby", ["T Spawn", "Lobby", "A Site"], 10, 13],
        ["T to B via Ramp", ["T Spawn", "Lobby", "Ramp", "B Site"], 14, 18],
        ["T to B via Secret", ["T Spawn", "Yard", "Secret", "B Site"], 12, 16],
        ["CT to A", ["CT Spawn", "A Site"], 4, 7],
        ["CT to B", ["CT Spawn", "B Site"], 4, 7],
      ],
      inferno: [
        ["T to B via Banana", ["T Spawn", "Banana", "B Site"], 12, 16],
        ["T to A via Apartments", ["T Spawn", "Apartments", "A Site"], 11, 15],
        ["CT to A", ["CT Spawn", "A Site"], 4, 7],
        ["CT to B", ["CT Spawn", "B Site"], 5, 8],
      ],
      vertigo: [
        ["T to A via Ramp", ["T Spawn", "A Ramp", "A Site"], 11, 15],
        ["T to B via Stairs", ["T Spawn", "B Stairs", "B Site"], 10, 14],
        ["CT to A", ["CT Spawn", "A Site"], 4, 7],
        ["CT to B", ["CT Spawn", "B Site"], 4, 7],
      ],
    };
  const timings = all[m.id as GridMapId] ?? [];
  console.log(m.name + " · " + m.nodes.length + " connected nodes");
  for (const [name, labels, low, high] of timings) {
    const ids = labels.map((l) =>
      nearest(
        m,
        m.callouts.find((c) => c.name === l)!,
      ),
    );
    // The race ends on entering the plant zone; a player needn't reach its center.
    const last = labels.at(-1),
      zone =
        last === "A Site" ? m.sites.A : last === "B Site" ? m.sites.B : null;
    let distance = 0;
    for (let i = 1; i < ids.length; i++) {
      const d = distances(m, ids[i - 1]);
      if (i === ids.length - 1 && zone)
        distance += Math.min(
          ...m.nodes.map((n, j) =>
            Math.abs(n.x - zone.x) <= zone.w / 2 &&
            Math.abs(n.z - zone.z) <= zone.d / 2
              ? d[j]
              : Infinity,
          ),
        );
      else distance += d[ids[i]];
    }
    const t = distance / runSpeed;
    console.log("  " + name + " · " + t.toFixed(1) + " s");
    if (t < low * 0.75 || t > high * 1.25)
      error(name + " outside ±25% of " + low + "–" + high + " seconds");
  }
}
function diagram(m: MapDef) {
  const zoom = 6,
    offset = 12,
    w = m.width * zoom + offset * 2,
    h = m.depth * zoom + offset * 2;
  const x = (v: number) => offset + v * zoom;
  const floor = "#283438",
    building = "#60685e",
    ink = "#d9e1cf",
    gold = "#dc9c4e",
    blue = "#7db8cb";
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + 44}" role="img" aria-labelledby="title">`,
    '<title id="title">' +
      m.name +
      " navigation and bombsite schematic</title>",
    `<rect width="100%" height="100%" fill="${floor}"/>`,
  ];
  const rect = (
    r: { x: number; z: number; w: number; d: number },
    style: string,
  ) =>
    `<rect x="${x(r.x - r.w / 2)}" y="${x(r.z - r.d / 2)}" width="${r.w * zoom}" height="${r.d * zoom}" ${style}/>`;
  for (const b of m.boxes)
    if (b.style !== "floor")
      lines.push(
        rect(
          b,
          `fill="${b.style === "building" ? building : "#8f7955"}" stroke="${floor}" stroke-width=".9"`,
        ),
      );
  for (const r of m.ramps) lines.push(rect(r, 'fill="#50605f"'));
  for (const id of ["A", "B"] as const)
    lines.push(
      rect(
        m.sites[id],
        `fill="${gold}" fill-opacity=".26" stroke="${gold}" stroke-width="2"`,
      ),
    );
  for (const t of ["CT", "T"] as const)
    lines.push(
      rect(
        m.buyZones[t],
        `fill="none" stroke="${blue}" stroke-width="1.5" stroke-dasharray="4 3"`,
      ),
    );
  const path: string[] = [];
  m.nodes.forEach((n, i) => {
    for (const j of n.links)
      if (j > i)
        path.push(
          "M" +
            x(n.x) +
            " " +
            x(n.z) +
            "L" +
            x(m.nodes[j].x) +
            " " +
            x(m.nodes[j].z),
        );
  });
  lines.push(
    '<path d="' +
      path.join("") +
      '" stroke="#94aeac" stroke-opacity=".55" fill="none" stroke-width="1.3"/>',
  );
  for (const n of m.nodes)
    lines.push(
      `<circle cx="${x(n.x)}" cy="${x(n.z)}" r="1.5" fill="#a3b5a8"/>`,
    );
  for (const c of m.callouts)
    lines.push(
      `<text x="${x(c.x)}" y="${x(c.z) - 5}" fill="${ink}" stroke="${floor}" stroke-width="3" paint-order="stroke" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="600" font-size="9">${c.name}</text>`,
    );
  lines.push(
    `<text x="${offset}" y="${h + 24}" font-family="system-ui,sans-serif" font-size="18" font-weight="700" fill="${ink}">${m.name}</text>`,
    `<text x="${w - offset}" y="${h + 24}" font-family="system-ui,sans-serif" text-anchor="end" fill="${ink}" font-size="12">North up · Sites in amber · Buy zones in blue</text>`,
    "</svg>",
  );
  return lines.join("\n");
}
const [action = "check", mapId] = process.argv.slice(2);
if (mapId && !(mapIds as string[]).includes(mapId))
  throw Error("Expected one of " + mapIds.join(", "));
if (action !== "check" && action !== "svg")
  throw Error("Expected check or svg");
const selected = mapId
  ? [maps[mapId as GridMapId]]
  : mapIds.map((id) => maps[id]);
for (const map of selected) {
  if (action === "check") check(map);
  else {
    const folder = new URL("../docs/maps/", import.meta.url);
    await mkdir(folder, { recursive: true });
    const out = new URL(map.id + ".svg", folder);
    await writeFile(out, diagram(map));
    console.log(fileURLToPath(out));
  }
}
