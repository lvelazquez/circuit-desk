// The Circuit Tracks synth patch: 340 bytes, one byte per parameter.
// Source: Novation, "Circuit Tracks Programmer's Reference Guide" v3, "Synth Patch Format" (pp. 16–22),
// for addresses, ranges and defaults; the MIDI parameter tables (pp. 2–8) for CC / NRPN numbers.
// Macro destination names: the firmware's 70-entry table at 0x0805A2B0, as listed in
// circuit-hacks-rc/tools/macroed.py:54-66 (NOTAS:2224). Only names and numbers live here, no firmware data.
// Checked on the card copy: 1 050 patches, every value in range (tools/patch-sweep.ts).

export const PATCH_SIZE = 340;
export const NAME_LEN = 16;

/** How a raw byte is shown to people. */
export type Display =
  | { kind: "plain" }
  /** Stored 0–127, shown as −64…63. */
  | { kind: "bipolar" }
  /** Stored with 64 = 0, shown as a signed offset with a unit (semitones, octaves, dB). */
  | { kind: "offset"; unit: string }
  | { kind: "enum"; labels: readonly string[] }
  /** LFO phase: steps of 3°. */
  | { kind: "degrees"; step: number }
  /** A byte of flag bits. */
  | { kind: "bits"; fields: readonly { name: string; bit: number; width: number }[] };

export type Controller = { cc: number } | { nrpn: [msb: number, lsb: number] };

export interface PatchParam {
  /** Stable id, e.g. "osc1.wave", "macro3.b.depth". */
  id: string;
  /** The guide's name, e.g. "Osc1_Wave". */
  name: string;
  address: number;
  section: Section;
  min: number;
  max: number;
  /** The patch table's default (it differs from the CC table in a few places; the patch table wins). */
  default: number;
  display: Display;
  controller?: Controller;
  /** Reserved bytes: kept as found, never edited. */
  reserved?: boolean;
  note?: string;
}

export type Section =
  | "Info" | "Voice" | "Osc 1" | "Osc 2" | "Mixer" | "Filter" | "Env 1" | "Env 2" | "Env 3"
  | "LFO 1" | "LFO 2" | "FX" | "EQ" | "Mod Matrix" | "Macros";

// ── Enum tables (guide pp. 9–10) ─────────────────────────────────────────────────────────────

export const OSC_WAVES: readonly string[] = [
  "Sine", "Triangle", "Sawtooth", "Saw 9:1 PW", "Saw 8:2 PW", "Saw 7:3 PW", "Saw 6:4 PW", "Saw 5:5 PW",
  "Saw 4:6 PW", "Saw 3:7 PW", "Saw 2:8 PW", "Saw 1:9 PW", "Pulse width", "Square",
  "Sine table", "Analogue pulse", "Analogue sync", "Triangle-saw blend", "Digital nasty 1", "Digital nasty 2",
  "Digital saw-square", "Digital vocal 1", "Digital vocal 2", "Digital vocal 3", "Digital vocal 4",
  "Digital vocal 5", "Digital vocal 6", "Random collection 1", "Random collection 2", "Random collection 3",
];
/** Waves 14–29 are wavetables of 9 frames (NOTAS:732). */
export const FIRST_WAVETABLE = 14;

export const FILTER_TYPES: readonly string[] = ["Low pass 12 dB", "Low pass 24 dB", "Band pass 6/6 dB", "Band pass 12/12 dB", "High pass 12 dB", "High pass 24 dB"];
export const DRIVE_TYPES: readonly string[] = ["Diode", "Valve", "Clipper", "Cross-over", "Rectifier", "Bit reducer", "Rate reducer"];
export const FILTER_ROUTINGS: readonly string[] = ["Normal", "Osc 1 bypasses", "Osc 1 + 2 bypass"];
export const POLY_MODES: readonly string[] = ["Mono", "Mono AG", "Poly"];
export const CHORUS_TYPES: readonly string[] = ["Phaser", "Chorus"];

