// The computer-keyboard note layout (as in Live, by physical key so any keyboard layout works):
// A S D F G H J K L ; are white keys from C, W E T Y U O P the black keys.

/** Semitones above the octave's C, by KeyboardEvent.code. */
export const KEY_NOTES: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

export const MIN_OCTAVE = -1;
export const MAX_OCTAVE = 8;
/** Octave numbering with C3 = MIDI 60, as in Live. */
export const DEFAULT_OCTAVE = 3;

/** The MIDI note for a key offset in an octave (C3 = 60), or null above 127. */
export function keyNote(octave: number, offset: number): number | null {
  const n = 12 * (octave + 2) + offset;
  return n >= 0 && n <= 127 ? n : null;
}

/** The physical key; events without a code (some synthesized ones) fall back to the key's letter. */
export function keyCode(e: { code: string; key: string }): string {
  if (e.code) return e.code;
  if (/^[a-z]$/i.test(e.key)) return `Key${e.key.toUpperCase()}`;
  return e.key === ";" ? "Semicolon" : e.key;
}
