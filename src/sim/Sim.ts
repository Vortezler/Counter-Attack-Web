import type { MapDef, Team, Vec3 } from "../world";
import type { RigidBody } from "@dimforge/rapier3d-compat";
import {
  catalog,
  gear,
  isGun,
  magazine,
  shop,
  weaponName,
  pellets,
  scopes,
  semiAuto,
  killReward,
  isNade,
  nadeLimit,
  nades,
  knife,
  type Item,
  type Gun,
  type Nade,
  type Weapon,
} from "../config/weapons";
import { patterns } from "../config/recoilPatterns";
import { Physics } from "./Physics";
import { Player, idle, type PlayerCommand } from "./player";
import {
  U,
  DT,
  DEG,
  GRAVITY,
  JUMP,
  capMoney,
  lossPay,
  seeded,
  clamp,
  velocity,
  penetrate,
  damage,
  nearest,
  type Group,
} from "./rules";
import { botCommand } from "./bots";
export type Difficulty = "easy" | "normal" | "hard";
/** Competitive has friendly fire; casual gives everyone full armor and every CT a defuse kit. */
export type GameMode = "competitive" | "casual";
/** CS-style friendly-fire scaling for damage between teammates in competitive. */
export const teamDamage = {
  bullet: 0.33,
  grenade: 0.85,
  fire: 0.4,
  melee: 0.4,
};
type Phase = "warmup" | "freeze" | "live" | "planted" | "ended" | "finished";
export interface SimEvent {
  type: string;
  actor?: number;
  victim?: number;
  weapon?: Weapon;
  pos?: Vec3;
  end?: Vec3;
  normal?: Vec3;
  message?: string;
  amount?: number;
  wallbang?: boolean;
  head?: boolean;
  /** Horizontal for kills; blood events also carry the bullet's vertical component. */
  dir?: { x: number; z: number; y?: number };
}
interface Grenade {
  id: number;
  type: Nade;
  owner: number;
  body: RigidBody;
  born: number;
  expires: number;
  lastVy: number;
}
export interface Smoke {
  id: number;
  x: number;
  y: number;
  z: number;
  r: number;
  born: number;
  until: number;
}
export interface Fire {
  id: number;
  x: number;
  y: number;
  z: number;
  r: number;
  born: number;
  until: number;
  owner: number;
  team: Team;
  next: number;
}
/** A weapon, grenade or defuse kit lying on the ground, dropped by a dead player or a swap. */
export interface Drop {
  id: number;
  item: Weapon | "kit";
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** When it was dropped, for the fall animation. */
  born: number;
  ammo?: number;
  reserve?: number;
}
export const DROP_REACH = 1.1;
export const SMOKE_TIME = 18,
  FIRE_TIME = 7;
type Hits = Map<
  number,
  { hp: number; armor: number; head: boolean; wall: boolean }
>;
export const inside = (
  p: Vec3,
  r: { x: number; z: number; w: number; d: number; y: number },
) =>
  Math.abs(p.x - r.x) <= r.w / 2 &&
  Math.abs(p.z - r.z) <= r.d / 2 &&
  Math.abs(p.y - r.y) < 3;
