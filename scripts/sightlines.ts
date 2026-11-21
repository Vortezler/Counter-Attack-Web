/**
 * Checks that no point inside either team's buy zone has line of sight to any
 * point inside the other team's buy zone, standing or at the top of a jump.
 * Also prints an ASCII layout of each map. Run: npx tsx scripts/sightlines.ts [map]
 */
import { initPhysics, Physics } from "../src/sim/Physics";
import { maps, mapIds, type MapDef, type Rect, type Vec3 } from "../src/world";

await initPhysics();
function solid(m: MapDef, x: number, z: number) {
  return m.boxes.some(
    (b) =>
      b.style !== "floor" &&
      b.style !== "roof" &&
      b.y - b.h / 2 < 1 &&
      Math.abs(b.x - x) < b.w / 2 + 0.45 &&
      Math.abs(b.z - z) < b.d / 2 + 0.45,
  );
}
function samples(m: MapDef, r: Rect) {
  const out: Vec3[] = [];
  for (let x = r.x - r.w / 2; x <= r.x + r.w / 2; x += 1)
    for (let z = r.z - r.d / 2; z <= r.z + r.d / 2; z += 1)
      if (!solid(m, x, z)) out.push({ x, y: r.y, z });
  return out;
}
function ascii(m: MapDef) {
  const rows: string[] = [];
  for (let tz = 0; tz < 21; tz++) {
    let row = "";
    for (let tx = 0; tx < 21; tx++) {
      const cx = tx * 5 + 2.5,
        cz = tz * 5 + 2.5;
      const node = m.nodes.find((n) => n.x === cx && n.z === cz);
      const roof = m.boxes.some(
        (b) => b.style === "roof" && b.x === cx && b.z === cz,
      );
      let c = node ? (roof ? ":" : ".") : "#";
      if (node && node.y > 0.7) c = "R";
      else if (node && node.y > 0) c = "^";
      for (const [k, r] of Object.entries(m.sites))
        if (Math.abs(r.x - cx) < 1 && Math.abs(r.z - cz) < 1) c = k;
      if (m.spawns.T[0].x === cx && m.spawns.T[0].z === cz) c = "T";
      if (m.spawns.CT[0].x === cx && m.spawns.CT[0].z === cz) c = "C";
      row += c + " ";
    }
    rows.push(row);
  }
  return rows.join("\n");
}
const only = process.argv[2];
let failures = 0;
for (const id of mapIds) {
  if (only && only !== id) continue;
  const m = maps[id];
  const physics = new Physics(m);
  const t = samples(m, m.buyZones.T),
    ct = samples(m, m.buyZones.CT);
  let seen = 0;
  const examples: string[] = [];
  for (const eye of [1.63, 1.17, 3.05])
    for (const a of t)
      for (const b of ct) {
        const o = { x: a.x, y: a.y + eye, z: a.z },
          e = { x: b.x, y: b.y + eye, z: b.z };
        const dx = e.x - o.x,
          dy = e.y - o.y,
          dz = e.z - o.z,
          d = Math.hypot(dx, dy, dz);
        if (!physics.ray(o, { x: dx / d, y: dy / d, z: dz / d }, d - 0.02)) {
          seen++;
          if (examples.length < 4)
            examples.push(
              `T(${a.x.toFixed(1)},${a.z.toFixed(1)}) ↔ CT(${b.x.toFixed(1)},${b.z.toFixed(1)}) @${eye}`,
            );
        }
      }
  physics.free();
  console.log(
    `\n${m.name}: ${m.nodes.length} nodes, ${t.length}×${ct.length} spawn samples, ${seen} visible pairs`,
  );
  if (!only || seen) console.log(ascii(m));
  for (const e of examples) console.log("  " + e);
  if (seen) failures++;
}
if (failures) {
  console.error(`\n${failures} map(s) have spawn-to-spawn sightlines`);
  process.exit(1);
}
console.log("\nNo spawn-to-spawn sightlines.");
