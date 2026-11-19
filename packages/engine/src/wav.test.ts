import { describe, expect, it } from "vitest";
import { encodeWav } from "./render.ts";

describe("WAV encoding", () => {
  it("writes a 16-bit PCM header and interleaved, clamped samples", () => {
    const w = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 2, -2])], 48_000);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.slice(0, 4), ...w.slice(8, 12))).toBe("RIFFWAVE");
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48_000);
    expect(v.getUint32(40, true)).toBe(3 * 2 * 2);
    expect([0, 1, 2, 3, 4, 5].map((k) => v.getInt16(44 + 2 * k, true))).toEqual([0, 16383, 32767, 32767, -32768, -32768]);
  });
});
