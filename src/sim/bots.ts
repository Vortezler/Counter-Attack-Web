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
/** How far bots can spot an enemy in the open. */
const SIGHT = 150;
const routeSeed = (s: Sim, p: Player) => (p.id * 7919 + s.round * 104729 + 1) | 0;
/**
 * The point this bot aims for at a waypoint: shifted sideways off the line to the next one by
 * a per-bot amount (up to 0.9 m), unless that would put it against a wall.
 */
function laneThrough(s: Sim, p: Player, at: number, after?: number) {
  const nodes = s.map.nodes,
    n = nodes[at];
  if (p.lane?.node === at) return p.lane;
  const shift = ((p.id % 5) - 2) * 0.45,
    to = after === undefined ? n : nodes[after],
    len = Math.hypot(to.x - n.x, to.z - n.z),
    side = len > 0.1 ? { x: -(to.z - n.z) / len, z: (to.x - n.x) / len } : { x: 1, z: 0 },
    dir = { x: side.x * Math.sign(shift), y: 0, z: side.z * Math.sign(shift) },
    room = shift ? s.physics.ray({ x: n.x, y: n.y + 0.6, z: n.z }, dir, Math.abs(shift) + 0.5) : null,
    k = room ? 0 : shift;
  p.lane = { node: at, x: n.x + side.x * k, z: n.z + side.z * k };
  return p.lane;
}
/**
 * Moving while fighting, like a person: strafe one way or the other for a moment, sometimes at
 * walking pace, sometimes stopping to shoot. Movement spreads the bullets (more when faster),
 * so the bots trade accuracy for being harder to hit. Beyond `close` they also push in toward
 * the target along the nav graph; long guns hold their ground instead.
 */
