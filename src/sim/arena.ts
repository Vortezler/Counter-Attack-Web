/**
 * Deathmatch and battle royale on the bomb-defusal maps, as teams (5 vs 5) or solo (all ten
 * against each other).
 *
 * Deathmatch respawns everyone a few seconds after they die, with armor, $16,000 to spend near
 * their spawn, and the guns they died with. First team to 50 kills (or player to 20) or the
 * most kills when time runs out wins.
 *
 * Battle royale gives everyone one life and a pistol, scatters weapons and grenades across the
 * map, and closes a damaging zone in stages. The last team or player alive wins, and the match
 * ends the moment every human player is dead.
 *
 * The round game is reused as is: this subclass turns its rounds, bomb and buy zones off, and
 * drives the shared bot brain through its waypoint (`staging`) instead of the bomb sites.
 */
import type { MapDef, Team, Vec3 } from "../world";
import { Sim, distance, type Difficulty, type Drop } from "./Sim";
import { botCommand } from "./bots";
import { DT, U } from "./rules";
import { magazine, type Gun, type Weapon } from "../config/weapons";
import type { Player, PlayerCommand } from "./player";
import type { Group } from "./rules";

export type ArenaKind = "deathmatch" | "royale";
export interface ArenaRules {
  kind: ArenaKind;
  /** Every player for themselves instead of 5 vs 5. */
  solo: boolean;
}
export const isArena = (mode: unknown): mode is ArenaKind =>
  mode === "deathmatch" || mode === "royale";

export const DEATHMATCH = {
  /** Match length in seconds. */
  time: 360,
  teamLimit: 50,
  soloLimit: 20,
  respawn: 2.5,
  /** Spawn protection, ended early by firing. */
  shield: 1.5,
  /** Seconds after spawning during which the armory is open anywhere. */
  buyWindow: 15,
};
/** Each stage: wait, then shrink over `shrink` seconds to radius `r`; outside costs `dps`. */
export const ZONE_STAGES = [
  { wait: 30, shrink: 25, r: 44, dps: 2 },
  { wait: 25, shrink: 20, r: 26, dps: 4 },
  { wait: 20, shrink: 20, r: 13, dps: 7 },
  { wait: 15, shrink: 15, r: 5, dps: 12 },
  { wait: 10, shrink: 15, r: 0, dps: 25 },
];
const ZONE_START = 80;
const LOOT: [Weapon, number][] = [
  ["ak", 6],
  ["m4", 4],
  ["m4a4", 4],
  ["aug", 3],
  ["p90", 6],
  ["nova", 4],
  ["xm", 3],
  ["ssg", 3],
  ["awp", 1],
  ["negev", 1],
  ["deagle", 4],
  ["he", 4],
  ["flash", 3],
  ["smoke", 2],
  ["molly", 3],
];
const other = (t: Team): Team => (t === "T" ? "CT" : "T");
export interface Circle {
  x: number;
  z: number;
  r: number;
}

export class ArenaSim extends Sim {
  arena: ArenaRules;
  /** When each player last spawned. */
  spawnedAt: number[] = [];
  /** When each dead player died (deathmatch respawn timer). */
  deadAt: (number | undefined)[] = [];
  /** Spawn protection runs until this time. */
  shield: number[] = [];
  /** Guns each player carried when they died, handed back on respawn. */
  loadout: { primary?: Gun; pistol?: Gun }[] = [];
  /** Finishing place in battle royale (1 is the winner), by player id. */
  place: (number | undefined)[] = [];
  zone: Circle = { x: 52.5, z: 52.5, r: ZONE_START };
  /** Where the zone is heading next; shown on the radar during the wait. */
  next: Circle = { x: 52.5, z: 52.5, r: ZONE_START };
  stage = 0;
  shrinking = false;
  /** When the current wait or shrink ends. */
  zoneUntil = 0;
  private zoneFrom: Circle = { x: 52.5, z: 52.5, r: ZONE_START };
  private zoneStart = 0;
  private nextZoneHurt = 0;
  private wander: ({ x: number; z: number; until: number } | undefined)[] = [];
  private lastGoal: ({ x: number; z: number } | undefined)[] = [];

