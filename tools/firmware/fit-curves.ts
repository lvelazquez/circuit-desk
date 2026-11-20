// Fits the swept DSP words (tools/firmware/sweep.py) and the DSP measurements (tools/firmware/measure-curves.py)
// to physical units, and writes ~/Circuit Desk/Firmware-derived/curves.json. Prints a summary with the constants
// committed to packages/engine/src/nova/curves.ts and fx/curves.ts and each fit's largest error.
// Usage: node tools/firmware/fit-curves.ts [dir]      (dir defaults to ~/Circuit Desk/Firmware-derived)
// Inputs and output stay local and are never committed (decision D-10).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface SweepRow { id: string; values: number[]; words: Record<string, (number | null)[]> }
interface Trace { value: number; trace: number[] }
interface Measure {
  sampleRate: number;
  framesPerBlock: number;
  filter: { value: number; samples: number[] }[];
  eq: { reference: number[]; bands: { band: string; frequency: number; level: number; samples: number[] }[] };
  env: Record<string, { attack: Trace[]; decay: Trace[]; release: Trace[] }>;
  glide: Trace[];
  chorus?: { value: number; incPerBlock: number; x997: number }[];
}

const dir = process.argv[2] ?? join(homedir(), "Circuit Desk", "Firmware-derived");
const sweep = JSON.parse(readFileSync(join(dir, "sweep-synth1.json"), "utf8")) as SweepRow[];
const measurePath = join(dir, "dsp-measure.json");
const measure = existsSync(measurePath) ? (JSON.parse(readFileSync(measurePath, "utf8")) as Measure) : null;

const FS = 0x800000;                  // full scale of a 24-bit fraction
const BLOCK_S = 32 / 48000;           // one control block

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

/** The ARM rewrites a word only when it changes; a missing value means "same as before". */
function fill(vals: (number | null)[]): number[] {
  let last = vals.find((v) => v !== null) ?? 0;
  return vals.map((v) => (v === null ? last : (last = v)));
}

function word(id: string, key: string): { values: number[]; words: number[] } {
  const row = sweep.find((r) => r.id === id);
  const w = row?.words[key];
  if (!row || !w) throw new Error(`no word ${key} for ${id}`);
  return { values: row.values, words: fill(w) };
}

/** Least squares y = a + b x. */
function line(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

/** Largest relative error (ratio form: max |log2(fit/actual)|, reported as percent). */
function maxRelErr(pts: [number, number][], f: (v: number) => number): number {
  return Math.max(...pts.map(([v, y]) => Math.abs(f(v) / y - 1))) * 100;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k), p = i + k, q = p + len / 2;
        const xr = re[q]! * wr - im[q]! * wi, xi = re[q]! * wi + im[q]! * wr;
        re[q] = re[p]! - xr; im[q] = im[p]! - xi; re[p] = re[p]! + xr; im[p] = im[p]! + xi;
      }
    }
  }
}

/** Welch power spectrum (Hann, 50 % overlap). */
function psd(x: number[], n: number): number[] {
  const out = new Array<number>(n / 2).fill(0);
  let segs = 0;
  for (let s = 0; s + n <= x.length; s += n / 2, segs++) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = x[s + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    fft(re, im);
    for (let k = 0; k < n / 2; k++) out[k]! += re[k]! ** 2 + im[k]! ** 2;
  }
  return out.map((v) => v / Math.max(1, segs));
}

/** Smooths a spectrum over ±w bins (noise spectra are rough). */
function smooth(p: number[], w: number): number[] {
  return p.map((_, k) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, k - w); j <= Math.min(p.length - 1, k + w); j++) { s += p[j]!; n++; }
    return s / n;
  });
}


/** Solves A x = B (small, dense) by Gaussian elimination with partial pivoting. */
function solve(A: number[][], B: number[]): number[] {
  const n = B.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k]![i]!) > Math.abs(A[p]![i]!)) p = k;
    [A[i], A[p]] = [A[p]!, A[i]!]; [B[i], B[p]] = [B[p]!, B[i]!];
    for (let k = i + 1; k < n; k++) {
      const f = A[k]![i]! / A[i]![i]!;
      for (let j = i; j < n; j++) A[k]![j]! -= f * A[i]![j]!;
      B[k]! -= f * B[i]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = B[i]!;
    for (let j = i + 1; j < n; j++) s -= A[i]![j]! * x[j]!;
    x[i] = s / A[i]![i]!;
  }
  return x;
}

