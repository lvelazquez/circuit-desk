// Analysis of a recorded device note (plan Track 3): onsets, fundamental pitch (normalised
// autocorrelation, McLeod's peak picking), level, attack and decay. Pure, on mono float samples.

export const dB = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Frame RMS of each block of `hop` samples. */
function frameRms(x: Float32Array, hop: number): Float32Array {
  const n = Math.max(0, Math.floor(x.length / hop)), out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0, c = 0;
    for (let i = f * hop; i < Math.min(x.length, (f + 1) * hop); i++) { s += x[i]! * x[i]!; c++; }
    out[f] = Math.sqrt(s / Math.max(1, c));
  }
  return out;
}

export interface OnsetOptions {
  /** Hop for the level frames, s. Default 0.005. */
  hop?: number;
  /** An onset needs the level at least this far above the noise floor, dB. Default 12. */
  aboveNoiseDb?: number;
  /** …and no lower than this far below the loudest frame, dB. Default −40. */
  belowPeakDb?: number;
  /** Shortest time between two onsets, s. Default 0.05. */
  minGap?: number;
}

/** Note starts (and the frame where each falls back to silence), in seconds. */
export function detectOnsets(x: Float32Array, sampleRate: number, o: OnsetOptions = {}): { start: number; end: number }[] {
  const hop = Math.max(1, Math.round((o.hop ?? 0.005) * sampleRate));
  const env = frameRms(x, hop);
  if (!env.length) return [];
  const sorted = Float32Array.from(env).sort();
  const noise = sorted[Math.floor(sorted.length * 0.1)]!, peak = sorted[sorted.length - 1]!;
  if (peak <= 0) return [];
  const on = Math.max(noise * 10 ** ((o.aboveNoiseDb ?? 12) / 20), peak * 10 ** ((o.belowPeakDb ?? -40) / 20));
  const off = on / 2, gap = Math.round((o.minGap ?? 0.05) * sampleRate / hop);
  const out: { start: number; end: number }[] = [];
  let active = false, last = -Infinity, start = 0;
  for (let f = 0; f < env.length; f++) {
    if (!active && env[f]! >= on && f - last >= gap) {
      // Back up over the frames already rising out of the floor.
      let s = f;
      while (s > 0 && env[s - 1]! > noise * 2 && env[s - 1]! < env[s]!) s--;
      // Then to the first sample of those frames that is as loud as the threshold.
      let i = Math.max(0, (s - 1) * hop);
      while (i < (f + 1) * hop && Math.abs(x[i]!) < on) i++;
      active = true; start = i / hop; last = f;
    } else if (active && env[f]! < off) {
      active = false;
      out.push({ start: (start * hop) / sampleRate, end: (f * hop) / sampleRate });
    }
  }
  if (active) out.push({ start: (start * hop) / sampleRate, end: x.length / sampleRate });
  return out;
}

export interface Pitch {
  hz: number;
  /** Peak of the normalised autocorrelation, 0–1: how periodic the window is. */
  clarity: number;
}

/**
 * Fundamental frequency of `x` (a window of one note's steady part) by the normalised square
 * difference function, picking the first key maximum within 0.9 of the highest, as McLeod and Wyvill
 * do, with parabolic interpolation. Null when nothing is periodic in the range.
 */
