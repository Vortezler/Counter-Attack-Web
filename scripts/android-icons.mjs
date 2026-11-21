// Renders the game's mark (public/mark.svg) into the Android launcher icons and splash images.
// Run from cs-web after changing the mark: node scripts/android-icons.mjs
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const res = "android/app/src/main/res";
const BG = "#171a16";
const SPLASH_BG = "#111411";
const mark = readFileSync("public/mark.svg", "utf8");
const glyph = mark.match(/<path[^>]*\/>/)[0];
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await chromium.launch({ channel: process.env.CS_WEB_BROWSER_CHANNEL || "msedge" });
const page = await browser.newPage();
async function render(svg, width, height, file) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>` +
      svg.replace("<svg ", `<svg width="${width}" height="${height}" `),
  );
  writeFileSync(file, await page.locator("svg").screenshot({ omitBackground: true }));
}
// The glyph spans x 11-55, y 19-45 of the 64 unit mark; centre it in each canvas.
const centred = (box, size) => {
  const k = size / 44;
  return `<g transform="translate(${box / 2 - 33 * k} ${box / 2 - 32 * k}) scale(${k})">${glyph}</g>`;
};
for (const [name, k] of Object.entries(densities)) {
  const dir = join(res, "mipmap-" + name);
  // Adaptive foreground: 108 dp canvas, glyph inside the 66 dp safe zone.
  const fg = 108 * k;
  await render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">${centred(108, 50)}</svg>`, fg, fg, join(dir, "ic_launcher_foreground.png"));
  const legacy = 48 * k;
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="2" y="2" width="44" height="44" rx="8" fill="${BG}"/>${centred(48, 30)}</svg>`,
    legacy, legacy, join(dir, "ic_launcher.png"),
  );
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="${BG}"/>${centred(48, 27)}</svg>`,
    legacy, legacy, join(dir, "ic_launcher_round.png"),
  );
}
// Pre-Android 12 splash images: keep each file's size, dark field with the mark in the middle.
for (const dir of readdirSync(res).filter((d) => d.startsWith("drawable"))) {
  const file = join(res, dir, "splash.png");
  let png;
  try {
    png = readFileSync(file);
  } catch {
    continue;
  }
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  const size = Math.min(width, height) * 0.28;
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${SPLASH_BG}"/><g transform="translate(${width / 2 - size / 2} ${height / 2 - size / 2}) scale(${size / 64})"><rect width="64" height="64" rx="9" fill="${BG}"/>${glyph}</g></svg>`,
    width, height, file,
  );
}
writeFileSync(
  join(res, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG.toUpperCase()}</color>\n</resources>\n`,
);
await browser.close();
console.log("Icons and splash images written under " + res);
