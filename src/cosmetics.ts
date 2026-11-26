/**
 * Cosmetics: agents (what each side wears), knife models, and weapon and knife finishes.
 * Pure data with no Three.js, so the lobby can list and save a loadout without loading the
 * renderer. Every pattern, model and outfit here is original to this project.
 */
import { catalog, type Gun } from "./config/weapons";

export type Rarity = "stock" | "common" | "uncommon" | "rare" | "epic" | "legendary";
export const rarities: Rarity[] = ["stock", "common", "uncommon", "rare", "epic", "legendary"];
export const rarityInfo: Record<Rarity, { label: string; color: string }> = {
  stock: { label: "Stock", color: "#8f989c" },
  common: { label: "Common", color: "#a9bccd" },
  uncommon: { label: "Uncommon", color: "#4fc2b0" },
  rare: { label: "Rare", color: "#5b8cff" },
  epic: { label: "Epic", color: "#b46cff" },
  legendary: { label: "Legendary", color: "#ffb340" },
};

/** How a finish is painted. Each kind has a painter in `skinPatterns.ts`. */
export type PatternKind =
  | "factory"
  | "hex"
  | "digital"
  | "splinter"
  | "tiger"
  | "carbon"
  | "anodized"
  | "fade"
  | "circuit"
  | "magma"
  | "gilded"
  | "waves"
  | "hazard"
  | "blossom"
  | "prism"
  | "folded"
  | "marble"
  | "topo"
  | "glitch";

export interface Finish {
  id: string;
  name: string;
  rarity: Rarity;
  pattern: PatternKind;
  /** Palette the painter uses: base first, then accents. */
  colors: string[];
  /** Metalness and roughness where the finish covers. */
  metal: number;
  rough: number;
  /** Pattern repeats per metre of weapon. */
  scale: number;
  /** Emissive strength for the glowing parts of the pattern (circuit, magma). */
  glow?: number;
  /** View-dependent rainbow sheen, 0..1. */
  sheen?: number;
  /** Scuffs that wear through to bare metal, 0..1. */
  wear?: number;
  /** Who may use it: firearms, knives, or both (the default). */
  for?: "gun" | "knife";
  blurb: string;
}