/** Piecewise-linear interpolation through [x, y] knots, held flat outside them. */
function interp(ks: [number, number][], x: number): number {
  if (x <= ks[0]![0]) return ks[0]![1];
  for (let i = 1; i < ks.length; i++) {
    const [x0, y0] = ks[i - 1]!, [x1, y1] = ks[i]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return ks[ks.length - 1]![1];
}

/**
 * Least-squares fit of log2(y) as a piecewise-linear function of x with knots at fixed positions. Returns the
 * knots ([x, log2 y]) and the largest and RMS relative errors over the points. The firmware's tables step
 * coarsely in places, so the fit is smooth through the steps rather than exact.
 */
function knots(pts: [number, number][], at: number[]): { knots: [number, number][]; maxPct: number; rmsPct: number } {
  const xs = [...new Set(at)].sort((a, b) => a - b);
  const n = xs.length;
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0)), B = new Array<number>(n).fill(0);
  for (const [x, y] of pts) {
    const basis = xs.map((_, i) => interp(xs.map((k, j) => [k, j === i ? 1 : 0] as [number, number]), x));
    for (let i = 0; i < n; i++) { B[i]! += basis[i]! * Math.log2(y); for (let j = 0; j < n; j++) A[i]![j]! += basis[i]! * basis[j]!; }
  }
  for (let i = 0; i < n; i++) A[i]![i]! += 1e-9;
  const ys = solve(A, B);
  // Every curve fitted here rises with the value: keep the knots non-decreasing (least squares can dip
  // by a hair where the firmware's table repeats a value).
  for (let i = 1; i < n; i++) ys[i] = Math.max(ys[i]!, ys[i - 1]!);
  const ks = xs.map((x, i) => [x, ys[i]!] as [number, number]);
  const errs = pts.map(([x, y]) => 2 ** interp(ks, x) / y - 1);
  return { knots: ks, maxPct: Math.max(...errs.map(Math.abs)) * 100, rmsPct: Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length) * 100 };
}

const curves: Record<string, unknown> = {};
const summary: string[] = [];
const missing: string[] = [];
const fmtKnots = (ks: [number, number][]): string => "[" + ks.map(([v, y]) => `[${v}, ${y.toFixed(3)}]`).join(", ") + "]";