export function estimatePitch(x: Float32Array, sampleRate: number, minHz = 25, maxHz = 4200): Pitch | null {
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz)), maxLag = Math.min(Math.floor(x.length / 2), Math.ceil(sampleRate / minHz));
  if (maxLag <= minLag) return null;
  const nsdf = new Float64Array(maxLag + 2);
  for (let tau = 0; tau <= maxLag + 1; tau++) {
    let r = 0, m = 0;
    for (let i = 0; i + tau < x.length; i++) { const a = x[i]!, b = x[i + tau]!; r += a * b; m += a * a + b * b; }
    nsdf[tau] = m > 0 ? (2 * r) / m : 0;
  }
  // Key maxima: the highest point between each positive-going zero crossing and the next negative-going one.
  const peaks: number[] = [];
  let tau = 1;
  while (tau < maxLag && nsdf[tau]! > 0) tau++; // leave the lag-0 lobe
  for (; tau <= maxLag; tau++) {
    if (nsdf[tau - 1]! <= 0 && nsdf[tau]! > 0) {
      let best = tau;
      while (tau <= maxLag && nsdf[tau]! > 0) { if (nsdf[tau]! > nsdf[best]!) best = tau; tau++; }
      if (best >= minLag) peaks.push(best);
    }
  }
  if (!peaks.length) return null;
  const top = Math.max(...peaks.map((p) => nsdf[p]!));
  if (top < 0.3) return null;
  const p = peaks.find((q) => nsdf[q]! >= 0.9 * top)!;
  const a = nsdf[p - 1]!, b = nsdf[p]!, c = nsdf[p + 1]!, den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return { hz: sampleRate / (p + shift), clarity: b };
}

/** MIDI note (69 = A4 = 440 Hz), nearest note and its deviation in cents. */
export function hzToMidi(hz: number): { midi: number; note: number; cents: number; name: string } {
  const midi = 69 + 12 * Math.log2(hz / 440), note = Math.round(midi);
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return { midi, note, cents: Math.round((midi - note) * 1000) / 10, name: `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}` };
}

/** The amplitude envelope: the largest |x| in a window of `win` samples centred on every `hop`-th sample. */
function peakEnvelope(x: Float32Array, win: number, hop: number): Float32Array {
  const n = Math.ceil(x.length / hop), out = new Float32Array(n), half = Math.floor(win / 2);
  for (let k = 0; k < n; k++) {
    let m = 0;
    for (let i = Math.max(0, k * hop - half); i < Math.min(x.length, k * hop + half + 1); i++) m = Math.max(m, Math.abs(x[i]!));
    out[k] = m;
  }
  return out;
}

export interface NoteAnalysis {
  /** s from the start of the file. */
  onset: number;
  end: number;
  hz: number | null;
  clarity: number | null;
  midi: number | null;
  note: number | null;
  name: string | null;
  cents: number | null;
  peakDb: number;
  rmsDb: number;
  /** 10 % → 90 % of the envelope's peak, ms. */
  attackMs: number | null;
  /** Peak → 20 dB below the peak, ms; null when the note does not fall that far before it ends. */
  decayMs: number | null;
  /** With a note-off time: level just before it relative to the peak, dB, and the fall of 20 dB after it, ms. */
  sustainDb?: number | null;
  releaseMs?: number | null;
  /**
   * Rate of a periodic level change on the held part (an LFO on the filter or level), Hz, from the
   * envelope's own autocorrelation; null when the held part is shorter than 0.5 s or not periodic.
   * The held part must last at least two periods (hold a 0.5 Hz LFO for 4 s or more).
   */
  modHz: number | null;
}

/**
 * One note, from `onset` to `end` (s). `release`: the note-off time, when known (events JSON).
 * The pitch is measured on the steady part: after the attack, at most 0.25 s of it.
 */
