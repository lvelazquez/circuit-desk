// Read-only survey of the Circuit Tracks projects (.ncs) in a card copy.
// Usage: node tools/card-survey.ts <folder that contains Tracks/> [report.md]
// Offsets: circuit-hacks-rc/tools/sd_app.html:150-153 and docs/NOTAS.md (session file map).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const SESS_SIZE = 0x2740c;
const SYNTH0 = 0x2e4, DRUM0 = 0xcd74, MIDI0 = 0x1a27c;
const PAT = 0xca8, DPAT = 0x6a8;
const NSTEPS = 32, STEP = 28, UNITS = 6;
const SETT = 0x380, DSETT = 0x80, SETN = 40;
const LANE0 = 0x3a8, NLANES = 12, DLANE0 = 0xa8, DLANES = 8, LANE = 192;
const SCENE0 = 0x40, SCENE = 40, NSCENES = 16, CHAIN0 = 0x2c0;
const LOOSE = 0x26cfc, LOOSE_N = 24;
const BLOBS = 0x26d14, PATCH = 340, DRUMBLOB = BLOBS + 2 * PATCH, DRUMBLOB_N = 44, PARAMS = DRUMBLOB + DRUMBLOB_N, PARAMS_N = 60;
const TAIL = 0x27024, TAIL_N = 1000;

