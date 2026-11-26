import { beforeAll, afterEach, it, expect } from "vitest";
import { Sim } from "../src/sim/Sim";
import { initPhysics } from "../src/sim/Physics";
import { maps } from "../src/world";
import { idle } from "../src/sim/player";
import { path, nearest } from "../src/sim/rules";
import { magazine } from "../src/config/weapons";
beforeAll(initPhysics);
let sim: Sim | undefined;
afterEach(() => sim?.dispose());

function place(s: Sim, id: number, where: { x: number; y: number; z: number }) {
  const p = s.players[id];
  Object.assign(p, { x: where.x, y: where.y, z: where.z });
  s.physics.place(p.body, p, p.yaw);
  s.physics.world.step();
}
/** Player 0 (idle human) and bot 5 alone on open ground at the T spawn, `gap` metres apart. */
function duel(gap: number) {
  const s = (sim = new Sim(maps.sandgate, "T", "normal", "Test", 178));
  s.phase = "live";
  s.left = 100;
  const spawn = s.map.spawns.T[0];
  place(s, 0, { ...spawn });
  place(s, 5, { ...spawn, z: spawn.z - gap });
  for (const p of s.players) if (p.id !== 0 && p.id !== 5) s.hurt(p, 200, null, "bomb");
  s.players[5].primary = magazine("ak");
  s.players[5].weapon = "ak";
  return s;
}
const human = (s: Sim, n: number) => {
  for (let i = 0; i < n; i++) s.step({ 0: idle(s.me.yaw, s.me.pitch) });
};

it("bots heading for the same place take different routes", () => {
  const map = maps.sandgate,
    from = nearest(map.nodes, map.spawns.T[0].x, map.spawns.T[0].z),
    to = nearest(map.nodes, map.sites.A.x, map.sites.A.z),
    routes = new Set([1, 2, 3, 4, 5].map((id) => path(map.nodes, from, to, id * 7919 + 104729 + 1).join()));
  expect(routes.size).toBeGreaterThan(1);
  // Unseeded routing is unchanged: the plain shortest path.
  expect(path(map.nodes, from, to).length).toBeGreaterThan(1);
});

it("a bot shot from behind turns on its attacker and fights back", () => {
  const s = duel(18),
    bot = s.players[5];
  // Forward is (sin yaw, -cos yaw): yaw 0 faces -z, its back to the player at +z.
  bot.yaw = 0;
  s.me.yaw = 0;
  // The bot will shoot back; keep the target alive so it stays the target.
  s.me.hp = 100000;
  human(s, 4);
  expect(bot.target).toBe(-1);
  s.hurt(bot, 8, s.me, "glock");
  const fired = bot.lastFire;
  human(s, 64 * 2);
  expect(bot.target).toBe(0);
  expect(bot.lastFire).toBeGreaterThan(fired);
});

it("bots keep moving while they shoot instead of standing still", () => {
  const s = duel(22),
    bot = s.players[5];
  bot.yaw = Math.PI;
  s.me.hp = 100000;
  const start = { x: bot.x, z: bot.z },
    shots: number[] = [];
  s.onEvent((e) => e.type === "shot" && e.actor === 5 && shots.push(s.time));
  let travelled = 0,
    last = { x: bot.x, z: bot.z };
  for (let i = 0; i < 64 * 4; i++) {
    human(s, 1);
    travelled += Math.hypot(bot.x - last.x, bot.z - last.z);
    last = { x: bot.x, z: bot.z };
  }
  expect(shots.length).toBeGreaterThan(5);
  expect(travelled).toBeGreaterThan(2);
  // A rifle at 22 m pushes in toward the comfortable 14 m range.
  expect(Math.hypot(bot.x - s.me.x, bot.z - s.me.z)).toBeLessThan(Math.hypot(start.x - s.me.x, start.z - s.me.z));
});