export const LFO_WAVES: readonly string[] = [
  "Sine", "Triangle", "Sawtooth", "Square", "Random S/H", "Time S/H", "Piano envelope",
  "Sequence 1", "Sequence 2", "Sequence 3", "Sequence 4", "Sequence 5", "Sequence 6", "Sequence 7",
  "Alternative 1", "Alternative 2", "Alternative 3", "Alternative 4", "Alternative 5", "Alternative 6",
  "Alternative 7", "Alternative 8", "Chromatic", "Chromatic 16", "Major", "Major 7", "Minor 7",
  "Min arp 1", "Min arp 2", "Diminished", "Dec minor", "Minor 3rd", "Pedal", "4ths", "4ths x12",
  "1625 maj", "1625 min", "2511",
];

/** Mod matrix sources. The guide lists 0 and 4–12; 1–3 are not described. */
export const MOD_SOURCES: readonly string[] = [
  "Direct", "Source 1 (undocumented)", "Source 2 (undocumented)", "Source 3 (undocumented)",
  "Velocity", "Keyboard", "LFO 1 +", "LFO 1 ±", "LFO 2 +", "LFO 2 ±", "Env amp", "Env filter", "Env 3",
];
export const MOD_DESTINATIONS: readonly string[] = [
  "Osc 1 & 2 pitch", "Osc 1 pitch", "Osc 2 pitch", "Osc 1 v-sync", "Osc 2 v-sync", "Osc 1 pulse width / index",
  "Osc 2 pulse width / index", "Osc 1 level", "Osc 2 level", "Noise level", "Ring mod 1*2 level",
  "Filter drive", "Filter frequency", "Filter resonance", "LFO 1 rate", "LFO 2 rate", "Amp env decay", "Filter env decay",
];

/** The 70 macro destinations (0–69). The guide allows 70, which the firmware's loop never reaches (NOTAS:2227). */
export const MACRO_DESTINATIONS: readonly string[] = [
  "Portamento rate", "Post FX level",
  ...["wave interpolate", "pulse width index", "virtual sync depth", "density", "density detune", "semitones", "cents"].map((n) => `Osc 1 ${n}`),
  ...["wave interpolate", "pulse width index", "virtual sync depth", "density", "density detune", "semitones", "cents"].map((n) => `Osc 2 ${n}`),
  "Osc 1 level", "Osc 2 level", "Ring mod level", "Noise level",
  "Filter frequency", "Filter resonance", "Filter drive", "Filter tracking", "Env 2 to filter frequency",
  ...["attack", "decay", "sustain", "release"].map((n) => `Env 1 ${n}`),
  ...["attack", "decay", "sustain", "release"].map((n) => `Env 2 ${n}`),
  ...["delay", "attack", "decay", "sustain", "release"].map((n) => `Env 3 ${n}`),
  "LFO 1 rate", "LFO 1 rate sync", "LFO 1 slew rate", "LFO 2 rate", "LFO 2 rate sync", "LFO 2 slew rate",
  "Distortion level", "Chorus level", "Chorus rate", "Chorus feedback", "Chorus mod depth", "Chorus delay",
  ...Array.from({ length: 20 }, (_, k) => `Mod matrix ${k + 1} depth`),
];
/** Destinations inferred by symmetry in the firmware study, not yet checked (NOTAS:2224). */
export const MACRO_DESTINATIONS_UNCHECKED: readonly number[] = [41, 42, 43, 44, 45];

/** Patch categories, as Novation Components names them (circuit-hacks-rc/tools/sd_app.html:453). */
export const CATEGORIES: readonly string[] = [
  "None", "Arp", "Bass", "Bell", "Classic", "Drum", "Keyboard", "Lead", "Movement", "Pad", "Poly", "SFX", "String", "User", "Voc",
];

// ── The table ────────────────────────────────────────────────────────────────────────────────

