// Parameter → physical unit curves for the Nova voice. Keep all unit conversions here.
// Firmware-derived curves come from tools/firmware/fit-curves.ts: the stock ARM code's swept DSP words
// (tools/firmware/sweep.py) and the stock DSP program's own response to them, run in emulation
// (tools/firmware/measure-curves.py). Only the fitted constants are committed (decision D-10); the method
// and evidence are in docs/firmware-curves.md. Curves still marked "guess" are named guesses.

/** Where each curve comes from, for the UI and for E0.6's checklist. */
export const CURVE_STATUS = {
  envelopeTime:
    "firmware sweep (fit: log2 seconds piecewise linear through the knots of 4 shared tables + per-envelope index shifts; attack/release from the words, max error 18 % at the tables' coarse steps; env 1/2 decay measured in the DSP, max error 4 %)",
  envelopeDelay: "guess (env 3 delay: its words are not decoded)",
  filterFrequency: "firmware sweep (fit: 1 semitone per step from the word X:$3E7, f(64) from the emulated filter's resonant peak, max error 40 cents over 16–102)",
  resonance: "guess",
  portamento: "firmware sweep (fit: octave-glide settle time from the DSP glide recurrence P:$5C0; log2 piecewise linear, max error 24 %)",
  levels: "guess: linear",
  dbOffset: "guide: −12…+18 dB in 1 dB steps (pre/post FX level)",
  pitch: "guide: semitones and cents are ±64 around 64",
  lfoRate: "guess: 0 stops (guide), default 68 ≈ 2.5 Hz, exponential to ≈ 160 Hz",
  lfoDelay: "guess: like the envelope times",
} as const;

/** [index, log2(value)] knots; values between knots are log-linear, outside the ends they hold. */
type Knots = readonly (readonly [number, number])[];

