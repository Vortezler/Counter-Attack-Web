export type Team = "CT" | "T";
export type GridMapId =
  | "dust2"
  | "mirage"
  | "nuke"
  | "inferno"
  | "vertigo"
  | "switchyard"
  | "canopy"
  | "foundry";
export type MapId = GridMapId | "range";
export const mapIds: GridMapId[] = [
  "dust2",
  "mirage",
  "nuke",
  "inferno",
  "vertigo",
  "switchyard",
  "canopy",
  "foundry",
];
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
    | "building"
    | "floor"
    | "crate"
    | "door"
    | "container"
    | "roof"
    | "bench"
    | "tank"
    | "barrier"
    | "fountain"
    | "scaffold"
    // Set pieces drawn in detail by `scenery.ts`; the box is their collision.
    | "railcar"
    | "tanker"
    | "bogie"
    | "loco"
    | "column"
    | "idol"
    | "plank"
    | "shelf"
    | "pallet"
    | "forklift"
    | "tree";
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
  /** Callouts attacking bots walk through on the way to each site. */
  staging?: Record<"A" | "B", string[]>;
}
type Tile = [number, number];
const cell = 5,
  cells = 21;
const center = (i: number) => cell * (i + 0.5);

interface Kit {
  room(x: number, z: number, right: number, bottom: number): void;
  road(...corners: Tile[]): void;
  /** Keeps a non-walkable cell free of generated buildings for a set piece. */
  hold(x: number, z: number): void;
  /** Takes a cell out of a room (e.g. inside a site) and holds it for a set piece. */
  block(x: number, z: number): void;
  /**
   * A thin ground cover (gravel, soil, planks, steel plate) over the main floor. Its material
   * sets footstep sounds and bullet impacts; `top` is the surface height.
   */
  patch(x: number, z: number, w: number, d: number, mat: MaterialId, top?: number): void;
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: MaterialId,
    style?: Box["style"],
  ): void;
  prop(
    tx: number,
    tz: number,
    dx: number,
    dz: number,
    w: number,
    h: number,
    d: number,
    mat: MaterialId,
    style: Box["style"],
  ): void;
  roof(tiles: Tile[], mat: MaterialId, y?: number): void;
  crates(tx: number, tz: number): void;
  doors(tx: number, tz: number): void;
}
interface GridSpec {
  id: GridMapId;
  name: string;
  t: Tile;
  ct: Tile;
  a: Tile;
  b: Tile;
  tRoom: [number, number, number, number];
  ctRoom: [number, number, number, number];
  siteSize?: [number, number];
  floor: MaterialId;
  wall: MaterialId;
  trim: MaterialId;
  height: [number, number];
  layout(k: Kit): void;
  raised: [number, number, number][];
  decorate(k: Kit): void;
  callouts: [string, Tile][];
  staging: Record<"A" | "B", string[]>;
}
const tiles = (x: number, z: number, right: number, bottom: number) => {
  const out: Tile[] = [];
  for (let j = z; j <= bottom; j++)
    for (let i = x; i <= right; i++) out.push([i, j]);
  return out;
};

