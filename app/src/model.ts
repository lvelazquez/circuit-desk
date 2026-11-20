// Pure helpers for the window: note names, step edits as service payloads, grid movement.
import type { NoteOut, NoteStepIn, NoteStepOut } from "@circuit-desk/core-service";
import { SCALE_INTERVALS, scaleNote, type ScaleSetting } from "@circuit-desk/ncs";

export const STEPS = 32;
export const MAX_NOTES = 6;
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

/**
 * The project's scale root (0–11). Stored step notes are relative to it and the device plays them
 * transposed by it, so every name shown for a stored note adds it. Set by the window whenever the
 * open project's settings load (one project on screen at a time).
 */
let noteRoot = 0;
export function setNoteRoot(root: number): void { noteRoot = ((root % 12) + 12) % 12; }
/** The root in use, to show or take a stored note as the MIDI pitch it sounds at. */
export function getNoteRoot(): number { return noteRoot; }

/** The name of the pitch a stored note sounds at; 60 = C4, as on the Circuit and in Live. */
export function noteName(stored: number): string {
  const n = stored + noteRoot;
  return `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/** Spoken form for labels: "C sharp 4". */
export function noteSpoken(n: number): string {
  return noteName(n).replace("♯", " sharp ");
}

export type StepNotes = ReadonlyMap<number, readonly NoteOut[]>;

export function stepMap(steps: readonly NoteStepOut[]): Map<number, NoteOut[]> {
  return new Map(steps.map((s) => [s.step, s.notes.map((n) => ({ ...n }))]));
}

export const DEFAULT_NOTE = { velocity: 100, gate: 6, micro: 0 } as const;

/** Adds `note` to a step, or removes it when the step already has that note. Null when the step is full. */
export function toggleNote(notes: StepNotes, step: number, note: number, base: Partial<NoteOut> = {}): NoteStepIn | null {
  const cur = notes.get(step) ?? [];
  if (cur.some((n) => n.note === note)) return { step, notes: cur.filter((n) => n.note !== note) };
  if (cur.length >= MAX_NOTES) return null;
  return { step, notes: [...cur, { ...DEFAULT_NOTE, ...base, note }] };
}

/** Clears a step that has notes; puts `note` on an empty one. */
export function toggleStep(notes: StepNotes, step: number, note: number): NoteStepIn {
  return (notes.get(step) ?? []).length ? { step, notes: [] } : { step, notes: [{ ...DEFAULT_NOTE, note }] };
}

export function updateNote(notes: StepNotes, step: number, note: number, change: Partial<NoteOut>): NoteStepIn | null {
  const cur = notes.get(step) ?? [];
  if (!cur.some((n) => n.note === note)) return null;
  return { step, notes: cur.map((n) => (n.note === note ? { ...n, ...change } : n)) };
}

/**
 * Moves one note to another step and/or pitch. Returns the steps to write, or null when the move
 * is not possible (outside 1–32 or 0–127, the target step is full, or that pitch is already there).
 */
export function moveNote(notes: StepNotes, step: number, note: number, toStep: number, toNote: number): NoteStepIn[] | null {
  if (toStep < 1 || toStep > STEPS || toNote < 0 || toNote > 127) return null;
  const from = notes.get(step) ?? [];
  const n = from.find((x) => x.note === note);
  if (!n) return null;
  if (toStep === step) {
    if (toNote !== note && from.some((x) => x.note === toNote)) return null;
    return [{ step, notes: from.map((x) => (x.note === note ? { ...x, note: toNote } : x)) }];
  }
  const to = notes.get(toStep) ?? [];
  if (to.length >= MAX_NOTES || to.some((x) => x.note === toNote)) return null;
  return [{ step, notes: from.filter((x) => x.note !== note) }, { step: toStep, notes: [...to, { ...n, note: toNote }] }];
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Roving focus in a rows × cols grid of cells numbered row by row. */
export function gridMove(index: number, key: string, rows: number, cols: number): number | null {
  const r = Math.floor(index / cols), c = index % cols;
  switch (key) {
    case "ArrowLeft": return c > 0 ? index - 1 : null;
    case "ArrowRight": return c < cols - 1 ? index + 1 : null;
    case "ArrowUp": return r > 0 ? index - cols : null;
    case "ArrowDown": return r < rows - 1 ? index + cols : null;
    case "Home": return r * cols;
    case "End": return r * cols + cols - 1;
    default: return null;
  }
}

/** Roving focus along a row of `count` items (radio rows, tabs): arrows step and wrap round,
 *  Home and End go to the ends. Up/Down also step unless `horizontal` is set. */
export function listMove(index: number, key: string, count: number, horizontal = false): number | null {
  const back = key === "ArrowLeft" || (!horizontal && key === "ArrowUp");
  const fwd = key === "ArrowRight" || (!horizontal && key === "ArrowDown");
  if (back) return (index - 1 + count) % count;
  if (fwd) return (index + 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The pitch rows a piano roll shows: the notes' range with some room, at least two octaves, highest first. */
export function rollRange(pitches: readonly number[], around = 60): number[] {
  const lo0 = pitches.length ? Math.min(...pitches) : around, hi0 = pitches.length ? Math.max(...pitches) : around;
  let lo = lo0 - 5, hi = hi0 + 5;
  while (hi - lo + 1 < 25) { lo--; hi++; }
  lo = clamp(lo, 0, 127); hi = clamp(hi, 0, 127);
  const out: number[] = [];
  for (let p = hi; p >= lo; p--) out.push(p);
  return out;
}

/** Whether a stored note sounds on a black key (after the root). */
export const isBlackKey = (stored: number): boolean => [1, 3, 6, 8, 10].includes((((stored + noteRoot) % 12) + 12) % 12);

/**
 * The stored note of keyboard pad `k` (0–15; 0–7 the top row, 8–15 the bottom row), or null for a
 * gap in the piano layout. Stored notes are relative to the root, so `octave` is the root's octave.
 */
export function keyboardNote(scale: ScaleSetting | null, octave: number, k: number): number | null {
  const top = k < 8, col = k % 8;
  if (!scale || scale.type === 15) {
    const iv = top ? [null, 1, 3, null, 6, 8, 10, null][col]! : [0, 2, 4, 5, 7, 9, 11, 12][col]!;
    return iv === null ? null : octave + iv;
  }
  const n = SCALE_INTERVALS[scale.type]!.length;
  return scaleNote(scale, octave, (top ? n : 0) + col);
}
