import type { SimEvent } from "./sim/Sim";
import type { Vec3 } from "./world";

const shotVoices: Record<string, [number, number, number, number]> = {
  ak: [132, 2650, 0.155, 0.4],
  m4: [152, 1070, 0.096, 0.2],
  glock: [211, 3100, 0.082, 0.22],
  deagle: [108, 2220, 0.22, 0.43],
  awp: [82, 3050, 0.35, 0.52],
  negev: [110, 1900, 0.13, 0.33],
};
/** Spatial voices are built from a reusable noise buffer and short oscillator envelopes. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lowPass: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private level = 0.65;
  private ear: Vec3 = { x: 0, y: 0, z: 0 };
  private sources = new Set<AudioScheduledSourceNode>();
  private obstructions = new Map<number, { time: number; blocked: boolean }>();
  constructor(public occluded?: (listener: Vec3, source: Vec3) => boolean) {}
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
        limiter.threshold.value = -11;
        limiter.ratio.value = 8;
        this.lowPass
          .connect(limiter)
          .connect(this.master)
          .connect(ctx.destination);
        const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate),
          data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noise = buffer;
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
  private voice(
    e: SimEvent,
    duration: number,
    make: (input: AudioNode, nodes: AudioNode[], start: number) => void,
  ) {
    const ctx = this.ctx;
    if (
      !ctx ||
      !this.lowPass ||
      !this.noise ||
      ctx.state !== "running" ||
      this.sources.size > 70 ||
      this.level <= 0
    )
      return;
    const nodes: AudioNode[] = [],
      start = ctx.currentTime;
    let output: AudioNode = this.lowPass;
    if (
      e.pos &&
      Math.hypot(
        e.pos.x - this.ear.x,
        e.pos.y - this.ear.y,
        e.pos.z - this.ear.z,
      ) > 0.5
    ) {
      const p = e.pos,
        range = Math.hypot(
          p.x - this.ear.x,
          p.y - this.ear.y,
          p.z - this.ear.z,
        );
      if (range > 105) return;
      const pan = ctx.createPanner();
      pan.panningModel = "HRTF";
      pan.distanceModel = "inverse";
      pan.refDistance = 4;
      pan.maxDistance = 105;
      pan.rolloffFactor = 1.45;
      pan.positionX.value = p.x;
      pan.positionY.value = p.y;
      pan.positionZ.value = p.z;
      pan.connect(output);
      output = pan;
      nodes.push(pan);
      const tag = e.actor ?? -1,
        cached = this.obstructions.get(tag);
      let blocked = false;
      if (this.occluded) {
        if (cached && start - cached.time < 0.1) blocked = cached.blocked;
        else {
          blocked = this.occluded(this.ear, p);
          this.obstructions.set(tag, { time: start, blocked });
        }
      }
      if (blocked) {
        const wall = ctx.createBiquadFilter();
        wall.type = "lowpass";
        wall.frequency.value = 740;
        wall.Q.value = 0.6;
        wall.connect(output);
        output = wall;
        nodes.push(wall);
      }
    }
    make(output, nodes, start);
    // A silent timer node releases the whole graph after delayed transients have finished.
    const timer = ctx.createConstantSource(),
      mute = ctx.createGain();
    mute.gain.value = 0;
    timer.connect(mute).connect(output);
    this.sources.add(timer);
    timer.onended = () => {
      timer.disconnect();
      mute.disconnect();
      for (const n of nodes) n.disconnect();
      this.sources.delete(timer);
    };
    timer.start(start);
    timer.stop(start + duration + 0.1);
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
    o.frequency.exponentialRampToValueAtTime(end, t + length);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + length + 0.005);
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
  ) {
    const ctx = this.ctx!,
      s = ctx.createBufferSource(),
      g = ctx.createGain(),
      f = ctx.createBiquadFilter();
    s.buffer = this.noise;
    s.loop = true;
    f.type = filter;
    f.frequency.value = hz;
    f.Q.value = 0.8;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.6);
    s.stop(t + length);
    nodes.push(s, g, f);
  }
  play(e: SimEvent) {
    if (!this.ctx || !this.master) return;
    if (e.type === "shot") {
      const [hz, cut, len, level] =
        shotVoices[e.weapon ?? "glock"] ?? shotVoices.glock;
      this.voice(e, len, (out, n, t) => {
        this.hiss(out, n, t, len, cut, level * 0.92);
        this.tone(out, n, t, len * 0.85, hz, 38, level * 0.9);
        this.hiss(
          out,
          n,
          t + 0.014,
          0.045,
          cut * 1.4,
          level * 0.42,
          "bandpass",
        );
      });
    } else if (e.type === "step") {
      this.voice(e, 0.085, (out, n, t) => {
        this.hiss(
          out,
          n,
          t,
          0.075,
          e.message === "metal" ? 3300 : 1150,
          0.19,
          "bandpass",
        );
        this.tone(out, n, t, 0.055, 105, 55, 0.09);
      });
    } else if (e.type === "reload") {
      this.voice(e, 0.93, (out, n, t) => {
        for (const delay of [0, 0.23, 0.77]) {
          this.hiss(out, n, t + delay, 0.09, 3500, 0.23, "bandpass");
          this.tone(out, n, t + delay, 0.043, 850, 280, 0.085, "triangle");
        }
      });
    } else if (e.type === "bounce") {
      this.voice(e, 0.12, (out, n, t) =>
        this.tone(out, n, t, 0.11, 1070, 610, 0.13, "triangle"),
      );
    } else if (e.type === "explosion") {
      const bomb = e.actor === undefined;
      this.voice(e, bomb ? 1.1 : 0.64, (out, n, t) => {
        this.hiss(out, n, t, bomb ? 0.95 : 0.62, 1780, 0.72);
        this.tone(out, n, t, bomb ? 0.89 : 0.55, 111, 27, 0.85);
        this.hiss(out, n, t + 0.085, 0.45, 380, 0.5);
      });
    } else if (e.type === "flash") {
      this.voice(e, 0.49, (out, n, t) => {
        this.hiss(out, n, t, 0.3, 7700, 0.58);
        this.tone(out, n, t, 0.14, 240, 59, 0.4);
      });
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
    } else if (
      (e.type === "hit" || e.type === "kill") &&
      e.actor === 0 &&
      e.victim !== 0
    ) {
      this.voice(e, 0.22, (out, n, t) => {
        this.tone(
          out,
          n,
          t,
          0.07,
          e.head ? 1830 : 1050,
          e.head ? 1370 : 550,
          0.13,
          "triangle",
        );
        if (e.type === "kill") this.tone(out, n, t + 0.08, 0.1, 870, 1190, 0.1);
      });
    } else if (e.type === "roundEnd" || e.type === "live" || e.type === "ui") {
      this.voice(e, 0.27, (out, n, t) => {
        this.tone(out, n, t, 0.1, 520, 690, 0.075);
        if (e.type !== "ui") this.tone(out, n, t + 0.12, 0.13, 700, 940, 0.065);
      });
    }
  }
  dispose() {
    for (const node of this.sources)
      try {
        node.stop();
      } catch {}
    this.sources.clear();
    this.master?.disconnect();
    this.lowPass?.disconnect();
    if (this.ctx && this.ctx.state !== "closed")
      void this.ctx.close().catch(() => {});
    this.ctx = this.master = this.lowPass = this.noise = null;
    this.obstructions.clear();
  }
}
