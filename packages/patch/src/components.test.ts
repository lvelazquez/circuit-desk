// format.ts against Novation Components' own Circuit Tracks patch model (components.novationmusic.com,
// bundle main-D3lNZfPT.js, read 2026-11-24): section offsets and field order (the `binary` configs),
// signed fields, the CC/NRPN map (JD), the init patch bytes (sP) and the name lists (E4, I4, k4).
// Only names and numbers are copied here, as in format.ts.
import { describe, expect, it } from "vitest";
import { MACRO_DESTINATION_IDS, MOD_DESTINATIONS, MOD_SOURCES, PATCH_PARAMS, displayValue, param } from "./format.ts";
import { initPatchBytes } from "./patch.ts";

type Ctl = { cc: number } | { nrpn: [number, number] };
interface Field { address: number; key: string; signed: boolean; ctl?: Ctl }

const cc = (n: number): Ctl => ({ cc: n });
const nr = (m: number, l: number): Ctl => ({ nrpn: [m, l] });
const fields: Field[] = [];
const section = (name: string, base: number, spec: [key: string, off: number, signed: boolean, ctl?: Ctl][]): void => {
  for (const [key, off, signed, ctl] of spec) fields.push({ address: base + off, key: `${name}.${key}`, signed, ...(ctl ? { ctl } : {}) });
};

section("settings", 32, [["polyphonyMode", 0, false, cc(3)], ["portamentoRate", 1, false, cc(5)], ["preGlide", 2, true, cc(9)], ["keyboardOctave", 3, true, cc(13)]]);
for (const [i, base, c] of [[0, 36, [19, 20, 21, 22, 24, 25, 26, 27, 28]], [1, 45, [29, 30, 31, 33, 35, 36, 37, 39, 40]]] as const)
  section(`osc${i + 1}`, base, (["wave", "waveInterpolate", "waveIndex", "vSyncDepth", "density", "densityDetune", "semitones", "cents", "pitchBend"] as const)
    .map((k, j) => [k, j, [2, 6, 7, 8].includes(j), cc(c[j]!)]));
section("mixer", 54, [["osc1Level", 0, false, cc(51)], ["osc2Level", 1, false, cc(52)], ["ringModLevel", 2, false, cc(54)], ["noiseLevel", 3, false, cc(56)], ["preFXLevel", 4, true, cc(58)], ["postFXLevel", 5, true, cc(59)]]);
section("filter", 60, [["routing", 0, false, cc(60)], ["drive", 1, false, cc(63)], ["driveType", 2, false, cc(65)], ["type", 3, false, cc(68)], ["frequency", 4, false, cc(74)], ["tracking", 5, false, cc(69)], ["resonance", 6, false, cc(71)], ["qNormalize", 7, false, cc(78)], ["env2Frequency", 8, true, cc(79)]]);
section("env1", 69, [["velocity", 0, true, cc(108)], ["attack", 1, false, cc(73)], ["decay", 2, false, cc(75)], ["sustain", 3, false, cc(70)], ["release", 4, false, cc(72)]]);
section("env2", 74, (["velocity", "attack", "decay", "sustain", "release"] as const).map((k, j) => [k, j, j === 0, nr(0, j)]));
section("env3", 79, (["delay", "attack", "decay", "sustain", "release"] as const).map((k, j) => [k, j, false, nr(0, 14 + j)]));
for (const [i, n0] of [[0, 70], [1, 79]] as const)
  section(`lfo${i + 1}`, 84 + 8 * i, [["waveform", 0, false, nr(0, n0)], ["phase", 1, false, nr(0, n0 + 1)], ["slewRate", 2, false, nr(0, n0 + 2)], ["delay", 3, false, nr(0, n0 + 4)], ["delaySync", 4, false, nr(0, n0 + 5)], ["rate", 5, false, nr(0, n0 + 6)], ["rateSync", 6, false, nr(0, n0 + 7)], ["config", 7, false]]);
section("fx", 100, [["distortionLevel", 0, false, cc(91)], ["chorusLevel", 2, false, cc(93)], ["eqBassFrequency", 5, false, nr(0, 104)], ["eqBassLevel", 6, true, nr(0, 105)], ["eqMidFrequency", 7, false, nr(0, 106)], ["eqMidLevel", 8, true, nr(0, 107)], ["eqTrebleFrequency", 9, false, nr(0, 108)], ["eqTrebleLevel", 10, true, nr(0, 109)], ["distortionType", 16, false, nr(1, 0)], ["distortionCompensation", 17, false, nr(1, 1)], ["chorusType", 18, false, nr(1, 24)], ["chorusRate", 19, false, nr(1, 25)], ["chorusRateSync", 20, false, nr(1, 26)], ["chorusFeedback", 21, true, nr(1, 27)], ["chorusModDepth", 22, false, nr(1, 28)], ["chorusDelay", 23, false, nr(1, 29)]]);
// JD lists mod1 at 1:83/84/86/87 … mod9 at 1:123/124/126/127, mod10 at 2:0/1/3/4 … mod20 at 2:50/51/53/54.
for (let k = 0; k < 20; k++) {
  const at = (j: number): Ctl => (k < 9 ? nr(1, 83 + 5 * k + j) : nr(2, 5 * (k - 9) + j));
  section(`mod${k + 1}`, 124 + 4 * k, [["source1", 0, false, at(0)], ["source2", 1, false, at(1)], ["depth", 2, true, at(3)], ["destination", 3, false, at(4)]]);
}
for (let m = 0; m < 8; m++) {
  const spec: [string, number, boolean, Ctl][] = [["value", 0, false, cc(80 + m)]];
  for (let s = 0; s < 4; s++)
    (["destination", "start", "end", "depth"] as const).forEach((k, t) => spec.push([`slot${s}.${k}`, 1 + 4 * s + t, k === "depth", nr(3, 16 * m + 4 * s + t)]));
  section(`macro${m + 1}`, 204 + 17 * m, spec);
}

