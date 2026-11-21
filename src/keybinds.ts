import "./keybinds.css";

/** Rebindable actions, in the order the editor lists them. Escape is reserved for pause. */
export const actions = [
  ["forward", "Move forward"],
  ["back", "Move back"],
  ["left", "Strafe left"],
  ["right", "Strafe right"],
  ["jump", "Jump"],
  ["crouch", "Crouch"],
  ["walk", "Walk"],
  ["fire", "Fire / throw"],
  ["alt", "Scope / lob"],
  ["reload", "Reload"],
  ["use", "Plant / defuse"],
  ["primary", "Primary weapon"],
  ["pistol", "Pistol"],
  ["grenade", "Cycle grenades"],
  ["bomb", "C4"],
  ["previous", "Previous weapon"],
  ["next", "Next weapon"],
  ["buy", "Buy menu"],
  ["scoreboard", "Scoreboard"],
] as const;
export type Action = (typeof actions)[number][0];
export type Binds = Record<Action, string[]>;
export const defaultBinds: Binds = {
  forward: ["KeyW"],
  back: ["KeyS"],
  left: ["KeyA"],
  right: ["KeyD"],
  jump: ["Space"],
  crouch: ["ControlLeft", "ControlRight"],
  walk: ["ShiftLeft", "ShiftRight"],
  fire: ["Mouse0"],
  alt: ["Mouse2"],
  reload: ["KeyR"],
  use: ["KeyE"],
  primary: ["Digit1"],
  pistol: ["Digit2"],
  grenade: ["Digit4"],
  bomb: ["Digit5"],
  previous: ["KeyQ"],
  next: [],
  buy: ["KeyB"],
  scoreboard: ["Tab"],
};
const storageKey = "cs-web:keybinds";
function load(): Binds {
  const out = structuredClone(defaultBinds);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    for (const [a] of actions)
      if (
        Array.isArray(saved?.[a]) &&
        saved[a].every((c: unknown) => typeof c === "string" && c !== "Escape")
      )
        out[a] = saved[a].slice(0, 2);
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return out;
}
/** Live bindings shared by the game loop, HUD prompts and both editors. */
export const binds: Binds = load();
const listeners = new Set<() => void>();
export function onBindsChange(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(binds));
  } catch {
    /* Optional. */
  }
  for (const cb of listeners) cb();
}
/** Assigns a single input to an action, removing it from any other action. */
export function rebind(action: Action, code: string) {
  for (const [a] of actions) binds[a] = binds[a].filter((c) => c !== code);
  binds[action] = [code];
  save();
}
export function clearBind(action: Action) {
  binds[action] = [];
  save();
}
export function resetBinds() {
  Object.assign(binds, structuredClone(defaultBinds));
  save();
}
const reverse = () => {
  const map = new Map<string, Action>();
  for (const [a] of actions) for (const c of binds[a]) map.set(c, a);
  return map;
};
let cache: Map<string, Action> | null = null;
onBindsChange(() => (cache = null));
export function actionFor(code: string): Action | undefined {
  return (cache ??= reverse()).get(code);
}
export function isBound(action: Action, code: string) {
  return binds[action].includes(code);
}
const names: Record<string, string> = {
  Mouse0: "Mouse 1",
  Mouse1: "Mouse 3",
  Mouse2: "Mouse 2",
  Mouse3: "Mouse 4",
  Mouse4: "Mouse 5",
  ControlLeft: "Ctrl",
  ControlRight: "Right Ctrl",
  ShiftLeft: "Shift",
  ShiftRight: "Right Shift",
  AltLeft: "Alt",
  AltRight: "Right Alt",
  MetaLeft: "Win",
  MetaRight: "Right Win",
  Space: "Space",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  CapsLock: "Caps Lock",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};
export function codeName(code: string) {
  return (
    names[code] ??
    code
      .replace(/^Key/, "")
      .replace(/^Digit/, "")
      .replace(/^Numpad/, "Num ")
  );
}
/** Human label for an action's current binding, e.g. "E" or "Shift". */
export function keyName(action: Action) {
  return binds[action].length ? binds[action].map(codeName).join(" / ") : "—";
}
/** Every key the game wants delivered while playing fullscreen; Escape stays with the browser. */
export const lockedKeys = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => "Key" + c),
  ..."0123456789".split("").map((c) => "Digit" + c),
  ..."0123456789".split("").map((c) => "Numpad" + c),
  ...Array.from({ length: 12 }, (_, i) => "F" + (i + 1)).filter(
    (k) => k !== "F11",
  ),
  "Tab",
  "Space",
  "Enter",
  "Backspace",
  "CapsLock",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ContextMenu",
];

/**
 * Renders a list of actions with buttons; clicking one waits for the next key or
 * mouse button. Escape cancels, Backspace/Delete clears. Returns a cleanup function.
 */
export function mountBindEditor(host: HTMLElement) {
  const ctrl = new AbortController();
  const signal = ctrl.signal;
  host.classList.add("csw-binds");
  let waiting: Action | null = null;
  let stopCapture: (() => void) | null = null;
  function draw(
    note = "Click a binding, then press a key or mouse button. Esc cancels, Backspace clears.",
  ) {
    host.innerHTML =
      '<div class="csw-bindlist">' +
      actions
        .map(
          ([a, label]) =>
            `<div class="csw-bindrow"><span>${label}</span><button type="button" data-bind="${a}" class="${waiting === a ? "csw-waiting" : ""}">${waiting === a ? "Press a key…" : keyName(a)}</button></div>`,
        )
        .join("") +
      '<div class="csw-bindrow csw-fixed"><span>Pause / leave fullscreen</span><kbd>Esc</kbd></div></div>' +
      `<p class="csw-bindnote" aria-live="polite">${note}</p>` +
      '<button type="button" class="csw-bindreset" data-bind-reset>Reset to defaults</button>';
  }
  function finish(note?: string) {
    waiting = null;
    stopCapture?.();
    stopCapture = null;
    draw(note);
  }
  function capture(action: Action) {
    stopCapture?.();
    waiting = action;
    draw();
    const inner = new AbortController();
    const opt = { capture: true, signal: inner.signal };
    stopCapture = () => inner.abort();
    const take = (code: string, e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (code === "Escape") return finish("Cancelled.");
      if (code === "Backspace" || code === "Delete") {
        clearBind(action);
        return finish("Cleared.");
      }
      const before = actionFor(code);
      rebind(action, code);
      finish(
        before && before !== action
          ? `${codeName(code)} moved from ${actions.find(([a]) => a === before)![1]}.`
          : `${codeName(code)} bound.`,
      );
    };
    window.addEventListener("keydown", (e) => take(e.code, e), opt);
    window.addEventListener(
      "keyup",
      (e) => {
        e.stopImmediatePropagation();
      },
      opt,
    );
    window.addEventListener(
      "mousedown",
      (e) => take("Mouse" + e.button, e),
      opt,
    );
    window.addEventListener("contextmenu", (e) => e.preventDefault(), opt);
  }
  host.addEventListener(
    "click",
    (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.hasAttribute("data-bind-reset")) {
        resetBinds();
        finish("Defaults restored.");
      } else if (b.dataset.bind && !waiting) capture(b.dataset.bind as Action);
    },
    { signal },
  );
  draw();
  return () => {
    stopCapture?.();
    ctrl.abort();
  };
}
