// Macro knobs, applied as the firmware does: on the ARM side, in the 0–127 parameter domain,
// value + offset clamped (getter 0x080360B2). The DSP never sees a macro.
//
// The formula below is read from the stock 1.2.1 firmware (the routine at 0x08035F84, which
// 0x0803602A calls once per macro; plan step E0.4):
//   - a slot's stored destination 0 means "no destination"; 1–70 select destinations 0–69
//     (`subs r1, r0, #1` after the zero test), so MACRO_DESTINATION_IDS is indexed by stored − 1;
//   - range = |end − start|, or 1 when they are equal;
//   - travel = position − start, clamped to 0…range (so a slot whose end is below its start
//     still rises as the knob goes up from `start`; it is not mirrored);
//   - offset = travel × (depth − 64) × 2 / range, truncated toward zero (signed divide);
//   - offsets of all slots with the same destination add up, then value + offset is clamped.
// Not yet compared with a device: the reading is static, from the disassembly.
import { MACRO_DESTINATION_IDS, param } from "./format.ts";

export const MACRO_FORMULA_STATUS = "read from the firmware (plan E0.4); no device check yet";

/** The patch parameter a slot's stored destination byte moves, or null for 0 (none) and unknown values. */
export function macroDestinationId(stored: number): string | null {
  return stored >= 1 ? MACRO_DESTINATION_IDS[stored - 1] ?? null : null;
}

/** One slot's offset at knob `position`, in parameter steps (−128…+126). */
export function macroSlotOffset(position: number, start: number, end: number, depth: number): number {
  const range = Math.abs(end - start) || 1;
  const travel = Math.min(range, Math.max(0, position - start));
  return Math.trunc((travel * (depth - 64) * 2) / range) || 0; // never −0
}

/**
 * The patch's values with its 8 macros applied. `positions` overrides the stored knob positions
 * (the track's macro store, which automation lanes 1–8 write; NOTAS:1568).
 *
 * The firmware clamps the result to 0–127. We also clamp to the parameter's own range, which the
 * firmware does elsewhere (not traced); without it a level stored in dB could leave its table.
 */
export function applyMacros(values: Readonly<Record<string, number>>, positions?: readonly (number | undefined)[]): Record<string, number> {
  const offsets = new Map<string, number>();
  for (let k = 0; k < 8; k++) {
    const pos = positions?.[k] ?? values[`macro${k + 1}.position`] ?? 0;
    for (const s of ["a", "b", "c", "d"]) {
      const id = macroDestinationId(values[`macro${k + 1}.${s}.destination`] ?? 0);
      if (!id) continue;
      const off = macroSlotOffset(pos, values[`macro${k + 1}.${s}.start`] ?? 0, values[`macro${k + 1}.${s}.end`] ?? 127, values[`macro${k + 1}.${s}.depth`] ?? 64);
      offsets.set(id, (offsets.get(id) ?? 0) + off);
    }
  }
  const out = { ...values };
  for (const [id, off] of offsets) {
    if (off === 0) continue;
    const p = param(id);
    const v = (values[id] ?? p.default) + off;
    out[id] = Math.min(p.max, Math.max(p.min, Math.min(127, Math.max(0, v))));
  }
  return out;
}