const params: PatchParam[] = [];
const PLAIN: Display = { kind: "plain" };
const BIP: Display = { kind: "bipolar" };
const SEMIS: Display = { kind: "offset", unit: "st" };
const enumOf = (labels: readonly string[]): Display => ({ kind: "enum", labels });
const cc = (n: number): Controller => ({ cc: n });
const nrpn = (msb: number, lsb: number): Controller => ({ nrpn: [msb, lsb] });

function add(
  address: number, id: string, name: string, section: Section, min: number, max: number, def: number,
  display: Display = PLAIN, controller?: Controller, extra: Partial<PatchParam> = {},
): void {
  const p: PatchParam = { id, name, address, section, min, max, default: def, display, ...extra };
  if (controller) p.controller = controller;
  params.push(p);
}

const reserved = (address: number, id: string, name: string, section: Section): void =>
  add(address, id, name, section, 0, 0, 0, PLAIN, undefined, { reserved: true });

add(16, "category", "Patch_Category", "Info", 0, 14, 0, enumOf(CATEGORIES));
add(17, "genre", "Patch_Genre", "Info", 0, 9, 0, PLAIN, undefined, { note: "the guide gives no genre names" });
for (let a = 18; a <= 31; a++) reserved(a, `reserved${a - 17}`, `Patch_Reserved${a - 17}`, "Info");

add(32, "voice.polyphony", "Voice_PolyphonyMode", "Voice", 0, 2, 2, enumOf(POLY_MODES), cc(3));
add(33, "voice.portamento", "Voice_PortamentoRate", "Voice", 0, 127, 0, PLAIN, cc(5));
add(34, "voice.preGlide", "Voice_PreGlide", "Voice", 52, 76, 64, SEMIS, cc(9));
add(35, "voice.octave", "Voice_KeyboardOctave", "Voice", 58, 69, 64, { kind: "offset", unit: "oct" }, cc(13));

const OSC_CCS = [[19, 20, 21, 22, 24, 25, 26, 27, 28], [29, 30, 31, 33, 35, 36, 37, 39, 40]] as const;
for (const o of [0, 1] as const) {
  const base = 36 + o * 9;
  const sec: Section = o === 0 ? "Osc 1" : "Osc 2";
  const id = `osc${o + 1}`;
  const nm = `Osc${o + 1}_`;
  const c = OSC_CCS[o];
  add(base, `${id}.wave`, `${nm}Wave`, sec, 0, 29, 2, enumOf(OSC_WAVES), cc(c[0]));
  add(base + 1, `${id}.waveInterpolate`, `${nm}WaveInterpolate`, sec, 0, 127, 127, PLAIN, cc(c[1]));
  add(base + 2, `${id}.pulseWidth`, `${nm}PulseWidthIndex`, sec, 0, 127, 64, BIP, cc(c[2]));
  add(base + 3, `${id}.virtualSync`, `${nm}VirtualSyncDepth`, sec, 0, 127, 0, PLAIN, cc(c[3]));
  add(base + 4, `${id}.density`, `${nm}Density`, sec, 0, 127, 0, PLAIN, cc(c[4]));
  add(base + 5, `${id}.densityDetune`, `${nm}DensityDetune`, sec, 0, 127, 0, PLAIN, cc(c[5]));
  add(base + 6, `${id}.semitones`, `${nm}Semitones`, sec, 0, 127, 64, BIP, cc(c[6]));
  add(base + 7, `${id}.cents`, `${nm}Cents`, sec, 0, 127, 64, BIP, cc(c[7]));
  add(base + 8, `${id}.pitchBend`, `${nm}PitchBend`, sec, 52, 76, 76, SEMIS, cc(c[8]));
}

