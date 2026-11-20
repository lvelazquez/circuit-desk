// Read-only: what changed between two saves of the same project, as decoded settings and as raw
// bytes by registry field. For device checks: save a project, change settings on the Circuit,
// save again, then: node tools/settings-diff.ts <before.ncs> <after.ncs>
// With one file it prints the decoded settings.
import { readFileSync } from "node:fs";
import * as N from "@circuit-desk/ncs";

const [a, b] = process.argv.slice(2);
if (!a) throw new Error("usage: settings-diff.ts <before.ncs> [<after.ncs>]");
const open = (f: string): N.Project => N.openProject(new Uint8Array(readFileSync(f)));

/** Settings flattened to "path = value", with names for the enumerated ones. */
function flat(p: N.Project): Map<string, string> {
  const s = N.readSettings(p), out = new Map<string, string>();
  const walk = (prefix: string, v: unknown): void => {
    if (v !== null && typeof v === "object") { for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix}.${k}` : k, x); return; }
    out.set(prefix, String(v));
  };
  walk("", s);
  out.set("scale.root", `${s.scale.root} (${N.NOTE_NAMES[s.scale.root]})`);
  out.set("scale.type", `${s.scale.type} (${N.SCALE_NAMES[s.scale.type]})`);
  out.set("sound.reverb.type", `${s.sound.reverb.type} (${N.REVERB_TYPES[s.sound.reverb.type] ?? "?"})`);
  for (let t = 0; t < 8; t++) for (let i = 0; i < 8; i++) {
    const m = t < 4 ? N.readNotePattern(p, t, i) : N.readDrumPattern(p, t - 4, i);
    if (m.settings.direction) out.set(`${[...N.NOTE_TRACKS, ...N.DRUM_TRACKS][t]} pattern ${i + 1}.direction`, String(m.settings.direction));
  }
  return out;
}

const pa = open(a);
if (!b) { for (const [k, v] of flat(pa)) console.log(`${k} = ${v}`); process.exit(0); }
const pb = open(b), fa = flat(pa), fb = flat(pb);
console.log("Decoded settings that changed:");
let n = 0;
for (const k of new Set([...fa.keys(), ...fb.keys()])) if (fa.get(k) !== fb.get(k)) { console.log(`  ${k}: ${fa.get(k) ?? "—"} → ${fb.get(k) ?? "—"}`); n++; }
if (!n) console.log("  (none)");
console.log("\nChanged bytes by field (pattern data summarised):");
const ranges = N.changedRanges(pa.bytes, pb.bytes);
const byField = new Map<string, { status: string; bytes: string[] }>();
for (const r of ranges) {
  const e = byField.get(r.field) ?? { status: r.status, bytes: [] };
  for (let k = 0; k < r.length; k++) {
    const o = r.offset + k;
    e.bytes.push(`0x${o.toString(16)}: ${pa.bytes[o] ?? "—"} → ${pb.bytes[o] ?? "—"}`);
  }
  byField.set(r.field, e);
}
for (const [f, e] of byField) {
  const shown = f.includes("pattern") && e.bytes.length > 6 ? [...e.bytes.slice(0, 6), `… ${e.bytes.length} bytes`] : e.bytes;
  console.log(`  ${f} [${e.status}]: ${shown.join("; ")}`);
}
if (!byField.size) console.log("  (identical)");
