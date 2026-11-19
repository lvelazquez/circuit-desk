import { describe, expect, it } from "vitest";
import { MACRO_DESTINATIONS, MACRO_DESTINATION_IDS, param } from "./format.ts";
import { applyMacros, macroDestinationId, macroSlotOffset } from "./macros.ts";
import { initPatch } from "./patch.ts";

describe("macro destinations", () => {
  it("map all 70 destinations to real patch parameters, in the firmware's order", () => {
    expect(MACRO_DESTINATION_IDS).toHaveLength(70);
    for (const id of MACRO_DESTINATION_IDS) expect(() => param(id)).not.toThrow();
    // Spot checks against the names (macroed.py:54-66).
    expect([MACRO_DESTINATIONS[17], MACRO_DESTINATION_IDS[17]]).toEqual(["Osc 2 level", "mixer.osc2"]);
    expect([MACRO_DESTINATIONS[46], MACRO_DESTINATION_IDS[46]]).toEqual(["Chorus rate", "fx.chorusRate"]);
    expect([MACRO_DESTINATIONS[69], MACRO_DESTINATION_IDS[69]]).toEqual(["Mod matrix 20 depth", "mod20.depth"]);
  });
});

describe("applyMacros (formula read from the firmware, plan E0.4)", () => {
  const v = (changes: Record<string, number>): Record<string, number> => ({ ...initPatch().values, ...changes });

  it("counts stored destinations from 1; 0 means none", () => {
    expect(macroDestinationId(0)).toBeNull();
    expect(macroDestinationId(1)).toBe("voice.portamento");
    expect(macroDestinationId(21)).toBe("filter.frequency");
    expect(macroDestinationId(70)).toBe("mod20.depth");
    expect(macroDestinationId(71)).toBeNull();
  });

  it("a full-depth macro at 127 opens a filter stored at 0", () => {
    const out = applyMacros(v({ "filter.frequency": 0, "macro1.position": 127, "macro1.a.destination": 21, "macro1.a.depth": 127 }));
    expect(out["filter.frequency"]).toBe(126);
  });

  it("uses the slot's start and end as the knob's range, and truncates like the signed divide", () => {
    expect(macroSlotOffset(10, 20, 100, 127)).toBe(0);
    expect(macroSlotOffset(60, 20, 100, 127)).toBe(63);
    expect(macroSlotOffset(100, 20, 100, 0)).toBe(-128);
    expect(macroSlotOffset(127, 0, 127, 127)).toBe(126);
    expect(macroSlotOffset(1, 0, 127, 65)).toBe(0);
    expect(macroSlotOffset(1, 0, 127, 63)).toBe(0);
  });

  it("does not mirror a slot whose end is below its start", () => {
    // range = |end - start| = 80; travel counts up from start and is clamped to the range.
    expect(macroSlotOffset(100, 100, 20, 127)).toBe(0);
    expect(macroSlotOffset(127, 100, 20, 127)).toBe(Math.trunc((27 * 63 * 2) / 80));
    expect(macroSlotOffset(50, 100, 20, 127)).toBe(0);
  });

  it("treats equal start and end as a range of 1", () => {
    expect(macroSlotOffset(64, 64, 64, 127)).toBe(0);
    expect(macroSlotOffset(65, 64, 64, 127)).toBe(126);
  });

  it("adds slots that share a destination, and clamps to the parameter's own range", () => {
    const two = applyMacros(v({ "filter.frequency": 10, "macro1.position": 127, "macro1.a.destination": 21, "macro1.a.depth": 84, "macro2.position": 127, "macro2.a.destination": 21, "macro2.a.depth": 74 }));
    expect(two["filter.frequency"]).toBe(10 + 40 + 20);
    const out = applyMacros(v({ "macro1.position": 127, "macro1.a.destination": 2, "macro1.a.depth": 127, "macro2.position": 127, "macro2.a.destination": 0, "macro2.a.depth": 127 }));
    expect(out["mixer.postFx"]).toBe(82);
    const base = initPatch().values;
    expect(applyMacros(base)).toEqual(base);
  });

  it("lets the track's macro store override stored positions", () => {
    const patch = v({ "mixer.osc2": 0, "macro3.position": 127, "macro3.a.destination": 18, "macro3.a.depth": 127 });
    expect(applyMacros(patch)["mixer.osc2"]).toBe(126);
    expect(applyMacros(patch, [undefined, undefined, 0])["mixer.osc2"]).toBe(0);
  });
});