function logKnots(ks: Knots, x: number): number {
  const first = ks[0]!, last = ks[ks.length - 1]!;
  if (x <= first[0]) return 2 ** first[1];
  if (x >= last[0]) return 2 ** last[1];
  for (let i = 1; i < ks.length; i++) {
    const [x1, y1] = ks[i]!;
    if (x <= x1) {
      const [x0, y0] = ks[i - 1]!;
      return 2 ** (y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
    }
  }
  return 2 ** last[1];
}

// ── Envelopes ─────────────────────────────────────────────────────────────────────────────────────
// Stock firmware (emulated), per 32-frame block at 48 kHz:
//  - attack rises linearly by word / 2^23 of the peak per block (DSP P:$4E5 reads Y:$14E, $154, $15E);
//  - release, and env 3 decay, fall by the factor 1 − word / 2^23 per block (P:$4E5 Y:$150/$156, P:$5D3 X:$2CA, Y:$160);
//  - env 1/2 decay words are a coded rate read at P:$741 (Y:$14B/$14C); their fall was measured on the envelope outputs.
// The ARM takes each envelope's words from a shared table at an offset (exact over the whole sweep):
// env 1 attack = table(v + 33), env 1 decay = table(v + 47), env 1 release = table(v + 20), env 3 release = table(v − 1).
// Knots: log2 seconds by table index (attack: to the peak; decay and release: to 1/1000 of the distance).
const ENV_ATTACK: Knots = [[0, -10.524], [2, -10.524], [4, -10.161], [8, -8.435], [16, -7.242], [24, -6.489], [32, -5.634], [48, -3.967], [64, -2.290], [80, -0.597], [96, 1.100], [112, 2.971], [118, 3.626], [119, 4.472]];
const ENV_DECAY: Knots = [[0, -8.926], [2, -8.401], [4, -7.958], [8, -7.203], [16, -6.163], [24, -5.219], [32, -4.325], [48, -2.609], [64, -0.924], [80, 0.748], [96, 2.425], [112, 4.093], [124, 5.361], [125, 5.450]];
const ENV_RELEASE: Knots = [[-1, -10.468], [0, -9.294], [2, -8.628], [4, -8.179], [8, -7.349], [16, -6.287], [24, -5.333], [32, -4.436], [48, -2.713], [64, -1.030], [80, 0.644], [96, 2.321], [112, 3.987], [125, 5.363], [126, 5.451]];
const ENV3_DECAY: Knots = [[0, -9.924], [2, -8.825], [4, -8.385], [8, -7.496], [16, -6.397], [24, -5.435], [32, -4.533], [48, -2.806], [64, -1.124], [80, 0.558], [96, 2.246], [112, 3.957], [124, 5.338], [125, 5.664]];
const ENV_SHIFT = { attack: [33, 0, 0], decay: [47, 0, 0], release: [20, 0, -1] } as const;

export type EnvelopeStage = "attack" | "decay" | "release";

/**
 * Envelope stage time in seconds for a 0–127 value: attack is the linear rise to the peak, decay and
 * release reach 1/1000 of the distance (−60 dB). Without a stage: the env 3 delay (a guess).
 */
export function envelopeSeconds(v: number, stage?: EnvelopeStage, env: 1 | 2 | 3 = 2): number {
  if (stage === undefined) return 0.0005 * 2 ** ((v / 127) * 14.3);
  const i = v + (ENV_SHIFT[stage][env - 1] ?? 0);
  const table = stage === "attack" ? ENV_ATTACK : stage === "release" ? ENV_RELEASE : env === 3 ? ENV3_DECAY : ENV_DECAY;
  return logKnots(table, i);
}

// ── Filter ────────────────────────────────────────────────────────────────────────────────────────
// X:$3E7 = base + v · 0x800000/192: the oscillator pitch unit, one semitone per step, the same word from
// v = 111 up. Slewed per block at P:$1B89 into X:$2E9, summed at P:$6DF with env 2, tracking and the matrix.
// Hz at 64 is the resonant peak of the emulated filter (noise in, resonance 127, note 60).
const FILTER_HZ_64 = 1649.6;
const FILTER_TOP = 111;

/** Filter frequency, 0–127 → Hz at note 60: one semitone per step, flat from 111 (≈40.9 Hz … ≈25 kHz). */
export function filterHz(v: number): number {
  return FILTER_HZ_64 * 2 ** ((Math.min(v, FILTER_TOP) - 64) / 12);
}

/** Resonance, 0–127 → filter Q (0.5 … ≈20). Q normalise is not modelled yet. */
export function resonanceQ(v: number): number {
  return 0.5 + (v / 127) ** 2 * 19.5;
}

// ── Portamento ────────────────────────────────────────────────────────────────────────────────────
// DSP P:$5C0, per block on the glide offset d (65 536 per semitone): step s = Y:$15A toward 0, zero when
// within s, then × (1 − Y:$15B / 2^23). Values 0–19 give the same words (an octave in 2 blocks).
// Knots: log2 seconds for an octave glide to settle, by value.
const PORTAMENTO: Knots = [[19, -9.726], [32, -9.030], [48, -7.480], [64, -6.005], [80, -4.543], [96, -3.079], [112, -1.628], [127, -0.269]];

/** Portamento rate, 0–127 → seconds for an octave glide to settle (0 = off). */
export function portamentoSeconds(v: number): number {
  return v <= 0 ? 0 : logKnots(PORTAMENTO, v);
}

// ── Levels ────────────────────────────────────────────────────────────────────────────────────────

/** A 0–127 level → gain 0–1. */
export function level(v: number): number {
  return v / 127;
}

/** A level stored with 64 = 0 dB, one dB per step (pre / post FX level). */
export function dbGain(v: number): number {
  return 10 ** ((v - 64) / 20);
}

/** A bipolar byte (64 = 0) → −1…+1 (63 steps up, 64 down). */
export function bipolar(v: number): number {
  return v >= 64 ? (v - 64) / 63 : (v - 64) / 64;
}

/**
 * LFO rate, 0–127 → Hz. 0 stops the LFO where it is (UltraNova guide). No measured curve is
 * published; the shape is exponential like the other rates, with the default 68 near 2.5 Hz.
 */
export function lfoRateHz(v: number): number {
  return v <= 0 ? 0 : 0.02 * 2 ** ((v / 127) * 13);
}

/** LFO delay (fade) time, 0–127 → seconds; 0 = none. */
export function lfoDelaySeconds(v: number): number {
  return v <= 0 ? 0 : 0.01 * 2 ** ((v / 127) * 10);
}