  constructor(
    map: MapDef,
    side: Team,
    difficulty: Difficulty,
    name: string,
    seed: number,
    botsOnly: boolean | undefined,
    rules: ArenaRules,
  ) {
    // "casual" gives the base game no friendly fire between teammates.
    super(map, side, difficulty, name, seed, botsOnly, "casual");
    this.arena = rules;
    // Deathmatch: reload as usual, but never run out of spare magazines.
    this.endlessAmmo = rules.kind === "deathmatch";
    this.begin();
  }
  get deathmatch() {
    return this.arena.kind === "deathmatch";
  }
  get royale() {
    return this.arena.kind === "royale";
  }
  isBot(p: Player) {
    return this.botsOnly || (p.id !== 0 && p.id !== this.remotePlayer);
  }
  isHuman(p: Player) {
    return !this.isBot(p);
  }
  /** Whether `a` and `b` fight each other. */
  foes(a: Player, b: Player) {
    return a !== b && (this.arena.solo || a.team !== b.team);
  }
  get limit() {
    return this.arena.solo ? DEATHMATCH.soloLimit : DEATHMATCH.teamLimit;
  }
  /** Players or teams still in a battle royale. */
  get sidesLeft() {
    const alive = this.players.filter((p) => p.alive);
    return this.arena.solo ? alive.length : new Set(alive.map((p) => p.team)).size;
  }

  // ------------------------------------------------------------ the round game, switched off
  override startRound(fresh = false) {
    // Called once by the base constructor before the arena rules exist.
    if (this.arena) return;
    super.startRound(fresh);
  }
  override finish(winner: Team, reason: string) {
    if (this.arena) return;
    super.finish(winner, reason);
  }
  override canBuy(p: Player) {
    return (
      this.deathmatch &&
      p.alive &&
      this.phase !== "finished" &&
      this.time - (this.spawnedAt[p.id] ?? -99) < DEATHMATCH.buyWindow
    );
  }

  // ------------------------------------------------------------ who can hurt whom
  override teamScale(attacker: Player | null, v: Player, kind: Parameters<Sim["teamScale"]>[2]) {
    if (this.arena?.solo && attacker && attacker !== v) return 1;
    return super.teamScale(attacker, v, kind);
  }
  override teammateInLine(p: Player, target: Vec3) {
    return this.arena?.solo ? false : super.teammateInLine(p, target);
  }
  override hear(source: Player, radius: number) {
    if (!this.arena?.solo) return super.hear(source, radius);
    for (const p of this.players)
      if (p.alive && p !== source && distance(p, source) < radius)
        p.heard = { x: source.x, y: source.y, z: source.z };
  }
  override hurt(
    v: Player,
    amount: number,
    p: Player | null,
    weapon: Weapon,
    wallbang = false,
    group: Group = "chest",
  ) {
    if (!this.arena) return super.hurt(v, amount, p, weapon, wallbang, group);
    if (!v.alive || amount <= 0) return;
    if (p && p !== v && this.time < (this.shield[v.id] ?? 0)) return;
    const kept = { primary: v.primary?.id as Gun | undefined, pistol: v.pistol.id as Gun };
    // The base game treats same-coloured players as teammates; in free-for-all they are not.
    const team = v.team,
      swap = this.arena.solo && !!p && p !== v && p.team === team;
    if (swap) v.team = other(team);
    try {
      super.hurt(v, amount, p, weapon, wallbang, group);
    } finally {
      v.team = team;
    }
    if (v.alive) return;
    this.deadAt[v.id] = this.time;
    this.loadout[v.id] = kept;
    if (p && this.foes(p, v) && !this.arena.solo) this.score[p.team]++;
    if (this.royale) {
      const left = this.sidesLeft;
      if (this.arena.solo) this.place[v.id] = left + 1;
      else if (!this.players.some((q) => q.alive && q.team === v.team))
        for (const q of this.players) if (q.team === v.team) this.place[q.id] = left + 1;
    }
  }

