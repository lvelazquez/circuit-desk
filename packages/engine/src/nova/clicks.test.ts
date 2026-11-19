// Click checks: a sine voice has no jumps of its own, so a sample-to-sample jump at a note event
// that is much bigger than the sine's own steepest step is a click. Each case was a real click
// (found 2026-11-19 with the same measure): retriggers, voice stealing, mono note changes and
// zero-time envelope stages restarted or cut the waveform mid-cycle.
import { describe, expect, it } from "vitest";
import { NovaSynth, type NovaEvent } from "./synth.ts";
import { defaultValues } from "./voice.ts";

const SR = 48_000;
const AT = 9_600; // the event under test, 0.2 s in

function render(changes: Record<string, number>, events: NovaEvent[], seconds = 0.4): Float32Array {
  const s = new NovaSynth(SR, { ...defaultValues(), "osc1.wave": 0, ...changes });
  for (const e of events) s.schedule(e);
  const out = new Float32Array(Math.round(seconds * SR));
  for (let f = 0; f < out.length; f += 128) s.process(out.subarray(f, Math.min(out.length, f + 128)));
  return out;
}

/** Largest |x[i] − x[i−1]| over [a, b). */
function jump(x: Float32Array, a: number, b: number): number {
  let m = 0;
  for (let i = Math.max(1, a); i < Math.min(x.length, b); i++) m = Math.max(m, Math.abs(x[i]! - x[i - 1]!));
  return m;
}

/**
 * The event's biggest jump, against the steady sound before and after it (a higher note after the
 * event has steeper slopes of its own; a click is steeper than both).
 */
function clickRatio(x: Float32Array): number {
  const steady = Math.max(jump(x, AT - 4_800, AT - 10), jump(x, AT + 2_400, AT + 7_200));
  return jump(x, AT - 10, AT + 480) / Math.max(steady, 1e-6);
}

const on = (frame: number, note: number): NovaEvent => ({ frame, type: "on", note, velocity: 100 });
const off = (frame: number, note: number): NovaEvent => ({ frame, type: "off", note });
// A step 1.5 × the sine's own steepest is still smooth; the clicks measured 7–26 ×.
const SMOOTH = 1.5;

describe("no clicks at note events", () => {
  it("retriggering a sounding note", () => {
    expect(clickRatio(render({}, [on(0, 60), on(AT, 60)]))).toBeLessThan(SMOOTH);
  });

  it("stealing a voice for a 7th note", () => {
    const chord = [0, 1, 2, 3, 4, 5].map((i) => on(0, 48 + 2 * i));
    expect(clickRatio(render({ "env1.release": 60 }, [...chord, on(AT, 80)]))).toBeLessThan(SMOOTH);
  });

  it("changing note in Mono", () => {
    expect(clickRatio(render({ "voice.polyphony": 0 }, [on(0, 60), on(AT, 67)]))).toBeLessThan(SMOOTH);
  });

  it("a release of 0", () => {
    expect(clickRatio(render({ "env1.release": 0 }, [on(0, 60), off(AT, 60)]))).toBeLessThan(SMOOTH);
  });

  it("an attack of 0 and a decay of 0", () => {
    const x = render({ "env1.attack": 0, "env1.decay": 0, "env1.sustain": 30 }, [on(AT, 60)]);
    // No steady sound before the note: compare with the sine's steepest step at full level.
    const sine = render({}, [on(0, 60)]);
    expect(jump(x, AT - 10, AT + 480) / jump(sine, 4_800, 9_000)).toBeLessThan(SMOOTH);
  });

  it("silencing (all notes off) fades instead of cutting", () => {
    expect(clickRatio(render({}, [on(0, 60), { frame: AT, type: "silence" }]))).toBeLessThan(SMOOTH);
  });
});