export const finishes: Finish[] = [
  {
    id: "factory",
    name: "Factory",
    rarity: "stock",
    pattern: "factory",
    colors: [],
    metal: 0.55,
    rough: 0.45,
    scale: 4,
    blurb: "As it left the armoury: parkerised steel and plain furniture.",
  },
  {
    id: "sandstorm",
    name: "Sandstorm",
    rarity: "common",
    pattern: "hex",
    colors: ["#b59b6c", "#8a7350", "#d3bf93", "#6b5a3e"],
    metal: 0.1,
    rough: 0.75,
    scale: 9,
    wear: 0.35,
    for: "gun",
    blurb: "Hex-cell desert camouflage, sprayed and baked.",
  },
  {
    id: "concrete",
    name: "Concrete Pixel",
    rarity: "common",
    pattern: "digital",
    colors: ["#8d9294", "#5f6568", "#b9bcbb", "#3f4446"],
    metal: 0.08,
    rough: 0.8,
    scale: 6,
    wear: 0.3,
    for: "gun",
    blurb: "Urban digital camouflage in four greys.",
  },
  {
    id: "woodland",
    name: "Woodland Splinter",
    rarity: "common",
    pattern: "splinter",
    colors: ["#5d6b45", "#3c4630", "#8c8a5a", "#262b20"],
    metal: 0.08,
    rough: 0.78,
    scale: 5,
    wear: 0.3,
    for: "gun",
    blurb: "Shard camouflage for the tree line.",
  },
  {
    id: "glacier",
    name: "Glacier",
    rarity: "uncommon",
    pattern: "splinter",
    colors: ["#e7eef2", "#a9b9c4", "#cbd8e0", "#6f8492"],
    metal: 0.1,
    rough: 0.6,
    scale: 4,
    wear: 0.25,
    blurb: "Arctic shards in ice white and slate.",
  },
  {
    id: "hazard",
    name: "Hazard",
    rarity: "uncommon",
    pattern: "hazard",
    colors: ["#f0c419", "#161616"],
    metal: 0.15,
    rough: 0.55,
    scale: 3,
    wear: 0.45,
    blurb: "Warning chevrons, chipped from use.",
  },
  {
    id: "topo",
    name: "Contour",
    rarity: "uncommon",
    pattern: "topo",
    colors: ["#24313a", "#57d0b6", "#2f3f49"],
    metal: 0.2,
    rough: 0.5,
    scale: 2.2,
    blurb: "A survey map's contour lines over dark teal.",
  },
  {
    id: "carbon",
    name: "Carbon Weave",
    rarity: "rare",
    pattern: "carbon",
    colors: ["#121416", "#2b3035", "#4a5158"],
    metal: 0.35,
    rough: 0.28,
    scale: 70,
    blurb: "Twill-woven fibre under a deep clear coat.",
  },
  {
    id: "cobalt",
    name: "Cobalt",
    rarity: "rare",
    pattern: "anodized",
    colors: ["#2350b8", "#183a85", "#4f7be0"],
    metal: 0.95,
    rough: 0.22,
    scale: 6,
    blurb: "Anodised a deep electric blue.",
  },
  {
    id: "tigerline",
    name: "Tigerline",
    rarity: "rare",
    pattern: "tiger",
    colors: ["#e8892a", "#1b1612", "#f5b14f"],
    metal: 0.25,
    rough: 0.45,
    scale: 3.2,
    blurb: "Hand-cut stripes in black over burnt orange.",
  },
  {
    id: "oceanic",
    name: "Oceanic",
    rarity: "epic",
    pattern: "waves",
    colors: ["#0b3a5a", "#1c7fa6", "#9fe3f0", "#06243a"],
    metal: 0.3,
    rough: 0.32,
    scale: 2.6,
    blurb: "Woodblock waves rolling down the receiver.",
  },
  {
    id: "afterglow",
    name: "Afterglow",
    rarity: "epic",
    pattern: "fade",
    colors: ["#ffcf5a", "#ff6a3d", "#d1347a", "#5b2a9c"],
    metal: 0.85,
    rough: 0.18,
    scale: 1,
    blurb: "Candy-metal fade from sunrise gold to dusk violet.",
  },
  {
    id: "sakura",
    name: "Sakura",
    rarity: "epic",
    pattern: "blossom",
    colors: ["#f4efe9", "#e98aa8", "#b53a64", "#3b2a2a"],
    metal: 0.1,
    rough: 0.4,
    scale: 3,
    blurb: "Cherry blossom on pearl white, with ink-black branches.",
  },
  {
    id: "circuit",
    name: "Neon Circuit",
    rarity: "epic",
    pattern: "circuit",
    colors: ["#0c1014", "#1a222a", "#7dff4f"],
    metal: 0.4,
    rough: 0.35,
    scale: 3,
    glow: 2.4,
    blurb: "Traces that light up green in the dark.",
  },
  {
    id: "glitch",
    name: "Glitch",
    rarity: "epic",
    pattern: "glitch",
    colors: ["#111317", "#ff2e88", "#2ef2ff", "#f4f4f4"],
    metal: 0.3,
    rough: 0.35,
    scale: 2.2,
    glow: 0.9,
    blurb: "Corrupted scanlines in magenta and cyan.",
  },
  {
    id: "magma",
    name: "Magma",
    rarity: "legendary",
    pattern: "magma",
    colors: ["#141110", "#2a201c", "#ff6a1a", "#ffd36b"],
    metal: 0.2,
    rough: 0.6,
    scale: 2.4,
    glow: 3.2,
    blurb: "Cooling basalt split by glowing seams.",
  },
  {
    id: "gilded",
    name: "Gilded",
    rarity: "legendary",
    pattern: "gilded",
    colors: ["#d9a93c", "#8c6418", "#ffe28a"],
    metal: 1,
    rough: 0.24,
    scale: 5,
    blurb: "Gold plate, hand-engraved with scrollwork.",
  },
  {
    id: "prism",
    name: "Prism",
    rarity: "legendary",
    pattern: "prism",
    colors: ["#cfd6e6", "#8a96b0"],
    metal: 0.95,
    rough: 0.12,
    scale: 3,
    sheen: 1,
    blurb: "Holographic chrome that shifts colour as it turns.",
  },
  // Knife-only steels.
  {
    id: "blued",
    name: "Blued Steel",
    rarity: "uncommon",
    pattern: "anodized",
    colors: ["#2b3a52", "#1a2333", "#5d78a3"],
    metal: 1,
    rough: 0.2,
    scale: 8,
    for: "knife",
    blurb: "Heat-blued steel with a cool sheen.",
  },
  {
    id: "folded",
    name: "Folded Steel",
    rarity: "rare",
    pattern: "folded",
    colors: ["#9aa1a6", "#4b5156", "#d7dcdf"],
    metal: 1,
    rough: 0.25,
    scale: 6,
    for: "knife",
    blurb: "Hundreds of forge-welded layers rippling down the blade.",
  },
  {
    id: "marble",
    name: "Marbled",
    rarity: "epic",
    pattern: "marble",
    colors: ["#e44b2f", "#f3c63e", "#1d1d1d", "#f6eee2"],
    metal: 0.85,
    rough: 0.16,
    scale: 4,
    for: "knife",
    blurb: "Swirled fire and gold, sealed under candy coat.",
  },
  {
    id: "aurora",
    name: "Aurora",
    rarity: "legendary",
    pattern: "fade",
    colors: ["#2ee6a8", "#2a7bff", "#a04bff", "#ff4fa3"],
    metal: 0.95,
    rough: 0.12,
    scale: 1,
    for: "knife",
    blurb: "Northern-lights fade, tip to tang.",
  },
];
export const finishById = new Map(finishes.map((f) => [f.id, f]));
export const gunFinishes = finishes.filter((f) => f.for !== "knife");
export const knifeFinishes = finishes.filter((f) => f.for !== "gun");

