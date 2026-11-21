/** Where the game runs: the Android app (Capacitor), a touch browser, or a desktop browser. */
type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

/** True inside the Capacitor Android shell. The native bridge defines `window.Capacitor` before any page script runs. */
export const nativeApp = !!(
  globalThis as { Capacitor?: CapacitorGlobal }
).Capacitor?.isNativePlatform?.();

/**
 * Touch play: the Android app, or a browser whose primary pointer is a finger. Desktop browsers on
 * touch-screen laptops keep mouse controls because their primary pointer is fine.
 */
export const touchDevice =
  nativeApp ||
  (typeof matchMedia === "function" &&
    (matchMedia("(pointer: coarse)").matches ||
      (navigator.maxTouchPoints > 0 && matchMedia("(hover: none)").matches)));

/** Tags the document so stylesheets can switch to the phone layout: `html[data-input=touch]`, `.csw-native`. */
export function markPlatform() {
  document.documentElement.dataset.input = touchDevice ? "touch" : "mouse";
  document.documentElement.classList.toggle("csw-native", nativeApp);
}

/** A phone held sideways: little height, so the HUD and menus compact. */
export const compactScreen = () => innerHeight < 520;

/**
 * Routes the Android back button. The handler returns true when it consumed the press;
 * otherwise the app closes, as Android users expect from a top-level screen.
 */
export function onBackButton(handler: () => boolean, signal: AbortSignal) {
  if (!nativeApp) return;
  void import("@capacitor/app").then(async ({ App }) => {
    if (signal.aborted) return;
    const listener = await App.addListener("backButton", () => {
      if (!handler()) void App.exitApp();
    });
    if (signal.aborted) void listener.remove();
    else signal.addEventListener("abort", () => void listener.remove(), { once: true });
  });
}

/** A short tick of haptic feedback for touch buttons that have no visible state. */
export function tick() {
  try {
    navigator.vibrate?.(9);
  } catch {
    /* Vibration is optional. */
  }
}
