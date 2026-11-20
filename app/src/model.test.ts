import { describe, expect, it } from "vitest";
import { gridMove, keyboardNote, listMove, moveNote, noteName, rollRange, stepMap, toggleNote, toggleStep, updateNote } from "./model.ts";

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

describe("keyboard pads", () => {
  it("climb the scale on the bottom row and repeat it an octave up on the top row", () => {
    const major = { root: 0, type: 1 };
    expect(Array.from({ length: 8 }, (_, c) => keyboardNote(major, 48, 8 + c))).toEqual([48, 50, 52, 53, 55, 57, 59, 60]);
    expect(keyboardNote(major, 48, 0)).toBe(60);
  });
  it("lay out Chromatic as a piano, with gaps where no sharp is", () => {
    const chroma = { root: 0, type: 15 };
    expect(Array.from({ length: 8 }, (_, c) => keyboardNote(chroma, 48, c))).toEqual([null, 49, 51, null, 54, 56, 58, null]);
    expect(keyboardNote(chroma, 48, 15)).toBe(60);
  });
});

describe("listMove", () => {
  it("steps and wraps round, both ways", () => {
    expect(listMove(0, "ArrowRight", 4)).toBe(1);
    expect(listMove(3, "ArrowRight", 4)).toBe(0);
    expect(listMove(0, "ArrowLeft", 4)).toBe(3);
    expect(listMove(2, "ArrowDown", 4)).toBe(3);
  });
  it("goes to the ends with Home and End", () => {
    expect(listMove(2, "Home", 4)).toBe(0);
    expect(listMove(1, "End", 4)).toBe(3);
  });
  it("leaves Up and Down alone on horizontal tabs, and other keys always", () => {
    expect(listMove(1, "ArrowUp", 4, true)).toBeNull();
    expect(listMove(1, "x", 4)).toBeNull();
  });
});
