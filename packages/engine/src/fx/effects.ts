// The effects themselves. Each class is pure DSP, sample by sample, and says how faithful it is.
import * as C from "./curves.ts";
import { Biquad, DelayLine, OnePole } from "./dsp.ts";

export type Fidelity = "exact" | "approximate";

// ── Sidechain (shape exact, times guessed) ────────────────────────────────────────────────────────

/** The ducking envelope: rise over attack, hold, then fall over decay. Gain = 1 − env × depth. */
export class SidechainEnv {
  static readonly fidelity: Fidelity = "approximate";
  private stage: "idle" | "attack" | "hold" | "decay" = "idle";
  private env = 0;
  private holdLeft = 0;
  private attackStep = 1;
  private holdSamples = 0;
  private decayMul = 0;
  private depth = 0;
  private readonly sr: number;
  constructor(sr: number) { this.sr = sr; }
  set(attack: number, hold: number, decay: number, depth: number): void {
    this.attackStep = 1 / Math.max(1, C.sidechainAttackSeconds(attack) * this.sr);
    this.holdSamples = Math.round(C.sidechainHoldSeconds(hold) * this.sr);
    this.decayMul = Math.exp(-1 / Math.max(1, C.sidechainDecaySeconds(decay) * this.sr));
    this.depth = C.sidechainDepth(depth);
  }
  trigger(): void { if (this.depth > 0) this.stage = "attack"; }
  next(): number {
    switch (this.stage) {
      case "attack": this.env += this.attackStep; if (this.env >= 1) { this.env = 1; this.stage = "hold"; this.holdLeft = this.holdSamples; } break;
      case "hold": if (--this.holdLeft <= 0) this.stage = "decay"; break;
      case "decay": this.env *= this.decayMul; if (this.env < 1e-4) { this.env = 0; this.stage = "idle"; } break;
      default: break;
    }
    return 1 - this.env * this.depth;
  }
}

// ── Drum strip: tilt EQ (exact) and distortion (approximate) ──────────────────────────────────────

/** The stock drum EQ: a one-pole low-pass with k = 0.075 at 48 kHz; out = in·(1+g) − 2g·lp. */
export class TiltEq {
  static readonly fidelity: Fidelity = "exact";
  private lp = 0;
  private readonly k: number;
  constructor(sr: number) { this.k = 1 - (1 - 0.075) ** (48000 / sr); }
  process(x: number, g: number): number {
    this.lp += this.k * (x - this.lp);
    return x * (1 + g) - 2 * g * this.lp;
  }
}

/** Drum distortion: a soft waveshaper with loudness normalised (approximate; the DSP uses a table). */
export function drumShape(x: number, drive: number): number {
  if (drive <= 0) return x;
  const k = 1 + drive * 12;
  return Math.tanh(x * k) / Math.tanh(k);
}

// ── Delay (approximate, except the L/R time ratios) ───────────────────────────────────────────────

export interface DelayParams { time: number; sync: number; feedback: number; width: number; ratio: number; slew: number }

/** Stereo delay: each side has its own time (by the L/R ratio) and feedback; width blends to mono. */
export class StereoDelay {
  static readonly fidelity: Fidelity = "approximate";
  private readonly lines: [DelayLine, DelayLine];
  private target: [number, number] = [0, 0];
  private time: [number, number] = [0, 0];
  private on: [boolean, boolean] = [true, true];
  private fb = 0;
  private width = 1;
  private slew = 1;
  private readonly sr: number;
  constructor(sr: number) {
    this.sr = sr;
    const max = C.DELAY_MAX_SECONDS * sr + 4;
    this.lines = [new DelayLine(max), new DelayLine(max)];
  }
  set(p: DelayParams, bpm: number): void {
    const base = C.delaySeconds(p.time, p.sync, bpm) * this.sr;
    const [l, r] = C.DELAY_RATIO_GAINS[p.ratio] ?? [1, 1];
    this.on = [l > 0, r > 0];
    this.target = [Math.max(1, base * (l || 1)), Math.max(1, base * (r || 1))];
    if (this.time[0] === 0) this.time = [...this.target];
    this.fb = C.delayFeedback(p.feedback);
    this.width = C.delayWidth(p.width);
    this.slew = 1 - Math.exp(-1 / (C.delaySlewSeconds(p.slew) * this.sr));
  }
  /** Adds the delay's output for input (inL, inR) to out[0], out[1]. */
  process(inL: number, inR: number, out: [number, number]): void {
    const y: [number, number] = [0, 0];
    for (let c = 0; c < 2; c++) {
      this.time[c] = this.time[c]! + (this.target[c]! - this.time[c]!) * this.slew;
      const line = this.lines[c]!;
      const d = line.read(this.time[c]!);
      line.write((c === 0 ? inL : inR) + d * this.fb);
      y[c] = this.on[c] ? d : 0;
    }
    const mid = (y[0] + y[1]) / 2;
    out[0] += mid + (y[0] - mid) * this.width;
    out[1] += mid + (y[1] - mid) * this.width;
  }
}