  // ------------------------------------------------------------ match flow
  private put(p: Player, at: Vec3 & { yaw: number }) {
    p.respawn(at, true);
    this.physics.enable(p.body, true);
    p.body.crouch = false;
    p.body.collider.setHalfHeight(20 * U);
    this.physics.place(p.body, p, p.yaw);
    this.spawnedAt[p.id] = this.time;
    this.deadAt[p.id] = undefined;
    this.wander[p.id] = undefined;
  }
  private facing(x: number, z: number) {
    return Math.atan2(52.5 - x, z - 52.5);
  }
  /** Walkable nodes away from ramps, where a player can stand. */
  private spots() {
    return this.map.nodes.filter(
      (n) => !this.map.ramps.some((r) => r.x === n.x && r.z === n.z),
    );
  }
  /** Spreads `count` points across the map, each as far from the others as possible. */
  private farApart(count: number, from: Vec3[] = []) {
    const spots = this.spots(),
      picked: Vec3[] = [];
    for (let i = 0; i < count; i++) {
      let best = spots[Math.floor(this.rng() * spots.length)],
        far = -1;
      for (let k = 0; k < 40; k++) {
        const n = spots[Math.floor(this.rng() * spots.length)];
        const near = Math.min(
          ...[...from, ...picked].map((q) => distance(n, q)),
          Infinity,
        );
        if (near > far) {
          far = near;
          best = n;
        }
      }
      picked.push(best);
    }
    return picked;
  }
  /** A respawn point out of sight of, and far from, living enemies. */
  private spawnPoint(p: Player) {
    const spots = this.spots(),
      foes = this.players.filter((q) => q.alive && this.foes(p, q));
    let best = spots[0],
      score = -Infinity;
    for (let k = 0; k < 18; k++) {
      const n = spots[Math.floor(this.rng() * spots.length)];
      let near = Infinity,
        seen = false;
      for (const q of foes) {
        const d = distance(n, q);
        near = Math.min(near, d);
        if (!seen && d < 50)
          seen = this.visible({ x: n.x, y: n.y + 1.6, z: n.z }, q.eye, false);
      }
      const value = Math.min(near, 45) - (seen ? 35 : 0) + this.rng() * 4;
      if (value > score) {
        score = value;
        best = n;
      }
    }
    return { x: best.x, y: best.y + 0.05, z: best.z, yaw: this.facing(best.x, best.z) };
  }
  private equipDeathmatch(p: Player) {
    p.armor = 100;
    p.helmet = true;
    p.money = 16000;
    const keep = this.loadout[p.id];
    if (keep?.pistol) p.pistol = magazine(keep.pistol);
    if (keep?.primary) p.primary = magazine(keep.primary);
    p.weapon = p.primary?.id ?? p.pistol.id;
    if (this.isBot(p)) this.botBuy(p);
  }
  private begin() {
    this.round = 1;
    this.score = { CT: 0, T: 0 };
    this.losses = { CT: 0, T: 0 };
    this.carrier = -1;
    this.bomb = null;
    this.drops = [];
    this.phase = "freeze";
    this.left = 4;
    let spots: Vec3[];
    if (this.royale && !this.arena.solo) {
      // Each squad drops in together, the two squads at opposite ends.
      const [a, b] = this.farApart(2);
      spots = [];
      for (const p of this.players) {
        const anchor = p.team === this.players[0].team ? a : b;
        const near = this.spots()
          .filter((n) => !spots.some((s) => distance(s, n) < 3))
          .sort((m, n) => distance(m, anchor) - distance(n, anchor))[0] ?? anchor;
        spots.push(near);
      }
    } else spots = this.farApart(this.players.length);
    this.players.forEach((p, i) => {
      const at = spots[i];
      this.put(p, { x: at.x, y: at.y + 0.05, z: at.z, yaw: this.facing(at.x, at.z) });
      p.kills = p.deaths = p.headshots = 0;
      this.shield[p.id] = 0;
      if (this.deathmatch) this.equipDeathmatch(p);
      else p.money = 0;
    });
    if (this.royale) {
      this.scatterLoot(spots);
      const middle = this.spots().filter((n) => distance(n, { x: 52.5, z: 52.5 }) < 30);
      const c = middle[Math.floor(this.rng() * middle.length)] ?? { x: 52.5, z: 52.5 };
      this.zone = { x: c.x, z: c.z, r: ZONE_START };
      this.zoneFrom = { ...this.zone };
      this.stage = 0;
      this.shrinking = false;
      this.next = this.target(this.zone, ZONE_STAGES[0].r);
    }
    this.physics.world.step();
    this.emit({ type: "roundStart" });
  }
  /** Guns, grenades and pistols lying around the map for a battle royale. */
  private scatterLoot(avoid: Vec3[]) {
    const total = LOOT.reduce((n, [, w]) => n + w, 0),
      pick = () => {
        let r = this.rng() * total;
        for (const [item, w] of LOOT) if ((r -= w) < 0) return item;
        return LOOT[0][0];
      };
    const spots = this.farApart(24, avoid);
    for (const n of spots) {
      const item = pick(),
        mag = item === "he" || item === "flash" || item === "smoke" || item === "molly"
          ? undefined
          : magazine(item as Gun);
      const drop: Drop = {
        id: this.nextDrop++,
        item,
        x: n.x + (this.rng() - 0.5) * 1.2,
        y: n.y,
        z: n.z + (this.rng() - 0.5) * 1.2,
        yaw: this.rng() * Math.PI * 2,
        born: this.time - 5,
        ...(mag && { ammo: mag.ammo, reserve: mag.reserve }),
      };
      this.drops.push(drop);
    }
  }
  /** A circle of radius `r` inside `c`, centred on walkable ground. */
  private target(c: Circle, r: number): Circle {
    const room = Math.max(0, c.r - r) * 0.85;
    const options = this.spots().filter((n) => distance(n, c) <= room);
    const n = options[Math.floor(this.rng() * options.length)];
    return n ? { x: n.x, z: n.z, r } : { x: c.x, z: c.z, r };
  }
  private finishMatch(result: string) {
    this.phase = "finished";
    this.result = result;
    this.emit({ type: "matchEnd", message: result });
  }