function gridMap(spec: GridSpec): MapDef {
  const mask = Array.from({ length: cells }, () =>
    Array<boolean>(cells).fill(false),
  );
  const held = mask.map((row) => row.slice());
  const boxes: Box[] = [],
    ramps: Ramp[] = [];
  const box: Kit["box"] = (x, y, z, w, h, d, mat, style) =>
    boxes.push({ x, y, z, w, h, d, mat, style });
  const elevation = mask.map((row) => row.map(() => 0));
  const kit: Kit = {
    room(x, z, right, bottom) {
      for (let j = z; j <= bottom; j++)
        for (let i = x; i <= right; i++) mask[j][i] = true;
    },
    road(...corners) {
      for (let i = 1; i < corners.length; i++) {
        const [x, z] = corners[i - 1],
          [x2, z2] = corners[i];
        kit.room(
          Math.min(x, x2),
          Math.min(z, z2),
          Math.max(x, x2),
          Math.max(z, z2),
        );
      }
    },
    hold(x, z) {
      held[z][x] = true;
    },
    block(x, z) {
      mask[z][x] = false;
      held[z][x] = true;
    },
    patch(x, z, w, d, mat, top = 0.03) {
      box(x, top - 0.03, z, w, 0.06, d, mat, "floor");
    },
    box,
    prop(tx, tz, dx, dz, w, h, d, mat, style) {
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
    },
    roof(list, mat, y = 4.1) {
      for (const [tx, tz] of list)
        if (mask[tz][tx])
          box(center(tx), y, center(tz), cell, 0.55, cell, mat, "roof");
    },
    crates(tx, tz) {
      kit.prop(tx, tz, 1.35, 1.35, 1.55, 1.65, 1.55, "wood", "crate");
      kit.prop(tx, tz, -1.4, 1.4, 1.45, 1.1, 1.55, "wood", "crate");
    },
    doors(tx, tz) {
      kit.prop(tx, tz, -1.55, 0.95, 1.9, 3.3, 0.19, "wood", "door");
      kit.prop(tx, tz, 1.95, 0.95, 1.05, 3.3, 0.2, "wood", "door");
    },
  };
  const { t, ct, a, b } = spec;
  kit.room(...spec.tRoom);
  kit.room(...spec.ctRoom);
  kit.room(a[0] - 2, a[1] - 2, a[0] + 2, a[1] + 2);
  kit.room(b[0] - 2, b[1] - 2, b[0] + 2, b[1] + 2);
  spec.layout(kit);
  box(52.5, -0.24, 52.5, 105, 0.48, 105, spec.floor, "floor");
  const nodes: Node[] = [],
    grid = mask.map((row) => row.map(() => -1));
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
  for (const [x, z, h] of spec.raised) raised(x, z, h);
  // Split buildings at regular intervals so the skyline and each street frontage have individual silhouettes.
  const used = mask.map((row, z) => row.map((v, x) => v || held[z][x]));
  const [low, span] = spec.height;
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
        const h = low + (((x * 37 + z * 17 + x * z * 3) % 47) / 47) * span;
        box(
          (x + w / 2) * cell,
          h / 2,
          (z + d / 2) * cell,
          w * cell,
          h,
          d * cell,
          (x + z) % 4 === 0 ? spec.trim : spec.wall,
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
  spec.decorate(kit);
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
  const called: [string, Tile][] = [
    ...spec.callouts,
    ["A Site", a],
    ["B Site", b],
    ["T Spawn", t],
    ["CT Spawn", ct],
  ];
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
  const [sa, sb] = spec.siteSize ?? [11, 12];
  return {
    id: spec.id,
    name: spec.name,
    width: 105,
    depth: 105,
    boxes,
    ramps,
    nodes,
    callouts,
    staging: spec.staging,
    spawns: { T: spawns(t, 0), CT: spawns(ct, Math.PI) },
    sites: { A: zone(a, sa), B: zone(b, sb) },
    buyZones: { CT: zone(ct, 14), T: zone(t, 14) },
  };
}

const dust2: GridSpec = {
  id: "dust2",
  name: "Dust2",
  t: [10, 18],
  ct: [10, 3],
  a: [17, 4],
  b: [3, 4],
  tRoom: [8, 17, 12, 19],
  ctRoom: [8, 2, 12, 4],
  floor: "sand",
  wall: "sand",
  trim: "stone",
  height: [4.7, 4.6],
  layout(k) {
    const t: Tile = [10, 18],
      ct: Tile = [10, 3],
      a: Tile = [17, 4],
      b: Tile = [3, 4];
    // Left and right lanes have different entrance turns; Mid and Short cross-connect them.
    k.road(
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
    k.room(1, 12, 3, 15);
    k.room(3, 8, 5, 11);
    k.road(
      t,
      [14, 18],
      [14, 16],
      [17, 16],
      [17, 14],
      [19, 14],
      [19, 5],
      [17, 5],
    );
    k.room(18, 7, 19, 13);
    k.room(14, 14, 16, 15);
    // Mid doors now dog-leg east into CT, so Mid no longer looks straight into CT spawn.
    k.road(t, [10, 14], [11, 14], [11, 7], [13, 7], [13, 5]);
    k.room(9, 12, 11, 15);
    k.room(10, 8, 11, 11);
    k.road([11, 12], [13, 12], [13, 9], [15, 9], [15, 6], a);
    k.road(ct, [7, 3], [7, 5], b);
    k.road(ct, [13, 3], [13, 5], a);
    k.road([4, 12], [7, 12], [7, 14], [10, 14]);
    k.road([5, 8], [7, 8], [7, 6], [9, 6]);
  },
  raised: [[17, 4, 1.3]],
  decorate(k) {
    for (const [tx, tz] of [
      [16, 5],
      [18, 3],
      [3, 5],
      [2, 3],
      [10, 13],
    ] as Tile[])
      k.crates(tx, tz);
    for (const [x, z] of [
      [11, 8],
      [7, 5],
      [17, 15],
    ] as Tile[])
      k.doors(x, z);
    k.prop(18, 12, -1.7, 1.45, 2.1, 2.15, 1.42, "metal", "container");
    k.prop(13, 12, 1.2, 1.3, 1.6, 1.3, 1.6, "wood", "crate");
    k.roof(
      [
        [2, 14],
        [2, 13],
        [4, 9],
        [4, 10],
      ],
      "sand",
      4,
    );
  },
  callouts: [
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
  ],
  staging: {
    A: ["Long Doors", "Short A", "Long Doors"],
    B: ["Upper Tunnels"],
  },
};

const mirage: GridSpec = {
  id: "mirage",
  name: "Mirage",
  t: [10, 18],
  ct: [9, 3],
  a: [16, 5],
  b: [4, 5],
  tRoom: [8, 17, 12, 19],
  ctRoom: [8, 2, 12, 4],
  floor: "tile",
  wall: "plaster",
  trim: "stone",
  height: [4.7, 4.6],
  layout(k) {
    const t: Tile = [10, 18],
      ct: Tile = [9, 3],
      a: Tile = [16, 5],
      b: Tile = [4, 5];
    k.road(t, [6, 18], [6, 16], [3, 16], [3, 13], [4, 13], [4, 8], b);
    k.room(2, 13, 4, 15);
    k.room(3, 9, 4, 12);
    k.road(t, [14, 18], [14, 16], [16, 16], [16, 11], [15, 11], [15, 7], a);
    k.road([16, 16], [19, 16], [19, 8], [18, 8], [18, 6], a);
    k.room(18, 11, 19, 14);
    k.road([12, 17], [14, 17], [14, 16]);
    k.room(14, 15, 18, 16);
    k.room(16, 13, 18, 14);
    // Mid ends at Window instead of running into CT spawn; CTs reach it through B Short.
    k.road(t, [10, 15], [9, 15], [9, 12], [10, 12], [10, 7]);
    k.room(9, 6, 10, 7);
    k.room(9, 9, 11, 12);
    k.room(8, 13, 10, 15);
    k.road([10, 10], [13, 10], [13, 7], [15, 7], a);
    k.road([10, 12], [7, 12], [7, 14], [4, 14]);
    k.road([10, 9], [7, 9], [7, 7], [5, 7], b);
    k.road(ct, [7, 3], [7, 5], b);
    k.road([7, 5], [7, 7]);
    k.road(ct, [13, 3], [13, 5], a);
  },
  raised: [
    [16, 5, 1.5],
    [19, 10, 1.85],
  ],
  decorate(k) {
    for (const [tx, tz] of [
      [15, 6],
      [17, 4],
      [4, 6],
      [3, 4],
      [10, 13],
    ] as Tile[])
      k.crates(tx, tz);
    k.roof(
      [
        [3, 14],
        [4, 10],
        [4, 11],
        [13, 9],
        [19, 13],
      ],
      "plaster",
    );
    k.prop(9, 6, 1.35, -1.35, 0.25, 2.3, 1.5, "plaster", "door");
    k.prop(5, 6, 1.4, 1.3, 1.55, 0.7, 1.3, "wood", "bench");
    k.prop(4, 4, -1.35, -1.65, 1.55, 1.9, 2.2, "metal", "container");
  },
  callouts: [
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
  ],
  staging: { A: ["Palace", "Connector", "Palace"], B: ["Apartments"] },
};

/** Industrial plant: indoor sites under a concrete roof, an open yard of silos, and long service corridors. */
const nuke: GridSpec = {
  id: "nuke",
  name: "Nuke",
  t: [10, 18],
  ct: [10, 2],
  a: [15, 6],
  b: [5, 6],
  tRoom: [8, 17, 12, 19],
  ctRoom: [8, 1, 12, 3],
  floor: "concrete",
  wall: "concrete",
  trim: "metal",
  height: [5.2, 4.2],
  layout(k) {
    // Outside: T spawn west into the silo yard, then Secret up the west wall to B.
    k.road([10, 18], [6, 18], [6, 15]);
    k.room(2, 11, 7, 15);
    k.road([2, 11], [2, 6]);
    // Lobby: east exit, then Squeaky and Hut up into the indoor A site.
    k.road([12, 18], [13, 18], [13, 16], [15, 16], [15, 13]);
    k.room(14, 11, 17, 13);
    k.road([14, 11], [14, 9]);
    k.road([17, 11], [17, 9]);
    // Ramp room links Lobby to lower B; Garage joins it from the yard.
    k.road([14, 12], [11, 12], [11, 9], [8, 9], [8, 7]);
    k.road([7, 12], [10, 12]);
    // CT side: A Main, B Main and the Vents crawl that drops into Ramp.
    k.road([12, 2], [14, 2], [14, 3]);
    k.road([8, 2], [5, 2], [5, 3]);
    k.road([10, 4], [10, 6], [11, 6], [11, 8]);
    for (const [x, z] of [
      [3, 10],
      [6, 10],
      [1, 13],
    ] as Tile[])
      k.hold(x, z);
  },
  raised: [
    [15, 6, 1.2],
    [4, 13, 1.5],
  ],
  decorate(k) {
    k.roof(tiles(13, 4, 17, 8), "concrete");
    k.roof(tiles(3, 4, 7, 8), "concrete");
    k.roof(tiles(14, 9, 17, 13), "metal");
    k.roof(
      [
        [8, 7],
        [8, 8],
        [8, 9],
        [9, 9],
        [10, 9],
        [11, 9],
        [11, 10],
        [11, 11],
        [11, 7],
        [11, 8],
        [10, 4],
        [10, 5],
        [10, 6],
        [11, 6],
      ],
      "concrete",
    );
    // Silos stand in held cells along the yard edge.
    for (const [x, z] of [
      [3, 10],
      [6, 10],
      [1, 13],
    ] as Tile[])
      k.prop(x, z, 0, 0, 3.9, 9, 3.9, "metal", "tank");
    k.prop(6, 14, 1.4, 1.4, 1.6, 2.4, 1.6, "metal", "container");
    k.prop(2, 12, -1.6, 0, 1.6, 2.4, 2.6, "metal", "container");
    k.prop(6, 12, 1.4, -1.4, 1.4, 1.2, 1.4, "wood", "crate");
    k.crates(14, 5);
    k.crates(16, 7);
    k.prop(16, 5, 1.4, -1.4, 1.5, 2.1, 1.5, "metal", "container");
    k.crates(4, 7);
    k.prop(6, 5, 1.4, -1.4, 1.7, 1.15, 1.7, "wood", "crate");
    k.prop(3, 5, -1.3, 1.0, 1.3, 2.0, 2.6, "metal", "container");
    k.prop(15, 12, 1.5, 1.5, 1.6, 1.0, 0.8, "concrete", "barrier");
    k.prop(10, 12, 0, -1.6, 2.4, 1.0, 0.8, "concrete", "barrier");
    k.doors(14, 10);
    k.doors(17, 10);
  },
  callouts: [
    ["Yard", [4, 12]],
    ["Secret", [2, 8]],
    ["Garage", [8, 12]],
    ["Lobby", [15, 12]],
    ["Squeaky", [14, 9]],
    ["Hut", [17, 10]],
    ["Ramp", [9, 9]],
    ["Vents", [10, 5]],
    ["B Main", [5, 2]],
    ["A Main", [14, 2]],
    ["Outside", [6, 16]],
  ],
  staging: { A: ["Lobby", "Hut", "Squeaky"], B: ["Ramp", "Secret"] },
};

/** Terracotta village: a winding Banana lane to the fountain site and apartments over the A balcony. */
const inferno: GridSpec = {
  id: "inferno",
  name: "Inferno",
  t: [10, 18],
  ct: [10, 2],
  a: [16, 5],
  b: [4, 5],
  tRoom: [8, 17, 12, 19],
  ctRoom: [8, 1, 12, 3],
  floor: "stone",
  wall: "plaster",
  trim: "stone",
  height: [4.8, 4.4],
  layout(k) {
    // Banana snakes up the west side into B.
    k.road(
      [8, 18],
      [6, 18],
      [6, 16],
      [4, 16],
      [4, 13],
      [3, 13],
      [3, 10],
      [4, 10],
      [4, 8],
    );
    // Apartments climb the east side and spill onto A from the balcony.
    k.road([12, 18], [15, 18], [15, 15], [17, 15], [17, 12], [18, 12], [18, 8]);
    // Mid runs from the T stairs to the Arch; Short splits off to A.
    k.road([13, 18], [13, 13], [11, 13], [11, 10]);
    k.room(10, 9, 12, 11);
    k.road([12, 10], [14, 10], [14, 8]);
    k.road([10, 9], [10, 6], [11, 6], [11, 4]);
    k.road([10, 11], [7, 11], [7, 7]);
    // CT approaches.
    k.road([12, 2], [15, 2]);
    k.road([8, 2], [5, 2]);
  },
  raised: [[16, 5, 1.3]],
  decorate(k) {
    k.roof(
      [
        [15, 15],
        [16, 15],
        [17, 15],
        [17, 14],
        [17, 13],
        [10, 7],
        [3, 11],
        [3, 12],
      ],
      "wood",
    );
    k.prop(3, 3, 1.5, 1.5, 1.8, 0.75, 1.8, "stone", "fountain");
    k.crates(5, 6);
    k.crates(2, 4);
    k.prop(6, 4, 1.3, 0, 1.5, 1.2, 2.2, "wood", "crate");
    k.crates(15, 6);
    k.crates(17, 3);
    k.prop(18, 6, 1.5, 0.5, 1.8, 2.2, 3.4, "metal", "container");
    k.prop(4, 15, 1.35, 0.6, 1.3, 1.2, 2.4, "metal", "container");
    k.prop(3, 11, -1.4, 1.4, 1.2, 1.1, 1.2, "wood", "crate");
    k.prop(13, 15, -1.4, 0, 1.3, 1.25, 1.3, "wood", "crate");
    k.doors(15, 2);
    k.doors(11, 4);
  },
  callouts: [
    ["Banana", [3, 12]],
    ["Car", [4, 15]],
    ["T Ramp", [6, 17]],
    ["Apartments", [16, 15]],
    ["Balcony", [18, 10]],
    ["Mid", [11, 10]],
    ["Short", [14, 9]],
    ["Arch", [10, 7]],
    ["Second Mid", [8, 11]],
    ["Library", [15, 2]],
    ["Construction", [6, 2]],
  ],
  staging: { A: ["Apartments", "Short", "Balcony"], B: ["Banana"] },
};

/** Skyscraper under construction: concrete decks, scaffolding, and a long ramp up to A. */
const vertigo: GridSpec = {
  id: "vertigo",
  name: "Vertigo",
  t: [10, 18],
  ct: [10, 2],
  a: [16, 6],
  b: [4, 6],
  tRoom: [8, 17, 12, 19],
  ctRoom: [8, 1, 12, 3],
  floor: "concrete",
  wall: "concrete",
  trim: "metal",
  height: [4.7, 2.6],
  layout(k) {
    // A Ramp climbs over a hump, then jogs onto the raised A deck.
    k.road([12, 18], [16, 18], [16, 14], [17, 14], [17, 9]);
    // B Stairs go up a second hump and enter B from the south.
    k.road([8, 18], [5, 18], [5, 14], [3, 14], [3, 9]);
    // Mid, Elevators and the two short connectors.
    k.road([5, 14], [8, 14], [8, 11], [11, 11], [11, 10]);
    k.room(10, 8, 12, 10);
    k.road([12, 9], [13, 9], [13, 7]);
    k.road([8, 11], [7, 11], [7, 7]);
    k.road([16, 13], [13, 13], [13, 11], [12, 11]);
    k.road([10, 8], [10, 5], [9, 5], [9, 4]);
    k.road([12, 2], [16, 2], [16, 3]);
    k.road([8, 2], [4, 2], [4, 3]);
  },
  raised: [
    [16, 6, 1.6],
    [16, 16, 1.3],
    [5, 16, 1.2],
  ],
  decorate(k) {
    k.roof(
      [
        [3, 9],
        [3, 10],
        [3, 11],
        [3, 12],
        [14, 13],
        [15, 13],
        [10, 6],
        [10, 7],
      ],
      "concrete",
      4.25,
    );
    k.crates(15, 7);
    k.crates(17, 5);
    k.prop(18, 8, 1.5, 1.4, 1.4, 1.1, 1.6, "concrete", "barrier");
    k.prop(14, 4, -1.4, -1.2, 1.6, 2.2, 2.4, "metal", "container");
    k.crates(3, 7);
    k.crates(5, 5);
    k.prop(2, 5, -1.4, 0.6, 1.1, 1.1, 3, "concrete", "barrier");
    k.prop(11, 9, 1.5, -1.5, 1.4, 1.2, 1.4, "wood", "crate");
    k.prop(8, 13, -1.4, 1.4, 1.2, 2.9, 1.2, "metal", "scaffold");
    k.prop(13, 12, 1.4, 0, 1.2, 2.9, 1.2, "metal", "scaffold");
    k.prop(16, 11, -1.4, 0, 1.4, 1, 2.6, "concrete", "barrier");
  },
  callouts: [
    ["A Ramp", [16, 16]],
    ["B Stairs", [5, 16]],
    ["Mid", [11, 9]],
    ["Elevators", [14, 13]],
    ["A Short", [13, 8]],
    ["Side Halls", [7, 9]],
    ["Tunnel", [3, 11]],
    ["CT Mid", [10, 6]],
    ["Headshot", [17, 11]],
  ],
  staging: { A: ["A Ramp", "Elevators", "A Ramp"], B: ["B Stairs"] },
};

/**
 * Freight yard: two tracks of parked wagons split the middle into lanes that only meet at
 * level crossings. B is a locomotive shed; A is a raised loading dock.
 */
const switchyard: GridSpec = {
  id: "switchyard",
  name: "Switchyard",
  t: [10, 18],
  ct: [10, 2],
  a: [16, 6],
  b: [4, 6],
  tRoom: [8, 17, 12, 19],
  ctRoom: [8, 1, 12, 3],
  floor: "concrete",
  wall: "plaster",
  trim: "metal",
  height: [5, 4.2],
  layout(k) {
    // Sidings leave T spawn on both sides and turn north onto the platform.
    k.road([10, 18], [5, 18], [5, 14]);
    k.road([10, 18], [15, 18], [15, 14]);
    k.road([4, 14], [16, 14]);
    // Yard lanes either side of the two tracks, crossed only at level crossings.
    k.road([3, 12], [17, 12]);
    k.road([3, 10], [17, 10]);
    for (const x of [7, 13]) k.room(x, 13, x, 13);
    for (const x of [4, 10, 16]) k.room(x, 11, x, 11);
    for (let x = 2; x <= 18; x++) {
      k.hold(x, 13);
      k.hold(x, 11);
    }
    // North yard into both sites, and the signal-box cut to A.
    k.road([4, 10], [4, 9]);
    k.road([16, 10], [16, 9]);
    k.road([13, 10], [13, 7]);
    k.hold(12, 9);
    k.hold(12, 8);
    // CT side: gates to each site and the underpass to the north yard.
    k.road([12, 2], [16, 2], [16, 4]);
    k.road([8, 2], [4, 2], [4, 4]);
    k.road([10, 4], [10, 6], [9, 6], [9, 9], [10, 9], [10, 10]);
    // The shed's west bay holds the locomotive.
    for (const z of [5, 6, 7]) k.block(2, z);
  },
  raised: [[16, 6, 1.2]],
  decorate(k) {
    // Ballast under both tracks, wooden decking at the crossings, pavers on the platform.
    k.patch(52.5, 57.5, 85, 4.6, "dirt");
    k.patch(52.5, 67.5, 85, 4.6, "dirt");
    for (const x of [7, 13]) k.patch(center(x), 67.5, 4.6, 4.6, "wood", 0.05);
    for (const x of [4, 10, 16]) k.patch(center(x), 57.5, 4.6, 4.6, "wood", 0.05);
    k.patch(52.5, 72.5, 65, 4.8, "stone");
    k.roof(tiles(2, 4, 6, 8), "metal", 4.6);
    k.box(12.5, 4.6, 32.5, 5, 0.55, 15, "metal", "roof");
    k.roof(
      [
        [9, 6],
        [9, 7],
        [9, 8],
        [9, 9],
        [10, 5],
        [10, 6],
      ],
      "concrete",
      3.7,
    );
    // Wagons: a body on two bogies, with a gap underneath to catch feet.
    const car = (x0: number, x1: number, z: number, style: Box["style"]) => {
      k.box((x0 + x1) / 2, 2.55, z, x1 - x0, 3.1, 2.9, "metal", style);
      for (const end of [x0 + 1.9, x1 - 1.9])
        k.box(end, 0.5, z, 2.6, 1, 2.2, "metal", "bogie");
    };
    car(10.2, 22.4, 67.5, "railcar");
    car(22.8, 34.8, 67.5, "railcar");
    car(40.2, 51.6, 67.5, "railcar");
    // A shoulder-width gap between these two lets a player squeeze through.
    car(53, 64.8, 67.5, "railcar");
    car(70.2, 82.3, 67.5, "tanker");
    car(82.7, 94.8, 67.5, "railcar");
    car(10.2, 19.8, 57.5, "tanker");
    car(25.2, 37.3, 57.5, "railcar");
    car(37.7, 49.8, 57.5, "railcar");
    car(55.2, 67.3, 57.5, "railcar");
    car(67.7, 79.8, 57.5, "tanker");
    car(85.2, 94.8, 57.5, "railcar");
    // Shunting locomotive parked in the shed.
    k.box(12.5, 2.3, 32.5, 3, 3.6, 13.4, "metal", "loco");
    // Signal box: a hollow timber hut, so a shot goes clean through both walls.
    const hut = { x: 62.5, z: 47.5 };
    k.box(hut.x, 1.5, hut.z - 1.73, 3.6, 3, 0.14, "wood", "plank");
    k.box(hut.x, 1.5, hut.z + 1.73, 3.6, 3, 0.14, "wood", "plank");
    k.box(hut.x - 1.73, 1.5, hut.z, 0.14, 3, 3.32, "wood", "plank");
    k.box(hut.x + 1.73, 1.5, hut.z, 0.14, 3, 3.32, "wood", "plank");
    k.box(hut.x, 3.1, hut.z, 4.1, 0.2, 4.1, "wood", "roof");
    k.prop(12, 8, 0, 0, 3.2, 1.1, 2.4, "wood", "pallet");
    // Shed: plank partitions, a workbench and spare wheelsets.
    k.prop(5, 4, 1.5, -1.5, 1.7, 2.3, 0.16, "wood", "plank");
    k.prop(6, 7, 1.5, 1.5, 0.16, 2.3, 1.7, "wood", "plank");
    k.prop(4, 8, -1.55, 1.5, 1.6, 1.0, 0.9, "wood", "crate");
    k.crates(6, 5);
    k.prop(3, 8, 1.5, 1.4, 1.5, 1.2, 1.5, "wood", "pallet");
    // Dock: crates, a fence and pallets of goods waiting to load.
    k.crates(15, 5);
    k.crates(17, 7);
    k.prop(17, 4, 1.5, -1.5, 1.6, 1.4, 1.6, "cardboard", "pallet");
    k.prop(14, 7, -1.5, 1.5, 1.7, 2.2, 0.14, "wood", "plank");
    k.prop(18, 5, 1.5, 1.5, 0.14, 2.2, 1.7, "wood", "plank");
    // Cover along the lanes and the platform.
    k.prop(6, 12, 1.5, 1.55, 1.6, 1.2, 1.6, "wood", "crate");
    k.prop(11, 12, -1.5, -1.55, 1.6, 1.1, 1.6, "concrete", "barrier");
    k.prop(15, 12, 1.5, 1.55, 1.6, 1.3, 1.6, "cardboard", "pallet");
    k.prop(8, 10, -1.5, -1.55, 1.6, 1.1, 1.6, "concrete", "barrier");
    k.prop(14, 10, 1.5, -1.55, 1.6, 1.5, 1.6, "wood", "crate");
    k.prop(5, 10, -1.5, 1.55, 1.6, 1.2, 1.6, "wood", "pallet");
    k.prop(8, 14, 1.4, 1.5, 1.8, 0.9, 0.7, "wood", "bench");
    k.prop(12, 14, -1.4, 1.5, 1.8, 0.9, 0.7, "wood", "bench");
    k.prop(10, 14, 0, 1.55, 1.5, 1.6, 1.4, "cardboard", "pallet");
    k.prop(5, 16, 1.5, 1.5, 1.6, 1.6, 1.6, "wood", "crate");
    k.prop(15, 17, -1.5, -1.5, 1.6, 1.2, 1.6, "metal", "container");
    k.doors(4, 9);
    k.doors(10, 5);
  },
  callouts: [
    ["Platform", [10, 14]],
    ["Yard", [10, 12]],
    ["North Yard", [7, 10]],
    ["Underpass", [9, 8]],
    ["Signal Box", [13, 8]],
    ["West Sidings", [5, 16]],
    ["East Sidings", [15, 16]],
    ["Shed Doors", [4, 9]],
    ["Dock Ramp", [16, 9]],
    ["A Gate", [16, 3]],
    ["B Gate", [4, 3]],
  ],
  staging: {
    A: ["East Sidings", "Platform", "East Sidings"],
    B: ["West Sidings", "Platform"],
  },
};

/**
 * Overgrown temple ruins: a flooded cave to B, stone stairs to the raised A sanctum, and a
 * narrow mid with jungle trees growing through the old courtyards.
 */
const canopy: GridSpec = {
  id: "canopy",
  name: "Canopy",
  t: [10, 18],
  ct: [10, 2],
  a: [15, 5],
  b: [5, 6],
  tRoom: [8, 17, 12, 19],
  ctRoom: [8, 1, 12, 3],
  floor: "stone",
  wall: "stone",
  trim: "stone",
  height: [5.6, 4.4],
  layout(k) {
    // West: through the cave to B Main.
    k.road([8, 18], [3, 18], [3, 11], [4, 11], [4, 9]);
    // East: the long temple stairs up to A Main.
    k.road([12, 18], [17, 18], [17, 10], [16, 10], [16, 8]);
    // Mid leaves T spawn's north gate, then splits to Donut (A) and Elbow (B).
    k.road([9, 17], [9, 14], [7, 14], [7, 12], [11, 12]);
    k.road([11, 12], [11, 10], [13, 10], [13, 8]);
    k.road([7, 12], [6, 12], [6, 10], [7, 10], [7, 9]);
    // CT side.
    k.road([12, 2], [14, 2], [14, 3]);
    k.road([8, 2], [5, 2], [5, 4]);
    k.road([10, 4], [10, 6], [9, 6], [9, 9], [10, 9], [10, 11]);
    for (const [x, z] of [
      [5, 11],
      [8, 10],
      [12, 8],
      [16, 12],
      [16, 15],
      [2, 17],
    ] as Tile[])
      k.hold(x, z);
  },
  raised: [
    [15, 5, 1.4],
    [17, 14, 1.2],
  ],
  decorate(k) {
    // Jungle soil on the paths, worn flagstones in the sites and courtyards.
    k.patch(center(3), 72.5, 4.8, 34.8, "dirt");
    k.patch(32.5, center(18), 24.8, 4.8, "dirt");
    k.patch(center(17), 85, 4.8, 19.8, "dirt");
    k.patch(center(17), 55, 4.8, 9.8, "dirt");
    k.patch(center(9), 77.5, 4.8, 14.8, "dirt");
    k.patch(center(6), 55, 4.8, 9.8, "dirt");
    k.roof(
      [
        [3, 12],
        [3, 13],
        [3, 14],
        [3, 15],
        [3, 16],
      ],
      "stone",
      3.8,
    );
    k.roof(
      [
        [9, 6],
        [9, 7],
        [9, 8],
        [10, 5],
        [10, 6],
      ],
      "stone",
      4,
    );
    // Trees grow in the held cells beside the paths.
    for (const [x, z] of [
      [5, 11],
      [8, 10],
      [12, 8],
      [16, 12],
      [16, 15],
      [2, 17],
    ] as Tile[])
      k.prop(x, z, 0, 0, 1.3, 9, 1.3, "wood", "tree");
    // Sanctum: columns at the corners, a carved idol, and old offerings.
    for (const [x, z, dx, dz, h] of [
      [13, 4, -1.5, -1.5, 3.8],
      [17, 4, 1.5, -1.5, 2.1],
      [13, 6, -1.5, 1.5, 1.6],
      [17, 6, 1.5, 1.5, 3.8],
    ] as const)
      k.prop(x, z, dx, dz, 1.15, h, 1.15, "stone", "column");
    k.prop(16, 3, 1.4, -1.4, 1.6, 2.6, 1.6, "stone", "idol");
    k.crates(14, 7);
    k.prop(16, 7, 1.5, 1.5, 1.7, 2.1, 0.16, "wood", "plank");
    k.prop(16, 9, 1.5, -1.5, 0.16, 2.1, 1.7, "wood", "plank");
    // B: broken columns around the flooded courtyard and a timber scaffold.
    k.prop(3, 4, -1.5, -1.5, 1.15, 3.8, 1.15, "stone", "column");
    k.prop(7, 4, 1.5, -1.5, 1.15, 1.4, 1.15, "stone", "column");
    k.prop(3, 8, -1.5, 1.5, 1.15, 2.4, 1.15, "stone", "column");
    k.prop(4, 5, 1.5, 1.5, 1.6, 1.0, 1.6, "stone", "barrier");
    k.prop(6, 7, -1.5, -1.5, 1.7, 2.2, 0.16, "wood", "plank");
    k.prop(7, 7, 1.5, 1.5, 1.6, 1.5, 1.6, "wood", "crate");
    k.prop(5, 3, 1.4, -1.4, 1.5, 2.4, 1.5, "stone", "idol");
    // Mid and the side paths.
    k.prop(9, 15, 1.5, -1.5, 1.6, 1.2, 1.6, "stone", "barrier");
    k.prop(8, 12, -1.5, 1.5, 1.15, 2.6, 1.15, "stone", "column");
    k.prop(11, 11, 1.5, 1.5, 1.6, 1.3, 1.6, "wood", "crate");
    k.prop(13, 9, 1.5, -1.5, 1.7, 2.2, 0.16, "wood", "plank");
    k.prop(6, 10, -1.5, -1.5, 1.6, 1.1, 1.6, "stone", "barrier");
    k.prop(17, 11, 1.5, 1.5, 1.6, 1.4, 1.6, "wood", "crate");
    k.prop(3, 17, -1.5, -1.5, 1.15, 3.2, 1.15, "stone", "column");
    k.prop(17, 17, 1.5, 1.5, 1.15, 2.2, 1.15, "stone", "column");
    k.prop(10, 4, 1.5, 1.5, 1.6, 1.0, 1.6, "stone", "barrier");
  },
  callouts: [
    ["Cave", [3, 14]],
    ["Temple Stairs", [17, 14]],
    ["A Main", [17, 11]],
    ["Mid", [9, 12]],
    ["Donut", [12, 10]],
    ["Elbow", [6, 11]],
    ["House", [9, 7]],
    ["B Main", [4, 10]],
    ["Lookout", [14, 2]],
    ["Ruins", [5, 3]],
    ["Jungle", [5, 18]],
  ],
  staging: {
    A: ["Temple Stairs", "Donut", "Temple Stairs"],
    B: ["Cave", "Elbow"],
  },
};

/**
 * Steel works: a container yard at B, a racked warehouse at A, and a covered vent run linking
 * mid to the A floor.
 */
const foundry: GridSpec = {
  id: "foundry",
  name: "Foundry",
  t: [10, 18],
  ct: [10, 2],
  a: [15, 5],
  b: [5, 6],
  tRoom: [8, 17, 12, 19],
  ctRoom: [8, 1, 12, 3],
  floor: "concrete",
  wall: "concrete",
  trim: "metal",
  height: [5.6, 3.6],
  layout(k) {
    // East: the loading street to A Main.
    k.road([12, 18], [16, 18], [16, 14], [17, 14], [17, 9], [16, 9], [16, 8]);
    // West: through the scrap yard to B Main.
    k.road([8, 18], [4, 18], [4, 15], [2, 15], [2, 10], [3, 10], [3, 9]);
    // Mid: Highway, the Vents to A, and the Z connector to B.
    k.road([11, 17], [11, 14], [9, 14], [9, 12], [12, 12]);
    k.road([12, 12], [13, 12], [13, 9], [14, 9], [14, 8]);
    k.road([9, 12], [6, 12], [6, 10], [5, 10], [5, 9]);
    // CT side.
    k.road([12, 2], [15, 2], [15, 3]);
    k.road([8, 2], [5, 2], [5, 4]);
    k.road([10, 4], [10, 7], [11, 7], [11, 9], [10, 9], [10, 11]);
    // Container stacks in the B yard and the foreman's office on A.
    for (const [x, z] of [
      [3, 5],
      [3, 6],
      [7, 7],
      [17, 4],
      [17, 5],
    ] as Tile[])
      k.block(x, z);
    k.hold(15, 17);
    k.hold(6, 17);
  },
  raised: [[2, 12, 1.3]],
  decorate(k) {
    k.roof(tiles(13, 3, 17, 7), "metal", 4.8);
    k.roof(
      [
        [13, 9],
        [13, 10],
        [13, 11],
        [14, 9],
      ],
      "metal",
      3.6,
    );
    k.roof(
      [
        [10, 7],
        [11, 7],
        [11, 8],
        [11, 9],
      ],
      "concrete",
      3.6,
    );
    // Steel deck plates in the vents and the warehouse aisles; grit in the scrap yard.
    k.patch(center(13), 52.5, 4.8, 14.8, "metal");
    k.patch(center(14), center(9), 4.8, 4.8, "metal");
    k.patch(center(2), 62.5, 4.8, 24.8, "dirt");
    k.patch(center(3), center(15), 14.8, 4.8, "dirt");
    // Shipping containers: a two-high stack and a single.
    k.box(17.5, 1.3, 30, 2.44, 2.6, 9.4, "metal", "container");
    k.box(17.5, 3.9, 28.4, 2.44, 2.6, 6.06, "metal", "container");
    k.box(37.5, 1.3, 37.5, 4.7, 2.6, 2.44, "metal", "container");
    // Office: thin partitions you can shoot through, with a window strip.
    const o = { x: 87.5, z: 25 };
    k.box(o.x - 2.2, 1.4, o.z, 0.12, 2.8, 9.6, "plaster", "plank");
    k.box(o.x, 1.4, o.z - 4.75, 4.4, 2.8, 0.12, "plaster", "plank");
    k.box(o.x, 1.4, o.z + 4.75, 4.4, 2.8, 0.12, "plaster", "plank");
    k.box(o.x, 2.95, o.z, 4.6, 0.3, 9.8, "metal", "roof");
    // Warehouse racking in the corners of the A floor.
    for (const [x, z, dx, dz] of [
      [13, 3, -1.5, -1.5],
      [15, 3, -1.5, -1.5],
      [13, 7, -1.5, 1.5],
      [15, 7, 1.5, 1.5],
      [14, 5, 1.5, 1.5],
    ] as const)
      k.prop(x, z, dx, dz, 1.8, 3.2, 1.1, "metal", "shelf");
    k.prop(16, 6, 1.5, -1.5, 1.6, 1.5, 1.6, "cardboard", "pallet");
    k.crates(14, 4);
    k.prop(16, 8, -1.5, 1.5, 1.6, 1.3, 1.6, "wood", "crate");
    // B yard: forklift, pallets and drums.
    k.prop(4, 7, 1.5, -1.4, 1.3, 2.3, 1.8, "metal", "forklift");
    k.prop(6, 5, 1.5, -1.5, 1.6, 1.3, 1.6, "wood", "pallet");
    k.prop(5, 8, -1.5, 1.5, 1.6, 1.6, 1.6, "wood", "crate");
    k.prop(7, 4, 1.5, -1.5, 1.7, 2.2, 0.14, "wood", "plank");
    k.prop(6, 8, 1.5, 1.5, 1.4, 1.1, 1.4, "metal", "tank");
    // Mid and the approaches.
    k.prop(10, 12, 1.5, 1.5, 1.6, 1.1, 1.4, "concrete", "barrier");
    k.prop(7, 12, -1.5, 1.5, 1.6, 1.4, 1.6, "wood", "crate");
    k.prop(12, 12, 1.5, 1.5, 1.6, 1.2, 1.6, "cardboard", "pallet");
    k.prop(9, 13, 1.5, 1.5, 1.6, 2.2, 0.14, "wood", "plank");
    k.prop(17, 12, 1.5, -1.5, 1.6, 2.4, 1.6, "metal", "container");
    k.prop(16, 16, 1.5, 1.5, 1.6, 1.2, 1.6, "wood", "crate");
    k.prop(3, 15, -1.5, -1.5, 1.6, 1.3, 1.6, "metal", "tank");
    k.prop(2, 14, -1.5, 1.5, 1.6, 1.0, 1.6, "wood", "pallet");
    k.prop(15, 17, 0, 0, 4.2, 2.6, 2.44, "metal", "container");
    k.prop(6, 17, 0, 0, 3.2, 1.4, 3.2, "wood", "pallet");
    k.prop(10, 5, -1.5, 1.5, 1.6, 1.1, 1.6, "concrete", "barrier");
    k.doors(17, 9);
    k.doors(13, 9);
  },
  callouts: [
    ["Highway", [9, 12]],
    ["Vents", [13, 10]],
    ["Z Connector", [6, 11]],
    ["A Main", [17, 11]],
    ["Loading Street", [14, 18]],
    ["Scrap Yard", [2, 13]],
    ["B Main", [3, 10]],
    ["Checkers", [11, 8]],
    ["A Office", [16, 4]],
    ["Forklift", [4, 7]],
    ["CT Ramp", [15, 2]],
  ],
  staging: {
    A: ["Loading Street", "Vents", "A Main"],
    B: ["Scrap Yard", "Z Connector"],
  },
};

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
  dust2: gridMap(dust2),
  mirage: gridMap(mirage),
  nuke: gridMap(nuke),
  inferno: gridMap(inferno),
  vertigo: gridMap(vertigo),
  switchyard: gridMap(switchyard),
  canopy: gridMap(canopy),
  foundry: gridMap(foundry),
  range: firingRange(),
};

/** The material a foot at `y` stands on: the highest surface under (x, z) at or just below it. */
export function floorAt(map: MapDef, x: number, y: number, z: number): MaterialId {
  let best: MaterialId = map.boxes[0]?.mat ?? "concrete",
    top = -Infinity;
  for (const b of map.boxes) {
    if (Math.abs(x - b.x) > b.w / 2 || Math.abs(z - b.z) > b.d / 2) continue;
    const t = b.y + b.h / 2;
    if (t <= y + 0.15 && t > top) {
      top = t;
      best = b.mat;
    }
  }
  for (const r of map.ramps) {
    if (Math.abs(x - r.x) > r.w / 2 || Math.abs(z - r.z) > r.d / 2) continue;
    // A ramp's surface rises from its base to `h`; any foot within that band is on it.
    if (y >= r.y - 0.15 && y <= r.y + r.h + 0.15 && r.y + r.h >= top) {
      top = r.y + r.h;
      best = r.mat;
    }
  }
  return best;
}
