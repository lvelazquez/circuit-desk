import { describe, expect, it } from "vitest";
import { MACRO_DESTINATIONS, MACRO_DESTINATION_IDS, param } from "./format.ts";
import { applyMacros, macroSlotOffset } from "./macros.ts";
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

describe("applyMacros (guessed formula, plan E0.4)", () => {
  const v = (changes: Record<string, number>): Record<string, number> => ({ ...initPatch().values, ...changes });

  it("a full-depth macro at 127 takes a level from 0 to 127 (the 'Juno Strings' case)", () => {
    const out = applyMacros(v({ "mixer.osc2": 0, "macro3.position": 127, "macro3.a.destination": 17, "macro3.a.depth": 127 }));
    expect(out["mixer.osc2"]).toBe(127);
  });

  it("uses the slot's start and end as the knob's range", () => {
    expect(macroSlotOffset(10, 20, 100, 127)).toBe(0);
    expect(macroSlotOffset(60, 20, 100, 127)).toBeCloseTo(63.5);
    expect(macroSlotOffset(100, 20, 100, 0)).toBe(-127);
  });

  it("clamps to the parameter's own range and ignores destination 70 and zero depth", () => {
    const out = applyMacros(v({ "macro1.position": 127, "macro1.a.destination": 1, "macro1.a.depth": 127, "macro2.position": 127, "macro2.a.destination": 70, "macro2.a.depth": 127 }));
    expect(out["mixer.postFx"]).toBe(82);
    const base = initPatch().values;
    expect(applyMacros(base)).toEqual(base);
  });

  it("lets the track's macro store override stored positions", () => {
    const patch = v({ "mixer.osc2": 0, "macro3.position": 127, "macro3.a.destination": 17, "macro3.a.depth": 127 });
    expect(applyMacros(patch, [undefined, undefined, 0])["mixer.osc2"]).toBe(0);
  });
});
