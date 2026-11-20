// Unit conversions for the effects. Every function here is marked: "exact" (from the firmware or the
// reference), "dsp-units" (the firmware's own word is known, its meaning in seconds or hertz is not),
// or "guess". Replacing a guess with a measured curve only touches this file.

const bipolar = (v: number): number => (v >= 64 ? (v - 64) / 63 : (v - 64) / 64);

export const FX_CURVE_STATUS = {
  panLaw: "exact (firmware P:$1B2B: balance, centre = both sides full)",
  levelGain: "exact shape (linear in level, firmware func_001b2b); absolute scale normalised: 127 = unity",
  delayRatio: "exact (stock ARM sweep: X:$94B/$94C; reference table)",
  delayFeedback: "dsp-units (word = value << 16)",
  delayTime: "guess (word = value << 16; seconds unknown)",
  delaySync: "guess (the ARM sends a word linear in the index; the note lengths live in the DSP)",
  reverb: "guess (per-type DSP words known, algorithm not decoded)",
  sidechainTimes: "guess (the envelope shape is known, its time tables are not)",
  drumPitch: "exact (firmware 0x080287DE, NOTAS:2547)",
  drumEq: "exact (DSP P:$2123, NOTAS:4134)",
  drumDecay: "guess (0x080287A0 not decoded; 127 = no limit)",
  drumDistortion: "guess (a table waveshaper in the DSP)",
  patchDistortion: "dsp-units for level ((v + 44) << 16, full at 83), shapes are guesses",
  patchEq: "guess (frequencies and gain range)",
  chorus: "guess (rate, depth, delay ranges)",
} as const;

// ── Mixer ─────────────────────────────────────────────────────────────────────────────────────────

/** The firmware's pan word: p/128 up to the centre, then stretched so 127 reaches 1.0 (0x080287C4). */
export function panWord(pan: number): number {
  return pan <= 64 ? pan / 128 : 0.5 + ((pan - 64) / 63) * 0.5;
}

/** Left and right gains of the balance law. Centre = both at 1; hard left = (1, 0). */
export function panGains(pan: number): [number, number] {
  const w = panWord(pan);
  return [Math.min(1, 2 * (1 - w)), Math.min(1, 2 * w)];
}

/** A track or drum level 0–127 as a gain; linear, 127 = 1. */
export function levelGain(level: number): number {
  return Math.max(0, Math.min(127, level)) / 127;
}

/** A send level 0–127 as a gain. */
export function sendGain(send: number): number {
  return Math.max(0, Math.min(127, send)) / 127;
}

// ── Delay ─────────────────────────────────────────────────────────────────────────────────────────

/** Left and right delay-time multipliers by ratio value 0–12; 0 = that side has no delay. */
export const DELAY_RATIO_GAINS: readonly (readonly [number, number])[] = [
  [1, 1], [1, 0.75], [0.75, 1], [1, 2 / 3], [2 / 3, 1], [1, 0.5], [0.5, 1], [1, 1 / 3], [1 / 3, 1], [1, 0.25], [0.25, 1], [1, 0], [0, 1],
];

/** The longest delay the preview models, seconds. */
export const DELAY_MAX_SECONDS = 2;

/** Free delay time 0–127 → seconds. Guess: linear like the word, 10 ms … 1.5 s. */
export function delayFreeSeconds(time: number): number {
  return 0.01 + (time / 127) * 1.49;
}

/**
 * Note lengths (in quarter notes) for sync values 1–35, shortest first. Guess: the firmware sends a
 * word linear in the index and keeps the table in the DSP. Value 0 = free time.
 */
export const SYNC_BEATS: readonly number[] = [
  0, 1 / 24, 1 / 16, 1 / 12, 1 / 8, 1 / 6, 3 / 16, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 8 / 3, 3,
  4, 16 / 3, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768,
];

/** Delay time in seconds: sync 1–35 is a note length at `bpm`, sync 0 is the free time. */
export function delaySeconds(time: number, sync: number, bpm: number): number {
  const beats = SYNC_BEATS[sync] ?? 0;
  const s = sync > 0 && beats > 0 ? beats * (60 / bpm) : delayFreeSeconds(time);
  return Math.min(DELAY_MAX_SECONDS, s);
}

/** Feedback 0–127 → loop gain (the word is value/128), kept below 1 so it always dies away. */
export function delayFeedback(v: number): number {
  return Math.min(0.97, v / 128);
}

