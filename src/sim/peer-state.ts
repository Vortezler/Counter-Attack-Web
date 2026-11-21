import { catalog, isGun, shop, type Magazine, type Weapon } from "../config/weapons";
import type { Sim, SimEvent } from "./Sim";
import type { PlayerCommand } from "./player";

export const peerPlayer = 5;
const numeric = ["x", "y", "z", "vx", "vz", "yaw", "pitch", "hp", "armor", "money", "kills",
  "deaths", "he", "flash", "scoped", "lastFire", "reloadEnd", "punchX", "punchY",
  "blinded", "blindDuration", "spotted"] as const;
const flags = ["kit", "helmet", "ground"] as const;
const commandFlags = ["fire", "alt", "jump", "crouch", "walk", "use", "reload"] as const;
function weapon(value: unknown): value is Weapon {
  return typeof value === "string" && (Object.hasOwn(catalog, value) || ["he", "flash", "bomb"].includes(value));
}

const phases = ["warmup", "freeze", "live", "planted", "ended", "finished"];
const slots = [0, 1, 2, 4, 5, -1, 9, -9];
type Payload = Record<string, unknown>;

export function record(value: unknown): value is Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown, limit = 1000000): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

function point(value: unknown): value is { x: number; y: number; z: number } {
  return record(value) && finite(value.x, 10000) && finite(value.y, 10000) && finite(value.z, 10000);
}

export function readCommand(value: unknown): PlayerCommand | null {
  if (!record(value) || !finite(value.moveX, 1) || !finite(value.moveZ, 1)
    || !finite(value.yaw) || !finite(value.pitch, 1.56)) return null;
  const cmd: PlayerCommand = { moveX: value.moveX, moveZ: value.moveZ,
    yaw: value.yaw % (2 * Math.PI), pitch: value.pitch };
  for (const key of commandFlags) if (value[key] === true) cmd[key] = true;
  if (typeof value.slot === "number" && slots.includes(value.slot)) cmd.slot = value.slot;
  if (typeof value.buy === "string" && Object.hasOwn(shop, value.buy)) cmd.buy = value.buy;
  return cmd;
}

export function projectFrame(sim: Sim, compact = false) {
  const number = (value: number) => compact ? Math.round(value * 1000) / 1000 : value;
  return {
    tick: sim.tick, time: sim.time, round: sim.round, phase: sim.phase, left: sim.left,
    score: sim.score, result: sim.result, carrier: sim.carrier, bomb: sim.bomb,
    plantedSite: sim.plantedSite, action: sim.action, worker: sim.worker, work: sim.work,
    grenades: sim.grenades.map(g => ({ ...g.body.translation(), id: g.id, type: g.type })),
    players: sim.players.map(p => ({
      ...Object.fromEntries(numeric.map(k => [k, number(p[k])])),
      ...Object.fromEntries(flags.map(k => [k, p[k]])),
      team: p.team, weapon: p.weapon, primary: p.primary, pistol: p.pistol, crouched: p.crouched,
      vy: number(p.vy), jumpHeld: !!p.lastCmd.jump,
    })),
  };
}

function magazine(value: unknown): value is Magazine {
  return record(value) && typeof value.id === "string" && Object.hasOwn(catalog, value.id)
    && isGun(value.id as Magazine["id"]) && finite(value.ammo, 200) && finite(value.reserve, 300);
}

export function applyFrame(sim: Sim, value: unknown): ReturnType<typeof projectFrame>["grenades"] | null {
  if (!record(value) || !finite(value.tick) || value.tick < sim.tick || !finite(value.time)
    || !finite(value.round, 24) || !finite(value.left, 200) || typeof value.phase !== "string"
    || !phases.includes(value.phase) || !record(value.score)
    || !finite(value.score.CT, 13) || !finite(value.score.T, 13)
    || typeof value.result !== "string" || value.result.length > 100
    || !finite(value.carrier, 9) || (value.bomb !== null && !point(value.bomb))
    || !["", "A", "B"].includes(String(value.plantedSite))
    || !["", "Plant", "Defuse"].includes(String(value.action))
    || !finite(value.worker, 9) || !finite(value.work, 30)
    || !Array.isArray(value.players) || value.players.length !== sim.players.length
    || !Array.isArray(value.grenades) || value.grenades.length > 100) return null;
  const players: Payload[] = value.players;
  for (const p of players) {
    if (!record(p) || !numeric.every(key => finite(p[key])) || !flags.every(key => typeof p[key] === "boolean")
      || !["CT", "T"].includes(String(p.team)) || !weapon(p.weapon)
      || !magazine(p.pistol) || (p.primary !== null && !magazine(p.primary)) || typeof p.crouched !== "boolean") return null;
  }
  const grenades: ReturnType<typeof projectFrame>["grenades"] = [];
  for (const g of value.grenades) {
    if (!record(g)) return null;
    const { id, type } = g;
    if (!finite(id) || (type !== "he" && type !== "flash") || !point(g)) return null;
    grenades.push({ x: g.x, y: g.y, z: g.z, id, type });
  }
  for (const [index, p] of players.entries()) {
    const target = sim.players[index];
    target.last = { x: target.x, y: target.y, z: target.z };
    for (const key of numeric) target[key] = p[key] as number;
    for (const key of flags) target[key] = p[key] as boolean;
    target.team = p.team as typeof target.team;
    target.weapon = p.weapon as typeof target.weapon;
    target.pistol = p.pistol as Magazine;
    target.primary = p.primary as Magazine | null;
    target.body.crouch = p.crouched as boolean;
    target.vy = finite(p.vy) ? p.vy : 0;
    target.lastCmd = { ...target.lastCmd, jump: p.jumpHeld === true };
  }
  Object.assign(sim, { tick: value.tick, time: value.time, left: value.left, round: value.round,
    phase: value.phase, score: value.score, carrier: value.carrier, bomb: value.bomb,
    worker: value.worker, work: value.work, action: value.action, plantedSite: value.plantedSite });
  sim.result = value.phase === "finished"
    ? sim.score.CT === sim.score.T ? "Match tied"
      : sim.score[sim.me.team] > sim.score[sim.me.team === "CT" ? "T" : "CT"] ? "Match victory" : "Match defeat"
    : value.result;
  return grenades;
}

export function readEvent(value: unknown): SimEvent | null {
  if (!record(value) || typeof value.type !== "string" ||
      !["shot", "impact", "explosion", "flash", "kill", "hit", "plant", "roundEnd", "roundStart", "live", "beep", "reload", "step"].includes(value.type)) return null;
  const event: SimEvent = { type: value.type };
  for (const key of ["actor", "victim"] as const) {
    const index = value[key];
    if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index < 10) event[key] = index;
  }
  if (event.type === "kill" && event.victim === undefined) return null;
  for (const key of ["pos", "end", "normal"] as const) {
    const vector = value[key];
    if (point(vector)) event[key] = { x: vector.x, y: vector.y, z: vector.z };
  }
  if (weapon(value.weapon)) event.weapon = value.weapon;
  if (typeof value.message === "string") event.message = value.message.slice(0, 100);
  if (finite(value.amount, 1000)) event.amount = value.amount;
  if (value.wallbang === true) event.wallbang = true;
  return event;
}
