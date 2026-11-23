import type { SimEvent } from "./sim/Sim";
import { catalog, isGun } from "./config/weapons";
import type { Vec3 } from "./world";

interface GunVoice {
  /** Start pitch of the low thump in Hz. */
  thump: number;
  /** Center of the band-passed muzzle blast. */
  blast: number;
  /** Body length in seconds. */
  len: number;
  level: number;
  /** Seconds of the room tail. */
  tail: number;
  mech?: "bolt" | "pump" | "shell";
  silenced?: boolean;
}
const guns: Record<string, GunVoice> = {
  ak: {
    thump: 120,
    blast: 1500,
    len: 0.16,
    level: 0.95,
    tail: 0.5,
    mech: "shell",
  },
  m4: {
    thump: 160,
    blast: 1900,
    len: 0.08,
    level: 0.42,
    tail: 0.18,
    silenced: true,
  },
  m4a4: {
    thump: 140,
    blast: 1750,
    len: 0.13,
    level: 0.85,
    tail: 0.42,
    mech: "shell",
  },
  aug: {
    thump: 135,
    blast: 1650,
    len: 0.14,
    level: 0.86,
    tail: 0.45,
    mech: "shell",
  },
  p90: {
    thump: 175,
    blast: 2300,
    len: 0.09,
    level: 0.66,
    tail: 0.3,
    mech: "shell",
  },
  glock: { thump: 210, blast: 2600, len: 0.08, level: 0.6, tail: 0.28 },
  deagle: { thump: 95, blast: 1300, len: 0.22, level: 1, tail: 0.65 },
  awp: {
    thump: 70,
    blast: 1100,
    len: 0.34,
    level: 1.15,
    tail: 1.1,
    mech: "bolt",
  },
  ssg: {
    thump: 105,
    blast: 1800,
    len: 0.2,
    level: 0.92,
    tail: 0.75,
    mech: "bolt",
  },
  nova: {
    thump: 80,
    blast: 900,
    len: 0.26,
    level: 1.1,
    tail: 0.8,
    mech: "pump",
  },
  xm: {
    thump: 88,
    blast: 1000,
    len: 0.22,
    level: 1.05,
    tail: 0.7,
    mech: "shell",
  },
  negev: {
    thump: 115,
    blast: 1400,
    len: 0.12,
    level: 0.85,
    tail: 0.4,
    mech: "shell",
  },
};
/**
 * How loud a sound `d` metres away is: full within 2.5 m, then falling off a little faster than
 * inverse distance, and fading smoothly to silence over the last 40% of its `reach`.
 */
