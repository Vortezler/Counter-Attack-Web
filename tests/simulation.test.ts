import { beforeAll, afterEach, it, expect } from "vitest";
import { Sim } from "../src/sim/Sim";
import { initPhysics } from "../src/sim/Physics";
import { maps } from "../src/world";
import { idle } from "../src/sim/player";
import { DT } from "../src/sim/rules";
beforeAll(initPhysics);
let sim: Sim | undefined;
afterEach(() => sim?.dispose());
function fixture() {
  return (sim = new Sim(maps.dust2, "T", "normal", "Test", 178));
}
function step(s: Sim, n = 1) {
  for (let i = 0; i < n; i++)
    s.step(Object.fromEntries(s.players.map((p) => [p.id, idle(p.yaw)])));
}
function place(s: Sim, id: number, where: { x: number; y: number; z: number }) {
  const p = s.players[id];
  p.x = where.x;
  p.y = where.y;
  p.z = where.z;
  s.physics.place(p.body, p, p.yaw);
  s.physics.world.step();
}
it("enforces buy zone, prices, team, equipment limits and survivor inventory", () => {
  const s = fixture(),
    p = s.me;
  s.phase = "freeze";
  p.money = 16000;
  expect(s.buy(p, "m4")).toBe("Other team only");
  expect(s.buy(p, "ak")).toBe("Purchased");
  expect(s.buy(p, "he")).toBe("Purchased");
  expect(s.buy(p, "he")).toBe("Already equipped");
  expect(p.money).toBe(13000);
  s.phase = "live";
  s.finish("T", "Attackers win");
  step(s, 321);
  expect(p.primary?.id).toBe("ak");
  place(s, 0, s.map.sites.B);
  expect(s.canBuy(p)).toBe(false);
});
it("transitions from warmup through freeze and ends on timeout", () => {
  const s = fixture();
  step(s, 192);
  expect(s.phase).toBe("freeze");
  step(s, 960);
  expect(s.phase).toBe("live");
  s.left = 0.01;
  step(s);
  expect(s.score.CT).toBe(1);
  expect(s.phase).toBe("ended");
});
it.each([false, true])("plants and defuses with kit=%s", (kit) => {
  const s = fixture(),
    a = s.map.sites.A;
  s.phase = "live";
  s.left = 100;
  place(s, 0, a);
  const hold = (id: number, n: number) => {
    for (let i = 0; i < n; i++)
      s.step(
        Object.fromEntries(
          s.players.map((p) => [p.id, { ...idle(), use: p.id === id }]),
        ),
      );
  };
  hold(0, 204);
  expect(s.phase).toBe("live");
  hold(0, 1);
  expect(s.phase).toBe("planted");
  expect(s.bomb).toBeTruthy();
  for (const p of s.players.filter((p) => p.team === "T"))
    s.hurt(p, 110, null, "bomb");
  const defender = s.players[5];
  defender.kit = kit;
  place(s, 5, { ...a, x: a.x + 0.45 });
  const ticks = (kit ? 5 : 10) / DT;
  hold(5, ticks - 1);
  expect(s.phase).toBe("planted");
  hold(5, 1);
  expect(s.phase).toBe("ended");
  expect(s.result).toContain("defused");
});
it("awards detonation even after attackers are eliminated", () => {
  const s = fixture();
  s.phase = "planted";
  s.bomb = { ...s.map.sites.A };
  s.left = 0.001;
  for (const p of s.players.filter((p) => p.team === "T"))
    s.hurt(p, 110, null, "bomb");
  step(s);
  expect(s.result).toContain("detonated");
  expect(s.score.T).toBe(1);
});
it("swaps sides and resets the economy at halftime, tracks victory and ties", () => {
  const s = fixture();
  s.round = 12;
  s.score = { T: 6, CT: 5 };
  s.phase = "live";
  s.finish("CT", "Time expired");
  s.left = 0;
  step(s);
  expect(s.round).toBe(13);
  expect(s.me.team).toBe("CT");
  expect(s.me.money).toBe(800);
  s.round = 24;
  s.score = { CT: 12, T: 11 };
  s.phase = "live";
  s.finish("T", "Defenders eliminated");
  s.left = 0;
  step(s);
  expect(s.result).toBe("Match tied");
});
it("ends a match at thirteen wins", () => {
  const s = fixture();
  s.round = 15;
  s.score = { T: 12, CT: 2 };
  s.phase = "live";
  s.finish("T", "Attackers win");
  s.left = 0;
  step(s);
  expect(s.phase).toBe("finished");
  expect(s.result).toBe("Match victory");
});
it("handles fire cadence, reload, recoil reset, and dropped bomb recovery", () => {
  const s = fixture(),
    p = s.me;
  s.phase = "live";
  s.left = 115;
  p.money = 16000;
  s.buy(p, "ak");
  step(s, 40);
  const m = p.primary!;
  for (let i = 0; i < 65; i++)
    s.step({
      ...Object.fromEntries(s.players.map((v) => [v.id, idle(v.yaw)])),
      0: { ...idle(), fire: true },
    });
  expect(m.ammo).toBeGreaterThanOrEqual(19);
  expect(m.ammo).toBeLessThanOrEqual(20);
  expect(p.index).toBeGreaterThan(3);
  step(s, 32);
  expect(p.index).toBe(0);
  s.step({ 0: { ...idle(), reload: true } });
  // The chambered round stays while the magazine comes out.
  expect(m.ammo).toBe(1);
  step(s, 160);
  expect(m.ammo).toBe(31);
  s.hurt(p, 150, null, "bomb");
  expect(s.bomb).toBeTruthy();
  place(s, 1, s.bomb!);
  step(s);
  expect(s.carrier).toBe(1);
});
it("requires uninterrupted use at the site to plant", () => {
  const s = fixture();
  s.phase = "live";
  s.left = 110;
  place(s, 0, s.map.sites.B);
  const commands = Object.fromEntries(s.players.map((p) => [p.id, idle()]));
  for (let i = 0; i < 100; i++)
    s.step({ ...commands, 0: { ...idle(), use: true } });
  expect(s.work).toBeGreaterThan(1);
  s.step(commands);
  expect(s.work).toBe(0);
  for (let i = 0; i < 110; i++)
    s.step({ ...commands, 0: { ...idle(), use: true } });
  expect(s.phase).toBe("live");
  expect(s.carrier).toBe(0);
});
