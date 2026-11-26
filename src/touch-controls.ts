import { tick } from "./platform";

/** Momentary actions a touch button holds while a finger rests on it. */
export type TouchHold = "fire" | "alt" | "jump" | "reload" | "use" | "crouch";

export interface TouchHandlers {
  /** Movement from the floating stick: x strafes right, z moves forward, both within [-1, 1]. */
  move(x: number, z: number, walk: boolean): void;
  hold(action: TouchHold, down: boolean): void;
  /** Camera drag in CSS pixels. */
  look(dx: number, dy: number): void;
  /** A weapon slot as `PlayerCommand.slot` understands it. */
  slot(slot: number): void;
  buy(): void;
  pause(): void;
  scoreboard(show: boolean): void;
  /** Any touch on the game view, used to unlock audio. */
  touched(): void;
}

type ButtonId = "fire" | "alt" | "jump" | "crouch" | "reload" | "use" | "swap" | "pause";
interface Button {
  id: ButtonId;
  label: string;
  /** Centre measured from the right and bottom safe edges (top edge for pause), at a 400 px tall view. */
  dx: number;
  dy: number;
  r: number;
  top?: boolean;
  x: number;
  y: number;
  radius: number;
  ghost: HTMLElement;
}
type Pointer =
  | { kind: "stick"; ox: number; oy: number }
  | { kind: "look"; x: number; y: number }
  | { kind: "fire"; x: number; y: number }
  | { kind: "hold"; action: TouchHold }
  | { kind: "scores" }
  | { kind: "spent" };

/**
 * The right thumb's cluster, laid out like common mobile shooters: a large fire button that also
 * aims while held, jump and weapon swap on the outer edge, crouch below and scope above.
 * Every centre is at least the sum of both radii apart, so neighbouring buttons never overlap.
 */
const layout: Omit<Button, "x" | "y" | "radius" | "ghost">[] = [
  { id: "fire", label: "FIRE", dx: 118, dy: 128, r: 50 },
  { id: "alt", label: "SCOPE", dx: 120, dy: 245, r: 32 },
  { id: "reload", label: "RELOAD", dx: 222, dy: 200, r: 30 },
  { id: "use", label: "USE", dx: 232, dy: 92, r: 30 },
  { id: "jump", label: "JUMP", dx: 40, dy: 184, r: 32 },
  { id: "swap", label: "SWAP", dx: 42, dy: 72, r: 30 },
  { id: "crouch", label: "CROUCH", dx: 150, dy: 36, r: 28 },
  { id: "pause", label: "", dx: 30, dy: 30, r: 26, top: true },
];
/** The movement stick claims touches that start left of this fraction of the width. */
const STICK_ZONE = 0.4;
const STICK_RADIUS = 58;
const DEAD_ZONE = 0.16;
const WALK_BELOW = 0.62;

/** A scale drawing of the touch layout on a 20:9 phone, built from the same positions the game uses. */
export function controlsDiagram() {
  const W = 866,
    H = 400;
  const box = document.createElement("div");
  box.className = "csw-touch-diagram";
  box.setAttribute("role", "img");
  box.setAttribute(
    "aria-label",
    "Touch layout: movement on the left half, aiming on the right, buttons around the right thumb",
  );
  const put = (el: HTMLElement, x: number, y: number, r: number) => {
    Object.assign(el.style, {
      left: ((x - r) / W) * 100 + "%",
      top: ((y - r) / H) * 100 + "%",
      width: ((2 * r) / W) * 100 + "%",
      height: ((2 * r) / H) * 100 + "%",
    });
    box.append(el);
  };
  const stick = document.createElement("div");
  stick.className = "csw-touch-stick";
  stick.innerHTML = "<i></i><span>MOVE</span>";
  put(stick, W * 0.17, H * 0.66, STICK_RADIUS);
  const look = document.createElement("div");
  look.className = "csw-touch-look";
  look.textContent = "DRAG TO AIM";
  Object.assign(look.style, { left: "50%", top: "58%" });
  box.append(look);
  for (const b of layout) {
    const el = document.createElement("div");
    el.className = "csw-touch-btn csw-touch-" + b.id;
    el.textContent = b.label;
    put(el, W - b.dx, b.top ? b.dy : H - b.dy, b.r);
  }
  return box;
}