add(54, "mixer.osc1", "Mixer_Osc1Level", "Mixer", 0, 127, 127, PLAIN, cc(51));
add(55, "mixer.osc2", "Mixer_Osc2Level", "Mixer", 0, 127, 0, PLAIN, cc(52));
add(56, "mixer.ringMod", "Mixer_RingModLevel12", "Mixer", 0, 127, 0, PLAIN, cc(54));
add(57, "mixer.noise", "Mixer_NoiseLevel", "Mixer", 0, 127, 0, PLAIN, cc(56));
add(58, "mixer.preFx", "Mixer_PreFXLevel", "Mixer", 52, 82, 64, { kind: "offset", unit: "dB" }, cc(58));
add(59, "mixer.postFx", "Mixer_PostFXLevel", "Mixer", 52, 82, 64, { kind: "offset", unit: "dB" }, cc(59));

add(60, "filter.routing", "Filter_Routing", "Filter", 0, 2, 0, enumOf(FILTER_ROUTINGS), cc(60));
add(61, "filter.drive", "Filter_Drive", "Filter", 0, 127, 0, PLAIN, cc(63));
add(62, "filter.driveType", "Filter_DriveType", "Filter", 0, 6, 0, enumOf(DRIVE_TYPES), cc(65));
add(63, "filter.type", "Filter_Type", "Filter", 0, 5, 1, enumOf(FILTER_TYPES), cc(68));
add(64, "filter.frequency", "Filter_Frequency", "Filter", 0, 127, 127, PLAIN, cc(74));
add(65, "filter.tracking", "Filter_Track", "Filter", 0, 127, 127, PLAIN, cc(69));
add(66, "filter.resonance", "Filter_Resonance", "Filter", 0, 127, 0, PLAIN, cc(71));
add(67, "filter.qNormalise", "Filter_QNormalise", "Filter", 0, 127, 64, PLAIN, cc(78));
add(68, "filter.env2ToFrequency", "Filter_Env2ToFreq", "Filter", 0, 127, 64, BIP, cc(79));

const ENVS = [
  { base: 69, sec: "Env 1", ctl: [cc(108), cc(73), cc(75), cc(70), cc(72)], def: [64, 2, 90, 127, 40] },
  { base: 74, sec: "Env 2", ctl: [nrpn(0, 0), nrpn(0, 1), nrpn(0, 2), nrpn(0, 3), nrpn(0, 4)], def: [64, 2, 75, 35, 45] },
] as const;
for (const [i, e] of ENVS.entries()) {
  const id = `env${i + 1}`;
  const nm = `Envelope${i + 1}_`;
  add(e.base, `${id}.velocity`, `${nm}Velocity`, e.sec, 0, 127, e.def[0], BIP, e.ctl[0]);
  ["attack", "decay", "sustain", "release"].forEach((k, j) =>
    add(e.base + 1 + j, `${id}.${k}`, `${nm}${k[0]!.toUpperCase()}${k.slice(1)}`, e.sec, 0, 127, e.def[j + 1]!, PLAIN, e.ctl[j + 1]));
}
["delay", "attack", "decay", "sustain", "release"].forEach((k, j) =>
  add(79 + j, `env3.${k}`, `Envelope3_${k[0]!.toUpperCase()}${k.slice(1)}`, "Env 3", 0, 127, [0, 10, 70, 64, 40][j]!, PLAIN, nrpn(0, 14 + j)));