export function analyseNote(x: Float32Array, sampleRate: number, onset: number, end: number, release?: number): NoteAnalysis {
  const a = Math.max(0, Math.floor(onset * sampleRate)), b = Math.min(x.length, Math.ceil(end * sampleRate));
  const seg = x.subarray(a, b);
  let peak = 0, sq = 0;
  for (const v of seg) { peak = Math.max(peak, Math.abs(v)); sq += v * v; }
  const rms = Math.sqrt(sq / Math.max(1, seg.length));

  // Pitch first (on a window after the first 50 ms), so the envelope window can be one period.
  const skip = Math.min(Math.floor(0.05 * sampleRate), Math.floor(seg.length / 4));
  const win = seg.subarray(skip, Math.min(seg.length, skip + Math.floor(0.25 * sampleRate)));
  const pitch = estimatePitch(win, sampleRate);
  const m = pitch ? hzToMidi(pitch.hz) : null;

  const hop = Math.max(1, Math.round(0.0005 * sampleRate));
  const period = pitch ? Math.round(sampleRate / pitch.hz) : Math.round(0.005 * sampleRate);
  const env = peakEnvelope(seg, Math.max(period, Math.round(0.001 * sampleRate)), hop);
  let pk = 0, pkAt = 0;
  for (let k = 0; k < env.length; k++) if (env[k]! > pk) { pk = env[k]!; pkAt = k; }
  const first = (from: number, to: number, pred: (v: number) => boolean): number | null => {
    for (let k = from; k < to; k++) if (pred(env[k]!)) return k;
    return null;
  };
  const t10 = first(0, pkAt + 1, (v) => v >= 0.1 * pk), t90 = first(0, pkAt + 1, (v) => v >= 0.9 * pk);
  const relK = release !== undefined ? Math.round(((release - onset) * sampleRate) / hop) : null;
  const decayEnd = relK !== null ? Math.min(env.length, Math.max(pkAt, relK)) : env.length;
  const d20 = first(pkAt, decayEnd, (v) => v <= 0.1 * pk);
  const ms = (k: number): number => Math.round(((k * hop) / sampleRate) * 10000) / 10;

  const out: NoteAnalysis = {
    onset, end,
    hz: pitch ? Math.round(pitch.hz * 100) / 100 : null,
    clarity: pitch ? Math.round(pitch.clarity * 1000) / 1000 : null,
    midi: m ? Math.round(m.midi * 1000) / 1000 : null,
    note: m?.note ?? null, name: m?.name ?? null, cents: m?.cents ?? null,
    peakDb: Math.round(dB(peak) * 10) / 10,
    rmsDb: Math.round(dB(rms) * 10) / 10,
    attackMs: t10 !== null && t90 !== null && pk > 0 ? ms(t90 - t10) : null,
    decayMs: d20 !== null ? ms(d20 - pkAt) : null,
    modHz: modulationHz(env, sampleRate / hop, Math.max(pkAt, Math.round(0.1 * sampleRate / hop)), relK !== null && relK > 0 ? Math.min(env.length, relK) : env.length),
  };
  if (relK !== null && relK > 0 && relK < env.length) {
    const before = env[Math.max(0, relK - 1)]!;
    out.sustainDb = pk > 0 && before > 0 ? Math.round(dB(before / pk) * 10) / 10 : null;
    const r20 = first(relK, env.length, (v) => v <= 0.1 * before);
    out.releaseMs = r20 !== null ? ms(r20 - relK) : null;
  }
  return out;
}

/** Periodicity of env[from, to) (sampled at `rate` Hz) between 0.1 and 40 Hz, with its mean removed. */
function modulationHz(env: Float32Array, rate: number, from: number, to: number): number | null {
  if ((to - from) / rate < 0.5) return null;
  // Down to a 500 Hz envelope: plenty for 40 Hz, and keeps the autocorrelation small.
  const step = Math.max(1, Math.round(rate / 500)), n = Math.floor((to - from) / step), e = new Float32Array(n);
  let mean = 0;
  for (let k = 0; k < n; k++) { e[k] = env[from + k * step]!; mean += e[k]! / n; }
  let dev = 0;
  for (let k = 0; k < n; k++) { e[k]! -= mean; dev = Math.max(dev, Math.abs(e[k]!)); }
  if (mean <= 0 || dev / mean < 0.02) return null; // under 2 %: steady
  const p = estimatePitch(e, rate / step, 0.1, 40);
  return p && p.clarity > 0.5 ? Math.round(p.hz * 1000) / 1000 : null;
}