// ── Reverb (approximate: an 8-line feedback delay network) ────────────────────────────────────────

const FDN_LENGTHS_MS = [29.7, 37.1, 41.1, 43.7, 53.0, 59.9, 67.3, 73.1];

export class Reverb {
  static readonly fidelity: Fidelity = "approximate";
  private readonly lines: DelayLine[];
  private readonly damp = FDN_LENGTHS_MS.map(() => new OnePole());
  private lengths: number[] = [];
  private gains: number[] = [];
  private readonly pre: DelayLine;
  private readonly sr: number;
  constructor(sr: number) {
    this.sr = sr;
    this.lines = FDN_LENGTHS_MS.map((ms) => new DelayLine((ms * 1.5 * sr) / 1000 + 4));
    this.pre = new DelayLine(0.05 * sr);
  }
  set(type: number, decay: number, damping: number): void {
    const size = C.REVERB_SIZES[type] ?? 1;
    const rt60 = C.reverbRt60(decay, type);
    this.lengths = FDN_LENGTHS_MS.map((ms) => (ms * Math.min(1.5, size) * this.sr) / 1000);
    // Each pass through a line of length L loses 60 dB over rt60 seconds.
    this.gains = this.lengths.map((len) => 10 ** ((-3 * len) / (rt60 * this.sr)));
    for (const f of this.damp) f.set(C.reverbDampingHz(damping), this.sr);
  }
  process(inL: number, inR: number, out: [number, number]): void {
    const x = (inL + inR) * 0.5;
    this.pre.write(x);
    const xin = this.pre.read(0.012 * this.sr);
    const s = this.lines.map((l, i) => this.damp[i]!.process(l.read(this.lengths[i]!)) * this.gains[i]!);
    // Householder feedback: s_i − (2/N)·Σs keeps the energy and mixes every line into every other.
    const sum = s.reduce((a, b) => a + b, 0) * (2 / s.length);
    this.lines.forEach((l, i) => l.write(xin + s[i]! - sum));
    let l = 0, r = 0;
    s.forEach((v, i) => { if (i % 2) r += v; else l += v; });
    out[0] += l * 0.35;
    out[1] += r * 0.35;
  }
}

// ── Patch distortion (approximate shapes; level mapping from the DSP word) ────────────────────────

export class Distortion {
  static readonly fidelity: Fidelity = "approximate";
  private type = 0;
  private drive = 0;
  private comp = 0;
  private hold = 0;
  private holdCount = 0;
  set(type: number, level: number, compensation: number): void {
    this.type = type; this.drive = C.distortionDrive(level); this.comp = C.distortionCompensation(compensation);
  }
  get active(): boolean { return this.drive > 0; }
  process(x: number): number {
    if (this.drive <= 0) return x;
    const k = 1 + this.drive * 15;
    let y: number;
    switch (this.type) {
      case 0: y = x >= 0 ? Math.tanh(x * k) : Math.tanh(x * k * 0.6) / 0.6; break;           // diode: asymmetric
      case 1: y = Math.tanh(x * k + 0.15 * this.drive) - Math.tanh(0.15 * this.drive); break; // valve: biased
      case 2: y = Math.max(-1, Math.min(1, x * k)); break;                                     // clipper
      case 3: { const dz = 0.08 * this.drive; y = Math.abs(x) < dz ? 0 : x - Math.sign(x) * dz; y *= k; break; } // cross-over
      case 4: y = Math.abs(x) * k * 2 - 0.5; break;                                            // rectifier
      case 5: { const steps = 2 ** (12 - this.drive * 10); y = Math.round(x * steps) / steps; break; } // bit reducer
      case 6: { const every = 1 + Math.round(this.drive * 30); if (this.holdCount++ % every === 0) this.hold = x; y = this.hold; break; } // rate reducer
      default: y = Math.tanh(x * k);
    }
    // Compensation pulls the louder, driven signal back toward the input's level.
    const makeup = 1 / (1 + (k - 1) * 0.08 * this.comp);
    return y * (this.type >= 5 ? 1 : makeup);
  }
}

