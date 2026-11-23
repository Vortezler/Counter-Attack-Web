/**
 * Background soundscapes for the freight yard, jungle ruins and steel works maps, synthesized
 * with the Web Audio API: a continuous bed (wind, insects, machinery) plus occasional distant
 * one-shots (birds, coupler clanks, horns, metal strikes, steam).
 *
 * It runs on its own small AudioContext so it never competes with gameplay voices for the
 * main mix's limiter, and follows the master volume each frame.
 */
export interface Ambience {
  update(volume: number): void;
  stop(): void;
}
type Kind = "jungle" | "yard" | "works";
const kinds: Record<string, Kind> = { canopy: "jungle", switchyard: "yard", foundry: "works" };

export function startAmbience(mapId: string): Ambience | null {
  const kind = kinds[mapId];
  if (!kind || typeof AudioContext === "undefined") return null;
  let ctx: AudioContext | null = null,
    out: GainNode | null = null,
    echo: AudioNode | null = null,
    noise: AudioBuffer | null = null,
    stopped = false;
  const next: Record<string, number> = {};
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  function setup() {
    try {
      ctx = new AudioContext();
    } catch {
      stopped = true;
      return;
    }
    const c = ctx;
    out = c.createGain();
    out.gain.value = 0;
    out.connect(c.destination);
    // A long, dark echo for distant sounds.
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.27;
    const fb = c.createGain();
    fb.gain.value = 0.32;
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 1400;
    delay.connect(tone).connect(fb).connect(delay);
    tone.connect(out);
    echo = delay;
    noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    if (kind === "jungle") {
      bed("bandpass", 4600, 9, 0.05, 23, 0.7);
      bed("bandpass", 6300, 12, 0.03, 31, 0.8);
      bed("lowpass", 900, 0.7, 0.05, 0.11, 0.6);
      bed("bandpass", 2900, 14, 0.012, 7, 0.9);
    } else if (kind === "yard") {
      bed("lowpass", 520, 0.7, 0.07, 0.07, 0.7);
      bed("lowpass", 140, 0.7, 0.09, 0.03, 0.3);
      bed("bandpass", 1800, 3, 0.006, 0.2, 0.8);
    } else {
      bed("bandpass", 420, 0.8, 0.05, 0.09, 0.4);
      bed("lowpass", 160, 0.7, 0.07, 0.05, 0.3);
      for (const [f, g] of [
        [55, 0.022],
        [110, 0.012],
        [165, 0.006],
      ]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 260;
        const gain = c.createGain();
        gain.gain.value = g;
        o.connect(lp).connect(gain).connect(out);
        o.start();
      }
    }
  }
  /** Filtered noise with a slow (or fast, for insects) swell. */
  function bed(type: BiquadFilterType, f: number, q: number, level: number, rate: number, depth: number) {
    const c = ctx!,
      src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.loopStart = Math.random();
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = q;
    const gain = c.createGain();
    gain.gain.value = level * (1 - depth / 2);
    const lfo = c.createOscillator();
    lfo.frequency.value = rate;
    const amount = c.createGain();
    amount.gain.value = (level * depth) / 2;
    lfo.connect(amount).connect(gain.gain);
    src.connect(filter).connect(gain).connect(out!);
    src.start(0, Math.random() * 2);
    lfo.start();
  }
  /** A panned voice routed dry and into the echo. */
  function voice(pan: number, wet: number) {
    const c = ctx!,
      p = c.createStereoPanner();
    p.pan.value = pan;
    p.connect(out!);
    const send = c.createGain();
    send.gain.value = wet;
    p.connect(send).connect(echo!);
    return p;
  }
  function tone(type: OscillatorType, at: number, f0: number, f1: number, dur: number, level: number, dest: AudioNode) {
    const c = ctx!,
      o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.05);
  }
  function burst(at: number, type: BiquadFilterType, f: number, q: number, dur: number, level: number, dest: AudioNode, attack = 0.004) {
    const c = ctx!,
      src = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      g = c.createGain();
    src.buffer = noise;
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = q;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(g).connect(dest);
    src.start(at, Math.random() * 2);
    src.stop(at + dur + 0.05);
  }
  /** Struck metal: a click of noise and a few inharmonic, slowly decaying partials. */
  function strike(at: number, base: number, level: number, dest: AudioNode) {
    burst(at, "bandpass", base * 6, 1.5, 0.08, level, dest);
    for (const [k, d] of [
      [1, 1.4],
      [2.41, 1.0],
      [4.43, 0.7],
      [7.1, 0.45],
    ])
      tone("sine", at, base * k, base * k * 0.995, d, level / (k * 0.9), dest);
  }
  function events() {
    const c = ctx!,
      now = c.currentTime;
    const due = (key: string, a: number, b: number) => {
      if (next[key] === undefined) next[key] = now + rand(a * 0.3, b * 0.6);
      if (now < next[key]) return false;
      next[key] = now + rand(a, b);
      return true;
    };
    if (kind === "jungle") {
      if (due("bird", 2, 7)) {
        const v = voice(rand(-0.9, 0.9), 0.25),
          f = rand(1800, 3800),
          notes = 2 + Math.floor(rand(0, 4));
        for (let i = 0; i < notes; i++)
          tone("sine", now + i * rand(0.09, 0.16), f * rand(0.9, 1.15), f * rand(1.1, 1.5), rand(0.06, 0.12), 0.05, v);
      }
      if (due("call", 9, 22)) {
        const v = voice(rand(-1, 1), 0.5),
          f = rand(600, 900);
        tone("triangle", now, f, f * 1.6, 0.35, 0.03, v);
        tone("triangle", now + 0.42, f * 1.5, f * 0.9, 0.5, 0.025, v);
      }
      if (due("drip", 1.5, 5)) tone("sine", now, rand(1300, 2200), rand(700, 1000), 0.09, 0.025, voice(rand(-0.6, 0.6), 0.4));
      if (due("frog", 6, 16)) {
        const v = voice(rand(-0.8, 0.8), 0.2);
        for (let i = 0; i < 3; i++) tone("square", now + i * 0.22, 120, 90, 0.12, 0.012, v);
      }
    } else if (kind === "yard") {
      if (due("clank", 8, 20)) {
        const v = voice(rand(-1, 1), 0.6);
        strike(now, rand(160, 240), 0.05, v);
        strike(now + rand(0.15, 0.4), rand(180, 260), 0.035, v);
      }
      if (due("horn", 35, 70)) {
        const v = voice(rand(-1, 1), 0.9),
          len = rand(1.4, 2.6);
        for (const f of [311, 370, 466]) tone("sawtooth", now, f, f * 0.99, len, 0.008, v);
      }
      if (due("squeal", 25, 50)) {
        const c2 = ctx!,
          o = c2.createOscillator(),
          g = c2.createGain(),
          lfo = c2.createOscillator(),
          depth = c2.createGain();
        o.frequency.value = rand(2600, 3400);
        lfo.frequency.value = 7;
        depth.gain.value = 40;
        lfo.connect(depth).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.008, now + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 2);
        o.connect(g).connect(voice(rand(-1, 1), 0.8));
        o.start(now);
        lfo.start(now);
        o.stop(now + 2.1);
        lfo.stop(now + 2.1);
      }
      if (due("gust", 10, 24)) burst(now, "lowpass", rand(500, 900), 0.7, rand(2, 4), 0.06, voice(rand(-0.5, 0.5), 0), 1.2);
    } else {
      if (due("clang", 6, 14)) strike(now, rand(110, 200), 0.06, voice(rand(-1, 1), 0.55));
      if (due("steam", 12, 26)) burst(now, "highpass", 3200, 0.7, rand(1.2, 2.4), 0.03, voice(rand(-1, 1), 0.3), 0.15);
      if (due("hammer", 14, 30)) {
        const v = voice(rand(-1, 1), 0.7);
        for (let i = 0; i < 4 + Math.floor(rand(0, 4)); i++) {
          tone("sine", now + i * 0.55, 70, 45, 0.25, 0.07, v);
          burst(now + i * 0.55, "bandpass", 900, 2, 0.06, 0.03, v);
        }
      }
      if (due("beep", 20, 45)) {
        const v = voice(rand(-1, 1), 0.4);
        for (let i = 0; i < 4; i++) tone("square", now + i * 0.5, 1020, 1020, 0.25, 0.008, v);
      }
    }
  }
  return {
    update(volume) {
      if (stopped) return;
      if (!ctx) setup();
      if (!ctx || !out) return;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      if (ctx.state !== "running") return;
      out.gain.setTargetAtTime(Math.max(0, volume) * 0.55, ctx.currentTime, 0.4);
      events();
    },
    stop() {
      stopped = true;
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
