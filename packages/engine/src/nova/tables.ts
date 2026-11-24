// The oscillator wavetables (waves 14–29) and LFO shapes the Nova voice plays when they are loaded.
// They come from Novation Components (tools/components-tables.ts writes them under
// ~/Circuit Desk/Components-derived/, never into the repo) and reach the engine at run time:
// setNovaTables() here in Node, NovaInit.tables in the AudioWorklet. Without them the voice keeps
// its stand-ins (voice.ts, lfo.ts).
//
// What the tables are (read from Components' editor, bundle main-D3lNZfPT.js):
// - wavetables: 16 waves × 9 frames × 128 unsigned 8-bit samples, 128 = 0; wave 14 + i is
//   WAVETABLE_FILES[i] in tools/components-tables.ts;
// - LFO: 38 waves × 250 unsigned 8-bit samples, one cycle each, the device's order.
// They are what the editor draws: Novation's own shapes, not proven bit-identical to the device DSP
// (8-bit, and the device keeps larger tables in core 1's memory).

export const WAVETABLE_COUNT = 16, WAVETABLE_FRAMES = 9, FRAME_LEN = 128;
export const LFO_WAVES = 38, LFO_LEN = 250;

/** The raw bytes, as the loader and NovaInit carry them. */
export interface NovaTableBytes {
  /** WAVETABLE_COUNT × WAVETABLE_FRAMES × FRAME_LEN bytes, wave-major. */
  wavetables: Uint8Array;
  /** LFO_WAVES × LFO_LEN bytes. */
  lfo: Uint8Array;
}

/** Harmonic caps of the band-limited copies of each frame (a 128-sample frame holds up to 64). */
const CAPS = [64, 32, 16, 8, 4, 2, 1] as const;

/** [wave − 14][frame][cap index] → one band-limited cycle of FRAME_LEN samples, −1…1, no DC. */
let wavetables: Float32Array[][][] | null = null;
/** [wave] → LFO_LEN samples, −1…1. */
let lfoShapes: Float32Array[] | null = null;
/** [wave] → the table's largest byte (the melodic shapes are scaled to fill the display). */
let lfoMax: number[] = [];

/** Checks the sizes; throws on anything else, so a bad file never plays as noise. */
export function checkTableBytes(t: NovaTableBytes): void {
  const wt = WAVETABLE_COUNT * WAVETABLE_FRAMES * FRAME_LEN, lfo = LFO_WAVES * LFO_LEN;
  if (t.wavetables.length !== wt) throw new Error(`wavetables: ${t.wavetables.length} bytes, expected ${wt}`);
  if (t.lfo.length !== lfo) throw new Error(`LFO tables: ${t.lfo.length} bytes, expected ${lfo}`);
}

/** Loads the tables into this scope (the worklet's or Node's), or drops them with null. */
export function setNovaTables(t: NovaTableBytes | null): void {
  if (!t) { wavetables = null; lfoShapes = null; lfoMax = []; return; }
  checkTableBytes(t);
  const wt: Float32Array[][][] = [];
  for (let w = 0; w < WAVETABLE_COUNT; w++) {
    const frames: Float32Array[][] = [];
    for (let f = 0; f < WAVETABLE_FRAMES; f++) {
      const at = (w * WAVETABLE_FRAMES + f) * FRAME_LEN;
      frames.push(bandLimited(Array.from(t.wavetables.subarray(at, at + FRAME_LEN), (v) => (v - 128) / 128)));
    }
    wt.push(frames);
  }
  const shapes: Float32Array[] = [], max: number[] = [];
  for (let w = 0; w < LFO_WAVES; w++) {
    const raw = t.lfo.subarray(w * LFO_LEN, (w + 1) * LFO_LEN);
    shapes.push(Float32Array.from(raw, (v) => (v - 128) / 128));
    max.push(Math.max(1, ...raw));
  }
  wavetables = wt; lfoShapes = shapes; lfoMax = max;
}

export function novaTablesLoaded(): boolean { return wavetables !== null; }