export interface TouchControls {
  /** Shows the very translucent control guide, then fades it once `hide` is called. */
  reveal(): void;
  hide(): void;
  readonly revealed: boolean;
  /** Releases every held button and the stick, e.g. when a menu opens. */
  reset(): void;
  layout(): void;
}

/**
 * Invisible touch controls over the game view. Nothing is drawn during play: the left side is a
 * floating movement stick, a drag anywhere else on the right side aims, and the right thumb's
 * buttons sit at fixed spots that `reveal` briefly outlines at the start of a match.
 *
 * HUD readouts double as controls: tap the radar or cash to buy, hold the score strip for the
 * scoreboard, tap an inventory item to draw it, and hold the objective prompt to plant or defuse.
 */
export function mountTouchControls(
  stage: HTMLElement,
  hud: HTMLElement,
  handlers: TouchHandlers,
  signal: AbortSignal,
): TouchControls {
  const layer = document.createElement("div");
  layer.className = "csw-touch";
  layer.setAttribute("aria-hidden", "true");
  const guide = document.createElement("div");
  guide.className = "csw-touch-guide";
  const stickGhost = document.createElement("div");
  stickGhost.className = "csw-touch-stick";
  stickGhost.innerHTML = "<i></i><span>MOVE</span>";
  const lookGhost = document.createElement("div");
  lookGhost.className = "csw-touch-look";
  lookGhost.textContent = "DRAG TO AIM";
  guide.append(stickGhost, lookGhost);
  const buttons: Button[] = layout.map((b) => {
    const ghost = document.createElement("div");
    ghost.className = "csw-touch-btn csw-touch-" + b.id;
    ghost.textContent = b.label;
    guide.append(ghost);
    return { ...b, x: 0, y: 0, radius: 0, ghost };
  });
  const hints = (
    [
      ["cash", "TAP TO BUY"],
      ["clock", "HOLD: SCORES"],
      ["inventory", "TAP TO EQUIP"],
    ] as const
  ).map(([ui, text]) => {
    const hint = document.createElement("div");
    hint.className = "csw-touch-hint";
    hint.textContent = text;
    guide.append(hint);
    return { ui, hint };
  });
  layer.append(guide);
  // Below the HUD so its menus stay tappable; the HUD itself ignores pointers during play.
  stage.insertBefore(layer, hud);

  const pointers = new Map<number, Pointer>();
  let width = 0,
    height = 0,
    scale = 1,
    stickX = 0,
    stickY = 0,
    crouched = false,
    revealed = false,
    fadeTimer = 0;

  function place() {
    const box = layer.getBoundingClientRect();
    const pad = getComputedStyle(layer);
    const inset = {
      top: parseFloat(pad.paddingTop) || 0,
      right: parseFloat(pad.paddingRight) || 0,
      bottom: parseFloat(pad.paddingBottom) || 0,
      left: parseFloat(pad.paddingLeft) || 0,
    };
    width = box.width;
    height = box.height;
    // Thumbs do not grow with the screen, so buttons scale only a little on tablets.
    scale = Math.max(0.82, Math.min(1.35, height / 400));
    for (const b of buttons) {
      b.radius = b.r * scale;
      b.x = width - inset.right - b.dx * scale;
      b.y = b.top ? inset.top + b.dy * scale : height - inset.bottom - b.dy * scale;
      Object.assign(b.ghost.style, {
        left: b.x - b.radius + "px",
        top: b.y - b.radius + "px",
        width: b.radius * 2 + "px",
        height: b.radius * 2 + "px",
      });
    }
    const r = STICK_RADIUS * scale;
    Object.assign(stickGhost.style, {
      left: inset.left + width * 0.17 - r + "px",
      top: height * 0.66 - r + "px",
      width: r * 2 + "px",
      height: r * 2 + "px",
    });
    Object.assign(lookGhost.style, {
      left: width * 0.5 + "px",
      top: height * 0.58 + "px",
    });
  }
  function placeHints() {
    const box = layer.getBoundingClientRect();
    for (const { ui, hint } of hints) {
      const el = hud.querySelector<HTMLElement>(`[data-ui=${ui}]`);
      const r = el?.getBoundingClientRect();
      hint.hidden = !r || !r.width;
      if (!r || !r.width) continue;
      const below = ui !== "inventory";
      Object.assign(hint.style, {
        left: r.left - box.left + r.width / 2 + "px",
        top: (below ? r.bottom - box.top + 4 : r.top - box.top - 4) + "px",
        transform: below ? "translateX(-50%)" : "translate(-50%, -100%)",
      });
    }
  }

  const within = (r: DOMRect | undefined, x: number, y: number, grow = 0) =>
    !!r &&
    r.width > 0 &&
    x >= r.left - grow &&
    x <= r.right + grow &&
    y >= r.top - grow &&
    y <= r.bottom + grow;
  const rect = (selector: string) => hud.querySelector<HTMLElement>(selector)?.getBoundingClientRect();

  /** HUD readouts that act as controls, checked before the invisible buttons. */
  function hudTarget(cx: number, cy: number): Pointer | undefined {
    // The item under the finger wins; a few pixels of slack only for near misses, so a
    // neighbouring item can never steal a tap that landed squarely on another.
    const items = [...hud.querySelectorAll<HTMLElement>(".csw-inventory li[data-slot]")],
      item =
        items.find((i) => within(i.getBoundingClientRect(), cx, cy, 0)) ??
        items.find((i) => within(i.getBoundingClientRect(), cx, cy, 3));
    if (item) {
      handlers.slot(Number(item.dataset.slot));
      tick();
      return { kind: "spent" };
    }
    if (within(rect(".csw-intel"), cx, cy, 6)) {
      handlers.buy();
      tick();
      return { kind: "spent" };
    }
    if (within(rect(".csw-strip"), cx, cy, 8)) {
      handlers.scoreboard(true);
      return { kind: "scores" };
    }
    const prompt = hud.querySelector<HTMLElement>("[data-ui=prompt][data-hold]");
    if (prompt && within(prompt.getBoundingClientRect(), cx, cy, 18)) {
      handlers.hold("use", true);
      tick();
      return { kind: "hold", action: "use" };
    }
  }
  function button(x: number, y: number) {
    let best: Button | undefined,
      distance = Infinity;
    for (const b of buttons) {
      // A little forgiveness beyond the drawn edge; the nearest centre wins.
      const d = Math.hypot(x - b.x, y - b.y);
      if (d <= b.radius * 1.18 && d < distance) {
        best = b;
        distance = d;
      }
    }
    return best;
  }
  function press(b: Button, x: number, y: number): Pointer {
    switch (b.id) {
      case "fire":
        handlers.hold("fire", true);
        return { kind: "fire", x, y };
      case "pause":
        handlers.pause();
        return { kind: "spent" };
      case "swap":
        handlers.slot(-1);
        tick();
        return { kind: "spent" };
      case "crouch":
        crouched = !crouched;
        handlers.hold("crouch", crouched);
        tick();
        return { kind: "spent" };
      default:
        handlers.hold(b.id, true);
        tick();
        return { kind: "hold", action: b.id };
    }
  }
  function steer(p: Extract<Pointer, { kind: "stick" }>, x: number, y: number) {
    const r = STICK_RADIUS * scale;
    let dx = x - p.ox,
      dy = y - p.oy;
    const length = Math.hypot(dx, dy);
    // The stick's base trails a finger that runs past the rim, so reversing is instant.
    if (length > r) {
      p.ox = x - (dx / length) * r;
      p.oy = y - (dy / length) * r;
      dx = x - p.ox;
      dy = y - p.oy;
    }
    stickX = dx / r;
    stickY = dy / r;
    const amount = Math.min(1, Math.hypot(stickX, stickY));
    if (amount < DEAD_ZONE) handlers.move(0, 0, false);
    else handlers.move(stickX / amount, -stickY / amount, amount < WALK_BELOW);
  }
  function release(id: number) {
    const p = pointers.get(id);
    pointers.delete(id);
    if (!p) return;
    if (p.kind === "stick") handlers.move(0, 0, false);
    else if (p.kind === "fire") handlers.hold("fire", false);
    else if (p.kind === "hold") handlers.hold(p.action, false);
    else if (p.kind === "scores") handlers.scoreboard(false);
  }

  layer.addEventListener(
    "pointerdown",
    (event) => {
      event.preventDefault();
      handlers.touched();
      layer.setPointerCapture(event.pointerId);
      const box = layer.getBoundingClientRect();
      const x = event.clientX - box.left,
        y = event.clientY - box.top;
      let p = hudTarget(event.clientX, event.clientY);
      const b = p ? undefined : button(x, y);
      if (b) p = press(b, x, y);
      else if (!p) {
        const stickBusy = [...pointers.values()].some((q) => q.kind === "stick");
        if (x < width * STICK_ZONE && !stickBusy) {
          p = { kind: "stick", ox: x, oy: y };
          handlers.move(0, 0, false);
        } else if (x >= width * STICK_ZONE) {
          // The newest finger steers the camera; an older look drag just stops.
          for (const [id, q] of pointers) if (q.kind === "look") pointers.set(id, { kind: "spent" });
          p = { kind: "look", x, y };
        } else p = { kind: "spent" };
      }
      pointers.set(event.pointerId, p);
    },
    { signal },
  );
  layer.addEventListener(
    "pointermove",
    (event) => {
      const p = pointers.get(event.pointerId);
      if (!p) return;
      const box = layer.getBoundingClientRect();
      const x = event.clientX - box.left,
        y = event.clientY - box.top;
      if (p.kind === "stick") steer(p, x, y);
      else if (p.kind === "look" || p.kind === "fire") {
        handlers.look(x - p.x, y - p.y);
        p.x = x;
        p.y = y;
      }
    },
    { signal },
  );
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const)
    layer.addEventListener(type, (event) => release(event.pointerId), { signal });
  // Long presses must not open the text selection or context menu over the game.
  layer.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });
  // No synthetic click after a touch: a tap that opens a menu would otherwise "click" whatever
  // part of that menu now sits under the finger.
  layer.addEventListener("touchend", (event) => event.preventDefault(), { signal, passive: false });

  const observer = new ResizeObserver(() => {
    place();
    if (revealed) placeHints();
  });
  observer.observe(layer);
  signal.addEventListener("abort", () => {
    observer.disconnect();
    clearTimeout(fadeTimer);
    layer.remove();
  });
  place();

  const controls: TouchControls = {
    get revealed() {
      return revealed;
    },
    reveal() {
      clearTimeout(fadeTimer);
      revealed = true;
      place();
      // The HUD lays out on its first update, a frame after the match mounts.
      requestAnimationFrame(placeHints);
      layer.classList.add("csw-touch-reveal");
    },
    hide() {
      revealed = false;
      layer.classList.remove("csw-touch-reveal");
    },
    reset() {
      for (const id of [...pointers.keys()]) {
        release(id);
        // Keep tracking the finger so its remaining moves do nothing until it lifts.
        pointers.set(id, { kind: "spent" });
      }
      if (crouched) handlers.hold("crouch", false);
      crouched = false;
      handlers.move(0, 0, false);
    },
    layout: place,
  };
  return controls;
}
