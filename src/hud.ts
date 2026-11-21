import type { Sim, SimEvent } from "./sim/Sim";
import {
  catalog,
  shop,
  isGun,
  isNade,
  weaponName,
  type Item,
} from "./config/weapons";
import { patterns } from "./config/recoilPatterns";
import type { Player } from "./sim/player";
import { hubUrl } from "./hub/navigation";
import { keyName, mountBindEditor } from "./keybinds";
const money = (v: number) => "$" + v.toLocaleString("en-US");
const clock = (v: number) => {
  const seconds = Math.ceil(Math.max(0, v));
  return Number.isFinite(seconds)
    ? Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
    : "∞";
};
function label(el: HTMLElement, value: string) {
  if (el.textContent !== value) el.textContent = value;
}
const categories: [string, Item[]][] = [
  ["Sidearms", ["glock", "deagle"]],
  ["SMGs", ["p90"]],
  ["Rifles", ["ak", "m4", "m4a4", "aug"]],
  ["Snipers", ["ssg", "awp"]],
  ["Heavy", ["nova", "xm", "negev"]],
  ["Utility", ["he", "flash", "smoke", "molly"]],
  ["Equipment", ["kevlar", "helmet", "kit"]],
];
const streak = ["", "", "DOUBLE KILL", "TRIPLE KILL", "QUAD KILL", "ACE"];
export class MatchHud {
  root = document.createElement("div");
  radar: CanvasRenderingContext2D;
  mapLayer = document.createElement("canvas");
  ids: Record<string, HTMLElement> = {};
  mode = "";
  tab = 0;
  lastHud = -1;
  feed: { text: string; until: number }[] = [];
  hitEnd = 0;
  hurtEnd = 0;
  hintEnd = 0;
  hint = "";
  popEnd = 0;
  unbind: (() => void) | null = null;
  abort = new AbortController();
  constructor(
    parent: HTMLElement,
    public sim: Sim,
    public handlers: {
      resume: () => void;
      pause: () => void;
      restart: () => void;
      lobby: () => void;
      exit: () => void;
      settings: () => void;
      buy?: (item: Item) => string;
    },
    public debug = false,
  ) {
    this.root.className = "csw-hud";
    this.root.innerHTML = `
 <div class="csw-intel"><div class="csw-radar-top"><span>TACTICAL RADAR</span><b>N</b></div><canvas width="210" height="210" data-ui="radar"></canvas><div data-ui="location"></div><strong data-ui="cash"></strong></div>
 <div class="csw-strip"><b class="csw-ct" data-ui="ct"></b><div><small data-ui="round"></small><strong data-ui="clock" data-testid="round-timer"></strong></div><b class="csw-t" data-ui="t"></b></div>
 <div class="csw-killfeed" data-ui="feed"></div><div class="csw-hit" data-ui="hit"></div><div class="csw-hurt" data-ui="hurt"></div><div class="csw-cross" data-ui="cross"></div><div class="csw-scope" data-ui="scope" hidden></div>
 <div class="csw-center-msg"><small data-ui="phase"></small><strong data-ui="banner"></strong><span data-ui="prompt"></span><progress data-ui="progress" hidden></progress></div>
 <div class="csw-vitals"><div><small>HEALTH</small><strong data-ui="hp"></strong></div><div><small>ARMOR</small><strong data-ui="armor"></strong></div><div class="csw-kills"><small>KILLS</small><strong data-ui="kills" data-testid="kill-counter"></strong><span data-ui="tally" aria-hidden="true"></span></div></div>
 <div class="csw-smoke" data-ui="smoke"></div><div class="csw-killpop" data-ui="killpop" aria-hidden="true"></div>
 <div class="csw-ammo"><small data-ui="weapon"></small><strong data-ui="ammo"></strong><span data-ui="reserve"></span></div>
 <div class="csw-debug" data-ui="debug" hidden><span data-ui="metrics"></span><canvas data-ui="spray" width="96" height="68" aria-label="Weapon recoil pattern"></canvas></div><div class="csw-flash" data-ui="flash"></div>
 <div class="csw-panel" data-ui="panel" hidden></div><div class="csw-a11y" aria-live="polite" data-ui="status"></div>`;
    parent.append(this.root);
    for (const el of this.root.querySelectorAll<HTMLElement>("[data-ui]"))
      this.ids[el.dataset.ui!] = el;
    this.radar = (this.ids.radar as HTMLCanvasElement).getContext("2d")!;
    this.mapLayer.width = this.mapLayer.height = 210;
    this.paintRadarMap();
    this.root.addEventListener(
      "click",
      (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>(
          "[data-action]",
        );
        if (b) this.action(b.dataset.action!);
      },
      { signal: this.abort.signal },
    );
  }
  action(key: string) {
    const h = this.handlers;
    if (key.startsWith("cat-")) {
      this.tab = Number(key.slice(4));
      this.shop();
    } else if (key.startsWith("buy-")) {
      const item = key.slice(4) as Item;
      const result = h.buy ? h.buy(item) : this.sim.buy(this.sim.me, item);
      this.shop(
        result === "Purchased" ? shop[item].name + " equipped" : result,
      );
      this.ids.panel
        .querySelector<HTMLElement>('[data-action="' + key + '"]')
        ?.focus();
    } else if (key === "return") h.resume();
    else if (key === "settings") h.settings();
    else if (key === "restart") h.restart();
    else if (key === "lobby") h.lobby();
    else if (key === "exit") h.exit();
  }
  button(action: string, name: string, cls = "") {
    return (
      '<button class="' +
      cls +
      '" data-action="' +
      action +
      '">' +
      name +
      "</button>"
    );
  }
  panel(mode: string, html: string) {
    this.unbind?.();
    this.unbind = null;
    this.mode = mode;
    this.ids.panel.hidden = false;
    this.ids.panel.innerHTML =
      '<section role="dialog" aria-label="' + mode + '">' + html + "</section>";
    this.ids.panel
      .querySelector<HTMLElement>("button,a")
      ?.focus({ preventScroll: true });
  }
  close() {
    this.unbind?.();
    this.unbind = null;
    this.mode = "";
    this.ids.panel.hidden = true;
    this.ids.panel.replaceChildren();
  }
  shop(message = "") {
    const p = this.sim.me;
    this.panel(
      "Buy menu",
      "<header><div><small>SPAWN ARMORY</small><h2>Buy menu</h2></div><b>" +
        money(p.money) +
        "</b></header><nav>" +
        categories
          .map(([name], i) =>
            this.button(
              "cat-" + i,
              i + 1 + " " + name,
              i === this.tab ? "on" : "",
            ),
          )
          .join("") +
        '</nav><div class="csw-shop-list">' +
        categories[this.tab][1]
          .filter((item) =>
            isGun(item)
              ? !catalog[item].team || catalog[item].team === p.team
              : item !== "kit" || p.team === "CT",
          )
          .map((item) =>
            this.button(
              "buy-" + item,
              "<span>" +
                shop[item].name +
                "</span><b>" +
                money(shop[item].price) +
                "</b>",
            ),
          )
          .join("") +
        '</div><p aria-live="polite">' +
        (message ||
          "Number keys select a category. " +
            keyName("buy") +
            " closes the armory.") +
        "</p>" +
        this.button("return", "Return to match", "csw-cta"),
    );
  }
  pause() {
    this.panel(
      "Paused",
      "<header><div><small>" +
        this.sim.map.name +
        " / ROUND " +
        this.sim.round +
        '</small><h2>Match paused</h2></div></header><div class="csw-stack">' +
        this.button("return", "Resume match", "csw-cta") +
        this.button("settings", "Settings & controls") +
        this.button("lobby", "Return to match setup") +
        '</div><a data-action="exit" href="' +
        hubUrl() +
        '">Back to Game Hub</a>',
    );
  }
  scoreboard(end = false) {
    this.panel(
      end ? "Match complete" : "Scoreboard",
      "<header><div><small>" +
        this.sim.map.name +
        " / 5 VS 5</small><h2>" +
        (end ? this.sim.result : "Scoreboard") +
        "</h2></div></header><div data-teams></div>" +
        (end
          ? this.button("restart", "Play again", "csw-cta") +
            this.button("lobby", "Match setup") +
            '<a data-action="exit" href="' +
            hubUrl() +
            '">Back to Game Hub</a>'
          : "<small>Release Tab to close</small>"),
    );
    const tables = this.ids.panel.querySelector("[data-teams]")!;
    for (const team of ["CT", "T"] as const) {
      const table = document.createElement("table");
      table.innerHTML =
        "<caption>" +
        team +
        " · " +
        this.sim.score[team] +
        "</caption><thead><tr><th>Operator</th><th>K</th><th>D</th><th>HS</th><th>Cash</th><th>Link</th></tr></thead>";
      const body = table.createTBody();
      for (const p of this.sim.players
        .filter((p) => p.team === team)
        .sort((a, b) => b.kills - a.kills)) {
        const row = body.insertRow();
        for (const data of [
          p.name + (p.alive ? "" : " †"),
          p.kills,
          p.deaths,
          p.headshots,
          team === this.sim.me.team ? money(p.money) : "—",
          p.id ? "BOT" : "LOCAL",
        ])
          row.insertCell().textContent = String(data);
      }
      tables.append(table);
    }
  }
  settings(
    volume: number,
    sensitivity: number,
    shadows: boolean,
    fullscreen: boolean,
    update: (key: string, v: number | boolean) => void,
  ) {
    const check = (name: string, label: string, on: boolean) =>
      "<label>" +
      label +
      ' <input name="' +
      name +
      '" type="checkbox" ' +
      (on ? "checked" : "") +
      "></label>";
    this.panel(
      "Settings",
      '<header><div><small>FIELD CONFIGURATION</small><h2>Settings & controls</h2></div></header><div class="csw-controls"><label>Volume <input name="volume" type="range" min="0" max="1" step=".01" value="' +
        volume +
        '"></label><label>Sensitivity <input name="sensitivity" type="range" min=".2" max="5" step=".1" value="' +
        sensitivity +
        '"></label>' +
        check("shadows", "Shadows", shadows) +
        check(
          "fullscreen",
          "Fullscreen (Esc returns to the browser)",
          fullscreen,
        ) +
        "<h3>Key bindings</h3><div data-binds></div></div>" +
        this.button("return", "Resume match", "csw-cta"),
    );
    this.unbind = mountBindEditor(
      this.ids.panel.querySelector("[data-binds]")!,
    );
    this.ids.panel
      .querySelectorAll<HTMLInputElement>(".csw-controls > label input")
      .forEach(
        (input) =>
          (input.oninput = () =>
            update(
              input.name,
              input.type === "checkbox" ? input.checked : Number(input.value),
            )),
      );
  }
  note(text: string) {
    this.hint = text;
    this.hintEnd = this.sim.time + 3;
    this.ids.status.textContent = text;
  }
  event(e: SimEvent) {
    const s = this.sim;
    if (e.type === "kill") {
      const src = e.actor === undefined ? "C4" : s.players[e.actor].name,
        victim = s.players[e.victim!].name;
      this.feed.unshift({
        text:
          src +
          "  /  " +
          (e.weapon ? weaponName(e.weapon) : "") +
          (e.head ? " ✛" : "") +
          "  /  " +
          victim +
          (e.wallbang ? " · Wallbang" : ""),
        until: s.time + 6,
      });
      this.feed = this.feed.slice(0, 5);
    }
    if (e.type === "kill" && e.actor === s.me.id && e.victim !== s.me.id) {
      const me = s.me,
        pop = this.ids.killpop;
      pop.textContent = "";
      const big = document.createElement("strong");
      big.textContent = streak[Math.min(5, me.roundKills)] || "ELIMINATED";
      const small = document.createElement("small");
      small.textContent =
        s.players[e.victim!].name +
        (e.head ? " · HEADSHOT" : "") +
        (e.wallbang ? " · WALLBANG" : "");
      pop.append(big, small);
      pop.classList.remove("on");
      void pop.offsetWidth;
      pop.classList.add("on");
      pop.classList.toggle("head", !!e.head);
      this.popEnd = s.time + 1.6;
    }
    if (e.type === "hit") {
      if (e.actor === s.me.id) {
        this.hitEnd = s.time + 0.25;
        this.ids.hit.classList.toggle("wall", !!e.wallbang);
        if (e.wallbang) this.note("Wallbang · " + e.amount + " damage");
      }
      if (e.victim === s.me.id) {
        this.hurtEnd = s.time + 0.3;
        const attacker = e.actor === undefined ? null : s.players[e.actor];
        if (attacker) {
          const angle =
            Math.atan2(attacker.x - s.me.x, s.me.z - attacker.z) - s.me.yaw;
          this.ids.hurt.style.setProperty("--direction", angle + "rad");
        }
      }
    }
    if (e.message) this.ids.status.textContent = e.message;
    if (e.type === "plant") this.note(e.message!);
    if (e.type === "matchEnd") this.scoreboard(true);
  }
  paintRadarMap() {
    const ctx = this.mapLayer.getContext("2d")!,
      map = this.sim.map,
      k = 210 / map.width;
    ctx.fillStyle = "#1b201e";
    ctx.fillRect(0, 0, 210, 210);
    ctx.strokeStyle = "#3f4943";
    ctx.lineWidth = 0.35;
    for (let i = 0; i < 211; i += 10) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 210);
      ctx.moveTo(0, i);
      ctx.lineTo(210, i);
      ctx.stroke();
    }
    ctx.fillStyle = "#646d62";
    for (const b of map.boxes.filter(
      (b) => b.style !== "floor" && b.style !== "roof",
    ))
      ctx.fillRect((b.x - b.w / 2) * k, (b.z - b.d / 2) * k, b.w * k, b.d * k);
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    for (const site of ["A", "B"] as const) {
      const r = map.sites[site];
      ctx.fillStyle = "#a6bf5666";
      ctx.fillRect((r.x - r.w / 2) * k, (r.z - r.d / 2) * k, r.w * k, r.d * k);
      ctx.fillStyle = "#e4ffa5";
      ctx.fillText(site, r.x * k, r.z * k + 4);
    }
  }
  radarFrame(view: Player) {
    const ctx = this.radar,
      s = this.sim,
      k = 210 / s.map.width;
    ctx.drawImage(this.mapLayer, 0, 0);
    for (const p of s.players) {
      if (!p.alive || (p.team !== s.me.team && p.spotted < s.time)) continue;
      ctx.fillStyle =
        p.id === view.id
          ? "#e9ff97"
          : p.team === s.me.team
            ? "#82c9da"
            : "#ff805e";
      ctx.beginPath();
      if (p.id === view.id) {
        ctx.save();
        ctx.translate(p.x * k, p.z * k);
        ctx.rotate(p.yaw);
        ctx.moveTo(0, -6);
        ctx.lineTo(4, 4);
        ctx.lineTo(0, 2);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.arc(p.x * k, p.z * k, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const c of s.smokes) {
      ctx.fillStyle = "#c9cdc499";
      ctx.beginPath();
      ctx.arc(c.x * k, c.z * k, s.smokeRadius(c) * k, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const f of s.fires) {
      ctx.fillStyle = "#ff7a3a88";
      ctx.beginPath();
      ctx.arc(f.x * k, f.z * k, f.r * k, 0, Math.PI * 2);
      ctx.fill();
    }
    if (s.bomb && (s.phase === "planted" || s.me.team === "T")) {
      ctx.fillStyle = "#ff9963";
      ctx.fillRect(s.bomb.x * k - 2, s.bomb.z * k - 2, 5, 5);
    }
  }
  update(view: Player, fps: number, lock: boolean, reduce: boolean) {
    const s = this.sim,
      p = s.me,
      el = this.ids;
    this.root.dataset.phase = s.phase;
    el.hit.style.opacity = String(s.time < this.hitEnd ? 1 : 0);
    el.hurt.style.opacity = String(s.time < this.hurtEnd ? 0.5 : 0);
    const eye = view.eye;
    let haze = 0;
    for (const c of s.smokes) {
      const d = Math.hypot(
          eye.x - c.x,
          (eye.y - c.y - 1.25) * 1.35,
          eye.z - c.z,
        ),
        r = s.smokeRadius(c);
      haze = Math.max(haze, clamp01((r - d) / (r * 0.45)));
    }
    el.smoke.style.opacity = String(view.alive ? haze * 0.97 : 0);
    if (this.popEnd && s.time > this.popEnd) {
      el.killpop.classList.remove("on");
      this.popEnd = 0;
    }
    el.flash.style.opacity = String(
      clamp01((p.blinded - s.time) / ((p.blindDuration || 1) * 0.5)) *
        (reduce ? 0.5 : 1),
    );
    if (s.time - this.lastHud < 0.065 && s.time >= this.lastHud) return;
    this.lastHud = s.time;
    this.radarFrame(view);
    label(el.ct, String(s.score.CT));
    label(el.t, String(s.score.T));
    label(el.round, "ROUND " + String(s.round).padStart(2, "0"));
    label(el.clock, clock(s.left));
    label(el.hp, String(Math.ceil(view.hp)));
    label(el.armor, String(Math.ceil(view.armor)));
    label(el.kills, String(view.kills));
    label(
      el.tally,
      "✕".repeat(Math.min(5, view.roundKills)) +
        (view.headshots ? "  HS " + view.headshots : ""),
    );
    label(el.cash, money(p.money));
    label(el.weapon, weaponName(view.weapon));
    label(
      el.ammo,
      String(view.mag?.ammo ?? (isNade(view.weapon) ? view[view.weapon] : "•")),
    );
    label(el.reserve, view.mag ? " / " + view.mag.reserve : "");
    const site = s.map.callouts.reduce(
      (best, n) =>
        (view.x - n.x) ** 2 + (view.z - n.z) ** 2 <
        (view.x - best.x) ** 2 + (view.z - best.z) ** 2
          ? n
          : best,
      s.map.callouts[0],
    );
    label(el.location, site?.name ?? s.map.name);
    label(
      el.feed,
      this.feed
        .filter((k) => k.until > s.time)
        .map((k) => k.text)
        .join("\n"),
    );
    const phase =
      s.phase === "freeze"
        ? "BUY PHASE"
        : s.phase === "warmup"
          ? "MATCH STARTING"
          : s.phase === "planted"
            ? "BOMB PLANTED · SITE " + s.plantedSite
            : "";
    label(el.phase, phase);
    label(
      el.banner,
      s.phase === "ended"
        ? s.result
        : !p.alive
          ? "Spectating " + view.name
          : "",
    );
    const objective = s.objective(p);
    label(
      el.prompt,
      this.hintEnd > s.time
        ? this.hint
        : !lock && !this.mode
          ? "Click to capture mouse"
          : s.work && s.worker === p.id
            ? s.action + "ing…"
            : objective
              ? "Hold " + keyName("use") + " to " + objective.toLowerCase()
              : s.canBuy(p)
                ? keyName("buy") + "  /  Open buy menu"
                : view.reloadEnd
                  ? "Reloading…"
                  : s.carrier === p.id
                    ? "Carrying C4"
                    : "",
    );
    const prog = el.progress as HTMLProgressElement;
    prog.hidden = s.worker !== p.id;
    prog.max = s.action === "Plant" ? 3.2 : p.kit ? 5 : 10;
    prog.value = s.work;
    el.scope.hidden = !view.scoped;
    el.cross.hidden = !!view.scoped || !p.alive;
    el.cross.style.setProperty(
      "--gap",
      (isGun(p.weapon) ? Math.min(20, 3 + s.spread(p, p.weapon) * 2) : 4) +
        "px",
    );
    if (this.debug) {
      el.debug.hidden = false;
      label(el.metrics, Math.round(fps) + " FPS · 64 TICK\n" + s.traceInfo);
      const plot = (el.spray as HTMLCanvasElement).getContext("2d")!;
      plot.clearRect(0, 0, 96, 68);
      if (isGun(p.weapon)) {
        const series = patterns[p.weapon];
        for (let i = 0; i < series.length; i++) {
          const [up, right] = series[i];
          plot.fillStyle =
            i === Math.min(p.index, series.length - 1) ? "#ffb076" : "#becda8";
          plot.fillRect(47 + right * 5, 64 - up * 5, 3, 3);
        }
      }
    }
  }
  destroy() {
    this.abort.abort();
    this.root.remove();
  }
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