/** The frame's copies with harmonics 1…cap for each cap in CAPS (a direct DFT: 128 points, once). */
function bandLimited(x: readonly number[]): Float32Array[] {
  const n = x.length, half = n / 2;
  const re = new Float64Array(half + 1), im = new Float64Array(half + 1);
  for (let k = 1; k <= half; k++) {
    let r = 0, i = 0;
    for (let j = 0; j < n; j++) { const a = (2 * Math.PI * k * j) / n; r += x[j]! * Math.cos(a); i -= x[j]! * Math.sin(a); }
    re[k] = r / n; im[k] = i / n;
  }
  return CAPS.map((cap) => {
    const out = new Float32Array(n);
    for (let k = 1; k <= cap; k++) {
      const scale = k === half ? 1 : 2; // the Nyquist bin has no mirror
      for (let j = 0; j < n; j++) { const a = (2 * Math.PI * k * j) / n; out[j]! += scale * (re[k]! * Math.cos(a) - im[k]! * Math.sin(a)); }
    }
    return out;
  });
}

/** The copy with the most harmonics that stay below Nyquist at `dt` cycles per sample. */
function capIndex(dt: number): number {
  const most = dt > 0 ? 0.5 / dt : Infinity;
  const i = CAPS.findIndex((c) => c <= most);
  return i < 0 ? CAPS.length - 1 : i;
}

function readCycle(t: Float32Array, phase: number): number {
  const pos = phase * FRAME_LEN;
  const i = Math.floor(pos), f = pos - i;
  const a = t[i % FRAME_LEN]!, b = t[(i + 1) % FRAME_LEN]!;
  return a + (b - a) * f;
}

/**
 * Where a wavetable reads, from Components' display code: `index` is the stored Pulse Width/Index
 * byte (0–127, 64 = centre) with any modulation added, `interpolate` the stored Wave Interpolate.
 * Position = 8 × (index + 1) / 128 over frames 0–8; interpolate 0 steps between frames, 127
 * crossfades linearly, and values between bend the crossfade into an S with exponent
 * (127 − interpolate) / 16 + 1.
 */
export function wavetableFrames(index: number, interpolate: number): { a: number; b: number; w: number } {
  const pos = (8 * (index + 1)) / 128;
  const a = Math.min(8, Math.floor(pos)), b = Math.min(8, a + 1), t = pos - a;
  if (interpolate <= 0) return { a, b, w: 0 };
  const k = (127 - interpolate) / 16 + 1;
  const w = t < 0.5 ? 0.5 * (2 * t) ** k : 1 - 0.5 * (2 * (1 - t)) ** k;
  return { a, b, w };
}

/** One wavetable sample, or null when the tables are not loaded (the caller plays its stand-in). */
export function wavetableSample(wave: number, index: number, interpolate: number, phase: number, dt: number): number | null {
  const frames = wavetables?.[wave - 14];
  if (!frames) return null;
  const c = capIndex(dt);
  const { a, b, w } = wavetableFrames(index, interpolate);
  const x = readCycle(frames[a]![c]!, phase);
  return w > 0 ? x + (readCycle(frames[b]![c]!, phase) - x) * w : x;
}

/** The LFO table at phase 0–1 (no interpolation: most shapes are steps), or null when not loaded. */
export function lfoTableValue(wave: number, phase: number): number | null {
  const s = lfoShapes?.[wave];
  return s ? s[Math.min(LFO_LEN - 1, Math.floor(phase * LFO_LEN))]! : null;
}

/** The raw table byte over its own maximum, 0–1 (for the melodic shapes), or null when not loaded. */
export function lfoTableLevel(wave: number, phase: number): number | null {
  const s = lfoShapes?.[wave];
  if (!s) return null;
  const v = s[Math.min(LFO_LEN - 1, Math.floor(phase * LFO_LEN))]! * 128 + 128;
  return v / lfoMax[wave]!;
}

/** Bytes from the JSON tools/components-tables.ts writes (its `wavetables` and `lfo` fields). */
export function tableBytesFromDoc(doc: {
  wavetables: Record<string, { frames: number[][] }>;
  lfo: readonly { samples: number[] }[];
}): NovaTableBytes {
  const wt = new Uint8Array(WAVETABLE_COUNT * WAVETABLE_FRAMES * FRAME_LEN);
  for (let w = 0; w < WAVETABLE_COUNT; w++) {
    const frames = doc.wavetables[String(14 + w)]?.frames;
    if (frames?.length !== WAVETABLE_FRAMES) throw new Error(`wavetable ${14 + w} missing or not ${WAVETABLE_FRAMES} frames`);
    frames.forEach((fr, f) => wt.set(fr, (w * WAVETABLE_FRAMES + f) * FRAME_LEN));
  }
  const lfo = new Uint8Array(LFO_WAVES * LFO_LEN);
  doc.lfo.forEach((l, i) => lfo.set(l.samples, i * LFO_LEN));
  const t = { wavetables: wt, lfo };
  checkTableBytes(t);
  return t;
}
