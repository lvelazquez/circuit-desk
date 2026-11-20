import { describe, expect, it } from "vitest";
import * as L from "./layout.ts";
import { changedRanges, writeChain, writeDrumPattern, writeNotePattern, writeScene } from "./edit.ts";
import { openProject, readChains, readDrumPattern, readNotePattern, readScenes, readTrailer } from "./project.ts";
import { blankProject, noisyProject, withModTrailer } from "./testing.ts";
import * as N from "./index.ts";

describe("edits", () => {
  it("writes one note and changes only that step's bytes", () => {
    const p = openProject(noisyProject(7));
    const m = readNotePattern(p, 0, 2);
    m.steps[4]!.probability = 7;
    m.steps[4]!.units = m.steps[4]!.units.map((u, k) => (k === 0 ? { on: true, note: 64, gate: 6, tie: false, micro: 0, velocity: 100 } : { ...u, on: false }));
    // The noisy file is full of values the device would never store; an edit keeps them as they are.
    const q = writeNotePattern(p, 0, 2, m);
    expect(readNotePattern(q, 0, 2).steps[4]!.units[0]).toMatchObject({ on: true, note: 64, velocity: 100 });
    expect(p.bytes).toEqual(openProject(noisyProject(7)).bytes); // input untouched
    for (const r of changedRanges(p.bytes, q.bytes)) {
      expect(r.field).toBe("Synth 1 pattern 3: steps");
      expect(r.offset).toBeGreaterThanOrEqual(L.notePatternOffset(0, 2) + 4 * L.STEP);
      expect(r.offset + r.length).toBeLessThanOrEqual(L.notePatternOffset(0, 2) + 5 * L.STEP);
      expect(r.status).toBe("verified");
    }
  });

  it("refuses values the device cannot store", () => {
    const p = openProject(blankProject());
    const m = readNotePattern(p, 1, 0);
    m.steps[0]!.units[0] = { on: true, note: 60, gate: 0, tie: false, micro: 0, velocity: 100 };
    expect(() => writeNotePattern(p, 1, 0, m)).toThrow(/gate must be/);
    m.steps[0]!.units[0] = { on: true, note: 128, gate: 6, tie: false, micro: 0, velocity: 100 };
    expect(() => writeNotePattern(p, 1, 0, m)).toThrow(/note must be/);
    expect(() => writeChain(p, 1, { first: 3, last: 1 })).toThrow(/after last/);
  });

  it("writes drum hits", () => {
    const p = openProject(blankProject());
    const m = readDrumPattern(p, 3, 7);
    m.steps[0]!.velocity = 100; m.steps[0]!.microSteps = 0b11;
    const q = writeDrumPattern(p, 3, 7, m);
    expect(readDrumPattern(q, 3, 7).steps[0]).toMatchObject({ velocity: 100, microSteps: 3 });
    expect(changedRanges(p.bytes, q.bytes).map((r) => r.field)).toEqual(["Drum 4 pattern 8: velocity", "Drum 4 pattern 8: microSteps"]);
  });

  it("writes chains and scenes", () => {
    let p = openProject(blankProject());
    p = writeChain(p, 0, { first: 0, last: 2 });
    p = writeChain(p, 3, { first: 1, last: 4 });
    p = writeScene(p, 5, Array.from({ length: 8 }, (_, t) => ({ first: t % 8, last: t % 8 })));
    expect(readChains(p).scenes).toEqual({ first: 0, last: 2 });
    expect(readChains(p).tracks[2]).toEqual({ first: 1, last: 4 });
    expect(readScenes(p)[5]).toMatchObject({ saved: true });
    expect(readScenes(p)[5]!.chains[7]).toEqual({ first: 7, last: 7 });
  });

  it("refreshes the CIRCUIT-HACKS lane sum after a MIDI 1/2 edit, only if it matched", () => {
    const good = openProject(withModTrailer(blankProject(), 3));
    const m = readNotePattern(good, 2, 0);
    m.steps[0]!.units[0] = { on: true, note: 60, gate: 6, tie: false, micro: 0, velocity: 100 };
    expect(readTrailer(writeNotePattern(good, 2, 0, m)).extraLanes?.sumMatches).toBe(true);

    const staleBytes = withModTrailer(blankProject(), 3);
    staleBytes[L.SESS_SIZE + L.XLN1_SUM_AT] = (staleBytes[L.SESS_SIZE + L.XLN1_SUM_AT]! + 1) & 255;
    const stale = openProject(staleBytes);
    const after = writeNotePattern(stale, 2, 0, m);
    expect(readTrailer(after).extraLanes?.storedSum).toBe(readTrailer(stale).extraLanes?.storedSum);
  });
});

describe("project settings", () => {
  it("reads and writes scale, tempo, swing and name, changing only their bytes", () => {
    const p = N.openProject(blankProject());
    const q = N.writeSettings(p, { name: "Night Bus", tempo: 128, swing: 58, scale: { root: 2, type: 1 } });
    expect(N.readSettings(q)).toMatchObject({ name: "Night Bus", tempo: 128, swing: 58, scale: { root: 2, type: 1 } });
    const fields = N.changedRanges(p.bytes, q.bytes).map((r) => r.field);
    expect(new Set(fields)).toEqual(new Set(["header.name", "tempo", "swing", "scaleRoot", "scaleType"]));
  });

  it("writes sound settings into the project block and drum records", () => {
    const p = N.openProject(blankProject());
    const q = N.writeSettings(p, { sound: { reverb: { type: 3, sends: [undefined, 90] }, levels: [100], drums: [undefined, { sample: 12, pan: 30 }], sidechains: [{ source: 1, depth: 80 }] } });
    const s = N.readSound(q);
    expect(s.reverb.type).toBe(3);
    expect(s.reverb.sends[1]).toBe(90);
    expect(s.levels[0]).toBe(100);
    expect(s.drums[1]).toMatchObject({ sample: 12, pan: 30 });
    expect(s.sidechains[0]).toMatchObject({ source: 1, depth: 80 });
    expect(N.changedRanges(p.bytes, q.bytes).every((r) => r.field === "projectParams" || r.field === "drumBlock")).toBe(true);
  });

  it("rejects values the device cannot store", () => {
    const p = N.openProject(blankProject());
    expect(() => N.writeSettings(p, { scale: { type: 16 } })).toThrow(/scale type/);
    expect(() => N.writeSettings(p, { sound: { reverb: { type: 6 } } })).toThrow(/reverb type/);
    expect(() => N.writeSettings(p, { name: "é" })).toThrow(/name/);
  });

  it("lays out scale degrees from the root", () => {
    expect([0, 1, 2, 7].map((d) => N.scaleNote({ root: 0, type: 1 }, 60, d))).toEqual([60, 62, 64, 72]);
    expect(N.inScale({ root: 2, type: 1 }, 62 + 4)).toBe(true);
    expect(N.inScale({ root: 2, type: 1 }, 62 + 3)).toBe(false);
  });
});
