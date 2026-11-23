import type { Team, Vec3 } from "../world";
import { magazine, type Weapon, type Magazine } from "../config/weapons";
import type { Body } from "./Physics";
export interface PlayerCommand {
  tick?: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  fire?: boolean;
  alt?: boolean;
  jump?: boolean;
  crouch?: boolean;
  walk?: boolean;
  use?: boolean;
  reload?: boolean;
  slot?: number;
  buy?: string;
}
export const idle = (yaw = 0, pitch = 0): PlayerCommand => ({
  moveX: 0,
  moveZ: 0,
  yaw,
  pitch,
});
export class Player {
  x = 0;
  y = 0;
  z = 0;
  last = { x: 0, y: 0, z: 0 };
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  hp = 100;
  armor = 0;
  helmet = false;
  kit = false;
  money = 800;
  kills = 0;
  deaths = 0;
  headshots = 0;
  roundKills = 0;
  primary: Magazine | null = null;
  pistol = magazine("glock");
  weapon: Weapon = "glock";
  previous: Weapon = "glock";
  he = 0;
  flash = 0;
  smoke = 0;
  molly = 0;
  scoped = 0;
  ground = true;
  landing = 0;
  lastFire = -20;
  nextFire = 0;
  reloadEnd = 0;
  drawEnd = 0;
  index = 0;
  punchX = 0;
  punchY = 0;
  penalty = 0;
  windup = 0;
  lastCmd = idle();
  blinded = 0;
  blindDuration = 0;
  stepDist = 0;
  spotted = -1;
  path: number[] = [];
  goal = -1;
  repath = 0;
  stuck = 0;
  target = -1;
  seen = 0;
  nextVision = 0;
  aimNoise = 0;
  patrol: "A" | "B" = "A";
  nadeUsed = false;
  smokeUsed = false;
  glockBurst = false;
  heavy = false;
  burstLeft = 0;
  heard: Vec3 | null = null;
  /** The enemy who last shot at this bot (hit or near miss), and when. */
  threat = -1;
  threatAt = -10;
  /** Combat footwork: strafe direction (-1, 0, 1), whether at walking pace, until when. */
  strafe = 0;
  strafeWalk = false;
  strafeUntil = 0;
  /** Where the current fight started: strafing sways around this spot rather than drifting off. */
  anchor = { x: 0, z: 0 };
  /** This bot's own line through the current waypoint, so teammates don't walk single file. */
  lane: { node: number; x: number; z: number } | null = null;
  /** Route toward the enemy being pushed, and when to recompute it. */
  chase: number[] = [];
  chaseAt = 0;
  staging: { x: number; z: number } | null = null;
  constructor(
    public id: number,
    public name: string,
    public team: Team,
    public body: Body,
  ) {}
  get alive() {
    return this.hp > 0;
  }
  get crouched() {
    return this.body.crouch;
  }
  get moving() {
    return Math.hypot(this.vx, this.vz) > 0.25;
  }
  get mag() {
    return this.primary?.id === this.weapon
      ? this.primary
      : this.pistol.id === this.weapon
        ? this.pistol
        : null;
  }
  get eye() {
    return {
      x: this.x,
      y: this.y + (this.crouched ? 1.17 : 1.6256),
      z: this.z,
    };
  }
  resetGear() {
    this.primary = null;
    this.pistol = magazine("glock");
    this.weapon = "glock";
    this.previous = "glock";
    this.armor = 0;
    this.helmet = false;
    this.kit = false;
    this.he = 0;
    this.flash = 0;
    this.smoke = 0;
    this.molly = 0;
    this.glockBurst = false;
  }
  respawn(pos: Vec3 & { yaw: number }, fresh: boolean) {
    if (!this.alive || fresh) this.resetGear();
    this.hp = 100;
    Object.assign(this, pos);
    this.last = { x: this.x, y: this.y, z: this.z };
    this.pitch = 0;
    this.vx = this.vy = this.vz = 0;
    this.ground = true;
    this.reloadEnd =
      this.drawEnd =
      this.nextFire =
      this.index =
      this.penalty =
      this.punchX =
      this.punchY =
      this.blinded =
      this.scoped =
      this.windup =
        0;
    this.path = [];
    this.goal = this.target = -1;
    this.repath = this.seen = this.stuck = this.nextVision = 0;
    this.heard = null;
    this.threat = -1;
    this.threatAt = -10;
    this.strafe = this.strafeUntil = this.chaseAt = 0;
    this.lane = null;
    this.chase = [];
    this.nadeUsed = false;
    this.smokeUsed = false;
    this.burstLeft = 0;
    this.roundKills = 0;
    this.lastCmd = idle(pos.yaw);
    this.weapon = this.primary?.id ?? this.pistol.id;
    for (const m of [this.pistol, this.primary])
      if (m) {
        const refill = magazine(m.id);
        m.ammo = refill.ammo;
        m.reserve = refill.reserve;
      }
  }
}
