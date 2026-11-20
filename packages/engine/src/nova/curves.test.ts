// The firmware-derived curves: shape, ends, and a few points checked against seconds that
// tools/firmware/fit-curves.ts derives from single swept words with the DSP's own rule.
import { describe, expect, it } from "vitest";
import * as C from "./curves.ts";
import * as F from "../fx/curves.ts";
import { LFO_SYNC_BEATS } from "./lfo.ts";

const near = (a: number, b: number, rel: number): void => expect(Math.abs(a / b - 1)).toBeLessThanOrEqual(rel);
const rising = (f: (v: number) => number): void => {
  for (let v = 1; v <= 127; v++) expect(f(v)).toBeGreaterThanOrEqual(f(v - 1));
};

describe("filter frequency (firmware X:$3E7)", () => {
  it("rises one semitone per step and holds from 111", () => {
    rising(C.filterHz);
    near(C.filterHz(76) / C.filterHz(64), 2, 1e-9);
    expect(C.filterHz(127)).toBe(C.filterHz(111));
    expect(C.filterHz(110)).toBeLessThan(C.filterHz(111));
  });
  it("puts 64 at the emulated resonant peak (≈1.65 kHz) and 0 near 41 Hz", () => {
    near(C.filterHz(64), 1650, 0.01);
    near(C.filterHz(0), 40.9, 0.01);
  });
});

describe("envelope times (firmware tables)", () => {
  const stages = ["attack", "decay", "release"] as const;
  it("rise with the value for every envelope and stage", () => {
    for (const s of stages) for (const e of [1, 2, 3] as const) rising((v) => C.envelopeSeconds(v, s, e));
  });
  it("env 1 reads the shared tables at its offsets (attack +33, decay +47, release +20; env 3 release −1)", () => {
    for (let v = 0; v + 47 <= 127; v++) {
      expect(C.envelopeSeconds(v, "attack", 1)).toBe(C.envelopeSeconds(v + 33, "attack", 2));
      expect(C.envelopeSeconds(v, "decay", 1)).toBe(C.envelopeSeconds(v + 47, "decay", 2));
      expect(C.envelopeSeconds(v, "release", 1)).toBe(C.envelopeSeconds(v + 20, "release", 2));
      expect(C.envelopeSeconds(v + 1, "release", 3)).toBe(C.envelopeSeconds(v, "release", 2));
    }
  });
  it("keeps env 1's 22 ms attack floor and the 22 s / 44 s tops", () => {
    near(C.envelopeSeconds(0, "attack", 1), 0.02226, 0.03);   // 33 blocks
    expect(C.envelopeSeconds(0, "attack", 2)).toBeLessThan(0.001);
    near(C.envelopeSeconds(127, "attack", 2), 22.19, 0.01);
    near(C.envelopeSeconds(127, "release", 2), 43.75, 0.02);
    near(C.envelopeSeconds(127, "decay", 2), 43.7, 0.05);
  });
  it("matches a few swept words within the fit's error", () => {
    near(C.envelopeSeconds(64, "attack", 2), 0.2036, 0.05);
    near(C.envelopeSeconds(32, "release", 2), 0.04525, 0.05);
    near(C.envelopeSeconds(64, "release", 2), 0.4872, 0.05);
    near(C.envelopeSeconds(64, "decay", 3), 0.4517, 0.05);
  });
  it("leaves the env 3 delay on its guess when no stage is given", () => {
    expect(C.envelopeSeconds(0)).toBeCloseTo(0.0005, 6);
  });
});

describe("portamento (firmware glide P:$5C0)", () => {
  it("is off at 0, rises, and is the same for 1–19", () => {
    expect(C.portamentoSeconds(0)).toBe(0);
    rising(C.portamentoSeconds);
    expect(C.portamentoSeconds(1)).toBe(C.portamentoSeconds(19));
  });
  it("matches the DSP glide's octave settle time at 64 (24 blocks) and 127", () => {
    near(C.portamentoSeconds(64), 0.016, 0.05);
    near(C.portamentoSeconds(127), 0.8407, 0.05);
  });
});

describe("patch FX curves (firmware)", () => {
  it("EQ mid centre and treble corner rise over their measured ranges", () => {
    rising(F.eqMidHz);
    rising(F.eqTrebleHz);
    near(F.eqMidHz(0), 517, 0.01);
    near(F.eqMidHz(127), 2258, 0.01);
    near(F.eqTrebleHz(0), 1158, 0.01);
    near(F.eqTrebleHz(127), 4944, 0.01);
  });
  it("chorus rate is quadratic in the value, ≈5.1 Hz at 127", () => {
    expect(F.chorusRateHz(0)).toBe(0);
    near(F.chorusRateHz(64) / F.chorusRateHz(32), 4, 1e-9);
    near(F.chorusRateHz(127), 5.1222, 1e-3);
  });
  it("chorus sync uses the LFO's note-length ladder", () => {
    expect(F.CHORUS_SYNC_BEATS).toBe(LFO_SYNC_BEATS);
    expect(F.chorusRate(0, 10, 120)).toBeCloseTo(2, 9);   // one beat at 120 bpm
  });
});
