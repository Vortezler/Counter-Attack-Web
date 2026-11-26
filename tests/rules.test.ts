import { describe, it, expect } from "vitest";
import {
  penetrate,
  damage,
  velocity,
  DT,
  U,
  JUMP,
  GRAVITY,
  lossPay,
  capMoney,
  path,
  nearest,
} from "../src/sim/rules";
import { maps } from "../src/world";
import { patterns } from "../src/config/recoilPatterns";
describe("Material penetration", () => {
  it("attenuates damage by material, thickness and weapon", () => {
    expect(penetrate(36, "ak", "wood", 10)).toBeCloseTo(27.51, 1);
    expect(penetrate(36, "ak", "plaster", 16)).toBeCloseTo(18.41, 1);
    expect(penetrate(36, "ak", "concrete", 16)).toBeGreaterThan(8);
    expect(penetrate(36, "ak", "concrete", 16)).toBeLessThan(18);
    expect(penetrate(36, "ak", "concrete", 32)).toBe(0);
    expect(penetrate(115, "awp", "concrete", 24)).toBeGreaterThan(60);
    expect(penetrate(30, "glock", "concrete", 16)).toBe(0);
    for (const w of ["glock", "negev", "awp", "ak", "m4", "deagle"] as const) {
      let last = 120;
      for (let i = 0; i < 150; i++) {
        const amount = penetrate(115, w, "plaster", i);
        expect(amount).toBeLessThanOrEqual(last);
        expect(amount).toBeGreaterThanOrEqual(0);
        last = amount;
      }
    }
  });
});
describe("Damage and recoil", () => {
  it("respects hit group, helmet, armor exhaustion, and range", () => {
    expect(damage(36, "ak", 0, "head", 0, false).hp).toBe(144);
    expect(damage(36, "ak", 0, "head", 100, true).hp).toBe(56);
    expect(damage(36, "ak", 0, "head", 100, false).hp).toBe(144);
    expect(damage(38, "m4", 0, "chest", 100, true).hp).toBe(13);
    expect(damage(38, "m4", 0, "chest", 2, true).hp).toBe(34);
    expect(damage(115, "awp", 0, "chest", 0, false).hp).toBeGreaterThanOrEqual(
      100,
    );
    expect(
      damage(115, "awp", 10, "chest", 100, true).hp,
    ).toBeGreaterThanOrEqual(100);
    expect(damage(115, "awp", 0, "leg", 0, false).hp).toBeLessThan(100);
    expect(damage(36, "ak", 50, "chest", 0, false).hp).toBeLessThan(36);
  });
  it("has a repeatable pattern per magazine", () => {
    expect(patterns.ak.length).toBe(30);
    expect(patterns.m4.length).toBe(20);
    expect(patterns.negev.length).toBe(150);
    expect(patterns.ak[0]).toEqual([0, 0]);
    expect(Math.max(...patterns.ak.map((p) => p[1]))).toBeGreaterThan(2);
  });
});
describe("Movement", () => {
  it("accelerates, stops under friction, gains sideways air velocity and reaches jump apex", () => {
    let v = [0, 0];
    for (let i = 0; i < 64; i++) v = velocity(v[0], v[1], 0, -1, 250 * U, true);
    expect(v[1]).toBeCloseTo(-250 * U);
    const air = velocity(v[0], v[1], 1, 0, 250 * U, false);
    expect(Math.hypot(...air)).toBeGreaterThan(250 * U);
    for (let i = 0; i < 32; i++) v = velocity(v[0], v[1], 0, 0, 250 * U, true);
    expect(Math.hypot(...v)).toBe(0);
    expect(JUMP ** 2 / (2 * GRAVITY * U)).toBeCloseTo(57, 0);
    expect(DT).toBe(1 / 64);
  });
});
describe("Economy and navigation", () => {
  it("pays capped loss streaks", () => {
    expect([0, 1, 2, 3, 4, 5].map(lossPay)).toEqual([
      1400, 1900, 2400, 2900, 3400, 3400,
    ]);
    expect(capMoney(16500)).toBe(16000);
  });
  it.each(["sandgate", "saffron"] as const)(
    "%s spawns route to either site",
    (id) => {
      const m = maps[id];
      for (const p of [...m.spawns.T, ...m.spawns.CT])
        for (const site of Object.values(m.sites))
          expect(
            path(
              m.nodes,
              nearest(m.nodes, p.x, p.z),
              nearest(m.nodes, site.x, site.z),
            ).length,
          ).toBeGreaterThan(0);
    },
  );
});
