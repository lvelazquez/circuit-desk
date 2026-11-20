import { describe, expect, it } from "vitest";
import type { SoundSettings } from "@circuit-desk/ncs";
import * as C from "./curves.ts";
import { Chorus, Distortion, Reverb, SidechainEnv, StereoDelay, TiltEq } from "./effects.ts";
import { ProjectMixer } from "./mixer.ts";
import { PatchFx } from "./patch.ts";
import { knobAt } from "../sampler.ts";
import { NovaSynth } from "../nova/synth.ts";
import { defaultValues } from "../nova/voice.ts";

const SR = 48_000;

describe("exact parts", () => {
  it("pan law: a balance with both sides full at the centre", () => {
    expect(C.panGains(64)).toEqual([1, 1]);
    expect(C.panGains(0)).toEqual([1, 0]);
    expect(C.panGains(127)).toEqual([0, 1]);
    expect(C.panGains(32)).toEqual([1, 0.5]);
  });

  it("drum pitch ratio: 0.25 at 0, 1 at 64, 444/256 at 127", () => {
    expect(C.drumPitchRatio(0)).toBe(0.25);
    expect(C.drumPitchRatio(64)).toBe(1);
    expect(C.drumPitchRatio(127)).toBe(444 / 256);
  });

  it("drum tilt EQ: full right cuts lows to 1/64 and doubles the top; full left does the opposite", () => {
    const run = (g: number, x: (i: number) => number): number => {
      const eq = new TiltEq(SR);
      let y = 0;
      for (let i = 0; i < 20000; i++) y = eq.process(x(i), g);
      return y;
    };
    const right = C.drumTilt(127), left = C.drumTilt(0);
    expect(run(right, () => 1)).toBeCloseTo(1 - right, 6);                  // DC
    expect(Math.abs(run(right, (i) => (i % 2 ? 1 : -1)))).toBeGreaterThan(1.9); // Nyquist ≈ 1 + g
    expect(run(left, () => 1)).toBeCloseTo(2, 6);
  });

  it("delay L/R ratios follow the reference table", () => {
    expect(C.DELAY_RATIO_GAINS).toHaveLength(13);
    expect(C.DELAY_RATIO_GAINS[1]).toEqual([1, 0.75]);   // 4:3
    expect(C.DELAY_RATIO_GAINS[11]).toEqual([1, 0]);     // 1:OFF
  });
});

describe("sidechain", () => {
  it("ducks by the depth after a trigger and comes back", () => {
    const e = new SidechainEnv(SR);
    e.set(5, 90, 75, 123);                                 // device preset 4
    e.trigger();
    let min = 1;
    for (let i = 0; i < SR * 0.1; i++) min = Math.min(min, e.next());
    expect(min).toBeCloseTo(1 - 123 / 127, 3);
    let g = 0;
    for (let i = 0; i < SR * 3; i++) g = e.next();
    expect(g).toBeGreaterThan(0.999);
  });

  it("does nothing at depth 0 (the OFF preset)", () => {
    const e = new SidechainEnv(SR);
    e.set(0, 50, 70, 0); e.trigger();
    for (let i = 0; i < 1000; i++) expect(e.next()).toBe(1);
  });
});

describe("delay", () => {
  const impulse = (d: StereoDelay, n: number): [Float32Array, Float32Array] => {
    const l = new Float32Array(n), r = new Float32Array(n), out: [number, number] = [0, 0];
    for (let i = 0; i < n; i++) { out[0] = 0; out[1] = 0; d.process(i === 0 ? 1 : 0, i === 0 ? 1 : 0, out); l[i] = out[0]; r[i] = out[1]; }
    return [l, r];
  };
  const peakAt = (x: Float32Array): number => x.reduce((best, v, i) => (Math.abs(v) > Math.abs(x[best]!) ? i : best), 0);

  it("a synced quarter note at 120 BPM echoes after 0.5 s, the right side at 3/4 with ratio 4:3", () => {
    const d = new StereoDelay(SR);
    const quarter = C.SYNC_BEATS.indexOf(1);
    d.set({ time: 64, sync: quarter, feedback: 0, width: 127, ratio: 1, slew: 0 }, 120);
    const [l, r] = impulse(d, SR);
    expect(Math.abs(peakAt(l) - SR * 0.5)).toBeLessThanOrEqual(2);
    expect(Math.abs(peakAt(r) - SR * 0.375)).toBeLessThanOrEqual(2);
  });

  it("feedback repeats the echo, quieter each time", () => {
    const d = new StereoDelay(SR);
    d.set({ time: 0, sync: 0, feedback: 64, width: 127, ratio: 0, slew: 0 }, 120);
    const [l] = impulse(d, SR);
    const t = Math.round(C.delayFreeSeconds(0) * SR);
    expect(Math.abs(l[t]! + l[t + 1]!)).toBeGreaterThan(0.9);
    expect(Math.abs(l[2 * t]! + l[2 * t + 1]!)).toBeCloseTo(0.5, 1);
  });
});

