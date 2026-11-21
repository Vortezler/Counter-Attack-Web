// End-to-end touch checks for the debug Android build on an emulator or device.
// Run `npm run build:android`, install and open the app, then: node scripts/android-e2e.mjs
// Every gesture is a real multi-touch event sent through the WebView's DevTools socket.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { adb, connect } from "./android-cdp.mjs";

const out = process.env.E2E_OUT || ".qa/android";
mkdirSync(out, { recursive: true });
const cdp = await connect();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : ""));
};
const sleep = cdp.sleep;
const probe = () => cdp.evaluate("globalThis.cswProbe?.()");
async function waitFor(fn, timeout = 15000, every = 100) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() > end) return undefined;
    await sleep(every);
  }
}
/** Centre of the first element matching the selector (and text, if given), in CSS pixels. */
const centre = (selector, text = "") => waitFor(() => locate(selector, text), 3000);
const locate = (selector, text) =>
  cdp.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(e => e.textContent.includes(${JSON.stringify(text)}) && e.getBoundingClientRect().width);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  })()`);
const view = () => cdp.evaluate("[innerWidth, innerHeight]");
async function tap(point, hold = 60) {
  if (!point) throw new Error("Tap target not found");
  await cdp.touch([{ type: "start", points: [point] }, { type: "end", wait: hold }]);
  await sleep(120);
}
/** Drags one or more fingers by [dx, dy] each over `steps` moves. */
async function drag(starts, deltas, steps = 10, holdAfter = 0, release = true) {
  const at = (i) => starts.map(([x, y], f) => [x + (deltas[f][0] * i) / steps, y + (deltas[f][1] * i) / steps, f]);
  const seq = [{ type: "start", points: at(0) }];
  for (let i = 1; i <= steps; i++) seq.push({ type: "move", points: at(i), wait: 30 });
  await cdp.touch(seq);
  if (holdAfter) await sleep(holdAfter);
  if (release) await cdp.touch([{ type: "end" }]);
}
const back = () => execFileSync(adb, ["shell", "input", "keyevent", "4"]);
const open = async (query) => {
  await cdp.send("Page.navigate", { url: "https://localhost/" + query });
  await sleep(800);
  return waitFor(() => cdp.evaluate("!!globalThis.cswProbe?.() || !!document.querySelector('.csw-start')"), 30000);
};

// ---- Match: guide, buying, inventory, scoreboard, movement, aim, fire, pause -----------
await open("?debug=1");
const [W, H] = await view();
check("landscape viewport", W > H, W + "x" + H);
await tap(await centre(".csw-start"));
let p = await waitFor(async () => {
  const s = await probe();
  return s && (s.phase === "warmup" || s.phase === "freeze") ? s : undefined;
}, 60000);
check("match starts from a tap on Start", p, p?.phase);
await sleep(700);
const guideOpacity = () => cdp.evaluate("+getComputedStyle(document.querySelector('.csw-touch-guide')).opacity");
let opacity = await guideOpacity();
check("guide is very translucent at match start", p?.guide && opacity > 0.15 && opacity <= 0.35, "opacity " + opacity);
await cdp.shot(out + "/e2e-01-match-start.png");

await waitFor(async () => (await probe())?.phase === "freeze", 10000);
await tap(await centre(".csw-intel"));
p = await waitFor(async () => ((await probe())?.mode === "Buy menu" ? probe() : undefined), 3000);
check("tapping the radar opens the buy menu", p);
await tap(await centre("[data-action=cat-5]"));
await tap(await centre("[data-action=buy-flash]"));
await tap(await centre("[data-action=buy-he]"));
await cdp.shot(out + "/e2e-02-buy-menu.png");
await tap(await centre("[data-action=return]"));
p = await probe();
check("buy menu items and Return respond to taps", p.mode === "" && !p.paused, JSON.stringify({ mode: p.mode, paused: p.paused, phase: p.phase }));
await sleep(300);
await tap(await centre(".csw-inventory li[data-slot='12']"));
p = await waitFor(async () => ((await probe())?.weapon === "flash" ? probe() : undefined), 2000);
check("inventory chip draws that exact grenade", p, p?.weapon);
await tap(await centre(".csw-inventory li[data-slot='3']"));
p = await waitFor(async () => ((await probe())?.weapon === "knife" ? probe() : undefined), 2000);
check("inventory chip draws the knife", p, p?.weapon);
await tap(await centre(".csw-touch-swap"));
p = await waitFor(async () => ((await probe())?.weapon === "flash" ? probe() : undefined), 2000);
check("Swap returns to the previous weapon", p, p?.weapon);
await tap(await centre(".csw-inventory li[data-slot='2']"));

const strip = await centre(".csw-strip");
await cdp.touch([{ type: "start", points: [strip] }]);
await sleep(400);
p = await probe();
check("holding the score shows the scoreboard", p.mode === "Scoreboard");
await cdp.shot(out + "/e2e-03-scoreboard.png");
await cdp.touch([{ type: "end" }]);
await sleep(200);
check("releasing the score closes it", (await probe()).mode === "");

let before = await probe();
await drag([[W * 0.7, H * 0.4]], [[120, 0]]);
p = await probe();
const turned = p.yaw - before.yaw;
check("dragging the right side turns the view", turned > 0.45 && turned < 1, "yaw +" + turned.toFixed(3) + " rad for 120 px");

p = await waitFor(async () => ((await probe())?.phase === "live" ? probe() : undefined), 30000);
check("round goes live", p);
await sleep(2200);
opacity = await guideOpacity();
check("guide disappears once the round is live", !p.guide && opacity < 0.02, "opacity " + opacity);
await cdp.shot(out + "/e2e-04-live.png");

before = await probe();
const stick = [W * 0.18, H * 0.7];
await drag([stick], [[0, -70]], 8, 1200, false);
p = await probe();
check("full stick push runs forward", p.command.moveZ > 0.9 && !p.command.walk, JSON.stringify({ z: p.command.moveZ, walk: p.command.walk }));
check("the player moves", Math.hypot(p.x - before.x, p.z - before.z) > 2, Math.hypot(p.x - before.x, p.z - before.z).toFixed(2) + " m");
await cdp.touch([{ type: "move", points: [[stick[0], stick[1] - 24]] }]);
await sleep(250);
p = await probe();
check("light stick push walks", p.command.walk && p.command.moveZ > 0.9);
await cdp.touch([{ type: "end" }]);
await sleep(200);
p = await probe();
check("releasing the stick stops", p.command.moveX === 0 && p.command.moveZ === 0);

before = await probe();
await drag([stick, [W * 0.7, H * 0.35]], [[50, -40], [-100, 30]], 10, 600);
p = await probe();
check(
  "stick and aim work at the same time",
  Math.hypot(p.x - before.x, p.z - before.z) > 1 && p.yaw < before.yaw - 0.3 && p.pitch < before.pitch,
  "moved " + Math.hypot(p.x - before.x, p.z - before.z).toFixed(2) + " m, yaw " + (p.yaw - before.yaw).toFixed(2),
);

before = await probe();
const fire = await centre(".csw-touch-fire");
await drag([fire], [[60, 0]], 12, 300);
await sleep(200);
p = await probe();
check("Fire shoots", p.ammo < before.ammo, before.ammo + " -> " + p.ammo);
check("dragging on Fire aims while shooting", p.yaw - before.yaw > 0.2, "yaw +" + (p.yaw - before.yaw).toFixed(3));

await tap(await centre(".csw-touch-reload"));
p = await waitFor(async () => ((await probe())?.reloading ? probe() : undefined), 1500);
check("Reload reloads", p);
await waitFor(async () => !(await probe()).reloading, 5000);

before = await probe();
await tap(await centre(".csw-touch-jump"));
let peak = before.y;
for (let i = 0; i < 10; i++) {
  peak = Math.max(peak, (await probe()).y);
  await sleep(40);
}
check("Jump jumps", peak - before.y > 0.15, "rose " + (peak - before.y).toFixed(2) + " m");

await sleep(600);
await tap(await centre(".csw-touch-crouch"));
p = await waitFor(async () => ((await probe())?.crouched ? probe() : undefined), 1500);
check("Crouch toggles on", p);
await tap(await centre(".csw-touch-crouch"));
p = await waitFor(async () => (!(await probe())?.crouched ? probe() : undefined), 1500);
check("Crouch toggles off", p);

await tap(await centre(".csw-touch-pause"));
p = await probe();
check("the pause corner pauses", p.paused && p.mode === "Paused");
await cdp.shot(out + "/e2e-05-paused.png");
back();
await sleep(500);
p = await probe();
check("Android Back resumes from pause", !p.paused && p.mode === "");
back();
await sleep(500);
p = await probe();
check("Android Back pauses a running match", p.paused);
await tap(await centre("[data-action=return]"));
check("Resume button resumes", !(await probe()).paused);

// ---- Range: scoped weapon ------------------------------------------------------------
await open("?scene=range&debug=1");
await waitFor(async () => (await probe())?.phase === "live", 30000);
await sleep(400);
await tap(await centre(".csw-intel"));
await waitFor(async () => (await probe())?.mode === "Buy menu", 3000);
await tap(await centre("[data-action=cat-3]"));
await tap(await centre("[data-action=buy-awp]"));
await tap(await centre("[data-action=return]"));
p = await waitFor(async () => ((await probe())?.weapon === "awp" ? probe() : undefined), 3000);
check("bought and drew the AWP in the range", p, p?.weapon);
await sleep(600);
await tap(await centre(".csw-touch-alt"));
p = await waitFor(async () => ((await probe())?.scoped === 1 ? probe() : undefined), 1500);
check("Scope zooms", p);
before = p;
await drag([[W * 0.7, H * 0.4]], [[120, 0]]);
p = await probe();
check("aiming slows while scoped", p.yaw - before.yaw > 0.05 && p.yaw - before.yaw < 0.4, "yaw +" + (p.yaw - before.yaw).toFixed(3));
await cdp.shot(out + "/e2e-06-scoped.png");
await tap(await centre(".csw-touch-alt"));
await tap(await centre(".csw-touch-alt"));
p = await waitFor(async () => ((await probe())?.scoped === 0 ? probe() : undefined), 1500);
check("Scope cycles back out", p);

check("no page errors", cdp.errors.length === 0, cdp.errors.slice(0, 3).join(" | "));
cdp.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
