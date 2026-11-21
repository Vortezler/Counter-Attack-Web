import { beforeAll, expect, it } from "vitest";
import { applyFrame, peerPlayer, projectFrame, readCommand } from "../src/sim/peer-state";
import { initPhysics } from "../src/sim/Physics";
import { Sim } from "../src/sim/Sim";
import { idle } from "../src/sim/player";
import { maps } from "../src/world";

beforeAll(initPhysics);

it("replicates the host's guest purchase and final result into the guest view", () => {
  const host = new Sim(maps.dust2);
  const guest = new Sim(maps.dust2);
  host.remotePlayer = peerPlayer;
  guest.viewer = peerPlayer;
  try {
    host.phase = "freeze";
    host.left = 15;
    const input = readCommand({ ...idle(), buy: "kevlar" });
    expect(input?.buy).toBe("kevlar");
    host.step({ [peerPlayer]: input! });
    expect(applyFrame(guest, JSON.parse(JSON.stringify(projectFrame(host))))).not.toBeNull();
    expect(guest.me.money).toBe(150);
    expect(guest.me.armor).toBe(100);
    host.phase = "ended";
    host.left = 0;
    host.round = 24;
    host.score = { CT: 13, T: 11 };
    host.step();
    expect(applyFrame(guest, projectFrame(host))).not.toBeNull();
    expect(guest.phase).toBe("finished");
    expect(host.result).toBe("Match victory");
    expect(guest.result).toBe("Match defeat");
  } finally {
    host.dispose();
    guest.dispose();
  }
});

it("accepts bounded peer input without accepting a player ID or unauthorized loadout fields", () => {
  expect(readCommand({ ...idle(), moveX: 2 })).toBeNull();
  expect(readCommand({ ...idle(), pitch: Infinity })).toBeNull();
  expect(readCommand({ ...idle(), id: 0, hp: 999, buy: "__proto__", slot: 33 })).toEqual(idle());
});