// ── 1. Filter frequency ─────────────────────────────────────────────────────────────────────────
// x:3e7 is linear in the value at 0x800000/192 per step, the same unit as the oscillator pitch words (y:148:
// one semitone per step of osc1.semitones), so the word is a log-frequency. It is slewed per block into x:2e9
// (P:$1B89), summed with env 2, tracking and the matrix at P:$6DF into the voice's Y:$91, and the filter's
// coefficient code reads that. The absolute frequency comes from the measured resonant peak.
{
  const w = word("filter.frequency", "set:x:3e7");
  const steps = w.words.slice(1).map((v, i) => v - w.words[i]!);
  const step = steps.find((s) => s !== 0)!;
  const top = w.words.findIndex((v) => v === w.words[w.words.length - 1]);
  const flatFrom = w.values[top] ?? 127;
  const entry: Record<string, unknown> = { word: "x:3e7", base: w.words[0], step, flatFrom, semitonePerStep: Math.abs(step - FS / 192) < 2 };
  if (measure) {
    const N = 8192;
    const pts: [number, number][] = [];
    for (const f of measure.filter) {
      const p = smooth(psd(f.samples, N), 3);
      let k = 4;
      for (let i = 4; i < N / 2 - 1; i++) if (p[i]! > p[k]!) k = i;
      const a = Math.log(p[k - 1]!), b = Math.log(p[k]!), c = Math.log(p[k + 1]!);
      const d = (0.5 * (a - c)) / (a - 2 * b + c);
      pts.push([f.value, ((k + (Number.isFinite(d) ? d : 0)) * 48000) / N]);
    }
    entry.peaks = pts;
    const fitPts = pts.filter(([v, hz]) => hz >= 100 && hz <= 16000 && v < flatFrom);
    const free = line(fitPts.map(([v]) => v), fitPts.map(([, hz]) => Math.log2(hz)));
    // One semitone per step, as the word says: only the reference frequency is fitted.
    const lg = fitPts.reduce((s, [v, hz]) => s + Math.log2(hz) - (v - 64) / 12, 0) / fitPts.length;
    const f64 = 2 ** lg;
    const fit = (v: number): number => f64 * 2 ** ((Math.min(v, flatFrom) - 64) / 12);
    const cents = Math.max(...fitPts.map(([v, hz]) => Math.abs(1200 * Math.log2(fit(v) / hz))));
    entry.fit = { form: "Hz = f64 · 2^((min(v, flatFrom) − 64) / 12)", f64, maxCents: cents, freeStepsPerOctave: 1 / free.b, range: [fitPts[0]?.[0], fitPts[fitPts.length - 1]?.[0]] };
    summary.push(`filterHz: f64 = ${f64.toFixed(1)} Hz at 12 steps/octave (free fit ${(1 / free.b).toFixed(3)}), flat from ${flatFrom}; max error ${cents.toFixed(0)} cents over ${fitPts.length} points (${fitPts[0]?.[0]}–${fitPts[fitPts.length - 1]?.[0]})`);
  } else missing.push("filter: run measure-curves.py for Hz");
  curves.filterFrequency = entry;
}

// ── 2. Envelopes ────────────────────────────────────────────────────────────────────────────────
// Read at note-on: attack words at P:$4E5 (Y:$14E/$150/$154/$156), env 1/2 decay at P:$741 (Y:$14B/$14C),
// env 3 at P:$5D3 (Y:$15E/$160, X:$2CA). Measured on the envelope outputs (Y:$130, $131, $142):
// attack rises linearly by word/2^23 of the peak per block; release and env 3 decay fall by the factor
// 1 − word/2^23 per block; env 1/2 decay words are a coded rate (linear in the value), measured as a factor.
// The ARM takes the words from shared tables at an offset per envelope (exact over the sweep):
// env1 attack = table(v + 33), env1 decay = table(v + 47), env1 release = table(v + 20), env3 release = table(v − 1).
const NOTE_OFF_BLOCK = 60;
const KNOTS = [0, 2, 4, 8, 16, 24, 32, 48, 64, 80, 96, 112];

/** Seconds of a linear attack: the word is the rise per block as a fraction of the peak. */
const attackSeconds = (w: number): number => (FS / w) * BLOCK_S;
/** Seconds to fall to 1/1000 (−60 dB) with a per-block factor r. */
const fallSeconds = (r: number): number => (Math.log(0.001) / Math.log(r)) * BLOCK_S;

/** Per-block factor of an exponential fall toward 0 that starts at index i0. */
function fallRatio(tr: number[], i0: number): number | null {
  const top = tr[i0] ?? 0;
  if (top <= 0) return null;
  let i1 = tr.length - 1;
  for (let i = i0 + 1; i < tr.length; i++) if (tr[i]! < top * 0.01) { i1 = i; break; }
  while (i1 > i0 + 1 && tr[i1]! <= 0) i1--;
  if (i1 <= i0 + 1 || tr[i1]! >= top) return null;
  return (tr[i1]! / top) ** (1 / (i1 - i0));
}

/** The index shift between two word tables (a(v) = b(v + shift)), or null. */
function shiftOf(a: number[], b: number[]): number | null {
  for (let sh = -64; sh <= 64; sh++) {
    let n = 0, ok = 0;
    for (let v = 0; v < 128; v++) { const u = v + sh; if (u < 0 || u > 127) continue; n++; if (a[v] === b[u]) ok++; }
    if (n > 60 && ok === n) return sh;
  }
  return null;
}