describe("reverb", () => {
  it("has a tail that dies away", () => {
    const rv = new Reverb(SR);
    rv.set(2, 64, 64);
    const out: [number, number] = [0, 0];
    const win = SR * 0.2, energy: number[] = [];
    for (let w = 0; w < 8; w++) {
      let e = 0;
      for (let i = 0; i < win; i++) { out[0] = 0; out[1] = 0; rv.process(w === 0 && i === 0 ? 1 : 0, 0, out); e += out[0] ** 2 + out[1] ** 2; }
      energy.push(e);
    }
    expect(energy[0]!).toBeGreaterThan(0);
    for (let w = 2; w < energy.length; w++) expect(energy[w]!).toBeLessThan(energy[w - 1]!);
  });
});

describe("patch effects", () => {
  it("with the defaults (no distortion, flat EQ, no chorus) the voices pass through unchanged", () => {
    const fx = new PatchFx(SR);
    fx.setValues({});
    const mono = Float32Array.from({ length: 256 }, (_, i) => Math.sin(i / 7));
    const l = new Float32Array(256), r = new Float32Array(256);
    fx.process(mono, l, r);
    expect(Array.from(l)).toEqual(Array.from(mono));
    expect(Array.from(r)).toEqual(Array.from(mono));
  });

  it("distortion level 0 is off; the clipper stays bounded", () => {
    const d = new Distortion();
    d.set(2, 0, 100);
    expect(d.process(0.3)).toBe(0.3);
    d.set(2, 127, 0);
    for (const x of [-2, -0.5, 0.5, 2]) expect(Math.abs(d.process(x))).toBeLessThanOrEqual(1);
  });

  it("the chorus makes left and right differ", () => {
    const c = new Chorus(SR);
    c.set({ type: 1, level: 127, rate: 60, sync: 0, feedback: 64, depth: 100, delay: 64 }, 120);
    const out: [number, number] = [0, 0];
    let diff = 0;
    for (let i = 0; i < SR / 2; i++) { c.process(Math.sin((2 * Math.PI * 220 * i) / SR), out); diff += Math.abs(out[0] - out[1]); }
    expect(diff / (SR / 2)).toBeGreaterThan(0.01);
  });
});

describe("project mixer", () => {
  const sound = (over: Partial<SoundSettings> = {}): SoundSettings => ({
    reverb: { type: 2, decay: 64, damping: 64, sends: [0, 0, 0, 0, 0, 0, 0, 0] },
    delay: { time: 64, sync: 0, feedback: 0, width: 127, ratio: 0, slew: 5, sends: [0, 0, 0, 0, 0, 0, 0, 0] },
    fxBypass: false,
    sidechains: [0, 1, 2, 3].map(() => ({ source: 4, attack: 0, hold: 50, decay: 70, depth: 0 })),
    levels: [127, 127, 127, 127], pans: [64, 64, 64, 64],
    drums: [0, 1, 2, 3].map((d) => ({ sample: d, level: 127, pitch: 64, decay: 127, distortion: 0, eq: 64, pan: 64 })),
    ...over,
  });
  const tone = (n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 5) * 0.5);
  const strips = (t: number, x: Float32Array): (Float32Array[] | undefined)[] => Array.from({ length: 8 }, (_, k) => (k === t ? [x, x] : undefined));

  it("passes everything through at unity until it has settings, and when switched off", () => {
    const m = new ProjectMixer(SR);
    const x = tone(128), l = new Float32Array(128), r = new Float32Array(128);
    m.process(strips(0, x), l, r, 0, 128);
    expect(Array.from(l)).toEqual(Array.from(x));
    m.set(sound({ levels: [0, 0, 0, 0] }), 120);
    m.enabled = false;
    m.process(strips(0, x), l, r, 128, 128);
    expect(Array.from(r)).toEqual(Array.from(x));
  });

  it("applies level and the pan law", () => {
    const m = new ProjectMixer(SR);
    m.set(sound({ levels: [127, 127, 127, 127], pans: [0, 64, 64, 64] }), 120);
    const x = tone(64), l = new Float32Array(64), r = new Float32Array(64);
    m.process(strips(0, x), l, r, 0, 64);
    expect(l[10]).toBeCloseTo(x[10]!, 6);
    expect(r[10]).toBe(0);
  });

  it("a reverb send leaves a tail after the sound stops", () => {
    const m = new ProjectMixer(SR);
    m.set(sound({ reverb: { type: 2, decay: 90, damping: 30, sends: [127, 0, 0, 0, 0, 0, 0, 0] } }), 120);
    const n = SR / 4, x = tone(n), l = new Float32Array(n), r = new Float32Array(n);
    m.process(strips(0, x), l, r, 0, n);
    m.process(strips(0, new Float32Array(n)), l, r, n, n);
    expect(Math.max(...Array.from(l).map(Math.abs))).toBeGreaterThan(0.001);
  });

  it("a drum hit ducks the sidechained synth", () => {
    const m = new ProjectMixer(SR);
    const sc = [{ source: 0, attack: 5, hold: 90, decay: 75, depth: 123 }, ...[1, 2, 3].map(() => ({ source: 4, attack: 0, hold: 50, decay: 70, depth: 0 }))];
    m.set(sound({ sidechains: sc }), 120);
    const n = 4800, x = Float32Array.from({ length: n }, () => 0.5), l = new Float32Array(n), r = new Float32Array(n);
    m.trigger(1000, 0);
    m.process(strips(0, x), l, r, 0, n);
    expect(l[500]).toBeCloseTo(0.5, 6);                     // before the hit
    expect(Math.min(...Array.from(l.subarray(1000)))).toBeLessThan(0.05);
  });
});

