// Small DSP units for the Nova voice. Pure functions and classes over numbers: no Web Audio, no DOM,
// so they run in an AudioWorklet, in Node tests, and could move to WASM unchanged.

/** PolyBLEP residual for a discontinuity at phase 0, with phase increment `dt` (both in cycles). */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

/** Band-limited sawtooth, −1…1, rising. */
export function saw(phase: number, dt: number): number {
  return 2 * phase - 1 - polyBlep(phase, dt);
}

/**
 * A pulse made, as the device does for waves 3–12, from two saws offset in phase (NOTAS:798):
 * saw(p) − saw(p + width). It has no DC; `width` is the high part of the cycle (0–1).
 */
export function sawPulse(phase: number, dt: number, width: number): number {
  let q = phase + width;
  if (q >= 1) q -= 1;
  return (saw(phase, dt) - saw(q, dt)) * 0.5;
}

export function triangle(phase: number): number {
  return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
}

export function sine(phase: number): number {
  return Math.sin(2 * Math.PI * phase);
}

/** Response of one filter stage. */
export type SvfMode = "low" | "band" | "high";

/**
 * Topology-preserving state-variable filter (Zavalishin), one 12 dB/oct stage. Coefficients are set
 * per block, as the device updates its parameters per 32-frame block.
 */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 2;

  set(hz: number, q: number, sampleRate: number): void {
    const f = Math.min(hz, sampleRate * 0.45);
    const g = Math.tan((Math.PI * f) / sampleRate);
    this.k = 1 / Math.max(0.05, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(x: number, mode: SvfMode): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return mode === "low" ? v2 : mode === "band" ? v1 : x - this.k * v1 - v2;
  }

  reset(): void { this.ic1 = 0; this.ic2 = 0; }
}

export type EnvStage = "idle" | "delay" | "attack" | "decay" | "sustain" | "release";

/** Shortest linear attack, seconds: a rise in fewer samples clicks. */
export const MIN_ATTACK = 0.002;
/** Shortest exponential decay or release to −60 dB, seconds. Exponential falls are steepest at
 * their start, so they need a longer floor than the linear attack to stay click-free. */
export const MIN_FALL = 0.008;

/** ADSR (with an optional delay, for envelope 3): linear attack, exponential decay and release. */
export class Envelope {
  stage: EnvStage = "idle";
  value = 0;
  private delayLeft = 0;
  private attackStep = 1;
  private decayCoef = 0;
  private releaseCoef = 0;
  private sustain = 1;

  /** Times in seconds; sustain 0–1. */
  configure(delay: number, attack: number, decay: number, sustain: number, release: number, sampleRate: number): void {
    this.delayLeft = this.stage === "delay" ? this.delayLeft : Math.round(delay * sampleRate);
    // Floors so no stage jumps in one sample (a click); they are a declick, not the parameter curves.
    this.attackStep = 1 / (Math.max(MIN_ATTACK, attack) * sampleRate);
    // Exponential approach: reach 1/1000 of the distance in the given time.
    this.decayCoef = Math.exp(Math.log(0.001) / (Math.max(MIN_FALL, decay) * sampleRate));
    this.releaseCoef = Math.exp(Math.log(0.001) / (Math.max(MIN_FALL, release) * sampleRate));
    this.sustain = sustain;
  }

  /** Starts the envelope. With `legato` an envelope already running keeps going (Mono AG). */
  gate(delaySamples: number, legato = false): void {
    if (legato && this.stage !== "idle" && this.stage !== "release") return;
    this.delayLeft = delaySamples;
    this.stage = delaySamples > 0 ? "delay" : "attack";
  }

  release(): void {
    if (this.stage !== "idle") this.stage = "release";
  }

  next(): number {
    switch (this.stage) {
      case "idle": return 0;
      case "delay":
        if (--this.delayLeft <= 0) this.stage = "attack";
        return this.value;
      case "attack":
        this.value += this.attackStep;
        if (this.value >= 1) { this.value = 1; this.stage = "decay"; }
        return this.value;
      case "decay":
        this.value = this.sustain + (this.value - this.sustain) * this.decayCoef;
        if (Math.abs(this.value - this.sustain) < 1e-4) { this.value = this.sustain; this.stage = "sustain"; }
        return this.value;
      case "sustain":
        this.value = this.sustain;
        return this.value;
      case "release":
        this.value *= this.releaseCoef;
        if (this.value < 1e-5) { this.value = 0; this.stage = "idle"; }
        return this.value;
    }
  }
}

/** White noise from a small deterministic generator, so renders are repeatable. */
export class Noise {
  private s: number;
  constructor(seed = 0x2545f491) { this.s = seed >>> 0 || 1; }
  next(): number {
    let x = this.s;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.s = x >>> 0;
    return (this.s / 0x80000000) - 1;
  }
}
