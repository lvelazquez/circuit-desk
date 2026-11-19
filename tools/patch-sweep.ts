// Read-only sweep: checks Novation's "Synth Patch Format" (Programmer's Reference v3, pp. 16–22)
// against every 340 B patch in a card copy. Usage: node patch-sweep.ts <Tracks dir>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const root = process.argv[2];
if (!root) throw new Error("usage: patch-sweep.ts <Tracks dir>");

const PATCH0 = 0x26d14;
const SIZE = 340;
const REC = 512;

// [address, min, max] from the guide; reserved bytes checked as "always 0".
type Rule = { at: number; min: number; max: number; name: string };
const rules: Rule[] = [];
const r = (at: number, min: number, max: number, name: string): void => { rules.push({ at, min, max, name }); };
r(16, 0, 14, "Category"); r(17, 0, 9, "Genre");
for (let a = 18; a <= 31; a++) r(a, 0, 0, `Reserved${a - 17}`);
r(32, 0, 2, "PolyMode"); r(33, 0, 127, "Portamento"); r(34, 52, 76, "PreGlide"); r(35, 58, 69, "KbdOctave");
for (const [base, o] of [[36, 1], [45, 2]] as const) {
  r(base, 0, 29, `Osc${o}Wave`);
  for (let k = 1; k <= 7; k++) r(base + k, 0, 127, `Osc${o}+${k}`);
  r(base + 8, 52, 76, `Osc${o}PitchBend`);
}
for (let a = 54; a <= 57; a++) r(a, 0, 127, `Mixer${a}`);
r(58, 52, 82, "PreFX"); r(59, 52, 82, "PostFX");
r(60, 0, 2, "FilterRouting"); r(61, 0, 127, "Drive"); r(62, 0, 6, "DriveType"); r(63, 0, 5, "FilterType");
for (let a = 64; a <= 83; a++) r(a, 0, 127, `Filt/Env${a}`);
for (const b of [84, 92]) {
  r(b, 0, 37, `LFO@${b}Wave`); r(b + 1, 0, 119, "Phase"); r(b + 2, 0, 127, "Slew"); r(b + 3, 0, 127, "Delay");
  r(b + 4, 0, 35, "DelaySync"); r(b + 5, 0, 127, "Rate"); r(b + 6, 0, 35, "RateSync"); r(b + 7, 0, 63, `LFO@${b}Flags(bits0-5)`);
}
r(100, 0, 127, "DistLevel"); r(101, 0, 127, "FX_Reserved1"); r(102, 0, 127, "ChorusLevel");
r(103, 0, 0, "FX_Reserved2"); r(104, 0, 0, "FX_Reserved3");
for (let a = 105; a <= 110; a++) r(a, 0, 127, `EQ${a}`);
for (let a = 111; a <= 115; a++) r(a, 0, 0, `FX_Reserved${a - 107}`);
r(116, 0, 6, "DistType"); r(117, 0, 127, "DistComp"); r(118, 0, 1, "ChorusType"); r(119, 0, 127, "ChorusRate");
r(120, 0, 35, "ChorusRateSync"); for (let a = 121; a <= 123; a++) r(a, 0, 127, `Chorus${a}`);
for (let m = 0; m < 20; m++) {
  const b = 124 + m * 4;
  r(b, 0, 12, `MM${m + 1}Src1`); r(b + 1, 0, 12, `MM${m + 1}Src2`); r(b + 2, 0, 127, `MM${m + 1}Depth`); r(b + 3, 0, 17, `MM${m + 1}Dest`);
}
for (let k = 0; k < 8; k++) {
  const b = 204 + k * 17;
  r(b, 0, 127, `Macro${k + 1}Pos`);
  for (let s = 0; s < 4; s++) {
    const d = b + 1 + s * 4;
    r(d, 0, 70, `Macro${k + 1}Dest${"ABCD"[s]}`); r(d + 1, 0, 127, "Start"); r(d + 2, 0, 127, "End"); r(d + 3, 0, 127, "Depth");
  }
}
if (rules.length !== SIZE - 16) throw new Error(`rule table covers ${rules.length + 16} bytes, expected ${SIZE}`);

type Src = { kind: "project" | "bank"; where: string; bytes: Uint8Array };
const patches: Src[] = [];
const bankSizes = new Map<number, number>();
const paddings = { none: 0, filler: 0, ctm1: 0, other: 0 };

