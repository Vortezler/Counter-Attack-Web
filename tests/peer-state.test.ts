import { beforeAll, expect, it } from "vitest";
import { applyFrame, peerPlayer, projectFrame, readCommand } from "../src/sim/peer-state";
import { GuestMotion } from "../src/sim/guest-motion";
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

it("predicts guest movement before the relay responds, then corrects to the host", () => {
  const host = new Sim(maps.dust2);
  const guest = new Sim(maps.dust2);
  const motion = new GuestMotion();
  host.remotePlayer = peerPlayer;
  guest.viewer = peerPlayer;
  try {
    host.phase = "live";
    host.left = 90;
    const start = { ...host.players[peerPlayer] };
    expect(applyFrame(guest, projectFrame(host, true))).not.toBeNull();
    motion.reconcile(guest, motion.capture(guest), { sequence: 0, stream: "guest", age: 0 }, "guest", 0);
    const command = { ...idle(start.yaw), moveZ: 1 };
    for (let sequence = 1; sequence <= 8; sequence++) motion.advance(guest, sequence, command, sequence * 16);
    expect(Math.hypot(guest.me.x - start.x, guest.me.z - start.z)).toBeGreaterThan(0.1);
    expect(host.players[peerPlayer].x).toBe(start.x);
    expect(host.players[peerPlayer].z).toBe(start.z);

    // The host acknowledges the input sequence but its position wins if
    // movement was rejected or collided differently on the host.
    const before = motion.capture(guest);
    expect(applyFrame(guest, projectFrame(host, true))).not.toBeNull();
    motion.reconcile(guest, before, { sequence: 5, stream: "guest", age: 3 }, "guest", 150);
    motion.updateCorrection(0.5);
    expect(motion.position(guest).x).toBeCloseTo(start.x);
    expect(motion.position(guest).z).toBeCloseTo(start.z);
  } finally {
    host.dispose();
    guest.dispose();
  }
});
