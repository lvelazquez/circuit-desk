// Project-wide settings: name, tempo, swing, scale, and the sound settings of sound.ts, read and
// written in one place. Writers change only the bytes of the fields they are given.
//
// Scale (loose settings block, 0x26CFC):
// - +17 = scale type 0–15, in the Circuit Tracks User Guide's Scales view order. Card evidence:
//   0 (Natural Minor, the device default) in 86 of 152 projects, 15 (Chromatic) in 18; synth and
//   MIDI notes fall in the scale read with the root at C 98.5 % / 98.9 % of the time.
// - +16 = root 0–11 (C = 0 in 124 projects). Stored step notes are relative to the root: the
//   card's notes fit the scale only when read from C (98.5 %, against 87.7 % from the stored
//   root), and the firmware notes say so (circuit-hacks-rc NOTAS:1828). So the root transposes
//   every note track when it plays. Not yet confirmed on a device.
import * as L from "./layout.ts";
import { readHeader, type Project } from "./project.ts";
import { PROJECT_PARAM_OFFSETS, readSound, type DrumSettings, type Sidechain, type SoundSettings } from "./sound.ts";

export const SCALE_ROOT_AT = L.LOOSE + 16;
export const SCALE_TYPE_AT = L.LOOSE + 17;

export const SCALE_NAMES = [
  "Natural Minor", "Major", "Dorian", "Phrygian", "Mixolydian", "Melodic Minor", "Harmonic Minor", "Bebop Dorian",
  "Blues", "Minor Pentatonic", "Hungarian Minor", "Ukrainian Dorian", "Marva", "Todi", "Whole Tone", "Chromatic",
] as const;

/** Semitones above the root of each scale's degrees. */
export const SCALE_INTERVALS: readonly (readonly number[])[] = [
  [0, 2, 3, 5, 7, 8, 10], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10],
  [0, 2, 4, 5, 7, 9, 10], [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 11], [0, 2, 3, 4, 5, 7, 9, 10],
  [0, 3, 5, 6, 7, 10], [0, 3, 5, 7, 10], [0, 2, 3, 6, 7, 8, 11], [0, 2, 3, 6, 7, 9, 10],
  [0, 1, 4, 6, 7, 9, 11], [0, 1, 3, 6, 7, 8, 11], [0, 2, 4, 6, 8, 10], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
];

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export interface ScaleSetting {
  /** 0–11, C = 0. */
  root: number;
  /** 0–15, see SCALE_NAMES. */
  type: number;
}

export function readScale(p: Project): ScaleSetting {
  return { root: (p.bytes[SCALE_ROOT_AT] ?? 0) % 12, type: Math.min(15, p.bytes[SCALE_TYPE_AT] ?? 0) };
}

/** Whether `note` (a sounding pitch) is in the scale. */
export function inScale(s: ScaleSetting, note: number): boolean {
  return (SCALE_INTERVALS[s.type] ?? SCALE_INTERVALS[15]!).includes((((note - s.root) % 12) + 12) % 12);
}

/**
 * The stored note of the `degree`-th note of the scale (0 = the root at `octaveBase`), as pads
 * in the scale layout lay them out. Stored notes are relative to the root (see the header).
 */
export function scaleNote(s: ScaleSetting, octaveBase: number, degree: number): number {
  const iv = SCALE_INTERVALS[s.type] ?? SCALE_INTERVALS[15]!;
  const oct = Math.floor(degree / iv.length), k = ((degree % iv.length) + iv.length) % iv.length;
  return octaveBase + 12 * oct + iv[k]!;
}

/** A partial edit: in lists, null or undefined leaves an entry as it is (null survives JSON). */
type Deep<T> = { [K in keyof T]?: T[K] extends readonly (infer U)[] ? (U extends object ? (Partial<U> | null | undefined)[] : (U | null | undefined)[]) : T[K] extends object ? Deep<T[K]> : T[K] };

export interface SettingsEdit {
  name?: string;
  tempo?: number;
  swing?: number;
  scale?: Partial<ScaleSetting>;
  sound?: Deep<SoundSettings>;
}

