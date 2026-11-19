// A project file held as its original bytes. Reading never changes them; `toBytes` returns them
// exactly, including anything CIRCUIT-HACKS stored after the stock part.
import * as L from "./layout.ts";
import { buildDrumPattern, buildNotePattern, parseDrumPattern, parseNotePattern, type DrumPattern, type NotePattern } from "./pattern.ts";

export type NcsProblem = "too-short" | "bad-magic" | "bad-size-word";

export class NcsError extends Error {
  readonly problem: NcsProblem;
  constructor(problem: NcsProblem, detail: string) {
    super(`Not a Circuit Tracks project: ${detail}`);
    this.name = "NcsError";
    this.problem = problem;
  }
}

export interface Chain {
  first: number;
  last: number;
}

export interface Scene {
  saved: boolean;
  /**
   * The pattern chain of each of the 8 tracks in this scene.
   * The order of the tracks inside a scene is not confirmed yet.
   */
  chains: Chain[];
}

export interface ProjectHeader {
  /** The name stored inside the file (32 characters at most). */
  name: string;
  colour: number;
  /** Reads as BPM. Not confirmed on a device. */
  tempo: number;
  /** Reads as percent, 50 = none. Not confirmed on a device. */
  swing: number;
}

/** What follows the stock part of the file. */
export interface Trailer {
  /** Bytes after the first 160 780. */
  length: number;
  /** CIRCUIT-HACKS extra automation lanes ("XLN1"). */
  extraLanes: { storedSum: number; computedSum: number; sumMatches: boolean } | null;
  /** CIRCUIT-HACKS scene rules ("SCN3"). */
  sceneRules: boolean;
}

export interface Project {
  /** The whole file. Treat as read-only. */
  readonly bytes: Uint8Array;
}

function latin(b: Uint8Array, at: number, n: number): string {
  let s = "";
  for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i] ?? 0);
  return s;
}

function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

/** Why `b` is not a project, or null when it is. */
export function projectProblem(b: Uint8Array): NcsProblem | null {
  if (b.length < L.SESS_SIZE) return "too-short";
  if (latin(b, 0, 4) !== L.MAGIC) return "bad-magic";
  if (view(b).getUint32(L.HEADER_SIZE_AT, true) !== L.SESS_SIZE) return "bad-size-word";
  return null;
}

/** Takes a copy of `input`, so later changes to the caller's buffer do not reach the project. */
export function openProject(input: Uint8Array): Project {
  const problem = projectProblem(input);
  if (problem === "too-short") throw new NcsError(problem, `it has ${input.length} bytes; a project has at least ${L.SESS_SIZE}.`);
  if (problem === "bad-magic") throw new NcsError(problem, `it starts with "${latin(input, 0, 4)}", not "${L.MAGIC}".`);
  if (problem === "bad-size-word") throw new NcsError(problem, `its header gives a size of ${view(input).getUint32(L.HEADER_SIZE_AT, true)}, not ${L.SESS_SIZE}.`);
  return { bytes: input.slice() };
}

/** The file exactly as it was opened. */
export function toBytes(p: Project): Uint8Array {
  return p.bytes.slice();
}

function byte(p: Project, at: number): number {
  const v = p.bytes[at];
  if (v === undefined) throw new RangeError(`offset ${at} is outside the file`);
  return v;
}

export function readHeader(p: Project): ProjectHeader {
  return {
    name: latin(p.bytes, L.NAME_AT, L.NAME_LEN).replace(/[\s\0]+$/, ""),
    colour: view(p.bytes).getUint32(L.COLOUR_AT, true),
    tempo: byte(p, L.TEMPO_AT),
    swing: byte(p, L.SWING_AT),
  };
}

