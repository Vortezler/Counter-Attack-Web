import { beforeAll, afterEach, it, expect, describe } from "vitest";
import { Sim } from "../src/sim/Sim";
import { initPhysics, Physics } from "../src/sim/Physics";
import { maps, mapIds } from "../src/world";
import { idle } from "../src/sim/player";
import { path, nearest } from "../src/sim/rules";
import { catalog } from "../src/config/weapons";
import { patterns } from "../src/config/recoilPatterns";
beforeAll(initPhysics);
let sim: Sim | undefined;
afterEach(() => {
  sim?.dispose();
  sim = undefined;
});
function fixture(map = maps.sandgate) {
  return (sim = new Sim(map, "T", "normal", "Test", 178));
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
/** Moves player 0 and enemy 5 into open ground on the T spawn floor, facing each other. */
function duel(s: Sim, gap: number) {
  const spawn = s.map.spawns.T[0];
  place(s, 0, { ...spawn });
  place(s, 5, { ...spawn, z: spawn.z - gap });
  s.me.yaw = 0;
  s.me.pitch = Math.atan2(-0.35, gap);
  for (const p of s.players)
    if (p.id !== 0 && p.id !== 5) s.hurt(p, 200, null, "bomb");
}

describe("weapons", () => {
  it("has a recoil pattern for every gun and team locks on CT rifles", () => {
    for (const g of Object.keys(catalog))
      expect(patterns[g as keyof typeof catalog]?.length).toBeGreaterThan(1);
    const s = fixture(),
      p = s.me;
    s.phase = "freeze";
    p.money = 16000;
    expect(s.buy(p, "m4a4")).toBe("Other team only");
    expect(s.buy(p, "aug")).toBe("Other team only");
    expect(s.buy(p, "ssg")).toBe("Purchased");
    expect(s.buy(p, "xm")).toBe("Purchased");
    expect(p.primary?.id).toBe("xm");
  });
  it("lands all shotgun pellets on one target as a single hit", () => {
    const s = fixture(),
      p = s.me;
    s.phase = "freeze";
    p.money = 16000;
    s.buy(p, "nova");
    s.phase = "live";
    s.left = 100;
    duel(s, 3);
    const hits: number[] = [];
    s.onEvent((e) => {
      if (e.type === "hit" && e.victim === 5) hits.push(e.amount!);
    });
    step(s, 40);
    s.step({ 0: { ...idle(p.yaw, p.pitch), fire: true } });
    expect(hits.length).toBe(1);
    expect(hits[0]).toBeGreaterThan(100);
    expect(s.players[5].alive).toBe(false);
    expect(p.kills).toBe(1);
    expect(p.roundKills).toBe(1);
  });
  it("bleeds on hits: spray along the bullet and a splat on the surface behind the victim", () => {
    const s = fixture(),
      p = s.me;
    s.phase = "live";
    s.left = 100;
    duel(s, 6);
    const blood: NonNullable<Parameters<Parameters<Sim["onEvent"]>[0]>[0]>[] = [];
    s.onEvent((e) => {
      if (e.type === "blood") blood.push(e);
    });
    step(s, 40);
    s.step({ 0: { ...idle(p.yaw, p.pitch), fire: true } });
    expect(blood.length).toBe(1);
    const [e] = blood;
    expect(e.victim).toBe(5);
    expect(e.actor).toBe(0);
    expect(["head", "chest", "stomach", "arm", "leg"]).toContain(e.message);
    // The bullet travels north (-z), so the spray heads north and the splat lands past the victim.
    expect(e.dir!.z).toBeLessThan(-0.9);
    expect(e.end).toBeDefined();
    expect(e.end!.z).toBeLessThan(e.pos!.z);
    expect(Math.hypot(e.normal!.x, e.normal!.y, e.normal!.z)).toBeCloseTo(1, 3);
  });
  it("cycles scope levels: two on the SSG, one on the AUG", () => {
    const s = (sim = new Sim(maps.sandgate, "CT", "normal", "Test", 9)),
      p = s.me;
    s.phase = "freeze";
    p.money = 16000;
    s.buy(p, "aug");
    s.phase = "live";
    s.left = 100;
    step(s, 40);
    const press = () => {
      s.step({ 0: { ...idle(p.yaw), alt: true } });
      s.step({ 0: idle(p.yaw) });
    };
    press();
    expect(p.scoped).toBe(1);
    press();
    expect(p.scoped).toBe(0);
  });
});

describe("utility", () => {
  it("limits grenades to four and cycles them on slot 4", () => {
    const s = fixture(),
      p = s.me;
    s.phase = "freeze";
    p.money = 16000;
    for (const n of ["smoke", "molly", "he", "flash"] as const)
      expect(s.buy(p, n)).toBe("Purchased");
    expect(s.buy(p, "flash")).toBe("Already equipped");
    expect(s.buy(p, "smoke")).toBe("Already equipped");
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      s.switch(p, 4);
      seen.add(p.weapon);
    }
    expect([...seen].sort()).toEqual(["flash", "he", "molly", "smoke"]);
  });
  it("blocks bot vision through a smoke and lets it fade", () => {
    const s = fixture();
    s.phase = "live";
    const spawn = s.map.spawns.T[0];
    const a = { x: spawn.x, y: 1.6, z: spawn.z },
      b = { x: spawn.x, y: 1.6, z: spawn.z - 6.5 };
    expect(s.visible(a, b)).toBe(true);
    s.smokes.push({
      id: 1,
      x: spawn.x,
      y: 0,
      z: spawn.z - 3.2,
      r: 3.7,
      born: s.time - 2,
      until: s.time + 18,
    });
    expect(s.visible(a, b)).toBe(false);
    expect(s.visible(a, b, false)).toBe(true);
    s.time += 18.5;
    step(s);
    expect(s.smokes.length).toBe(0);
    expect(s.visible(a, b)).toBe(true);
  });
  it.each(["competitive", "casual"] as const)(
    "%s: burns enemies fully and the thrower's team at the mode's friendly-fire rate",
    (mode) => {
      const s = fixture(),
        p = s.me;
      s.mode = mode;
      s.phase = "live";
      s.left = 100;
      // Away from T spawn so only the two placed players stand in the fire.
      const spot = { ...s.map.spawns.T[0], z: s.map.spawns.T[0].z - 6 };
      place(s, 5, { ...spot });
      place(s, 1, { ...spot, x: spot.x + 1 });
      p.molly = 1;
      s.ignite(
        {
          id: 99,
          type: "molly",
          owner: 0,
          body: null!,
          born: s.time,
          expires: 0,
          lastVy: 0,
        },
        { ...spot, y: 0.5 },
      );
      expect(s.fires.length).toBe(1);
      step(s, 64);
      expect(s.players[5].hp).toBeLessThan(70);
      const ally = 100 - s.players[1].hp;
      if (mode === "casual") expect(ally).toBe(0);
      else {
        expect(ally).toBeGreaterThan(0);
        expect(ally).toBeLessThan((100 - s.players[5].hp) / 2);
      }
      step(s, 64 * 7);
      expect(s.fires.length).toBe(0);
    },
  );
  it("puts out a fire when a smoke lands on it, and a molotov fizzles inside smoke", () => {
    const s = fixture();
    s.phase = "live";
    s.left = 100;
    const spot = { ...s.map.spawns.T[0], y: 0.5 };
    const nade = (id: number, type: "smoke" | "molly") => ({
      id,
      type,
      owner: 0,
      body: null!,
      born: s.time,
      expires: 0,
      lastVy: 0,
    });
    s.ignite(nade(1, "molly"), spot);
    expect(s.fires.length).toBe(1);
    s.popSmoke(nade(2, "smoke"), spot);
    expect(s.fires.length).toBe(0);
    s.time += 1.5;
    s.ignite(nade(3, "molly"), spot);
    expect(s.fires.length).toBe(0);
  });
  it("throws a real smoke that settles and blooms", () => {
    const s = fixture(),
      p = s.me;
    s.phase = "live";
    s.left = 100;
    p.smoke = 1;
    s.switch(p, 4);
    expect(p.weapon).toBe("smoke");
    step(s, 64);
    s.step({ 0: { ...idle(p.yaw, -0.2), fire: true } });
    for (let i = 0; i < 30; i++)
      s.step({ 0: { ...idle(p.yaw, -0.2), fire: true } });
    s.step({ 0: idle(p.yaw, -0.2) });
    expect(s.grenades.length).toBe(1);
    step(s, 64 * 4);
    expect(s.grenades.length).toBe(0);
    expect(s.smokes.length).toBe(1);
  });
});

