/**
 * Match HUD for deathmatch and battle royale: the score strip shows kills or players left, the
 * clock counts the zone, the radar draws the zone and the scoreboard ranks everyone in
 * free-for-all.
 */
import "./arena.css";
import { MatchHud } from "./hud";
import type { Player } from "./sim/player";
import { distance } from "./sim/Sim";
import type { ArenaSim } from "./sim/arena";
import { DEATHMATCH } from "./sim/arena";
import { showZone } from "./scenery";
import type { SimEvent } from "./sim/Sim";

const clock = (v: number) => {
  const s = Math.ceil(Math.max(0, v));
  return Number.isFinite(s) ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : "∞";
};
function set(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

export class ArenaHud extends MatchHud {
  declare sim: ArenaSim;
  constructor(...args: ConstructorParameters<typeof MatchHud>) {
    super(...args);
    const s = this.sim;
    this.root.dataset.arena = s.arena.kind;
    if (s.arena.solo) this.root.dataset.solo = "";
    const warn = document.createElement("div");
    warn.className = "csw-zonewarn";
    warn.setAttribute("aria-hidden", "true");
    this.root.prepend(warn);
    this.paintRadarMap();
  }
  get title() {
    const s = this.sim;
    return (s.deathmatch ? "DEATHMATCH" : "BATTLE ROYALE") + (s.arena.solo ? " · SOLO" : " · TEAMS");
  }
  /** The radar without bombsites, which mean nothing here. */
  override paintRadarMap() {
    // The base constructor paints once before this class is set up; repaint afterwards.
    if (!this.sim?.arena) return super.paintRadarMap();
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
    for (const b of map.boxes)
      if (b.style !== "floor" && b.style !== "roof")
        ctx.fillRect((b.x - b.w / 2) * k, (b.z - b.d / 2) * k, b.w * k, b.d * k);
  }
  override radarFrame(view: Player) {
    const ctx = this.radar,
      s = this.sim,
      k = 210 / s.map.width;
    ctx.drawImage(this.mapLayer, 0, 0);
    if (s.royale) {
      // Outside the zone is shaded; the next circle is dashed.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 210, 210);
      ctx.arc(s.zone.x * k, s.zone.z * k, Math.max(0, s.zone.r) * k, 0, Math.PI * 2, true);
      ctx.fillStyle = "#ff503c40";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.zone.x * k, s.zone.z * k, Math.max(0, s.zone.r) * k, 0, Math.PI * 2);
      ctx.strokeStyle = "#f4f0e2";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (s.next.r < s.zone.r - 0.5) {
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.arc(s.next.x * k, s.next.z * k, Math.max(0, s.next.r) * k, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffffaa";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
      // Loot on the ground.
      ctx.fillStyle = "#e6c46a";
      for (const d of s.drops) ctx.fillRect(d.x * k - 1, d.z * k - 1, 2, 2);
    }
    const me = s.me;
    for (const p of s.players) {
      if (!p.alive) continue;
      const ally = p === view || p === me || !s.foes(me, p);
      // Enemies show when a teammate spots them, or briefly when they fire close by.
      const heard = s.time - p.lastFire < 1.2 && distance(p, view) < 35;
      if (!ally && p.spotted < s.time && !heard) continue;
      ctx.fillStyle = p.id === view.id ? "#e9ff97" : ally ? "#82c9da" : "#ff805e";
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
  }
  override update(view: Player, fps: number, lock: boolean, reduce: boolean) {
    super.update(view, fps, lock, reduce);
    const s = this.sim,
      me = s.me,
      el = this.ids;
    const live = s.phase === "live";
    showZone(s.zone.x, s.zone.z, s.zone.r, s.royale && s.phase !== "finished");
    const outside = s.royale && live && me.alive && distance(me, s.zone) > s.zone.r;
    this.root.toggleAttribute("data-outside", outside);
    set(el.round, this.title);
    const alive = s.players.filter((p) => p.alive);
    if (s.deathmatch) {
      if (s.arena.solo) {
        const best = Math.max(...s.players.map((p) => p.kills));
        set(el.ct, String(me.kills));
        set(el.t, String(best));
        el.ct.dataset.label = "YOU";
        el.t.dataset.label = "LEADER · " + s.limit;
      } else {
        el.ct.dataset.label = (me.team === "CT" ? "YOUR TEAM" : "CT") + " · " + s.limit;
        el.t.dataset.label = me.team === "T" ? "YOUR TEAM" : "T";
      }
      set(el.clock, clock(s.left));
    } else {
      if (s.arena.solo) {
        set(el.ct, String(alive.length));
        set(el.t, String(me.kills));
        el.ct.dataset.label = "ALIVE";
        el.t.dataset.label = "KILLS";
      } else {
        set(el.ct, String(alive.filter((p) => p.team === "CT").length));
        set(el.t, String(alive.filter((p) => p.team === "T").length));
        el.ct.dataset.label = me.team === "CT" ? "YOUR SQUAD" : "ALIVE";
        el.t.dataset.label = me.team === "T" ? "YOUR SQUAD" : "ALIVE";
      }
      set(el.clock, live && s.stage < 5 ? clock(s.zoneUntil - s.time) : clock(s.left));
      set(el.cash, "");
    }
    set(
      el.phase,
      s.phase === "freeze"
        ? "MATCH STARTING"
        : outside
          ? "OUTSIDE THE ZONE · GET IN"
          : s.royale && live && s.stage < 5
            ? s.shrinking
              ? "ZONE CLOSING"
              : "ZONE MOVES IN"
            : "",
    );
    if (s.deathmatch && !me.alive && live) {
      const died = s.deadAt[me.id];
      set(
        el.banner,
        died === undefined
          ? ""
          : "Respawning in " + Math.max(1, Math.ceil(DEATHMATCH.respawn - (s.time - died))),
      );
    }
  }
  override scoreboard(end = false) {
    super.scoreboard(end);
    const s = this.sim,
      head = this.ids.panel.querySelector("header small");
    if (head) head.textContent = s.map.name + " / " + this.title;
    if (!s.arena.solo) return;
    const tables = this.ids.panel.querySelector("[data-teams]");
    if (!tables) return;
    const table = document.createElement("table");
    table.className = "csw-ffa";
    table.innerHTML =
      "<caption>Free for all</caption><thead><tr><th>#</th><th>Operator</th><th>K</th><th>D</th><th>HS</th><th>Link</th></tr></thead>";
    const body = table.createTBody();
    const order = [...s.players].sort((a, b) =>
      s.royale
        ? (s.place[a.id] ?? 0) - (s.place[b.id] ?? 0) || b.kills - a.kills
        : b.kills - a.kills || a.deaths - b.deaths,
    );
    order.forEach((p, i) => {
      const row = body.insertRow();
      for (const data of [
        s.royale ? (p.alive ? "—" : "#" + (s.place[p.id] ?? "?")) : i + 1,
        p.name + (p.alive ? "" : " †"),
        p.kills,
        p.deaths,
        p.headshots,
        s.isBot(p) ? "BOT" : "LOCAL",
      ])
        row.insertCell().textContent = String(data);
    });
    tables.replaceChildren(table);
  }
  override event(e: SimEvent) {
    super.event(e);
    const s = this.sim;
    if (e.type === "kill" && e.actor === undefined && s.royale && this.feed[0])
      this.feed[0].text = "Zone  /  " + s.players[e.victim!].name;
    if (e.type === "zone") this.note("The zone is closing");
    if (e.type === "respawn" && e.actor === s.me.id) this.note("Back in · buy anywhere for " + DEATHMATCH.buyWindow + " s");
  }
  override destroy() {
    showZone(0, 0, 0, false);
    super.destroy();
  }
}
