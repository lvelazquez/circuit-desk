// The project's sound settings: reverb, delay, sends, sidechains, track levels and pans, and the four
// drum records. Layout from the stock firmware's own parameter descriptors (project store type 0x20 at
// 0x08057AD0, drum store type 0x10 at 0x08058FA0; tools/firmware/descriptors.ts), names and ranges from
// Novation's Programmer's Reference v3, "Project Control" and "Drum Control".
import * as L from "./layout.ts";
import type { Project } from "./project.ts";

/**
 * File offset (inside the 60-byte project block) of each project parameter index 0–53. Offsets 11–15
 * and 30 hold no parameter (the descriptors skip them).
 */
export const PROJECT_PARAM_OFFSETS: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
  52, 53, 54, 55, 56, 57, 58, 59,
];

/**
 * Order of the 8 reverb sends (indices 0–7) and delay sends (11–18). The reference documents the first
 * six (CC 88, 89, 90, 106, 109, 110). The last two (CC 31 and 32) are not documented; the firmware
 * notes route them to the Audio In strips. The preview gives them to MIDI 1 and MIDI 2.
 */
export const SEND_TRACKS = ["Synth 1", "Synth 2", "Drum 1", "Drum 2", "Drum 3", "Drum 4", "MIDI 1", "MIDI 2"] as const;

/** Tracks that have a sidechain, a level and a pan in the project block, in this order. */
export const MIXER_TRACKS = ["Synth 1", "Synth 2", "MIDI 1", "MIDI 2"] as const;

export const REVERB_TYPES = ["Chamber", "Small Room", "Large Room", "Small Hall", "Large Hall", "Great Hall"] as const;
/** Delay left:right time ratios, by the stored value 0–12 (reference, "left-right ratio"). */
export const DELAY_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "3:1", "1:3", "4:1", "1:4", "1:OFF", "OFF:1"] as const;

export interface Sidechain {
  /** 0–3 = triggered by Drum 1–4; 4 = off. */
  source: number;
  attack: number;
  hold: number;
  decay: number;
  /** 0 = no ducking. */
  depth: number;
}

export interface DrumSettings {
  /** Pack sample 0–63. */
  sample: number;
  level: number;
  /** 64 = no change. */
  pitch: number;
  decay: number;
  distortion: number;
  /** Tilt EQ, 64 = flat. */
  eq: number;
  /** 64 = centre. */
  pan: number;
}

export interface SoundSettings {
  reverb: { type: number; decay: number; damping: number; sends: number[] };
  delay: { time: number; sync: number; feedback: number; width: number; ratio: number; slew: number; sends: number[] };
  /** FX Bypass: true turns the reverb and delay off (reference NRPN 1:21). */
  fxBypass: boolean;
  /** Synth 1, Synth 2, MIDI 1, MIDI 2. */
  sidechains: Sidechain[];
  /** Synth 1, Synth 2, MIDI 1, MIDI 2: level 0–127 and pan (64 = centre). */
  levels: number[];
  pans: number[];
  drums: DrumSettings[];
}

/** The raw value of project parameter `index` (0–53). */
export function projectParam(p: Project, index: number): number {
  const off = PROJECT_PARAM_OFFSETS[index];
  if (off === undefined) throw new RangeError(`project parameter ${index} does not exist (0–53)`);
  return p.bytes[L.PROJECT_PARAMS + off] ?? 0;
}

export function readSound(p: Project): SoundSettings {
  const v = (i: number): number => projectParam(p, i);
  const range = (from: number, n: number): number[] => Array.from({ length: n }, (_, k) => v(from + k));
  const drum = (d: number): DrumSettings => {
    const b = (k: number): number => p.bytes[L.DRUM_BLOCK + d * L.DRUM_RECORD + k] ?? 0;
    return { sample: b(0), level: b(1), pitch: b(2), decay: b(3), distortion: b(4), eq: b(5), pan: b(6) };
  };
  return {
    reverb: { type: v(8), decay: v(9), damping: v(10), sends: range(0, 8) },
    delay: { time: v(19), sync: v(20), feedback: v(21), width: v(22), ratio: v(23), slew: v(24), sends: range(11, 8) },
    fxBypass: v(25) !== 0,
    sidechains: [0, 1, 2, 3].map((t) => {
      const [source, attack, hold, decay, depth] = range(26 + 5 * t, 5) as [number, number, number, number, number];
      return { source, attack, hold, decay, depth };
    }),
    levels: range(46, 4),
    pans: range(50, 4),
    drums: [0, 1, 2, 3].map(drum),
  };
}
