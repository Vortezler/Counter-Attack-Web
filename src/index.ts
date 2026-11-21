import "./game.css";
import {
  mergeSettings,
  mountMenu,
  type MenuChoice,
  type MenuSettings,
} from "./menu";
import { hubUrl } from "./hub/navigation";
import { savePlayerName, writeSetting } from "./hub/storage";
import type { GameRenderer } from "./render";
import type { Sim, SimEvent } from "./sim/Sim";
import type { PlayerCommand } from "./sim/player";
import type { MatchHud } from "./hud";
import { GameAudio } from "./audio";
import type { MapId } from "./world";
import { catalog, isGun } from "./config/weapons";
export interface GameOptions extends Partial<Omit<MenuChoice, "settings">> {
  seed?: number;
  showMenu?: boolean;
  autostart?: boolean;
  onExit?: () => void;
  debug?: boolean;
  scene?: "range";
  botsOnly?: boolean;
  fly?: boolean;
  notice?: string;
}
export interface GameHandle {
  destroy(): void;
  pause(): void;
  resume(): void;
  resize(): void;
  on(
    event: "roundEnd" | "matchEnd" | "kill" | "ready",
    cb: (e: SimEvent) => void,
  ): () => void;
}
const DT = 1 / 64;
export async function createGame(
  container: HTMLElement,
  opts: GameOptions = {},
): Promise<GameHandle> {
  const root = document.createElement("div");
  root.className = "csw-root";
  container.append(root);
  const lifetime = new AbortController(),
    signal = lifetime.signal;
  const audio = new GameAudio((a, b) => !!sim && !sim.visible(a, b));
  let choice: MenuChoice = {
    map: opts.map ?? "dust2",
    side: opts.side ?? "CT",
    difficulty: opts.difficulty ?? "normal",
    playerName: opts.playerName ?? "Player",
    settings: mergeSettings(),
  };
  let menu: ReturnType<typeof mountMenu> | null = null,
    sim: Sim | null = null,
    renderer: GameRenderer | null = null,
    hud: MatchHud | null = null,
    canvas: HTMLCanvasElement | null = null,
    stage: HTMLElement | null = null;
  let roundListeners: AbortController | null = null,
    raf = 0,
    disposed = false,
    generation = 0,
    paused = false,
    prev = 0,
    acc = 0,
    frameRate = 60,
    yaw = 0,
    pitch = 0,
    round = 0;
  let aimEye = 0,
    mouseLeft = false,
    mouseRight = false,
    slot = 0,
    wasLocked = false,
    ready = false;
  const keys = new Set<string>(),
    presses = new Set<string>(),
    events = new Map<string, Set<(e: SimEvent) => void>>();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const fly = !!opts.fly;
  let flyPos = { x: 0, y: 0, z: 0 };
  const currentLock = () => !!canvas && document.pointerLockElement === canvas;
  function clearInput() {
    keys.clear();
    presses.clear();
    mouseLeft = mouseRight = false;
    slot = 0;
  }
  function release() {
    if (currentLock()) document.exitPointerLock?.();
    clearInput();
  }
  function teardown() {
    ready = false;
    generation++;
    cancelAnimationFrame(raf);
    raf = 0;
    roundListeners?.abort();
    roundListeners = null;
    menu?.destroy();
    menu = null;
    release();
    wasLocked = false;
    hud?.destroy();
    hud = null;
    renderer?.dispose();
    renderer = null;
    sim?.dispose();
    sim = null;
    stage?.remove();
    stage = null;
    canvas = null;
    paused = false;
    acc = 0;
    round = 0;
    aimEye = 0;
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    teardown();
    lifetime.abort();
    audio.dispose();
    events.clear();
    root.remove();
  }
  function exit() {
    destroy();
    if (opts.onExit) opts.onExit();
    else location.assign(hubUrl());
  }
  function settings(value: MenuSettings) {
    choice.settings = value;
    audio.volume = value.volume;
    writeSetting("settings", value);
    if (hud) {
      hud.root.style.fontSize = 16 * value.hudScale + "px";
      hud.root.classList.toggle("dot", value.crosshair === "dot");
    }
  }
  function lock() {
    if (!canvas || currentLock()) return;
    try {
      const result = canvas.requestPointerLock?.();
      if (result)
        result.catch(() =>
          hud?.note("Click the game view to enable mouse look."),
        );
    } catch {
      hud?.note("Click the game view to enable mouse look.");
    }
  }
  function pause() {
    if (!sim || !hud || sim.phase === "finished") return;
    paused = true;
    clearInput();
    hud.pause();
    release();
  }
  function resume() {
    if (!sim || !hud || sim.phase === "finished") return;
    hud.close();
    paused = false;
    acc = 0;
    prev = performance.now();
    audio.unlock();
    canvas?.focus();
    lock();
  }
  function config() {
    if (!hud) return;
    paused = true;
    hud.settings(
      choice.settings.volume,
      choice.settings.sensitivity,
      choice.settings.shadows,
      (key, v) => settings({ ...choice.settings, [key]: v }),
    );
  }
  function menuScreen() {
    teardown();
    const next = mountMenu(root, {
      ...choice,
      notice: opts.notice,
      hubHref: hubUrl(),
      onSettings: settings,
      onExit: exit,
      onStart: (c) => {
        void start(c, true);
      },
    });
    menu = next;
  }
  function notify(e: SimEvent) {
    for (const cb of events.get(e.type) ?? []) cb(e);
  }
  function ingest(e: SimEvent) {
    const s = sim;
    if (!s) return;
    hud?.event(e);
    audio.play(e);
    if (e.type === "shot" && e.pos && e.end)
      renderer?.shot(e.pos, e.end, e.weapon, e.actor === 0);
    if (e.type === "impact" && e.pos && e.normal)
      renderer?.impact(e.pos, e.normal);
    if (opts.debug && e.type === "trace" && e.actor === 0 && e.pos && e.end)
      renderer?.trace(e.pos, e.end, e.message ?? "air");
    if ((e.type === "explosion" || e.type === "flash") && e.pos)
      renderer?.burst(e.pos, e.type);
    if (e.type === "matchEnd") {
      paused = true;
      release();
    }
    notify(e);
  }
  async function start(c: MenuChoice, gesture: boolean) {
    try {
      c.playerName = savePlayerName(c.playerName);
    } catch {
      menu?.openSettings();
      return;
    }
    teardown();
    const token = generation;
    choice = c;
    settings(c.settings);
    stage = document.createElement("div");
    stage.className = "csw-game";
    root.append(stage);
    canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "First-person game view");
    stage.append(canvas);
    const status = document.createElement("div");
    status.className = "csw-loading";
    status.setAttribute("role", "status");
    status.textContent =
      "Loading " +
      (opts.scene === "range"
        ? "practice range"
        : choice.map === "dust2"
          ? "Dust2"
          : "Mirage") +
      "…";
    stage.append(status);
    if (gesture) {
      audio.unlock();
      lock();
    }
    try {
      const [engine, physics, simulation, world, overlay] = await Promise.all([
        import("./render"),
        import("./sim/Physics"),
        import("./sim/Sim"),
        import("./world"),
        import("./hud"),
      ]);
      await physics.initPhysics();
      if (disposed || token !== generation) return;
      const id: MapId = opts.scene ?? c.map;
      const map = world.maps[id];
      sim = new simulation.Sim(
        map,
        c.side,
        c.difficulty,
        c.playerName,
        opts.seed ?? (Math.random() * 0xffffffff) >>> 0,
        opts.botsOnly,
      );
      renderer = new engine.GameRenderer(canvas!, map);
      hud = new overlay.MatchHud(
        stage!,
        sim,
        {
          resume,
          pause,
          restart: () => {
            void start(choice, true);
          },
          lobby: menuScreen,
          exit,
          settings: config,
        },
        opts.debug,
      );
      sim.onEvent(ingest);
      status.remove();
      settings(c.settings);
      yaw = sim.me.yaw;
      pitch = 0;
      flyPos = { ...sim.me.eye };
      prev = performance.now();
      acc = 0;
      wasLocked = currentLock();
      bindRound();
      ready = true;
      notify({ type: "ready" });
      raf = requestAnimationFrame(frame);
    } catch (error) {
      if (token !== generation || disposed) return;
      teardown();
      const block = document.createElement("section");
      block.className = "csw-error";
      block.setAttribute("role", "alert");
      const p = document.createElement("p");
      p.textContent =
        "The game could not start. " +
        (error instanceof Error ? error.message : String(error)) +
        " Check that WebGL 2 is available in your browser.";
      block.append(p);
      const retry = document.createElement("button");
      retry.textContent = "Return to match setup";
      retry.onclick = () => {
        block.remove();
        menuScreen();
      };
      block.append(retry);
      const a = document.createElement("a");
      a.href = hubUrl();
      a.textContent = "Back to Game Hub";
      a.onclick = (e) => {
        e.preventDefault();
        exit();
      };
      block.append(a);
      root.append(block);
    }
  }
  function buyMenu() {
    if (!sim || !hud) return;
    if (hud.mode === "Buy menu") {
      resume();
      return;
    }
    if (!sim.canBuy(sim.me)) {
      hud.note("Buy in your spawn during the buy period.");
      return;
    }
    hud.shop();
    release();
  }
  function bindRound() {
    const ctrl = new AbortController();
    roundListeners = ctrl;
    const opt = { signal: ctrl.signal };
    const bar = hud!,
      s = sim!,
      surface = canvas!;
    stage!.addEventListener(
      "click",
      (e) => {
        if ((e.target as HTMLElement).closest("[data-action=exit]"))
          e.preventDefault();
      },
      opt,
    );
    surface.addEventListener(
      "click",
      () => {
        if (!bar.mode) {
          audio.unlock();
          lock();
        }
      },
      opt,
    );
    document.addEventListener(
      "pointerlockchange",
      () => {
        const locked = currentLock();
        if (wasLocked && !locked && !bar.mode && !paused) pause();
        wasLocked = locked;
        if (!locked) clearInput();
      },
      opt,
    );
    document.addEventListener(
      "mousemove",
      (e) => {
        if (
          currentLock() &&
          !paused &&
          (!bar.mode || bar.mode === "Scoreboard")
        ) {
          const zoom = s.me.scoped;
          const factor =
            ((choice.settings.sensitivity * 0.022 * Math.PI) / 180) *
            (zoom
              ? Math.tan(((zoom === 1 ? 40 : 10) * Math.PI) / 360) /
                Math.tan((choice.settings.fov * Math.PI) / 360)
              : 1);
          yaw += e.movementX * factor;
          pitch = Math.max(-1.55, Math.min(1.55, pitch - e.movementY * factor));
        }
      },
      opt,
    );
    document.addEventListener(
      "mousedown",
      (e) => {
        if (currentLock() && !paused && !bar.mode) {
          if (e.button === 0) {
            mouseLeft = true;
            presses.add("fire");
          }
          if (e.button === 2) {
            mouseRight = true;
            presses.add("alt");
          }
        }
      },
      opt,
    );
    document.addEventListener(
      "mouseup",
      (e) => {
        if (e.button === 0) mouseLeft = false;
        if (e.button === 2) mouseRight = false;
      },
      opt,
    );
    surface.addEventListener("contextmenu", (e) => e.preventDefault(), opt);
    surface.addEventListener(
      "wheel",
      (e) => {
        if (currentLock()) {
          e.preventDefault();
          slot = e.deltaY > 0 ? 9 : -9;
        }
      },
      { ...opt, passive: false },
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.code === "Escape") {
          if (s.phase === "finished") return;
          if (bar.mode === "Buy menu" || paused) resume();
          else pause();
          return;
        }
        if (paused || s.phase === "finished") return;
        if (bar.mode === "Buy menu") {
          if (e.code === "KeyB" && !e.repeat) resume();
          if (/^Digit[1-6]$/.test(e.code)) {
            bar.tab = Number(e.code.slice(-1)) - 1;
            bar.shop();
          }
          return;
        }
        if (e.code === "KeyB" && !e.repeat) {
          buyMenu();
          return;
        }
        if (
          e.code === "Tab" &&
          (currentLock() || document.activeElement === surface)
        ) {
          e.preventDefault();
          if (!e.repeat) bar.scoreboard();
          return;
        }
        if (!currentLock()) return;
        if (
          [
            "Space",
            "ControlLeft",
            "ControlRight",
            "ShiftLeft",
            "ShiftRight",
            "KeyW",
            "KeyA",
            "KeyS",
            "KeyD",
            "KeyR",
            "KeyE",
            "Digit1",
            "Digit2",
            "Digit4",
            "Digit5",
            "KeyQ",
          ].includes(e.code)
        ) {
          e.preventDefault();
          keys.add(e.code);
          if (!e.repeat) presses.add(e.code);
          if (e.code.startsWith("Digit")) slot = Number(e.code.slice(-1));
          else if (e.code === "KeyQ") slot = -1;
        }
      },
      opt,
    );
    document.addEventListener(
      "keyup",
      (e) => {
        keys.delete(e.code);
        if (e.code === "Tab" && bar.mode === "Scoreboard") {
          bar.close();
          surface.focus();
        }
      },
      opt,
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) pause();
      },
      opt,
    );
    window.addEventListener(
      "blur",
      () => {
        if (currentLock()) pause();
      },
      opt,
    );
  }
  function command(): PlayerCommand {
    const x = Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
      z = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
    const cmd = {
      moveX: fly ? 0 : x,
      moveZ: fly ? 0 : z,
      yaw,
      pitch,
      fire: mouseLeft || presses.has("fire"),
      alt: mouseRight || presses.has("alt"),
      jump: keys.has("Space") || presses.has("Space"),
      walk: keys.has("ShiftLeft") || keys.has("ShiftRight"),
      crouch: keys.has("ControlLeft") || keys.has("ControlRight"),
      use: keys.has("KeyE"),
      reload: keys.has("KeyR") || presses.has("KeyR"),
      slot,
    };
    slot = 0;
    presses.clear();
    if (fly) {
      flyPos.x += (x * Math.cos(yaw) + z * Math.sin(yaw)) * DT * 15;
      flyPos.z += (x * Math.sin(yaw) - z * Math.cos(yaw)) * DT * 15;
      flyPos.y += (Number(cmd.jump) - Number(cmd.crouch)) * DT * 12;
    }
    return cmd;
  }
  function frame(now: number) {
    const s = sim,
      view = renderer,
      bar = hud;
    if (!s || !view || !bar || disposed) return;
    const elapsed = Math.min(0.18, (now - prev) / 1000);
    prev = now;
    if (elapsed > 0) frameRate += (1 / elapsed - frameRate) * 0.04;
    if (!paused) {
      acc += elapsed;
      while (acc >= DT) {
        if (round !== s.round) {
          yaw = s.me.yaw;
          pitch = 0;
          round = s.round;
        }
        const c = command();
        s.step(opts.botsOnly ? {} : { 0: c });
        acc -= DT;
        if (bar.mode === "Buy menu" && !s.canBuy(s.me)) {
          bar.close();
          bar.note("Buy period ended. Click to capture mouse.");
        }
      }
    }
    const me = s.me;
    const watched = me.alive
      ? me
      : (s.players
          .filter((p) => p.team === me.team && p.alive)
          .sort(
            (a, b) =>
              Math.hypot(a.x - me.x, a.z - me.z) -
              Math.hypot(b.x - me.x, b.z - me.z),
          )[0] ?? me);
    const alpha = Math.max(0, Math.min(1, acc / DT)),
      lerp = (a: number, b: number) => a + (b - a) * alpha;
    const x = lerp(watched.last.x, watched.x),
      z = lerp(watched.last.z, watched.z);
    const eyeTarget = watched.eye.y;
    if (!aimEye || Math.abs(aimEye - eyeTarget) > 1.5) aimEye = eyeTarget;
    else
      aimEye +=
        (eyeTarget - aimEye) * (1 - Math.exp(-Math.max(0.001, elapsed) * 18));
    const useMouse = watched === me && !opts.botsOnly;
    const cam = {
      ...(fly ? flyPos : { x, y: aimEye, z }),
      yaw:
        (useMouse ? yaw : watched.yaw) +
        (watched.punchY * 0.45 * Math.PI) / 180,
      pitch:
        (useMouse ? pitch : watched.pitch) +
        (watched.punchX * 0.45 * Math.PI) / 180,
    };
    const weapon = watched.weapon;
    const props = {
      camera: cam,
      actors: s.players,
      viewId: watched.id,
      weapon,
      time: s.time,
      zoom: watched.scoped,
      fov: choice.settings.fov,
      shadows: choice.settings.shadows,
      debug: opts.debug,
      hitboxLines:
        opts.debug && s.tick % 4 === 0
          ? s.physics.world.debugRender(undefined, (c) => {
              const hit = s.physics.victims.get(c.handle);
              return !!hit && hit.id !== watched.id && s.players[hit.id].alive;
            }).vertices
          : undefined,
      spectating: !me.alive || fly,
      reducedMotion: reduced.matches,
      kick: Math.max(0, 1 - (s.time - watched.lastFire) / 0.12),
      move: Math.min(1, Math.hypot(watched.vx, watched.vz) / 6),
      reload:
        watched.reloadEnd && isGun(weapon)
          ? 1 - (watched.reloadEnd - s.time) / catalog[weapon].reload
          : 0,
      alpha,
      bomb: s.bomb,
      grenades: s.grenades.map((g) => ({
        ...g.body.translation(),
        type: g.type,
        id: g.id,
      })),
    };
    view.render(props);
    audio.updateListener(cam, cam.yaw, cam.pitch);
    bar.update(watched, frameRate, currentLock(), reduced.matches);
    raf = requestAnimationFrame(frame);
  }
  window.addEventListener("resize", () => renderer?.resize(), { signal });
  const handle = {
    destroy,
    pause,
    resume,
    resize: () => renderer?.resize(),
    on(event: string, cb: (e: SimEvent) => void) {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(cb);
      if (event === "ready" && ready) cb({ type: "ready" });
      return () => events.get(event)?.delete(cb);
    },
  };
  if (opts.autostart || opts.showMenu === false) await start(choice, false);
  else menuScreen();
  return handle;
}
