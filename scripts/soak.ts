import { initPhysics } from "../src/sim/Physics";
import { Sim } from "../src/sim/Sim";
import { maps } from "../src/world";
import assert from "node:assert/strict";
await initPhysics();
for (const id of ["dust2", "mirage"] as const) {
  for (const seed of [713, 3479]) {
    const sim = new Sim(maps[id], "CT", "normal", "Observer", seed, true);
    let kills = 0,
      plants = 0,
      defuses = 0,
      timeouts = 0;
    const rounds: string[] = [];
    const begin = performance.now();
    sim.onEvent((e) => {
      if (e.type === "kill") kills++;
      if (e.type === "plant") plants++;
      if (e.type === "roundEnd") {
        rounds.push(e.message!);
        if (e.message?.includes("defused")) defuses++;
        if (e.message?.includes("expired")) timeouts++;
      }
    });
    try {
      while (sim.phase !== "finished" && sim.tick < 64 * 24 * 185) sim.step();
      assert.equal(sim.phase, "finished");
      assert.ok(rounds.length >= 13 && rounds.length <= 24);
      assert.ok(kills > 10, "too few encounters");
      assert.ok(plants > 0, "no bomb plants");
      assert.ok(defuses > 0, "no defuses");
      console.log(
        JSON.stringify({
          map: id,
          seed,
          rounds: rounds.length,
          score: sim.score,
          kills,
          plants,
          defuses,
          timeouts,
          meanTickMs: +((performance.now() - begin) / sim.tick).toFixed(3),
        }),
      );
    } finally {
      sim.dispose();
    }
  }
}