type Counter = Map<number, number>;
const bump = (c: Counter, k: number): void => { c.set(k, (c.get(k) ?? 0) + 1); };
const show = (c: Counter): string =>
  [...c.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}×${n}`).join(", ");
const allEq = (b: Uint8Array, at: number, n: number, v: number): boolean => {
  for (let i = at; i < at + n; i++) if (b[i] !== v) return false;
  return true;
};
const hex = (n: number): string => "0x" + n.toString(16).toUpperCase();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ncs$/i.test(name)) out.push(p);
  }
  return out;
}

const root = process.argv[2];
if (!root) { console.error("usage: node tools/card-survey.ts <folder that contains Tracks/> [report.md]"); process.exit(2); }
const files = walk(join(root, "Tracks"));

const tempo: Counter = new Map(), swing: Counter = new Map(), b36: Counter = new Map(), colour: Counter = new Map();
const scenesSaved: Counter = new Map(), rate: Counter = new Map(), dir: Counter = new Map(), drumRate: Counter = new Map(), drumDir: Counter = new Map();
const perPack = new Map<string, { n: number; tailDirty: number; settDirty: number }>();
const bad: string[] = [];
let headerOk = 0, tailDirty = 0, hdrRestDirty = 0, sceneSpareDirty = 0, chainSpareDirty = 0;
let notePats = 0, notePatsUsed = 0, patsTie = 0, patsLanes = 0, patsSett4to39 = 0, patsStepB23 = 0, notes = 0, tiedNotes = 0;
let drumPats = 0, drumPatsUsed = 0, drumLanes = 0, drumSett4to39 = 0;
let projSceneChain = 0, projPatChain = 0;
const gate: Counter = new Map();
const looseVals: Set<number>[] = Array.from({ length: LOOSE_N }, () => new Set<number>());
const drumVals: Set<number>[] = Array.from({ length: DRUMBLOB_N }, () => new Set<number>());
const paramVals: Set<number>[] = Array.from({ length: PARAMS_N }, () => new Set<number>());

for (const f of files) {
  const b = new Uint8Array(readFileSync(f));
  const rel = relative(root, f);
  const pack = rel.split("/")[1] ?? "?";
  const pp = perPack.get(pack) ?? { n: 0, tailDirty: 0, settDirty: 0 };
  pp.n++; perPack.set(pack, pp);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length !== SESS_SIZE) { bad.push(`${rel}: size ${b.length}`); continue; }
  const magic = String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!);
  if (magic !== "USER" || v.getUint32(4, true) !== SESS_SIZE) bad.push(`${rel}: header ${magic} ${hex(v.getUint32(4, true))}`);
  else headerOk++;

  bump(colour, v.getUint32(0x0c, true));
  bump(tempo, b[0x34]!); bump(swing, b[0x35]!); bump(b36, b[0x36]!);
  if (!allEq(b, 0x37, 9, 0)) hdrRestDirty++;

  let saved = 0, spare = false;
  for (let e = 0; e < NSCENES; e++) {
    const o = SCENE0 + e * SCENE;
    if (b[o + 32]) saved++;
    for (let t = 0; t < 8; t++) if (b[o + 4 * t + 2] || b[o + 4 * t + 3]) spare = true;
    if (!allEq(b, o + 33, 7, 0)) spare = true;
  }
  bump(scenesSaved, saved);
  if (spare) sceneSpareDirty++;
  let chainSpare = false;
  for (let i = 0; i < 9; i++) if (b[CHAIN0 + 4 * i + 2] || b[CHAIN0 + 4 * i + 3]) chainSpare = true;
  if (chainSpare) chainSpareDirty++;
  if (b[CHAIN0] !== b[CHAIN0 + 1]) projSceneChain++;
  let anyPatChain = false;
  for (let t = 1; t < 9; t++) if (b[CHAIN0 + 4 * t] !== b[CHAIN0 + 4 * t + 1]) anyPatChain = true;
  if (anyPatChain) projPatChain++;

  let settDirtyHere = false;
  for (const base of [SYNTH0, MIDI0]) {
    for (let p = 0; p < 16; p++) {
      const o = base + p * PAT;
      notePats++;
      let n = 0, tie = false, b23 = false;
      for (let s = 0; s < NSTEPS; s++) {
        const q = o + s * STEP;
        if (b[q + 2] || b[q + 3]) b23 = true;
        for (let u = 0; u < UNITS; u++) {
          if (!((b[q]! >> u) & 1)) continue;
          n++;
          const g = b[q + 4 + 4 * u + 1]!;
          bump(gate, g & 127);
          if (g >> 7) { tie = true; tiedNotes++; }
        }
      }
      notes += n;
      let lanes = 0;
      for (let k = 0; k < NLANES; k++) if (!allEq(b, o + LANE0 + LANE * k, LANE, 0xff)) lanes++;
      if (n || lanes) {
        notePatsUsed++;
        bump(rate, b[o + SETT + 2]!); bump(dir, b[o + SETT + 3]!);
      }
      if (tie) patsTie++;
      if (lanes) patsLanes++;
      if (b23) patsStepB23++;
      if (!allEq(b, o + SETT + 4, SETN - 4, 0)) { patsSett4to39++; settDirtyHere = true; }
    }
  }
  for (let p = 0; p < 32; p++) {
    const o = DRUM0 + p * DPAT;
    drumPats++;
    let hits = 0;
    for (let s = 0; s < NSTEPS; s++) if (b[o + s]) hits++;
    let lanes = 0;
    for (let k = 0; k < DLANES; k++) if (!allEq(b, o + DLANE0 + LANE * k, LANE, 0xff)) lanes++;
    if (hits || lanes) { drumPatsUsed++; bump(drumRate, b[o + DSETT + 2]!); bump(drumDir, b[o + DSETT + 3]!); }
    if (lanes) drumLanes++;
    if (!allEq(b, o + DSETT + 4, SETN - 4, 0)) { drumSett4to39++; settDirtyHere = true; }
  }
  if (settDirtyHere) pp.settDirty++;

  for (let i = 0; i < LOOSE_N; i++) looseVals[i]!.add(b[LOOSE + i]!);
  for (let i = 0; i < DRUMBLOB_N; i++) drumVals[i]!.add(b[DRUMBLOB + i]!);
  for (let i = 0; i < PARAMS_N; i++) paramVals[i]!.add(b[PARAMS + i]!);
  if (!allEq(b, TAIL, TAIL_N, 0)) { tailDirty++; pp.tailDirty++; }
}

const block = (name: string, at: number, vals: Set<number>[]): string[] => {
  const out = [`### ${name} (${hex(at)}, ${vals.length} B)`, "", "| Offset | Distinct values | Min | Max | Values (if 8 or fewer) |", "|---|---|---|---|---|"];
  let constant = 0;
  vals.forEach((s, i) => {
    if (s.size === 1) { constant++; return; }
    const a = [...s].sort((x, y) => x - y);
    out.push(`| ${hex(at + i)} (+${i}) | ${s.size} | ${a[0]} | ${a[a.length - 1]} | ${s.size <= 8 ? a.join(", ") : ""} |`);
  });
  const fixed = vals.map((s, i) => (s.size === 1 ? `+${i}=${[...s][0]}` : "")).filter(Boolean).join(" ");
  out.push("", `Same in every project (${constant} bytes): ${fixed || "none"}`, "");
  return out;
};

