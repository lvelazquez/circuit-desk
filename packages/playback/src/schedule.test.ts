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
    expect(s.pump(0)).toEqual([{ at: 0, bytes: [0xb2, 1, 40] }]);
  });

  it("hands out messages ahead of time, with exact timestamps", () => {
    const s = new Schedule(project(), { lookahead: 50 });
    expect(s.play(1000)).toEqual([]);
    expect(s.pump(1000)).toEqual([{ at: 1000, bytes: [0x90, 60, 100] }]);
    expect(s.pump(1000)).toEqual([]);
    const later = s.pump(1000 + 120 * msPerTick);
    expect(later).toEqual([{ at: 1000 + 120 * msPerTick, bytes: [0x80, 60, 0] }]);
    const drum = s.pump(1000 + 480 * msPerTick);
    expect(drum[0]).toEqual({ at: 1000 + 480 * msPerTick, bytes: [0x99, 60, 90] });
  });

  it("loops, and reports the position and each track's step", () => {
    const a = project();
    const s = new Schedule(a, { lookahead: 10 });
    s.play(0);
    const loop = a.length * msPerTick;
    s.pump(loop - 20);
    expect(s.pump(loop)).toContainEqual({ at: loop, bytes: [0x90, 60, 100] });
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

  it("sends clock, start and stop when asked, and skips muted tracks", () => {
    const s = new Schedule(project(), { clock: true, lookahead: 1, muted: new Set([4]) });
    expect(s.play(0)).toEqual([{ at: 0, bytes: [0xfa] }]);
    const first = s.pump(0).map((m) => m.bytes);
    expect(first).toEqual([[0xf8], [0x90, 60, 100]]);
    const all = s.pump(10_000).map((m) => m.bytes[0]);
    expect(all).not.toContain(0x99);
    expect(s.stop(10_000).at(-1)?.bytes).toEqual([0xfc]);
  });
});
