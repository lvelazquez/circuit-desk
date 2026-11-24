// LFOs 1 and 2 of the Nova voice (plan E2). Pure DSP at block rate, like the rest of the voice's
// modulation: the device updates parameters per 32-frame block.
//
// Sources:
// - Waveform list, parameter ranges and flag bits: Circuit Programmer's Reference Guide v1.3, p. 9
//   (official; the Circuit Tracks guide has the same table), mirrored in packages/patch format.ts.
// - Behaviour of phase, key sync, common sync, one shot, slew, fade modes and delay trigger:
//   UltraNova User Guide pp. 23–25 and 40–41 (official, same Nova engine; not checked on a
//   Circuit).
// - Sync values: the UltraNova's 36-entry sync table (official); Novation Components' Circuit
//   Tracks editor labels the same 35 values, "1/32 T" to "64 Beats" (checked 2026-11-24).
// - Shapes 6–37 (Piano envelope, Sequence 1–7, Alternative 1–8, the melodic shapes): Novation
//   Components' LFO tables when they are loaded (tables.ts), read as they are, step for step. Sine,
//   triangle, sawtooth and square match those tables' phase and direction, so they stay formulas;
//   Random S/H and Time S/H stay random (the tables hold one snapshot of each).
//
// Approximations, until the firmware oracle (plan D-6) or a device measurement replaces them:
// - The rate curve (curves.ts lfoRateHz), the delay time curve and the slew time.
// - The melodic shapes' interval size (MELODIC_SPAN): Components scales each table to fill its
//   display, so the steps' order and timing are exact but semitones are fitted (see the list).
// - Without the tables, the step values below: they follow Novation's descriptions ("held for a
//   sixteenth of the cycle", "jump between min and max") and the shapes' names, not the device.
import * as C from "./curves.ts";
import { lfoTableLevel, lfoTableValue } from "./tables.ts";

/** UltraNova sync table: 0 = off, then the cycle length in beats (quarter notes). */
export const LFO_SYNC_BEATS: readonly number[] = [
  0, 1 / 12, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 8 / 3, 3, 4, 16 / 3, 6, 8,
  32 / 3, 12, 40 / 3, 16, 18, 56 / 3, 20, 64 / 3, 24, 28, 30, 32, 36, 42, 48, 64,
];

export const FADE_IN = 0, FADE_OUT = 1, GATE_IN = 2, GATE_OUT = 3;

export interface LfoParams {
  wave: number;
  /** Start phase on a key-synced note, 0–1 (the patch stores steps of 3°). */
  phase: number;
  /** 0–1. */
  slew: number;
  /** Raw 0–127 rate, so the mod matrix can offset it before the curve. */
  rate: number;
  /** Cycle length in seconds when the rate is synced to tempo, else 0. */
  syncSeconds: number;
  /** Delay (fade) time in seconds; synced delay already converted. */
  delay: number;
  oneShot: boolean;
  keySync: boolean;
  commonSync: boolean;
  /** Delay trigger: false = re-trig (each note its own delay), true = legato (from the first note only). */
  legatoDelay: boolean;
  fade: number;
}

/** The patch's raw LFO values (by id, as packages/patch parses them) → LfoParams at `bpm`. */
export function lfoParams(g: (id: string) => number, n: 1 | 2, bpm: number): LfoParams {
  const flags = g(`lfo${n}.flags`);
  const beats = (sync: number): number => LFO_SYNC_BEATS[sync] ?? 0;
  const rateBeats = beats(g(`lfo${n}.rateSync`)), delayBeats = beats(g(`lfo${n}.delaySync`));
  return {
    wave: g(`lfo${n}.wave`),
    phase: (g(`lfo${n}.phase`) * 3) / 360,
    slew: g(`lfo${n}.slew`) / 127,
    rate: g(`lfo${n}.rate`),
    syncSeconds: rateBeats > 0 ? (rateBeats * 60) / bpm : 0,
    delay: delayBeats > 0 ? (delayBeats * 60) / bpm : C.lfoDelaySeconds(g(`lfo${n}.delay`)),
    oneShot: (flags & 1) !== 0,
    keySync: (flags & 2) !== 0,
    commonSync: (flags & 4) !== 0,
    legatoDelay: (flags & 8) !== 0,
    fade: (flags >> 4) & 3,
  };
}

// --- Step shapes (placeholders; see the header) ---------------------------------------------

/** A fixed pseudo-random sequence, so a shape sounds the same every time. */
function seeded(seed: number, count: number, f: (r: number) => number): number[] {
  let s = (seed * 2654435761) >>> 0 || 1;
  return Array.from({ length: count }, () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return f(s / 4294967296);
  });
}

