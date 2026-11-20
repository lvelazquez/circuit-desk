import { describe, expect, it } from "vitest";
import { encodeWav } from "@circuit-desk/engine";
import { analyseNote, analyseRecording, detectOnsets, estimatePitch, findDropouts, hzToMidi, sentNotes } from "./recording.ts";
import { concatChunks, mono, readWav } from "./wav.ts";

const SR = 48_000;
const sine = (hz: number, s: number, amp = 0.5): Float32Array => Float32Array.from({ length: Math.round(s * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const saw = (hz: number, s: number, amp = 0.5): Float32Array => Float32Array.from({ length: Math.round(s * SR) }, (_, i) => amp * (2 * ((hz * i / SR) % 1) - 1));
/** Deterministic low noise, so the floor is not digital silence. */
function noise(n: number, amp = 0.001): Float32Array {
  let s = 1;
  return Float32Array.from({ length: n }, () => { s = (s * 16807) % 2147483647; return amp * ((s / 2147483647) * 2 - 1); });
}
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

describe("pitch", () => {
  it.each([[440, "A4"], [110, "A2"], [hz(36), "C2"], [hz(84), "C6"]])("finds a %f Hz sine", (f, name) => {
    const p = estimatePitch(sine(f, 0.2), SR)!;
    expect(Math.abs(1200 * Math.log2(p.hz / f))).toBeLessThan(2);
    expect(hzToMidi(p.hz).name).toBe(name);
  });

  it.each([55, 98, 261.63, 1046.5])("finds a %f Hz sawtooth (not an octave off)", (f) => {
    const p = estimatePitch(saw(f, 0.2), SR)!;
    expect(Math.abs(1200 * Math.log2(p.hz / f))).toBeLessThan(5);
  });

  it("reports cents off the nearest note", () => {
    const m = hzToMidi(440 * 2 ** (30 / 1200));
    expect(m.note).toBe(69);
    expect(m.cents).toBeCloseTo(30, 0);
    expect(hzToMidi(hz(60)).name).toBe("C4");
  });

  it("returns null on noise", () => {
    expect(estimatePitch(noise(9600, 0.5), SR)).toBeNull();
  });
});

describe("onsets and envelope", () => {
  it("finds each note of a sequence with gaps", () => {
    const parts = [noise(SR / 2), sine(220, 0.4), noise(SR / 2), saw(330, 0.4), noise(SR / 2), sine(660, 0.4), noise(SR / 2)];
    const x = concatChunks(parts);
    const on = detectOnsets(x, SR);
    expect(on.map((o) => o.start)).toEqual([0.5, 1.4, 2.3].map((t) => expect.closeTo(t, 1)));
    for (const [i, t] of [0.5, 1.4, 2.3].entries()) expect(Math.abs(on[i]!.start - t)).toBeLessThan(0.011);
    const r = analyseRecording(x, SR);
    expect(r.notes.map((n) => n.name)).toEqual(["A3", "E4", "E5"]);
    expect(r.noiseDb).toBeLessThan(-55);
  });

  it("measures a linear 20 ms attack (10→90 % = 16 ms) and an exponential decay", () => {
    const tau = 0.1; // −20 dB after tau·ln 10 = 230 ms
    const x = Float32Array.from({ length: SR }, (_, i) => {
      const t = i / SR, env = t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) / tau);
      return 0.8 * env * Math.sin(2 * Math.PI * 440 * t);
    });
    const n = analyseNote(x, SR, 0, 1);
    expect(n.attackMs).toBeGreaterThan(14.5);
    expect(n.attackMs).toBeLessThan(17.5);
    expect(n.decayMs).toBeGreaterThan(220);
    expect(n.decayMs).toBeLessThan(240);
    expect(n.peakDb).toBeCloseTo(20 * Math.log10(0.8), 0);
    expect(n.note).toBe(69);
  });

  it("uses the sent notes: latency, sustain level and release", () => {
    const x = concatChunks([noise(SR / 2), noise(480), sine(110, 0.5, 0.5), Float32Array.from(sine(110, 0.3, 0.5), (v, i) => v * Math.exp(-i / SR / 0.02)), noise(SR / 2)]);
    const sent = sentNotes([{ offset: 0.5, bytes: [0x90, 45, 100] }, { offset: 1.01, bytes: [0x80, 45, 0] }]);
    expect(sent).toEqual([{ on: 0.5, off: 1.01, channel: 0, note: 45, velocity: 100 }]);
    const r = analyseRecording(x, SR, sent);
    const n = r.notes[0]!;
    expect(n.latencyMs).toBeGreaterThan(5);
    expect(n.latencyMs).toBeLessThan(16);
    expect(n.name).toBe("A2");
    expect(n.sustainDb).toBeGreaterThan(-1);
    expect(n.releaseMs).toBeGreaterThan(35);
    expect(n.releaseMs).toBeLessThan(60);
  });
});

describe("modulation rate", () => {
  // The held part needs at least two periods (the autocorrelation looks up to half its length): 6 s here.
  it.each([0.5, 3, 12])("finds a %f Hz tremolo on a held note, and none on a steady one", (rate) => {
    const x = Float32Array.from({ length: 6 * SR }, (_, i) => (0.6 + 0.3 * Math.sin(2 * Math.PI * rate * i / SR)) * 0.5 * Math.sin(2 * Math.PI * 220 * i / SR));
    expect(analyseNote(x, SR, 0, 6).modHz).toBeCloseTo(rate, 1);
    expect(analyseNote(sine(220, 3), SR, 0, 3).modHz).toBeNull();
  });
});

describe("dropouts", () => {
  it("finds runs of exact zeros between sounds, not leading or trailing silence", () => {
    const x = concatChunks([new Float32Array(1000), sine(220, 0.1), new Float32Array(480), sine(220, 0.1), new Float32Array(30), sine(220, 0.1), new Float32Array(1000)]);
    const d = findDropouts(x, SR);
    expect(d.length).toBe(1);
    expect(d[0]!.ms).toBeCloseTo(10, 0);
    expect(d[0]!.at).toBeCloseTo((1000 + 4800) / SR, 2);
  });
});

describe("WAV round trip", () => {
  it("reads back what encodeWav writes, 16-bit stereo", () => {
    const l = sine(440, 0.01), r = saw(220, 0.01);
    const w = readWav(encodeWav([l, r], SR));
    expect(w.sampleRate).toBe(SR);
    expect(w.channels.length).toBe(2);
    for (let i = 0; i < l.length; i++) {
      expect(Math.abs(w.channels[0]![i]! - l[i]!)).toBeLessThan(1 / 16000);
      expect(Math.abs(w.channels[1]![i]! - r[i]!)).toBeLessThan(1 / 16000);
    }
    expect(mono(w.channels)[10]).toBeCloseTo((l[10]! + r[10]!) / 2, 3);
  });

  it("joins recorded blocks in order", () => {
    expect([...concatChunks([Float32Array.of(1, 2), Float32Array.of(), Float32Array.of(3)])]).toEqual([1, 2, 3]);
  });

  it("refuses what is not a WAV", () => {
    expect(() => readWav(new Uint8Array(20))).toThrow(/RIFF/);
  });
});
