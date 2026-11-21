import { test, expect, devices } from "@playwright/test";

// A phone browser held sideways: the invisible touch controls, driven by real touch events.
const { defaultBrowserType: _, ...phone } = devices["Pixel 7 landscape"];
test.use({ ...phone });

test("phone landscape: faint guide at match start, invisible touch controls in play", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  const touch = (type: string, points: [number, number][]) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  const centre = async (selector: string) => {
    const box = (await page.locator(selector).first().boundingBox())!;
    return [box.x + box.width / 2, box.y + box.height / 2] as [number, number];
  };
  const tap = async (selector: string) => {
    await touch("touchStart", [await centre(selector)]);
    await touch("touchEnd", []);
  };

  await page.goto("./?debug=1");
  await expect(page.locator("html")).toHaveAttribute("data-input", "touch");
  await page.getByRole("button", { name: /start match/i }).tap();
  await expect(page.locator("[data-phase=freeze]")).toBeVisible({ timeout: 60000 });
  const guide = page.locator(".csw-touch-guide");
  await expect
    .poll(() => guide.evaluate((el) => +getComputedStyle(el).opacity))
    .toBeCloseTo(0.3, 1);

  await tap(".csw-intel");
  const shop = page.getByRole("dialog", { name: "Buy menu" });
  await expect(shop).toBeVisible();
  await tap("[data-action=cat-5]");
  await tap("[data-action=buy-flash]");
  await tap("[data-action=buy-he]");
  await expect(shop.getByText("HE grenade equipped")).toBeVisible();
  await tap("[data-action=return]");
  await expect(shop).toBeHidden();
  await tap(".csw-inventory li[data-slot='12']");
  await expect(page.locator("[data-ui=weapon]")).toHaveText("Flashbang");

  const probe = () => page.evaluate(() => (globalThis as any).cswProbe());
  await expect(page.locator("[data-phase=live]")).toBeVisible({ timeout: 60000 });
  await expect
    .poll(() => guide.evaluate((el) => +getComputedStyle(el).opacity), { timeout: 10000 })
    .toBe(0);

  // Left thumb runs forward while the right thumb turns the view.
  const before = await probe();
  const { width, height } = page.viewportSize()!;
  const stick: [number, number] = [width * 0.18, height * 0.7];
  const look: [number, number] = [width * 0.7, height * 0.35];
  await touch("touchStart", [stick, look]);
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", [
      [stick[0], stick[1] - i * 7],
      [look[0] + i * 10, look[1]],
    ]);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(800);
  const moving = await probe();
  await touch("touchEnd", []);
  expect(moving.command.moveZ).toBeGreaterThan(0.9);
  expect(Math.hypot(moving.x - before.x, moving.z - before.z)).toBeGreaterThan(1);
  expect(moving.yaw - before.yaw).toBeGreaterThan(0.4);

  await tap(".csw-touch-pause");
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
  expect(errors).toEqual([]);
});