function int(what: string, v: number, min: number, max: number): number {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${what} must be a whole number ${min}–${max}, got ${v}`);
  return v;
}

/** Project parameter index → valid range (Programmer's Reference v3, "Project Control"). */
function paramMax(index: number): number {
  if (index === 8) return 5; // reverb type
  if (index === 20) return 35; // delay sync
  if (index === 23) return 12; // delay ratio
  if (index === 25) return 1; // FX bypass
  if (index >= 26 && index <= 45 && (index - 26) % 5 === 0) return 4; // sidechain source
  return 127;
}

/** Applies `e` and returns the new project; untouched fields keep their bytes. */
export function writeSettings(p: Project, e: SettingsEdit): Project {
  const out = p.bytes.slice();
  if (e.name !== undefined) {
    if (e.name.length > L.NAME_LEN || !/^[\x20-\x7e]*$/.test(e.name)) throw new RangeError(`a project name is up to ${L.NAME_LEN} plain characters (letters, digits, punctuation)`);
    for (let k = 0; k < L.NAME_LEN; k++) out[L.NAME_AT + k] = k < e.name.length ? e.name.charCodeAt(k) : 0x20;
  }
  if (e.tempo !== undefined) out[L.TEMPO_AT] = int("tempo", e.tempo, 40, 240);
  if (e.swing !== undefined) out[L.SWING_AT] = int("swing", e.swing, 20, 80);
  if (e.scale?.root !== undefined) out[SCALE_ROOT_AT] = int("scale root", e.scale.root, 0, 11);
  if (e.scale?.type !== undefined) out[SCALE_TYPE_AT] = int("scale type", e.scale.type, 0, 15);
  const s = e.sound;
  if (s) {
    const param = (index: number, v: number | null | undefined, what: string): void => {
      if (v === undefined || v === null) return;
      out[L.PROJECT_PARAMS + PROJECT_PARAM_OFFSETS[index]!] = int(what, v, 0, paramMax(index));
    };
    const list = (from: number, vs: readonly (number | null | undefined)[] | undefined, n: number, what: string): void => {
      if (!vs) return;
      if (vs.length > n) throw new RangeError(`${what}: at most ${n} values`);
      vs.forEach((v, k) => param(from + k, v, `${what} ${k + 1}`));
    };
    param(8, s.reverb?.type, "reverb type"); param(9, s.reverb?.decay, "reverb decay"); param(10, s.reverb?.damping, "reverb damping");
    list(0, s.reverb?.sends, 8, "reverb send");
    param(19, s.delay?.time, "delay time"); param(20, s.delay?.sync, "delay sync"); param(21, s.delay?.feedback, "delay feedback");
    param(22, s.delay?.width, "delay width"); param(23, s.delay?.ratio, "delay ratio"); param(24, s.delay?.slew, "delay slew");
    list(11, s.delay?.sends, 8, "delay send");
    if (s.fxBypass !== undefined) param(25, s.fxBypass ? 1 : 0, "FX bypass");
    (s.sidechains ?? []).forEach((c: Partial<Sidechain> | null | undefined, t) => {
      if (!c) return;
      if (t > 3) throw new RangeError("there are 4 sidechains (Synth 1, Synth 2, MIDI 1, MIDI 2)");
      (["source", "attack", "hold", "decay", "depth"] as const).forEach((k, j) => param(26 + 5 * t + j, c[k], `sidechain ${t + 1} ${k}`));
    });
    list(46, s.levels, 4, "level");
    list(50, s.pans, 4, "pan");
    (s.drums ?? []).forEach((d: Partial<DrumSettings> | null | undefined, k) => {
      if (!d) return;
      if (k > 3) throw new RangeError("there are 4 drums");
      (["sample", "level", "pitch", "decay", "distortion", "eq", "pan"] as const).forEach((f, j) => {
        const v = d[f];
        if (v !== undefined && v !== null) out[L.DRUM_BLOCK + k * L.DRUM_RECORD + j] = int(`drum ${k + 1} ${f}`, v, 0, f === "sample" ? 63 : 127);
      });
    });
  }
  return { bytes: out };
}

/** Everything the settings editor shows. */
export interface ProjectSettings {
  name: string;
  tempo: number;
  swing: number;
  scale: ScaleSetting;
  sound: SoundSettings;
}

export function readSettings(p: Project): ProjectSettings {
  const header = readHeader(p);
  return { name: header.name, tempo: header.tempo, swing: header.swing, scale: readScale(p), sound: readSound(p) };
}