const envOut: Record<string, unknown> = {};
{
  const W = (id: string, key: string): number[] => word(id, key).words;
  const atk = [W("env1.attack", "on:y:14e"), W("env2.attack", "on:y:154"), W("env3.attack", "on:y:15e")];
  const dec = [W("env1.decay", "on:y:14b"), W("env2.decay", "on:y:14c"), W("env3.decay", "on:y:160")];
  const rel = [W("env1.release", "on:y:150"), W("env2.release", "on:y:156"), W("env3.release", "set:x:2ca")];
  const shifts = {
    attack: [shiftOf(atk[0]!, atk[1]!), 0, shiftOf(atk[2]!, atk[1]!)],
    decay: [shiftOf(dec[0]!, dec[1]!), 0, null],
    release: [shiftOf(rel[0]!, rel[1]!), 0, shiftOf(rel[2]!, rel[1]!)],
  };
  const flatFrom = (w: number[]): number => w.findIndex((x) => x === w[w.length - 1]);
  const checks: string[] = [];
  const m = measure?.env;

  // Attack table: from the env 2 words (index = value); one point below 0 from env 3 if shifted.
  const attackPts: [number, number][] = atk[1]!.map((w, v) => [v, attackSeconds(w)]);
  if (m) {
    for (const e of ["1", "2", "3"] as const) {
      const words = atk[Number(e) - 1]!;
      const ts = m[e]!.attack.filter((t) => t.trace[3]! < t.trace[4]!);   // still rising: not saturated
      const t0 = ts.find((t) => t.value >= 24) ?? ts[0]!;
      const peak = ((t0.trace[2]! - t0.trace[1]!) * FS) / words[t0.value]!;
      const errs = ts.map((t) => Math.abs((t.trace[2]! - t.trace[1]!) / ((words[t.value]! * peak) / FS) - 1));
      checks.push(`env${e} attack: rise per block = word × peak / 2^23 within ${(Math.max(...errs) * 100).toFixed(2)} % (${ts.length} values)`);
    }
  }
  // Release table: env 2 words (index = value), plus env 3 at value 0 (index −1).
  const releasePts: [number, number][] = rel[1]!.map((w, v) => [v, fallSeconds(1 - w / FS)]);
  if (shifts.release[2] === -1) releasePts.push([-1, fallSeconds(1 - rel[2]![0]! / FS)]);
  const env3DecayPts: [number, number][] = dec[2]!.map((w, v) => [v, fallSeconds(1 - w / FS)]);
  if (m) {
    for (const [e, stage, words] of [["1", "release", rel[0]!], ["2", "release", rel[1]!], ["3", "release", rel[2]!], ["3", "decay", dec[2]!]] as const) {
      const errs: number[] = [];
      for (const t of m[e]![stage]) {
        const i0 = stage === "release" ? NOTE_OFF_BLOCK + 1 : t.trace.indexOf(Math.max(...t.trace)) + 1;
        const r = fallRatio(t.trace, i0);
        if (r !== null && r < 0.9999) errs.push(Math.abs(fallSeconds(r) / fallSeconds(1 - words[t.value]! / FS) - 1));
      }
      checks.push(`env${e} ${stage}: factor 1 − word/2^23 within ${(Math.max(...errs) * 100).toFixed(2)} % of the measured fall (${errs.length} values)`);
    }
  }
  // Decay table (env 1/2): measured; env 1 traces land at index v + shift.
  const decayPts: [number, number][] = [];
  if (m) {
    for (const [e, sh] of [["2", 0], ["1", shifts.decay[0] ?? 0]] as const) {
      for (const t of m[e]!.decay) {
        const r = fallRatio(t.trace, t.trace.indexOf(Math.max(...t.trace)) + 1);
        if (r !== null && r < 0.99995) decayPts.push([t.value + sh, fallSeconds(r)]);
      }
    }
  } else missing.push("env 1/2 decay: needs measure-curves.py");

  const tables = {
    attack: { pts: attackPts, flat: flatFrom(atk[1]!), at: KNOTS },
    decay: { pts: decayPts, flat: flatFrom(dec[1]!), at: KNOTS },
    release: { pts: releasePts, flat: flatFrom(rel[1]!), at: [-1, ...KNOTS] },
    env3Decay: { pts: env3DecayPts, flat: flatFrom(dec[2]!), at: KNOTS },
  };
  for (const [name, t] of Object.entries(tables)) {
    if (!t.pts.length) continue;
    const pts = t.pts.map(([v, s]) => [Math.min(v, t.flat), s] as [number, number]);
    const lastMeasured = Math.max(...pts.map(([v]) => v));
    // Knots only where there are points nearby; above the last measured index the line is extended.
    const near = (k: number): boolean => pts.some(([v]) => Math.abs(v - k) <= 1);
    const at = [...t.at, t.flat - 1, t.flat, lastMeasured].filter((k) => k <= Math.min(t.flat, lastMeasured) && near(k));
    const fit = knots(pts, at);
    if (lastMeasured < t.flat) {
      const [a, b] = fit.knots.slice(-2) as [[number, number], [number, number]];
      fit.knots.push([t.flat, b[1] + ((b[1] - a[1]) / (b[0] - a[0])) * (t.flat - b[0])]);
    }
    envOut[name] = { flatFrom: t.flat, points: t.pts, lastMeasured, fit: { form: "log2(s) piecewise linear in the table index through knots, held from flatFrom", ...fit } };
    summary.push(`env table ${name}: ${2 ** interp(fit.knots, at[0]!) < 0.01 ? (2 ** interp(fit.knots, at[0]!) * 1000).toFixed(2) + " ms" : (2 ** interp(fit.knots, at[0]!)).toFixed(3) + " s"} … ${(2 ** interp(fit.knots, t.flat)).toFixed(2)} s (flat from index ${t.flat}${lastMeasured < t.flat ? `, measured to ${lastMeasured}, extrapolated above` : ""}); knots ${fmtKnots(fit.knots)}; max error ${fit.maxPct.toFixed(1)} %, rms ${fit.rmsPct.toFixed(1)} %`);
  }
  envOut.shifts = shifts;
  summary.push(`env index shifts (env1, env2, env3): attack ${shifts.attack.join(", ")}; decay ${shifts.decay.join(", ")} (env 3 decay is its own table); release ${shifts.release.join(", ")}`);
  envOut.checks = checks;
  summary.push(...checks.map((c) => "  check " + c));
}
curves.envelopes = envOut;

