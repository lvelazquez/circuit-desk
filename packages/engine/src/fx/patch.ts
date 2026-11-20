// A synth patch's own effects, in the firmware's order: distortion (P:$11E9), EQ (P:$1203), chorus
// (P:$125D). Mono in from the voices, stereo out.
import { Chorus, Distortion, Eq3 } from "./effects.ts";

export class PatchFx {
  private readonly dist = new Distortion();
  private readonly eq: Eq3;
  private readonly chorus: Chorus;
  private readonly pair: [number, number] = [0, 0];
  /** False plays the voices straight through (the app's FX switch). */
  enabled = true;

  constructor(sr: number) {
    this.eq = new Eq3(sr);
    this.chorus = new Chorus(sr);
  }

  /** Patch values by parameter id (packages/patch), and the tempo for synced chorus rates. */
  setValues(v: Readonly<Record<string, number>>, bpm = 120): void {
    const g = (id: string, d: number): number => v[id] ?? d;
    this.dist.set(g("fx.distortionType", 0), g("fx.distortionLevel", 0), g("fx.distortionCompensation", 100));
    this.eq.set({
      bassHz: g("eq.bassFrequency", 64), bassLevel: g("eq.bassLevel", 64),
      midHz: g("eq.midFrequency", 64), midLevel: g("eq.midLevel", 64),
      trebleHz: g("eq.trebleFrequency", 125), trebleLevel: g("eq.trebleLevel", 64),
    });
    this.chorus.set({
      type: g("fx.chorusType", 1), level: g("fx.chorusLevel", 0), rate: g("fx.chorusRate", 20), sync: g("fx.chorusRateSync", 0),
      feedback: g("fx.chorusFeedback", 74), depth: g("fx.chorusModDepth", 64), delay: g("fx.chorusDelay", 64),
    }, bpm);
  }

  /** `mono` (from the voices) into left and right. */
  process(mono: Float32Array, left: Float32Array, right: Float32Array): void {
    if (!this.enabled) { left.set(mono); right.set(mono); return; }
    for (let i = 0; i < mono.length; i++) {
      const x = this.eq.process(this.dist.process(mono[i]!));
      this.chorus.process(x, this.pair);
      left[i] = this.pair[0]; right[i] = this.pair[1];
    }
  }
}
