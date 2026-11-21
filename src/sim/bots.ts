import { type Sim, distance } from "./Sim";
import { idle, type Player } from "./player";
import { DEG, DT, clamp, path, nearest } from "./rules";
import { type Vec3 } from "../world";
import { scopes, semiAuto, type Nade } from "../config/weapons";
import { GRAVITY, U } from "./rules";
/** Aims and throws a grenade so it lands near a ground target. */
export function lob(s: Sim, p: Player, type: Nade, to: Vec3) {
  const d = distance(p, to),
    v = 750 * U,
    reach = (v * v) / GRAVITY;
  const angle =
    d >= reach * 0.98 ? Math.PI / 4 : 0.5 * Math.asin((d * GRAVITY) / (v * v));
  p.yaw = Math.atan2(to.x - p.x, p.z - to.z);
  p.pitch = clamp(angle - 10 * DEG, -0.5, 1.2);
  s.throwGrenade(p, type, 750);
}
const normalized = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const settings = {
  easy: [0.45, 4, 0.3, 0.2],
  normal: [0.3, 2, 0.6, 0.4],
  hard: [0.18, 0.8, 0.9, 0.6],
};
export function botCommand(s: Sim, p: Player) {
  const cmd = idle(p.yaw, p.pitch);
  const [reaction, error, control, nade] = settings[s.difficulty];
  if (s.time >= p.nextVision) {
    p.nextVision = s.time + 0.13 + (p.id % 4) * 0.018;
    let best = -1,
      closest = 102;
    if (p.blinded < s.time) {
      for (const e of s.players) {
        if (!e.alive || e.team === p.team) continue;
        const d = distance(p, e);
        if (d >= closest) continue;
        const turn = normalized(Math.atan2(e.x - p.x, p.z - e.z) - p.yaw);
        if (Math.abs(turn) > 1.31 && d > 3 && e.id !== p.target) continue;
        if (s.visible(p.eye, e.eye)) {
          best = e.id;
          closest = d;
          if (p.team === s.me.team) e.spotted = s.time + 1.5;
        }
      }
    }
    if (p.target !== best) {
      p.target = best;
      p.seen = s.time;
      p.aimNoise = s.rng() * Math.PI * 2;
    }
  }
  const target = s.players[p.target],
    objective = s.objective(p);
  const engagementRange = scopes[p.weapon]
    ? 60
    : p.weapon === "nova" || p.weapon === "xm"
      ? 22
      : p.primary
        ? 37
        : 20;
  const inCombat =
    target?.alive &&
    p.blinded <= s.time &&
    distance(p, target) <= engagementRange &&
    (p.mag?.ammo || p.mag?.reserve);
  if (objective && (!inCombat || (s.phase === "planted" && s.left < 11))) {
    cmd.use = true;
    return cmd;
  }
  if (inCombat) {
    const look = Math.atan2(target.x - p.x, p.z - target.z),
      dist = distance(p, target);
    const oscillation = p.aimNoise + s.time * 3.3,
      aim =
        look +
        Math.sin(oscillation) * error * DEG -
        control * 2 * p.punchY * DEG;
    const pitch =
      Math.atan2(target.eye.y - 0.3 - p.eye.y, dist) +
      Math.cos(oscillation * 0.75) * error * 0.6 * DEG -
      control * 2 * p.punchX * DEG;
    cmd.yaw = p.yaw + clamp(normalized(aim - p.yaw), -DT * 6, DT * 6);
    cmd.pitch = p.pitch + clamp(pitch - p.pitch, -0.1, 0.1);
    if (
      s.time - p.seen > reaction &&
      Math.abs(normalized(cmd.yaw - look)) < 0.22
    ) {
      cmd.alt =
        !!scopes[p.weapon] &&
        p.weapon !== "aug" &&
        !p.scoped &&
        dist > 8 &&
        s.time - p.lastFire > 0.5;
      const semi = semiAuto.has(p.weapon);
      cmd.fire = semi
        ? !p.lastCmd.fire
        : dist < 12 || (s.tick + p.id * 13) % 39 < 24;
      const kit = (["molly", "he", "flash"] as const).filter((k) => p[k] > 0);
      if (
        !p.nadeUsed &&
        kit.length &&
        dist > 7 &&
        dist < 17 &&
        s.rng() < DT * nade
      ) {
        const type = kit[Math.floor(s.rng() * kit.length)];
        if (type === "molly") lob(s, p, "molly", target);
        else s.throwGrenade(p, type, 540);
        p.nadeUsed = true;
      }
    }
    if (p.mag && !p.mag.ammo) cmd.reload = true;
    return cmd;
  }
  if (
    p.mag &&
    p.mag.ammo < Math.min(6, p.mag.reserve) &&
    s.time - p.lastFire > 1.4
  )
    cmd.reload = true;
  const site = s.map.sites[p.patrol];
  const offset = p.id % 5;
  let goal: Vec3 = {
    ...site,
    x: site.x + Math.sin(offset * 2.4) * 2.9,
    z: site.z + Math.cos(offset * 2.4) * 2.9,
  };
  if (p.staging && distance(p, p.staging) < 2.2) {
    p.staging = null;
    p.repath = 0;
  }
  if (p.staging && !s.bomb) goal = { ...p.staging, y: 0 };
  if (
    s.bomb &&
    ((s.phase === "planted" && p.team === "CT") ||
      (s.phase === "live" && p.team === "T"))
  )
    goal = s.bomb;
  // Attackers smoke off the defenders' rotation before stepping onto the site.
  if (
    p.team === "T" &&
    p.smoke &&
    !p.smokeUsed &&
    !p.staging &&
    s.phase === "live" &&
    s.time - p.lastFire > 2
  ) {
    const d = distance(p, site);
    if (d < 24 && d > 9) {
      const ct = s.map.spawns.CT[0];
      const k = 5 / (distance(site, ct) || 1);
      lob(s, p, "smoke", {
        x: site.x + (ct.x - site.x) * k,
        y: site.y,
        z: site.z + (ct.z - site.z) * k,
      });
      p.smokeUsed = true;
      cmd.yaw = p.yaw;
      cmd.pitch = p.pitch;
      return cmd;
    }
  }
  const nodes = s.map.nodes;
  if (!nodes.length) return cmd;
  if (s.time >= p.repath || p.goal < 0) {
    p.repath = s.time + 2.7 + s.rng();
    const dest = nearest(nodes, goal.x, goal.z);
    const current = nearest(nodes, p.x, p.z);
    if (p.goal !== dest || !p.path.length || p.stuck > 0.8) {
      p.path = path(nodes, current, dest);
      if (distance(p, nodes[current]) < 0.9) p.path.shift();
      p.goal = dest;
      p.stuck = 0;
    }
  }
  while (p.path.length && distance(p, nodes[p.path[0]]) < 0.66) p.path.shift();
  const next = p.path.length ? nodes[p.path[0]] : goal;
  const d = distance(p, next);
  const burning = (q: { x: number; z: number }) =>
    s.fires.some((f) => f.team !== p.team && distance(f, q) < f.r + 0.6);
  // Wait out enemy fire ahead instead of walking through it.
  const blocked = burning(next) && !burning(p);
  if (
    !blocked &&
    d >
      (p.path.length
        ? 0.6
        : p.team === "CT" && s.phase !== "planted"
          ? 1.5
          : 0.45)
  ) {
    const look = Math.atan2(next.x - p.x, p.z - next.z);
    cmd.yaw = p.yaw + clamp(normalized(look - p.yaw), -0.18, 0.18);
    const delta = look - cmd.yaw;
    cmd.moveZ = Math.cos(delta);
    cmd.moveX = Math.sin(delta);
    cmd.pitch = p.pitch * 0.88;
    if (distance(p, p.last) < 0.006 && Math.hypot(p.vx, p.vz) > 0.5)
      p.stuck += DT;
    else p.stuck = Math.max(0, p.stuck - DT * 0.4);
    if (p.stuck > 0.45) {
      cmd.jump = !p.lastCmd.jump;
      cmd.moveX += Math.sin(p.id + Math.floor(s.time * 1.3)) * 0.8;
    }
  } else {
    const source =
      p.heard ?? s.map.spawns[p.team === "CT" ? "T" : "CT"][p.id % 5];
    if (source) {
      const yaw = Math.atan2(source.x - p.x, p.z - source.z);
      cmd.yaw = p.yaw + clamp(normalized(yaw - p.yaw), -0.07, 0.07);
    }
    cmd.crouch = p.team === "CT";
  }
  return cmd;
}
