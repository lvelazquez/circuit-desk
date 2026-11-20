import { describe, expect, it } from "vitest";
import * as N from "@circuit-desk/ncs";
import { blankProject } from "../../ncs/src/testing.ts";
import { arrange, drumPatternNotes, notePatternNotes, patternAutomation, removeOverlaps } from "./arrange.ts";
import { readSmf } from "./smf-read.ts";
import { vlq, writeSmf } from "./smf.ts";

/** Sets note unit `u` of step `s` in note pattern `i` of note track `t`. */
function putNote(b: Uint8Array, t: number, i: number, s: number, u: number, note: number, gate: number, micro: number, vel: number): void {
  const o = N.notePatternOffset(t, i) + s * N.STEP;
  b[o] = (b[o] ?? 0) | (1 << u);
  const q = o + 4 + 4 * u;
  b[q] = note; b[q + 1] = gate; b[q + 2] = micro; b[q + 3] = vel;
}
function putHit(b: Uint8Array, d: number, i: number, s: number, vel: number, micro = 0): void {
  const o = N.drumPatternOffset(d, i);
  b[o + s] = vel; b[o + 96 + s] = micro;
}
const setChain = (b: Uint8Array, entry: number, first: number, last: number): void => { b[N.CHAIN0 + 4 * entry] = first; b[N.CHAIN0 + 4 * entry + 1] = last; };

describe("pattern notes", () => {
  it("times notes by step, micro-step and sync rate (1/16 = 120 ticks)", () => {
    const b = blankProject();
    putNote(b, 0, 0, 0, 0, 60, 6, 0, 100);
    putNote(b, 0, 0, 3, 1, 64, 3, 2, 80);
    const notes = notePatternNotes(N.readNotePattern(N.openProject(b), 0, 0));
    expect(notes).toEqual([
      { tick: 0, dur: 120, pitch: 60, velocity: 100 },
      { tick: 3 * 120 + 40, dur: 60, pitch: 64, velocity: 80 },
    ]);
  });

  it("plays only the steps from first to last, from the first", () => {
    const b = blankProject();
    putNote(b, 0, 0, 2, 0, 60, 6, 0, 100);
    putNote(b, 0, 0, 5, 0, 62, 6, 0, 100);
    const o = N.notePatternOffset(0, 0) + N.SETT;
    b[o] = 4; b[o + 1] = 2; // last step 5, first step 3
    const p = N.readNotePattern(N.openProject(b), 0, 0);
    expect(notePatternNotes(p).map((n) => [n.tick, n.pitch])).toEqual([[0, 60]]);
  });

  it("repeats a drum hit on each micro-step in its mask", () => {
    const b = blankProject();
    putHit(b, 0, 0, 1, 90, 0b000101);
    const notes = drumPatternNotes(N.readDrumPattern(N.openProject(b), 0, 0), 60);
    expect(notes.map((n) => n.tick)).toEqual([120, 160]);
  });

  it("never leaves two notes on one key sounding at once", () => {
    const out = removeOverlaps([{ tick: 0, dur: 500, pitch: 60, velocity: 1 }, { tick: 100, dur: 10, pitch: 60, velocity: 1 }, { tick: 100, dur: 50, pitch: 60, velocity: 9 }]);
    expect(out).toEqual([{ tick: 0, dur: 100, pitch: 60, velocity: 1 }, { tick: 100, dur: 50, pitch: 60, velocity: 9 }]);
  });
});

