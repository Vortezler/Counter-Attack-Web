import { afterEach, beforeAll, expect, it } from "vitest";
import { initPhysics } from "../src/sim/Physics";
import { Sim, type SimEvent } from "../src/sim/Sim";
import { maps, type MapDef } from "../src/world";
import { idle } from "../src/sim/player";
import { DT } from "../src/sim/rules";
beforeAll(initPhysics);
let game: Sim;
afterEach(() => game.dispose());
function range(walls: number[] = [], material: "wood" | "concrete" = "wood") {
  const map: MapDef = {
    ...maps.range,
    boxes: [
      maps.range.boxes[0],
      ...walls.map((thickness, i) => ({
        x: 25,
        y: 1.4,
        z: 31 - i * 1.1,
        w: 3,
        h: 2.8,
        d: thickness * 0.0254,
        mat: material,
      })),
    ],
  };
  game = new Sim(map, "CT", "normal", "Tester", 9);
  for (const [i, p] of game.players.entries()) {
    p.x = i < 2 ? 25 : 6 * i;
    p.y = 0.02;
    p.z = i === 0 ? 34 : 23;
    game.physics.place(p.body, p, 0);
  }
  game.physics.world.step();
  const events: SimEvent[] = [];
  game.onEvent((e) => events.push(e));
  return { s: game, p: game.me, target: game.players[1], events };
}
it.each([
  [1, true],
  [4, true],
  [5, false],
] as const)(
  "handles %i thin walls and limits penetration to four",
  (walls, hit) => {
    const { s, p, target, events } = range(Array(walls).fill(2));
    s.buy(p, "m4");
    for (let i = 0; i < 64; i++) s.step();
    const pitch = Math.atan2(target.y + 1.27 - p.eye.y, p.z - target.z);
    s.step({ 0: { ...idle(0, pitch), fire: true } });
    expect(
      events.some(
        (e) =>
          e.type === "hit" && e.actor === 0 && e.victim === 1 && e.wallbang,
      ),
    ).toBe(hit);
  },
);
it("thick concrete shields range targets", () => {
  const { s, p, target } = range([64], "concrete");
  s.buy(p, "awp");
  for (let i = 0; i < 60; i++) s.step();
  s.step({ 0: { ...idle(0, -0.03), alt: true } });
  s.step({ 0: { ...idle(0, -0.03), fire: true } });
  expect(target.hp).toBe(100);
  expect(p.scoped).toBe(0);
});
it("requires grenade windup and release and simulates gravity, bounce and detonation", () => {
  const { s, p, events } = range();
  s.buy(p, "he");
  s.switch(p, 4);
  for (let i = 0; i < 52; i++) s.step();
  for (let i = 0; i < 25; i++) s.step({ 0: { ...idle(0, -0.5), fire: true } });
  expect(s.grenades.length).toBe(0);
  s.step();
  expect(s.grenades.length).toBe(1);
  expect(p.he).toBe(0);
  expect(p.weapon).toBe("glock");
  for (let i = 0; i < 110; i++) s.step();
  expect(s.grenades.length).toBe(0);
  expect(events.some((e) => e.type === "bounce")).toBe(true);
  expect(events.some((e) => e.type === "explosion")).toBe(true);
});
it("scales flashes by facing and occlusion", () => {
  const { s, p, target } = range();
  p.flash = 1;
  s.throwGrenade(p, "flash", 0);
  const g = s.grenades[0];
  g.body.setTranslation({ x: 25, y: 1.4, z: 26 }, true);
  g.expires = 0;
  target.z = 25;
  target.yaw = Math.PI;
  const back = s.players[2];
  back.x = 25;
  back.z = 25;
  back.yaw = 0;
  s.stepGrenades();
  expect(target.blindDuration).toBeGreaterThan(4);
  expect(back.blindDuration).toBeLessThan(2);
});
it("moves, crouches, jumps and lands in the Rapier world", () => {
  const { s, p } = range();
  for (let i = 0; i < 64; i++) s.step({ 0: { ...idle(), moveX: 1 } });
  expect(p.x).toBeGreaterThan(29);
  for (let i = 0; i < 32; i++) s.step({ 0: { ...idle(), crouch: true } });
  expect(p.crouched).toBe(true);
  expect(p.eye.y - p.y).toBeCloseTo(1.17);
  s.step({ 0: { ...idle(), jump: true } });
  let peak = p.y;
  for (let i = 0; i < 2 / DT; i++) {
    s.step();
    peak = Math.max(peak, p.y);
  }
  expect(peak).toBeGreaterThan(1.28);
  expect(peak).toBeLessThan(1.55);
  expect(p.ground).toBe(true);
});
