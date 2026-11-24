// Replays a sound report (Transport › Capture Last 10 Seconds) offline: the Synth 1/2 and Keys
// events go through the same Nova voice code, sample for sample, into replay.wav beside the report.
// Then it lists the sharpest jumps in the replay and in the captured audio, with the nearest note
// event, to place a glitch in time. Drums and MIDI 1/2 are not replayed (sampler, stand-in).
// Usage: node tools/replay-report.ts "<…/Exports/Reports/Sound …>"
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NovaSynth, encodeWav } from "@circuit-desk/engine";
import { parsePatch } from "@circuit-desk/patch";
import { useComponentsTables } from "./lib/nova-tables.ts";

interface ReportEvent { offset: number; source: "player" | "keys"; track: number | null; bytes: number[]; route?: string; sound?: string }
interface Report {
  kind: string;
  firmware: string | null;
  project: string | null;
  audio: { sampleRate: number; frames: number };
  keys: { label: string; patch: number[] | null } | null;
  synthPatches: { synth1: number[]; synth2: number[] } | null;
  events: ReportEvent[];
}

const dir = process.argv[2];
if (!dir) throw new Error('usage: replay-report.ts "<report folder>"');
const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as Report;
if (report.kind !== "circuit-desk sound report") throw new Error("not a Circuit Desk sound report");
const SR = report.audio.sampleRate, frames = report.audio.frames;
console.error(useComponentsTables());

/** Which patch an event plays, or null when it is not a Nova sound. */
function patchFor(e: ReportEvent): { key: string; bytes: number[] } | null {
  if (e.source === "player") {
    if (e.track === 0 && report.synthPatches) return { key: "Synth 1", bytes: report.synthPatches.synth1 };
    if (e.track === 1 && report.synthPatches) return { key: "Synth 2", bytes: report.synthPatches.synth2 };
    return null;
  }
  if (e.route !== "preview") return null;
  if (report.keys?.patch && (e.sound === undefined || e.sound === report.keys.label)) return { key: `Keys: ${report.keys.label}`, bytes: report.keys.patch };
  if (e.sound?.startsWith("Synth 1") && report.synthPatches) return { key: "Keys: Synth 1", bytes: report.synthPatches.synth1 };
  if (e.sound?.startsWith("Synth 2") && report.synthPatches) return { key: "Keys: Synth 2", bytes: report.synthPatches.synth2 };
  return null;
}

const synths = new Map<string, NovaSynth>();
let skipped = 0;
for (const e of report.events) {
  const p = patchFor(e);
  if (!p) { skipped++; continue; }
  let s = synths.get(p.key);
  if (!s) { s = new NovaSynth(SR, parsePatch(Uint8Array.from(p.bytes)).values); synths.set(p.key, s); }
  const frame = Math.max(0, Math.round(e.offset * SR));
  const [status = 0, a = 0, b = 0] = e.bytes;
  const kind = status & 0xf0;
  if (kind === 0x90 && b > 0) s.schedule({ frame, type: "on", note: a, velocity: b });
  else if (kind === 0x80 || kind === 0x90) s.schedule({ frame, type: "off", note: a });
  else if (kind === 0xb0 && (a === 120 || a === 123)) s.schedule({ frame, type: "silence" });
}

const mix = new Float32Array(frames);
const part = new Float32Array(128);
for (const [name, s] of synths) {
  let peak = 0, bad = 0;
  for (let f = 0; f < frames; f += 128) {
    const n = Math.min(128, frames - f);
    part.fill(0);
    s.process(part.subarray(0, n));
    for (let i = 0; i < n; i++) { const v = part[i]!; if (!Number.isFinite(v)) bad++; else { mix[f + i]! += v; peak = Math.max(peak, Math.abs(v)); } }
  }
  console.log(`${name}: peak ${peak.toFixed(3)}${bad ? `, ${bad} non-finite samples` : ""}`);
}
writeFileSync(join(dir, "replay.wav"), encodeWav([mix, mix], SR));
console.log(`replay.wav: ${(frames / SR).toFixed(2)} s, ${synths.size} Nova sound(s), ${report.events.length - skipped} events replayed, ${skipped} not Nova (drums, MIDI tracks, MIDI out)`);

const noteTimes = report.events.filter((e) => ((e.bytes[0] ?? 0) & 0xe0) === 0x80).map((e) => e.offset);
const nearest = (t: number): string => {
  let best = Infinity;
  for (const n of noteTimes) if (Math.abs(n - t) < Math.abs(best)) best = n - t;
  return Number.isFinite(best) ? `nearest note event ${best >= 0 ? "+" : ""}${(best * 1000).toFixed(1)} ms` : "no note events";
};
/** The `count` largest sample-to-sample jumps, at least 20 ms apart. */
function jumps(x: Float32Array, count = 5): { t: number; size: number }[] {
  const all: { i: number; size: number }[] = [];
  for (let i = 1; i < x.length; i++) all.push({ i, size: Math.abs(x[i]! - x[i - 1]!) });
  all.sort((a, b) => b.size - a.size);
  const out: { t: number; size: number }[] = [];
  for (const j of all) {
    if (out.length >= count) break;
    if (out.every((o) => Math.abs(o.t * SR - j.i) > 0.02 * SR)) out.push({ t: j.i / SR, size: j.size });
  }
  return out;
}
const show = (label: string, x: Float32Array): void => {
  const top = jumps(x).filter((j) => j.size > 1e-4);
  console.log(`${label}, sharpest jumps:${top.length ? "" : " none (silent)"}`);
  for (const j of top) console.log(`  ${j.t.toFixed(3)} s  jump ${j.size.toFixed(3)}  (${nearest(j.t)})`);
};
show("replay (Nova only)", mix);

// The captured audio (the whole mix, after the master limiter and soft clipper), left channel.
const wav = readFileSync(join(dir, "audio.wav"));
const ch = wav.readUInt16LE(22), n = (wav.length - 44) / (2 * ch);
const heard = new Float32Array(n);
for (let i = 0; i < n; i++) heard[i] = wav.readInt16LE(44 + i * ch * 2) / 32768;
show("captured audio (whole mix)", heard);
