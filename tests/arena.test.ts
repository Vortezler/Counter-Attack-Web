import { beforeAll, afterEach, it, expect, describe } from "vitest";
import { initPhysics } from "../src/sim/Physics";
import { maps, type GridMapId } from "../src/world";
import { ArenaSim, DEATHMATCH, type ArenaRules } from "../src/sim/arena";
import { idle } from "../src/sim/player";
import { magazine } from "../src/config/weapons";

beforeAll(initPhysics);
let sim: ArenaSim | undefined;
afterEach(() => {
  sim?.dispose();
  sim = undefined;
});
const make = (rules: ArenaRules, botsOnly = true, map: GridMapId = "switchyard", seed = 7) =>
  (sim = new ArenaSim(maps[map], "CT", "normal", "Test", seed, botsOnly, rules));
const quiet = (s: ArenaSim) =>
  Object.fromEntries(
    s.players.filter((p) => s.isHuman(p)).map((p) => [p.id, idle(p.yaw, p.pitch)]),
  );
function run(s: ArenaSim, seconds: number) {
  for (let i = 0; i < seconds * 64 && s.phase !== "finished"; i++) s.step(quiet(s));
}

describe("deathmatch", () => {
  it("spreads players out, arms them, and opens the armory anywhere after spawning", () => {
    const s = make({ kind: "deathmatch", solo: false }, false);
    expect(s.phase).toBe("freeze");
    expect(s.bomb).toBeNull();
    expect(s.carrier).toBe(-1);
    for (const p of s.players) {
      expect(p.armor).toBe(100);
      expect(p.helmet).toBe(true);
    }
    // Bots bought rifles; the human can buy wherever they stand.
    expect(s.players.filter((p) => p.id && p.primary).length).toBeGreaterThan(5);
    expect(s.canBuy(s.me)).toBe(true);
    expect(s.buy(s.me, "ak" as never) === "Purchased" || s.buy(s.me, "m4") === "Purchased").toBe(true);
    s.spawnedAt[s.me.id] = s.time - DEATHMATCH.buyWindow - 0.1;
    expect(s.canBuy(s.me)).toBe(false);
  });
  it("respawns the dead with their guns after a short delay, behind spawn protection", () => {
    const s = make({ kind: "deathmatch", solo: false }, false);
    run(s, 5);
    const v = s.players[6];
    v.primary = magazine("awp");
    s.hurt(v, 500, s.players[1], "ak");
    expect(v.alive).toBe(false);
    expect(s.score[s.players[1].team]).toBe(1);
    run(s, DEATHMATCH.respawn + 0.2);
    expect(v.alive).toBe(true);
    expect(v.primary?.id).toBe("awp");
    expect(v.armor).toBe(100);
    // Protected for a moment after spawning.
    s.hurt(v, 50, s.players[1], "ak");
    expect(v.hp).toBe(100);
  });
  it("solo: same-coloured players are enemies and kills count", () => {
    const s = make({ kind: "deathmatch", solo: true });
    run(s, 5);
    const [a, b] = s.players.filter((p) => p.team === "CT");
    expect(s.foes(a, b)).toBe(true);
    expect(s.teamScale(a, b, "bullet")).toBe(1);
    s.shield[b.id] = 0;
    s.hurt(b, 500, a, "ak");
    expect(a.kills).toBe(1);
    expect(b.team).toBe("CT");
  });
  it("bots fight and the match finishes on the clock or the kill limit", () => {
    const time = DEATHMATCH.time;
    DEATHMATCH.time = 70;
    try {
      const s = make({ kind: "deathmatch", solo: false });
      run(s, 80);
      expect(s.phase).toBe("finished");
      expect(s.score.CT + s.score.T).toBeGreaterThan(2);
      expect(s.result).toMatch(/^Match (victory|defeat|tied)/);
      // Respawning keeps everyone in the fight.
      expect(s.players.reduce((n, p) => n + p.deaths, 0)).toBeGreaterThan(2);
    } finally {
      DEATHMATCH.time = time;
    }
  }, 60_000);
});

describe("battle royale", () => {
  it("starts everyone on a pistol with loot scattered and a zone around the map", () => {
    const s = make({ kind: "royale", solo: true }, false, "foundry");
    for (const p of s.players) {
      expect(p.primary).toBeNull();
      expect(p.armor).toBe(0);
    }
    expect(s.drops.length).toBeGreaterThanOrEqual(20);
    expect(s.canBuy(s.me)).toBe(false);
    expect(s.zone.r).toBeGreaterThan(70);
    expect(s.next.r).toBeLessThan(s.zone.r);
  });
  it("ends immediately when every human player is dead", () => {
    const s = make({ kind: "royale", solo: false }, false, "canopy");
    run(s, 5);
    expect(s.phase).toBe("live");
    s.hurt(s.me, 500, null, "bomb");
    s.step(quiet(s));
    expect(s.phase).toBe("finished");
    expect(s.result).toMatch(/^Eliminated/);
    expect(s.players.filter((p) => p.alive).length).toBeGreaterThan(1);
  });
  it("has no respawns, and the zone closes until one player is left", () => {
    const s = make({ kind: "royale", solo: true }, true, "switchyard", 11);
    run(s, 20);
    const dead = s.players.find((p) => !p.alive);
    if (dead) {
      run(s, 5);
      expect(dead.alive).toBe(false);
    }
    run(s, 400);
    expect(s.phase).toBe("finished");
    expect(s.players.filter((p) => p.alive).length).toBeLessThanOrEqual(1);
  }, 90_000);
  it("teams: the last squad standing wins", () => {
    const s = make({ kind: "royale", solo: false }, true, "foundry", 3);
    run(s, 400);
    expect(s.phase).toBe("finished");
    expect(new Set(s.players.filter((p) => p.alive).map((p) => p.team)).size).toBeLessThanOrEqual(1);
  }, 90_000);
});

describe("deathmatch ammo", () => {
  it("never runs out of spare magazines, but every magazine still has to be reloaded", () => {
    const s = make({ kind: "deathmatch", solo: false }, false),
      p = s.me;
    expect(s.endlessAmmo).toBe(true);
    p.primary = magazine("ak");
    p.weapon = "ak";
    p.drawEnd = 0;
    p.primary.reserve = 0;
    // Empty the magazine; it reloads by itself even with nothing in reserve, five times over.
    for (let mag = 0; mag < 5; mag++) {
      p.primary.ammo = 0;
      p.reloadEnd = 0;
      for (let i = 0; i < 64 * 3; i++) s.step({ [p.id]: { ...idle(p.yaw, p.pitch) } });
      expect(p.primary.ammo).toBe(30);
    }
    expect(p.primary.reserve).toBe(0);
  });
  it("is off in battle royale", () => {
    expect(make({ kind: "royale", solo: true }).endlessAmmo).toBe(false);
  });
});
