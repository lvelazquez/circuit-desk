import { describe, expect, it } from "vitest";
import * as L from "./layout.ts";
import { changedRanges, writeChain, writeDrumPattern, writeNotePattern, writeScene } from "./edit.ts";
import { openProject, readChains, readDrumPattern, readNotePattern, readScenes, readTrailer } from "./project.ts";
import { blankProject, noisyProject, withModTrailer } from "./testing.ts";

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