export const distance = (
  a: { x: number; z: number },
  b: { x: number; z: number },
) => Math.hypot(a.x - b.x, a.z - b.z);
const advance = (p: Vec3, d: Vec3, len: number) => ({
  x: p.x + d.x * len,
  y: p.y + d.y * len,
  z: p.z + d.z * len,
});
const other = (t: Team): Team => (t === "T" ? "CT" : "T");
export class Sim {
  physics: Physics;
  viewer = 0;
  remotePlayer?: number;
  players: Player[] = [];
  rng: () => number;
  time = 0;
  tick = 0;
  phase: Phase = "warmup";
  left = 3;
  round = 1;
  score = { CT: 0, T: 0 };
  losses = { CT: 0, T: 0 };
  result = "";
  carrier = -1;
  /** The loose or planted C4; `yaw` is how a planted one was set down. */
  bomb: (Vec3 & { yaw?: number }) | null = null;
  plantedSite = "";
  work = 0;
  worker = -1;
  action = "";
  grenades: Grenade[] = [];
  smokes: Smoke[] = [];
  fires: Fire[] = [];
  drops: Drop[] = [];
  nextGrenade = 0;
  nextDrop = 0;
  lastBeep = 0;
  traceInfo = "";
  listeners = new Set<(e: SimEvent) => void>();
  constructor(
    public map: MapDef,
    side: Team = "CT",
    public difficulty: Difficulty = "normal",
    name = "Player",
    seed = 17,
    public botsOnly = false,
    public mode: GameMode = "competitive",
  ) {
    this.rng = seeded(seed);
    this.physics = new Physics(map);
    const names = [
      "",
      "Rook",
      "Vector",
      "Sable",
      "Flint",
      "Atlas",
      "Vale",
      "Mako",
      "Echo",
      "Slate",
    ];
    for (let i = 0; i < (map.id === "range" ? 4 : 10); i++) {
      const team = i < (map.id === "range" ? 1 : 5) ? side : other(side);
      const spawn = map.spawns[team][i % map.spawns[team].length];
      this.players.push(
        new Player(
          i,
          i === 0 ? name : names[i],
          team,
          this.physics.createPlayer(i, spawn),
        ),
      );
    }
    this.startRound(true);
    if (map.id === "range") {
      this.phase = "live";
      this.left = Infinity;
      this.players[0].money = 16000;
    } else {
      this.phase = "warmup";
      this.left = 3;
    }
  }
  get me() {
    return this.players[this.viewer];
  }
  onEvent(cb: (e: SimEvent) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(e: SimEvent) {
    for (const cb of this.listeners) cb(e);
  }
  startRound(fresh = false) {
    for (const g of this.grenades) this.physics.world.removeRigidBody(g.body);
    this.grenades = [];
    this.smokes = [];
    this.fires = [];
    this.drops = [];
    this.bomb = null;
    this.plantedSite = "";
    this.worker = -1;
    this.work = 0;
    this.action = "";
    this.phase = "freeze";
    this.left = 15;
    const orders = { CT: 0, T: 0 };
    const main = this.rng() < 0.5 ? "A" : "B";
    for (const p of this.players) {
      const idx = orders[p.team]++;
      const arr =
        this.map.id === "range"
          ? this.map.spawns[p.id === 0 ? "CT" : "T"]
          : this.map.spawns[p.team];
      const pos = arr[idx % arr.length];
      p.respawn(pos, fresh);
      if (this.mode === "casual" && this.map.id !== "range") {
        p.armor = 100;
        p.helmet = true;
        if (p.team === "CT") p.kit = true;
      }
      this.physics.enable(p.body, true);
      p.body.crouch = false;
      p.body.collider.setHalfHeight(20 * U);
      this.physics.place(p.body, p, p.yaw);
      p.patrol =
        p.team === "CT"
          ? idx % 2
            ? "B"
            : "A"
          : idx === 4
            ? main === "A"
              ? "B"
              : "A"
            : main;
      const routes = this.map.staging?.[p.patrol];
      if (p.team === "T" && routes?.length) {
        const via = routes[idx % routes.length];
        p.staging = this.map.callouts.find((n) => n.name === via) ?? null;
      } else p.staging = null;
    }
    const ts = this.players.filter((p) => p.team === "T");
    this.carrier = ts[0]?.id ?? -1;
    for (const p of this.players)
      if (
        this.map.id !== "range" &&
        (this.botsOnly || (p.id !== 0 && p.id !== this.remotePlayer)) &&
        !(this.round === 1 && fresh)
      )
        this.botBuy(p);
    this.physics.world.step();
    this.emit({ type: "roundStart" });
  }
  botBuy(p: Player) {
    const eco = p.money < 2000 && this.losses[p.team] > 0;
    if (eco && (p.primary || p.money < 1050 || this.rng() < 0.6)) return;
    if (!p.primary) {
      const r = this.rng();
      const pick = (table: [number, Gun][], fallback: Gun) =>
        table.find(([odds]) => r < odds)?.[1] ?? fallback;
      const wish: Gun[] = eco
        ? [this.rng() < 0.5 ? "nova" : "p90", "nova"]
        : p.team === "T"
          ? [
              pick(
                [
                  [0.12, "awp"],
                  [0.22, "ssg"],
                  [0.31, "p90"],
                  [0.36, "xm"],
                  [0.4, "nova"],
                ],
                "ak",
              ),
              "ak",
              "ssg",
              "p90",
              "nova",
            ]
          : [
              pick(
                [
                  [0.12, "awp"],
                  [0.18, "ssg"],
                  [0.25, "p90"],
                  [0.3, "xm"],
                  [0.46, "aug"],
                  [0.72, "m4a4"],
                ],
                "m4",
              ),
              "m4a4",
              "m4",
              "ssg",
              "p90",
              "nova",
            ];
      for (const gun of wish) if (this.buy(p, gun) === "Purchased") break;
    }
    for (const item of [
      "helmet",
      "kevlar",
      ...(!p.primary ? ["deagle"] : []),
      "kit",
      "smoke",
      this.rng() < 0.55 ? "molly" : "he",
      "flash",
      "he",
    ] as Item[])
      this.buy(p, item);
    if (p.primary) p.weapon = p.primary.id;
  }
  canBuy(p: Player) {
    return (
      p.alive &&
      (this.map.id === "range" ||
        ((this.phase === "freeze" ||
          (this.phase === "live" && this.left >= 95)) &&
          inside(p, this.map.buyZones[p.team])))
    );
  }
  buy(p: Player, item: Item): string {
    if (!Object.hasOwn(shop, item) || !this.canBuy(p))
      return "Buy time or spawn zone required";
    const g = isGun(item) ? catalog[item] : null;
    if ((g?.team && g.team !== p.team) || (item === "kit" && p.team !== "CT"))
      return "Other team only";
    if (
      (g && (p.primary?.id === item || p.pistol.id === item)) ||
      (isNade(item) &&
        (p[item] >= nadeLimit[item] ||
          nades.reduce((n, k) => n + p[k], 0) >= 4)) ||
      (item === "kit" && p.kit) ||
      (item === "kevlar" && p.armor >= 100) ||
      (item === "helmet" && p.armor >= 100 && p.helmet)
    )
      return "Already equipped";
    const cost = shop[item].price;
    if (p.money < cost) return "Insufficient funds";
    p.money -= cost;
    if (isGun(item)) {
      const mag = magazine(item);
      if (catalog[item].slot === 1) p.primary = mag;
      else p.pistol = mag;
      this.equip(p, item);
    } else if (isNade(item)) p[item]++;
    else if (item === "kit") p.kit = true;
    else {
      p.armor = 100;
      if (item === "helmet") p.helmet = true;
    }
    return "Purchased";
  }
  equip(p: Player, w: Weapon) {
    if (w === p.weapon) return;
    p.previous = p.weapon;
    p.weapon = w;
    p.scoped = 0;
    p.reloadEnd = 0;
    p.windup = 0;
    p.burstLeft = 0;
    p.index = p.punchX = p.punchY = p.penalty = 0;
    p.drawEnd =
      this.time +
      (isGun(w)
        ? catalog[w].slot === 1
          ? 0.5
          : 0.4
        : w === "knife"
          ? 0.3
          : 0.7);
  }
  switch(p: Player, slot: number) {
    const items: Weapon[] = [
      ...(p.primary ? [p.primary.id] : []),
      p.pistol.id,
      "knife",
      ...nades.filter((k) => p[k] > 0),
      ...(this.carrier === p.id ? ["bomb" as const] : []),
    ];
    const selected =
      slot === 1
        ? p.primary?.id
        : slot === 2
          ? p.pistol.id
          : slot === 3
            ? "knife"
            : slot === 4
              ? this.nextNade(p)
              : slot >= 11 && slot <= 14 && p[nades[slot - 11]] > 0
                ? nades[slot - 11]
                : slot === 5 && this.carrier === p.id
                ? "bomb"
                : slot === -1 && items.includes(p.previous)
                  ? p.previous
                  : slot === 9 || slot === -9
                    ? items[
                        (items.indexOf(p.weapon) +
                          (slot === 9 ? 1 : -1) +
                          items.length) %
                          items.length
                      ]
                    : undefined;
    if (selected) this.equip(p, selected);
  }
  nextNade(p: Player): Nade | undefined {
    const owned = nades.filter((k) => p[k] > 0);
    if (!owned.length) return undefined;
    const at = isNade(p.weapon) ? owned.indexOf(p.weapon) : -1;
    return owned[(at + 1) % owned.length];
  }
  siteAt(p: Vec3) {
    return inside(p, this.map.sites.A)
      ? "A"
      : inside(p, this.map.sites.B)
        ? "B"
        : "";
  }
  objective(p: Player) {
    if (this.phase === "live" && p.id === this.carrier && this.siteAt(p))
      return "Plant";
    if (
      this.phase === "planted" &&
      p.team === "CT" &&
      this.bomb &&
      distance(p, this.bomb) < 2.2 &&
      Math.abs(this.bomb.y - p.y) < 2
    )
      return "Defuse";
    return "";
  }
  step(commands: Record<number, PlayerCommand> = {}) {
    if (this.phase === "finished") return;
    this.tick++;
    this.time += DT;
    this.left -= DT;
    if (this.phase === "warmup" && this.left <= 0) {
      this.phase = "freeze";
      this.left = 15;
      for (const p of this.players)
        if (this.botsOnly || (p.id !== 0 && p.id !== this.remotePlayer))
          this.botBuy(p);
    }
    if (this.phase === "ended") {
      if (this.left <= 0) {
        if (Math.max(this.score.CT, this.score.T) >= 13 || this.round >= 24) {
          this.phase = "finished";
          this.result =
            this.score.CT === this.score.T
              ? "Match tied"
              : this.score[this.me.team] > this.score[other(this.me.team)]
                ? "Match victory"
                : "Match defeat";
          this.emit({ type: "matchEnd", message: this.result });
          return;
        }
        this.round++;
        if (this.round === 13) {
          [this.score.CT, this.score.T] = [this.score.T, this.score.CT];
          this.losses = { CT: 0, T: 0 };
          for (const p of this.players) {
            p.team = other(p.team);
            p.money = 800;
          }
          this.startRound(true);
        } else this.startRound();
      }
      return;
    }
    if (this.phase === "freeze" && this.left <= 0) {
      this.phase = "live";
      this.left = 115;
      this.emit({ type: "live" });
    }
    const active = this.phase === "live" || this.phase === "planted";
    let acting = -1;
    for (const p of this.players) {
      if (!p.alive) continue;
      const bot = this.botsOnly || (p.id !== 0 && p.id !== this.remotePlayer);
      const cmd =
        commands[p.id] ??
        (bot && active && this.map.id !== "range"
          ? botCommand(this, p)
          : idle(p.yaw, p.pitch));
      p.last.x = p.x;
      p.last.y = p.y;
      p.last.z = p.z;
      p.yaw = cmd.yaw;
      p.pitch = clamp(cmd.pitch, -1.553, 1.553);
      if (cmd.buy && Object.hasOwn(shop, cmd.buy)) this.buy(p, cmd.buy as Item);
      if (cmd.slot) this.switch(p, cmd.slot);
      // Planting and defusing hold the player still on one knee.
      const working = this.worker === p.id && cmd.use;
      if (active)
        this.move(p, working ? { ...cmd, moveX: 0, moveZ: 0, jump: false } : cmd);
      if (p.reloadEnd && this.time >= p.reloadEnd) {
        const m = p.mag;
        if (m) {
          const amount = Math.min(m.reserve, catalog[m.id].mag - m.ammo);
          m.ammo += amount;
          m.reserve -= amount;
        }
        p.reloadEnd = 0;
      }
      if (
        cmd.reload &&
        !p.reloadEnd &&
        p.mag &&
        p.mag.ammo < catalog[p.mag.id].mag &&
        p.mag.reserve
      ) {
        p.reloadEnd = this.time + catalog[p.mag.id].reload;
        p.burstLeft = 0;
        p.scoped = 0;
        this.emit({ type: "reload", actor: p.id, pos: p.eye });
      }
      if (
        active &&
        p.team === "T" &&
        this.phase === "live" &&
        this.bomb &&
        this.carrier < 0 &&
        distance(p, this.bomb) < 1.2 &&
        Math.abs(p.y - this.bomb.y) < 2
      ) {
        this.carrier = p.id;
        this.bomb = null;
      }
      const action = active && cmd.use && this.objective(p);
      if (
        action &&
        (this.worker === p.id || acting === -1) &&
        (this.worker === -1 || this.worker === p.id)
      ) {
        acting = p.id;
        this.worker = p.id;
        this.action = action;
        this.work += DT;
        if (this.work >= (action === "Plant" ? 3.2 : p.kit ? 5 : 10)) {
          if (action === "Plant") {
            this.bomb = { ...this.plantSpot(p), yaw: p.yaw };
            this.carrier = -1;
            this.phase = "planted";
            this.plantedSite = this.siteAt(p);
            this.left = 40;
            this.lastBeep = this.time;
            for (const a of this.players)
              if (a.team === "T") a.money = capMoney(a.money + 800);
            if (p.weapon === "bomb") this.equip(p, p.pistol.id);
            this.emit({
              type: "plant",
              actor: p.id,
              message: "Bomb planted at " + this.plantedSite,
            });
          } else {
            p.money = capMoney(p.money + 300);
            this.finish("CT", "Bomb defused");
          }
          acting = -1;
          this.worker = -1;
          this.work = 0;
          this.action = "";
        }
      }
      if (p.alive && this.drops.length) this.pickup(p, cmd);
      if (active && !action) this.operateWeapon(p, cmd);
      this.recover(p);
      p.lastCmd = cmd;
    }
    if (acting < 0) {
      this.worker = -1;
      this.action = "";
      this.work = 0;
    }
    this.physics.world.step();
    this.stepGrenades();
    if (this.map.id === "range") {
      for (const p of this.players)
        if (!p.alive && this.time >= p.nextFire) {
          const spawns = this.map.spawns[p.id === 0 ? "CT" : "T"];
          p.respawn(spawns[Math.max(0, p.id - 1) % spawns.length], true);
          this.physics.enable(p.body, true);
          this.physics.place(p.body, p, p.yaw);
        }
      return;
    }
    if (
      this.phase === "planted" &&
      this.time - this.lastBeep > clamp(this.left / 35, 0.14, 1)
    ) {
      this.emit({ type: "beep", pos: this.bomb! });
      this.lastBeep = this.time;
    }
    if (this.phase === "live" || this.phase === "planted") {
      if (!this.players.some((p) => p.team === "CT" && p.alive))
        this.finish("T", "Defenders eliminated");
      else if (
        this.phase === "live" &&
        !this.players.some((p) => p.team === "T" && p.alive)
      )
        this.finish("CT", "Attackers eliminated");
      else if (this.left <= 0) {
        if (this.phase === "planted") {
          this.emit({ type: "explosion", pos: this.bomb! });
          for (const p of this.players)
            if (p.alive) {
              const d = distance(p, this.bomb!);
              if (d < 25)
                this.hurt(p, Math.round(300 * (1 - d / 25) ** 2), null, "bomb");
            }
          this.finish("T", "Bomb detonated");
        } else this.finish("CT", "Time expired");
      }
    }
  }
  move(p: Player, c: PlayerCommand, emitSteps = true) {
    const speed =
      (p.scoped
        ? p.weapon === "aug"
          ? 150
          : 100
        : isGun(p.weapon)
          ? catalog[p.weapon].speed
          : p.weapon === "knife"
            ? 250
            : 245) *
      U *
      (c.crouch ? 0.34 : c.walk ? 0.52 : 1);
    const sync = p.ground;
    const sin = Math.sin(c.yaw),
      cos = Math.cos(c.yaw);
    [p.vx, p.vz] = velocity(
      p.vx,
      p.vz,
      c.moveX * cos + c.moveZ * sin,
      c.moveX * sin - c.moveZ * cos,
      speed,
      p.ground,
    );
    if (c.jump && !p.lastCmd.jump && p.ground) {
      p.vy = JUMP;
      p.ground = false;
    }
    p.vy -= GRAVITY * DT;
    const dx = p.vx * DT,
      dz = p.vz * DT;
    p.ground = this.physics.move(p.body, p, p.yaw, !!c.crouch, {
      x: dx,
      y: p.vy * DT,
      z: dz,
    });
    if (p.ground) {
      p.vy = 0;
      if (!sync) {
        p.landing = this.time;
        const k = Math.min(1, (1.1 * speed) / (Math.hypot(p.vx, p.vz) || 1));
        p.vx *= k;
        p.vz *= k;
      }
      if (emitSteps && !c.walk && !c.crouch) {
        p.stepDist += distance(p, p.last);
        if (p.stepDist > 2.15) {
          p.stepDist = 0;
          this.emit({ type: "step", actor: p.id, pos: p.eye });
          this.hear(p, 17);
        }
      }
    }
  }
  /** Enemies the round passed within 3 m of know they are being shot at, and by whom. */
  alarm(p: Player, a: Vec3, b: Vec3) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z,
      len2 = dx * dx + dy * dy + dz * dz || 1;
    for (const q of this.players) {
      if (!q.alive || q.team === p.team) continue;
      const e = q.eye,
        t = clamp(((e.x - a.x) * dx + (e.y - a.y) * dy + (e.z - a.z) * dz) / len2, 0, 1);
      if (Math.hypot(a.x + dx * t - e.x, a.y + dy * t - e.y, a.z + dz * t - e.z) < 3) {
        q.threat = p.id;
        q.threatAt = this.time;
        q.heard = { x: p.x, y: p.y, z: p.z };
      }
    }
  }
  hear(source: Player, radius: number) {
    for (const p of this.players)
      if (p.alive && p.team !== source.team && distance(p, source) < radius)
        p.heard = { x: source.x, y: source.y, z: source.z };
  }
  recover(p: Player) {
    p.penalty *= Math.exp(-DT * 5);
    const pattern = isGun(p.weapon) ? patterns[p.weapon] : [[0, 0]];
    const recent =
      isGun(p.weapon) && this.time - p.lastFire < catalog[p.weapon].reset;
    if (!recent) p.index = 0;
    const target = recent
        ? pattern[Math.min(p.index, pattern.length - 1)]
        : [0, 0],
      k = 1 - Math.exp(-DT * (recent ? 35 : 6));
    p.punchX += (target[0] - p.punchX) * k;
    p.punchY += (target[1] - p.punchY) * k;
  }
  spread(p: Player, g: Gun) {
    const w = catalog[g],
      s = w.spread;
    const base = p.scoped ? 0 : p.crouched ? s[1] : s[0];
    const speed = clamp(
      (Math.hypot(p.vx, p.vz) / (w.speed * U) - 0.34) / 0.66,
      0,
      1,
    );
    return (
      (p.ground && this.time - p.landing > 0.1
        ? base + (s[2] - base) * speed
        : s[3]) + p.penalty
    );
  }
  operateWeapon(p: Player, c: PlayerCommand) {
    if (p.drawEnd > this.time || p.reloadEnd) return;
    if (isNade(p.weapon)) {
      if ((c.fire || c.alt) && !p.windup) p.windup = this.time;
      if (p.windup && !c.fire && !c.alt) {
        if (this.time - p.windup >= 0.3)
          this.throwGrenade(
            p,
            p.weapon,
            p.lastCmd.alt ? (p.lastCmd.fire ? 540 : 330) : 750,
          );
        p.windup = 0;
      }
      return;
    }
    if (p.weapon === "knife") {
      // Left slashes, right stabs; holding either keeps swinging at that attack's pace.
      if (this.time >= p.nextFire && (c.fire || c.alt))
        this.swing(p, c.alt && !c.fire ? "stab" : "slash");
      return;
    }
    if (!isGun(p.weapon)) return;
    const levels = scopes[p.weapon] ?? 0;
    if (levels && c.alt && !p.lastCmd.alt && this.time - p.lastFire > 0.15)
      p.scoped = (p.scoped + 1) % (levels + 1);
    if (p.weapon === "glock" && c.alt && !p.lastCmd.alt) {
      p.glockBurst = !p.glockBurst;
      p.burstLeft = 0;
      this.emit({
        type: "mode",
        actor: p.id,
        message: p.glockBurst
          ? "Switched to burst-fire mode"
          : "Switched to semi-automatic",
      });
    }
    const m = p.mag;
    // A Glock burst keeps firing its three rounds after the trigger is released.
    if (p.burstLeft > 0) {
      if (p.weapon !== "glock" || !m || m.ammo <= 0) p.burstLeft = 0;
      else if (this.time >= p.nextFire) this.fire(p, p.weapon, m);
      return;
    }
    if (!m || !c.fire || this.time < p.nextFire || m.ammo <= 0) return;
    if (semiAuto.has(p.weapon) && p.lastCmd.fire) return;
    if (p.weapon === "glock" && p.glockBurst) p.burstLeft = 3;
    this.fire(p, p.weapon, m);
  }
  fire(p: Player, g: Gun, m: { ammo: number }) {
    const w = catalog[g],
      burst = p.burstLeft > 0;
    m.ammo--;
    if (burst) {
      p.burstLeft--;
      p.nextFire = this.time + (p.burstLeft > 0 ? 0.06 : 0.5);
    } else p.nextFire = Math.max(this.time - DT, p.nextFire) + 60 / w.rpm;
    this.shoot(p, g);
    p.lastFire = this.time;
    p.index++;
    p.penalty += w.spread[4] + (burst ? 0.35 : 0);
    if (g !== "aug") p.scoped = 0;
  }
  /** A knife attack: short traces ahead of the eye; from behind the victim it becomes a backstab. */
  swing(p: Player, kind: keyof typeof knife) {
    const [base, back, reach, delay] = knife[kind];
    p.nextFire = this.time + delay;
    p.lastFire = this.time;
    p.heavy = kind === "stab";
    const ignore = new Set([p.id]);
    let result = "miss",
      at: Vec3 = p.eye;
    for (const off of [0, 0.1, -0.1]) {
      const yaw = p.yaw + off,
        dir = {
          x: Math.sin(yaw) * Math.cos(p.pitch),
          y: Math.sin(p.pitch),
          z: -Math.cos(yaw) * Math.cos(p.pitch),
        };
      const hit = this.physics.trace(p.eye, dir, reach, ignore);
      if (!hit) continue;
      at = advance(p.eye, dir, hit.timeOfImpact);
      const victim = this.physics.victims.get(hit.collider.handle);
      if (!victim) {
        if (result === "miss") {
          result = "wall";
          this.emit({ type: "impact", pos: at, normal: hit.normal });
        }
        continue;
      }
      const v = this.players[victim.id];
      const scale = this.teamScale(p, v, "melee");
      if (!v.alive || !scale) continue;
      // Backstab when the attacker stands behind the victim's facing.
      const fx = Math.sin(v.yaw),
        fz = -Math.cos(v.yaw),
        dx = p.x - v.x,
        dz = p.z - v.z,
        behind = (fx * dx + fz * dz) / (Math.hypot(dx, dz) || 1) < -0.3;
      let hp = (behind ? back : base) * scale;
      if (v.armor > 0) {
        v.armor = Math.max(0, v.armor - hp * 0.15);
        hp *= 0.85;
      }
      result = behind ? "backstab" : "hit";
      this.bleed(p, v, at, dir, "chest");
      this.hurt(v, Math.round(hp), p, "knife");
      break;
    }
    this.hear(p, 8);
    this.emit({
      type: "slash",
      actor: p.id,
      pos: at,
      message: result,
      head: kind === "stab",
    });
  }
  /** Damage multiplier for `attacker` hurting `v`: 1 between enemies, scaled or zero between teammates. */
  teamScale(attacker: Player | null, v: Player, kind: keyof typeof teamDamage) {
    if (!attacker || attacker.team !== v.team) return 1;
    if (this.mode === "competitive")
      return attacker.id === v.id ? 1 : teamDamage[kind];
    return attacker.id === v.id && kind === "grenade" ? 1 : 0;
  }
  /** True when a living teammate stands between `p` and `target` (bots hold fire in competitive). */
  teammateInLine(p: Player, target: Vec3) {
    if (this.mode !== "competitive") return false;
    const a = p.eye,
      dx = target.x - a.x,
      dz = target.z - a.z,
      len = Math.hypot(dx, dz) || 1;
    return this.players.some((q) => {
      if (q === p || !q.alive || q.team !== p.team) return false;
      const t = ((q.x - a.x) * dx + (q.z - a.z) * dz) / (len * len);
      if (t <= 0 || t >= 1) return false;
      return Math.hypot(a.x + dx * t - q.x, a.z + dz * t - q.z) < 0.7;
    });
  }
  shoot(p: Player, g: Gun) {
    const hits: Hits = new Map();
    const count = pellets[g] ?? 1;
    let end: Vec3 = p.eye;
    for (let k = 0; k < count; k++) {
      const e = this.bullet(p, g, hits, count > 1);
      if (k === 0) end = e;
      else this.emit({ type: "tracer", actor: p.id, pos: p.eye, end: e });
    }
    for (const [id, h] of hits) {
      const v = this.players[id];
      v.armor = Math.max(0, h.armor);
      this.hurt(v, Math.round(h.hp), p, g, h.wall, h.head ? "head" : "chest");
    }
    this.hear(p, g === "m4" ? 20 : 45);
    this.alarm(p, p.eye, end);
    this.emit({ type: "shot", actor: p.id, pos: p.eye, end, weapon: g });
  }
  /** Traces one projectile, accumulating damage per victim so shotgun pellets land as one hit. */
  bullet(p: Player, g: Gun, hits: Hits, pellet: boolean) {
    const roll = Math.sqrt(this.rng()),
      spread = this.spread(p, g) * DEG * (pellet ? 0.3 + 0.7 * roll : roll),
      angle = this.rng() * 2 * Math.PI;
    const yaw = p.yaw + 2 * p.punchY * DEG + spread * Math.cos(angle),
      pitch = p.pitch + 2 * p.punchX * DEG + spread * Math.sin(angle);
    const dir = {
      x: Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * Math.cos(pitch),
    };
    let o = p.eye,
      travel = 0,
      power: number = catalog[g].damage,
      walls = 0;
    const max = (g === "glock" ? 4096 : pellet ? 3000 : 8192) * U;
    let end = advance(o, dir, max);
    const ignore = new Set([p.id]);
    for (let i = 0; i < 16 && travel < max; i++) {
      const hit = this.physics.trace(o, dir, max - travel, ignore);
      if (!hit) break;
      const point = advance(o, dir, hit.timeOfImpact);
      end = point;
      travel += hit.timeOfImpact;
      const victim = this.physics.victims.get(hit.collider.handle);
      if (victim) {
        ignore.add(victim.id);
        const v = this.players[victim.id];
        const scale = this.teamScale(p, v, "bullet");
        if (scale > 0 && v.alive) {
          const acc = hits.get(v.id) ?? {
            hp: 0,
            armor: v.armor,
            head: false,
            wall: false,
          };
          const d = damage(power, g, travel, victim.group, acc.armor, v.helmet);
          acc.hp += d.hp * scale;
          acc.armor -= d.armor * scale;
          acc.head ||= victim.group === "head";
          acc.wall ||= walls > 0;
          hits.set(v.id, acc);
          this.bleed(p, v, point, dir, victim.group);
        }
        power *= 0.9;
        o = advance(point, dir, 0.002);
        continue;
      }
      this.emit({ type: "impact", pos: point, normal: hit.normal });
      if (walls >= 4) break;
      const thick = this.physics.thickness(hit.collider, point, dir);
      const mat = this.physics.materials.get(hit.collider.handle) ?? "concrete";
      power = penetrate(power, g, mat, thick / U);
      if (p.id === 0)
        this.traceInfo =
          mat +
          " · " +
          (Number.isFinite(thick) ? Math.round(thick / U) + " u" : "solid") +
          " · " +
          Math.round(power) +
          " dmg";
      if (!power) {
        this.emit({
          type: "trace",
          actor: p.id,
          pos: o,
          end: point,
          message: "blocked",
        });
        break;
      }
      this.emit({
        type: "trace",
        actor: p.id,
        pos: o,
        end: point,
        message: "air",
      });
      this.emit({
        type: "trace",
        actor: p.id,
        pos: point,
        end: advance(point, dir, thick),
        message: "solid",
      });
      walls++;
      o = advance(point, dir, thick + 0.002);
      travel += thick + 0.002;
    }
    return end;
  }
  /**
   * Blood from a hit at `at`: the spray carries on along the bullet, and the splat lands on the
   * first wall behind the victim within 3.5 m, else on the ground about a metre past them.
   * Pure queries: no randomness or state, so simulations replay identically.
   */
  bleed(p: Player, v: Player, at: Vec3, dir: Vec3, group: string) {
    let end: Vec3 | undefined, normal: Vec3 | undefined;
    const wall = this.physics.surface(at, dir, 3.5);
    if (wall && wall.timeOfImpact > 0.02) {
      end = advance(at, dir, wall.timeOfImpact);
      normal = wall.normal;
    } else if (!wall) {
      const from = advance(at, { x: dir.x, y: Math.min(0, dir.y), z: dir.z }, 1.1),
        floor = this.physics.surface(from, { x: 0, y: -1, z: 0 }, 3);
      if (floor && floor.timeOfImpact > 0) {
        end = { x: from.x, y: from.y - floor.timeOfImpact, z: from.z };
        normal = floor.normal;
      }
    }
    this.emit({
      type: "blood",
      actor: p.id,
      victim: v.id,
      pos: at,
      end,
      normal: normal && { x: normal.x, y: normal.y, z: normal.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
      message: group,
    });
  }
  hurt(
    v: Player,
    amount: number,
    p: Player | null,
    weapon: Weapon,
    wallbang = false,
    group: Group = "chest",
  ) {
    if (!v.alive || amount <= 0) return;
    v.hp = Math.max(0, v.hp - amount);
    if (p && p.team !== v.team) {
      v.threat = p.id;
      v.threatAt = this.time;
    }
    this.emit({
      type: "hit",
      actor: p?.id,
      victim: v.id,
      // Where the damage came from, so the victim hears and sees its direction.
      pos: p && p.id !== v.id ? p.eye : undefined,
      weapon,
      amount,
      wallbang,
      head: group === "head",
    });
    if (v.alive) return;
    v.deaths++;
    v.nextFire = this.time + 2;
    this.physics.enable(v.body, false);
    if (this.carrier === v.id) {
      this.carrier = -1;
      this.bomb = { x: v.x, y: v.y + 0.15, z: v.z };
    }
    if (this.map.id !== "range") this.scatter(v);
    const teamkill = !!p && p.team === v.team && p.id !== v.id;
    if (teamkill && p) {
      p.kills = Math.max(0, p.kills - 1);
      p.money = capMoney(p.money - 300);
    }
    if (p && p.team !== v.team) {
      p.kills++;
      p.roundKills++;
      if (group === "head") p.headshots++;
      p.money = capMoney(p.money + killReward(weapon));
    }
    const dx = p ? v.x - p.x : -Math.sin(v.yaw),
      dz = p ? v.z - p.z : Math.cos(v.yaw),
      len = Math.hypot(dx, dz) || 1;
    this.emit({
      type: "kill",
      actor: p?.id,
      victim: v.id,
      weapon,
      wallbang,
      head: group === "head",
      pos: { x: v.x, y: v.y + 0.9, z: v.z },
      message: teamkill ? "teamkill" : undefined,
      dir: { x: dx / len, z: dz / len },
    });
  }
  /**
   * Where a kneeling planter sets the C4: on the floor half a metre ahead and a little to the
   * right of their feet (the renderer's PLANT_SPOT), pulled back if a wall is closer.
   */
  plantSpot(p: Player) {
    const fx = Math.sin(p.yaw),
      fz = -Math.cos(p.yaw),
      wall = this.physics.surface({ x: p.x, y: p.y + 0.25, z: p.z }, { x: fx, y: 0, z: fz }, 0.7),
      ahead = wall ? Math.max(0, Math.min(0.52, wall.timeOfImpact - 0.18)) : 0.52,
      x = p.x + fx * ahead + Math.cos(p.yaw) * 0.06,
      z = p.z + fz * ahead + Math.sin(p.yaw) * 0.06;
    return { x, y: this.ground(x, p.y, z) + 0.1, z };
  }
  /** The floor height under (x, z), searching down from just above `y`. */
  private ground(x: number, y: number, z: number) {
    const hit = this.physics.surface({ x, y: y + 1, z }, { x: 0, y: -1, z: 0 }, 6);
    return hit ? y + 1 - hit.timeOfImpact : y;
  }
  private drop(item: Drop["item"], at: Vec3, angle: number, r: number, mag?: { ammo: number; reserve: number }) {
    const x = at.x + Math.sin(angle) * r,
      z = at.z - Math.cos(angle) * r;
    this.drops.push({
      id: this.nextDrop++,
      item,
      x,
      y: this.ground(x, at.y, z),
      z,
      yaw: angle * 1.7,
      born: this.time,
      ...(mag && { ammo: mag.ammo, reserve: mag.reserve }),
    });
    if (this.drops.length > 48) this.drops.splice(0, this.drops.length - 48);
  }
  /** A dead player's guns, grenades and kit spill around the body for anyone to pick up. */
  scatter(v: Player) {
    const items: [Drop["item"], { ammo: number; reserve: number }?][] = [];
    if (v.primary) items.push([v.primary.id, v.primary]);
    items.push([v.pistol.id, v.pistol]);
    for (const k of nades) for (let i = 0; i < v[k]; i++) items.push([k]);
    if (v.kit) items.push(["kit"]);
    // A golden-angle spiral keeps the items apart without any randomness.
    items.forEach(([item, mag], i) =>
      this.drop(item, v, v.yaw + i * 2.39996, 0.32 + 0.14 * (i % 3), mag),
    );
    v.primary = null;
    v.he = v.flash = v.smoke = v.molly = 0;
    v.kit = false;
  }
  /** Takes `d` if there is room for it without swapping anything out. */
  private take(p: Player, d: Drop) {
    if (d.item === "kit") {
      if (p.team !== "CT" || p.kit) return false;
      p.kit = true;
      return true;
    }
    if (isNade(d.item)) {
      if (p[d.item] >= nadeLimit[d.item] || nades.reduce((n, k) => n + p[k], 0) >= 4) return false;
      p[d.item]++;
      return true;
    }
    if (!isGun(d.item) || catalog[d.item].slot !== 1 || p.primary) return false;
    p.primary = { id: d.item, ammo: d.ammo ?? 0, reserve: d.reserve ?? 0 };
    return true;
  }
  /** The gun on the ground a press of use would swap for, if any. */
  swapTarget(p: Player) {
    let best: Drop | null = null,
      reach = DROP_REACH;
    for (const d of this.drops) {
      if (!isGun(d.item) || Math.abs(d.y - p.y) > 1.2) continue;
      const r = distance(p, d);
      if (r < reach) {
        reach = r;
        best = d;
      }
    }
    return best;
  }
  /** Walking over loot picks up whatever fits; pressing use swaps the held slot's gun. */
  pickup(p: Player, cmd: PlayerCommand) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (Math.abs(d.y - p.y) > 1.2 || distance(p, d) > DROP_REACH || !this.take(p, d)) continue;
      this.drops.splice(i, 1);
      this.emit({ type: "pickup", actor: p.id, pos: { x: d.x, y: d.y, z: d.z }, message: d.item });
    }
    if (!cmd.use || p.lastCmd.use || this.objective(p)) return;
    const d = this.swapTarget(p);
    if (!d || !isGun(d.item)) return;
    const primary = catalog[d.item].slot === 1,
      old = primary ? p.primary : p.pistol,
      mag = { id: d.item, ammo: d.ammo ?? 0, reserve: d.reserve ?? 0 };
    this.drops.splice(this.drops.indexOf(d), 1);
    if (old) this.drop(old.id, p, p.yaw, 0.45, old);
    const holding = !!old && p.weapon === old.id;
    if (primary) p.primary = mag;
    else p.pistol = mag;
    if (holding) {
      p.reloadEnd = p.scoped = 0;
      // Swapping like for like still draws the new gun.
      if (old!.id === mag.id) p.drawEnd = this.time + (primary ? 0.5 : 0.4);
      else this.equip(p, mag.id);
    }
    this.emit({ type: "pickup", actor: p.id, pos: { x: d.x, y: d.y, z: d.z }, message: d.item });
  }
  throwGrenade(p: Player, type: Nade, speed: number) {
    if (!p[type]) return;
    p[type]--;
    const pitch = p.pitch + 10 * DEG,
      dir = {
        x: Math.sin(p.yaw) * Math.cos(pitch),
        y: Math.sin(pitch),
        z: -Math.cos(p.yaw) * Math.cos(pitch),
      };
    const origin = advance(p.eye, dir, 0.15),
      v = {
        x: dir.x * speed * U + p.vx * 0.5,
        y: dir.y * speed * U + p.vy * 0.5,
        z: dir.z * speed * U + p.vz * 0.5,
      };
    this.grenades.push({
      id: this.nextGrenade++,
      type,
      owner: p.id,
      body: this.physics.grenade(origin, v),
      born: this.time,
      expires:
        this.time + (type === "smoke" ? 3.5 : type === "molly" ? 2.2 : 1.6),
      lastVy: v.y,
    });
    this.equip(p, p.primary?.id ?? p.pistol.id);
  }
  visible(a: Vec3, b: Vec3, smoke = true) {
    const x = b.x - a.x,
      y = b.y - a.y,
      z = b.z - a.z,
      d = Math.hypot(x, y, z);
    if (d < 0.01) return true;
    if (smoke && this.smokeBetween(a, b)) return false;
    return !this.physics.ray(
      a,
      { x: x / d, y: y / d, z: z / d },
      Math.max(0, d - 0.02),
    );
  }
  /** Current radius of a smoke cloud: it blooms over a second and thins out at the end. */
  smokeRadius(c: Smoke) {
    const bloom = clamp((this.time - c.born) / 1.1, 0.2, 1),
      fade = clamp((c.until - this.time) / 2, 0, 1);
    return c.r * bloom * (0.35 + 0.65 * fade);
  }
  /** Line of sight through a smoke ellipsoid (flattened vertically) counts as blocked. */
  smokeBetween(a: Vec3, b: Vec3) {
    for (const c of this.smokes) {
      const r = this.smokeRadius(c) * 0.94;
      if (r < 0.6) continue;
      const k = 1.35,
        cy = c.y + 1.25;
      const ax = a.x - c.x,
        ay = (a.y - cy) * k,
        az = a.z - c.z;
      const dx = b.x - a.x,
        dy = (b.y - a.y) * k,
        dz = b.z - a.z;
      const dd = dx * dx + dy * dy + dz * dz || 1;
      const t = clamp(-(ax * dx + ay * dy + az * dz) / dd, 0, 1);
      if (Math.hypot(ax + dx * t, ay + dy * t, az + dz * t) < r) return true;
    }
    return false;
  }
  inSmoke(p: Vec3) {
    return this.smokes.some(
      (c) =>
        Math.hypot(p.x - c.x, (p.y - c.y - 1.25) * 1.35, p.z - c.z) <
        this.smokeRadius(c),
    );
  }
  floorBelow(p: Vec3, depth = 6) {
    const hit = this.physics.ray(p, { x: 0, y: -1, z: 0 }, depth);
    return hit ? p.y - hit.timeOfImpact : null;
  }
  stepGrenades() {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      const age = this.time - g.born,
        at = g.body.translation(),
        vel = g.body.linvel();
      let pop = this.time >= g.expires;
      if (
        g.type === "smoke" &&
        age > 0.5 &&
        Math.hypot(vel.x, vel.y, vel.z) < 0.35
      )
        pop = true;
      if (
        g.type === "molly" &&
        age > 0.06 &&
        vel.y < 0.6 &&
        this.physics.ray(at, { x: 0, y: -1, z: 0 }, 0.17)
      )
        pop = true;
      if (!pop) {
        const vy = vel.y;
        if (g.lastVy < -1.3 && vy > 0) this.emit({ type: "bounce", pos: at });
        g.lastVy = vy;
        continue;
      }
      this.physics.world.removeRigidBody(g.body);
      this.grenades.splice(i, 1);
      const o = { x: at.x, y: at.y + 0.16, z: at.z };
      if (g.type === "smoke") this.popSmoke(g, o);
      else if (g.type === "molly") this.ignite(g, o);
      else this.detonate(g, o);
    }
    for (let i = this.smokes.length - 1; i >= 0; i--)
      if (this.time >= this.smokes[i].until) this.smokes.splice(i, 1);
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (this.time >= f.until) {
        this.fires.splice(i, 1);
        this.emit({ type: "fireOut", pos: { x: f.x, y: f.y, z: f.z } });
        continue;
      }
      if (this.time < f.next) continue;
      f.next = this.time + 0.25;
      for (const p of this.players)
        if (
          p.alive &&
          Math.hypot(p.x - f.x, p.z - f.z) < f.r &&
          Math.abs(p.y - f.y) < 1.4
        ) {
          const owner = this.players[f.owner];
          // Casual never burns the thrower's team; competitive scales it down.
          const scale =
            p.team !== f.team
              ? 1
              : this.mode === "competitive"
                ? teamDamage.fire
                : 0;
          if (scale) this.hurt(p, Math.round(10 * scale), owner, "molly");
        }
    }
  }
  popSmoke(g: Grenade, o: Vec3) {
    const floor = this.floorBelow(o, 3) ?? o.y - 0.2;
    const cloud: Smoke = {
      id: g.id,
      x: o.x,
      y: floor,
      z: o.z,
      r: 3.7,
      born: this.time,
      until: this.time + SMOKE_TIME,
    };
    this.smokes.push(cloud);
    this.emit({ type: "smoke", pos: o, actor: g.owner });
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (Math.hypot(f.x - cloud.x, f.z - cloud.z) < cloud.r + f.r * 0.4) {
        this.fires.splice(i, 1);
        this.emit({ type: "extinguish", pos: { x: f.x, y: f.y, z: f.z } });
      }
    }
  }
  ignite(g: Grenade, o: Vec3) {
    const floor = this.floorBelow(o, 7);
    this.emit({ type: "shatter", pos: o, actor: g.owner });
    const spot = floor === null ? null : { x: o.x, y: floor, z: o.z };
    if (!spot || this.inSmoke({ ...spot, y: spot.y + 0.5 })) {
      if (spot) this.emit({ type: "extinguish", pos: spot });
      return;
    }
    this.fires.push({
      id: g.id,
      ...spot,
      r: 2.9,
      born: this.time,
      until: this.time + FIRE_TIME,
      owner: g.owner,
      team: this.players[g.owner].team,
      next: this.time + 0.15,
    });
    this.emit({ type: "fire", pos: spot, amount: FIRE_TIME, actor: g.owner });
  }
  detonate(g: Grenade, o: Vec3) {
    this.emit({
      type: g.type === "he" ? "explosion" : "flash",
      pos: o,
      actor: g.owner,
    });
    for (const p of this.players) {
      if (!p.alive) continue;
      const dist = Math.hypot(p.x - o.x, p.eye.y - o.y, p.z - o.z),
        range = (g.type === "he" ? 350 : 1500) * U;
      if (dist >= range) continue;
      const eye = p.eye,
        chest = { ...eye, y: eye.y - 0.48 };
      const smoke = g.type === "flash";
      const seen =
        Number(this.visible(o, eye, smoke)) +
        Number(this.visible(o, chest, smoke));
      if (!seen) continue;
      if (g.type === "he") {
        const raw =
          ((98 * (1 - dist / range) ** 1.2 * seen) / 2) *
          this.teamScale(this.players[g.owner], p, "grenade");
        if (raw <= 0) continue;
        const armor = Math.min(p.armor, raw * 0.25);
        p.armor -= armor;
        this.hurt(p, Math.round(raw - armor * 2), this.players[g.owner], "he");
      } else {
        const facing =
          ((o.x - p.x) * Math.sin(p.yaw) * Math.cos(p.pitch) -
            (o.z - p.z) * Math.cos(p.yaw) * Math.cos(p.pitch) +
            (o.y - eye.y) * Math.sin(p.pitch)) /
          (dist || 1);
        const duration =
          0.3 +
          (4.57 *
            clamp((facing + 1) / 1.6, 0.25, 1) *
            (1 - dist / range) *
            seen) /
            2;
        p.blinded = Math.max(p.blinded, this.time + duration);
        p.blindDuration = duration;
        if (p.id === 0)
          this.emit({ type: "blind", actor: p.id, amount: duration });
      }
    }
  }
  finish(winner: Team, reason: string) {
    if (this.phase !== "live" && this.phase !== "planted") return;
    this.score[winner]++;
    const lost = other(winner);
    for (const p of this.players)
      p.money = capMoney(
        p.money +
          (p.team === winner
            ? reason.startsWith("Bomb")
              ? 3500
              : 3250
            : lossPay(this.losses[lost])),
      );
    this.losses[lost]++;
    this.losses[winner] = 0;
    this.phase = "ended";
    this.left = 5;
    this.result =
      (winner === "CT" ? "Counter-Terrorists" : "Terrorists") +
      " win · " +
      reason;
    this.emit({ type: "roundEnd", message: this.result });
  }
  dispose() {
    this.listeners.clear();
    this.physics.free();
  }
}
export { weaponName, nearest, gear };
