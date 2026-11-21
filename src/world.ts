export type Team = "CT" | "T";
export type MapId = "dust2" | "mirage" | "range";
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export type MaterialId =
  | "cardboard"
  | "foliage"
  | "glass"
  | "wood"
  | "plaster"
  | "sand"
  | "dirt"
  | "concrete"
  | "stone"
  | "metal"
  | "tile";
export interface Rect extends Vec3 {
  w: number;
  d: number;
}
export interface Box extends Rect {
  h: number;
  mat: MaterialId;
  style?:
    "building" | "floor" | "crate" | "door" | "container" | "roof" | "bench";
}
export interface Ramp extends Rect {
  h: number;
  up: "N" | "S" | "E" | "W";
  mat: MaterialId;
}
export interface Node extends Vec3 {
  links: number[];
  label?: string;
}
export interface MapDef {
  id: MapId;
  name: string;
  width: number;
  depth: number;
  boxes: Box[];
  ramps: Ramp[];
  spawns: Record<Team, (Vec3 & { yaw: number })[]>;
  sites: Record<"A" | "B", Rect>;
  buyZones: Record<Team, Rect>;
  nodes: Node[];
  callouts: { name: string; x: number; z: number }[];
}
type Tile = [number, number];
const cell = 5,
  cells = 21;
