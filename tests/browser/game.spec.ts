import { test, expect } from "@playwright/test";

test("selects a map and side, buys gear, moves, fires, pauses, and returns to setup", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await page.getByRole("button", { name: "Saffron", exact: true }).click();
  await page.locator("[data-side=T]").click();
  await expect(page.locator(".csw-feature h2")).toHaveText("SAFFRON");
  await expect
    .poll(() =>
      page
        .locator(".csw-featureimg")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await page.getByRole("button", { name: /start match/i }).click();
  await expect(page.locator("[data-phase=freeze]")).toBeVisible({
    timeout: 60000,
  });
  await page.keyboard.press("b");
  const shop = page.getByRole("dialog", { name: "Buy menu" });
  await expect(shop).toBeVisible();
  await shop.getByRole("button", { name: /Desert Eagle/ }).click();
  await expect(shop.getByText("Desert Eagle equipped")).toBeVisible();
  await shop.getByRole("button", { name: "Return to match" }).click();
  await expect(page.locator("[data-phase=live]")).toBeVisible({
    timeout: 60000,
  });
  if (!(await page.evaluate(() => Boolean(document.pointerLockElement)))) {
    await page.getByLabel("First-person game view").click();
  }
  await page.keyboard.down("w");
  await page.waitForTimeout(260);
  await page.keyboard.up("w");
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await expect(page.locator("[data-ui=ammo]")).toHaveText("6");
  await page.keyboard.press("r");
  // A fresh magazine plus the round still chambered: 7 + 1.
  await expect(page.locator("[data-ui=ammo]")).toHaveText("8", {
    timeout: 15000,
  });
  await page.keyboard.down("Tab");
  await expect(page.getByRole("dialog", { name: "Scoreboard" })).toBeVisible();
  await page.keyboard.up("Tab");
  await page.evaluate(() => document.exitPointerLock());
  await page.getByRole("button", { name: "Return to match setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Match lobby" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("releases pointer lock, RAF, event listeners, audio and WebGL across three remounts", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/cs-web/");
  const output = await page.evaluate(async () => {
    const { createGame } = await import(
      /* @vite-ignore */ "/cs-web/src/index.ts"
    );
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:99";
    document.body.append(host);
    const nativeAdd = EventTarget.prototype.addEventListener,
      nativeRemove = EventTarget.prototype.removeEventListener;
    const listeners = new Set<{
      target: EventTarget;
      type: string;
      fn: EventListenerOrEventListenerObject;
      signal?: AbortSignal;
    }>();
    const targets = [window, document];
    EventTarget.prototype.addEventListener = function (type, fn, options) {
      if (fn && targets.includes(this as Window))
        listeners.add({
          target: this,
          type,
          fn,
          signal: typeof options === "object" ? options.signal : undefined,
        });
      nativeAdd.call(this, type, fn, options);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, options) {
      for (const e of listeners)
        if (e.target === this && e.type === type && e.fn === fn)
          listeners.delete(e);
      nativeRemove.call(this, type, fn, options);
    };
    const browser = window as unknown as {
      gc?: () => void;
      AudioContext: typeof AudioContext;
    };
    const frames = new Set<number>();
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
        frames.delete(id);
        callback(time);
      });
      frames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      frames.delete(id);
      cancel(id);
    };
    const contexts: AudioContext[] = [];
    const Audio = browser.AudioContext;
    browser.AudioContext = class extends Audio {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        contexts.push(this);
      }
    };
    const glContexts: WebGL2RenderingContext[] = [];
    const states: boolean[] = [];
    const memory: number[] = [];
    const collect = async () => {
      await new Promise((r) => setTimeout(r, 150));
      browser.gc?.();
      return (
        (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? 0
      );
    };
    let steps = 0;
    try {
      for (let i = 0; i < 3; i++) {
        const h = await createGame(host, {
          autostart: true,
          map: i % 2 ? "saffron" : "sandgate",
          debug: i === 1,
          onExit: () => {},
        });
        const surface = host.querySelector("canvas")!;
        const gl = surface.getContext("webgl2");
        if (gl) glContexts.push(gl);
        let signaled = false;
        h.on("ready", () => (signaled = true));
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        h.resume();
        await new Promise((r) => setTimeout(r, 50));
        h.pause();
        h.destroy();
        steps++;
        states.push(
          signaled &&
            host.children.length === 0 &&
            document.pointerLockElement !== surface,
        );
        memory.push(await collect());
      }
      // Three installs one-time shared listeners on the first import. Signal-bound game listeners must all be released.
      const active = [...listeners]
        .filter((l) => l.signal && !l.signal.aborted)
        .map((l) => l.type);
      return {
        steps,
        pendingFrames: frames.size,
        states,
        active,
        audioClosed: contexts.every((c) => c.state === "closed"),
        glLost:
          glContexts.length === 3 && glContexts.every((c) => c.isContextLost()),
        heapGrowth: memory[2] - memory[0],
      };
    } finally {
      host.remove();
      EventTarget.prototype.addEventListener = nativeAdd;
      EventTarget.prototype.removeEventListener = nativeRemove;
      browser.AudioContext = Audio;
      window.requestAnimationFrame = request;
      window.cancelAnimationFrame = cancel;
    }
  });
  console.log("Lifecycle measurements", output);
  expect(output.steps).toBe(3);
  expect(output.states).toEqual([true, true, true]);
  expect(output.active).toEqual([]);
  expect(output.pendingFrames).toBe(0);
  expect(output.audioClosed).toBe(true);
  expect(output.glLost).toBe(true);
  expect(output.heapGrowth).toBeLessThan(20 * 1024 * 1024);
});