export function readScenes(p: Project): Scene[] {
  const scenes: Scene[] = [];
  for (let e = 0; e < L.NSCENES; e++) {
    const o = L.SCENE0 + e * L.SCENE_SIZE;
    const chains: Chain[] = [];
    for (let t = 0; t < L.NTRACKS; t++) chains.push({ first: byte(p, o + 4 * t), last: byte(p, o + 4 * t + 1) });
    scenes.push({ saved: byte(p, o + L.SCENE_SAVED) !== 0, chains });
  }
  return scenes;
}

/** The chain of scenes being played, and the pattern chain of each of the 8 tracks. */
export function readChains(p: Project): { scenes: Chain; tracks: Chain[] } {
  const entry = (i: number): Chain => ({ first: byte(p, L.CHAIN0 + 4 * i), last: byte(p, L.CHAIN0 + 4 * i + 1) });
  const tracks: Chain[] = [];
  for (let t = 1; t < L.NCHAINS; t++) tracks.push(entry(t));
  return { scenes: entry(0), tracks };
}

function checkIndex(what: string, v: number, max: number): void {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new RangeError(`${what} must be 0–${max}, got ${v}`);
}

/** The bytes of one note-track pattern. `track`: 0 Synth 1, 1 Synth 2, 2 MIDI 1, 3 MIDI 2. */
export function notePatternBytes(p: Project, track: number, index: number): Uint8Array {
  checkIndex("track", track, 3); checkIndex("pattern", index, L.PATTERNS_PER_TRACK - 1);
  const o = L.notePatternOffset(track, index);
  return p.bytes.slice(o, o + L.PAT);
}

/** The bytes of one drum pattern. `drum`: 0–3. */
export function drumPatternBytes(p: Project, drum: number, index: number): Uint8Array {
  checkIndex("drum", drum, 3); checkIndex("pattern", index, L.PATTERNS_PER_TRACK - 1);
  const o = L.drumPatternOffset(drum, index);
  return p.bytes.slice(o, o + L.DPAT);
}

export function readNotePattern(p: Project, track: number, index: number): NotePattern {
  return parseNotePattern(notePatternBytes(p, track, index));
}

export function readDrumPattern(p: Project, drum: number, index: number): DrumPattern {
  return parseDrumPattern(drumPatternBytes(p, drum, index));
}

/** The sum CIRCUIT-HACKS stores with its extra lanes: MIDI 1 and 2's 16 patterns as 32-bit words. */
export function extraLanesSum(b: Uint8Array): number {
  const v = view(b);
  let s = 0;
  for (let i = L.MIDI0; i < L.MIDI0 + 16 * L.PAT; i += 4) s = (s + v.getUint32(i, true)) >>> 0;
  return s;
}

export function readTrailer(p: Project): Trailer {
  const b = p.bytes;
  const length = b.length - L.SESS_SIZE;
  let extraLanes: Trailer["extraLanes"] = null;
  if (length >= L.XLN1_HEADER && latin(b, L.SESS_SIZE, 4) === "XLN1") {
    const storedSum = view(b).getUint32(L.SESS_SIZE + L.XLN1_SUM_AT, true);
    const computedSum = extraLanesSum(b);
    extraLanes = { storedSum, computedSum, sumMatches: storedSum === computedSum };
  }
  const sceneRules = b.length >= L.SCN3_AT + 4 && latin(b, L.SCN3_AT, 4) === "SCN3";
  return { length, extraLanes, sceneRules };
}

/**
 * Parses every pattern and builds it back in place. With no edits the result must equal the
 * original file; the tests run this over every real project.
 */
export function rebuildUnchanged(p: Project): Uint8Array {
  const out = p.bytes.slice();
  for (let track = 0; track < 4; track++) {
    for (let index = 0; index < L.PATTERNS_PER_TRACK; index++) {
      const o = L.notePatternOffset(track, index);
      const base = out.slice(o, o + L.PAT);
      out.set(buildNotePattern(parseNotePattern(base), base), o);
      const d = L.drumPatternOffset(track, index);
      const dbase = out.slice(d, d + L.DPAT);
      out.set(buildDrumPattern(parseDrumPattern(dbase), dbase), d);
    }
  }
  return out;
}
