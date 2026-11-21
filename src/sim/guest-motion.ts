import type { Sim } from "./Sim";
import type { PlayerCommand } from "./player";
import type { Vec3 } from "../world";
import { U } from "./rules";
import { record } from "./peer-state";

// Predict only the guest's movement. The host still resolves all damage,
// purchases, objectives, results, and the authoritative player position.
const historyLimit = 32;

export class GuestMotion {
  private pending: { sequence: number; command: PlayerCommand }[] = [];
  private correction: Vec3 = { x: 0, y: 0, z: 0 };
  private lastSnapshotAt = -Infinity;

  capture(sim: Sim) {
    return { ...this.position(sim), round: sim.round, alive: sim.me.alive };
  }

  position(sim: Sim): Vec3 {
    const p = sim.me;
    return { x: p.x + this.correction.x, y: p.y + this.correction.y, z: p.z + this.correction.z };
  }

  updateCorrection(elapsed: number) {
    const keep = Math.exp(-elapsed * 18);
    for (const axis of ["x", "y", "z"] as const) this.correction[axis] *= keep;
  }

  advance(sim: Sim, sequence: number, command: PlayerCommand, now: number) {
    if (!this.canMove(sim) || now - this.lastSnapshotAt > 500) return;
    this.pending.push({ sequence, command });
    if (this.pending.length > historyLimit) this.pending.shift();
    this.move(sim, command);
  }

  reconcile(sim: Sim, before: ReturnType<GuestMotion["capture"]>, ack: unknown, stream: string, now: number) {
    const inSameLife = sim.me.alive && before.alive && sim.round === before.round;
    this.lastSnapshotAt = now;
    this.correction = { x: 0, y: 0, z: 0 };
    if (!this.canMove(sim)) {
      this.pending = [];
      return;
    }
    for (const p of sim.players) {
      sim.physics.enable(p.body, p.alive);
      p.body.collider.setHalfHeight((p.crouched ? 11 : 20) * U);
      sim.physics.place(p.body, p, p.yaw);
    }
    sim.physics.world.step();

    if (inSameLife && record(ack) && ack.stream === stream &&
      typeof ack.sequence === "number" && Number.isSafeInteger(ack.sequence) &&
      typeof ack.age === "number" && Number.isSafeInteger(ack.age) && ack.age >= 0) {
      const confirmed = ack.sequence + Math.min(historyLimit, ack.age);
      this.pending = this.pending.filter(input => input.sequence > confirmed);
      for (const input of this.pending) this.move(sim, input.command);
    } else {
      this.pending = [];
    }

    const p = sim.me;
    const delta = { x: before.x - p.x, y: before.y - p.y, z: before.z - p.z };
    // Ease small corrections. Snap after large jumps or a change of round.
    if (inSameLife && Math.hypot(delta.x, delta.y, delta.z) < 1.25) this.correction = delta;
  }

  private canMove(sim: Sim) {
    return sim.me.alive && (sim.phase === "live" || sim.phase === "planted");
  }

  private move(sim: Sim, command: PlayerCommand) {
    sim.me.yaw = command.yaw;
    sim.move(sim.me, command, false);
    sim.me.lastCmd = command;
  }
}
