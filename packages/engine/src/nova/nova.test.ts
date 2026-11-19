import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initPatch, parsePatch, initPatchBytes } from "@circuit-desk/patch";
import { NovaSynth } from "./synth.ts";
import { defaultValues, oscSample } from "./voice.ts";
import { Envelope, Svf, sawPulse } from "./dsp.ts";

const SR = 48_000;

function render(values: Record<string, number>, events: (s: NovaSynth) => void, seconds: number): Float32Array {
  const s = new NovaSynth(SR, values);
  events(s);
  const out = new Float32Array(Math.round(seconds * SR));
  // Render in device-sized and odd-sized chunks, as a worklet would (128) and as events split them.
  for (let at = 0; at < out.length; at += 128) s.process(out.subarray(at, Math.min(out.length, at + 128)));
  return out;
}

/** Positive-going zero crossings per second over [from, to) seconds. */
function frequency(x: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if (x[i - 1]! < 0 && x[i]! >= 0) n++;
  return n / (to - from);
}

function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! ** 2;
  return Math.sqrt(s / Math.max(1, to - from));
}

const values = (changes: Record<string, number> = {}): Record<string, number> => ({ ...defaultValues(), ...changes });

describe("Nova voice (slice)", () => {
  it("reads the guide's default patch from packages/patch", () => {
    expect(parsePatch(initPatchBytes()).values).toEqual(initPatch().values);
    expect(defaultValues()).toEqual(initPatch().values);
  });

  it("plays A4 at 440 Hz on the default patch (saw, open filter)", () => {
    const x = render(values(), (s) => s.schedule({ frame: 0, type: "on", note: 69, velocity: 100 }), 1.2);
    expect(frequency(x, 0.2, 1.2)).toBeCloseTo(440, -1);
    expect(rms(x)).toBeGreaterThan(0.01);
    expect(x.every((v) => Number.isFinite(v) && Math.abs(v) < 1)).toBe(true);
  });

  it("transposes by the oscillator semitones and the keyboard octave", () => {
    const up = render(values({ "osc1.semitones": 76 }), (s) => s.schedule({ frame: 0, type: "on", note: 57, velocity: 100 }), 1.2);
    expect(frequency(up, 0.2, 1.2)).toBeCloseTo(440, -1);
    const oct = render(values({ "voice.octave": 65 }), (s) => s.schedule({ frame: 0, type: "on", note: 57, velocity: 100 }), 1.2);
    expect(frequency(oct, 0.2, 1.2)).toBeCloseTo(440, -1);
  });

  it("starts a note on its exact frame", () => {
    const x = render(values({ "env1.attack": 0 }), (s) => s.schedule({ frame: 1000, type: "on", note: 60, velocity: 127 }), 0.1);
    expect(x.subarray(0, 1000).every((v) => v === 0)).toBe(true);
    expect(Math.max(...Array.from(x.subarray(1000, 1100), Math.abs))).toBeGreaterThan(0.01);
  });

  it("releases to silence after note off", () => {
    const x = render(values({ "env1.release": 20 }), (s) => {
      s.schedule({ frame: 0, type: "on", note: 60, velocity: 100 });
      s.schedule({ frame: SR / 2, type: "off", note: 60 });
    }, 2);
    expect(rms(x, 0, SR / 2)).toBeGreaterThan(0.01);
    expect(rms(x, Math.round(1.5 * SR))).toBe(0);
  });

  it("closing the low-pass filter removes most of a high note", () => {
    const on = (s: NovaSynth): void => s.schedule({ frame: 0, type: "on", note: 96, velocity: 100 });
    const open = rms(render(values(), on, 0.5), SR / 10);
    const closed = rms(render(values({ "filter.frequency": 20 }), on, 0.5), SR / 10);
    expect(closed).toBeLessThan(open * 0.1);
  });

  it("plays at most 6 voices and stays finite when stealing", () => {
    const x = render(values({ "env1.release": 60 }), (s) => {
      for (let i = 0; i < 9; i++) s.schedule({ frame: i * 100, type: "on", note: 48 + i * 3, velocity: 100 });
    }, 0.5);
    expect(x.every(Number.isFinite)).toBe(true);
  });

  it("mono plays only the latest key and returns to the held one", () => {
    const x = render(values({ "voice.polyphony": 0, "env1.attack": 0 }), (s) => {
      s.schedule({ frame: 0, type: "on", note: 57, velocity: 100 });
      s.schedule({ frame: SR, type: "on", note: 69, velocity: 100 });
      s.schedule({ frame: 2 * SR, type: "off", note: 69 });
    }, 3);
    expect(frequency(x, 0.2, 1)).toBeCloseTo(220, -1);
    expect(frequency(x, 1.2, 2)).toBeCloseTo(440, -1);
    expect(frequency(x, 2.2, 3)).toBeCloseTo(220, -1);
  });

  it("a Direct mod matrix source supplies an oscillator level the mixer leaves at 0", () => {
    const on = (s: NovaSynth): void => s.schedule({ frame: 0, type: "on", note: 60, velocity: 100 });
    const silent = values({ "mixer.osc1": 0 });
    expect(rms(render(silent, on, 0.3))).toBe(0);
    const direct = values({ "mixer.osc1": 0, "mod1.source1": 0, "mod1.depth": 127, "mod1.destination": 7 });
    expect(rms(render(direct, on, 0.3))).toBeGreaterThan(0.01);
  });

  it("Q normalise keeps a resonant patch's level in check", () => {
    const on = (s: NovaSynth): void => s.schedule({ frame: 0, type: "on", note: 48, velocity: 100 });
    const loud = rms(render(values({ "filter.frequency": 60, "filter.resonance": 127, "filter.qNormalise": 0 }), on, 0.5));
    const norm = rms(render(values({ "filter.frequency": 60, "filter.resonance": 127, "filter.qNormalise": 127 }), on, 0.5));
    expect(norm).toBeLessThan(loud / 4);
  });

  it("renders the same bytes every time (golden hash input)", () => {
    const go = (): string => {
      const x = render(values({ "mixer.noise": 40, "osc2.wave": 13, "mixer.osc2": 90, "filter.resonance": 70 }), (s) => {
        s.schedule({ frame: 0, type: "on", note: 60, velocity: 90 });
        s.schedule({ frame: 9000, type: "off", note: 60 });
      }, 0.5);
      return createHash("sha1").update(new Uint8Array(x.buffer)).digest("hex");
    };
    expect(go()).toBe(go());
  });
});

