// The wavetable and LFO table paths with synthetic tables (no Novation data in the repo), plus one
// pass over the real tables when tools/components-tables.ts has saved them (skipped without them).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Lfo, MELODIC_SEMITONE, MELODIC_SPAN } from "./lfo.ts";
import {
  FRAME_LEN, LFO_LEN, LFO_WAVES, WAVETABLE_COUNT, WAVETABLE_FRAMES, lfoTableValue, novaTablesLoaded,
  setNovaTables, tableBytesFromDoc, wavetableFrames, wavetableSample, type NovaTableBytes,
} from "./tables.ts";
import { NovaSynth } from "./synth.ts";
import { defaultValues, oscSample, type OscParams } from "./voice.ts";

/** Frame f of every wave is a sine at harmonic f + 1; LFO wave w is a ramp, the melodic ones 12 steps. */
function synthetic(): NovaTableBytes {
  const wavetables = new Uint8Array(WAVETABLE_COUNT * WAVETABLE_FRAMES * FRAME_LEN);
  for (let w = 0; w < WAVETABLE_COUNT; w++)
    for (let f = 0; f < WAVETABLE_FRAMES; f++)
      for (let i = 0; i < FRAME_LEN; i++)
        wavetables[(w * WAVETABLE_FRAMES + f) * FRAME_LEN + i] = Math.round(128 + 100 * Math.sin((2 * Math.PI * (f + 1) * i) / FRAME_LEN));
  const lfo = new Uint8Array(LFO_WAVES * LFO_LEN);
  for (let w = 0; w < LFO_WAVES; w++)
    for (let i = 0; i < LFO_LEN; i++)
      lfo[w * LFO_LEN + i] = w >= 22 ? Math.round((Math.floor((i * 12) / LFO_LEN) * 254) / 11) : Math.round((i * 255) / (LFO_LEN - 1));
  return { wavetables, lfo };
}

const osc = (wave: number, index: number, interpolate: number): OscParams => ({ wave, index, interpolate, transpose: 0, level: 1 });

/** Correlation of one cycle of `f` with harmonic `h` (amplitude of that harmonic). */
function harmonic(f: (phase: number) => number, h: number): number {
  let s = 0, c = 0;
  const n = 512;
  for (let i = 0; i < n; i++) { const x = f(i / n); s += x * Math.sin((2 * Math.PI * h * i) / n); c += x * Math.cos((2 * Math.PI * h * i) / n); }
  return (2 / n) * Math.hypot(s, c);
}

afterEach(() => setNovaTables(null));

