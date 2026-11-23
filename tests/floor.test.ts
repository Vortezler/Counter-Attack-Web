import { it, expect } from "vitest";
import { floorAt, maps } from "../src/world";

const ground = { dust2: "sand", mirage: "tile", nuke: "concrete", inferno: "stone", vertigo: "concrete" } as const;

it.each(Object.keys(ground) as (keyof typeof ground)[])("%s: footsteps at spawn land on the map's ground material", (id) => {
  const map = maps[id];
  for (const team of ["T", "CT"] as const)
    for (const s of map.spawns[team]) expect(floorAt(map, s.x, 0, s.z)).toBe(ground[id]);
});

it("a foot on top of a crate stands on the crate, not the ground below it", () => {
  const map = maps.dust2,
    crate = map.boxes.find((b) => b.style === "crate" && b.y - b.h / 2 < 0.1)!;
  const top = crate.y + crate.h / 2;
  expect(floorAt(map, crate.x, top, crate.z)).toBe(crate.mat);
  // Standing beside it, at ground level, is still sand.
  expect(floorAt(map, crate.x + crate.w / 2 + 0.3, 0, crate.z)).toBe("sand");
});