export type KnifeModel = "combat" | "tanto" | "karambit" | "bowie" | "butterfly" | "cleaver";
export const knives: { id: KnifeModel; name: string; rarity: Rarity; blurb: string }[] = [
  { id: "combat", name: "Combat Knife", rarity: "stock", blurb: "Standard-issue fixed blade with a moulded grip." },
  { id: "tanto", name: "Tanto", rarity: "rare", blurb: "Chisel-pointed blade built to punch through." },
  { id: "bowie", name: "Bowie", rarity: "rare", blurb: "A heavy clip-point blade with a brass guard." },
  { id: "cleaver", name: "Cleaver", rarity: "epic", blurb: "A broad, square-nosed chopper with a riveted grip." },
  { id: "karambit", name: "Karambit", rarity: "legendary", blurb: "A clawed, hooked blade with a finger ring." },
  { id: "butterfly", name: "Butterfly", rarity: "legendary", blurb: "Twin skeleton handles that flip around the blade." },
];
export const knifeById = new Map(knives.map((k) => [k.id, k]));

export type Side = "CT" | "T";
export type Headgear =
  | "helmet-mask"
  | "helmet-goggles"
  | "boonie"
  | "balaclava"
  | "shemagh"
  | "beanie"
  | "hood";
/** An outfit: a palette over the soldier's parts and which head and torso pieces to wear. */
export interface Agent {
  id: string;
  side: Side;
  name: string;
  unit: string;
  rarity: Rarity;
  head: Headgear;
  /** Plate carrier (CT style) or chest rig over a jacket (T style). */
  torso: "carrier" | "rig" | "hoodie";
  colors: {
    shirt: string;
    pants: string;
    dark: string;
    gear: string;
    pouch: string;
    strap: string;
    glove: string;
    boot: string;
    skin: string;
    /** Helmet shell, hat, hood or knit. */
    hat: string;
    /** Mask rubber, scarf or face wrap. */
    mask: string;
    /** Goggle and mask lens tint. */
    lens: string;
    accent: string;
  };
  blurb: string;
}
export const agents: Agent[] = [
  {
    id: "ct-urban",
    side: "CT",
    name: "Urban Recon",
    unit: "Rapid response",
    rarity: "stock",
    head: "helmet-mask",
    torso: "carrier",
    colors: {
      shirt: "#56656e", pants: "#4b5960", dark: "#3f4b51", gear: "#2f3a3e", pouch: "#3a474c", strap: "#262d30",
      glove: "#252829", boot: "#25231f", skin: "#c39a7b", hat: "#3c494d", mask: "#1c2022", lens: "#2a5560", accent: "#8d9b5c",
    },
    blurb: "Slate fatigues, plate carrier and a full-face respirator.",
  },
  {
    id: "ct-arctic",
    side: "CT",
    name: "Frostline",
    unit: "Mountain detachment",
    rarity: "rare",
    head: "helmet-goggles",
    torso: "carrier",
    colors: {
      shirt: "#d9dfe3", pants: "#c2cad0", dark: "#9aa6ae", gear: "#e8ecee", pouch: "#b7c1c8", strap: "#6d7b85",
      glove: "#3a4248", boot: "#3c3f42", skin: "#d2a98a", hat: "#eef1f3", mask: "#59646c", lens: "#d58a2f", accent: "#3f8fd4",
    },
    blurb: "Snow whites, an amber-lens goggle and a wrapped face.",
  },
  {
    id: "ct-ranger",
    side: "CT",
    name: "Jungle Ranger",
    unit: "Long-range patrol",
    rarity: "epic",
    head: "boonie",
    torso: "carrier",
    colors: {
      shirt: "#5a6a43", pants: "#4d5a3a", dark: "#3d4830", gear: "#6b6a46", pouch: "#545c3c", strap: "#2e3324",
      glove: "#3a3a2c", boot: "#3a2f22", skin: "#8d6248", hat: "#5f6e45", mask: "#2a3020", lens: "#1d2a22", accent: "#c7b25a",
    },
    blurb: "Olive drab, a boonie hat and green-and-black face paint.",
  },
  {
    id: "ct-night",
    side: "CT",
    name: "Nightfall",
    unit: "Counter-assault",
    rarity: "legendary",
    head: "helmet-mask",
    torso: "carrier",
    colors: {
      shirt: "#202326", pants: "#1b1e21", dark: "#141618", gear: "#101214", pouch: "#191c1f", strap: "#0b0c0d",
      glove: "#0f1011", boot: "#121212", skin: "#b88a6c", hat: "#15181a", mask: "#0b0c0d", lens: "#e0202a", accent: "#d82732",
    },
    blurb: "Head-to-toe black with red respirator lenses.",
  },
  {
    id: "t-militia",
    side: "T",
    name: "Desert Militia",
    unit: "Irregulars",
    rarity: "stock",
    head: "balaclava",
    torso: "rig",
    colors: {
      shirt: "#8b7653", pants: "#4d4b3b", dark: "#6f5f43", gear: "#5d5337", pouch: "#6b6041", strap: "#3f3827",
      glove: "#39332a", boot: "#4e3c2a", skin: "#b6886a", hat: "#1f1f1e", mask: "#8a7a5c", lens: "#efe9d6", accent: "#4a5236",
    },
    blurb: "Field jacket, chest rig, shemagh and a knit balaclava.",
  },
  {
    id: "t-street",
    side: "T",
    name: "Street Crew",
    unit: "City cell",
    rarity: "rare",
    head: "hood",
    torso: "hoodie",
    colors: {
      shirt: "#26272b", pants: "#2f3a4d", dark: "#1a1b1e", gear: "#2b2b2e", pouch: "#3a3a3e", strap: "#141416",
      glove: "#18181a", boot: "#d9d6cf", skin: "#9b6b4f", hat: "#26272b", mask: "#b3202b", lens: "#efe9d6", accent: "#e23a3a",
    },
    blurb: "Black hoodie, jeans, white trainers and a red bandana.",
  },
  {
    id: "t-guerrilla",
    side: "T",
    name: "Canopy Guerrilla",
    unit: "Jungle front",
    rarity: "epic",
    head: "beanie",
    torso: "rig",
    colors: {
      shirt: "#4f5b3a", pants: "#3e3a2c", dark: "#36402a", gear: "#5b4a32", pouch: "#6a5638", strap: "#2a2419",
      glove: "#2c281f", boot: "#2b241a", skin: "#8a5e43", hat: "#3a3f2a", mask: "#2a2a22", lens: "#efe9d6", accent: "#a63a2a",
    },
    blurb: "Olive shirt, a knit cap, beard and a bandolier rig.",
  },
  {
    id: "t-sandstorm",
    side: "T",
    name: "Dust Phantom",
    unit: "Desert raiders",
    rarity: "legendary",
    head: "shemagh",
    torso: "rig",
    colors: {
      shirt: "#c9b48b", pants: "#a8946e", dark: "#9b8662", gear: "#7c6a4a", pouch: "#8f7b56", strap: "#5a4a32",
      glove: "#6b5a40", boot: "#6e5639", skin: "#b07f5f", hat: "#cbb68c", mask: "#dccba6", lens: "#24262a", accent: "#7a2d22",
    },
    blurb: "Sand robes, full shemagh wrap and dark goggles.",
  },
];
export const agentById = new Map(agents.map((a) => [a.id, a]));
export const defaultAgent: Record<Side, string> = { CT: "ct-urban", T: "t-militia" };

