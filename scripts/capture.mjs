/**
 * Renders lobby artwork for maps without hand-made art, plus an effects proof
 * sheet (smoke, molotov fire and ragdolls), through the dev server's live modules.
 * Start `npm run dev`, then run: node scripts/capture.mjs [effects]
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const origin = process.env.CS_WEB_URL || "http://127.0.0.1:5177/cs-web/";
const effectsOnly = process.argv[2] === "effects";
/** Map ids on the command line limit the art pass to those maps and skip the effects sheet. */
const only = process.argv.slice(2).filter((a) => a !== "effects");
const browser = await chromium.launch({
  channel:
    process.env.CS_WEB_BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
  args: ["--use-angle=default", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(origin);
await page.evaluate(() => {
  document.body.innerHTML =
    '<canvas id="shot" style="position:fixed;inset:0;width:1600px;height:900px;display:block"></canvas>';
});
/** Draws one frame from `eye` towards `look` with optional effects. */
async function frame(map, eye, look, extra = {}) {
  await page.evaluate(
    async ({ map, eye, look, extra }) => {
      const base = location.pathname.replace(/\/$/, "");
      const { GameRenderer } = await import(base + "/src/render.ts");
      const { maps } = await import(base + "/src/world.ts");
      window.__r?.dispose();
      const old = document.getElementById("shot"),
        canvas = document.createElement("canvas");
      canvas.id = "shot";
      canvas.style.cssText = old.style.cssText;
      old.replaceWith(canvas);
      const r = new GameRenderer(canvas, maps[map]);
      window.__r = r;
      const dx = look.x - eye.x,
        dy = look.y - eye.y,
        dz = look.z - eye.z;
      const yaw = Math.atan2(dx, -dz),
        pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const time = extra.time ?? 10;
      for (const d of extra.deaths ?? [])
        r.death(d.id, d.dir, d.head, time - d.age);
      const f = {
        camera: { ...eye, yaw, pitch },
        actors: extra.actors ?? [],
        viewId: -1,
        weapon: extra.weapon ?? "ak",
        time,
        fov: extra.fov ?? 80,
        shadows: true,
        spectating: !extra.weapon,
        smokes: extra.smokes,
        fires: extra.fires,
      };
      for (let i = 0; i < 3; i++) r.render(f);
    },
    { map, eye, look, extra },
  );
  await page.waitForTimeout(150);
}
const out = (name) =>
  fileURLToPath(new URL("../public/art/" + name, import.meta.url));
const views = {
  isotope: [
    { x: 46, y: 17, z: 90 },
    { x: 22, y: 1, z: 62 },
  ],
  terracotta: [
    { x: 46, y: 16, z: 56 },
    { x: 21, y: 0, z: 26 },
  ],
  highwire: [
    { x: 92, y: 10, z: 90 },
    { x: 70, y: 1, z: 32 },
  ],
  switchyard: [
    { x: 36, y: 12, z: 78 },
    { x: 60, y: 1, z: 58 },
  ],
  canopy: [
    { x: 71, y: 11, z: 49 },
    { x: 80, y: 0.5, z: 24 },
  ],
  foundry: [
    { x: 34, y: 4.2, z: 43 },
    { x: 17, y: 1.2, z: 27 },
  ],
};
if (!effectsOnly)
  for (const [map, [eye, look]] of Object.entries(views)) {
    if (only.length && !only.includes(map)) continue;
    await frame(map, eye, look);
    await page
      .locator("#shot")
      .screenshot({ path: out(map + ".jpg"), quality: 84, type: "jpeg" });
    await page.setViewportSize({ width: 640, height: 300 });
    await page.evaluate(() => {
      const c = document.getElementById("shot");
      c.style.width = "640px";
      c.style.height = "300px";
    });
    await frame(map, eye, look, { fov: 70 });
    await page
      .locator("#shot")
      .screenshot({ path: out(map + "-map.jpg"), quality: 80, type: "jpeg" });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.evaluate(() => {
      const c = document.getElementById("shot");
      c.style.width = "1600px";
      c.style.height = "900px";
    });
    console.log("art", map);
  }
if (only.length) {
  await browser.close();
  process.exit(0);
}
// Effects proof: a T-spawn courtyard on Sandgate with a smoke, a molotov and three bodies.
const spawn = { x: 52.5, z: 92.5 };
const actor = (id, x, z, team, alive, yaw = 0) => ({
  id,
  x,
  y: 0,
  z,
  yaw,
  team,
  alive,
  last: { x, y: 0, z },
});
await frame(
  "sandgate",
  { x: spawn.x - 3, y: 1.7, z: spawn.z + 5 },
  { x: spawn.x + 1, y: 0.6, z: spawn.z - 6 },
  {
    weapon: "molly",
    actors: [
      actor(1, spawn.x - 1.2, spawn.z - 2.5, "CT", false),
      actor(2, spawn.x + 1.6, spawn.z - 3.5, "T", false, 1),
      actor(3, spawn.x + 4.5, spawn.z - 1, "CT", true, 2),
    ],
    deaths: [
      { id: 1, dir: { x: -0.6, z: -0.8 }, head: true, age: 2 },
      { id: 2, dir: { x: 0.8, z: 0.6 }, head: false, age: 0.25 },
    ],
    smokes: [
      {
        id: 5,
        x: spawn.x + 5,
        y: 0,
        z: spawn.z - 3,
        r: 3.7,
        born: 6,
        until: 24,
      },
    ],
    fires: [
      {
        id: 6,
        x: spawn.x - 3.5,
        y: 0,
        z: spawn.z - 6,
        r: 2.9,
        born: 8,
        until: 15,
      },
    ],
  },
);
await page
  .locator("#shot")
  .screenshot({
    path: fileURLToPath(
      new URL("../test-results/effects.png", import.meta.url),
    ),
  });
console.log("effects proof written to test-results/effects.png");
await browser.close();
