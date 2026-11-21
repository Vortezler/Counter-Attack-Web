import { test, expect } from "@playwright/test";

test("rebinds keys from the lobby and plays fullscreen until Esc", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await page.evaluate(() => localStorage.removeItem("cs-web:keybinds"));
  await page.reload();
  await page.getByRole("button", { name: "Controls" }).first().click();
  const reload = page.locator("[data-bind=reload]");
  await expect(reload).toHaveText("R");
  await reload.click();
  await expect(reload).toHaveText("Press a key…");
  await page.keyboard.press("t");
  await expect(reload).toHaveText("T");
  // Taking a key that is already used moves it off the other action.
  await page.locator("[data-bind=buy]").click();
  await page.keyboard.press("t");
  await expect(page.locator("[data-bind=buy]")).toHaveText("T");
  await expect(reload).toHaveText("—");
  // Esc cancels capture without closing the dialog or changing the binding.
  await page.locator("[data-bind=use]").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-bind=use]")).toHaveText("E");
  await page.locator("[data-bind=jump]").click();
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await expect(page.locator("[data-bind=jump]")).toHaveText("Mouse 2");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cs-web:keybinds")!),
    ),
  ).toMatchObject({ buy: ["KeyT"], reload: [], jump: ["Mouse2"] });
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(reload).toHaveText("R");
  await page.locator("[data-bind=buy]").click();
  await page.keyboard.press("g");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /start match/i }).click();
  await expect(page.locator("[data-phase=freeze]")).toBeVisible({
    timeout: 60000,
  });
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page.keyboard.press("g");
  const shop = page.getByRole("dialog", { name: "Buy menu" });
  await expect(shop).toBeVisible();
  await expect(shop).toContainText("G closes the armory");
  await page.keyboard.press("g");
  await expect(page.getByRole("dialog", { name: "Buy menu" })).toBeHidden();
  // Leaving fullscreen (what Esc does in the browser) pauses and hands control back.
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.getByRole("button", { name: "Resume match" }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page.evaluate(() => localStorage.removeItem("cs-web:keybinds"));
  expect(errors).toEqual([]);
});
