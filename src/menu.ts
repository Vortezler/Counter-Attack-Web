import "./menu.css";
import "./loadout.css";
import type { GridMapId } from "./world";
import { mountBindEditor } from "./keybinds";
import { nativeApp, touchDevice } from "./platform";
import { controlsDiagram } from "./touch-controls";
import { mountLoadout } from "./loadoutMenu";

export type LobbyMap = GridMapId;
export const lobbyMaps: LobbyMap[] = [
  "sandgate",
  "saffron",
  "isotope",
  "terracotta",
  "highwire",
  "switchyard",
  "canopy",
  "foundry",
];
export type LobbySide = "CT" | "T";
export type LobbyDifficulty = "easy" | "normal" | "hard";
export type LobbyMode = "competitive" | "casual" | "deathmatch" | "royale";
export const lobbyModes: LobbyMode[] = ["competitive", "casual", "deathmatch", "royale"];
const modeLabel: Record<LobbyMode, string> = {
  competitive: "Competitive",
  casual: "Casual",
  deathmatch: "Deathmatch",
  royale: "Battle royale",
};
/** Deathmatch and battle royale can be played as teams or every player for themselves. */
const arenaMode = (m: LobbyMode) => m === "deathmatch" || m === "royale";
const modeInfo = (m: LobbyMode, solo: boolean): [string, string] =>
  m === "competitive"
    ? ["Competitive", "5 vs 5 <b>·</b> First to 13 <b>·</b> Friendly fire"]
    : m === "casual"
      ? ["Casual", "5 vs 5 <b>·</b> Free armor <b>·</b> CT kits <b>·</b> No friendly fire"]
      : m === "deathmatch"
        ? [
            solo ? "Deathmatch · Solo" : "Deathmatch · Teams",
            (solo ? "Free for all <b>·</b> First to 20 kills" : "5 vs 5 <b>·</b> First team to 50 kills") +
              " <b>·</b> Instant respawns <b>·</b> Buy anywhere",
          ]
        : [
            solo ? "Battle royale · Solo" : "Battle royale · Teams",
            (solo ? "Free for all <b>·</b> Last one standing" : "Two squads of 5 <b>·</b> Last squad standing") +
              " <b>·</b> One life <b>·</b> Loot <b>·</b> Shrinking zone",
          ];
export interface MenuSettings {
  sensitivity: number;
  volume: number;
  fov: number;
  shadows: boolean;
  fullscreen: boolean;
  crosshair: "classic" | "dot";
  hudScale: number;
}
export interface MenuChoice {
  map: LobbyMap;
  side: LobbySide;
  difficulty: LobbyDifficulty;
  mode: LobbyMode;
  /** Deathmatch and battle royale only: free-for-all instead of 5 vs 5. */
  solo?: boolean;
  playerName: string;
  settings: MenuSettings;
}
export interface MenuOptions extends Partial<Omit<MenuChoice, "settings">> {
  settings?: Partial<MenuSettings>;
  notice?: string;
  hubHref?: string;
  onStart: (choice: MenuChoice) => void;
  onSettings?: (settings: MenuSettings) => void;
  onExit?: () => void;
}
export const defaultMenuSettings: MenuSettings = {
  sensitivity: 1.5,
  volume: 0.65,
  fov: 90,
  // Phone GPUs keep a steadier frame rate without the shadow pass.
  shadows: !touchDevice,
  fullscreen: true,
  crosshair: "classic",
  hudScale: 1,
};

