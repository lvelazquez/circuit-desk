import { describe, expect, it } from "vitest";
import {
  MACRO_DESTINATIONS, MOD_DESTINATIONS, NAME_LEN, OSC_WAVES, PATCH_PARAMS, PATCH_SIZE, displayValue, param,
} from "./format.ts";
import { PatchError, buildPatch, initPatch, initPatchBytes, parsePatch, withValues } from "./patch.ts";
import { paddingKind, readBank, writeBankPatch } from "./bank.ts";
import {
  PATCH_MESSAGE_SIZE, dumpRequestMessage, parsePatchMessage, readSyx, replaceCurrentPatchMessage, replacePatchMessage,
} from "./sysex.ts";

function diff(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

describe("format table", () => {
  it("covers bytes 16–339 exactly once, after the 16-byte name", () => {
    const addresses = PATCH_PARAMS.map((p) => p.address);
    expect(addresses).toEqual(Array.from({ length: PATCH_SIZE - NAME_LEN }, (_, i) => i + NAME_LEN));
  });

  it("has unique ids, defaults inside their ranges, and the enum sizes of the guide", () => {
    expect(new Set(PATCH_PARAMS.map((p) => p.id)).size).toBe(PATCH_PARAMS.length);
    for (const p of PATCH_PARAMS) expect(p.default >= p.min && p.default <= p.max, p.id).toBe(true);
    expect(OSC_WAVES).toHaveLength(30);
    expect(MOD_DESTINATIONS).toHaveLength(18);
    expect(MACRO_DESTINATIONS).toHaveLength(70);
  });

  it("matches spot values from the guide", () => {
    expect(param("osc1.wave")).toMatchObject({ address: 36, max: 29, default: 2, controller: { cc: 19 } });
    expect(param("lfo2.rate")).toMatchObject({ address: 97, default: 68, controller: { nrpn: [0, 85] } });
    expect(param("mod10.source1").controller).toEqual({ nrpn: [2, 0] });
    expect(param("macro8.d.depth")).toMatchObject({ address: 339, controller: { nrpn: [3, 127] } });
    expect(param("macro1.position").controller).toEqual({ cc: 80 });
  });

  it("shows values in their own units", () => {
    expect(displayValue(param("osc1.semitones"), 52)).toBe("−12");
    expect(displayValue(param("voice.preGlide"), 76)).toBe("+12 st");
    expect(displayValue(param("osc2.wave"), 5)).toBe("Saw 7:3 PW");
    expect(displayValue(param("lfo1.phase"), 2)).toBe("6°");
    expect(displayValue(param("macro1.a.destination"), 20)).toBe("Filter frequency");
  });
});

describe("patch model", () => {
  it("builds the guide's default patch and reads it back", () => {
    const b = initPatchBytes();
    expect(b).toHaveLength(PATCH_SIZE);
    // Guide p. 16: bytes 0–15 of the default patch spell "Initial Patch   ".
    expect(Array.from(b.subarray(0, 16))).toEqual([73, 110, 105, 116, 105, 97, 108, 32, 80, 97, 116, 99, 104, 32, 32, 32]);
    const p = parsePatch(b);
    expect(p.name).toBe("Initial Patch");
    expect(p.values["filter.frequency"]).toBe(127);
    expect(buildPatch(p, b)).toEqual(b);
  });

  it("writes exactly the changed byte", () => {
    const base = initPatchBytes();
    const out = buildPatch(withValues(initPatch(), { "filter.resonance": 90 }), base);
    expect(diff(base, out)).toEqual([66]);
    expect(out[66]).toBe(90);
  });

  it("keeps unknown bytes of the base, such as a non-zero reserved byte", () => {
    const base = initPatchBytes();
    base[20] = 0x55;
    const p = parsePatch(base);
    p.values["reserved3"] = 0; // reserved values are never written
    expect(buildPatch(p, base)[20]).toBe(0x55);
  });

  it("rewrites the name only when it changed, padded with spaces", () => {
    const base = initPatchBytes();
    const out = buildPatch({ ...initPatch(), name: "Bass" }, base);
    expect(diff(base, out)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    expect(parsePatch(out).name).toBe("Bass");
  });

  it("rejects values outside the guide's ranges, unknown ids and bad names", () => {
    const base = initPatchBytes();
    expect(() => buildPatch(withValues(initPatch(), { "osc1.wave": 30 }), base)).toThrow(PatchError);
    expect(() => buildPatch(withValues(initPatch(), { "voice.preGlide": 51 }), base)).toThrow(/52–76/);
    expect(() => withValues(initPatch(), { "osc3.wave": 1 })).toThrow(/no patch parameter/);
    expect(() => buildPatch({ ...initPatch(), name: "A name that is far too long" }, base)).toThrow(/longer/);
    expect(() => buildPatch({ ...initPatch(), name: "Café" }, base)).toThrow(/ASCII/);
  });
});

describe("banks", () => {
  /** 7 full records + a short last one, as on the card; padding is 0xFF filler, one CTM1 record. */
  function bank(): Uint8Array {
    const f = new Uint8Array(7 * 512 + PATCH_SIZE).fill(0xff);
    for (let i = 0; i < 8; i++) {
      const p = initPatchBytes();
      p[0] = 65 + i;
      f.set(p, i * 512);
    }
    f.set([0x43, 0x54, 0x4d, 0x31, 9, 9], 2 * 512 + PATCH_SIZE);
    return f;
  }

  it("reads 8 records with a short last one and classifies the padding", () => {
    const recs = readBank(bank());
    expect(recs).toHaveLength(8);
    expect(recs.map((r) => r.name[0])).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(recs.map((r) => r.padding)).toEqual(["empty", "empty", "ctm1", "empty", "empty", "empty", "empty", "none"]);
    expect(paddingKind(Uint8Array.of(1, 2))).toBe("other");
  });

  it("replaces one patch and keeps every other byte, CIRCUIT-HACKS data and data past 4 096 B included", () => {
    const f = new Uint8Array(4096 + 224).fill(0xff);
    for (let i = 0; i < 8; i++) f.set(initPatchBytes(), i * 512);
    f.set([0x43, 0x54, 0x4d, 0x31], 512 + PATCH_SIZE);
    f[4100] = 7;
    const p = initPatchBytes();
    p[64] = 10;
    const out = writeBankPatch(f, 1, p);
    expect(diff(f, out)).toEqual([512 + 64]);
    expect(() => writeBankPatch(f, 8, p)).toThrow(/no record/);
  });
});

describe("SysEx", () => {
  it("builds and parses a replace-current message of 350 bytes", () => {
    const p = initPatchBytes();
    const m = replaceCurrentPatchMessage(p, 1);
    expect(m).toHaveLength(PATCH_MESSAGE_SIZE);
    expect(Array.from(m.subarray(0, 9))).toEqual([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x00, 0x01, 0x00]);
    expect(m[349]).toBe(0xf7);
    expect(parsePatchMessage(m)).toEqual({ command: 0, slot: 1, patch: p });
  });

  it("reads a bank .syx of 64 replace-patch messages", () => {
    const file = new Uint8Array(64 * PATCH_MESSAGE_SIZE);
    for (let n = 0; n < 64; n++) file.set(replacePatchMessage(initPatchBytes(), n), n * PATCH_MESSAGE_SIZE);
    const msgs = readSyx(file);
    expect(msgs.map((m) => m.slot)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(() => replacePatchMessage(initPatchBytes(), 64)).toThrow();
  });

  it("builds the read-only dump request", () => {
    expect(Array.from(dumpRequestMessage(0))).toEqual([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x40, 0x00, 0xf7]);
  });
});