describe("Components wavetables", () => {
  it("refuses tables of the wrong size", () => {
    const t = synthetic();
    expect(() => setNovaTables({ ...t, lfo: t.lfo.subarray(1) })).toThrow(/LFO tables/);
    expect(() => setNovaTables({ ...t, wavetables: new Uint8Array(10) })).toThrow(/wavetables/);
    expect(novaTablesLoaded()).toBe(false);
  });

  it("places the index over frames 0–8 as Components' editor does", () => {
    expect(wavetableFrames(63, 127)).toEqual({ a: 4, b: 5, w: 0 }); // stored 63: position exactly 4
    expect(wavetableFrames(127, 127)).toMatchObject({ a: 8, b: 8 });
    expect(wavetableFrames(0, 127).a).toBe(0);
    const mid = 63 + 8; // halfway between frames 4 and 5
    expect(wavetableFrames(mid, 127).w).toBeCloseTo(0.5, 5);
    expect(wavetableFrames(mid, 0).w).toBe(0); // interpolate 0 steps
    expect(wavetableFrames(mid - 4, 127).w).toBeCloseTo(0.25, 5); // 127: linear
    expect(wavetableFrames(mid - 4, 64).w).toBeLessThan(0.25); // lower: an S curve
  });

  it("plays the frame the index picks, and stands in again once the tables are dropped", () => {
    setNovaTables(synthetic());
    const lowDt = 1 / 4800;
    const f = (index: number) => (ph: number) => oscSample(osc(20, index, 0), ph, lowDt);
    expect(harmonic(f(63), 5)).toBeGreaterThan(0.7); // frame 4 → harmonic 5
    expect(harmonic(f(63), 1)).toBeLessThan(0.02);
    expect(harmonic(f(0), 1)).toBeGreaterThan(0.7);
    setNovaTables(null);
    expect(oscSample(osc(14, 64, 0), 0.25, lowDt)).toBeCloseTo(1, 5); // Sine Table stand-in: a sine
  });

  it("band-limits: a harmonic above Nyquist is left out at high pitch", () => {
    setNovaTables(synthetic());
    const at = (dt: number) => (ph: number) => wavetableSample(20, 63, 0, ph, dt)!;
    expect(harmonic(at(1 / 4800), 5)).toBeGreaterThan(0.7);
    expect(harmonic(at(0.15), 5)).toBeLessThan(0.02); // 0.5 / 0.15 → at most 3 harmonics
  });

  it("lets the matrix's Osc PW destination move the wavetable index", () => {
    setNovaTables(synthetic());
    const v = defaultValues();
    Object.assign(v, { "osc1.wave": 20, "osc1.pulseWidth": 0, "osc1.waveInterpolate": 0, "mixer.osc1": 127, "filter.frequency": 127, "fx.chorusLevel": 0, "fx.distortionLevel": 0 });
    const render = (depth: number): Float32Array => {
      const s = new NovaSynth(48_000, { ...v, "mod1.source1": 0, "mod1.depth": depth, "mod1.destination": 5 });
      s.schedule({ frame: 0, type: "on", note: 45, velocity: 127 });
      const out = new Float32Array(4864);
      for (let at = 0; at < out.length; at += 128) s.process(out.subarray(at, at + 128));
      return out;
    };
    const still = render(64), moved = render(127);
    let diff = 0;
    for (let i = 2400; i < 4800; i++) diff += Math.abs(still[i]! - moved[i]!);
    expect(diff / 2400).toBeGreaterThan(0.01);
  });
});

describe("Components LFO tables", () => {
  it("reads shapes 6–21 from the table and keeps the formulas for 0–5", () => {
    setNovaTables(synthetic());
    const lfo = new Lfo();
    expect(lfo.shape(9, 0)).toBeCloseTo(-1, 2);
    expect(lfo.shape(9, 0.999)).toBeCloseTo(lfoTableValue(9, 0.999)!, 6);
    expect(lfo.shape(0, 0.25)).toBeCloseTo(1, 6); // sine stays a formula
  });

  it("turns a melodic table's levels into semitones over the shape's span", () => {
    setNovaTables(synthetic());
    const lfo = new Lfo();
    // The synthetic shape climbs 12 steps to its top; Chromatic's span is 11.
    expect(MELODIC_SPAN).toHaveLength(16);
    expect(lfo.shape(22, 0)).toBe(0);
    expect(lfo.shape(22, 0.99)).toBeCloseTo(MELODIC_SPAN[0]! * MELODIC_SEMITONE, 6);
  });
});

const DIR = process.env["CIRCUIT_DESK_COMPONENTS"] ?? join(homedir(), "Circuit Desk", "Components-derived");
const newest = existsSync(DIR)
  ? readdirSync(DIR).filter((d) => existsSync(join(DIR, d, "circuit-tables.json"))).sort().pop()
  : undefined;
const real = newest ? tableBytesFromDoc(JSON.parse(readFileSync(join(DIR, newest, "circuit-tables.json"), "utf8"))) : null;

describe.skipIf(!real)("the saved Components tables", () => {
  it("load, and every wavetable and LFO shape stays in range", () => {
    setNovaTables(real);
    for (let w = 14; w <= 29; w++)
      for (const index of [0, 40, 64, 100, 127])
        for (let i = 0; i < 128; i++) expect(Math.abs(oscSample(osc(w, index, 127), i / 128, 1 / 960)), `wave ${w}`).toBeLessThan(1.5);
    // Sine Table's first frame is a sine.
    expect(harmonic((ph) => oscSample(osc(14, 0, 0), ph, 1 / 960), 1)).toBeGreaterThan(0.9);
    const lfo = new Lfo();
    for (let w = 0; w < LFO_WAVES; w++)
      for (let i = 0; i < 50; i++) expect(Number.isFinite(lfo.shape(w, i / 50)), `LFO ${w}`).toBe(true);
  });
});