const center = (i: number) => cell * (i + 0.5);
function district(id: "dust2" | "mirage"): MapDef {
  const dust = id === "dust2";
  const mask = Array.from({ length: cells }, () =>
    Array<boolean>(cells).fill(false),
  );
  function room(x: number, z: number, right: number, bottom: number) {
    for (let j = z; j <= bottom; j++)
      for (let i = x; i <= right; i++) mask[j][i] = true;
  }
  function road(...corners: Tile[]) {
    for (let i = 1; i < corners.length; i++) {
      const [x, z] = corners[i - 1],
        [x2, z2] = corners[i];
      room(Math.min(x, x2), Math.min(z, z2), Math.max(x, x2), Math.max(z, z2));
    }
  }
  const t: Tile = [10, 18],
    ct: Tile = dust ? [10, 3] : [9, 3];
  const a: Tile = dust ? [17, 4] : [16, 5],
    b: Tile = dust ? [3, 4] : [4, 5];
  room(8, 17, 12, 19);
  room(8, 2, 12, 4);
  room(a[0] - 2, a[1] - 2, a[0] + 2, a[1] + 2);
  room(b[0] - 2, b[1] - 2, b[0] + 2, b[1] + 2);
  if (dust) {
    // Left and right lanes have different entrance turns; Mid and Short cross-connect them.
    road(
      t,
      [5, 18],
      [5, 16],
      [2, 16],
      [2, 12],
      [4, 12],
      [4, 8],
      [2, 8],
      [2, 5],
    );
    room(1, 12, 3, 15);
    room(3, 8, 5, 11);
    road(t, [14, 18], [14, 16], [17, 16], [17, 14], [19, 14], [19, 5], [17, 5]);
    room(18, 7, 19, 13);
    room(14, 14, 16, 15);
    road(t, [10, 14], [11, 14], [11, 7], [10, 7], ct);
    room(9, 12, 11, 15);
    room(10, 8, 11, 11);
    road([11, 12], [13, 12], [13, 9], [15, 9], [15, 6], a);
    road(ct, [7, 3], [7, 5], b);
    road(ct, [13, 3], [13, 5], a);
    road([4, 12], [7, 12], [7, 14], [10, 14]);
    road([5, 8], [7, 8], [7, 6], [10, 6]);
  } else {
    road(t, [6, 18], [6, 16], [3, 16], [3, 13], [4, 13], [4, 8], b);
    room(2, 13, 4, 15);
    room(3, 9, 4, 12);
    road(t, [14, 18], [14, 16], [16, 16], [16, 11], [15, 11], [15, 7], a);
    road([16, 16], [19, 16], [19, 8], [18, 8], [18, 6], a);
    room(18, 11, 19, 14);
    road([12, 17], [14, 17], [14, 16]);
    room(14, 15, 18, 16);
    room(16, 13, 18, 14);
    road(t, [10, 15], [9, 15], [9, 12], [10, 12], [10, 7], [9, 7], ct);
    room(9, 9, 11, 12);
    room(8, 13, 10, 15);
    road([10, 10], [13, 10], [13, 7], [15, 7], a);
    road([10, 12], [7, 12], [7, 14], [4, 14]);
    road([10, 9], [7, 9], [7, 7], [5, 7], b);
    road(ct, [7, 3], [7, 5], b);
    road(ct, [13, 3], [13, 5], a);
  }
  const boxes: Box[] = [],
    ramps: Ramp[] = [];
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: MaterialId,
    style?: Box["style"],
  ) => boxes.push({ x, y, z, w, h, d, mat, style });
  box(52.5, -0.24, 52.5, 105, 0.48, 105, dust ? "sand" : "tile", "floor");
  const nodes: Node[] = [],
    grid = mask.map((row) => row.map(() => -1));
  const elevation = mask.map((row) => row.map(() => 0));
  const raised = (x: number, z: number, h: number) => {
    if (!mask[z][x]) return;
    box(center(x), h / 2, center(z), cell, h, cell, "stone", "floor");
    elevation[z][x] = h;
    for (const [dx, dz, up] of [
      [0, 1, "N"],
      [0, -1, "S"],
      [1, 0, "W"],
      [-1, 0, "E"],
    ] as const) {
      if (mask[z + dz]?.[x + dx]) {
        ramps.push({
          x: center(x + dx),
          y: 0,
          z: center(z + dz),
          w: cell,
          d: cell,
          h,
          up,
          mat: "stone",
        });
        elevation[z + dz][x + dx] = h / 2;
      }
    }
  };
  raised(a[0], a[1], dust ? 1.3 : 1.5);
  if (!dust) raised(19, 10, 1.85);
  // Split buildings at regular intervals so the skyline and each street frontage have individual silhouettes.
  const used = mask.map((row) => row.slice());
  for (let z = 0; z < cells; z++)
    for (let x = 0; x < cells; x++) {
      if (mask[z][x]) {
        grid[z][x] = nodes.length;
        nodes.push({
          x: center(x),
          z: center(z),
          y: elevation[z][x],
          links: [],
        });
      } else if (!used[z][x]) {
        let w = 1,
          d = 1;
        while (w < 3 && x + w < cells && !used[z][x + w]) w++;
        while (
          d < 3 &&
          z + d < cells &&
          used[z + d].slice(x, x + w).every((v) => !v)
        )
          d++;
        for (let j = z; j < z + d; j++)
          for (let i = x; i < x + w; i++) used[j][i] = true;
        const h = 4.7 + ((x * 37 + z * 17 + x * z * 3) % 47) / 10;
        box(
          (x + w / 2) * cell,
          h / 2,
          (z + d / 2) * cell,
          w * cell,
          h,
          d * cell,
          (x + z) % 4 === 0 ? "stone" : dust ? "sand" : "plaster",
          "building",
        );
      }
    }
  // Connect tile centers only across a walkable elevation change.
  for (let z = 0; z < cells; z++)
    for (let x = 0; x < cells; x++) {
      const i = grid[z][x];
      if (i < 0) continue;
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]) {
        const j = grid[z + dz]?.[x + dx] ?? -1;
        if (j < 0) continue;
        const crossingY = (node: Node) => {
          const ramp = ramps.find((r) => r.x === node.x && r.z === node.z);
          if (!ramp) return node.y;
          const u = (nodes[i].x + nodes[j].x) / 2 - ramp.x,
            v = (nodes[i].z + nodes[j].z) / 2 - ramp.z;
          return (
            ramp.h *
            (0.5 +
              (ramp.up === "N"
                ? -v
                : ramp.up === "S"
                  ? v
                  : ramp.up === "E"
                    ? u
                    : -u) /
                cell)
          );
        };
        if (Math.abs(crossingY(nodes[i]) - crossingY(nodes[j])) < 0.25)
          nodes[i].links.push(j);
      }
    }
  const prop = (
    tx: number,
    tz: number,
    dx: number,
    dz: number,
    w: number,
    h: number,
    d: number,
    mat: MaterialId,
    style: Box["style"],
  ) =>
    box(
      center(tx) + dx,
      h / 2 + elevation[tz][tx],
      center(tz) + dz,
      w,
      h,
      d,
      mat,
      style,
    );
  for (const [tx, tz] of [
    [a[0] - 1, a[1] + 1],
    [a[0] + 1, a[1] - 1],
    [b[0], b[1] + 1],
    [b[0] - 1, b[1] - 1],
    [10, 13],
  ]) {
    prop(tx, tz, 1.35, 1.35, 1.55, 1.65, 1.55, "wood", "crate");
    prop(tx, tz, -1.4, 1.4, 1.45, 1.1, 1.55, "wood", "crate");
  }
  if (dust) {
    for (const [x, z] of [
      [11, 8],
      [7, 5],
      [17, 15],
    ]) {
      prop(x, z, -1.55, 0.95, 1.9, 3.3, 0.19, "wood", "door");
      prop(x, z, 1.95, 0.95, 1.05, 3.3, 0.2, "wood", "door");
    }
    prop(18, 12, -1.7, 1.45, 2.1, 2.15, 1.42, "metal", "container");
    prop(13, 12, 1.2, 1.3, 1.6, 1.3, 1.6, "wood", "crate");
    for (const [tx, tz] of [
      [2, 14],
      [2, 13],
      [4, 9],
      [4, 10],
    ])
      box(center(tx), 4, center(tz), cell, 0.6, cell, "sand", "roof");
  } else {
    for (const [tx, tz] of [
      [3, 14],
      [4, 10],
      [4, 11],
      [13, 9],
      [19, 13],
    ])
      box(center(tx), 4.1, center(tz), cell, 0.55, cell, "plaster", "roof");
    prop(9, 7, 1.35, 1.35, 0.25, 2.3, 1.5, "plaster", "door");
    prop(5, 6, 1.4, 1.3, 1.55, 0.7, 1.3, "wood", "bench");
    prop(4, 4, -1.35, -1.65, 1.55, 1.9, 2.2, "metal", "container");
  }
  // Bots can cross open courtyards diagonally. Test both corners and the swept
  // player radius so a route never cuts through a doorway post or crate.
  function clearDiagonal(a: Node, b: Node) {
    for (const box of boxes) {
      if (box.y - box.h / 2 > a.y + 1.76 || box.y + box.h / 2 < a.y + 0.05)
        continue;
      if (
        Math.abs(box.x - (a.x + b.x) / 2) > box.w / 2 + 3 ||
        Math.abs(box.z - (a.z + b.z) / 2) > box.d / 2 + 3
      )
        continue;
      for (let j = 0; j <= 32; j++) {
        const t = j / 32,
          x = a.x + (b.x - a.x) * t,
          z = a.z + (b.z - a.z) * t;
        if (
          Math.abs(box.x - x) < box.w / 2 + 0.42 &&
          Math.abs(box.z - z) < box.d / 2 + 0.42
        )
          return false;
      }
    }
    return true;
  }
  for (let z = 1; z < cells - 1; z++)
    for (let x = 1; x < cells - 1; x++) {
      const i = grid[z][x];
      if (i < 0) continue;
      for (const dx of [-1, 1]) {
        const j = grid[z + 1][x + dx];
        if (
          j < 0 ||
          !nodes[i].links.includes(grid[z][x + dx]) ||
          !nodes[i].links.includes(grid[z + 1][x])
        )
          continue;
        if (nodes[i].y || nodes[j].y || !clearDiagonal(nodes[i], nodes[j]))
          continue;
        nodes[i].links.push(j);
        nodes[j].links.push(i);
      }
    }
  const called: [string, Tile][] = dust
    ? [
        ["Long A", [19, 10]],
        ["Long Doors", [17, 15]],
        ["Pit", [18, 7]],
        ["Short A", [13, 9]],
        ["Mid Doors", [11, 8]],
        ["Top Mid", [10, 14]],
        ["Upper Tunnels", [4, 10]],
        ["Lower Tunnels", [2, 14]],
        ["B Window", [7, 8]],
        ["B Doors", [7, 5]],
      ]
    : [
        ["Palace", [19, 10]],
        ["T Ramp", [16, 12]],
        ["Ticket", [14, 5]],
        ["Jungle", [13, 7]],
        ["Connector", [13, 10]],
        ["Window", [9, 7]],
        ["Mid", [10, 11]],
        ["Underpass", [7, 14]],
        ["Apartments", [4, 11]],
        ["Market", [7, 5]],
        ["B Short", [7, 9]],
      ];
  called.push(["A Site", a], ["B Site", b], ["T Spawn", t], ["CT Spawn", ct]);
  const callouts = called.map(([name, [x, z]]) => ({
    name,
    x: center(x),
    z: center(z),
  }));
  for (const [name, [x, z]] of called) {
    const n = grid[z][x];
    if (n >= 0) nodes[n].label = name;
  }
  const zone = ([x, z]: Tile, w: number): Rect => ({
    x: center(x),
    z: center(z),
    y: elevation[z][x],
    w,
    d: w,
  });
  const spawns = ([x, z]: Tile, yaw: number) =>
    (
      [
        [0, 0],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as Tile[]
    ).map(([dx, dz]) => ({
      x: center(x) + dx * 1.55,
      y: 0,
      z: center(z) + dz * 1.25,
      yaw,
    }));
  return {
    id,
    name: dust ? "Dust2" : "Mirage",
    width: 105,
    depth: 105,
    boxes,
    ramps,
    nodes,
    callouts,
    spawns: { T: spawns(t, 0), CT: spawns(ct, Math.PI) },
    sites: { A: zone(a, 11), B: zone(b, 12) },
    buyZones: { CT: zone(ct, 14), T: zone(t, 14) },
  };
}
function firingRange(): MapDef {
  const size = 50.8;
  const boxes: Box[] = [
    {
      x: size / 2,
      z: size / 2,
      y: -0.25,
      w: size,
      h: 0.5,
      d: size,
      mat: "concrete",
      style: "floor",
    },
  ];
  for (const [x, z, w, d] of [
    [0, size / 2, 0.5, size],
    [size, size / 2, 0.5, size],
    [size / 2, 0, size, 0.5],
    [size / 2, size, size, 0.5],
  ])
    boxes.push({ x, z, w, d, y: 2, h: 4, mat: "concrete" });
  for (const [i, mat] of (
    ["wood", "plaster", "metal", "concrete", "glass", "cardboard"] as const
  ).entries())
    for (const [j, thickness] of [4, 8, 16, 32, 64].entries())
      boxes.push({
        x: 2 + i * 4.15,
        z: 7 + j * 6.2,
        y: 1.15,
        w: 2.8,
        h: 2.3,
        d: thickness * 0.0254,
        mat,
      });
  boxes.push({ x: 36, z: 16.6, y: 2.7, w: 15, h: 5.4, d: 0.9, mat: "plaster" });
  const pos = (x: number, z: number) => ({ x, y: 0, z });
  const nodes: Node[] = [
    pos(35, 42),
    pos(25.2, 30),
    pos(25.2, 12),
    pos(25.2, 3),
    pos(35, 3),
    pos(43, 26),
  ].map((p, i) => ({ ...p, links: [(i + 1) % 6, (i + 5) % 6] }));
  const zone = (x: number, z: number) => ({ ...pos(x, z), w: 10, d: 10 });
  return {
    id: "range",
    name: "Practice Range",
    width: size,
    depth: size,
    boxes,
    ramps: [],
    nodes,
    callouts: [{ name: "Firing Line", x: 35, z: 42 }],
    buyZones: { CT: zone(35, 42), T: zone(24, 3) },
    sites: { A: zone(33, 4), B: zone(9, 4) },
    spawns: {
      CT: [0, 1, 2, 3, 4].map((i) => ({ ...pos(35 + i * 1.1, 42), yaw: 0 })),
      T: [0, 1, 2, 3, 4].map((i) => ({ ...pos(4 + i * 7, 3), yaw: Math.PI })),
    },
  };
}
export const maps: Record<MapId, MapDef> = {
  dust2: district("dust2"),
  mirage: district("mirage"),
  range: firingRange(),
};