/** Width 0–127: 0 = the delay returns mono, 127 = full stereo. */
export function delayWidth(v: number): number {
  return v / 127;
}

/** Slew 0–127 → seconds for a delay-time change to settle (guess). */
export function delaySlewSeconds(v: number): number {
  return 0.002 + (v / 127) * 1.5;
}

// ── Reverb ────────────────────────────────────────────────────────────────────────────────────────

/** Room size per type (Chamber … Great Hall), relative. Guess, ordered like the DSP's per-type size word X:$D7. */
export const REVERB_SIZES: readonly number[] = [0.35, 0.55, 0.8, 0.95, 1.25, 1.1];

/** Decay 0–127 → RT60 seconds for a type (guess). */
export function reverbRt60(decay: number, type: number): number {
  const size = REVERB_SIZES[type] ?? 1;
  return (0.25 + 4.75 * (decay / 127) ** 1.6) * size;
}

/** Damping 0–127 → loop low-pass cut-off, hertz (guess: 0 = bright). */
export function reverbDampingHz(d: number): number {
  return 18000 * 2 ** (-(d / 127) * 3.6);
}

// ── Sidechain ─────────────────────────────────────────────────────────────────────────────────────

export function sidechainAttackSeconds(v: number): number { return 0.0005 + (v / 127) * 0.2; }
export function sidechainHoldSeconds(v: number): number { return 0.25 * (v / 127) ** 2; }
export function sidechainDecaySeconds(v: number): number { return 0.01 * 2 ** ((v / 127) * 6.5); }
export function sidechainDepth(v: number): number { return v / 127; }

// ── Drums ─────────────────────────────────────────────────────────────────────────────────────────

/** Playback-rate ratio for drum pitch 0–127 (64 = 1). Exact: (256 + 2·trunc(1.5·(v − 64))) / 256. */
export function drumPitchRatio(v: number): number {
  return (256 + 2 * Math.trunc(1.5 * (v - 64))) / 256;
}

/** Tilt EQ amount g for EQ 0–127: (v − 64) / 64. */
export function drumTilt(v: number): number {
  return (v - 64) / 64;
}

/** Drum decay 0–127 → seconds of the fade after the hit, or Infinity at 127 (guess). */
export function drumDecaySeconds(v: number): number {
  return v >= 127 ? Number.POSITIVE_INFINITY : 0.02 * 2 ** ((v / 127) * 7);
}

/** Drum distortion 0–127 → drive 0–1 (guess). */
export function drumDrive(v: number): number { return v / 127; }

// ── Patch FX ──────────────────────────────────────────────────────────────────────────────────────

/** Distortion level 0–127 → drive 0–1. The DSP word is (v + 44) << 16, full from v = 83; 0 = off. */
export function distortionDrive(level: number): number {
  return level <= 0 ? 0 : Math.min(127, level + 44) / 127;
}

/** Distortion compensation 0–127 → how much of the drive's loudness is taken back (0–1). */
export function distortionCompensation(v: number): number { return v / 127; }

export function eqBassHz(v: number): number { return 30 * 2 ** ((v / 127) * 5); }
export function eqMidHz(v: number): number { return 150 * 2 ** ((v / 127) * 6); }
export function eqTrebleHz(v: number): number { return 1000 * 2 ** ((v / 127) * 4.2); }
/** EQ level 0–127 (64 = 0) → dB, ±12. */
export function eqGainDb(v: number): number { return bipolar(v) * 12; }

/** Chorus level 0–127 → wet amount. */
export function chorusMix(v: number): number { return v / 127; }
export function chorusRateHz(v: number): number { return 0.05 * 2 ** ((v / 127) * 7.6); }
/** Chorus rate in hertz: sync 1–35 is one cycle per note length at `bpm`. */
export function chorusRate(rate: number, sync: number, bpm: number): number {
  const beats = SYNC_BEATS[sync] ?? 0;
  return sync > 0 && beats > 0 ? 1 / (beats * (60 / bpm)) : chorusRateHz(rate);
}
export function chorusDelaySeconds(v: number): number { return 0.002 + (v / 127) * 0.025; }
export function chorusDepthSeconds(v: number): number { return (v / 127) * 0.006; }
export function chorusFeedback(v: number): number { return bipolar(v) * 0.9; }
