import { describe, expect, it } from "vitest";
import { gridMove, moveNote, noteName, rollRange, stepMap, toggleNote, toggleStep, updateNote } from "./model.ts";

const notes = stepMap([{ step: 1, probability: 7, notes: [{ note: 60, velocity: 100, gate: 6, micro: 0 }] }]);

describe("window model", () => {
  it("names notes as the Circuit does", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(61)).toBe("C♯4");
    expect(noteName(0)).toBe("C-1");
  });

  it("toggles notes and steps", () => {
    expect(toggleNote(notes, 1, 60)).toEqual({ step: 1, notes: [] });
    expect(toggleNote(notes, 1, 64)?.notes.map((n) => n.note)).toEqual([60, 64]);
    const full = stepMap([{ step: 2, probability: 7, notes: [0, 1, 2, 3, 4, 5].map((k) => ({ note: 60 + k, velocity: 1, gate: 6, micro: 0 })) }]);
    expect(toggleNote(full, 2, 70)).toBeNull();
    expect(toggleStep(notes, 1, 64)).toEqual({ step: 1, notes: [] });
    expect(toggleStep(notes, 3, 64)).toEqual({ step: 3, notes: [{ note: 64, velocity: 100, gate: 6, micro: 0 }] });
    expect(updateNote(notes, 1, 60, { gate: 12 })?.notes[0]?.gate).toBe(12);
  });

  it("moves notes across steps and pitches, refusing impossible moves", () => {
    expect(moveNote(notes, 1, 60, 1, 61)).toEqual([{ step: 1, notes: [{ note: 61, velocity: 100, gate: 6, micro: 0 }] }]);
    expect(moveNote(notes, 1, 60, 2, 60)).toEqual([{ step: 1, notes: [] }, { step: 2, notes: [{ note: 60, velocity: 100, gate: 6, micro: 0 }] }]);
    expect(moveNote(notes, 1, 60, 0, 60)).toBeNull();
    expect(moveNote(notes, 1, 60, 1, 128)).toBeNull();
  });

  it("moves focus inside the grid without wrapping", () => {
    expect(gridMove(0, "ArrowLeft", 4, 8)).toBeNull();
    expect(gridMove(7, "ArrowRight", 4, 8)).toBeNull();
    expect(gridMove(7, "ArrowDown", 4, 8)).toBe(15);
    expect(gridMove(9, "Home", 4, 8)).toBe(8);
  });

  it("shows at least two octaves around the notes", () => {
    const r = rollRange([60, 62]);
    expect(r[0]).toBeGreaterThanOrEqual(67);
    expect(r.length).toBeGreaterThanOrEqual(25);
    expect(r).toEqual([...r].sort((a, b) => b - a));
  });
});
