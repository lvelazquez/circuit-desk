// Fetch the oscillator wavetables and LFO tables that Novation Components loads for its Circuit
// synth editor, and write them as one JSON file plus a README outside the repo (Novation's data:
// never commit the output). Usage: node tools/components-tables.ts [out dir]
// Default out dir: ~/Circuit Desk/Components-derived/<yyyy-mm-dd>.
//
// Source (observed 2026-11-24 in components.novationmusic.com, bundle main-D3lNZfPT.js):
// - CIRCUIT_WAVETABLES = /assets/circuit-wavetables.zip: 16 files, 9 frames × 128 unsigned 8-bit
//   samples (0x80 = zero). Wave 14 + i uses WAVETABLE_FILES[i] (the editor's CBe list).
// - CIRCUIT_LFO_TABLES = /assets/circuit-lfo-tables.zip: all_lfos.bin, 38 waves × 250 unsigned
//   8-bit samples; the editor slices 250 × wave.
// These are what the editor draws. They are Novation's own tables but not proven bit-identical
// to the device DSP (which keeps ~8 MB of wavetables in core 1's memory).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = "https://components.novationmusic.com/assets/";
const FRAMES = 9, FRAME_LEN = 128, LFO_WAVES = 38, LFO_LEN = 250;

export const OSC_WAVE_NAMES: readonly string[] = [
  "Sine", "Triangle", "Saw", "Saw [9:1] PW", "Saw [8:2] PW", "Saw [7:3] PW", "Saw [6:4] PW",
  "Saw [5:5] PW", "Saw [4:6] PW", "Saw [3:7] PW", "Saw [2:8] PW", "Saw [1:9] PW", "Pulse Width",
  "Square", "Sine Table", "Analogue Pulse", "Analogue Sync", "Tri-Saw Blend", "Digital Nasty 1",
  "Digital Nasty 2", "Digital Saw-Square", "Digital Vocal 1", "Digital Vocal 2", "Digital Vocal 3",
  "Digital Vocal 4", "Digital Vocal 5", "Digital Vocal 6", "Collection 1", "Collection 2",
  "Collection 3",
];

/** Wave 14 + i → file, in the editor's order (CBe). */
export const WAVETABLE_FILES: readonly string[] = [
  "sine_table", "analogue_pulse", "analogue_sync", "triangle_saw_blend", "digital_nasty_1",
  "digital_nasty_2", "digital_saw_square", "digital_vocal_1", "digital_vocal_2", "digital_vocal_3",
  "digital_vocal_4", "digital_vocal_5", "digital_vocal_6", "random_collection_1",
  "random_collection_2", "random_collection_3",
];

export const LFO_WAVE_NAMES: readonly string[] = [
  "Sine", "Triangle", "Sawtooth", "Square", "Random S/H", "Time S/H", "Piano env",
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `Sequence ${n}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Alternative ${n}`),
  "Chromatic", "Chromatic 16", "Major", "Major 7", "Minor 7", "Min arp 1", "Min arp 2",
  "Diminished", "Dec minor", "Minor 3rd", "Pedal", "4ths", "4ths x12", "1625 maj", "1625 Min", "2511",
];

async function fetchZip(name: string, dir: string): Promise<{ path: string; sha256: string; lastModified: string }> {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const path = join(dir, name);
  writeFileSync(path, buf);
  return { path, sha256: createHash("sha256").update(buf).digest("hex"), lastModified: res.headers.get("last-modified") ?? "" };
}

function unzip(zip: string, dest: string): void {
  execFileSync("unzip", ["-oq", zip, "-d", dest]);
}

function readExact(path: string, size: number): Uint8Array {
  const b = readFileSync(path);
  if (b.length !== size) throw new Error(`${path}: ${b.length} B, expected ${size}`);
  return new Uint8Array(b);
}

async function main(): Promise<void> {
  const out = process.argv[2] ?? join(homedir(), "Circuit Desk", "Components-derived", new Date().toISOString().slice(0, 10));
  mkdirSync(out, { recursive: true });
  const zips = join(out, "zips"), raw = join(out, "raw");
  for (const d of [zips, join(raw, "wavetables"), join(raw, "lfo")]) mkdirSync(d, { recursive: true });
  const wt = await fetchZip("circuit-wavetables.zip", zips);
  const lf = await fetchZip("circuit-lfo-tables.zip", zips);
  unzip(wt.path, join(raw, "wavetables"));
  unzip(lf.path, join(raw, "lfo"));

  const wavetables: Record<string, { name: string; file: string; frames: number[][] }> = {};
  WAVETABLE_FILES.forEach((file, i) => {
    const b = readExact(join(raw, "wavetables", `${file}.bin`), FRAMES * FRAME_LEN);
    const frames = Array.from({ length: FRAMES }, (_, f) => Array.from(b.subarray(f * FRAME_LEN, (f + 1) * FRAME_LEN)));
    wavetables[String(14 + i)] = { name: OSC_WAVE_NAMES[14 + i]!, file: `${file}.bin`, frames };
  });
  const lfoBin = readExact(join(raw, "lfo", "all_lfos.bin"), LFO_WAVES * LFO_LEN);
  const lfo = LFO_WAVE_NAMES.map((name, id) => ({ id, name, samples: Array.from(lfoBin.subarray(id * LFO_LEN, (id + 1) * LFO_LEN)) }));

  const doc = {
    source: {
      site: "components.novationmusic.com (Circuit Tracks synth editor)",
      fetched: new Date().toISOString(),
      zips: { "circuit-wavetables.zip": wt, "circuit-lfo-tables.zip": lf },
      note: "Novation's data. Personal use; never commit.",
    },
    format: {
      sample: "unsigned 8-bit, 128 = zero; bipolar value = (v - 128) / 128",
      wavetable: `${FRAMES} frames × ${FRAME_LEN} samples, one cycle per frame`,
      lfo: `${LFO_WAVES} waves × ${LFO_LEN} samples, one cycle per wave`,
    },
    osc: {
      waves: OSC_WAVE_NAMES.map((name, id) => ({ id, name, kind: id < 14 ? "formula" : "table" })),
      // The editor's display code (PBe #Sc), with idx = stored pulseWidth/index − 64 (−64…63):
      indexToFrame: "s = (idx + 65) / 128; pos = 8 * s; a = floor(pos); b = min(8, a + 1); t = pos - a",
      interpolate: "interp = 0 → frame a only; else k = (127 - interp) / 16 + 1; w = t < 0.5 ? 0.5 * (2t)^k : 1 - 0.5 * (2(1 - t))^k; out = A + (B - A) * w",
      formulaWaves: "3–11 Saw [n:m] PW, 12 Pulse Width (pulse width = index), 13 Square, 0–2 sine/triangle/saw",
    },
    lfoDisplay: { phase: "editor rotates the 250 samples left by phase / 127 × 250 (stored phase is 3° steps, 0–119)" },
    wavetables,
    lfo,
  };
  writeFileSync(join(out, "circuit-tables.json"), JSON.stringify(doc));
  console.log(`wrote ${join(out, "circuit-tables.json")}: ${WAVETABLE_FILES.length} wavetables, ${lfo.length} LFO waves`);
}

await main();
