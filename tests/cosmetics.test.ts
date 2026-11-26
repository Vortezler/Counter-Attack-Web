import { beforeAll, afterEach, it, expect, describe } from "vitest";
import { Sim, DROP_SLOT, TAG_TIME } from "../src/sim/Sim";
import { initPhysics } from "../src/sim/Physics";
import { maps } from "../src/world";
import { idle, type PlayerCommand } from "../src/sim/player";
import { magazine } from "../src/config/weapons";
import {
  agents,
  botLook,
  defaultLoadout,
  finishById,
  finishFor,
  finishes,
  itemLabel,
  knives,
  lookOf,
  sanitize,
  skinnableGuns,
} from "../src/cosmetics";

beforeAll(initPhysics);
let sim: Sim | undefined;
afterEach(() => {
  sim?.dispose();
  sim = undefined;
});
function fixture() {
  const s = (sim = new Sim(maps.dust2, "T", "normal", "Test", 178));
  s.phase = "live";
  s.left = 100;
  return s;
}
function step(s: Sim, cmd: Partial<PlayerCommand> = {}, n = 1) {
  for (let i = 0; i < n; i++)
    s.step(Object.fromEntries(s.players.map((p) => [p.id, p.id === 0 ? { ...idle(p.yaw), ...cmd } : idle(p.yaw)])));
}

describe("tagging", () => {
  it("a hit slows the victim, and the slowdown wears off", () => {
    const s = fixture(),
      v = s.players[5];
    expect(s.tagged(v)).toBe(0);
    s.hurt(v, 27, s.players[0], "ak");
    const fresh = s.tagged(v);
    expect(fresh).toBeGreaterThan(0.3);
    expect(fresh).toBeLessThanOrEqual(0.6);
    s.time += TAG_TIME / 2;
    expect(s.tagged(v)).toBeCloseTo(fresh / 2, 5);
    s.time += TAG_TIME;
    expect(s.tagged(v)).toBe(0);
  });
  it("grenades, fire and falls do not tag", () => {
    const s = fixture(),
      v = s.players[5];
    s.hurt(v, 20, s.players[0], "he");
    s.hurt(v, 5, null, "molly");
    expect(s.tagged(v)).toBe(0);
  });
});

describe("dropping", () => {
  it("drops the held primary ahead, switches to the pistol, and waits before re-grabbing it", () => {
    const s = fixture(),
      me = s.me;
    me.primary = magazine("ak");
    me.primary.ammo = 12;
    s.equip(me, "ak");
    step(s, { slot: DROP_SLOT });
    expect(me.primary).toBeNull();
    expect(me.weapon).toBe(me.pistol.id);
    const d = s.drops.find((x) => x.item === "ak")!;
    expect(d).toBeTruthy();
    expect(d.ammo).toBe(12);
    expect(Math.hypot(d.x - me.x, d.z - me.z)).toBeGreaterThan(0.5);
    // Standing still next to it: not picked straight back up...
    step(s, {}, 10);
    expect(me.primary).toBeNull();
    // ...but it is after the cooldown, if still in reach.
    Object.assign(me, { x: d.x, z: d.z });
    s.physics.place(me.body, me, me.yaw);
    step(s, {}, 90);
    expect(me.primary?.id).toBe("ak");
  });
  it("a pistol in hand stays in hand", () => {
    const s = fixture(),
      me = s.me;
    me.primary = magazine("ak");
    s.equip(me, me.pistol.id);
    step(s, { slot: DROP_SLOT });
    expect(me.primary?.id).toBe("ak");
    expect(s.drops.length).toBe(0);
  });
  it("the C4 carrier can set the bomb down for a teammate", () => {
    const s = fixture(),
      me = s.me;
    s.carrier = me.id;
    s.equip(me, "bomb");
    step(s, { slot: DROP_SLOT });
    expect(s.carrier).toBe(-1);
    expect(s.bomb).toBeTruthy();
    expect(me.weapon).not.toBe("bomb");
    step(s, {}, 10);
    expect(s.carrier).toBe(-1);
  });
});

describe("round MVP", () => {
  it("goes to the winner with the most kills this round", () => {
    const s = fixture(),
      ts = s.players.filter((p) => p.team === "T");
    ts[1].roundKills = 3;
    ts[2].roundKills = 1;
    s.finish("T", "Defenders eliminated");
    expect(s.mvp).toBe(ts[1].id);
    expect(s.mvpWhy).toBe("3 eliminations");
    expect(ts[1].mvps).toBe(1);
  });
  it("goes to the planter when the bomb goes off", () => {
    const s = fixture(),
      planter = s.players.find((p) => p.team === "T")!;
    s.planter = planter.id;
    s.phase = "planted";
    s.finish("T", "Bomb detonated");
    expect(s.mvp).toBe(planter.id);
    expect(s.mvpWhy).toBe("planted the bomb");
  });
});

describe("cosmetics", () => {
  it("has unique ids and something on every rarity", () => {
    for (const list of [finishes, agents, knives]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(agents.filter((a) => a.side === "CT").length).toBeGreaterThanOrEqual(4);
    expect(agents.filter((a) => a.side === "T").length).toBeGreaterThanOrEqual(4);
  });
  it("sanitises stored loadouts: wrong sides, unknown ids and misplaced finishes fall back", () => {
    const l = sanitize({
      agent: { CT: "t-street", T: "t-guerrilla" },
      knife: "lightsaber",
      knifeFinish: "sandstorm",
      guns: { ak: "magma", m4: "folded", awp: "nope", glock: "factory" },
    });
    expect(l.agent).toEqual({ CT: defaultLoadout().agent.CT, T: "t-guerrilla" });
    expect(l.knife).toBe("combat");
    // Sandstorm is a firearm-only camo.
    expect(l.knifeFinish).toBe("factory");
    expect(l.guns).toEqual({ ak: "magma" });
    expect(sanitize(null)).toEqual(defaultLoadout());
    expect(sanitize("junk")).toEqual(defaultLoadout());
  });
  it("gives each bot a stable look that matches its side", () => {
    for (let id = 1; id < 10; id++) {
      const a = botLook(id, "CT", 7),
        b = botLook(id, "CT", 7);
      expect(a).toEqual(b);
      expect(agents.find((x) => x.id === a.agent)?.side).toBe("CT");
      for (const f of Object.values(a.guns)) expect(finishById.get(f!)?.for).not.toBe("knife");
      expect(finishById.get(a.knifeFinish)?.for).not.toBe("gun");
    }
    // Different seeds dress the lobby differently.
    const looks = new Set(Array.from({ length: 9 }, (_, i) => JSON.stringify(botLook(i + 1, "T", 3))));
    expect(looks.size).toBeGreaterThan(5);
  });
  it("labels items with their finish", () => {
    const l = { ...defaultLoadout(), guns: { ak: "magma" }, knife: "karambit" as const, knifeFinish: "aurora" };
    const look = lookOf(l, "T");
    expect(finishFor(look, "ak")).toBe("magma");
    expect(finishFor(look, "m4")).toBe("factory");
    expect(finishFor(look, "knife")).toBe("aurora");
    expect(itemLabel("AK-47", "magma")).toBe("AK-47 | Magma");
    expect(itemLabel("AK-47", "factory")).toBe("AK-47");
    expect(skinnableGuns.length).toBe(12);
  });
});
