import { describe, expect, it } from "vitest";
import { FADE_IN, GATE_OUT, LFO_SYNC_BEATS, Lfo, fadeGain, type LfoParams } from "./lfo.ts";
import { NovaSynth } from "./synth.ts";
import { defaultValues } from "./voice.ts";

const SR = 48_000;
/** One cycle per beat at 120 bpm: 2 Hz. */
const base: LfoParams = {
  wave: 0, phase: 0, slew: 0, rate: 68, syncSeconds: 0.5, delay: 0,
  oneShot: false, keySync: true, commonSync: false, legatoDelay: false, fade: FADE_IN,
};

describe("LFO", () => {
  it("has the 36 sync values, one beat at index 10", () => {
    expect(LFO_SYNC_BEATS).toHaveLength(36);
    expect(LFO_SYNC_BEATS[10]).toBe(1);
  });

  it("runs a synced sine from its phase offset", () => {
    const l = new Lfo();
    l.trigger({ ...base, phase: 0.25 }, false);
    expect(l.phase).toBe(0.25);
    l.advance(base, Lfo.hz(base), 0.125); // a quarter cycle on
    expect(l.value).toBeCloseTo(0, 6); // sin at 0.5 cycle
  });

  it("keeps running through notes without key sync", () => {
    const p = { ...base, keySync: false };
    const l = new Lfo();
    l.advance(p, Lfo.hz(p), 0.1);
    const at = l.phase;
    l.trigger(p, false);
    expect(l.phase).toBe(at);
  });

  it("plays one cycle in one-shot mode and stays at its start point", () => {
    const p = { ...base, wave: 2, oneShot: true }; // saw: 1 at phase 0
    const l = new Lfo();
    l.trigger(p, false);
    for (let k = 0; k < 10; k++) l.advance(p, Lfo.hz(p), 0.1);
    expect(l.phase).toBe(0);
    expect(l.value).toBe(1);
  });

  it("stops at rate 0 and holds where it is", () => {
    const p = { ...base, syncSeconds: 0, rate: 0 };
    const l = new Lfo();
    l.trigger({ ...p, phase: 0.1 }, false);
    l.advance(p, Lfo.hz(p), 1);
    expect(l.phase).toBe(0.1);
  });

  it("fades in over the delay, and gate out cuts at its end", () => {
    expect(fadeGain(FADE_IN, 2, 1)).toBe(0.5);
    expect(fadeGain(GATE_OUT, 2, 1)).toBe(1);
    expect(fadeGain(GATE_OUT, 2, 2)).toBe(0);
    expect(fadeGain(GATE_OUT, 0, 5)).toBe(1); // no delay: the LFO passes
  });

  it("restarts the fade on each note unless the delay is legato", () => {
    const p = { ...base, delay: 1 };
    const l = new Lfo();
    l.trigger(p, false);
    l.advance(p, Lfo.hz(p), 0.9);
    l.trigger({ ...p, legatoDelay: true }, true);
    l.advance(p, Lfo.hz(p), 0.2); // 1.1 s after the first note: fully faded in, as the legato note did not restart it
    const legatoGain = Math.abs(l.value / l.shape(0, l.phase));
    expect(legatoGain).toBeCloseTo(1, 6);
  });

  it("slews a square so it no longer reaches full level", () => {
    const p = { ...base, wave: 3, slew: 1, syncSeconds: 0.01 };
    const l = new Lfo();
    l.trigger(p, false);
    let peak = 0;
    for (let k = 0; k < 2000; k++) peak = Math.max(peak, Math.abs(l.advance(p, Lfo.hz(p), 32 / SR)));
    expect(peak).toBeLessThan(0.9);
  });

  it("drives the mod matrix: a square LFO 1 + on Osc 1 level gates the sound", () => {
    const v = defaultValues();
    v["mixer.osc1"] = 0;
    v["mixer.osc2"] = 0;
    v["lfo1.wave"] = 3; v["lfo1.rateSync"] = 10; v["lfo1.flags"] = 2; // square, one beat, key sync
    v["mod1.source1"] = 6; v["mod1.source2"] = 0; v["mod1.depth"] = 127; v["mod1.destination"] = 7;
    const s = new NovaSynth(SR, v);
    s.setBpm(120);
    s.schedule({ frame: 0, type: "on", note: 60, velocity: 127 });
    const out = new Float32Array(SR);
    for (let at = 0; at < out.length; at += 128) s.process(out.subarray(at, at + 128));
    const rms = (from: number, to: number): number => {
      let x = 0;
      for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) x += out[i]! ** 2;
      return Math.sqrt(x / ((to - from) * SR));
    };
    // 2 Hz square: high for 0–0.25 s, low for 0.25–0.5 s.
    expect(rms(0.05, 0.2)).toBeGreaterThan(0.01);
    expect(rms(0.3, 0.45)).toBeLessThan(rms(0.05, 0.2) / 20);
  });
});