const LFO_FLAGS: Display = {
  kind: "bits",
  fields: [
    { name: "One shot", bit: 0, width: 1 }, { name: "Key sync", bit: 1, width: 1 },
    { name: "Common sync", bit: 2, width: 1 }, { name: "Delay trigger", bit: 3, width: 1 },
    { name: "Fade mode", bit: 4, width: 2 },
  ],
};
for (const l of [0, 1] as const) {
  const base = 84 + l * 8;
  const sec: Section = l === 0 ? "LFO 1" : "LFO 2";
  const id = `lfo${l + 1}`;
  const nm = `LFO${l + 1}_`;
  const n0 = l === 0 ? 70 : 79;
  add(base, `${id}.wave`, `${nm}Waveform`, sec, 0, 37, 0, enumOf(LFO_WAVES), nrpn(0, n0));
  add(base + 1, `${id}.phase`, `${nm}PhaseOffset`, sec, 0, 119, 0, { kind: "degrees", step: 3 }, nrpn(0, n0 + 1));
  add(base + 2, `${id}.slew`, `${nm}SlewRate`, sec, 0, 127, 0, PLAIN, nrpn(0, n0 + 2));
  add(base + 3, `${id}.delay`, `${nm}Delay`, sec, 0, 127, 0, PLAIN, nrpn(0, n0 + 4));
  add(base + 4, `${id}.delaySync`, `${nm}DelaySync`, sec, 0, 35, 0, PLAIN, nrpn(0, n0 + 5));
  add(base + 5, `${id}.rate`, `${nm}Rate`, sec, 0, 127, 68, PLAIN, nrpn(0, n0 + 6));
  add(base + 6, `${id}.rateSync`, `${nm}RateSync`, sec, 0, 35, 0, PLAIN, nrpn(0, n0 + 7));
  add(base + 7, `${id}.flags`, `${nm}Flags`, sec, 0, 63, 0, LFO_FLAGS, undefined,
    { note: "bits 0–5; over MIDI they are set with NRPN 0:122 / 0:123 values, not the raw byte" });
}

add(100, "fx.distortionLevel", "Distortion_Level", "FX", 0, 127, 0, PLAIN, cc(91));
add(101, "fx.reserved1", "FX_Reserved1", "FX", 0, 127, 0, PLAIN, undefined, { reserved: true });
add(102, "fx.chorusLevel", "Chorus_Level", "FX", 0, 127, 0, PLAIN, cc(93));
reserved(103, "fx.reserved2", "FX_Reserved2", "FX");
reserved(104, "fx.reserved3", "FX_Reserved3", "FX");
add(105, "eq.bassFrequency", "Equaliser_BassFrequency", "EQ", 0, 127, 64, PLAIN, nrpn(0, 104));
add(106, "eq.bassLevel", "Equaliser_BassLevel", "EQ", 0, 127, 64, BIP, nrpn(0, 105));
add(107, "eq.midFrequency", "Equaliser_MidFrequency", "EQ", 0, 127, 64, PLAIN, nrpn(0, 106));
add(108, "eq.midLevel", "Equaliser_MidLevel", "EQ", 0, 127, 64, BIP, nrpn(0, 107));
add(109, "eq.trebleFrequency", "Equaliser_TrebleFrequency", "EQ", 0, 127, 125, PLAIN, nrpn(0, 108));
add(110, "eq.trebleLevel", "Equaliser_TrebleLevel", "EQ", 0, 127, 64, BIP, nrpn(0, 109));
for (let a = 111; a <= 115; a++) reserved(a, `fx.reserved${a - 107}`, `FX_Reserved${a - 107}`, "FX");
add(116, "fx.distortionType", "Distortion_Type", "FX", 0, 6, 0, enumOf(DRIVE_TYPES), nrpn(1, 0));
add(117, "fx.distortionCompensation", "Distortion_Compensation", "FX", 0, 127, 100, PLAIN, nrpn(1, 1));
add(118, "fx.chorusType", "Chorus_Type", "FX", 0, 1, 1, enumOf(CHORUS_TYPES), nrpn(1, 24));
add(119, "fx.chorusRate", "Chorus_Rate", "FX", 0, 127, 20, PLAIN, nrpn(1, 25));
add(120, "fx.chorusRateSync", "Chorus_RateSync", "FX", 0, 35, 0, PLAIN, nrpn(1, 26));
add(121, "fx.chorusFeedback", "Chorus_Feedback", "FX", 0, 127, 74, BIP, nrpn(1, 27));
add(122, "fx.chorusModDepth", "Chorus_ModDepth", "FX", 0, 127, 64, PLAIN, nrpn(1, 28));
add(123, "fx.chorusDelay", "Chorus_Delay", "FX", 0, 127, 64, PLAIN, nrpn(1, 29));

