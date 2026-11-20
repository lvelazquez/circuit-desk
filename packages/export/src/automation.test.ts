import { describe, expect, it } from "vitest";
import * as N from "@circuit-desk/ncs";
import { blankProject } from "../../ncs/src/testing.ts";
import { arrange } from "./arrange.ts";
import { readSmf } from "./smf-read.ts";
import { writeSmf } from "./smf.ts";

/** Sets lane `lane` (0-based) of note pattern `i` of note track `t` at step `s` (0-based), micro-step `u`. */
function point(b: Uint8Array, t: number, i: number, lane: number, s: number, u: number, v: number): void {
  b[N.notePatternOffset(t, i) + N.LANE0 + lane * N.LANE + s * 6 + u] = v;
}

describe("automation", () => {
  it("names lanes from the firmware table", () => {
    expect(N.laneInfo("synth", 1).name).toBe("Macro 1");
    expect(N.laneInfo("midi", 3)).toEqual({ lane: 3, name: "Knob 3 (CC 5 on the default template)", defaultCc: 5 });
    expect(N.laneInfo("midi", 12).name).toBe("Pan");
    expect(N.laneInfo("drum", 5).name).toBe("Level");
  });

  it("sends MIDI-track knob lanes as CC, only on changes, timed by micro-step", () => {
    const b = blankProject();
    point(b, 2, 0, 0, 0, 0, 10);
    point(b, 2, 0, 0, 0, 3, 10); // same value: not sent again
    point(b, 2, 0, 0, 1, 3, 90);
    point(b, 2, 0, 7, 2, 0, 64); // knob 8 = CC 74
    point(b, 0, 0, 0, 0, 0, 50); // Synth 1 macro 1: CC 80 on channel 1
    const a = arrange(N.openProject(b));
    expect(a.tracks[2]!.ccs).toEqual([{ tick: 0, cc: 1, value: 10 }, { tick: 120 + 60, cc: 1, value: 90 }, { tick: 240, cc: 74, value: 64 }]);
    expect(a.tracks[0]!.ccs).toEqual([]);
    expect(a.warnings.join("\n")).toMatch(/default MIDI template/);
    const r = readSmf(writeSmf(a));
    expect(r.tracks.map((t) => t.name)).toEqual(expect.arrayContaining(["Synth 1", "MIDI 1"]));
    const midi1 = r.tracks.findIndex((t) => t.name === "MIDI 1"), synth1 = r.tracks.findIndex((t) => t.name === "Synth 1");
    expect(r.ccs.filter((c) => c.track === midi1)).toEqual([
      { track: midi1, channel: 2, tick: 0, cc: 1, value: 10 }, { track: midi1, channel: 2, tick: 180, cc: 1, value: 90 }, { track: midi1, channel: 2, tick: 240, cc: 74, value: 64 },
    ]);
    expect(r.ccs.filter((c) => c.track === synth1)).toEqual([{ track: synth1, channel: 0, tick: 0, cc: 80, value: 50 }]);
  });

  it("uses the template's CCs when given, and leaves automation out with null", () => {
    const b = blankProject();
    point(b, 3, 0, 1, 0, 0, 33);
    expect(arrange(N.openProject(b), { templateCcs: [20, 21, 22, 23, 24, 25, 26, 27] }).tracks[3]!.ccs).toEqual([{ tick: 0, cc: 21, value: 33 }]);
    expect(arrange(N.openProject(b), { templateCcs: null }).tracks[3]!.ccs).toEqual([]);
  });
});