// ── 3. Portamento ───────────────────────────────────────────────────────────────────────────────
// P:$5C0, per block on the glide offset d (Y:$12F, 65 536 per semitone, target 0): d − s toward 0 with
// s = Y:$15A, zero when |d − s| ≤ s, then d × (1 − Y:$15B / 2^23).
{
  const lin = word("voice.portamento", "on:y:15a"), exp = word("voice.portamento", "on:y:15b");
  const step = (d: number, s: number, c: number): number => {
    const a = Math.abs(d) - s;
    return Math.abs(a) <= s ? 0 : a * (1 - c / FS);
  };
  const settle = (s: number, c: number, semis = 12): number => {
    let d = semis * 65536, n = 0;
    while (d > 0 && n < 1e6) { d = step(d, s, c); n++; }
    return n;
  };
  const pts: [number, number][] = lin.values.map((v, i) => [v, settle(lin.words[i]!, exp.words[i]!) * BLOCK_S]);
  let check = "";
  if (measure) {
    let worst = 0, n = 0;
    for (const g of measure.glide) {
      const i = lin.values.indexOf(g.value);
      if (i < 0) continue;
      let d = Math.abs(g.trace[0]!);
      for (let k = 1; k < g.trace.length; k++) {
        d = step(d, lin.words[i]!, exp.words[i]!);
        worst = Math.max(worst, Math.abs(d - Math.abs(g.trace[k]!)));
        n++;
      }
    }
    check = `recurrence replays the DSP's glide offset within ${worst.toFixed(0)} / 65 536 semitone over ${n} blocks`;
  }
  const flat = lin.values[lin.words.findIndex((x) => x !== lin.words[0]) - 1] ?? 0;
  const fit = knots(pts.filter(([v]) => v >= flat), [flat, 32, 48, 64, 80, 96, 112, 127]);
  curves.portamento = { words: ["y:15a", "y:15b"], octaveSettle: pts, flatBelow: flat, fit: { form: "seconds for an octave glide to settle; log2 piecewise linear through knots", ...fit }, check };
  summary.push(`portamento (octave settle): ${pts[0]![1].toPrecision(3)} s (same up to ${flat}) … ${pts[pts.length - 1]![1].toPrecision(3)} s; knots ${fmtKnots(fit.knots)}, max error ${fit.maxPct.toFixed(1)} %, rms ${fit.rmsPct.toFixed(1)} %; ${check}`);
}

