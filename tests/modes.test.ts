import { beforeAll, afterEach, it, expect, describe } from "vitest";
import { Sim, type GameMode } from "../src/sim/Sim";
import { initPhysics } from "../src/sim/Physics";
import { maps } from "../src/world";
import { idle } from "../src/sim/player";
beforeAll(initPhysics);
let sim: Sim | undefined;
afterEach(() => {
  sim?.dispose();
  sim = undefined;
});
const make = (mode: GameMode) =>
  (sim = new Sim(maps.sandgate, "T", "normal", "Test", 178, false, mode));
function place(s: Sim, id: number, where: { x: number; y: number; z: number }) {
  const p = s.players[id];
  Object.assign(p, where);
  s.physics.place(p.body, p, p.yaw);
  s.physics.world.step();
}
const quiet = (s: Sim) =>
  Object.fromEntries(s.players.map((p) => [p.id, idle(p.yaw, p.pitch)]));
/** Player 0 aims an AK at teammate 1 standing 4 m ahead and fires once. */
function shootTeammate(s: Sim) {
  const p = s.me;
  s.phase = "freeze";
  p.money = 16000;
  s.buy(p, "ak");
  s.phase = "live";
  s.left = 100;
  const spot = s.map.spawns.T[0];
  place(s, 0, spot);
  place(s, 1, { ...spot, z: spot.z - 4 });
  for (const q of s.players.slice(2)) place(s, q.id, { ...q, x: q.x + 200 });
  p.yaw = 0;
  p.pitch = Math.atan2(-0.4, 4);
  for (let i = 0; i < 40; i++) s.step(quiet(s));
  s.step({ ...quiet(s), 0: { ...idle(p.yaw, p.pitch), fire: true } });
}

it("competitive: teammates take a third of bullet damage, and a teamkill costs a kill and $300", () => {
  const s = make("competitive");
  const ally = s.players[1];
  ally.armor = 0;
  shootTeammate(s);
  const taken = 100 - ally.hp;
  expect(taken).toBeGreaterThan(5);
  expect(taken).toBeLessThan(36);
  s.me.kills = 2;
  const money = s.me.money;
  s.hurt(ally, 500, s.me, "ak");
  expect(s.me.kills).toBe(1);
  expect(s.me.money).toBe(money - 300);
});

it("casual: no friendly fire, and everyone spawns armored with CT defuse kits", () => {
  const s = make("casual");
  for (const p of s.players) {
    expect(p.armor).toBe(100);
    expect(p.helmet).toBe(true);
    expect(p.kit).toBe(p.team === "CT");
  }
  shootTeammate(s);
  expect(s.players[1].hp).toBe(100);
});

it("glock right-click toggles a three-round burst with a cooldown", () => {
  const s = make("competitive"),
    p = s.me;
  s.phase = "live";
  s.left = 100;
  for (let i = 0; i < 40; i++) s.step(quiet(s));
  expect(p.weapon).toBe("glock");
  const modes: string[] = [];
  s.onEvent((e) => e.type === "mode" && modes.push(e.message!));
  s.step({ ...quiet(s), 0: { ...idle(p.yaw), alt: true } });
  s.step(quiet(s));
  expect(p.glockBurst).toBe(true);
  expect(modes).toEqual(["Switched to burst-fire mode"]);
  const before = p.mag!.ammo;
  s.step({ ...quiet(s), 0: { ...idle(p.yaw), fire: true } });
  for (let i = 0; i < 20; i++) s.step(quiet(s));
  expect(before - p.mag!.ammo).toBe(3);
  // Held trigger during the cooldown does not start another burst.
  for (let i = 0; i < 10; i++)
    s.step({ ...quiet(s), 0: { ...idle(p.yaw), fire: true } });
  expect(before - p.mag!.ammo).toBe(3);
  s.step({ ...quiet(s), 0: { ...idle(p.yaw), alt: true } });
  expect(p.glockBurst).toBe(false);
});

describe("knife", () => {
  /** Player 0 (T) holds the knife 1 m from enemy 5; `behind` puts the attacker at the victim's back. */
  function duel(behind: boolean) {
    const s = make("competitive"),
      p = s.me,
      v = s.players[5];
    s.phase = "live";
    s.left = 100;
    const spot = { ...s.map.spawns.T[0], z: s.map.spawns.T[0].z - 6 };
    place(s, 5, spot);
    place(s, 0, { ...spot, z: spot.z + 1 });
    v.armor = 0;
    // The victim faces +z (towards the attacker) unless it is a backstab.
    v.yaw = behind ? 0 : Math.PI;
    p.yaw = 0;
    p.pitch = -0.35;
    s.switch(p, 3);
    expect(p.weapon).toBe("knife");
    for (let i = 0; i < 30; i++)
      s.step({ ...quiet(s), 0: idle(p.yaw, p.pitch) });
    return { s, p, v };
  }
  const hold = (s: Sim, attack: "fire" | "alt") =>
    s.step({
      ...quiet(s),
      0: { ...idle(s.me.yaw, s.me.pitch), [attack]: true },
    });
  it("left click slashes for 40 from the front", () => {
    const { s, v } = duel(false);
    hold(s, "fire");
    expect(v.hp).toBe(60);
  });
  it("right click stabs for 65 from the front", () => {
    const { s, v } = duel(false);
    hold(s, "alt");
    expect(v.hp).toBe(35);
  });
  it("a heavy backstab always kills, even through armor, and pays $1500", () => {
    const { s, p, v } = duel(true);
    v.armor = 100;
    v.helmet = true;
    const money = p.money;
    hold(s, "alt");
    expect(v.alive).toBe(false);
    expect(p.money).toBe(money + 1500);
  });
  it("swings at each attack's own pace when held", () => {
    const { s, v } = duel(false);
    v.hp = 1000;
    for (let i = 0; i < 64; i++) hold(s, "fire");
    // 0.4 s per slash over 1 s: swings at 0, 0.4 and 0.8 s.
    expect(1000 - v.hp).toBe(120);
  });
});