// ── Patch EQ (approximate frequencies and range) ──────────────────────────────────────────────────

export class Eq3 {
  static readonly fidelity: Fidelity = "approximate";
  private readonly bands = [new Biquad(), new Biquad(), new Biquad()];
  private flat = true;
  private readonly sr: number;
  constructor(sr: number) { this.sr = sr; }
  set(v: { bassHz: number; bassLevel: number; midHz: number; midLevel: number; trebleHz: number; trebleLevel: number }): void {
    const g = [C.eqGainDb(v.bassLevel), C.eqGainDb(v.midLevel), C.eqGainDb(v.trebleLevel)];
    this.flat = g.every((d) => Math.abs(d) < 0.01);
    this.bands[0]!.set("lowshelf", C.eqBassHz(v.bassHz), this.sr, g[0]);
    this.bands[1]!.set("peaking", C.eqMidHz(v.midHz), this.sr, g[1], 0.9);
    this.bands[2]!.set("highshelf", C.eqTrebleHz(v.trebleHz), this.sr, g[2]);
  }
  process(x: number): number {
    if (this.flat) return x;
    return this.bands[2]!.process(this.bands[1]!.process(this.bands[0]!.process(x)));
  }
}

const PHASER_STEP = 16;

// ── Chorus / phaser (approximate) ─────────────────────────────────────────────────────────────────

export class Chorus {
  static readonly fidelity: Fidelity = "approximate";
  private readonly line: DelayLine;
  private readonly stages = [0, 1].map(() => [new Biquad(), new Biquad(), new Biquad(), new Biquad()]);
  private phase = 0;
  private inc = 0;
  private mix = 0;
  private type = 1;
  private delay = 0;
  private depth = 0;
  private fb = 0;
  private last: [number, number] = [0, 0];
  /** The phaser's all-pass frequencies move every PHASER_STEP samples, not every sample. */
  private ctr = 0;
  private readonly sr: number;
  constructor(sr: number) { this.sr = sr; this.line = new DelayLine(0.05 * sr); }
  set(v: { type: number; level: number; rate: number; sync: number; feedback: number; depth: number; delay: number }, bpm: number): void {
    this.type = v.type; this.mix = C.chorusMix(v.level);
    this.inc = C.chorusRate(v.rate, v.sync, bpm) / this.sr;
    this.delay = C.chorusDelaySeconds(v.delay) * this.sr;
    this.depth = C.chorusDepthSeconds(v.depth) * this.sr;
    this.fb = C.chorusFeedback(v.feedback);
  }
  get active(): boolean { return this.mix > 0; }
  /** Mono in, stereo out (written, not added). */
  process(x: number, out: [number, number]): void {
    if (this.mix <= 0) { out[0] = x; out[1] = x; return; }
    this.phase = (this.phase + this.inc) % 1;
    const lfo = [Math.sin(2 * Math.PI * this.phase), Math.sin(2 * Math.PI * (this.phase + 0.25))];
    if (this.type === 1) {
      this.line.write(x + this.fb * (this.last[0] + this.last[1]) * 0.5);
      for (let c = 0; c < 2; c++) {
        const w = this.line.read(this.delay + this.depth * (1 + lfo[c]!) * 0.5 + 1);
        this.last[c] = w;
        out[c] = x * (1 - this.mix * 0.5) + w * this.mix;
      }
    } else {
      for (let c = 0; c < 2; c++) {
        if (this.ctr % PHASER_STEP === 0) {
          const hz = 300 * 2 ** (3.5 * (1 + lfo[c]!) * 0.5 * Math.max(0.2, this.depth / (0.006 * this.sr)));
          for (const s of this.stages[c]!) s.set("allpass", hz, this.sr, 0, 0.6);
        }
        let y = x + this.fb * this.last[c]!;
        for (const s of this.stages[c]!) y = s.process(y);
        this.last[c] = y;
        out[c] = x * (1 - this.mix * 0.5) + y * this.mix * 0.5 + x * this.mix * 0.5;
      }
      this.ctr++;
    }
  }
}
