// Read-only: how loud a project's Synth 1/2 play through the Nova voice compared with its drum
// samples, as the preview engine mixes them (before the master gain and limiter).
// Usage: node tools/mix-levels.ts <project.ncs>
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATCH_SIZE, parsePatch } from "@circuit-desk/patch";
import { NovaSynth } from "@circuit-desk/engine";

const file = process.argv[2];
if (!file) throw new Error("usage: mix-levels.ts <project.ncs>");
const b = new Uint8Array(readFileSync(file));
const SR = 48_000;
const db = (x: number): string => (x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dBFS` : "silent");

for (const s of [0, 1]) {
  const patch = parsePatch(b.subarray(0x26d14 + s * PATCH_SIZE, 0x26d14 + (s + 1) * PATCH_SIZE));
  for (const note of [48, 60, 72]) {
    const syn = new NovaSynth(SR, patch.values);
    syn.schedule({ frame: 0, type: "on", note, velocity: 100 });
    syn.schedule({ frame: 0.5 * SR, type: "off", note });
    const out = new Float32Array(SR);
    syn.process(out);
    let peak = 0, sum = 0;
    for (const v of out) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
    console.log(`Synth ${s + 1} "${patch.name}" note ${note}: peak ${db(peak)}, RMS ${db(Math.sqrt(sum / out.length))}`);
  }
}

// Drum samples the project uses (byte 0 of each drum record), as 16-bit WAV peaks.
const pcm = join(dirname(dirname(file)), "PCM");
const files = readdirSync(pcm);
for (let d = 0; d < 4; d++) {
  const idx = b[0x26fbc + d * 11] ?? 0;
  const f = files.find((x) => x.startsWith(String(idx).padStart(2, "0") + "_"));
  if (!f) continue;
  const w = readFileSync(join(pcm, f));
  let peak = 0;
  for (let i = 44; i + 1 < w.length; i += 2) peak = Math.max(peak, Math.abs(w.readInt16LE(i)) / 32768);
  console.log(`Drum ${d + 1} sample ${f}: peak ${db(peak)}`);
}
