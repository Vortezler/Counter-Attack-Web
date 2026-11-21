import { defineConfig } from "@playwright/test";
const production = "http://127.0.0.1:4177/cs-web/";
const development = "http://127.0.0.1:5177/cs-web/";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: production,
    viewport: { width: 1280, height: 800 },
    channel:
      process.env.CS_WEB_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    launchOptions: {
      args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
    },
  },
  webServer: [
    {
      command: "npm run preview -- --strictPort",
      url: production,
      reuseExistingServer: true,
    },
    { command: "npm run dev", url: development, reuseExistingServer: true },
  ],
});