const n = files.length;
const md: string[] = [
  "# Card survey", "",
  `Source: \`${root}\`. Projects read: **${n}**. Counts only; no project contents.`, "",
  "## Files", "",
  `- Header \`USER\` + size word ${hex(SESS_SIZE)}: ${headerOk} of ${n}.`,
  `- Problems: ${bad.length ? bad.join("; ") : "none"}.`, "",
  "| Pack | Projects | Tail not zero | Pattern settings 4–39 not zero |", "|---|---|---|---|",
  ...[...perPack.entries()].map(([k, p]) => `| ${k} | ${p.n} | ${p.tailDirty} | ${p.settDirty} |`), "",
  "## Header", "",
  `- Tempo byte ${hex(0x34)} (value×projects): ${show(tempo)}`,
  `- Swing byte ${hex(0x35)}: ${show(swing)}`,
  `- Byte ${hex(0x36)}: ${show(b36)}`,
  `- Colour word ${hex(0x0c)}: ${show(colour)}`,
  `- Bytes 0x37–0x3F not zero: ${hdrRestDirty} projects.`, "",
  "## Scenes and chains", "",
  `- Saved scenes per project (scenes×projects): ${show(scenesSaved)}`,
  `- Spare scene bytes not zero: ${sceneSpareDirty} projects. Spare chain bytes at ${hex(CHAIN0)} not zero: ${chainSpareDirty} projects.`,
  `- Projects whose active scene chain spans more than one scene: ${projSceneChain}. Projects with a pattern chain on at least one track: ${projPatChain}.`, "",
  "## Note patterns (Synth 1/2, MIDI 1/2)", "",
  `- Patterns: ${notePats}; with notes or automation: ${notePatsUsed}. Notes: ${notes}.`,
  `- Patterns with a tied note: ${patsTie} (${tiedNotes} tied notes).`,
  `- Patterns with automation: ${patsLanes}.`,
  `- Sync rate index in used patterns (index×patterns): ${show(rate)}`,
  `- Direction in used patterns: ${show(dir)}`,
  `- Gate length, bits 0–6 (value×notes): ${show(gate)}`,
  `- Patterns with step bytes 2/3 not zero: ${patsStepB23}. Patterns with settings bytes 4–39 not zero: ${patsSett4to39}.`, "",
  "## Drum patterns", "",
  `- Patterns: ${drumPats}; with hits or automation: ${drumPatsUsed}; with automation: ${drumLanes}.`,
  `- Sync rate index in used patterns: ${show(drumRate)}`,
  `- Direction in used patterns: ${show(drumDir)}`,
  `- Patterns with settings bytes 4–39 not zero: ${drumSett4to39}.`, "",
  "## Project-wide settings blocks", "",
  ...block("Loose settings", LOOSE, looseVals),
  ...block("Drum block", DRUMBLOB, drumVals),
  ...block("Project parameters", PARAMS, paramVals),
  "## Tail", "",
  `- Projects whose 1 000-byte tail at ${hex(TAIL)} is not all zero: ${tailDirty} of ${n}.`, "",
];
const text = md.join("\n");
const outPath = process.argv[3];
if (outPath) writeFileSync(outPath, text);
console.log(text);
process.exit(bad.length ? 1 : 0);