const paths = {
  play: '<path d="M7 4.5 19 12 7 19.5z"/>',
  cross:
    '<circle cx="12" cy="12" r="6.3"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  keys: '<rect x="2.2" y="5" width="19.6" height="14" rx="2"/><path d="M5.5 9h1m2.4 0h1m2.4 0h1m2.4 0h1m-11.2 3.3h1m2.4 0h1m2.4 0h1m2.4 0h1M7.7 15.5h8.6"/>',
  gear: '<path d="m10 3 .5-1h3l.5 2 2 .9 1.9-.7 1.6 2.6-1.4 1.5.3 2.1 1.6 1.1-.4 3-2 .6-1.1 1.7.1 2.1-2.8 1-1.4-1.5-2.2-.1-1.6 1.3-2.6-1.4.4-2-1.2-1.7-2.1-.6-.1-3.1 1.7-1 .5-2.1-1.1-1.6 1.8-2.4 1.9.8 2-.8z"/><circle cx="12" cy="11.9" r="3.1"/>',
  sliders:
    '<path d="M3.5 7h6m5 0h6M3.5 17h10m5 0h2"/><circle cx="12" cy="7" r="2.5"/><circle cx="16" cy="17" r="2.5"/>',
  map: '<path d="m2 5 6-2 8 3 6-2v15l-6 2-8-3-6 2zM8 3v15m8-12v15"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  keycap: '<path d="M3 5h18v14H3zM8 11v3h8v-3"/>',
  hub: '<path d="M11 5H5v14h6m4-12 5 5-5 5m-5-5h10"/>',
  person:
    '<path d="M4.8 20v-2c0-3.3 2.9-5.1 7.2-5.1s7.2 1.8 7.2 5.1v2"/><circle cx="12" cy="7.7" r="3.6"/>',
  edit: '<path d="m13.5 5.5 5 5L9 20l-6 1 1-6zM15 4l2.5-2 5 5L20 9"/>',
  network: '<path d="M3 16v5m5-9v9m5-14v14m5-18v18"/>',
  target:
    '<circle cx="12" cy="12" r="8.3"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r=".8"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  monitor:
    '<rect x="2.5" y="3.8" width="19" height="13.5" rx="1.3"/><path d="M8 21h8m-4-3.7V21"/>',
  flag: '<path d="M5 21V3m0 1c5-3 8 3 14 0v9c-6 3-9-3-14 0"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  shirt: '<path d="M8.5 3 3.6 5.6 2 10.4l3.6 1.3V21h12.8v-9.3l3.6-1.3-1.6-4.8L15.5 3c-.7 1.5-1.9 2.3-3.5 2.3S9.2 4.5 8.5 3z"/>',
  blade: '<path d="M3 21 13.5 10.5M13.5 10.5 21 3c-1.2 4.4-3.4 7.6-6.6 9.6M13.5 10.5l1 2.1M5.5 15.5l3 3"/>',
};
const icon = (key: keyof typeof paths, extra = "") =>
  `<svg class="csw-icon ${extra}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key]}</svg>`;
const insignia = (ct: boolean) =>
  ct
    ? '<svg class="csw-insignia" viewBox="0 0 56 48" aria-hidden="true"><g fill="currentColor"><path opacity=".85" d="m3 10 17 6 2.3 4.6L6 15zm5 8.5 14 4.4 1.6 3.6-12-4zm45-8.5-17 6-2.3 4.6L50 15zm-5 8.5-14 4.4-1.6 3.6 12-4z"/><path d="m28 4 12 5-1.2 11.5C38 28 33.8 33.7 28 38c-5.8-4.3-10-10-10.8-17.5L16 9zm0 4.7-8 3.1 1.1 8c.8 5.8 3.2 10 6.9 13.4 3.7-3.4 6.1-7.6 6.9-13.4l1.1-8z"/><path d="m28 11 2.1 5 5.2.5-4 3.4 1.1 5.1-4.4-2.7-4.4 2.7 1.1-5.1-4-3.4 5.2-.5z"/></g></svg>'
    : '<svg class="csw-insignia" viewBox="0 0 56 48" aria-hidden="true"><g fill="currentColor"><path d="M28 3 31.7 13l9.9-3.1L37 19.1l10.4 2.3-9 4.8 4 8.3-10-2.1L28 42l-4.4-9.6-10 2.1 4-8.3-9-4.8L19 19.1l-4.6-9.2 9.9 3.1zm0 9-3.4 5.6-5.8 3.5 2.1 6 7.1 4.5 7.1-4.5 2.1-6-5.8-3.5z"/><path d="m28 15 2.9 5 4.3 2.1-3.4 3.2-3.8 2.5-3.8-2.5-3.4-3.2 4.3-2.1z"/></g></svg>';