function footwork(
  s: Sim,
  p: Player,
  cmd: ReturnType<typeof idle>,
  target: Player,
  dist: number,
  close: number,
  rush: boolean,
) {
  const stand = s.difficulty === "hard" ? 0.35 : s.difficulty === "normal" ? 0.25 : 0.15;
  if (s.time >= p.strafeUntil) {
    const r = s.rng();
    p.strafe = r < stand ? 0 : r < stand + (1 - stand) / 2 ? -1 : 1;
    p.strafeWalk = s.rng() < 0.5;
    p.strafeUntil = s.time + 0.3 + s.rng() * 0.7;
  }
  // Sway side to side around the spot the fight started from (A-D-A-D), never drifting more
  // than about a metre off it into cover where the target can no longer be seen.
  const rx = Math.cos(cmd.yaw),
    rz = Math.sin(cmd.yaw),
    off = (p.x - p.anchor.x) * rx + (p.z - p.anchor.z) * rz;
  if (off > 1.2 && p.strafe > 0) p.strafe = -1;
  else if (off < -1.2 && p.strafe < 0) p.strafe = 1;
  let fx = 0,
    fz = 0;
  if (rush && s.bomb) {
    // Out of time: keep shooting but head for the bomb.
    target = { ...target, x: s.bomb.x, z: s.bomb.z } as Player;
    dist = distance(p, s.bomb);
    close = 0.5;
  }
  if (dist > close && (dist < 40 || rush) && Number.isFinite(close)) {
    // Push toward the target (within 40 m; farther fights are held), straight at them if the
    // way is open, else along the nav graph.
    const nodes = s.map.nodes;
    if (s.time >= p.chaseAt && nodes.length) {
      p.chaseAt = s.time + 1;
      p.chase = path(nodes, nearest(nodes, p.x, p.z), nearest(nodes, target.x, target.z), routeSeed(s, p));
    }
    while (p.chase.length && distance(p, nodes[p.chase[0]]) < 0.8) p.chase.shift();
    const open = !s.physics.ray(
        { x: p.x, y: p.y + 0.5, z: p.z },
        { x: (target.x - p.x) / dist, y: 0, z: (target.z - p.z) / dist },
        Math.min(dist, 6),
      ),
      via = open || !p.chase.length ? target : nodes[p.chase[0]],
      len = distance(p, via) || 1;
    fx = (via.x - p.x) / len;
    fz = (via.z - p.z) / len;
    // Moving in carries the sway anchor along.
    p.anchor.x += fx * 0.05;
    p.anchor.z += fz * 0.05;
  } else if (dist < close * 0.45) {
    fx = (p.x - target.x) / (dist || 1) * 0.5;
    fz = (p.z - target.z) / (dist || 1) * 0.5;
  }
  // Into the player's frame: +moveZ is where they face, +moveX is to their right.
  const sin = Math.sin(cmd.yaw),
    cos = Math.cos(cmd.yaw);
  cmd.moveZ = clamp(fx * sin - fz * cos, -1, 1);
  cmd.moveX = clamp(fx * cos + fz * sin + p.strafe, -1, 1);
  cmd.walk = p.strafeWalk && !fx && !fz;
  if (distance(p, p.last) < 0.004 && (cmd.moveX || cmd.moveZ)) p.stuck += DT;
  else p.stuck = Math.max(0, p.stuck - DT);
  if (p.stuck > 0.5) {
    p.strafe = -p.strafe;
    p.stuck = 0;
  }
}
export function botCommand(s: Sim, p: Player) {
  const cmd = idle(p.yaw, p.pitch);
  const [reaction, error, control, nade] = settings[s.difficulty];
  const shooter = s.players[p.threat],
    underFire = !!shooter?.alive && s.time - p.threatAt < 3,
    // A defender who must reach the bomb now stops trading shots at range to get there.
    rush =
      p.team === "CT" &&
      s.phase === "planted" &&
      !!s.bomb &&
      s.left < distance(p, s.bomb) / 4.5 + (p.kit ? 5 : 10) + 5;
  if (s.time >= p.nextVision) {
    p.nextVision = s.time + 0.13 + (p.id % 4) * 0.018;
    let best = -1,
      closest = SIGHT;
    if (p.blinded < s.time) {
      for (const e of s.players) {
        if (!e.alive || e.team === p.team) continue;
        const d = distance(p, e);
        if (d >= closest) continue;
        const turn = normalized(Math.atan2(e.x - p.x, p.z - e.z) - p.yaw);
        if (Math.abs(turn) > 1.31 && d > 3 && e.id !== p.target && !(underFire && e.id === p.threat))
          continue;
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
      p.anchor = { x: p.x, z: p.z };
      p.aimNoise = s.rng() * Math.PI * 2;
    }
  }
  const target = s.players[p.target],
    objective = s.objective(p);
  const longGun = p.weapon === "awp" || p.weapon === "ssg",
    shotgun = p.weapon === "nova" || p.weapon === "xm",
    engagementRange = longGun ? SIGHT : shotgun ? 32 : scopes[p.weapon] || p.primary ? 85 : 50;
  const inCombat =
    target?.alive &&
    p.blinded <= s.time &&
    distance(p, target) <= (rush ? 15 : engagementRange) &&
    (p.mag?.ammo || p.mag?.reserve);
  if (objective && (!inCombat || (s.phase === "planted" && s.left < 11))) {
    cmd.use = true;
    return cmd;
  }
  if (inCombat) {
    const look = Math.atan2(target.x - p.x, p.z - target.z),
      dist = distance(p, target);
    // Aim wanders more the farther the target is; scoped rifles hold steadier.
    const sway = error * (longGun && p.scoped ? 0.55 : 1) * (0.7 + dist / 45),
      oscillation = p.aimNoise + s.time * 3.3,
      aim =
        look +
        Math.sin(oscillation) * sway * DEG -
        control * 2 * p.punchY * DEG;
    const pitch =
      Math.atan2(target.eye.y - 0.3 - p.eye.y, dist) +
      Math.cos(oscillation * 0.75) * sway * 0.6 * DEG -
      control * 2 * p.punchX * DEG;
    cmd.yaw = p.yaw + clamp(normalized(aim - p.yaw), -DT * 6, DT * 6);
    cmd.pitch = p.pitch + clamp(pitch - p.pitch, -0.1, 0.1);
    if (
      s.time - p.seen > reaction &&
      Math.abs(normalized(cmd.yaw - look)) < 0.22 &&
      !s.teammateInLine(p, target)
    ) {
      cmd.alt =
        !!scopes[p.weapon] &&
        p.weapon !== "aug" &&
        !p.scoped &&
        dist > 8 &&
        s.time - p.lastFire > 0.5;
      const semi = semiAuto.has(p.weapon);
      // Full auto up close, bursts at mid range, taps at long range.
      cmd.fire = semi
        ? !p.lastCmd.fire
        : dist < 12 || (s.tick + p.id * 13) % 39 < (dist > 35 ? 7 : dist > 22 ? 14 : 24);
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
    footwork(s, p, cmd, target, dist, longGun ? Infinity : shotgun ? 6 : p.primary ? 14 : 10, rush);
    return cmd;
  }
  // Shot at by someone it cannot see: turn toward the shots for a moment instead of walking on.
  if (underFire && !objective && !rush && s.time - p.threatAt < 1.2) {
    const yaw = Math.atan2(shooter.x - p.x, p.z - shooter.z);
    cmd.yaw = p.yaw + clamp(normalized(yaw - p.yaw), -DT * 6, DT * 6);
    cmd.pitch = p.pitch * 0.9;
    if (!longGun) footwork(s, p, cmd, shooter, distance(p, shooter), shotgun ? 6 : 14, false);
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
      p.path = path(nodes, current, dest, routeSeed(s, p));
      if (distance(p, nodes[current]) < 0.9) p.path.shift();
      p.goal = dest;
      p.stuck = 0;
    }
  }
  while (p.path.length && distance(p, laneThrough(s, p, p.path[0], p.path[1])) < 0.66) p.path.shift();
  const next = p.path.length ? laneThrough(s, p, p.path[0], p.path[1]) : goal;
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
    // Give a teammate just ahead some room instead of treading on their heels.
    if (s.players.some((q) => q !== p && q.alive && q.team === p.team && distance(p, q) < 1.6 &&
        (q.x - p.x) * Math.sin(look) + (p.z - q.z) * Math.cos(look) > 0.4))
      cmd.walk = true;
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
