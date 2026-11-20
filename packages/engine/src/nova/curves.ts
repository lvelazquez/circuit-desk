// Parameter → physical unit curves for the Nova voice. Every curve here is a NAMED GUESS: the
// firmware's real tables (2 880 coefficient words the ARM uploads at init, NOTAS:2650) are measured
// in plan step E0.6 and replace these functions in this one file. Keep all unit conversions here.

/** Where each curve comes from, for the UI and for E0.6's checklist. */
export const CURVE_STATUS = {
  envelopeTime: "guess",
  filterFrequency: "guess",
  resonance: "guess",
  portamento: "guess",
  levels: "guess: linear",
  dbOffset: "guide: −12…+18 dB in 1 dB steps (pre/post FX level)",
  pitch: "guide: semitones and cents are ±64 around 64",
  lfoRate: "guess: 0 stops (guide), default 68 ≈ 2.5 Hz, exponential to ≈ 160 Hz",
  lfoDelay: "guess: like the envelope times",
} as const;

/** Envelope attack / decay / release, 0–127 → seconds (≈0.5 ms … ≈10 s, exponential). */
export function envelopeSeconds(v: number): number {
  return 0.0005 * 2 ** ((v / 127) * 14.3);
}

/** Filter frequency, 0–127 → Hz (≈30 Hz … ≈20 kHz, exponential). */
export function filterHz(v: number): number {
  return 30 * 2 ** ((v / 127) * 9.4);
}

/** Resonance, 0–127 → filter Q (0.5 … ≈20). Q normalise is not modelled yet. */
export function resonanceQ(v: number): number {
  return 0.5 + (v / 127) ** 2 * 19.5;
}

/** Portamento rate, 0–127 → glide seconds (0 = off). */
export function portamentoSeconds(v: number): number {
  return v <= 0 ? 0 : 0.002 * 2 ** ((v / 127) * 11);
}

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