const logo =
  '<svg class="csw-mark" viewBox="0 0 52 48" aria-hidden="true"><g fill="currentColor"><path d="M16 5h14L11 42H0z"/><path d="M34 5h12L34.8 26h-12z"/><path d="M29 30h12l-6.3 12H22.6z"/></g></svg>';

const mapInfo = {
  sandgate: {
    name: "Sandgate",
    display: "SANDGATE",
    region: "Desert",
    copy: "Long sightlines, narrow tunnels, and a sunbaked courtyard.",
  },
  saffron: {
    name: "Saffron",
    display: "SAFFRON",
    region: "Kasbah",
    copy: "Fight for mid control between palace balconies and market arches.",
  },
  isotope: {
    name: "Isotope",
    display: "ISOTOPE",
    region: "Reactor",
    copy: "Indoor sites under a concrete roof, a silo yard outside, and Ramp linking it all.",
  },
  terracotta: {
    name: "Terracotta",
    display: "TERRACOTTA",
    region: "Village",
    copy: "Hold the winding Banana lane or storm the apartments over the A balcony.",
  },
  highwire: {
    name: "Highwire",
    display: "HIGHWIRE",
    region: "Skyline",
    copy: "Fifty floors up: a ramp over scaffolding to A and a stairwell into B.",
  },
  switchyard: {
    name: "Switchyard",
    display: "SWITCHYARD",
    region: "Rail yard",
    copy: "Two tracks of parked wagons, level crossings, a loco shed at B and a loading dock at A.",
  },
  canopy: {
    name: "Canopy",
    display: "CANOPY",
    region: "Jungle ruins",
    copy: "Overgrown temple ruins: a flooded cave to B, stone stairs up to the A sanctum.",
  },
  foundry: {
    name: "Foundry",
    display: "FOUNDRY",
    region: "Steel works",
    copy: "Container stacks at B, a racked warehouse at A, and a vent run straight into it.",
  },
};
const localRead = (key: string) => {
  try {
    return localStorage.getItem("cs-web:" + key);
  } catch {
    return null;
  }
};
const localWrite = (key: string, value: string) => {
  try {
    localStorage.setItem("cs-web:" + key, value);
  } catch {
    /* Optional in private browsing. */
  }
};
function savedSettings(): Partial<MenuSettings> {
  try {
    return JSON.parse(localRead("settings") || "{}") || {};
  } catch {
    return {};
  }
}
const validNumber = (
  value: unknown,
  fallback: number,
  lo: number,
  hi: number,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(hi, Math.max(lo, value))
    : fallback;
export function mergeSettings(
  provided: Partial<MenuSettings> = {},
): MenuSettings {
  const s = { ...defaultMenuSettings, ...savedSettings(), ...provided };
  return {
    sensitivity: validNumber(s.sensitivity, 1.5, 0.25, 5),
    volume: validNumber(s.volume, 0.65, 0, 1),
    fov: validNumber(s.fov, 90, 65, 120),
    shadows: typeof s.shadows === "boolean" ? s.shadows : !touchDevice,
    fullscreen: typeof s.fullscreen === "boolean" ? s.fullscreen : true,
    crosshair: s.crosshair === "dot" ? "dot" : "classic",
    hudScale: validNumber(s.hudScale, 1, 0.75, 1.5),
  };
}
const art = (map: LobbyMap, thumb = false) =>
  `${import.meta.env.BASE_URL}art/${map}${thumb ? "-map" : ""}.${map === "sandgate" || map === "saffron" ? "webp" : "jpg"}`;
/** The Controls dialog on phones: where the invisible touch controls are. */
const touchGuide = `<dl class="csw-touchguide">
  <div><dt>Move</dt><dd>Put your left thumb down anywhere on the left side and drag. A light push walks quietly.</dd></div>
  <div><dt>Aim</dt><dd>Drag anywhere on the right side. Keep dragging on Fire to aim while you shoot.</dd></div>
  <div><dt>Buttons</dt><dd>Fire, Scope, Reload, Use, Jump, Swap and Crouch sit around your right thumb. They are invisible in play and shown faintly at the start of each match.</dd></div>
  <div><dt>Buy</dt><dd>Tap the radar during the buy period.</dd></div>
  <div><dt>Weapons</dt><dd>Tap an item in the inventory row at the bottom. Swap returns to your last weapon.</dd></div>
  <div><dt>Plant / defuse</dt><dd>Hold the prompt in the middle of the screen, or hold Use.</dd></div>
  <div><dt>Scoreboard</dt><dd>Hold the score at the top.</dd></div>
  <div><dt>Pause</dt><dd>Tap the top-right corner${nativeApp ? " or press Back" : ""}.</dd></div>
</dl>`;
export function mountMenu(container: HTMLElement, options: MenuOptions) {
  const controller = new AbortController();
  const { signal } = controller;
  const choice: MenuChoice = {
    map: options.map || "sandgate",
    side: options.side || "CT",
    difficulty: options.difficulty || "normal",
    mode: options.mode || "competitive",
    solo: options.solo ?? false,
    playerName: options.playerName || localRead("player-name") || "Operator",
    settings: mergeSettings(options.settings),
  };
  const menu = document.createElement("section");
  menu.className = "csw-lobby";
  menu.setAttribute("aria-label", "CS Web match lobby");
  menu.innerHTML = `<header class="csw-topbar"><div class="csw-topinner">
    <div class="csw-brand" aria-label="CS Web (fan project)">${logo}<div><strong>CS WEB</strong><small>FAN PROJECT</small></div></div>
    <nav class="csw-topnav" aria-label="Game navigation"><button type="button" data-nav="play" aria-current="page">${icon("play")}<span>Play</span></button>
    <button type="button" data-nav="loadout">${icon("shirt")}<span>Loadout</span></button>
    <button type="button" data-nav="controls">${icon("keys")}<span>Controls</span></button><button type="button" data-nav="settings">${icon("gear")}<span>Settings</span></button></nav>
    <a class="csw-hub" data-hub>${icon("hub")}<span>Back to Game Hub</span></a>
  </div></header><div class="csw-lobbybody">
    <div class="csw-view" data-view="play">
    <div class="csw-headingrow"><div><div class="csw-eyebrow csw-breadcrumb"><i></i> PLAY / SOLO</div><h1>MATCH LOBBY</h1></div>
    <div class="csw-session"><i></i> Local session</div></div>
    <p class="csw-notice" role="status" hidden></p>
    <div class="csw-lobbygrid"><div class="csw-mapcolumn">
      <article class="csw-feature" aria-label="Selected map preview">
        <img class="csw-featureimg" src="${art(choice.map)}" alt="" decoding="sync" fetchpriority="high">
        <div class="csw-featureshade"></div><div class="csw-frame csw-frame-tl"></div><div class="csw-frame csw-frame-tr"></div><div class="csw-frame csw-frame-br"></div>
        <span class="csw-previewtag">${icon("cross")} Map preview</span>
        <div class="csw-featuretext"><div class="csw-tag">${icon("target")} <span data-modetag>Bomb defusal</span></div>
          <h2></h2><p></p></div>
      </article>
      <div class="csw-poollabel"><span>${icon("map")} Map selection</span><span class="csw-poolcount"></span></div>
      <div class="csw-mapgrid" role="group" aria-label="Map selection">
      ${lobbyMaps.map((map, i) => `<button type="button" class="csw-mapcard" data-map="${map}" aria-label="${mapInfo[map].name}"><img src="${art(map, true)}" alt=""><span class="csw-mapcardshade"></span><span class="csw-mapindex">MAP / 0${i + 1}</span><span class="csw-mapcardname">${mapInfo[map].name}</span><span class="csw-mapcheck">${icon("check")}</span></button>`).join("")}</div>
    </div>
    <form class="csw-setup"><div class="csw-setuphead">${icon("sliders")}<h2>Match setup</h2></div>
      <div class="csw-setupbody">
        <div class="csw-modeline"><span class="csw-modeicon">${icon("cross")}</span><div><strong data-modename></strong><small data-modecopy></small></div></div>
        <fieldset><legend>Game mode</legend><div class="csw-diffgrid csw-modegrid">${lobbyModes.map((m) => `<button type="button" data-mode="${m}">${modeLabel[m]}</button>`).join("")}</div></fieldset>
        <fieldset data-format><legend>Format</legend><div class="csw-diffgrid csw-modegrid"><button type="button" data-solo="0">Teams · 5 vs 5</button><button type="button" data-solo="1">Solo · free for all</button></div></fieldset>
        <fieldset><legend>Starting side</legend><div class="csw-teamgrid">
        <button type="button" data-side="CT" aria-label="Counter-Terrorists">${insignia(true)}<span>Counter-Terrorists</span></button>
        <button type="button" data-side="T" aria-label="Terrorists">${insignia(false)}<span>Terrorists</span></button></div></fieldset>
        <div class="csw-loadoutline"><span class="csw-loadouticon">${icon("blade")}</span><div><small>Loadout</small><strong data-lsum-agent></strong><span data-lsum-rest></span></div><button type="button" class="csw-customize" data-nav="loadout">Customize${icon("chevron")}</button></div>
        <fieldset><legend>Bot difficulty</legend><div class="csw-diffgrid">${(["easy", "normal", "hard"] as const).map((d) => `<button type="button" data-difficulty="${d}">${d}</button>`).join("")}</div></fieldset>
        <label class="csw-namelabel" for="csw-lobby-name">Player name</label><div class="csw-inputwrap">${icon("person")}<input id="csw-lobby-name" name="playerName" autocomplete="off" maxlength="48" required spellcheck="false" placeholder="Operator"></div>
        <button type="submit" class="csw-start"><span>${icon("play")}Start match</span><kbd>ENTER</kbd></button>
      </div></form>
    </div></div>
    <div class="csw-view" data-view="loadout" hidden>
      <div class="csw-headingrow"><div><div class="csw-eyebrow csw-breadcrumb"><i></i> PLAY / LOADOUT</div><h1>LOADOUT</h1></div>
      <div class="csw-session"><i></i> Saved on this device</div></div>
      <div class="csw-loadouthost"></div>
    </div><footer class="csw-lobbyfooter"><span>${icon("monitor")} ${touchDevice ? "Mobile <b>/</b> Touch controls" : "Desktop <b>/</b> Keyboard + mouse"}</span><span>${icon("network")}64 tick</span></footer>
  </div><dialog class="csw-menudialog"><section><header><h2></h2><button type="button" data-dismiss aria-label="Close dialog">${icon("close")}</button></header><div class="csw-dialogbody"></div></section></dialog>`;
  container.append(menu);
  const get = <T extends Element = HTMLElement>(s: string) =>
    menu.querySelector<T>(s)!;
  const all = <T extends Element = HTMLElement>(s: string) =>
    Array.from(menu.querySelectorAll<T>(s));
  const hub = get<HTMLAnchorElement>("[data-hub]");
  hub.href =
    options.hubHref ||
    (import.meta.env.DEV ? "http://127.0.0.1:5173/game-hub/" : "/game-hub/");
  if (options.onExit)
    hub.addEventListener(
      "click",
      (event) => {
        if (
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.metaKey ||
          event.button !== 0
        )
          return;
        event.preventDefault();
        options.onExit?.();
      },
      { signal },
    );
  const name = get<HTMLInputElement>("[name=playerName]");
  name.value = choice.playerName;
  const notice = get(".csw-notice");
  if (options.notice) {
    notice.hidden = false;
    notice.textContent = options.notice;
  }
  const dialog = get<HTMLDialogElement>("dialog");
  const form = get<HTMLFormElement>("form");
  let view: "play" | "loadout" = "play";
  const loadout = mountLoadout(get(".csw-loadouthost"), {
    side: () => choice.side,
    onChange: () => summarise(),
  });
  function summarise() {
    const s = loadout.summary(choice.side);
    get("[data-lsum-agent]").textContent = s.agent;
    get("[data-lsum-rest]").textContent =
      s.knife + " · " + (s.finishes ? s.finishes + (s.finishes === 1 ? " weapon finish" : " weapon finishes") : "factory weapons");
  }
  function show(next: "play" | "loadout") {
    view = next;
    for (const v of all<HTMLElement>("[data-view]")) v.hidden = v.dataset.view !== next;
    if (next === "loadout") loadout.open();
    else {
      loadout.close();
      summarise();
    }
    tab(next);
    menu.scrollTop = 0;
  }
  function reflect() {
    for (const b of all<HTMLButtonElement>("[data-map]"))
      b.setAttribute("aria-pressed", String(b.dataset.map === choice.map));
    for (const b of all<HTMLButtonElement>("[data-side]"))
      b.setAttribute("aria-pressed", String(b.dataset.side === choice.side));
    summarise();
    for (const b of all<HTMLButtonElement>("[data-mode]"))
      b.setAttribute("aria-pressed", String(b.dataset.mode === choice.mode));
    const [modeName, modeCopy] = modeInfo(choice.mode, !!choice.solo);
    get("[data-modename]").textContent = modeName;
    get("[data-modecopy]").innerHTML = modeCopy;
    get("[data-modetag]").textContent = arenaMode(choice.mode) ? modeLabel[choice.mode] : "Bomb defusal";
    get<HTMLFieldSetElement>("[data-format]").hidden = !arenaMode(choice.mode);
    for (const b of all<HTMLButtonElement>("[data-solo]"))
      b.setAttribute("aria-pressed", String((b.dataset.solo === "1") === !!choice.solo));
    for (const b of all<HTMLButtonElement>("[data-difficulty]"))
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.difficulty === choice.difficulty),
      );
    const info = mapInfo[choice.map];
    get(".csw-feature h2").textContent = info.display;
    get(".csw-featuretext p").textContent = info.copy;
    const img = get<HTMLImageElement>(".csw-featureimg");
    if (img.getAttribute("src") !== art(choice.map)) {
      img.src = art(choice.map);
      // Replay the fade so switching maps eases in rather than snapping.
      img.classList.remove("csw-fadein");
      void img.offsetWidth;
      img.classList.add("csw-fadein");
    }
    get(".csw-poolcount").textContent =
      String(lobbyMaps.indexOf(choice.map) + 1).padStart(2, "0") +
      " / " +
      String(lobbyMaps.length).padStart(2, "0");
  }
  reflect();
  function tab(active: string) {
    for (const b of all<HTMLButtonElement>(".csw-topnav [data-nav]")) {
      if (b.dataset.nav === active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
  }
  let dialogListeners: AbortController | undefined;
  function showPanel(kind: "controls" | "settings") {
    dialogListeners?.abort();
    dialogListeners = new AbortController();
    const body = get(".csw-dialogbody");
    get("dialog h2").textContent =
      kind === "controls" ? "Controls" : "Settings";
    if (kind === "controls" && touchDevice) {
      body.innerHTML = touchGuide;
      body.prepend(controlsDiagram());
    } else if (kind === "controls") {
      body.innerHTML = "";
      const cleanup = mountBindEditor(body);
      dialogListeners.signal.addEventListener("abort", cleanup);
    } else {
      const s = choice.settings;
      const slider = (
        key: "sensitivity" | "volume" | "fov" | "hudScale",
        label: string,
        min: number,
        max: number,
        step: number,
      ) =>
        `<label class="csw-setting"><span>${label}<output data-value="${key}"></output></span><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"></label>`;
      body.innerHTML =
        slider("sensitivity", touchDevice ? "Look sensitivity" : "Mouse sensitivity", 0.25, 5, 0.05) +
        slider("volume", "Master volume", 0, 1, 0.01) +
        slider("fov", "Field of view", 65, 120, 1) +
        slider("hudScale", "HUD scale", 0.75, 1.5, 0.05) +
        `<label class="csw-settingrow">Crosshair<select data-setting="crosshair"><option value="classic">Classic</option><option value="dot">Dot</option></select></label>
        <label class="csw-settingrow">Map shadows<input data-setting="shadows" type="checkbox" ${s.shadows ? "checked" : ""}></label>
        ${nativeApp ? "" : `<label class="csw-settingrow">Play in fullscreen${touchDevice ? "" : " (Esc returns to the browser)"}<input data-setting="fullscreen" type="checkbox" ${s.fullscreen ? "checked" : ""}></label>`}`;
      get<HTMLSelectElement>("[data-setting=crosshair]").value = s.crosshair;
      const values = () => {
        get("[data-value=sensitivity]").textContent = s.sensitivity.toFixed(2);
        get("[data-value=volume]").textContent =
          Math.round(s.volume * 100) + "%";
        get("[data-value=fov]").textContent = s.fov + "°";
        get("[data-value=hudScale]").textContent =
          Math.round(s.hudScale * 100) + "%";
      };
      values();
      body.addEventListener(
        "input",
        (event) => {
          const field = event.target as HTMLInputElement | HTMLSelectElement;
          switch (field.dataset.setting) {
            case "shadows":
            case "fullscreen":
              s[field.dataset.setting] = (field as HTMLInputElement).checked;
              break;
            case "crosshair":
              s.crosshair = field.value === "dot" ? "dot" : "classic";
              break;
            case "sensitivity":
            case "volume":
            case "fov":
            case "hudScale":
              s[field.dataset.setting] = Number(field.value);
              break;
          }
          values();
          localWrite("settings", JSON.stringify(s));
          options.onSettings?.({ ...s });
        },
        { signal: dialogListeners.signal },
      );
    }
    tab(kind);
    if (!dialog.open) dialog.showModal();
    get<HTMLButtonElement>("[data-dismiss]").focus();
  }
  dialog.addEventListener(
    "close",
    () => {
      tab(view);
      dialogListeners?.abort();
    },
    { signal },
  );
  dialog.addEventListener(
    "click",
    (e) => {
      if (e.target === dialog) dialog.close();
    },
    { signal },
  );
  menu.addEventListener(
    "click",
    (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!b) return;
      const { map, side, difficulty, nav, mode, solo } = b.dataset;
      if ((lobbyModes as string[]).includes(mode ?? "")) {
        choice.mode = mode as LobbyMode;
        reflect();
      }
      if (solo === "0" || solo === "1") {
        choice.solo = solo === "1";
        reflect();
      }
      if (map && (lobbyMaps as string[]).includes(map)) {
        choice.map = map as LobbyMap;
        reflect();
      }
      if (side === "CT" || side === "T") {
        choice.side = side;
        reflect();
      }
      if (
        difficulty === "easy" ||
        difficulty === "normal" ||
        difficulty === "hard"
      ) {
        choice.difficulty = difficulty;
        reflect();
      }
      if (nav === "controls" || nav === "settings") showPanel(nav);
      if (b.hasAttribute("data-dismiss")) dialog.close();
      if (nav === "loadout") show("loadout");
      if (nav === "play") {
        show("play");
        get<HTMLButtonElement>("[data-map][aria-pressed=true]").focus();
      }
    },
    { signal },
  );
  name.addEventListener("input", () => name.setCustomValidity(""), { signal });
  form.addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      const value = name.value.trim();
      if (
        !value ||
        [...value].length > 24 ||
        /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(
          name.value,
        )
      ) {
        name.setCustomValidity(
          "Use a player name with 1–24 printable characters.",
        );
        name.reportValidity();
        return;
      }
      choice.playerName = value;
      localWrite("player-name", value);
      options.onStart({ ...choice, settings: { ...choice.settings } });
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      const target = e.target as HTMLElement;
      if (
        e.key === "Enter" &&
        !e.repeat &&
        !dialog.open &&
        view === "play" &&
        !target.closest("button,input,select,a,textarea,[contenteditable]") &&
        menu.isConnected &&
        !menu.closest("[hidden]")
      ) {
        e.preventDefault();
        form.requestSubmit();
      }
    },
    { signal },
  );
  return {
    openSettings: () => showPanel("settings"),
    openControls: () => showPanel("controls"),
    destroy() {
      dialogListeners?.abort();
      loadout.destroy();
      controller.abort();
      if (dialog.open) dialog.close();
      menu.remove();
    },
  };
}