/** Firearms that can wear a finish, in armory order. */
export const skinnableGuns: Gun[] = ["ak", "m4", "m4a4", "aug", "awp", "ssg", "p90", "nova", "xm", "negev", "glock", "deagle"];
export const gunLabel = (g: Gun) => catalog[g].name;

export interface Loadout {
  agent: Record<Side, string>;
  knife: KnifeModel;
  knifeFinish: string;
  /** Finish per firearm; missing means Factory. */
  guns: Partial<Record<Gun, string>>;
}
export const defaultLoadout = (): Loadout => ({
  agent: { ...defaultAgent },
  knife: "combat",
  knifeFinish: "factory",
  guns: {},
});
const KEY = "cs-web:loadout";
/** Reads a loadout, dropping anything unknown so stale storage can never break a match. */
export function sanitize(raw: unknown): Loadout {
  const out = defaultLoadout(),
    r = (raw && typeof raw === "object" ? raw : {}) as Partial<Loadout>;
  for (const side of ["CT", "T"] as const) {
    const a = r.agent?.[side];
    if (typeof a === "string" && agentById.get(a)?.side === side) out.agent[side] = a;
  }
  if (typeof r.knife === "string" && knifeById.has(r.knife as KnifeModel)) out.knife = r.knife as KnifeModel;
  const kf = typeof r.knifeFinish === "string" ? finishById.get(r.knifeFinish) : undefined;
  if (kf && kf.for !== "gun") out.knifeFinish = kf.id;
  if (r.guns && typeof r.guns === "object")
    for (const g of skinnableGuns) {
      const f = finishById.get((r.guns as Record<string, string>)[g]);
      if (f && f.for !== "knife" && f.id !== "factory") out.guns[g] = f.id;
    }
  return out;
}
export function loadLoadout(): Loadout {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    return defaultLoadout();
  }
}
export function saveLoadout(l: Loadout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* Optional in private browsing. */
  }
}