// ── 4. Patch EQ ─────────────────────────────────────────────────────────────────────────────────
// Each band against the flat reference, level 0 and 127. Mid: the level-0 notch is sharp, its minimum is the
// centre. Treble: the frequency where the level-127 boost is half its high-frequency value.
if (measure) {
  const N = 8192;
  const ref = smooth(psd(measure.eq.reference, N), 4);
  const hzOf = (k: number): number => (k * 48000) / N;
  const dbOf = (x: number[]): number[] => smooth(psd(x, N), 4).map((v, k) => 10 * Math.log10(v / ref[k]!));
  const rows = (band: string, level: number) => measure.eq.bands.filter((b) => b.band === band && b.level === level);
  const out: Record<string, unknown> = {};
  // Mid
  {
    const pts: [number, number][] = [], boost: number[] = [], cut: number[] = [];
    for (const r of rows("mid", 0)) {
      const db = dbOf(r.samples);
      let k = 8;
      for (let i = 8; i < N / 2 - 8; i++) if (db[i]! < db[k]!) k = i;
      pts.push([r.frequency, hzOf(k)]);
      cut.push(db[k]!);
      const up = rows("mid", 127).find((u) => u.frequency === r.frequency);
      if (up) boost.push(dbOf(up.samples)[k]!);
    }
    // The centre moves linearly in hertz (not in octaves) with the value.
    const l = line(pts.map(([v]) => v), pts.map(([, hz]) => hz));
    const fit = { form: "Hz = a + b v", a: l.a, b: l.b, maxPct: maxRelErr(pts, (v) => l.a + l.b * v) };
    out.mid = { centre: pts, boostDb: [Math.min(...boost), Math.max(...boost)], notchDb: [Math.min(...cut), Math.max(...cut)], fit };
    summary.push(`eq mid centre: Hz = ${l.a.toFixed(1)} + ${l.b.toFixed(3)} v → ${l.a.toFixed(0)}…${(l.a + l.b * 127).toFixed(0)} Hz, max error ${fit.maxPct.toFixed(1)} %; level 127 = +${Math.min(...boost).toFixed(1)}…${Math.max(...boost).toFixed(1)} dB at the centre, level 0 = a notch (${Math.max(...cut).toFixed(0)}…${Math.min(...cut).toFixed(0)} dB)`);
  }
  // Treble
  {
    const pts: [number, number][] = [], top: number[] = [];
    for (const r of rows("treble", 127)) {
      const db = dbOf(r.samples);
      const g = db[Math.round((20000 * N) / 48000)]!;
      top.push(g);
      let k = Math.round((20000 * N) / 48000);
      while (k > 8 && db[k]! > g / 2) k--;
      const t = (g / 2 - db[k]!) / (db[k + 1]! - db[k]!);
      pts.push([r.frequency, hzOf(k + (Number.isFinite(t) ? t : 0))]);
    }
    // Between linear and exponential: a quadratic in the value.
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
    for (const [v, hz] of pts) {
      const b = [1, v, v * v];
      for (let r = 0; r < 3; r++) { B[r]! += b[r]! * hz; for (let c = 0; c < 3; c++) A[r]![c]! += b[r]! * b[c]!; }
    }
    const [q0, q1, q2] = solve(A, B) as [number, number, number];
    const f = (v: number): number => q0 + q1 * v + q2 * v * v;
    const fit = { form: "Hz = a + b v + c v²", a: q0, b: q1, c: q2, maxPct: maxRelErr(pts, f) };
    out.treble = { halfGain: pts, boostAt20kDb: top, fit };
    summary.push(`eq treble half-boost: Hz = ${q0.toFixed(1)} + ${q1.toFixed(3)} v + ${q2.toFixed(5)} v² → ${f(0).toFixed(0)}…${f(127).toFixed(0)} Hz, max error ${fit.maxPct.toFixed(1)} %; level 127 boost at 20 kHz ${Math.min(...top).toFixed(1)}…${Math.max(...top).toFixed(1)} dB (smaller as the corner nears Nyquist)`);
  }
  // Bass: not a shelf; record its shape only.
  {
    const shape = rows("bass", 127).map((r) => {
      const db = dbOf(r.samples);
      let k = 8;
      for (let i = 8; i < N / 4; i++) if (Math.abs(db[i]!) > Math.abs(db[k]!)) k = i;
      const low = dbOf(rows("bass", 0).find((z) => z.frequency === r.frequency)!.samples)[8]!;
      return { frequency: r.frequency, extremeHz: hzOf(k), extremeDb: db[k]!, level0At47HzDb: low };
    });
    out.bass = { shape };
    missing.push(`eq bass: not a shelf in the DSP: level 127 gives a ${Math.min(...shape.map((s) => s.extremeDb)).toFixed(1)}…${Math.max(...shape.map((s) => s.extremeDb)).toFixed(1)} dB bump or dip (not +12 dB), level 0 a steep low cut (${Math.max(...shape.map((s) => s.level0At47HzDb)).toFixed(0)}…${Math.min(...shape.map((s) => s.level0At47HzDb)).toFixed(0)} dB at 47 Hz); kept as a guess until the band's routine is read`);
  }
  missing.push("eq gain: boosts reach about +11 dB (mid, treble), but level 0 is a notch / low-pass, not −12 dB; eqGainDb stays a guess");
  curves.eq = out;
} else missing.push("eq: run measure-curves.py");