for (const pack of readdirSync(root).sort()) {
  const dir = join(root, pack);
  if (!statSync(dir).isDirectory()) continue;
  const sess = join(dir, "Sessions");
  try {
    for (const f of readdirSync(sess).filter((n) => n.endsWith(".ncs")).sort()) {
      const buf = readFileSync(join(sess, f));
      for (const s of [0, 1]) patches.push({ kind: "project", where: `${pack}/${f}#synth${s + 1}`, bytes: buf.subarray(PATCH0 + s * SIZE, PATCH0 + (s + 1) * SIZE) });
    }
  } catch { /* pack without sessions */ }
  const pdir = join(dir, "Patches");
  try {
    for (const f of readdirSync(pdir).filter((n) => n.endsWith(".cpb")).sort()) {
      const buf = readFileSync(join(pdir, f));
      bankSizes.set(buf.length, (bankSizes.get(buf.length) ?? 0) + 1);
      for (let i = 0; i * REC < buf.length; i++) {
        const rec = buf.subarray(i * REC, (i + 1) * REC);
        patches.push({ kind: "bank", where: `${pack}/${f}#${i}`, bytes: rec.subarray(0, SIZE) });
        const pad = rec.subarray(SIZE);
        if (pad.length === 0) paddings.none++;
        else if (pad.every((b) => b === 0xff)) paddings.filler++;
        else if (Buffer.from(pad.subarray(0, 4)).toString("latin1") === "CTM1") paddings.ctm1++;
        else paddings.other++;
      }
    }
  } catch { /* no patches */ }
}

const viol = new Map<string, { n: number; values: Set<number>; ex: string }>();
let nameBad = 0;
const nameBadEx: string[] = [];
const cats = new Map<number, number>();
const waves = new Map<number, number>();
const macroDests = new Map<number, number>();
let cleanPatches = 0;
for (const p of patches) {
  let ok = true;
  const name = p.bytes.subarray(0, 16);
  if (!name.every((b) => b >= 32 && b <= 126)) { nameBad++; ok = false; if (nameBadEx.length < 5) nameBadEx.push(`${p.where}: ${[...name].join(",")}`); }
  for (const rule of rules) {
    const v = p.bytes[rule.at]!;
    if (v < rule.min || v > rule.max) {
      ok = false;
      const k = `${rule.at} ${rule.name} [${rule.min}-${rule.max}]`;
      const e = viol.get(k) ?? { n: 0, values: new Set<number>(), ex: p.where };
      e.n++; e.values.add(v); viol.set(k, e);
    }
  }
  if (ok) cleanPatches++;
  cats.set(p.bytes[16]!, (cats.get(p.bytes[16]!) ?? 0) + 1);
  for (const a of [36, 45]) waves.set(p.bytes[a]!, (waves.get(p.bytes[a]!) ?? 0) + 1);
  for (let k = 0; k < 8; k++) for (let s = 0; s < 4; s++) { const d = p.bytes[204 + k * 17 + 1 + s * 4]!; macroDests.set(d, (macroDests.get(d) ?? 0) + 1); }
}

const proj = patches.filter((p) => p.kind === "project");
const bank = patches.filter((p) => p.kind === "bank");
const bankHashes = new Set(bank.map((p) => createHash("sha1").update(p.bytes).digest("hex")));
const projInBank = proj.filter((p) => bankHashes.has(createHash("sha1").update(p.bytes).digest("hex"))).length;
const projNameOnlyMatch = proj.filter((p) => bank.some((b) => Buffer.compare(Buffer.from(b.bytes.subarray(0, 16)), Buffer.from(p.bytes.subarray(0, 16))) === 0)).length;

console.log(`patches: ${patches.length} (${proj.length} project, ${bank.length} bank records)`);
console.log(`bank file sizes: ${[...bankSizes].map(([s, n]) => `${s} B × ${n}`).join(", ")}`);
console.log(`bank padding (after the 340 B): none (last record) ${paddings.none}, 0xFF filler ${paddings.filler}, CIRCUIT-HACKS CTM1 ${paddings.ctm1}, other ${paddings.other}`);
console.log(`fully in range: ${cleanPatches}/${patches.length}; bad names: ${nameBad}`);
for (const e of nameBadEx) console.log(`  name ex: ${e}`);
console.log(`project patches identical to some bank record: ${projInBank}/${proj.length}; same name as some bank record: ${projNameOnlyMatch}`);
console.log("violations (address name [range]: count, values, example):");
for (const [k, e] of [...viol].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k}: ${e.n}, {${[...e.values].sort((a, b) => a - b).slice(0, 12).join(",")}}, ${e.ex}`);
const hist = (m: Map<number, number>): string => [...m].sort((a, b) => a[0] - b[0]).map(([v, n]) => `${v}:${n}`).join(" ");
console.log(`categories: ${hist(cats)}`);
console.log(`osc waves: ${hist(waves)}`);
console.log(`macro dests: ${hist(macroDests)}`);
console.log("sample names:", [...new Set(patches.slice(0, 400).map((p) => Buffer.from(p.bytes.subarray(0, 16)).toString("latin1").trimEnd()))].slice(0, 20).join(" | "));
