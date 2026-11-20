// Building blocks for the effects: pure DSP over numbers, no Web Audio.

/** A delay line with fractional (linear) reads. */
export class DelayLine {
  private readonly buf: Float32Array;
  private at = 0;
  constructor(maxSamples: number) { this.buf = new Float32Array(Math.max(2, Math.ceil(maxSamples) + 2)); }
  write(x: number): void { this.buf[this.at] = x; this.at = (this.at + 1) % this.buf.length; }
  /** The sample written `delay` samples ago (≥ 1). */
  read(delay: number): number {
    const n = this.buf.length;
    const d = Math.min(n - 2, Math.max(1, delay));
    const pos = this.at - d;
    const i = Math.floor(pos), f = pos - i;
    const a = this.buf[((i % n) + n) % n]!, b = this.buf[(((i + 1) % n) + n) % n]!;
    return a + (b - a) * f;
  }
  clear(): void { this.buf.fill(0); }
}

/** One-pole low-pass. */
export class OnePole {
  private z = 0;
  private k = 1;
  set(hz: number, sr: number): void { this.k = 1 - Math.exp((-2 * Math.PI * Math.min(hz, sr * 0.49)) / sr); }
  process(x: number): number { this.z += this.k * (x - this.z); return this.z; }
  reset(): void { this.z = 0; }
}

export type BiquadKind = "lowshelf" | "peaking" | "highshelf" | "allpass";

/** RBJ cookbook biquad, transposed direct form II. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private z1 = 0; private z2 = 0;
  set(kind: BiquadKind, hz: number, sr: number, gainDb = 0, q = 0.7071): void {
    const w = (2 * Math.PI * Math.min(hz, sr * 0.49)) / sr, cos = Math.cos(w), sin = Math.sin(w);
    const A = 10 ** (gainDb / 40), alpha = sin / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (kind === "peaking") {
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
    } else if (kind === "allpass") {
      b0 = 1 - alpha; b1 = -2 * cos; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    } else {
      const s = 2 * Math.sqrt(A) * alpha, sign = kind === "lowshelf" ? 1 : -1;
      b0 = A * ((A + 1) - sign * (A - 1) * cos + s);
      b1 = 2 * sign * A * ((A - 1) - sign * (A + 1) * cos);
      b2 = A * ((A + 1) - sign * (A - 1) * cos - s);
      a0 = (A + 1) + sign * (A - 1) * cos + s;
      a1 = -2 * sign * ((A - 1) + sign * (A + 1) * cos);
      a2 = (A + 1) + sign * (A - 1) * cos - s;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset(): void { this.z1 = 0; this.z2 = 0; }
}
