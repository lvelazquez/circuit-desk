import { describe, expect, it } from "vitest";
import { DEFAULT_OCTAVE, KEY_NOTES, keyCode, keyNote } from "./keymap.ts";

describe("computer keyboard notes", () => {
  it("A plays C3 (MIDI 60) in the default octave, and the row is chromatic", () => {
    expect(keyNote(DEFAULT_OCTAVE, KEY_NOTES["KeyA"]!)).toBe(60);
    const row = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ", "KeyK", "KeyO", "KeyL", "KeyP", "Semicolon"];
    expect(row.map((k) => KEY_NOTES[k])).toEqual(row.map((_, i) => i));
  });

  it("stays inside MIDI's 0–127", () => {
    expect(keyNote(-1, 0)).toBe(12);
    expect(keyNote(8, 16)).toBeNull();
  });

  it("uses the physical key, with a fallback for events without a code", () => {
    expect(keyCode({ code: "KeyA", key: "q" })).toBe("KeyA"); // AZERTY: the A position types q
    expect(keyCode({ code: "", key: "a" })).toBe("KeyA");
    expect(keyCode({ code: "", key: ";" })).toBe("Semicolon");
    expect(keyCode({ code: "", key: "Escape" })).toBe("Escape");
  });
});