describe.each(mapIds)("%s", (id) => {
  const m = maps[id];
  it("routes every spawn to both sites", () => {
    for (const p of [...m.spawns.T, ...m.spawns.CT])
      for (const site of Object.values(m.sites))
        expect(
          path(
            m.nodes,
            nearest(m.nodes, p.x, p.z),
            nearest(m.nodes, site.x, site.z),
          ).length,
        ).toBeGreaterThan(0);
  });
  it("has no line of sight between the two spawn areas", () => {
    const physics = new Physics(m);
    const grid = (r: { x: number; z: number; w: number; d: number }) => {
      const out: { x: number; z: number }[] = [];
      for (let x = r.x - r.w / 2 + 0.5; x <= r.x + r.w / 2; x += 2)
        for (let z = r.z - r.d / 2 + 0.5; z <= r.z + r.d / 2; z += 2)
          out.push({ x, z });
      return out;
    };
    let open = 0;
    for (const a of grid(m.buyZones.T))
      for (const b of grid(m.buyZones.CT)) {
        const o = { x: a.x, y: 1.63, z: a.z },
          dx = b.x - a.x,
          dz = b.z - a.z,
          d = Math.hypot(dx, dz);
        if (!physics.ray(o, { x: dx / d, y: 0, z: dz / d }, d)) open++;
      }
    physics.free();
    expect(open).toBe(0);
  });
});
