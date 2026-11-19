// Macro knobs, applied as the firmware does: on the ARM side, in the 0–127 parameter domain,
// value + offset clamped (getter 0x080360B2, NOTAS:2227). The DSP never sees a macro.
//
// THE OFFSET FORMULA IS A GUESS until plan step E0.4 reads it from the ARM routine at 0x0803608A:
// offset = depth (−1…+1) × 127 × t, with t = the knob's travel between the slot's start and end
// positions (0 below start, 1 above end). It explains factory patches that leave a level at 0 and
// let a macro at its stored position supply it (e.g. "Juno Strings": macro 3 at 127 → Osc 2 level).
import { MACRO_DESTINATION_IDS, param } from "./format.ts";

export const MACRO_FORMULA_STATUS = "guess (plan E0.4)";

const bipolar = (v: number): number => (v >= 64 ? (v - 64) / 63 : (v - 64) / 64);

/** One slot's offset at knob `position`. */
export function macroSlotOffset(position: number, start: number, end: number, depth: number): number {
  let t: number;
  if (end === start) t = position >= start ? 1 : 0;
  else if (end > start) t = (position - start) / (end - start);
  else t = (start - position) / (start - end);
  t = Math.min(1, Math.max(0, t));
  return bipolar(depth) * 127 * t;
}

/**
 * The patch's values with its 8 macros applied. `positions` overrides the stored knob positions
 * (the track's macro store, which automation lanes 1–8 write; NOTAS:1568).
 */
export function applyMacros(values: Readonly<Record<string, number>>, positions?: readonly (number | undefined)[]): Record<string, number> {
  const offsets = new Map<string, number>();
  for (let k = 0; k < 8; k++) {
    const pos = positions?.[k] ?? values[`macro${k + 1}.position`] ?? 0;
    for (const s of ["a", "b", "c", "d"]) {
      const dest = values[`macro${k + 1}.${s}.destination`] ?? 0;
      const id = MACRO_DESTINATION_IDS[dest];
      const depth = values[`macro${k + 1}.${s}.depth`] ?? 64;
      if (!id || depth === 64) continue; // destination 70 does nothing; depth 0 adds nothing
      const off = macroSlotOffset(pos, values[`macro${k + 1}.${s}.start`] ?? 0, values[`macro${k + 1}.${s}.end`] ?? 127, depth);
      offsets.set(id, (offsets.get(id) ?? 0) + off);
    }
  }
  const out = { ...values };
  for (const [id, off] of offsets) {
    const p = param(id);
    const v = Math.round((values[id] ?? p.default) + off);
    out[id] = Math.min(p.max, Math.max(p.min, Math.min(127, Math.max(0, v))));
  }
  return out;
}