/** Sequence 1–7: 16 held values, −1…1. */
const SEQUENCES = Array.from({ length: 7 }, (_, k) => seeded(101 + k, 16, (r) => Math.round((r * 2 - 1) * 8) / 8));
/** Alternative 1–8: min/max jumps; the k-th uses a different number of switches per cycle. */
const ALTERNATIVES = Array.from({ length: 8 }, (_, k) => {
  const steps = seeded(211 + k, 16, (r) => (r < 0.5 ? -1 : 1));
  steps[0] = 1;
  return steps;
});

/** Melodic shapes 22–37, in semitones, 16 steps per cycle (names from the guide; notes are a reading of them). */
const MELODIC: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 11, 10, 9], // Chromatic
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // Chromatic 16
  [0, 2, 4, 5, 7, 9, 11, 12, 12, 11, 9, 7, 5, 4, 2, 0], // Major
  [0, 4, 7, 11, 12, 11, 7, 4, 0, 4, 7, 11, 12, 11, 7, 4], // Major 7
  [0, 3, 7, 10, 12, 10, 7, 3, 0, 3, 7, 10, 12, 10, 7, 3], // Minor 7
  [0, 3, 7, 12, 0, 3, 7, 12, 0, 3, 7, 12, 0, 3, 7, 12], // Min arp 1
  [12, 7, 3, 0, 12, 7, 3, 0, 12, 7, 3, 0, 12, 7, 3, 0], // Min arp 2
  [0, 3, 6, 9, 12, 9, 6, 3, 0, 3, 6, 9, 12, 9, 6, 3], // Diminished
  [12, 10, 8, 7, 5, 3, 2, 0, 12, 10, 8, 7, 5, 3, 2, 0], // Dec minor
  [0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3], // Minor 3rd
  [0, 7, 0, 5, 0, 3, 0, 2, 0, 7, 0, 5, 0, 3, 0, 2], // Pedal
  [0, 5, 10, 15, 0, 5, 10, 15, 0, 5, 10, 15, 0, 5, 10, 15], // 4ths
  [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7, 0, 5, 10, 3], // 4ths x12 (around the circle, folded into an octave)
  [0, 0, 0, 0, 9, 9, 9, 9, 2, 2, 2, 2, 7, 7, 7, 7], // 1625 maj (I vi ii V roots)
  [0, 0, 0, 0, 8, 8, 8, 8, 2, 2, 2, 2, 7, 7, 7, 7], // 1625 min
  [2, 2, 2, 2, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 0], // 2511 (ii V I I)
];
/**
 * LFO value per semitone for the melodic shapes. The guides say these play chromatic pitch at a
 * matrix depth of ±36 (of 63); the voice moves pitch 12 semitones at full depth, so one semitone is
 * 63 / 36 / 12 of full scale.
 */
export const MELODIC_SEMITONE = 63 / 36 / 12;

/**
 * Semitones from the lowest to the highest step of each melodic shape (22–37), to read Components'
 * tables (each scaled to its own full height) as pitch. "Fit": the span that puts every step within
 * 0.1 semitone of a whole one (0.17 for Dec minor) and reads as the shape's name; "guess": the steps
 * are evenly spaced or fit no span cleanly, so the size follows the name. To check on a device.
 */
export const MELODIC_SPAN: readonly number[] = [
  11, // Chromatic: 0…11 (fit)
  11, // Chromatic 16: 0…11, then down 10…7 (fit)
  12, // Major: 0 2 4 5 7 9 11 12 (fit)
  11, // Major 7: 0 4 7 11 (fit)
  10, // Minor 7: 0 3 7 10 (fit)
  10, // Min arp 1: 0 7 3 7 3 10 7 3 (fit)
  10, // Min arp 2: 0 3 7 3 7 10 3 7 (fit)
  11, // Diminished: 0 2 3 5 6 8 9 11 (fit)
  12, // Dec minor: 7 5 3 2 0 12 10 8 (fit, 0.17)
  21, // Minor 3rd: eight even steps; 3 semitones each by the name (guess; 1 each also fits)
  6, // Pedal: 0 5 0 6 0 1 0 3, the closest span (guess)
  16, // 4ths: 0 5 10 15 1 6 11 16 (fit)
  17, // 4ths x12: even rises of about 5 between drops; fits no span cleanly (guess)
  9, // 1625 maj: 0 9 2 7, I vi ii V (fit)
  8, // 1625 min: 0 8 2 7 (fit)
  7, // 2511: 2 7 0 0, ii V I I (fit)
];

const FIRST_SEQUENCE = 7, FIRST_ALTERNATIVE = 14, FIRST_MELODIC = 22;

/** One LFO. Bipolar output, −1…1 (melodic shapes go past 1: they are pitch steps). */
export class Lfo {
  /** Position in the cycle, 0–1. */
  phase = 0;
  /** The output after slew and fade. */
  value = 0;
  private slewed = 0;
  private hold = 0;
  private holdNext = 0;
  /** Seconds since the delay/fade was last started. */
  private faded = 0;
  /** One shot: the cycle has played (the LFO stays at its start point). */
  private done = false;
  private travelled = 0;
  private seed: number;