export function falloff(d: number, reach: number) {
  const near = Math.min(1, (2.5 / Math.max(d, 0.01)) ** 1.15),
    k = Math.min(1, Math.max(0, (d - reach * 0.6) / (reach * 0.4)));
  return near * (1 - k * k * (3 - 2 * k));
}
/**
 * Spatial voices are synthesized from a reusable noise buffer, oscillators, a
 * soft-clipping shaper for punch and a generated convolution reverb for the room tail.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lowPass: BiquadFilterNode | null = null;
  private reverb: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private drive: Float32Array<ArrayBuffer> | null = null;
  private level = 0.65;
  /** The listening player's id: their own shots and hits sound close, not spatial. */
  self = 0;
  private lastWhiz = 0;
  private ear: Vec3 = { x: 0, y: 0, z: 0 };
  private sources = new Set<AudioScheduledSourceNode>();
  private obstructions = new Map<string, { time: number; amount: number }>();
  /**
   * `occluded` says how blocked the path from listener to source is: 0 in the open, about 0.5
   * when the sound can bend round a nearby corner or over a low wall, 1 behind solid walls.
   */
  constructor(public occluded?: (listener: Vec3, source: Vec3) => number) {}
  get volume() {
    return this.level;
  }
  set volume(value: number) {
    this.level = Math.min(
      1,
      Math.max(0, Number.isFinite(value) ? value : 0.65),
    );
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(
        this.level * 0.78,
        this.ctx.currentTime,
        0.015,
      );
  }
  unlock() {
    if (!this.ctx) {
      if (typeof AudioContext === "undefined") return;
      try {
        const ctx = new AudioContext();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.level * 0.78;
        this.lowPass = ctx.createBiquadFilter();
        this.lowPass.type = "lowpass";
        this.lowPass.frequency.value = 18000;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -14;
        limiter.knee.value = 6;
        limiter.ratio.value = 10;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.18;
        this.lowPass
          .connect(limiter)
          .connect(this.master)
          .connect(ctx.destination);
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate),
          data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noise = buffer;
        // Exponentially decaying stereo noise makes a convincing outdoor slap-back room.
        const length = Math.floor(ctx.sampleRate * 2.4),
          ir = ctx.createBuffer(2, length, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
          const ch = ir.getChannelData(c);
          for (let i = 0; i < length; i++) {
            const t = i / ctx.sampleRate,
              early = t > 0.03 && t < 0.09 ? 0.55 : 0;
            ch[i] =
              (Math.random() * 2 - 1) *
              (Math.exp(-t * 3.1) * 0.6 + early * Math.exp(-(t - 0.03) * 40));
          }
        }
        const convolver = ctx.createConvolver();
        convolver.buffer = ir;
        const tone = ctx.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = 4200;
        this.reverb = ctx.createGain();
        this.reverb.gain.value = 0.55;
        this.reverb.connect(tone).connect(convolver).connect(this.lowPass);
        const curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) {
          const x = (i / (curve.length - 1)) * 2 - 1;
          curve[i] = Math.tanh(x * 3.2) / Math.tanh(3.2);
        }
        this.drive = curve;
      } catch {
        return;
      }
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => {});
  }
  updateListener(p: Vec3, yaw: number, pitch: number) {
    this.ear.x = p.x;
    this.ear.y = p.y;
    this.ear.z = p.z;
    const l = this.ctx?.listener;
    if (!l) return;
    const x = Math.sin(yaw) * Math.cos(pitch),
      y = Math.sin(pitch),
      z = -Math.cos(yaw) * Math.cos(pitch);
    if (l.positionX) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
      l.forwardX.value = x;
      l.forwardY.value = y;
      l.forwardZ.value = z;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(x, y, z, 0, 1, 0);
    }
  }
  /**
   * Builds the routing for one sound: a dry path through an HRTF panner (muffled
   * behind walls, darker with distance) and a reverb send that grows with distance.
   */
  private voice(
    e: SimEvent,
    duration: number,
    make: (
      input: AudioNode,
      nodes: AudioNode[],
      start: number,
      range: number,
    ) => void,
    options: { wet?: number; reach?: number } = {},
  ) {
    const ctx = this.ctx;
    if (
      !ctx ||
      !this.lowPass ||
      !this.noise ||
      ctx.state !== "running" ||
      this.sources.size > 90 ||
      this.level <= 0
    )
      return;
    const nodes: AudioNode[] = [],
      start = ctx.currentTime,
      reach = options.reach ?? 105;
    const input = ctx.createGain();
    nodes.push(input);
    let output: AudioNode = this.lowPass,
      range = 0,
      level = 1,
      echo = 1;
    if (
      e.pos &&
      Math.hypot(
        e.pos.x - this.ear.x,
        e.pos.y - this.ear.y,
        e.pos.z - this.ear.z,
      ) > 0.5
    ) {
      const p = e.pos;
      range = Math.hypot(p.x - this.ear.x, p.y - this.ear.y, p.z - this.ear.z);
      if (range > reach) return;
      const pan = ctx.createPanner();
      pan.panningModel = "HRTF";
      // Distance is handled below so the falloff can reach true silence at `reach`.
      pan.rolloffFactor = 0;
      pan.positionX.value = p.x;
      pan.positionY.value = p.y;
      pan.positionZ.value = p.z;
      pan.connect(output);
      output = pan;
      nodes.push(pan);
      const air = ctx.createBiquadFilter();
      air.type = "lowpass";
      air.frequency.value = Math.max(1400, 19000 * Math.exp(-range / 38));
      air.connect(output);
      output = air;
      nodes.push(air);
      // Rays are cast at most every 0.1 s per spot (to the nearest metre) and listener spot.
      const tag = [p.x, p.y, p.z, this.ear.x, this.ear.z].map(Math.round).join(),
        cached = this.obstructions.get(tag);
      let blocked = 0;
      if (this.occluded) {
        if (cached && start - cached.time < 0.1) blocked = cached.amount;
        else {
          blocked = this.occluded(this.ear, p);
          if (this.obstructions.size > 200) this.obstructions.clear();
          this.obstructions.set(tag, { time: start, amount: blocked });
        }
      }
      if (blocked > 0) {
        // Round a corner the sound loses its top end; through walls it is a dull thud.
        const wall = ctx.createBiquadFilter();
        wall.type = "lowpass";
        wall.frequency.value = blocked >= 1 ? 520 : 1500;
        wall.Q.value = 0.6;
        wall.connect(output);
        output = wall;
        nodes.push(wall);
      }
      level = falloff(range, reach) * (blocked >= 1 ? 0.3 : blocked > 0 ? 0.62 : 1);
      echo = falloff(range, reach) ** 0.55 * (blocked >= 1 ? 0.55 : 1);
    }
    const loudness = ctx.createGain();
    loudness.gain.value = level;
    nodes.push(loudness);
    input.connect(loudness).connect(output);
    if (this.reverb) {
      const send = ctx.createGain();
      send.gain.value =
        (options.wet ?? 0.25) * (0.6 + Math.min(1.6, range / 30)) * echo;
      input.connect(send).connect(this.reverb);
      nodes.push(send);
    }
    make(input, nodes, start, range);
    // A silent timer node releases the whole graph after delayed transients have finished.
    const timer = ctx.createConstantSource(),
      mute = ctx.createGain();
    mute.gain.value = 0;
    timer.connect(mute).connect(input);
    this.sources.add(timer);
    timer.onended = () => {
      timer.disconnect();
      mute.disconnect();
      for (const n of nodes) n.disconnect();
      this.sources.delete(timer);
    };
    timer.start(start);
    timer.stop(start + duration + 0.15);
  }
  private shaper(out: AudioNode, nodes: AudioNode[]) {
    const ws = this.ctx!.createWaveShaper();
    ws.curve = this.drive;
    ws.oversample = "2x";
    ws.connect(out);
    nodes.push(ws);
    return ws;
  }
  private tone(
    out: AudioNode,
    nodes: AudioNode[],
    t: number,
    length: number,
    hz: number,
    end: number,
    level: number,
    type: OscillatorType = "sine",
  ) {
    const ctx = this.ctx!,
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, end), t + length);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + length + 0.01);
    nodes.push(o, g);
  }
  private hiss(
    out: AudioNode,
    nodes: AudioNode[],
    t: number,
    length: number,
    hz: number,
    level: number,
    filter: BiquadFilterType = "lowpass",
    q = 0.8,
    attack = 0.002,
  ) {
    const ctx = this.ctx!,
      s = ctx.createBufferSource(),
      g = ctx.createGain(),
      f = ctx.createBiquadFilter();
    s.buffer = this.noise;
    s.loop = true;
    f.type = filter;
    f.frequency.value = hz;
    f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(
      0.0001,
      t + Math.max(attack + 0.005, length),
    );
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 1.5);
    s.stop(t + length + 0.02);
    nodes.push(s, g, f);
    return f;
  }
  private gunshot(e: SimEvent) {
    const v = guns[e.weapon ?? "glock"] ?? guns.glock,
      local = e.actor === this.self;
    this.voice(
      e,
      v.tail + 0.7,
      (out, n, t, range) => {
        const far = Math.min(1, range / 60);
        if (v.silenced) {
          this.hiss(out, n, t, 0.05, 2600, v.level, "bandpass", 1.2);
          this.tone(out, n, t, 0.06, v.thump, 60, v.level * 0.6);
          this.hiss(out, n, t + 0.01, 0.12, 900, v.level * 0.25);
          this.click(out, n, t + 0.07, 0.07, 3400);
          return;
        }
        const drive = this.shaper(out, n);
        // Supersonic crack, then the muzzle blast body, then a low chest thump.
        this.hiss(
          out,
          n,
          t,
          0.014,
          5200,
          v.level * (1.1 - far * 0.5),
          "highpass",
          0.7,
          0.0008,
        );
        this.hiss(
          drive,
          n,
          t,
          v.len,
          v.blast,
          v.level * 0.95,
          "bandpass",
          0.9,
          0.001,
        );
        this.hiss(
          drive,
          n,
          t + 0.004,
          v.len * 1.4,
          v.blast * 0.45,
          v.level * 0.6,
          "lowpass",
          0.7,
        );
        this.tone(
          drive,
          n,
          t,
          v.len * 1.2,
          v.thump,
          34,
          v.level * (0.95 + far * 0.3),
        );
        this.tone(
          out,
          n,
          t,
          0.03,
          v.thump * 6,
          v.thump * 2,
          v.level * 0.25,
          "triangle",
        );
        // Room tail: dark noise that outlives the shot and blooms at range.
        this.hiss(
          out,
          n,
          t + 0.02,
          v.tail,
          650 + 400 * (1 - far),
          v.level * (0.22 + far * 0.25),
          "lowpass",
          0.5,
          0.03,
        );
        if (local && v.mech === "bolt") {
          this.click(out, n, t + 0.55, 0.16, 2600);
          this.click(out, n, t + 0.72, 0.18, 1900);
          this.click(out, n, t + 0.86, 0.16, 2300);
        } else if (local && v.mech === "pump") {
          this.click(out, n, t + 0.34, 0.2, 1500);
          this.hiss(out, n, t + 0.36, 0.08, 700, 0.12, "bandpass");
          this.click(out, n, t + 0.5, 0.24, 1250);
        } else if (local && v.mech === "shell") {
          this.tone(
            out,
            n,
            t + 0.32 + Math.random() * 0.08,
            0.07,
            5200 + Math.random() * 1400,
            4800,
            0.03,
            "triangle",
          );
          this.tone(
            out,
            n,
            t + 0.42 + Math.random() * 0.08,
            0.05,
            6100,
            5900,
            0.02,
            "triangle",
          );
        }
      },
      { wet: v.silenced ? 0.12 : 0.3 + v.level * 0.1 },
    );
  }
  private click(
    out: AudioNode,
    n: AudioNode[],
    t: number,
    level: number,
    hz: number,
  ) {
    this.hiss(out, n, t, 0.035, hz, level, "bandpass", 2.2, 0.0008);
    this.tone(out, n, t, 0.025, hz * 0.55, hz * 0.3, level * 0.45, "square");
  }
  private explosion(e: SimEvent, bomb: boolean) {
    const k = bomb ? 1.6 : 1;
    this.voice(
      e,
      2.8 * k,
      (out, n, t) => {
        const drive = this.shaper(out, n);
        this.hiss(out, n, t, 0.05, 3000, 1.1, "highpass", 0.6, 0.0006);
        this.hiss(drive, n, t, 0.45 * k, 1400, 1.0, "lowpass", 0.7, 0.001);
        this.tone(drive, n, t, 1.1 * k, 78, 24, 1.2);
        this.tone(drive, n, t + 0.01, 0.5 * k, 140, 40, 0.6, "triangle");
        this.hiss(out, n, t + 0.04, 1.7 * k, 260, 0.75, "lowpass", 0.5, 0.05);
        this.hiss(out, n, t + 0.08, 1.1 * k, 900, 0.3, "bandpass", 0.6, 0.08);
        // Debris and gravel pattering down after the blast.
        for (let i = 0; i < (bomb ? 22 : 12); i++) {
          const d = 0.18 + Math.random() * (bomb ? 1.6 : 0.9);
          this.hiss(
            out,
            n,
            t + d,
            0.02 + Math.random() * 0.03,
            1800 + Math.random() * 4000,
            0.06 + Math.random() * 0.08,
            "bandpass",
            3,
          );
        }
      },
      { wet: 0.75, reach: 160 },
    );
  }
  private shatter(e: SimEvent) {
    this.voice(
      e,
      0.9,
      (out, n, t) => {
        this.hiss(out, n, t, 0.06, 6500, 0.5, "highpass", 0.8, 0.0006);
        for (let i = 0; i < 9; i++) {
          const d = Math.random() * 0.22,
            hz = 2800 + Math.random() * 5200;
          this.tone(
            out,
            n,
            t + d,
            0.05 + Math.random() * 0.12,
            hz,
            hz * 0.96,
            0.05 + Math.random() * 0.05,
            "triangle",
          );
        }
        this.hiss(out, n, t + 0.02, 0.18, 4200, 0.25, "bandpass", 1.6);
      },
      { wet: 0.35 },
    );
  }
  private fire(e: SimEvent, seconds: number) {
    this.voice(
      e,
      seconds + 0.6,
      (out, n, t) => {
        // Ignition whoosh, then a sustained roar with random crackles.
        const ctx = this.ctx!;
        const whoosh = this.hiss(
          out,
          n,
          t,
          0.7,
          300,
          0.55,
          "lowpass",
          0.9,
          0.08,
        );
        whoosh.frequency.setValueAtTime(250, t);
        whoosh.frequency.exponentialRampToValueAtTime(3200, t + 0.45);
        const s = ctx.createBufferSource(),
          g = ctx.createGain(),
          f = ctx.createBiquadFilter();
        s.buffer = this.noise;
        s.loop = true;
        f.type = "bandpass";
        f.frequency.value = 520;
        f.Q.value = 0.5;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.32, t + 0.3);
        g.gain.setValueAtTime(0.32, t + seconds - 1);
        g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
        s.connect(f).connect(g).connect(out);
        s.start(t);
        s.stop(t + seconds + 0.05);
        n.push(s, g, f);
        for (let i = 0; i < seconds * 9; i++) {
          const d = 0.25 + Math.random() * (seconds - 0.6);
          this.hiss(
            out,
            n,
            t + d,
            0.012 + Math.random() * 0.02,
            2200 + Math.random() * 3500,
            0.08 + Math.random() * 0.14,
            "highpass",
            0.9,
            0.0008,
          );
        }
      },
      { wet: 0.3, reach: 60 },
    );
  }
  /**
   * One footfall, voiced for the surface underfoot: a heel strike, then the toe rolling off
   * 60-75 ms later. Grit crunches, stone clicks, metal rings and wood knocks hollow.
   */
  private step(e: SimEvent, floor: string) {
    const r = 0.92 + Math.random() * 0.16,
      toe = 0.06 + Math.random() * 0.015,
      kind =
        floor === "sand" || floor === "dirt" || floor === "foliage"
          ? "grit"
          : floor === "metal"
            ? "metal"
            : floor === "wood" || floor === "cardboard"
              ? "wood"
              : floor === "stone" || floor === "tile" || floor === "glass"
                ? "stone"
                : "concrete";
    this.voice(
      e,
      kind === "metal" ? 0.4 : 0.2,
      (out, n, t) => {
        if (kind === "grit") {
          // Packed sand: a soft muffled press with grains crunching under the sole.
          this.hiss(out, n, t, 0.14, 1300 * r, 0.2, "lowpass", 0.7, 0.012);
          this.tone(out, n, t, 0.06, 85 * r, 48, 0.08);
          for (let i = 0; i < 6; i++)
            this.hiss(out, n, t + 0.01 + Math.random() * 0.1, 0.007, 3200 + Math.random() * 2600, 0.035 + Math.random() * 0.03, "highpass", 0.7, 0.0008);
          if (floor === "foliage")
            this.hiss(out, n, t + 0.02, 0.12, 2600 * r, 0.06, "bandpass", 0.6, 0.02);
        } else if (kind === "metal") {
          // Grating and sheet steel: a dull thump with a short metallic ring over it.
          this.tone(out, n, t, 0.08, 95 * r, 58, 0.13);
          this.hiss(out, n, t, 0.05, 3300 * r, 0.15, "bandpass", 2);
          this.tone(out, n, t, 0.26, 430 * r, 410 * r, 0.055, "triangle");
          this.tone(out, n, t, 0.18, 1160 * r, 1120 * r, 0.03, "triangle");
          this.hiss(out, n, t + toe, 0.035, 3800 * r, 0.08, "bandpass", 2);
          this.tone(out, n, t + toe, 0.14, 610 * r, 590 * r, 0.025, "triangle");
        } else if (kind === "wood") {
          // Boards and crates: a hollow knock with a body resonance.
          this.tone(out, n, t, 0.1, 205 * r, 135, 0.15);
          this.hiss(out, n, t, 0.07, 720 * r, 0.18, "bandpass", 1.5);
          this.tone(out, n, t + toe, 0.05, 255 * r, 180, 0.07);
          this.hiss(out, n, t + toe, 0.03, 1500 * r, 0.06, "bandpass", 1.2);
        } else if (kind === "stone") {
          // Flagstones, tile and cobbles: a hard heel click and a crisp toe tap.
          this.tone(out, n, t, 0.04, 175 * r, 90, 0.1);
          this.hiss(out, n, t, 0.04, 2600 * r, 0.22, "bandpass", 1.6);
          this.hiss(out, n, t + toe, 0.025, 3300 * r, 0.13, "bandpass", 1.6);
          if (floor === "tile")
            this.tone(out, n, t, 0.05, 1900 * r, 1860 * r, 0.015, "triangle");
        } else {
          // Concrete and plaster: a heel scuff with fine grit, then the toe.
          this.tone(out, n, t, 0.05, 115 * r, 60, 0.12);
          this.hiss(out, n, t, 0.06, 1600 * r, 0.2, "bandpass", 1.2);
          this.hiss(out, n, t + toe, 0.04, 2200 * r, 0.12, "bandpass", 1.2);
          this.hiss(out, n, t + toe, 0.03, 4800 * r, 0.04, "highpass", 0.7);
        }
      },
      { wet: kind === "metal" ? 0.16 : 0.08, reach: 32 },
    );
  }
  /** Plays a sim event; `floor` is the material under a footstep, when the caller knows it. */
  play(e: SimEvent, floor?: string) {
    if (!this.ctx || !this.master) return;
    if (e.type === "shot" || e.type === "tracer") this.nearMiss(e);
    if (e.type === "shot") this.gunshot(e);
    else if (e.type === "step") this.step(e, floor ?? e.message ?? "concrete"); else if (e.type === "reload") {
      // Timed to the reload animation: release and drop, insert, then the bolt or charging handle.
      const g = e.weapon && isGun(e.weapon) ? e.weapon : "ak",
        T = catalog[g].reload;
      if (g === "nova" || g === "xm") return; // shells are voiced one by one
      this.voice(
        e,
        T,
        (out, n, t) => {
          this.click(out, n, t + T * 0.16, 0.18, 2400);
          this.hiss(out, n, t + T * 0.2, 0.08, 900, 0.1, "bandpass");
          this.tone(out, n, t + T * 0.34, 0.06, 160, 70, 0.08);
          this.click(out, n, t + T * 0.66, 0.24, 1700);
          this.tone(out, n, t + T * 0.66, 0.05, 220, 110, 0.12);
          this.click(out, n, t + T * 0.8, 0.2, 3000);
          this.click(out, n, t + T * 0.84, 0.16, 2200);
        },
        { wet: 0.08, reach: 30 },
      );
    } else if (e.type === "shell") {
      this.voice(
        e,
        0.25,
        (out, n, t) => {
          this.click(out, n, t, 0.16, 2600);
          this.tone(out, n, t + 0.02, 0.05, 340, 180, 0.07);
          this.click(out, n, t + 0.07, 0.1, 1500);
        },
        { wet: 0.06, reach: 28 },
      );
    } else if (e.type === "bounce") {
      this.voice(
        e,
        0.14,
        (out, n, t) => {
          this.tone(out, n, t, 0.11, 1070, 610, 0.13, "triangle");
          this.hiss(out, n, t, 0.03, 2400, 0.1, "bandpass", 2);
        },
        { wet: 0.12, reach: 50 },
      );
    } else if (e.type === "explosion") this.explosion(e, e.actor === undefined);
    else if (e.type === "flash") {
      this.voice(
        e,
        1.2,
        (out, n, t) => {
          const drive = this.shaper(out, n);
          this.hiss(drive, n, t, 0.09, 4500, 0.9, "highpass", 0.7, 0.0005);
          this.tone(drive, n, t, 0.18, 260, 60, 0.6);
          this.hiss(out, n, t + 0.02, 0.6, 7600, 0.25, "bandpass", 0.8, 0.01);
        },
        { wet: 0.6, reach: 130 },
      );
    } else if (e.type === "smoke") {
      this.voice(
        e,
        3.2,
        (out, n, t) => {
          this.tone(out, n, t, 0.12, 180, 70, 0.4);
          this.hiss(out, n, t, 0.04, 2400, 0.3, "bandpass", 1.2, 0.001);
          const h = this.hiss(
            out,
            n,
            t + 0.05,
            2.8,
            2600,
            0.28,
            "bandpass",
            0.6,
            0.15,
          );
          h.frequency.setValueAtTime(3400, t + 0.05);
          h.frequency.exponentialRampToValueAtTime(1300, t + 2.8);
        },
        { wet: 0.3, reach: 70 },
      );
    } else if (e.type === "shatter") this.shatter(e);
    else if (e.type === "fire")
      this.fire(e, Math.max(1, Math.min(9, e.amount ?? 7)));
    else if (e.type === "extinguish") {
      this.voice(
        e,
        1.2,
        (out, n, t) => {
          this.hiss(out, n, t, 1.0, 5200, 0.3, "highpass", 0.6, 0.02);
          this.tone(out, n, t, 0.2, 400, 150, 0.12);
        },
        { wet: 0.25, reach: 60 },
      );
    } else if (e.type === "kill") {
      this.voice(
        e,
        0.6,
        (out, n, t) => {
          this.tone(out, n, t + 0.32, 0.14, 95, 48, 0.32);
          this.hiss(out, n, t + 0.32, 0.12, 500, 0.22, "lowpass");
          this.click(out, n, t + 0.38, 0.08, 2600);
        },
        { wet: 0.1, reach: 45 },
      );
      if (e.actor === this.self && e.victim !== this.self) this.marker(e);
    } else if (e.type === "blind") {
      const length = Math.max(0.3, Math.min(5, e.amount ?? 1));
      this.voice({ type: "blind" }, length, (out, n, t) =>
        this.tone(out, n, t, length, 2350, 2060, 0.08),
      );
      const cutoff = this.lowPass!.frequency,
        t = this.ctx.currentTime;
      cutoff.cancelScheduledValues(t);
      cutoff.setValueAtTime(800, t);
      cutoff.exponentialRampToValueAtTime(18000, t + length);
    } else if (e.type === "beep" || e.type === "plant") {
      this.voice(e, 0.19, (out, n, t) =>
        this.tone(
          out,
          n,
          t,
          0.13,
          e.type === "beep" ? 1520 : 980,
          e.type === "beep" ? 1520 : 1470,
          0.22,
        ),
      );
    } else if (e.type === "hit" && e.actor === this.self && e.victim !== this.self)
      this.marker(e);
    else if (e.type === "hit" && e.victim === this.self) this.hurt(e);
    else if (e.type === "pickup")
      this.voice(
        e,
        0.3,
        (out, n, t) => {
          this.click(out, n, t, 0.16, 2100);
          this.hiss(out, n, t + 0.04, 0.12, 1100, 0.08, "bandpass", 0.8, 0.02);
          this.click(out, n, t + 0.16, 0.1, 3200);
        },
        { wet: 0.06, reach: 25 },
      );
    else if (e.type === "slash")
      this.voice(
        e,
        0.45,
        (out, n, t) => {
          // Whoosh, then flesh thud or a steel clink on walls.
          const air = this.hiss(
            out,
            n,
            t,
            e.head ? 0.26 : 0.18,
            900,
            0.32,
            "bandpass",
            0.7,
            0.04,
          );
          air.frequency.setValueAtTime(600, t);
          air.frequency.exponentialRampToValueAtTime(2600, t + 0.15);
          if (e.message === "hit" || e.message === "backstab") {
            this.tone(
              out,
              n,
              t + 0.06,
              0.12,
              140,
              60,
              e.message === "backstab" ? 0.5 : 0.35,
            );
            this.hiss(out, n, t + 0.06, 0.1, 700, 0.3, "lowpass");
          } else if (e.message === "wall") {
            this.tone(out, n, t + 0.05, 0.18, 3400, 3200, 0.08, "triangle");
            this.click(out, n, t + 0.05, 0.2, 4200);
          }
        },
        { wet: 0.12, reach: 35 },
      );
    else if (e.type === "mode")
      this.voice(
        { type: "ui" },
        0.15,
        (out, n, t) => {
          this.click(out, n, t, 0.16, 2600);
          this.click(out, n, t + 0.06, 0.12, 1900);
        },
        { wet: 0 },
      );
    else if (e.type === "roundEnd" || e.type === "live" || e.type === "ui") {
      this.voice(
        e,
        0.27,
        (out, n, t) => {
          this.tone(out, n, t, 0.1, 520, 690, 0.075);
          if (e.type !== "ui")
            this.tone(out, n, t + 0.12, 0.13, 700, 940, 0.065);
        },
        { wet: 0 },
      );
    }
  }
  /** A point `d` metres from the ear toward `p`, so a sound reads as coming from that way. */
  private toward(p: Vec3, d: number) {
    const dx = p.x - this.ear.x,
      dy = p.y - this.ear.y,
      dz = p.z - this.ear.z,
      len = Math.hypot(dx, dy, dz) || 1;
    return {
      x: this.ear.x + (dx / len) * d,
      y: this.ear.y + (dy / len) * d,
      z: this.ear.z + (dz / len) * d,
    };
  }
  /**
   * Taking a hit: a dull body impact (a sharp ring off the head), panned toward the shooter
   * so you can tell where it came from.
   */
  private hurt(e: SimEvent) {
    const from = e.pos ? { type: "hurt", pos: this.toward(e.pos, 1.4) } : { type: "ui" },
      hard = Math.min(1, (e.amount ?? 20) / 60);
    this.voice(
      from,
      0.45,
      (out, n, t) => {
        if (e.head) {
          this.hiss(out, n, t, 0.03, 4200, 0.32, "highpass", 0.7, 0.0006);
          this.tone(out, n, t, 0.22, 2350, 2200, 0.07, "triangle");
          this.tone(out, n, t, 0.09, 160, 70, 0.3);
        } else {
          this.tone(out, n, t, 0.12, 120, 52, 0.22 + 0.2 * hard);
          this.hiss(out, n, t, 0.09, 650, 0.2 + 0.15 * hard, "lowpass", 0.8, 0.002);
        }
        // The breath knocked out of you.
        this.hiss(out, n, t + 0.05, 0.22, 900, 0.05 + 0.05 * hard, "bandpass", 0.9, 0.04);
      },
      { wet: 0.02, reach: 10 },
    );
  }
  /**
   * A round passing close by: the supersonic crack where it came nearest, and a short whiz,
   * placed at that point so you hear which side it went past and roughly where it came from.
   */
  private nearMiss(e: SimEvent) {
    if (!e.pos || !e.end || e.actor === this.self) return;
    const a = e.pos,
      b = e.end,
      dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z,
      len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1) return;
    const k = Math.max(0, Math.min(1, ((this.ear.x - a.x) * dx + (this.ear.y - a.y) * dy + (this.ear.z - a.z) * dz) / len2)),
      c = { x: a.x + dx * k, y: a.y + dy * k, z: a.z + dz * k },
      miss = Math.hypot(c.x - this.ear.x, c.y - this.ear.y, c.z - this.ear.z),
      flown = Math.sqrt(len2) * k;
    // Only rounds that pass within a few metres, past the shooter's own muzzle.
    if (miss > 3 || flown < 4 || k >= 1) return;
    const close = 1 - miss / 3,
      now = this.ctx?.currentTime ?? 0;
    // A shotgun's pellets arrive together: one crack for the volley.
    if (now - this.lastWhiz < 0.04) return;
    this.lastWhiz = now;
    this.voice(
      { type: "whiz", pos: this.toward(c, Math.max(0.7, miss)) },
      0.3,
      (out, n, t) => {
        this.hiss(out, n, t, 0.012, 6000, 0.12 + 0.3 * close, "highpass", 0.7, 0.0005);
        const w = this.hiss(out, n, t + 0.004, 0.14, 2800, 0.05 + 0.1 * close, "bandpass", 3, 0.01);
        w.frequency.setValueAtTime(3400, t + 0.004);
        w.frequency.exponentialRampToValueAtTime(900, t + 0.14);
      },
      { wet: 0.04, reach: 10 },
    );
  }
  private marker(e: SimEvent) {
    this.voice(
      { type: "ui" },
      0.3,
      (out, n, t) => {
        if (e.head) {
          this.tone(out, n, t, 0.18, 2900, 2750, 0.12, "triangle");
          this.tone(out, n, t, 0.12, 4350, 4200, 0.05);
        } else this.tone(out, n, t, 0.07, 1050, 550, 0.13, "triangle");
        if (e.type === "kill") this.tone(out, n, t + 0.08, 0.1, 870, 1190, 0.1);
      },
      { wet: 0 },
    );
  }
  dispose() {
    for (const node of this.sources)
      try {
        node.stop();
      } catch {}
    this.sources.clear();
    this.master?.disconnect();
    this.lowPass?.disconnect();
    this.reverb?.disconnect();
    if (this.ctx && this.ctx.state !== "closed")
      void this.ctx.close().catch(() => {});
    this.ctx = this.master = this.lowPass = this.noise = this.reverb = null;
    this.obstructions.clear();
  }
}
