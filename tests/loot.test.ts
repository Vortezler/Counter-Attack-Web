import { beforeAll, afterEach, it, expect } from "vitest";
import { Sim } from "../src/sim/Sim";
import { initPhysics } from "../src/sim/Physics";
import { maps } from "../src/world";
import { idle, type PlayerCommand } from "../src/sim/player";
import { magazine } from "../src/config/weapons";
beforeAll(initPhysics);
let sim: Sim | undefined;
afterEach(() => sim?.dispose());
function fixture() {
  const s = (sim = new Sim(maps.dust2, "T", "normal", "Test", 178));
  s.phase = "live";
  s.left = 100;
  return s;
}
function place(s: Sim, id: number, where: { x: number; y: number; z: number }) {
  const p = s.players[id];
  Object.assign(p, { x: where.x, y: where.y, z: where.z });
  s.physics.place(p.body, p, p.yaw);
  s.physics.world.step();
}
function step(s: Sim, cmd: Partial<PlayerCommand> = {}, n = 1) {
  for (let i = 0; i < n; i++)
    s.step(Object.fromEntries(s.players.map((p) => [p.id, p.id === 0 ? { ...idle(p.yaw), ...cmd } : idle(p.yaw)])));
}

it("a dead player drops every gun, grenade and the kit around the body", () => {
  const s = fixture(),
    v = s.players[5];
  v.primary = magazine("m4a4");
  v.primary.ammo = 17;
  v.he = 1;
  v.flash = 2;
  v.kit = true;
  s.hurt(v, 200, s.players[1], "ak");
  const items = s.drops.map((d) => d.item).sort();
  expect(items).toEqual(["flash", "flash", "he", "kit", "m4a4", v.pistol.id].sort());
  expect(s.drops.find((d) => d.item === "m4a4")?.ammo).toBe(17);
  for (const d of s.drops) {
    expect(Math.hypot(d.x - v.x, d.z - v.z)).toBeLessThan(0.8);
    expect(Math.abs(d.y - v.y)).toBeLessThan(0.3);
  }
  expect(v.primary).toBeNull();
  expect(v.kit).toBe(false);
});

it("walking over loot takes what fits; use swaps the gun on the ground for the held one", () => {
  const s = fixture(),
    me = s.me,
    v = s.players[6];
  v.primary = magazine("m4a4");
  v.smoke = 1;
  place(s, 6, { ...s.map.spawns.T[1] });
  s.hurt(v, 200, null, "bomb");
  me.primary = null;
  me.smoke = 0;
  place(s, 0, { x: v.x, y: v.y, z: v.z });
  step(s);
  // Empty primary slot and room for a smoke: both picked up on contact.
  expect(me.primary?.id).toBe("m4a4");
  expect(me.smoke).toBe(1);
  // The dead player's pistol stays: everyone already has one, so it needs a deliberate swap.
  const pistol = s.drops.find((d) => d.item === v.pistol.id)!;
  expect(pistol).toBeTruthy();
  me.pistol = magazine("deagle");
  me.weapon = "deagle";
  place(s, 0, { x: pistol.x, y: pistol.y, z: pistol.z });
  step(s, {}, 2);
  expect(me.pistol.id).toBe("deagle");
  step(s, { use: true });
  expect(me.pistol.id).toBe(v.pistol.id);
  expect(me.weapon).toBe(v.pistol.id);
  expect(s.drops.some((d) => d.item === "deagle")).toBe(true);
  // Holding use does not swap back and forth.
  step(s, { use: true }, 5);
  expect(me.pistol.id).toBe(v.pistol.id);
});

it("plants the C4 on the floor in front of the planter, who cannot move while planting", () => {
  const s = fixture(),
    a = s.map.sites.A,
    me = s.me;
  s.carrier = 0;
  place(s, 0, a);
  me.yaw = 0;
  const start = { x: me.x, z: me.z };
  step(s, { use: true, moveZ: 1 }, 206);
  expect(s.phase).toBe("planted");
  // Only the first tick, before the plant begins, moves at all (3.2 s of walking would be ~8 m).
  expect(Math.hypot(me.x - start.x, me.z - start.z)).toBeLessThan(0.1);
  // Facing -z: the bomb lies ahead of the feet, unless a wall was closer.
  expect(s.bomb!.z).toBeLessThanOrEqual(me.z + 0.001);
  expect(Math.abs(s.bomb!.y - 0.1 - me.y)).toBeLessThan(0.3);
});
