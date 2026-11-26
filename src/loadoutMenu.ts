/**
 * The lobby's Loadout view: pick an agent per side, a knife and its finish, and a finish for
 * every firearm. Choices save to this device at once. The 3D stage loads lazily the first time
 * the view opens; the pickers (and their 2D pattern swatches) work without it.
 */
import {
  agents,
  agentById,
  finishById,
  gunFinishes,
  gunLabel,
  itemLabel,
  knifeById,
  knifeFinishes,
  knives,
  loadLoadout,
  lookOf,
  rarityInfo,
  saveLoadout,
  skinnableGuns,
  type Finish,
  type KnifeModel,
  type Loadout,
  type Rarity,
  type Side,
} from "./cosmetics";
import type { Gun } from "./config/weapons";
import { swatch } from "./skinPatterns";
import type { LoadoutStage, Subject } from "./loadoutPreview";

type Tab = "agents" | "knives" | "weapons";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const rar = (r: Rarity) => `style="--rar:${rarityInfo[r].color}"`;
const sideRifle: Record<Side, Gun> = { CT: "m4", T: "ak" };

export interface LoadoutView {
  open(): void;
  close(): void;
  /** One-line summary for the Play view: agent, knife and finish count. */
  summary(side: Side): { agent: string; knife: string; finishes: number };
  destroy(): void;
}
export function mountLoadout(host: HTMLElement, opts: { side: () => Side; onChange?: () => void }): LoadoutView {
  const abort = new AbortController(),
    { signal } = abort,
    state: { tab: Tab; gun: Gun; side: Side; loadout: Loadout } = {
      tab: "agents",
      gun: "ak",
      side: opts.side(),
      loadout: loadLoadout(),
    };
  host.innerHTML = `<div class="csw-loadoutgrid">
    <article class="csw-stage" aria-label="Item preview">
      <canvas class="csw-stagecanvas"></canvas>
      <div class="csw-stageglow" aria-hidden="true"></div>
      <div class="csw-frame csw-frame-tl"></div><div class="csw-frame csw-frame-tr"></div><div class="csw-frame csw-frame-br"></div>
      <span class="csw-previewtag">Drag to rotate</span>
      <p class="csw-stageloading" data-stage-loading>Loading preview…</p>
      <div class="csw-stageinfo"><span class="csw-rarity" data-stage-rarity></span><h2 data-stage-name></h2><p data-stage-blurb></p></div>
    </article>
    <section class="csw-locker" aria-label="Loadout options">
      <div class="csw-lockertabs" role="tablist" aria-label="Loadout category">
        <button type="button" role="tab" data-ltab="agents">Agents</button>
        <button type="button" role="tab" data-ltab="knives">Knives</button>
        <button type="button" role="tab" data-ltab="weapons">Weapon finishes</button>
      </div>
      <div class="csw-lockerbody" role="tabpanel" data-locker></div>
    </section>
  </div>`;
  const get = <T extends Element = HTMLElement>(s: string) => host.querySelector<T>(s)!;
  const body = get("[data-locker]"),
    canvas = get<HTMLCanvasElement>(".csw-stagecanvas"),
    loading = get("[data-stage-loading]");
  let stage: LoadoutStage | null = null,
    starting: Promise<void> | null = null;
  const thumbs = new Map<string, string>();

  const save = () => {
    saveLoadout(state.loadout);
    opts.onChange?.();
  };
  const finishCard = (f: Finish, pressed: boolean, attr: string) =>
    `<button type="button" class="csw-swatch" ${attr}="${f.id}" aria-pressed="${pressed}" ${rar(f.rarity)} title="${esc(f.blurb)}"><span class="csw-swatchart" data-swatch="${f.id}"></span><span class="csw-swatchname">${esc(f.name)}</span><small>${rarityInfo[f.rarity].label}</small></button>`;
  function render() {
    for (const b of host.querySelectorAll<HTMLButtonElement>("[data-ltab]")) {
      const on = b.dataset.ltab === state.tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const l = state.loadout;
    if (state.tab === "agents") {
      body.innerHTML = (["CT", "T"] as const)
        .map(
          (side) => `<h3 class="csw-lockerhead"><span>${side === "CT" ? "Counter-Terrorists" : "Terrorists"}</span><small>${esc(agentById.get(l.agent[side])!.name)} equipped</small></h3>
          <div class="csw-cards">${agents
            .filter((a) => a.side === side)
            .map(
              (a) => `<button type="button" class="csw-card" data-agent="${a.id}" aria-pressed="${l.agent[side] === a.id}" ${rar(a.rarity)}><span class="csw-cardthumb" data-thumb="agent:${a.id}"></span><span class="csw-cardname">${esc(a.name)}</span><small>${esc(a.unit)}</small></button>`,
            )
            .join("")}</div>`,
        )
        .join("");
    } else if (state.tab === "knives") {
      body.innerHTML = `<h3 class="csw-lockerhead"><span>Knife</span><small>${esc(knifeById.get(l.knife)!.name)} equipped</small></h3>
        <div class="csw-cards csw-cards-knives">${knives
          .map(
            (k) => `<button type="button" class="csw-card" data-knife="${k.id}" aria-pressed="${l.knife === k.id}" ${rar(k.rarity)} title="${esc(k.blurb)}"><span class="csw-cardthumb" data-thumb="knife:${k.id}"></span><span class="csw-cardname">${esc(k.name)}</span><small>${rarityInfo[k.rarity].label}</small></button>`,
          )
          .join("")}</div>
        <h3 class="csw-lockerhead"><span>Blade finish</span><small>${esc(finishById.get(l.knifeFinish)!.name)}</small></h3>
        <div class="csw-swatches">${knifeFinishes.map((f) => finishCard(f, l.knifeFinish === f.id, "data-kfinish")).join("")}</div>`;
    } else {
      const current = l.guns[state.gun] ?? "factory";
      body.innerHTML = `<h3 class="csw-lockerhead"><span>Weapon</span><small>${Object.keys(l.guns).length} of ${skinnableGuns.length} customised</small></h3>
        <div class="csw-gunchips">${skinnableGuns
          .map((g) => {
            const f = finishById.get(l.guns[g] ?? "factory")!;
            return `<button type="button" class="csw-gunchip" data-gun="${g}" aria-pressed="${state.gun === g}" ${rar(f.rarity)}><b>${esc(gunLabel(g))}</b><small>${esc(f.name)}</small></button>`;
          })
          .join("")}</div>
        <h3 class="csw-lockerhead"><span>${esc(gunLabel(state.gun))} finish</span><small>${esc(finishById.get(current)!.name)}</small></h3>
        <div class="csw-swatches">${gunFinishes.map((f) => finishCard(f, current === f.id, "data-gfinish")).join("")}</div>`;
    }
    for (const el of body.querySelectorAll<HTMLElement>("[data-swatch]")) {
      const f = finishById.get(el.dataset.swatch!);
      if (f) el.append(swatch(f, 84));
    }
    fillThumbs();
    preview();
  }
  function fillThumbs() {
    for (const el of body.querySelectorAll<HTMLElement>("[data-thumb]")) {
      const key = el.dataset.thumb!;
      let url = thumbs.get(key);
      if (!url && stage) {
        const [kind, id] = key.split(":");
        const side = (agentById.get(id)?.side ?? "CT") as Side,
          look = { ...lookOf(state.loadout, side), knife: (kind === "knife" ? id : state.loadout.knife) as KnifeModel, knifeFinish: "factory" };
        if (kind === "agent") look.agent = id;
        const subject: Subject = kind === "agent" ? { kind: "agent", team: side, look, weapon: sideRifle[side] } : { kind: "weapon", id: "knife", look };
        try {
          url = stage.thumbnail(subject, kind === "agent" ? 200 : 220, kind === "agent" ? 200 : 130);
          thumbs.set(key, url);
        } catch {
          /* Thumbnails are decoration. */
        }
      }
      if (url && !el.firstChild) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = url;
        el.append(img);
      }
    }
  }
  /** What the stage shows for the current tab, and the caption under it. */
  function preview() {
    const l = state.loadout;
    let subject: Subject, name: string, rarity: Rarity, blurb: string;
    if (state.tab === "agents") {
      const a = agentById.get(l.agent[state.side])!;
      subject = { kind: "agent", team: state.side, look: lookOf(l, state.side), weapon: sideRifle[state.side] };
      name = a.name;
      rarity = a.rarity;
      blurb = a.blurb;
    } else if (state.tab === "knives") {
      const k = knifeById.get(l.knife)!,
        f = finishById.get(l.knifeFinish)!;
      subject = { kind: "weapon", id: "knife", look: lookOf(l, state.side) };
      name = itemLabel(k.name, f.id);
      rarity = f.id === "factory" ? k.rarity : (rarities(f.rarity, k.rarity) as Rarity);
      blurb = f.id === "factory" ? k.blurb : f.blurb;
    } else {
      const f = finishById.get(l.guns[state.gun] ?? "factory")!;
      subject = { kind: "weapon", id: state.gun, look: lookOf(l, state.side) };
      name = itemLabel(gunLabel(state.gun), f.id);
      rarity = f.rarity;
      blurb = f.blurb;
    }
    get("[data-stage-name]").textContent = name;
    get("[data-stage-blurb]").textContent = blurb;
    const tag = get("[data-stage-rarity]");
    tag.textContent = rarityInfo[rarity].label;
    host.style.setProperty("--rar", rarityInfo[rarity].color);
    stage?.show(subject);
  }
  const rarities = (a: Rarity, b: Rarity) => (["stock", "common", "uncommon", "rare", "epic", "legendary"].indexOf(a) > ["stock", "common", "uncommon", "rare", "epic", "legendary"].indexOf(b) ? a : b);
  function boot() {
    starting ??= (async () => {
      try {
        const mod = await import("./loadoutPreview");
        await mod.LoadoutStage.prepare(import.meta.env.BASE_URL);
        if (signal.aborted) return;
        stage = new mod.LoadoutStage(canvas);
        loading.hidden = true;
        render();
      } catch (err) {
        console.warn("Loadout preview unavailable:", err);
        loading.textContent = "3D preview unavailable on this device.";
      }
    })();
  }
  host.addEventListener(
    "click",
    (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!b) return;
      const d = b.dataset,
        l = state.loadout;
      if (d.ltab) {
        state.tab = d.ltab as Tab;
        render();
        return;
      }
      if (d.agent) {
        const a = agentById.get(d.agent);
        if (a) {
          l.agent[a.side] = a.id;
          state.side = a.side;
        }
      } else if (d.knife && knifeById.has(d.knife as KnifeModel)) l.knife = d.knife as KnifeModel;
      else if (d.kfinish && finishById.has(d.kfinish)) l.knifeFinish = d.kfinish;
      else if (d.gun) state.gun = d.gun as Gun;
      else if (d.gfinish && finishById.has(d.gfinish)) {
        if (d.gfinish === "factory") delete l.guns[state.gun];
        else l.guns[state.gun] = d.gfinish;
      } else return;
      save();
      const focus = Object.entries(d)
        .map(([k, v]) => `[data-${k}="${v}"]`)
        .join("");
      render();
      host.querySelector<HTMLElement>(focus)?.focus();
    },
    { signal },
  );
  // Arrow keys move between tabs, like a tab list should.
  host.addEventListener(
    "keydown",
    (e) => {
      const tab = (e.target as Element).closest<HTMLElement>("[data-ltab]");
      if (!tab || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      const order: Tab[] = ["agents", "knives", "weapons"],
        next = order[(order.indexOf(state.tab) + (e.key === "ArrowRight" ? 1 : 2)) % 3];
      state.tab = next;
      render();
      host.querySelector<HTMLElement>(`[data-ltab="${next}"]`)?.focus();
    },
    { signal },
  );
  render();
  return {
    open() {
      state.side = opts.side();
      state.loadout = loadLoadout();
      boot();
      render();
    },
    close() {},
    summary(side) {
      const l = loadLoadout();
      return {
        agent: agentById.get(l.agent[side])!.name,
        knife: itemLabel(knifeById.get(l.knife)!.name, l.knifeFinish),
        finishes: Object.keys(l.guns).length,
      };
    },
    destroy() {
      abort.abort();
      stage?.dispose();
      stage = null;
    },
  };
}
