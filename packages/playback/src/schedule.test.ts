import { describe, expect, it } from "vitest";
import * as N from "@circuit-desk/ncs";
import { arrange } from "@circuit-desk/export";
import { blankProject } from "../../ncs/src/testing.ts";
import { playheads, Schedule } from "./schedule.ts";

function project(): ReturnType<typeof arrange> {
  const b = blankProject();
  b[N.TEMPO_AT] = 120; // 1 tick = 60000 / 120 / 480 ms
  const o = N.notePatternOffset(0, 0);
  b[o] = 1; b[o + 4] = 60; b[o + 5] = 6; b[o + 7] = 100; // step 1: C4, one step
  const d = N.drumPatternOffset(0, 0);
  b[d + 4] = 90; // Drum 1 step 5
  return arrange(N.openProject(b));
}

const msPerTick = 60_000 / 120 / 480;

describe("schedule", () => {
  it("plays MIDI-track automation as CC", () => {
    const b = blankProject();
    b[N.notePatternOffset(2, 0) + N.LANE0] = 40; // MIDI 1 knob 1, step 1
    const s = new Schedule(arrange(N.openProject(b)), { lookahead: 5 });
    s.play(0);
    expect(s.pump(0)).toEqual([{ at: 0, bytes: [0xb2, 1, 40], track: 2 }]);
  });

  it("plays synth and drum automation with the Circuit's CC, and MIDI 1/2 mix lanes for the preview only", () => {
    const b = blankProject();
    b[N.notePatternOffset(0, 0) + N.LANE0] = 64;                    // Synth 1 macro 1, step 1
    b[N.notePatternOffset(2, 0) + N.LANE0 + 192 * 11] = 20;          // MIDI 1 pan: no CC
    b[N.drumPatternOffset(2, 0) + N.DLANE0 + 192 * 3 + 6] = 100;     // Drum 3 EQ, step 2
    const s = new Schedule(arrange(N.openProject(b)), { lookahead: 200 });
    s.play(0);
    const msgs = s.pump(0);
    expect(msgs).toContainEqual({ at: 0, bytes: [0xb0, 80, 64], track: 0, auto: { target: "macro", index: 0, value: 64 } });
    expect(msgs).toContainEqual({ at: 0, bytes: [], track: 2, auto: { target: "pan", value: 20 } });
    expect(msgs).toContainEqual({ at: 120 * msPerTick, bytes: [0xb9, 49, 100], track: 6, auto: { target: "drumEq", value: 100 } });
  });

  it("hands out messages ahead of time, with exact timestamps", () => {
    const s = new Schedule(project(), { lookahead: 50 });
    expect(s.play(1000)).toEqual([]);
    expect(s.pump(1000)).toEqual([{ at: 1000, bytes: [0x90, 60, 100], track: 0 }]);
    expect(s.pump(1000)).toEqual([]);
    const later = s.pump(1000 + 120 * msPerTick);
    expect(later).toEqual([{ at: 1000 + 120 * msPerTick, bytes: [0x80, 60, 0], track: 0 }]);
    const drum = s.pump(1000 + 480 * msPerTick);
    expect(drum[0]).toEqual({ at: 1000 + 480 * msPerTick, bytes: [0x99, 60, 90], track: 4 });
  });

  it("loops, and reports the position and each track's step", () => {
    const a = project();
    const s = new Schedule(a, { lookahead: 10 });
    s.play(0);
    const loop = a.length * msPerTick;
    s.pump(loop - 20);
    expect(s.pump(loop)).toContainEqual({ at: loop, bytes: [0x90, 60, 100], track: 0 });
    expect(s.position(loop + 480 * msPerTick)).toBeCloseTo(480, 6);
    expect(playheads(a, 480)[0]).toEqual({ pattern: 1, step: 5 });
    expect(playheads(a, 480)[4]).toEqual({ pattern: 1, step: 5 });
  });

  it("stops every sounding note and sends All Notes Off", () => {
    const s = new Schedule(project(), { lookahead: 10 });
    s.play(0); s.pump(0);
    expect(s.stop(5)).toEqual([
      { at: 5, bytes: [0x80, 60, 0] },
      { at: 5, bytes: [0xb0, 123, 0] },
      { at: 5, bytes: [0xb9, 123, 0] },
    ]);
    expect(s.pump(10_000)).toEqual([]);
  });

  it("carries a drum step's sample flip", () => {
    const b = blankProject();
    const d = N.drumPatternOffset(1, 0);
    b[d] = 100; b[d + 64] = 12; // Drum 2 step 1 flips to sample 12
    const s = new Schedule(arrange(N.openProject(b)), { lookahead: 5 });
    s.play(0);
    expect(s.pump(0)).toEqual([{ at: 0, bytes: [0x99, 62, 100], track: 5, sample: 12 }]);
  });

  it("sends clock, start and stop when asked, and skips muted tracks", () => {
    const s = new Schedule(project(), { clock: true, lookahead: 1, muted: new Set([4]) });
    expect(s.play(0)).toEqual([{ at: 0, bytes: [0xfa] }]);
    const first = s.pump(0).map((m) => m.bytes);
    expect(first).toEqual([[0xf8], [0x90, 60, 100]]);
    const all = s.pump(10_000).map((m) => m.bytes[0]);
    expect(all).not.toContain(0x99);
    expect(s.stop(10_000).at(-1)?.bytes).toEqual([0xfc]);
  });

  it("rolls step probability again on each loop pass", () => {
    const b = blankProject();
    b[N.TEMPO_AT] = 120;
    const o = N.notePatternOffset(0, 0);
    b[o] = 1; b[o + 1] = 3; b[o + 4] = 60; b[o + 5] = 6; b[o + 7] = 100; // step 1: C4 at 50 %
    const a = arrange(N.openProject(b), { pattern: 1 });
    const rolls = [0.9, 0.1]; // pass 1: roll 7 > 3, silent; pass 2: roll 0, plays
    const s = new Schedule(a, { lookahead: 10, rng: () => rolls.shift() ?? 0 });
    s.play(0);
    const ons = (msgs: { bytes: number[] }[]): number => msgs.filter((m) => m.bytes[0] === 0x90).length;
    expect(ons(s.pump(0))).toBe(0);
    expect(ons(s.pump(s.lengthMs - 5))).toBe(1);
  });
});
