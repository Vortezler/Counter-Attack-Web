import "./game.css";
import "./mobile.css";
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
import { idle, type PlayerCommand } from "./sim/player";
import { applyFrame, peerPlayer, projectFrame, readCommand, readEvent, record } from "./sim/peer-state";
import { GuestMotion } from "./sim/guest-motion";
import { mountTouchControls, type TouchControls } from "./touch-controls";
import { compactScreen, nativeApp, onBackButton, touchDevice } from "./platform";
import type { PeerMatch } from "./hub/peer-match";
import type { MatchHud } from "./hud";
import { GameAudio } from "./audio";
import { startAmbience, type Ambience } from "./ambience";
import type { MapId, floorAt } from "./world";
import { catalog, isGun } from "./config/weapons";
import {
  actionFor,
  binds,
  isBound,
  lockedKeys,
  type Action,
} from "./keybinds";

type KeyboardLock = { lock(codes?: string[]): Promise<void>; unlock(): void };
const keyboard = () =>
  (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
const slots: Partial<Record<Action, number>> = {
  primary: 1,
  pistol: 2,
  knife: 3,
  grenade: 4,
  bomb: 5,
  previous: -1,
  next: 9,
};
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
  peer?: PeerMatch;
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
  const audio = new GameAudio((a, b) => !!sim && !sim.visible(a, b, false));
  let choice: MenuChoice = {
    map: opts.map ?? "dust2",
    side: opts.side ?? "CT",
    difficulty: opts.difficulty ?? "normal",
    mode: opts.mode ?? "competitive",
    solo: opts.solo ?? false,
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
    hostTimer = 0,
    hostTime = 0,
    disposed = false,
    generation = 0,
    paused = false,
    prev = 0,
    acc = 0,
    frameRate = 60,
    yaw = 0,
    pitch = 0,
    round = 0;
  let floorOf: typeof floorAt | undefined;
  let ambience: Ambience | null = null;
  /** A weapon inspect started at sim time `at`; firing, reloading, scoping or switching ends it. */
  let inspecting: { at: number; weapon: string } | undefined;
  let aimEye = 0,
    kneel = 0,
    slot = 0,
    wantFullscreen = false,
    wasLocked = false,
    ready = false;
  const touchHeld = new Set<Action>(),
    touchTapped = new Set<Action>();
  const keys = new Set<string>(),
    presses = new Set<string>(),
    events = new Map<string, Set<(e: SimEvent) => void>>();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const fly = !!opts.fly;
  const network = opts.peer;
  const host = !!network?.launch.host;
  // Phones and tablets get touch controls in every mode, not only peer matches.
  const touch = touchDevice;
  /** Direction from the touch stick (unit length, or zero) and whether it is only lightly pushed. */
  let stick = { x: 0, z: 0, walk: false };
  let touchUi: TouchControls | null = null,
    revealedAt = 0;
  let remoteCommand: PlayerCommand | null = null;
  let remoteAt = 0;
  let remoteBuy: string | undefined;
  let remoteSlot: number | undefined;
  let remoteFrame: Record<string, unknown> | undefined;
  let positionReceivedAt = 0;
  let lastInputAt = 0;
  let lastInput: PlayerCommand | undefined;
  let acknowledged = { sequence: -1, tick: 0, stream: "" };
  const guestMotion = network && !host ? new GuestMotion() : undefined;
  const relayEvents: SimEvent[] = [];
  let remoteGrenades: ReturnType<typeof projectFrame>["grenades"] = [];
  let lastSentFrame = -1;
  let lastSentAt = 0;
  let inputTick = 0;
  let remoteTick = -1;
  if (network) network.onPacket = packet => {
    if (!record(packet)) return;
    if (host && packet.type === "input") {
      const input = readCommand(packet.command);
      if (!input || typeof packet.sequence !== "number" || !Number.isSafeInteger(packet.sequence)
        || packet.sequence < 0) return;
      // A reload creates a fresh input stream. Only the active channel can deliver it.
      if (typeof packet.stream !== "string" || packet.stream.length !== 36) return;
      if (packet.stream !== remoteStream) { remoteStream = packet.stream; remoteTick = -1; }
      if (packet.sequence <= remoteTick) return;
      remoteTick = packet.sequence;
      remoteCommand = input;
      remoteAt = performance.now();
      if (input.buy) remoteBuy = input.buy;
      if (input.slot) remoteSlot = input.slot;
    } else if (!host && packet.type === "frame") {
      remoteFrame = packet;
    } else if (!host && packet.type === "event") {
      const event = readEvent(packet.event);
      if (event) ingest(event);
    }
  };
  let remoteStream = "";
  const inputStream = network ? crypto.randomUUID() : "";
  let flyPos = { x: 0, y: 0, z: 0 };
  const currentLock = () => !!canvas && document.pointerLockElement === canvas;
  function clearInput() {
    keys.clear();
    presses.clear();
    touchHeld.clear();
    touchTapped.clear();
    stick = { x: 0, z: 0, walk: false };
    touchUi?.reset();
    slot = 0;
  }
  const fullscreen = () => !!document.fullscreenElement;
  /** Fullscreen plus a keyboard lock so browser shortcuts reach the game; Esc stays with the browser. */
  function enterFullscreen() {
    // The Android app already runs full screen with the system bars hidden.
    if (!choice.settings.fullscreen || nativeApp) return;
    wantFullscreen = true;
    const lockKeys = () => {
      if (fullscreen())
        void keyboard()
          ?.lock(lockedKeys)
          .catch(() => {});
    };
    if (fullscreen()) return lockKeys();
    try {
      void root
        .requestFullscreen?.({ navigationUI: "hide" })
        .then(() => {
          lockKeys();
          lock();
          // Phones play sideways; Android honours this in fullscreen, iOS ignores it.
          if (touch)
            void (
              screen.orientation as ScreenOrientation & {
                lock?: (o: string) => Promise<void>;
              }
            )
              ?.lock?.("landscape")
              .catch(() => {});
        })
        .catch(() => {});
    } catch {
      /* Fullscreen is optional, e.g. inside a sandboxed frame. */
    }
  }
  function leaveFullscreen() {
    wantFullscreen = false;
    keyboard()?.unlock();
    if (fullscreen()) void document.exitFullscreen?.().catch(() => {});
  }
  function release() {
    if (currentLock()) document.exitPointerLock?.();
    clearInput();
  }
  function teardown() {
    ready = false;
    generation++;
    cancelAnimationFrame(raf);
    clearInterval(hostTimer);
    raf = 0;
    roundListeners?.abort();
    roundListeners = null;
    touchUi = null;
    menu?.destroy();
    menu = null;
    release();
    leaveFullscreen();
    wasLocked = false;
    hud?.destroy();
    hud = null;
    renderer?.dispose();
    renderer = null;
    ambience?.stop();
    ambience = null;
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
    if (network) network.close(true);
    if (opts.onExit) opts.onExit();
    else location.assign(hubUrl());
  }
  function settings(value: MenuSettings) {
    choice.settings = value;
    audio.volume = value.volume;
    writeSetting("settings", value);
    if (hud) {
      // Phones in landscape are short, so the HUD shrinks with the screen.
      hud.root.style.fontSize =
        16 * value.hudScale * (compactScreen() ? 0.72 : 1) + "px";
      hud.root.classList.toggle("dot", value.crosshair === "dot");
    }
  }
  function lock() {
    if (!canvas || touch || currentLock()) return;
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
    leaveFullscreen();
  }
  function resume() {
    if (!sim || !hud || sim.phase === "finished") return;
    hud.close();
    paused = false;
    acc = 0;
    prev = performance.now();
    audio.unlock();
    canvas?.focus();
    enterFullscreen();
    lock();
  }
  function config() {
    if (!hud) return;
    paused = true;
    hud.settings(
      choice.settings.volume,
      choice.settings.sensitivity,
      choice.settings.shadows,
      choice.settings.fullscreen,
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
    // Footsteps carry only the eye position; the foot is a standing eye height below it.
    audio.play(
      e,
      e.type === "step" && e.pos && floorOf
        ? floorOf(s.map, e.pos.x, e.pos.y - 1.6256, e.pos.z)
        : undefined,
    );
    if (e.type === "shot" && e.pos && e.end)
      renderer?.shot(e.pos, e.end, e.weapon, e.actor);
    if (e.type === "blood") renderer?.bleed(e);
    if (e.type === "tracer" && e.pos && e.end)
      renderer?.shot(e.pos, e.end, "pellet", e.actor);
    if (e.type === "kill" && e.victim !== undefined && e.dir) {
      // Topple away from the attacker, but pick a direction with room to fall.
      const v = s.players[e.victim],
        chest = { x: v.x, y: v.y + 0.55, z: v.z },
        { x, z } = e.dir;
      const turn = (a: number) => ({
        x: x * Math.cos(a) - z * Math.sin(a),
        z: x * Math.sin(a) + z * Math.cos(a),
      });
      const dir =
        [0, 0.6, -0.6, 1.57, -1.57, Math.PI]
          .map(turn)
          .find((d) => !s.physics.ray(chest, { x: d.x, y: 0, z: d.z }, 1.9)) ??
        e.dir;
      renderer?.death(e.victim, dir, !!e.head, s.time);
    }
    if (e.type === "impact" && e.pos && e.normal)
      renderer?.impact(e.pos, e.normal);
    if (opts.debug && e.type === "trace" && e.actor === s.me.id && e.pos && e.end)
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
        : choice.map.charAt(0).toUpperCase() + choice.map.slice(1)) +
      "…";
    stage.append(status);
    if (gesture) {
      audio.unlock();
      enterFullscreen();
      lock();
    }
    try {
      const [engine, physics, simulation, world, overlay] = await Promise.all([
        import("./render"),
        import("./sim/Physics"),
        import("./sim/Sim"),
        import("./world"),
        import("./hud"),
        // Textured gun models; a failed fetch leaves the built-in ones in place.
        import("./gunModels").then((m) => m.loadGunModels(import.meta.env.BASE_URL)),
      ]);
      await physics.initPhysics();
      if (disposed || token !== generation) return;
      const id: MapId = opts.scene ?? c.map;
      const map = world.maps[id];
      floorOf = world.floorAt;
      // Deathmatch and battle royale run on their own rules and HUD (local matches only).
      const arena =
        !network && id !== "range" && (c.mode === "deathmatch" || c.mode === "royale")
          ? await Promise.all([import("./sim/arena"), import("./arena-hud")])
          : null;
      if (disposed || token !== generation) return;
      const seed = opts.seed ?? (Math.random() * 0xffffffff) >>> 0;
      sim = arena
        ? new arena[0].ArenaSim(map, c.side, c.difficulty, c.playerName, seed, opts.botsOnly, {
            kind: c.mode as "deathmatch" | "royale",
            solo: !!c.solo,
          })
        : new simulation.Sim(
            map,
            c.side,
            c.difficulty,
            c.playerName,
            seed,
            opts.botsOnly,
            c.mode === "casual" ? "casual" : "competitive",
          );
      if (network) {
        sim.remotePlayer = peerPlayer;
        sim.viewer = host ? 0 : peerPlayer;
        sim.players[0].name = network.launch.hostName;
        sim.players[peerPlayer].name = network.launch.peerName;
      }
      audio.self = sim.viewer;
      renderer = new engine.GameRenderer(canvas!, map, touch ? "low" : "high");
      ambience = startAmbience(map.id);
      hud = new (arena ? arena[1].ArenaHud : overlay.MatchHud)(
        stage!,
        sim,
        {
          resume,
          pause,
          restart: network ? exit : () => { void start(choice, true); },
          lobby: network ? exit : menuScreen,
          buy: network && !host ? item => {
            network.send({ type: "input", sequence: ++inputTick, stream: inputStream,
              command: { ...idle(yaw, pitch), buy: item } });
            return "Purchase requested";
          } : undefined,
          exit,
          settings: config,
          guide: () => {
            resume();
            touchUi?.reveal();
            revealedAt = performance.now();
          },
        },
        opts.debug,
      );
      hud.touch = touch;
      sim.onEvent(event => {
        ingest(event);
        if (host && event.type !== "trace" && event.type !== "matchEnd") {
          if (network?.relayed) {
            if (relayEvents.length < 12) relayEvents.push(event);
          } else network?.send({ type: "event", event });
        }
      });
      status.remove();
      settings(c.settings);
      // ?debug=1 exposes a read-only snapshot for the device test scripts.
      if (opts.debug)
        (globalThis as { cswProbe?: () => unknown }).cswProbe = () => {
          const me = sim?.me;
          return me && {
            phase: sim!.phase,
            x: me.x,
            y: me.y,
            z: me.z,
            yaw,
            pitch,
            weapon: me.weapon,
            ammo: me.mag?.ammo,
            scoped: me.scoped,
            reloading: !!me.reloadEnd,
            crouched: me.crouched,
            command: me.lastCmd,
            stick,
            mode: hud?.mode ?? "",
            paused,
            guide: !!touchUi?.revealed,
          };
        };
      yaw = sim.me.yaw;
      pitch = 0;
      flyPos = { ...sim.me.eye };
      prev = performance.now();
      acc = 0;
      wasLocked = currentLock();
      bindRound();
      ready = true;
      if (host) {
        hostTime = performance.now();
        hostTimer = window.setInterval(() => {
          const now = performance.now();
          advanceMatch(Math.min(0.25, (now - hostTime) / 1000), now);
          hostTime = now;
        }, 1000 / 64);
      }
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
    if (touch) {
      stage!.classList.add("csw-touch-game");
      const blocked = () => paused || !!bar.mode;
      touchUi = mountTouchControls(stage!, bar.root, {
        move(x, z, walk) {
          stick = blocked() ? { x: 0, z: 0, walk: false } : { x, z, walk };
        },
        hold(action, down) {
          if (down && blocked()) return;
          if (down) {
            touchHeld.add(action);
            touchTapped.add(action);
          } else touchHeld.delete(action);
        },
        look(dx, dy) {
          if (paused || (bar.mode && bar.mode !== "Scoreboard")) return;
          // Sensitivity 1.5 (the default) turns 0.006 rad per CSS pixel of drag.
          const k = 0.004 * choice.settings.sensitivity * zoomScale(s.me.scoped);
          yaw += dx * k;
          pitch = Math.max(-1.55, Math.min(1.55, pitch - dy * k));
        },
        slot(n) {
          if (!blocked()) slot = n;
        },
        scoreboard(open) {
          if (open && !bar.mode) bar.scoreboard();
          else if (!open && bar.mode === "Scoreboard") bar.close();
        },
        buy: buyMenu,
        pause,
        touched: () => audio.unlock(),
      }, ctrl.signal);
      // A new match outlines the invisible controls very faintly until the first round goes live.
      touchUi.reveal();
      revealedAt = performance.now();
    }
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
          surface.focus({ preventScroll: true });
          audio.unlock();
          enterFullscreen();
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
      "fullscreenchange",
      () => {
        if (fullscreen()) return;
        keyboard()?.unlock();
        // Esc left fullscreen: hand the browser back and show the pause menu.
        if (wantFullscreen && !paused && s.phase !== "finished") pause();
        wantFullscreen = false;
      },
      opt,
    );
    /** Handles a bound key or mouse button going down; returns whether it was a game input. */
    const press = (code: string, repeat: boolean) => {
      const action = actionFor(code);
      if (!action) return false;
      if (action === "buy") {
        if (!repeat) buyMenu();
        return true;
      }
      if (action === "scoreboard") {
        if (!repeat && !bar.mode) bar.scoreboard();
        return true;
      }
      if ((!currentLock() && document.activeElement !== surface) || bar.mode)
        return true;
      keys.add(code);
      if (!repeat) presses.add(code);
      slot = slots[action] ?? slot;
      return true;
    };
    const unpress = (code: string) => {
      keys.delete(code);
      if (isBound("scoreboard", code) && bar.mode === "Scoreboard") {
        bar.close();
        surface.focus();
      }
    };
    const playing = () =>
      !paused && s.phase !== "finished" && (currentLock() || fullscreen());
    document.addEventListener(
      "mousemove",
      (e) => {
        if (
          currentLock() &&
          !paused &&
          (!bar.mode || bar.mode === "Scoreboard")
        ) {
          const factor =
            ((choice.settings.sensitivity * 0.022 * Math.PI) / 180) *
            zoomScale(s.me.scoped);
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
          e.preventDefault();
          press("Mouse" + e.button, false);
        }
      },
      opt,
    );
    document.addEventListener(
      "mouseup",
      (e) => {
        // Back/forward thumb buttons would otherwise navigate away mid-match.
        if (playing() && (e.button === 3 || e.button === 4)) e.preventDefault();
        unpress("Mouse" + e.button);
      },
      opt,
    );
    document.addEventListener(
      "auxclick",
      (e) => {
        if (playing()) e.preventDefault();
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
        // While playing, game binds win over browser shortcuts (Ctrl+W, Ctrl+S, Alt, F5…).
        // Menus keep Tab and Enter so the armory stays keyboard navigable.
        if (
          playing() &&
          (!bar.mode ||
            bar.mode === "Scoreboard" ||
            e.ctrlKey ||
            e.altKey ||
            e.metaKey ||
            /^F\d+$/.test(e.code)) &&
          e.code !== "F12"
        )
          e.preventDefault();
        if (paused || s.phase === "finished") return;
        if (bar.mode === "Buy menu") {
          if (isBound("buy", e.code) && !e.repeat) resume();
          if (/^Digit[1-7]$/.test(e.code)) {
            bar.tab = Number(e.code.slice(-1)) - 1;
            bar.shop();
          }
          return;
        }
        if (press(e.code, e.repeat)) e.preventDefault();
      },
      opt,
    );
    document.addEventListener(
      "keyup",
      (e) => {
        if (playing() && !bar.mode) e.preventDefault();
        unpress(e.code);
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
        else clearInput();
      },
      opt,
    );
  }
  /** Slows aiming in proportion to the scope's narrower field of view. */
  function zoomScale(zoom: number) {
    return zoom
      ? Math.tan(((zoom === 1 ? 40 : 10) * Math.PI) / 360) /
          Math.tan((choice.settings.fov * Math.PI) / 360)
      : 1;
  }
  function command(): PlayerCommand {
    const held = (a: Action) =>
        touchHeld.has(a) || binds[a].some((c) => keys.has(c)),
      tapped = (a: Action) =>
        held(a) ||
        touchTapped.has(a) ||
        binds[a].some((c) => presses.has(c));
    // The stick steers by direction at full speed; a light push walks quietly like Shift.
    const steering = stick.x !== 0 || stick.z !== 0;
    const x = steering ? stick.x : Number(held("right")) - Number(held("left")),
      z = steering ? stick.z : Number(held("forward")) - Number(held("back"));
    const cmd = {
      moveX: fly ? 0 : x,
      moveZ: fly ? 0 : z,
      yaw,
      pitch,
      fire: tapped("fire"),
      alt: tapped("alt"),
      jump: tapped("jump"),
      walk: held("walk") || (steering && stick.walk),
      crouch: held("crouch"),
      use: held("use"),
      reload: tapped("reload"),
      slot,
    };
    const me = sim?.me;
    if (
      me?.alive &&
      (touchTapped.has("inspect") || binds.inspect.some((c) => presses.has(c)))
    )
      inspecting = { at: sim!.time, weapon: me.weapon };
    slot = 0;
    presses.clear();
    touchTapped.clear();
    if (fly) {
      flyPos.x += (x * Math.cos(yaw) + z * Math.sin(yaw)) * DT * 15;
      flyPos.z += (x * Math.sin(yaw) - z * Math.cos(yaw)) * DT * 15;
      flyPos.y += (Number(cmd.jump) - Number(cmd.crouch)) * DT * 12;
    }
    return cmd;
  }
  function advanceMatch(elapsed: number, now: number) {
    const s = sim;
    const bar = hud;
    if (!s || !bar || disposed) return;
    if ((!paused || network) && s.phase !== "finished") {
      acc += elapsed;
      while (acc >= DT) {
        if (round !== s.round) {
          yaw = s.me.yaw;
          pitch = 0;
          round = s.round;
        }
        const local = paused ? idle(yaw, pitch) : command();
        if (!network) s.step(opts.botsOnly ? {} : { 0: local });
        else if (host) {
          const peer = s.players[peerPlayer];
          const recent = performance.now() - remoteAt < 400;
          const remote = recent && remoteCommand ? remoteCommand : idle(peer.yaw, peer.pitch);
          if (recent && (acknowledged.sequence !== remoteTick || acknowledged.stream !== remoteStream)) {
            acknowledged = { sequence: remoteTick, tick: s.tick + 1, stream: remoteStream };
          }
          s.step({ 0: local, [peerPlayer]: { ...remote, buy: remoteBuy, slot: remoteSlot } });
          remoteBuy = undefined;
          remoteSlot = undefined;
        } else {
          const sequence = ++inputTick;
          if (network.relayed) guestMotion?.advance(s, sequence, local, now);
          const changed = !lastInput || (["moveX", "moveZ", "jump", "fire", "alt", "walk", "crouch", "use", "reload"] as const)
            .some(key => local[key] !== lastInput?.[key]) || !!local.slot;
          if (!network.relayed || now - lastInputAt >= 80 || changed) {
            network.send({ type: "input", sequence, stream: inputStream, command: local });
            lastInputAt = now;
            lastInput = local;
          }
        }
        acc -= DT;
      }
      if (bar.mode === "Buy menu" && !s.canBuy(s.me)) {
        bar.close();
        bar.note("Buy period ended. Click to capture mouse.");
      }
    }
    if (host && (s.phase === "finished"
      ? lastSentFrame !== s.tick || now - lastSentAt >= 1000
      : s.tick - lastSentFrame >= (network?.relayed ? 5 : 4))) {
      network?.send({
        type: "frame",
        frame: projectFrame(s, network.relayed),
        ack: { sequence: acknowledged.sequence, stream: acknowledged.stream,
          age: Math.max(0, s.tick - acknowledged.tick) },
        events: relayEvents.splice(0),
      });
      lastSentFrame = s.tick;
      lastSentAt = now;
    }
  }

  function frame(now: number) {
    const s = sim, view = renderer, bar = hud;
    if (!s || !view || !bar || disposed) return;
    const elapsed = Math.min(0.18, (now - prev) / 1000);
    prev = now;
    if (elapsed > 0) frameRate += (1 / elapsed - frameRate) * 0.04;
    const prediction = network?.relayed ? guestMotion : undefined;
    if (prediction) prediction.updateCorrection(elapsed);
    if (network && !host && remoteFrame) {
      const prior = prediction?.capture(s);
      const finished = s.phase === "finished";
      const latest = applyFrame(s, remoteFrame.frame);
      if (latest) {
        if (prediction && prior) prediction.reconcile(s, prior, remoteFrame.ack, inputStream, now);
        remoteGrenades = latest;
        positionReceivedAt = now;
        if (Array.isArray(remoteFrame.events)) {
          for (const value of remoteFrame.events.slice(0, 12)) {
            const event = readEvent(value);
            if (event) ingest(event);
          }
        }
        if (!finished && s.phase === "finished") ingest({ type: "matchEnd", message: s.result });
      }
      remoteFrame = undefined;
    }
    if (!host) advanceMatch(elapsed, now);
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
    const alpha = Math.max(0, Math.min(1, network && !host && positionReceivedAt
      ? (now - positionReceivedAt) / (network.relayed ? 78.125 : 62.5)
      : acc / DT)),
      lerp = (a: number, b: number) => a + (b - a) * alpha;
    const predicted = watched === me && me.alive ? prediction?.position(s) : undefined;
    const x = predicted?.x ?? lerp(watched.last.x, watched.x),
      z = predicted?.z ?? lerp(watched.last.z, watched.z);
    const eyeTarget = watched.eye.y + (predicted ? predicted.y - watched.y : 0);
    if (!aimEye || Math.abs(aimEye - eyeTarget) > 1.5) aimEye = eyeTarget;
    else
      aimEye +=
        (eyeTarget - aimEye) * (1 - Math.exp(-Math.max(0.001, elapsed) * 18));
    const useMouse = watched === me && !opts.botsOnly;
    // Planting or defusing drops the view to kneeling height (about a metre above the feet).
    const job =
      s.worker >= 0 && (s.action === "Plant" || s.action === "Defuse")
        ? {
            actor: s.worker,
            kind: s.action === "Plant" ? ("plant" as const) : ("defuse" as const),
            age: s.work,
            progress: Math.min(1, s.work / (s.action === "Plant" ? 3.2 : s.players[s.worker].kit ? 5 : 10)),
            kit: s.players[s.worker].kit,
          }
        : undefined;
    kneel +=
      ((job?.actor === watched.id ? 1 : 0) - kneel) * (1 - Math.exp(-Math.max(0.001, elapsed) * 9));
    const cam = {
      ...(fly
        ? flyPos
        : { x, y: aimEye - Math.max(0, aimEye - (watched.y + 1.0)) * kneel, z }),
      yaw:
        (useMouse ? yaw : watched.yaw) +
        (watched.punchY * 0.45 * Math.PI) / 180,
      pitch:
        (useMouse ? pitch : watched.pitch) +
        (watched.punchX * 0.45 * Math.PI) / 180,
    };
    const weapon = watched.weapon;
    if (
      inspecting &&
      (inspecting.weapon !== me.weapon ||
        me.lastFire >= inspecting.at ||
        me.reloadEnd > s.time ||
        me.scoped ||
        !me.alive ||
        s.time - inspecting.at > 4)
    )
      inspecting = undefined;
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
      // Bullets fly at view + 2 x punch while the camera shows 0.45 x punch; the gun covers the rest.
      aim: {
        pitch: (watched.punchX * 1.55 * Math.PI) / 180,
        yaw: (watched.punchY * 1.55 * Math.PI) / 180,
      },
      swing:
        weapon === "knife"
          ? Math.min(1, (s.time - watched.lastFire) / (watched.heavy ? 0.5 : 0.32))
          : 1,
      heavy: watched.heavy,
      task: job,
      drops: s.drops,
      inspect:
        inspecting && watched === me
          ? Math.min(1, (s.time - inspecting.at) / (weapon === "knife" ? 2.4 : 2.8))
          : undefined,
      move: Math.min(1, Math.hypot(watched.vx, watched.vz) / 6),
      reload:
        watched.reloadEnd && isGun(weapon)
          ? 1 - (watched.reloadEnd - s.time) / catalog[weapon].reload
          : 0,
      alpha,
      bomb: s.bomb,
      grenades: network && !host ? remoteGrenades : s.grenades.map((g) => ({
        ...g.body.translation(),
        type: g.type,
        id: g.id,
      })),
      smokes: s.smokes,
      fires: s.fires,
    };
    view.render(props);
    audio.updateListener(cam, cam.yaw, cam.pitch);
    ambience?.update(audio.volume);
    bar.update(watched, frameRate, touch || currentLock(), reduced.matches);
    if (
      touchUi?.revealed &&
      now - revealedAt > 5000 &&
      (s.phase !== "warmup" && s.phase !== "freeze" || now - revealedAt > 30000)
    )
      touchUi.hide();
    raf = requestAnimationFrame(frame);
  }
  onBackButton(() => {
    const dialog = root.querySelector<HTMLDialogElement>("dialog[open]");
    if (dialog) {
      dialog.close();
      return true;
    }
    if (!sim || !hud) return false;
    if (sim.phase === "finished") menuScreen();
    else if (hud.mode === "Scoreboard") hud.close();
    else if (hud.mode === "Settings") hud.pause();
    else if (paused || hud.mode) resume();
    else pause();
    return true;
  }, signal);
  window.addEventListener(
    "resize",
    () => {
      renderer?.resize();
      settings(choice.settings);
    },
    { signal },
  );
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