/** Mod matrix NRPNs run on from 1:83 in steps of 5 and carry into MSB 2 (guide p. 4; macroed.py:66). */
const mmNrpn = (slot: number, off: number): Controller => {
  const n = 83 + 5 * slot + off;
  return nrpn(1 + Math.floor(n / 128), n % 128);
};
for (let k = 0; k < 20; k++) {
  const b = 124 + 4 * k;
  const id = `mod${k + 1}`;
  const nm = `ModMatrix${k + 1}_`;
  add(b, `${id}.source1`, `${nm}Source1`, "Mod Matrix", 0, 12, 0, enumOf(MOD_SOURCES), mmNrpn(k, 0));
  add(b + 1, `${id}.source2`, `${nm}Source2`, "Mod Matrix", 0, 12, 0, enumOf(MOD_SOURCES), mmNrpn(k, 1));
  add(b + 2, `${id}.depth`, `${nm}Depth`, "Mod Matrix", 0, 127, 64, BIP, mmNrpn(k, 3));
  add(b + 3, `${id}.destination`, `${nm}Destination`, "Mod Matrix", 0, 17, 0, enumOf(MOD_DESTINATIONS), mmNrpn(k, 4));
}

for (let k = 0; k < 8; k++) {
  const b = 204 + 17 * k;
  const id = `macro${k + 1}`;
  const nm = `MacroKnob${k + 1}_`;
  add(b, `${id}.position`, `${nm}Position`, "Macros", 0, 127, 0, PLAIN, cc(80 + k));
  for (let s = 0; s < 4; s++) {
    const d = b + 1 + 4 * s;
    const slot = "ABCD"[s]!;
    const lsb = 16 * k + 4 * s;
    add(d, `${id}.${slot.toLowerCase()}.destination`, `${nm}Destination${slot}`, "Macros", 0, 70, 0,
      enumOf([...MACRO_DESTINATIONS, "70 (no effect in firmware)"]), nrpn(3, lsb));
    add(d + 1, `${id}.${slot.toLowerCase()}.start`, `${nm}StartPos${slot}`, "Macros", 0, 127, 0, PLAIN, nrpn(3, lsb + 1));
    add(d + 2, `${id}.${slot.toLowerCase()}.end`, `${nm}EndPos${slot}`, "Macros", 0, 127, 127, PLAIN, nrpn(3, lsb + 2));
    add(d + 3, `${id}.${slot.toLowerCase()}.depth`, `${nm}Depth${slot}`, "Macros", 0, 127, 64, BIP, nrpn(3, lsb + 3));
  }
}

/** Every parameter after the 16-byte name, in address order (bytes 16–339). */
export const PATCH_PARAMS: readonly PatchParam[] = params.sort((a, b) => a.address - b.address);

const byId = new Map(PATCH_PARAMS.map((p) => [p.id, p]));
export function param(id: string): PatchParam {
  const p = byId.get(id);
  if (!p) throw new Error(`no patch parameter "${id}"`);
  return p;
}

/** The guide's default name, "Initial Patch", padded with spaces. */
export const DEFAULT_NAME = "Initial Patch";

/** Shows a raw value in the parameter's own units, e.g. "−12 st", "Saw 7:3 PW", "+5". */
export function displayValue(p: PatchParam, v: number): string {
  const d = p.display;
  switch (d.kind) {
    case "plain": return String(v);
    case "bipolar": return signed(v - 64);
    case "offset": return `${signed(v - 64)} ${d.unit}`;
    case "enum": return d.labels[v] ?? String(v);
    case "degrees": return `${v * d.step}°`;
    case "bits": return d.fields.map((f) => `${f.name} ${(v >> f.bit) & ((1 << f.width) - 1)}`).join(", ");
  }
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
}