/** Components' init patch (sP), all 340 bytes. */
const INIT = [
  ..."Initial Patch   ".split("").map((c) => c.charCodeAt(0)), ...Array<number>(16).fill(0),
  2, 0, 64, 64, 2, 127, 64, 0, 0, 0, 64, 64, 76, 2, 127, 64, 0, 0, 0, 64, 64, 76, 127, 0, 0, 0, 64, 64, 0, 0, 0, 1, 127, 127, 0, 64, 64,
  64, 2, 90, 127, 40, 64, 2, 75, 35, 45, 0, 10, 70, 64, 40, 0, 0, 0, 0, 0, 68, 0, 0, 0, 0, 0, 0, 0, 68, 0, 0,
  0, 0, 0, 0, 0, 64, 64, 64, 64, 125, 64, 0, 0, 0, 0, 0, 0, 100, 1, 20, 0, 74, 64, 64,
  ...Array.from({ length: 20 }, () => [0, 0, 64, 0]).flat(),
  ...Array.from({ length: 8 }, () => [0, ...Array.from({ length: 4 }, () => [0, 0, 127, 64]).flat()]).flat(),
];

const byAddress = new Map(PATCH_PARAMS.map((p) => [p.address, p]));

describe("format.ts agrees with Novation Components' patch model", () => {
  it("has a parameter at every address Components maps, with the same signedness and controller", () => {
    expect(fields).toHaveLength(300);
    for (const f of fields) {
      const p = byAddress.get(f.address);
      expect(p, f.key).toBeDefined();
      expect(p!.reserved ?? false, f.key).toBe(false);
      expect(p!.display.kind === "bipolar" || p!.display.kind === "offset", `${f.key} signed`).toBe(f.signed);
      if (f.ctl) expect(p!.controller, `${f.key} controller`).toEqual(f.ctl);
    }
  });

  it("maps nothing Components leaves out, apart from reserved bytes and the header", () => {
    const mapped = new Set(fields.map((f) => f.address));
    const extra = PATCH_PARAMS.filter((p) => !p.reserved && !mapped.has(p.address)).map((p) => p.id);
    expect(extra).toEqual(["category", "genre"]);
  });

  it("has Components' init patch as its defaults", () => {
    expect(INIT).toHaveLength(340);
    for (const p of PATCH_PARAMS) expect(p.default, p.id).toBe(INIT[p.address]);
    expect(Array.from(initPatchBytes()).slice(16)).toEqual(INIT.slice(16));
  });

  it("names the mod matrix sources and destinations in Components' order", () => {
    expect(MOD_SOURCES.slice(1, 4)).toEqual(["Mod wheel (not used)", "Aftertouch (not used)", "Expression (not used)"]);
    expect(MOD_SOURCES[12]).toBe("Env 3");
    expect(MOD_DESTINATIONS).toHaveLength(18);
    expect([MOD_DESTINATIONS[11], MOD_DESTINATIONS[17]]).toEqual(["Filter drive", "Filter env decay"]);
  });

  it("has Components' macro destinations, stored 0 = none and 1–70 = k4[1…70]", () => {
    const k4 = [
      "voice.portamento", "mixer.postFx",
      ...[1, 2].flatMap((o) => ["waveInterpolate", "pulseWidth", "virtualSync", "density", "densityDetune", "semitones", "cents"].map((n) => `osc${o}.${n}`)),
      "mixer.osc1", "mixer.osc2", "mixer.ringMod", "mixer.noise",
      "filter.frequency", "filter.resonance", "filter.drive", "filter.tracking", "filter.env2ToFrequency",
      ...[1, 2].flatMap((e) => ["attack", "decay", "sustain", "release"].map((n) => `env${e}.${n}`)),
      ...["delay", "attack", "decay", "sustain", "release"].map((n) => `env3.${n}`),
      "lfo1.rate", "lfo1.rateSync", "lfo1.slew", "lfo2.rate", "lfo2.rateSync", "lfo2.slew",
      "fx.distortionLevel", "fx.chorusLevel", "fx.chorusRate", "fx.chorusFeedback", "fx.chorusModDepth", "fx.chorusDelay",
      ...Array.from({ length: 20 }, (_, k) => `mod${k + 1}.depth`),
    ];
    expect(MACRO_DESTINATION_IDS).toEqual(k4);
    const d = param("macro3.b.destination");
    expect([displayValue(d, 0), displayValue(d, 1), displayValue(d, 70)]).toEqual(["None", "Portamento rate", "Mod matrix 20 depth"]);
  });
});