describe("arrangement", () => {
  it("loops a short chain inside a scene as long as the longest chain", () => {
    const b = blankProject();
    putNote(b, 0, 0, 0, 0, 60, 6, 0, 100);
    putNote(b, 0, 1, 0, 0, 62, 6, 0, 100);
    putHit(b, 0, 0, 0, 100);
    setChain(b, 1, 0, 1); // Synth 1: patterns 1–2
    const a = arrange(N.openProject(b), { source: "current" });
    expect(a.length).toBe(2 * 16 * 120);
    expect(a.tracks[0]!.plays.map((p) => p.pattern)).toEqual([0, 1]);
    expect(a.tracks[4]!.plays.map((p) => p.tick)).toEqual([0, 1920]);
    expect(a.tracks[4]!.notes.map((n) => n.tick)).toEqual([0, 1920]);
    expect(a.tracks[4]!.channel).toBe(9);
  });

  it("plays the saved scene chain in order", () => {
    const b = blankProject();
    putNote(b, 0, 2, 0, 0, 67, 6, 0, 100);
    for (const e of [0, 1]) b[N.SCENE0 + e * N.SCENE_SIZE + N.SCENE_SAVED] = 1;
    b[N.SCENE0 + 1 * N.SCENE_SIZE] = 2; b[N.SCENE0 + 1 * N.SCENE_SIZE + 1] = 2; // scene 2: Synth 1 plays pattern 3
    setChain(b, 0, 0, 1);
    const a = arrange(N.openProject(b));
    expect(a.scenes.map((s) => [s.scene, s.tick])).toEqual([[0, 0], [1, 1920]]);
    expect(a.tracks[0]!.notes).toEqual([{ tick: 1920, dur: 120, pitch: 67, velocity: 100 }]);
  });

  it("warns about what it does not apply", () => {
    const b = blankProject();
    b[N.SWING_AT] = 60;
    b[N.notePatternOffset(0, 0) + N.SETT + 3] = 1;
    const w = arrange(N.openProject(b)).warnings.join("\n");
    expect(w).toMatch(/swing 60/);
    expect(w).toMatch(/Synth 1 pattern 1/);
  });
});

