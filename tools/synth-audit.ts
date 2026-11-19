// Read-only: for every project in a card copy, plays the notes Synth 1 and Synth 2 really have
// (their first pattern with notes) through the Nova voice and reports how loud each comes out.
// Usage: node tools/synth-audit.ts <folder that contains Tracks/> [--list]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NovaSynth } from "@circuit-desk/engine";
import { PATCH0, PATCH_SIZE, SYNC_RATE_TICKS, TEMPO_AT, openProject, readNotePattern } from "@circuit-desk/ncs";
import { parsePatch } from "@circuit-desk/patch";

const SR = 48_000;
const root = process.argv[2];
if (!root) throw new Error("usage: synth-audit.ts <folder that contains Tracks/> [--list]");
const list = process.argv.includes("--list");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ncs$/i.test(name)) out.push(p);
  }
  return out;
}

export interface Result { file: string; synth: number; name: string; notes: number; peakDb: number; rmsDb: number; values: Record<string, number> }

const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -200);
const results: Result[] = [];

for (const f of walk(join(root, "Tracks"))) {
  const bytes = new Uint8Array(readFileSync(f));
  const p = openProject(bytes);
  const bpm = bytes[TEMPO_AT] ?? 120;
  for (const s of [0, 1]) {
    let pat = null;
    for (let i = 0; i < 8 && !pat; i++) {
      const m = readNotePattern(p, s, i);
      if (m.steps.some((st) => st.units.some((u) => u.on))) pat = m;
    }
    if (!pat) continue;
    const patch = parsePatch(bytes.subarray(PATCH0 + s * PATCH_SIZE, PATCH0 + (s + 1) * PATCH_SIZE));
    const stepS = ((SYNC_RATE_TICKS[pat.settings.syncRate & 7] ?? 120) / 480) * (60 / bpm);
    const first = Math.min(pat.settings.firstStep, pat.settings.lastStep), last = Math.max(pat.settings.firstStep, pat.settings.lastStep);
    const syn = new NovaSynth(SR, patch.values);
    let notes = 0;
    for (let st = first; st <= last; st++) {
      for (const u of pat.steps[st]?.units ?? []) {
        if (!u.on) continue;
        notes++;
        const t = (st - first + u.micro / 6) * stepS;
        syn.schedule({ frame: Math.round(t * SR), type: "on", note: u.note, velocity: u.velocity });
        syn.schedule({ frame: Math.round((t + Math.max(1, u.gate) * stepS / 6) * SR), type: "off", note: u.note });
      }
    }
    if (!notes) continue;
    const out = new Float32Array(Math.ceil(((last - first + 1) * stepS + 0.5) * SR));
    syn.process(out);
    let peak = 0, sum = 0;
    for (const v of out) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
    results.push({ file: relative(root, f), synth: s + 1, name: patch.name, notes, peakDb: db(peak), rmsDb: db(Math.sqrt(sum / out.length)), values: patch.values });
  }
}

const bucket = (r: Result): string => (r.peakDb < -60 ? "silent" : r.peakDb < -30 ? "very quiet" : r.peakDb < -18 ? "quiet" : r.peakDb > 0 ? "over full scale" : "ok");
const counts = new Map<string, number>();
for (const r of results) counts.set(bucket(r), (counts.get(bucket(r)) ?? 0) + 1);
console.log(`Synth parts with notes: ${results.length}`);
for (const [k, n] of counts) console.log(`  ${k}: ${n}`);

const pct = (xs: number[], q: number): string => (xs.length ? (xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0).toFixed(1) : "–");
const peaks = results.map((r) => r.peakDb).sort((a, b) => a - b), rms = results.map((r) => r.rmsDb).sort((a, b) => a - b);
console.log(`Peak dBFS  p5 ${pct(peaks, 0.05)}  p25 ${pct(peaks, 0.25)}  median ${pct(peaks, 0.5)}  p75 ${pct(peaks, 0.75)}  p95 ${pct(peaks, 0.95)}  max ${pct(peaks, 0.9999)}`);
console.log(`RMS dBFS   p5 ${pct(rms, 0.05)}  p25 ${pct(rms, 0.25)}  median ${pct(rms, 0.5)}  p75 ${pct(rms, 0.75)}  p95 ${pct(rms, 0.95)}  max ${pct(rms, 0.9999)}`);

const byFile = new Map<string, Result[]>();
for (const r of results) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
let both = 0, bothOk = 0, oneLost = 0, bothLost = 0;
for (const rs of byFile.values()) {
  if (rs.length < 2) continue;
  both++;
  const lost = rs.filter((r) => r.peakDb < -30).length;
  if (lost === 0) bothOk++; else if (lost === 1) oneLost++; else bothLost++;
}
console.log(`Projects where both synths have notes: ${both}. Both audible: ${bothOk}; one lost: ${oneLost}; both lost: ${bothLost}.`);

if (list) {
  const g = (r: Result, id: string): number => r.values[id] ?? -1;
  for (const r of results.filter((x) => bucket(x) !== "ok").sort((a, b) => a.peakDb - b.peakDb)) {
    console.log(`${r.peakDb.toFixed(0).padStart(5)} dB  S${r.synth} "${r.name}"  ${r.file}`);
    console.log(`        osc ${g(r, "mixer.osc1")}/${g(r, "mixer.osc2")} ring ${g(r, "mixer.ringMod")} noise ${g(r, "mixer.noise")} pre ${g(r, "mixer.preFx")} post ${g(r, "mixer.postFx")} | filter type ${g(r, "filter.type")} freq ${g(r, "filter.frequency")} trk ${g(r, "filter.tracking")} res ${g(r, "filter.resonance")} env2 ${g(r, "filter.env2ToFrequency")} route ${g(r, "filter.routing")} | env1 A${g(r, "env1.attack")} D${g(r, "env1.decay")} S${g(r, "env1.sustain")} R${g(r, "env1.release")} vel ${g(r, "env1.velocity")} | env2 A${g(r, "env2.attack")} D${g(r, "env2.decay")} S${g(r, "env2.sustain")}`);
  }
}
