interface TouchControls {
  hold(key: string, down: boolean): void;
  look(dx: number, dy: number): void;
  buy(): void;
  pause(): void;
}

export function mountTouchControls(
  stage: HTMLElement, canvas: HTMLCanvasElement, controls: TouchControls, signal: AbortSignal,
) {
  const group = document.createElement("div");
  group.className = "csw-touch";
  group.setAttribute("aria-label", "Touch controls");
  const move = document.createElement("div");
  move.className = "csw-touch-move";
  const actions = document.createElement("div");
  actions.className = "csw-touch-actions";
  function key(parent: HTMLElement, label: string, code: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("pointerdown", event => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      controls.hold(code, true);
    }, { signal });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(event, () => controls.hold(code, false), { signal });
    }
    parent.append(button);
  }
  for (const [label, code] of [["↑", "KeyW"], ["←", "KeyA"], ["↓", "KeyS"], ["→", "KeyD"]]) {
    key(move, label, code);
  }
  for (const [label, code] of [["Fire", "fire"], ["Aim", "alt"], ["Reload", "KeyR"],
    ["Use", "KeyE"], ["Jump", "Space"], ["Switch", "KeyQ"]]) key(actions, label, code);
  for (const [label, action] of [["Buy", controls.buy], ["Pause", controls.pause]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action, { signal });
    actions.append(button);
  }
  group.append(move, actions);
  stage.append(group);
  let drag: { id: number; x: number; y: number } | undefined;
  canvas.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch" || drag) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, { signal });
  canvas.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    controls.look(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
  }, { signal });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(event, () => { drag = undefined; }, { signal });
  }
}