/** What one player shows: the outfit for their side and finishes for what they hold. */
export interface Look {
  agent: string;
  knife: KnifeModel;
  knifeFinish: string;
  guns: Partial<Record<Gun, string>>;
}
export const lookOf = (l: Loadout, side: Side): Look => ({
  agent: l.agent[side],
  knife: l.knife,
  knifeFinish: l.knifeFinish,
  guns: l.guns,
});
/** Finish id an item shows in `look`; "factory" for anything without one. */
export function finishFor(look: Look | undefined, item: string) {
  if (!look) return "factory";
  if (item === "knife") return look.knifeFinish;
  return look.guns[item as Gun] ?? "factory";
}
const mix32 = (n: number) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
};
/**
 * A bot's look, fixed by its id and the match seed so it stays the same all match. Most bots
 * wear a common outfit and plain guns; a few roll something rarer, like a real lobby.
 */
export function botLook(id: number, side: Side, seed = 0): Look {
  let n = mix32(id * 7919 + seed * 31 + (side === "CT" ? 1 : 2));
  const roll = () => ((n = mix32(n + 0x9e3779b9)) % 10000) / 10000;
  const weighted = <T extends { rarity: Rarity }>(list: T[]) => {
    const weight = (r: Rarity) => ({ stock: 10, common: 7, uncommon: 4, rare: 2.4, epic: 1.2, legendary: 0.55 })[r];
    let total = 0;
    for (const x of list) total += weight(x.rarity);
    let pick = roll() * total;
    for (const x of list) if ((pick -= weight(x.rarity)) <= 0) return x;
    return list[0];
  };
  const sideAgents = agents.filter((a) => a.side === side),
    guns: Partial<Record<Gun, string>> = {};
  for (const g of skinnableGuns) if (roll() < 0.55) guns[g] = weighted(gunFinishes).id;
  return {
    agent: weighted(sideAgents).id,
    knife: weighted(knives).id,
    knifeFinish: weighted(knifeFinishes).id,
    guns,
  };
}
/** "AK-47 | Magma" style label; plain name for Factory. */
export function itemLabel(name: string, finishId: string) {
  const f = finishById.get(finishId);
  return f && f.id !== "factory" ? `${name} | ${f.name}` : name;
}