  override step(commands: Record<number, PlayerCommand> = {}) {
    if (this.phase === "finished") return;
    if (this.phase === "freeze" && this.left - DT <= 0) {
      this.phase = "live";
      this.left =
        (this.deathmatch
          ? DEATHMATCH.time
          : ZONE_STAGES.reduce((t, s) => t + s.wait + s.shrink, 0) + 30) + DT;
      this.zoneUntil = this.time + DT + ZONE_STAGES[0].wait;
      this.emit({ type: "live" });
    }
    if (this.phase === "live") {
      const mine = { ...commands };
      for (const p of this.players)
        if (p.alive && this.isBot(p) && !mine[p.id]) mine[p.id] = this.botFor(p);
      commands = mine;
    }
    super.step(commands);
    if (this.phase !== "live") return;
    if (this.arena.solo) this.burnRivals();
    for (const p of this.players)
      if (p.alive && p.lastFire > (this.spawnedAt[p.id] ?? 0)) this.shield[p.id] = 0;
    if (this.deathmatch) this.deathmatchTick();
    else this.royaleTick();
  }
  /**
   * The base game's fire never burns the thrower's colour; in free-for-all it burns everyone
   * but the thrower. Runs on the ticks where the base game applied fire damage.
   */
  private burnRivals() {
    for (const f of this.fires) {
      if (f.next !== this.time + 0.25) continue;
      for (const p of this.players)
        if (
          p.alive &&
          p.team === f.team &&
          p.id !== f.owner &&
          Math.hypot(p.x - f.x, p.z - f.z) < f.r &&
          Math.abs(p.y - f.y) < 1.4
        )
          this.hurt(p, 10, this.players[f.owner], "molly");
    }
  }
  private deathmatchTick() {
    for (const p of this.players) {
      const died = this.deadAt[p.id];
      if (p.alive || died === undefined || this.time - died < DEATHMATCH.respawn) continue;
      this.put(p, this.spawnPoint(p));
      this.shield[p.id] = this.time + DEATHMATCH.shield;
      this.equipDeathmatch(p);
      this.emit({ type: "respawn", actor: p.id, pos: p.eye });
    }
    const me = this.me;
    if (this.arena.solo) {
      const best = Math.max(...this.players.map((q) => q.kills));
      if (best >= this.limit || this.left <= 0) {
        const leaders = this.players.filter((q) => q.kills === best).length,
          place = 1 + this.players.filter((q) => q.kills > me.kills).length;
        this.finishMatch(
          me.kills === best
            ? (leaders > 1 ? "Match tied · " : "Match victory · ") + me.kills + " kills"
            : "Match defeat · #" + place + " of " + this.players.length + " · " + me.kills + " kills",
        );
      }
      return;
    }
    if (Math.max(this.score.CT, this.score.T) >= this.limit || this.left <= 0) {
      const mine = this.score[me.team],
        theirs = this.score[other(me.team)];
      this.finishMatch(
        mine === theirs
          ? "Match tied · " + mine + " – " + theirs
          : (mine > theirs ? "Match victory · " : "Match defeat · ") + mine + " – " + theirs,
      );
    }
  }
  private royaleTick() {
    // Zone: wait, then shrink toward the next circle, stage by stage.
    const stage = ZONE_STAGES[Math.min(this.stage, ZONE_STAGES.length - 1)];
    if (this.time >= this.zoneUntil && this.stage < ZONE_STAGES.length) {
      if (!this.shrinking) {
        this.shrinking = true;
        this.zoneFrom = { ...this.zone };
        this.zoneStart = this.time;
        this.zoneUntil = this.time + stage.shrink;
        this.emit({ type: "zone", message: "The zone is closing" });
      } else {
        this.shrinking = false;
        this.zone = { ...this.next };
        this.stage++;
        const following = ZONE_STAGES[this.stage];
        if (following) {
          this.next = this.target(this.zone, following.r);
          this.zoneUntil = this.time + following.wait;
        }
      }
    }
    if (this.shrinking) {
      const k = Math.min(1, (this.time - this.zoneStart) / stage.shrink);
      this.zone = {
        x: this.zoneFrom.x + (this.next.x - this.zoneFrom.x) * k,
        z: this.zoneFrom.z + (this.next.z - this.zoneFrom.z) * k,
        r: this.zoneFrom.r + (this.next.r - this.zoneFrom.r) * k,
      };
    }
    if (this.time >= this.nextZoneHurt) {
      this.nextZoneHurt = this.time + 0.5;
      const hurt = ZONE_STAGES[Math.max(0, Math.min(this.stage, ZONE_STAGES.length - 1))].dps;
      for (const p of this.players)
        if (p.alive && distance(p, this.zone) > this.zone.r)
          this.hurt(p, Math.max(1, Math.round(hurt / 2)), null, "bomb");
    }
    const me = this.me;
    const humans = this.players.filter((p) => this.isHuman(p));
    // Battle royale ends as soon as no human player is left alive.
    if (humans.length && !humans.some((p) => p.alive)) {
      const place = this.place[me.id] ?? this.sidesLeft + 1;
      this.finishMatch(
        "Eliminated · #" + place + " of " + (this.arena.solo ? this.players.length : 2),
      );
      return;
    }
    if (this.sidesLeft <= 1 || this.left <= 0) {
      const won = this.arena.solo
        ? me.alive && this.sidesLeft <= 1
        : this.players.some((p) => p.alive && p.team === me.team) && this.sidesLeft <= 1;
      for (const p of this.players) if (p.alive) this.place[p.id] = 1;
      this.finishMatch(
        won
          ? this.arena.solo
            ? "Victory · Last one standing"
            : "Victory · Last squad standing"
          : this.arena.solo
            ? "Defeat · #" + (this.place[me.id] ?? 2) + " of " + this.players.length
            : "Defeat · Squad eliminated",
      );
    }
  }