describe("DSP units", () => {
  it("the two-saw pulse has the requested duty and no DC", () => {
    let hi = 0, sum = 0;
    for (let i = 0; i < 1000; i++) { const v = sawPulse(i / 1000, 1e-6, 0.3); sum += v; if (v > 0) hi++; }
    expect(Math.abs(sum / 1000)).toBeLessThan(0.01);
    expect(hi / 1000).toBeCloseTo(0.3, 1);
  });

  it("every oscillator wave stays within ±1.5", () => {
    for (let w = 0; w < 30; w++) {
      for (let i = 0; i < 200; i++) {
        const v = oscSample({ wave: w, width: 0.5, morph: 0.5, transpose: 0, level: 1 }, i / 200, 0.01);
        expect(Math.abs(v), `wave ${w}`).toBeLessThan(1.5);
      }
    }
  });

  it("the filter passes DC in low-pass and blocks it in high-pass", () => {
    const lp = new Svf(), hp = new Svf();
    lp.set(1000, 0.707, SR); hp.set(1000, 0.707, SR);
    let a = 0, b = 0;
    for (let i = 0; i < 5000; i++) { a = lp.process(1, "low"); b = hp.process(1, "high"); }
    expect(a).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it("an envelope with a delay waits, then rises", () => {
    const e = new Envelope();
    e.configure(0.01, 0.01, 0.1, 0.5, 0.1, SR);
    e.gate(480);
    for (let i = 0; i < 479; i++) expect(e.next()).toBe(0);
    for (let i = 0; i < 482; i++) e.next();
    expect(e.value).toBe(1);
  });
});