/** A note the recorder sent: note-on time and, when found, its note-off (s from the start of audio.wav). */
export interface SentNote {
  on: number;
  off: number | null;
  channel: number;
  note: number;
  velocity: number;
}

/** Note-ons paired with their note-offs from an event log ({ offset, bytes }). */
export function sentNotes(events: readonly { offset: number; bytes: readonly number[] }[]): SentNote[] {
  const out: SentNote[] = [], open = new Map<string, SentNote>();
  for (const e of [...events].sort((p, q) => p.offset - q.offset)) {
    const [s = 0, d1 = 0, d2 = 0] = e.bytes, kind = s & 0xf0, ch = s & 15, key = `${ch}:${d1}`;
    if (kind === 0x90 && d2 > 0) { const n = { on: e.offset, off: null, channel: ch, note: d1, velocity: d2 }; out.push(n); open.set(key, n); }
    else if (kind === 0x80 || kind === 0x90) { const n = open.get(key); if (n) { n.off = e.offset; open.delete(key); } }
  }
  return out;
}

export interface RecordingAnalysis {
  sampleRate: number;
  seconds: number;
  noiseDb: number;
  notes: (NoteAnalysis & { sent?: SentNote; latencyMs?: number | null })[];
}

/**
 * The whole recording. With the sent notes, each note's window runs from its note-on to the next
 * note-on (or the end), its onset is searched from 50 ms before the note-on, and the latency from
 * note-on to heard onset is reported. Without them, onsets come from the level alone.
 */
export function analyseRecording(x: Float32Array, sampleRate: number, sent?: readonly SentNote[]): RecordingAnalysis {
  const quiet = Float32Array.from(frameRms(x, Math.max(1, Math.round(0.005 * sampleRate)))).sort();
  const noiseDb = Math.round(dB(quiet[Math.floor(quiet.length * 0.1)] ?? 0) * 10) / 10;
  const seconds = x.length / sampleRate;
  if (!sent?.length) {
    return { sampleRate, seconds, noiseDb, notes: detectOnsets(x, sampleRate).map((o) => analyseNote(x, sampleRate, o.start, o.end)) };
  }
  const notes = sent.map((n, i) => {
    const from = Math.max(0, n.on - 0.05), to = Math.min(seconds, sent[i + 1]?.on ?? seconds);
    const a = Math.floor(from * sampleRate), b = Math.ceil(to * sampleRate);
    const found = detectOnsets(x.subarray(a, b), sampleRate)[0];
    if (!found) return { ...analyseNote(x, sampleRate, n.on, to, n.off ?? undefined), sent: n, latencyMs: null };
    const onset = from + found.start;
    return { ...analyseNote(x, sampleRate, onset, to, n.off ?? undefined), sent: n, latencyMs: Math.round((onset - n.on) * 10000) / 10 };
  });
  return { sampleRate, seconds, noiseDb, notes };
}

/**
 * Short runs of exact digital silence (`minMs`–`maxMs`) with sound on both sides: capture dropouts,
 * since a real input always carries some noise. Longer runs are gaps between notes (a fake input, or
 * an interface with a gate). Each: start (s) and length (ms).
 */
export function findDropouts(x: Float32Array, sampleRate: number, minMs = 1, maxMs = 100): { at: number; ms: number }[] {
  const min = Math.max(2, Math.round((minMs / 1000) * sampleRate)), max = Math.round((maxMs / 1000) * sampleRate), out: { at: number; ms: number }[] = [];
  let i = 0;
  while (i < x.length && x[i] === 0) i++; // leading silence is not a dropout
  while (i < x.length) {
    if (x[i] !== 0) { i++; continue; }
    const s = i;
    while (i < x.length && x[i] === 0) i++;
    if (i < x.length && i - s >= min && i - s <= max) out.push({ at: s / sampleRate, ms: Math.round(((i - s) / sampleRate) * 10000) / 10 });
  }
  return out;
}