  // ------------------------------------------------------------ bots
  /** Where a bot heads when it is not fighting; `null` holds the current spot. */
  private goalFor(p: Player): { x: number; z: number } | null {
    const zone = this.shrinking ? this.next : this.zone;
    if (this.royale) {
      if (distance(p, zone) > Math.max(2, zone.r - 4)) {
        this.hold[p.id] = 0;
        return { x: zone.x, z: zone.z };
      }
      if (!p.primary) {
        let best: Drop | null = null,
          reach = 26;
        for (const d of this.drops) {
          const r = distance(p, d);
          if (r < reach && d.item !== "kit" && !["he", "flash", "smoke", "molly", "glock", "deagle"].includes(d.item)) {
            reach = r;
            best = d;
          }
        }
        if (best) return { x: best.x, z: best.z };
      }
    }
    // Deathmatch bots chase every sound; battle royale bots only check close ones.
    if (p.heard) {
      const d = distance(p, p.heard);
      if (d > 3 && (this.deathmatch || d < 24)) {
        this.hold[p.id] = 0;
        return { x: p.heard.x, z: p.heard.z };
      }
      p.heard = null;
    }
    if (this.time < (this.hold[p.id] ?? 0)) return null;
    const w = this.wander[p.id];
    if (w && this.time < w.until && distance(p, w) > 2.5) return w;
    if (w && this.royale && distance(p, w) <= 2.5) {
      // Arrived: hold the spot and watch for a while before moving on.
      this.wander[p.id] = undefined;
      this.hold[p.id] = this.time + 7 + this.rng() * 12;
      return null;
    }
    const far = this.royale ? 30 : 55;
    const spots = this.spots().filter(
      (n) =>
        distance(n, p) > 10 &&
        distance(n, p) < far &&
        (!this.royale || distance(n, zone) < Math.max(4, zone.r - 3)),
    );
    const n = spots[Math.floor(this.rng() * spots.length)] ?? zone;
    const goal = { x: n.x, z: n.z, until: this.time + 20 };
    this.wander[p.id] = goal;
    return goal;
  }
  private hold: number[] = [];
  private botFor(p: Player) {
    const goal = this.goalFor(p),
      last = this.lastGoal[p.id];
    if (goal && (!last || distance(last, goal) > 1)) {
      p.repath = 0;
      this.lastGoal[p.id] = { x: goal.x, z: goal.z };
    }
    // Holding: aim the brain at a point just away so it keeps its waypoint, then stand still.
    p.staging = goal ? { x: goal.x, z: goal.z } : { x: p.x + 4, z: p.z };
    const cmd = this.think(p);
    const target = this.players[p.target];
    if (!goal && !(target?.alive && this.foes(p, target))) {
      cmd.moveX = cmd.moveZ = 0;
      cmd.jump = false;
      cmd.yaw = p.yaw + Math.sin(this.time * 0.6 + p.id * 1.7) * 0.012;
      cmd.pitch = p.pitch * 0.9;
    }
    return cmd;
  }
  private think(p: Player) {
    if (!this.arena.solo) return botCommand(this, p);
    // Free-for-all: for this bot's decision everyone else wears the other colour.
    const teams = this.players.map((q) => q.team),
      rival = other(p.team);
    for (const q of this.players) if (q !== p) q.team = rival;
    try {
      return botCommand(this, p);
    } finally {
      this.players.forEach((q, i) => (q.team = teams[i]));
    }
  }
}
