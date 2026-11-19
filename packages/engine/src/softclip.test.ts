import { describe, expect, it } from "vitest";
import { SOFTCLIP_CEILING, SOFTCLIP_KNEE, SOFTCLIP_RANGE, softClip, softClipCurve } from "./softclip.ts";

describe("master soft clipper", () => {
  it("leaves the signal untouched below the knee", () => {
    for (const x of [-SOFTCLIP_KNEE, -0.3, 0, 0.5, SOFTCLIP_KNEE]) expect(softClip(x)).toBe(x);
  });

  it("never reaches full scale, however hot the input", () => {
    for (const x of [1, 2, 4, 100]) {
      expect(softClip(x)).toBeLessThan(SOFTCLIP_CEILING + 1e-12);
      expect(softClip(-x)).toBe(-softClip(x));
    }
  });

  it("is smooth: rising, with no corner at the knee", () => {
    let last = -Infinity;
    for (let x = 0; x <= 4; x += 0.001) { const y = softClip(x); expect(y).toBeGreaterThanOrEqual(last); last = y; }
    const h = 1e-6, slopeBelow = (softClip(SOFTCLIP_KNEE) - softClip(SOFTCLIP_KNEE - h)) / h;
    const slopeAbove = (softClip(SOFTCLIP_KNEE + h) - softClip(SOFTCLIP_KNEE)) / h;
    expect(slopeAbove).toBeCloseTo(slopeBelow, 3);
  });

  it("the shaper curve spans ±SOFTCLIP_RANGE and is centred on 0", () => {
    const c = softClipCurve(4097);
    expect(c[2048]).toBeCloseTo(0, 6);
    expect(c[0]).toBeCloseTo(-softClip(SOFTCLIP_RANGE), 6);
    expect(c[4096]).toBeCloseTo(softClip(SOFTCLIP_RANGE), 6);
  });
});
