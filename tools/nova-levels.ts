// Read-only: plays C4 on every Synth patch in a card copy through the Nova voice and prints the
// distribution of peak levels, for gain staging. Usage: node tools/nova-levels.ts <Tracks dir>
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PATCH_SIZE, parsePatch, readBank } from "@circuit-desk/patch";
import { NovaSynth } from "@circuit-desk/engine";

const root = process.argv[2];
if (!root) throw new Error("usage: nova-levels.ts <Tracks dir>");
const PATCH0 = 0x26d14;
const SR = 48_000;

const walk = (d: string, re: RegExp, out: string[] = []): string[] => {
  for (const n of readdirSync(d).sort()) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, re, out);
    else if (re.test(n)) out.push(p);
  }
  return out;
};

const all: { where: string; bytes: Uint8Array }[] = [];
for (const f of walk(root, /\.ncs$/i)) {
  const b = readFileSync(f);
  for (const s of [0, 1]) all.push({ where: `${f}#${s + 1}`, bytes: new Uint8Array(b.subarray(PATCH0 + s * PATCH_SIZE, PATCH0 + (s + 1) * PATCH_SIZE)) });
}
for (const f of walk(root, /\.cpb$/i)) for (const r of readBank(new Uint8Array(readFileSync(f)))) all.push({ where: `${f}#${r.index}`, bytes: r.patch });

/** --no-macros: set every macro depth to 0, to compare with and without the (guessed) macro formula. */
const noMacros = process.argv.includes("--no-macros");
const prepared = (bytes: Uint8Array): Record<string, number> => {
  const v = parsePatch(bytes).values;
  if (noMacros) for (const id of Object.keys(v)) if (/^macro\d\.[a-d]\.depth$/.test(id)) v[id] = 64;
  return v;
};

const peaks = all.map((p) => {
  const s = new NovaSynth(SR, prepared(p.bytes));
  s.schedule({ frame: 0, type: "on", note: 60, velocity: 100 });
  s.schedule({ frame: 0.4 * SR, type: "off", note: 60 });
  const out = new Float32Array(0.6 * SR);
  s.process(out);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  return { where: p.where, name: parsePatch(p.bytes).name, peak };
}).sort((a, b) => a.peak - b.peak);

const q = (x: number): string => peaks[Math.floor(x * (peaks.length - 1))]!.peak.toFixed(3);
console.log(`patches ${peaks.length}: min ${q(0)} p10 ${q(0.1)} median ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${q(1)}`);
console.log(`above 1.0: ${peaks.filter((p) => p.peak > 1).length}; silent (< 0.001): ${peaks.filter((p) => p.peak < 1e-3).length}`);
for (const p of peaks.slice(-5)) console.log(`  loud ${p.peak.toFixed(2)} ${p.name} (${p.where.split("/Tracks/")[1]})`);
for (const p of peaks.filter((x) => x.peak < 1e-3).slice(0, 8)) console.log(`  silent ${p.name} (${p.where.split("/Tracks/")[1]})`);