  constructor(seed = 1) { this.seed = (seed * 2654435761) >>> 0 || 1; }

  private random(): number {
    let s = this.seed;
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    this.seed = s;
    return (s / 4294967296) * 2 - 1;
  }

  /**
   * A note starts. With key sync, the cycle restarts at the phase offset (`phase` overrides it, for
   * common sync). The delay restarts unless it is legato and this is a legato note.
   */
  trigger(p: LfoParams, legato: boolean, phase?: number): void {
    if (p.keySync || p.oneShot) {
      this.phase = phase ?? p.phase;
      this.done = false;
      this.travelled = 0;
      this.hold = this.random();
      this.holdNext = this.random();
    }
    if (!(legato && p.legatoDelay)) this.faded = 0;
  }

  /** Copies another LFO's state (common sync starts a voice where the shared LFO is). */
  follow(other: Lfo): void {
    this.phase = other.phase; this.value = other.value; this.slewed = other.slewed;
    this.hold = other.hold; this.holdNext = other.holdNext; this.done = other.done; this.travelled = other.travelled;
  }

  /** Hertz now: synced, or the raw rate (plus `mod`, in the 0–127 domain) through the curve. */
  static hz(p: LfoParams, mod = 0): number {
    if (p.syncSeconds > 0) return 1 / p.syncSeconds;
    return C.lfoRateHz(Math.min(127, Math.max(0, p.rate + mod * 127)));
  }

  /** Moves on by `seconds` at `hz` and returns the new output. */
  advance(p: LfoParams, hz: number, seconds: number): number {
    if (!this.done) {
      const step = hz * seconds;
      let ph = this.phase + step;
      if (p.oneShot) {
        this.travelled += step;
        if (this.travelled >= 1) { this.done = true; ph = p.phase; }
      }
      // A new cycle: sample-and-hold shapes take their next value.
      if (ph >= 1) {
        ph -= Math.floor(ph);
        this.hold = this.holdNext;
        this.holdNext = this.random();
      }
      this.phase = ph;
    }
    const target = this.shape(p.wave, this.phase);
    // Slew: a one-pole lag whose time is a fraction of the cycle (a guess), so high slew rounds
    // the shape and can keep it from reaching full level, as the guide says.
    const period = hz > 0 ? 1 / hz : 1;
    const tau = p.slew * p.slew * 0.5 * period;
    this.slewed = tau > 0 ? this.slewed + (target - this.slewed) * (1 - Math.exp(-seconds / tau)) : target;
    this.faded += seconds;
    this.value = this.slewed * fadeGain(p.fade, p.delay, this.faded);
    return this.value;
  }

  /** The waveform at phase `ph` (0–1). */
  shape(wave: number, ph: number): number {
    switch (wave) {
      case 0: return Math.sin(2 * Math.PI * ph);
      case 1: return ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
      case 2: return 1 - 2 * ph;
      case 3: return ph < 0.5 ? 1 : -1;
      case 4: return this.hold;
      // Time S/H: min or max, each held for a random time. Here: the held value's sign, with the
      // switch point inside the cycle moved by the next value.
      case 5: return ph < 0.5 + 0.45 * this.holdNext ? (this.hold >= 0 ? 1 : -1) : (this.holdNext >= 0 ? 1 : -1);
      // Piano envelope: the table, else "a curved sawtooth": a fast exponential fall from the top.
      case 6: return lfoTableValue(6, ph) ?? 2 * Math.exp(-5 * ph) - 1;
      default: break;
    }
    if (wave >= FIRST_MELODIC) {
      const level = lfoTableLevel(wave, ph);
      if (level !== null) return Math.round(level * MELODIC_SPAN[wave - FIRST_MELODIC]!) * MELODIC_SEMITONE;
    } else {
      const v = lfoTableValue(wave, ph);
      if (v !== null) return v;
    }
    const k = Math.min(15, Math.floor(ph * 16));
    if (wave >= FIRST_SEQUENCE && wave < FIRST_ALTERNATIVE) return SEQUENCES[wave - FIRST_SEQUENCE]![k]!;
    if (wave >= FIRST_ALTERNATIVE && wave < FIRST_MELODIC) return ALTERNATIVES[wave - FIRST_ALTERNATIVE]![k]!;
    const m = MELODIC[wave - FIRST_MELODIC];
    return m ? m[k]! * MELODIC_SEMITONE : 0;
  }
}

/**
 * How much of the LFO comes through `t` seconds after the delay started. With no delay every mode
 * passes it whole (a zero-length fade would otherwise silence fade-out and gate-out patches).
 */
export function fadeGain(mode: number, delay: number, t: number): number {
  if (delay <= 0) return 1;
  const x = Math.min(1, t / delay);
  switch (mode) {
    case FADE_OUT: return 1 - x;
    case GATE_IN: return t >= delay ? 1 : 0;
    case GATE_OUT: return t >= delay ? 0 : 1;
    default: return x;
  }
}