describe("automation in the preview", () => {
  const base = (): SoundSettings => ({
    reverb: { type: 2, decay: 64, damping: 64, sends: [0, 0, 0, 0, 0, 0, 0, 0] },
    delay: { time: 64, sync: 0, feedback: 0, width: 127, ratio: 0, slew: 5, sends: [0, 0, 0, 0, 0, 0, 0, 0] },
    fxBypass: false,
    sidechains: [0, 1, 2, 3].map(() => ({ source: 4, attack: 0, hold: 50, decay: 70, depth: 0 })),
    levels: [127, 127, 127, 127], pans: [64, 64, 64, 64],
    drums: [0, 1, 2, 3].map((d) => ({ sample: d, level: 127, pitch: 64, decay: 127, distortion: 0, eq: 64, pan: 64 })),
  });
  const ones = (n: number): Float32Array => Float32Array.from({ length: n }, () => 1);

  it("a level lane change takes effect at its frame, gliding over a few milliseconds", () => {
    const m = new ProjectMixer(SR);
    m.set(base(), 120);
    m.automate(1000, 0, "level", 0);
    const n = 2000, l = new Float32Array(n), r = new Float32Array(n);
    m.process([[ones(n), ones(n)]], l, r, 0, n);
    expect(l[999]).toBeCloseTo(1, 6);
    expect(l[1010]!).toBeLessThan(1);
    expect(l[1999]!).toBeLessThan(0.05);           // about four 5 ms time constants later
  });

  it("a pan lane change moves the balance", () => {
    const m = new ProjectMixer(SR);
    m.set(base(), 120);
    m.automate(0, 4, "pan", 127);
    const n = 3000, l = new Float32Array(n), r = new Float32Array(n);
    m.process([undefined, undefined, undefined, undefined, [ones(n), ones(n)]], l, r, 0, n);
    expect(l[n - 1]!).toBeLessThan(0.01);
    expect(r[n - 1]!).toBeCloseTo(1, 3);
  });

  it("clear drops pending automation", () => {
    const m = new ProjectMixer(SR);
    m.set(base(), 120);
    m.automate(100, 0, "level", 0);
    m.clear();
    const l = new Float32Array(500), r = new Float32Array(500);
    m.process([[ones(500), ones(500)]], l, r, 0, 500);
    expect(l[499]).toBeCloseTo(1, 6);
  });

  it("a drum knob change applies from its time on", () => {
    const changes = [{ time: 1, value: 10 }, { time: 2, value: 90 }];
    expect(knobAt(changes, 0.5, 64)).toBe(64);
    expect(knobAt(changes, 1, 64)).toBe(10);
    expect(knobAt(changes, 5, 64)).toBe(90);
  });

  it("a macro lane moves the patch: a filter macro opens a closed filter from its frame on", () => {
    // Init patch with the filter closed and macro 1 → filter frequency (stored destination 21), full depth.
    const values = { ...defaultValues(), "filter.frequency": 0, "macro1.a.destination": 21, "macro1.a.depth": 127, "macro1.position": 0 };
    const brightness = (withMacro: boolean): number => {
      const s = new NovaSynth(SR, values);
      s.schedule({ frame: 0, type: "on", note: 48, velocity: 100 });
      if (withMacro) s.schedule({ frame: 0, type: "macro", index: 0, value: 127 });
      const out = new Float32Array(SR / 4);
      s.process(out);
      let d = 0;
      for (let i = 1; i < out.length; i++) d += Math.abs(out[i]! - out[i - 1]!);
      return d;
    };
    expect(brightness(true)).toBeGreaterThan(brightness(false) * 3);
  });
});