describe("MIDI file", () => {
  it("encodes variable-length numbers", () => {
    expect(vlq(0)).toEqual([0]);
    expect(vlq(0x7f)).toEqual([0x7f]);
    expect(vlq(0x80)).toEqual([0x81, 0x00]);
    expect(vlq(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
  });

  it("reads back with the same notes, tempo, channels and scene markers", () => {
    const b = blankProject("Round trip");
    b[N.TEMPO_AT] = 96;
    putNote(b, 1, 0, 4, 0, 72, 12, 1, 110);
    putHit(b, 2, 0, 8, 70);
    const a = arrange(N.openProject(b));
    const r = readSmf(writeSmf(a));
    expect(r.problems).toEqual([]);
    expect(r.format).toBe(1);
    expect(r.tempos[0]!.bpm).toBeCloseTo(96, 3);
    expect(r.tracks.map((t) => t.name)).toEqual(["Round trip", "Synth 2", "Drum 3"]);
    expect(r.notes).toEqual([
      { track: 1, channel: 1, pitch: 72, velocity: 110, tick: 4 * 120 + 20, dur: 240 },
      { track: 2, channel: 9, pitch: 64, velocity: 70, tick: 8 * 120, dur: 30 },
    ]);
    expect(r.markers).toEqual([{ tick: 0, text: "Current chains" }]);
    expect(r.tracks.every((t) => t.endTick === a.length)).toBe(true);
  });
});

describe("stored values MIDI cannot carry", () => {
  it("leaves out a note stored above 127 and says so", () => {
    const b = blankProject();
    putNote(b, 0, 0, 0, 0, 128, 6, 0, 100);
    putNote(b, 0, 0, 1, 0, 60, 6, 0, 100);
    const a = arrange(N.openProject(b));
    expect(a.tracks[0]!.notes.map((n) => n.pitch)).toEqual([60]);
    expect(a.warnings.join("\n")).toMatch(/above 127: Synth 1 pattern 1 \(1\)/);
  });
});

describe("playing one scene or one pattern", () => {
  const project = (): Uint8Array => {
    const b = blankProject();
    putNote(b, 0, 0, 0, 0, 60, 6, 0, 100);   // Synth 1 pattern 1: C4
    putNote(b, 0, 1, 0, 0, 67, 6, 0, 100);   // Synth 1 pattern 2: G4
    putHit(b, 0, 0, 0, 100);                  // Drum 1 pattern 1
    putHit(b, 0, 1, 4, 90);                   // Drum 1 pattern 2
    return b;
  };
  const pitches = (a: ReturnType<typeof arrange>, t: number): number[] => a.tracks[t]!.notes.map((n) => n.pitch);

  it("plays the chosen pattern on every track, whatever the stored chains say", () => {
    const b = project();
    setChain(b, 1, 0, 0);                     // Synth 1's stored chain: pattern 1 only
    const a = arrange(N.openProject(b), { pattern: 2 });
    expect(pitches(a, 0)).toEqual([67]);
    expect(a.tracks[4]!.notes).toHaveLength(1);
    expect(a.tracks[4]!.notes[0]!.tick).toBe(4 * 120);
  });

  it("plays one scene with the chains stored in it, saved or not (with a warning when not)", () => {
    const b = project();
    const o = N.SCENE0 + 2 * N.SCENE_SIZE;     // scene 3: Synth 1 plays pattern 2
    b[o] = 1; b[o + 1] = 1;
    const a = arrange(N.openProject(b), { scene: 3 });
    expect(pitches(a, 0)).toEqual([67]);
    expect(a.warnings.join("\n")).toMatch(/scene 3 is not saved/);
    b[o + N.SCENE_SAVED] = 1;
    expect(arrange(N.openProject(b), { scene: 3 }).warnings.join("\n")).not.toMatch(/not saved/);
  });

  it("refuses numbers that do not exist, and both at once", () => {
    const p = N.openProject(project());
    expect(() => arrange(p, { scene: 0 })).toThrow(/scene must be 1–16/);
    expect(() => arrange(p, { pattern: 9 })).toThrow(/pattern must be 1–8/);
    expect(() => arrange(p, { scene: 1, pattern: 1 })).toThrow(/not both/);
  });
});

describe("automation lanes", () => {
  const notePoint = (b: Uint8Array, t: number, i: number, lane: number, step: number, micro: number, v: number): void => {
    b[N.notePatternOffset(t, i) + N.LANE0 + 192 * lane + step * 6 + micro] = v;
  };
  const drumPoint = (b: Uint8Array, d: number, i: number, lane: number, step: number, micro: number, v: number): void => {
    b[N.drumPatternOffset(d, i) + N.DLANE0 + 192 * lane + step * 6 + micro] = v;
  };

  it("keeps only changes, at step and micro-step ticks, inside the pattern's steps", () => {
    const b = blankProject();
    notePoint(b, 0, 0, 2, 0, 0, 10); notePoint(b, 0, 0, 2, 0, 3, 10); notePoint(b, 0, 0, 2, 1, 3, 20);
    notePoint(b, 0, 0, 2, 20, 0, 99);                       // step 21: outside steps 1–16
    const auto = patternAutomation(N.readNotePattern(N.openProject(b), 0, 0));
    expect(auto).toEqual([{ tick: 0, lane: 2, value: 10 }, { tick: 120 + 60, lane: 2, value: 20 }]);
  });

  it("maps every lane to its target and the Circuit's CC", () => {
    const b = blankProject();
    notePoint(b, 0, 0, 2, 0, 0, 50);    // Synth 1 macro 3
    notePoint(b, 1, 0, 11, 0, 0, 30);   // Synth 2 pan
    notePoint(b, 2, 0, 8, 0, 0, 90);    // MIDI 1 level: no CC
    drumPoint(b, 1, 0, 0, 0, 0, 70);    // Drum 2 pitch
    drumPoint(b, 3, 0, 5, 0, 0, 40);    // Drum 4 reverb send
    const a = arrange(N.openProject(b), { source: "current" });
    expect(a.tracks[0]!.auto).toEqual([{ tick: 0, target: "macro", index: 2, value: 50, cc: { channel: 0, cc: 82 } }]);
    expect(a.tracks[1]!.auto).toEqual([{ tick: 0, target: "pan", value: 30, cc: { channel: 15, cc: 118 } }]);
    expect(a.tracks[2]!.auto).toEqual([{ tick: 0, target: "level", value: 90 }]);
    expect(a.tracks[5]!.auto).toEqual([{ tick: 0, target: "drumPitch", value: 70, cc: { channel: 9, cc: 34 } }]);
    expect(a.tracks[7]!.auto).toEqual([{ tick: 0, target: "reverb", value: 40, cc: { channel: 15, cc: 110 } }]);
    expect(a.warnings.join("\n")).toMatch(/plays in the app but is not exported/);
    // The Live target gets the changes for the preview, but no Circuit CCs.
    expect(arrange(N.openProject(b), { source: "current", automationCcs: false }).tracks[0]!.auto[0]!.cc).toBeUndefined();
  });

  it("places each pattern's automation where the pattern plays in a chain", () => {
    const b = blankProject();
    drumPoint(b, 0, 0, 7, 0, 0, 10);    // Drum 1 pattern 1: pan
    drumPoint(b, 0, 1, 7, 0, 0, 120);   // Drum 1 pattern 2: pan
    setChain(b, 5, 0, 1);               // Drum 1 chain: patterns 1–2
    const a = arrange(N.openProject(b), { source: "current" });
    expect(a.tracks[4]!.auto.map((e) => [e.tick, e.value])).toEqual([[0, 10], [16 * 120, 120]]);
  });
});
