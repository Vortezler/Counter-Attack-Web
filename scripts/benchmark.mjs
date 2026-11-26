import { preview } from "vite";
import { chromium } from "@playwright/test";
const server = await preview({
  preview: { port: 4192, host: "127.0.0.1", strictPort: true },
});
let browser;
try {
  browser = await chromium.launch({
    channel:
      process.env.CS_WEB_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
  });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  for (const map of ["sandgate", "saffron"]) {
    await page.goto(
      "http://127.0.0.1:4192/cs-web/?autostart=1&botsonly=1&map=" + map,
    );
    await page.locator("[data-phase=live]").waitFor({ timeout: 90000 });
    const result = await page.evaluate(async () => {
      const canvas = document.querySelector(
          'canvas[aria-label="First-person game view"]',
        ),
        gl = canvas.getContext("webgl2"),
        ext = gl.getExtension("WEBGL_debug_renderer_info");
      const gpu = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : "not provided";
      const deltas = [];
      let last = 0,
        start = 0;
      await new Promise((resolve) => {
        function sample(t) {
          if (last) deltas.push(t - last);
          else start = t;
          last = t;
          if (t - start >= 6500) resolve();
          else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      const sorted = deltas.toSorted((a, b) => a - b);
      return {
        gpu,
        pixels: [canvas.width, canvas.height],
        meanFps: Math.round(
          (1000 * deltas.length) / deltas.reduce((a, b) => a + b, 0),
        ),
        medianFrameMs: sorted[Math.floor(sorted.length / 2)],
        p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
      };
    });
    console.log(map, result);
  }
} finally {
  await browser?.close();
  await server.close();
}