// ── 5. Chorus ───────────────────────────────────────────────────────────────────────────────────
// Free rate (P:$102E): phase += (word)² × X:$997 per block, phase 2^24 per cycle, word = value / 128.
// X:$997 is entry 9 of the X:$98E table the ARM writes at boot (0x08029710); the sync branch reads the
// same table scaled by X:$15 (tempo, not set in emulation).
if (measure?.chorus?.length) {
  const k = measure.chorus[0]!.x997;
  const pred = (v: number): number => (v / 128) ** 2 * k;
  const errs = measure.chorus.filter((c) => c.value > 0).map((c) => Math.abs(c.incPerBlock / pred(c.value) - 1));
  const hzFull = (k * 1500) / 2 ** 24;
  curves.chorusRate = { form: "Hz = (v / 128)² · X:$997 · 1500 / 2^24", x997: k, hzAtFullScale: hzFull, points: measure.chorus, maxPct: Math.max(...errs) * 100 };
  summary.push(`chorus rate: Hz = ${hzFull.toFixed(4)} · (v/128)² (X:$997 = ${k}); phase step matches (word)² × X:$997 within ${(Math.max(...errs) * 100).toFixed(2)} % over ${errs.length} values`);
} else missing.push("chorus rate: run measure-curves.py (with the boot tables)");
missing.push(
  "chorus delay/depth/feedback: words are value << 16 (y:780, y:77f) and 2·(value − 64) << 16 (y:781); the delay-line code (P:$105F) scales by X:$9B0 (boot table), not decoded further",
  "chorus and LFO sync: the boot table X:$98E has the ratios of the LFO ladder (1, 1.5, 2 … 768); the absolute rate needs X:$15 (tempo), not set in emulation",
  "project delay time/sync and reverb decay/damping: the master section does not run in the oracle; delay sync indexes the X:$98E table; reverb decay goes as 15/16 · value to X:$D1, damping as the value to X:$D2",
);

const outPath = join(dir, "curves.json");
writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), curves, missing }, null, 1));
console.log(summary.join("\n"));
console.log("\nNot derived:\n- " + missing.join("\n- "));
console.log(`\nwrote ${outPath}`);
