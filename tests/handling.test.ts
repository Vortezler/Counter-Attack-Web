import { beforeAll, afterEach, it, expect } from "vitest";
import { Sim, shellTime } from "../src/sim/Sim";
import { initPhysics } from "../src/sim/Physics";
import { maps } from "../src/world";
import { idle, type PlayerCommand } from "../src/sim/player";
import { magazine, catalog } from "../src/config/weapons";
import { falloff } from "../src/audio";
beforeAll(initPhysics);
let sim: Sim | undefined;
afterEach(() => {
  sim?.dispose();
  sim = undefined;
});
function armed(gun: "ak" | "nova") {
  const s = (sim = new Sim(maps.sandgate, "T", "normal", "Test", 178));
  s.phase = "live";
  s.left = 100;
  // One defender stays alive (and idle, as a "remote" player) so the round does not end.
  s.remotePlayer = 5;
  for (const p of s.players) if (p.id && p.id !== 5) s.hurt(p, 200, null, "bomb");
  s.me.primary = magazine(gun);
  s.me.weapon = gun;
  s.me.drawEnd = 0;
  return s;
}
const tick = (s: Sim, cmd: Partial<PlayerCommand> = {}, n = 1) => {
  for (let i = 0; i < n; i++) s.step({ 0: { ...idle(s.me.yaw, s.me.pitch), ...cmd } });
};

it("recoil starts springing back the moment the trigger is released", () => {
  const s = armed("ak"),
    p = s.me;
  tick(s, { fire: true }, 40);
  const peak = p.punchX;
  expect(peak).toBeGreaterThan(3);
  tick(s);
  const one = p.punchX;
  tick(s);
  expect(one).toBeLessThan(peak);
  expect(p.punchX).toBeLessThan(one);
  // Most of the way back within half a second.
  tick(s, {}, 32);
  expect(p.punchX).toBeLessThan(peak * 0.1);
});

it("reloading a part-used magazine keeps a round chambered that can still be fired", () => {
  const s = armed("ak"),
    m = s.me.primary!;
  tick(s, { fire: true }, 6);
  const left = m.ammo,
    reserve = m.reserve;
  tick(s, { reload: true });
  expect(m.ammo).toBe(1);
  expect(m.reserve).toBe(reserve + left - 1);
  tick(s, {}, 20);
  tick(s, { fire: true });
  expect(m.ammo).toBe(0);
  expect(s.me.reloadEnd).toBeGreaterThan(0);
  tick(s, {}, Math.ceil(catalog.ak.reload * 64));
  expect(m.ammo).toBe(30);
});

it("reloads by itself when the magazine runs dry, and tops up to 30 + 1", () => {
  const s = armed("ak"),
    m = s.me.primary!;
  m.ammo = 2;
  tick(s, { fire: true }, 20);
  expect(s.me.reloadEnd).toBeGreaterThan(0);
  tick(s, {}, Math.ceil(catalog.ak.reload * 64) + 2);
  expect(m.ammo).toBe(30);
  tick(s, { reload: true });
  tick(s, {}, Math.ceil(catalog.ak.reload * 64) + 2);
  expect(m.ammo).toBe(31);
});

it("shotguns load a shell at a time and can fire between shells", () => {
  const s = armed("nova"),
    m = s.me.primary!;
  m.ammo = 2;
  tick(s, { reload: true });
  tick(s, {}, Math.ceil((shellTime("nova") + 0.25) * 64) + 1);
  expect(m.ammo).toBe(3);
  tick(s, {}, Math.ceil(shellTime("nova") * 64) + 1);
  expect(m.ammo).toBe(4);
  // Fire mid-load: the reload stops and the shot goes off.
  tick(s, { fire: true });
  expect(m.ammo).toBe(3);
  expect(s.me.reloadEnd).toBe(0);
});

it("sounds fade with distance to silence at their reach", () => {
  expect(falloff(1, 40)).toBe(1);
  expect(falloff(10, 40)).toBeLessThan(falloff(5, 40));
  expect(falloff(20, 40)).toBeLessThan(0.15);
  expect(falloff(40, 40)).toBe(0);
});
