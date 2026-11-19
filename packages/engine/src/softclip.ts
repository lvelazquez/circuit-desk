// The master bus's last stage: a soft clipper after the limiter. Web Audio's compressor is not a
// brick wall, so fast peaks got through and the output hard-clipped, which crackles (a factory
// project, "Archived Fax", had 348 full-scale samples in one render, 2026-11-19). Below the knee
// the signal is untouched; above it, peaks bend smoothly towards a ceiling under full scale.

/** Level where bending starts (≈ −2.5 dBFS). */
export const SOFTCLIP_KNEE = 0.75;
/** The highest level the output can reach (≈ −0.2 dBFS), so no sample is ever clipped flat. */
export const SOFTCLIP_CEILING = 0.98;
/** The WaveShaperNode only maps inputs in −1…1, so the signal is scaled down by this first and
 * the curve undoes it: inputs up to this many times full scale are bent rather than clamped. */
export const SOFTCLIP_RANGE = 4;

/** The transfer function: identity below the knee, a tanh shoulder above, odd-symmetric. */
export function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= SOFTCLIP_KNEE) return x;
  const room = SOFTCLIP_CEILING - SOFTCLIP_KNEE;
  return Math.sign(x) * (SOFTCLIP_KNEE + room * Math.tanh((a - SOFTCLIP_KNEE) / room));
}

/** A WaveShaper curve for inputs pre-scaled by 1 / SOFTCLIP_RANGE. */
export function softClipCurve(points = 4096): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = ((i / (points - 1)) * 2 - 1) * SOFTCLIP_RANGE;
    curve[i] = softClip(x);
  }
  return curve;
}
