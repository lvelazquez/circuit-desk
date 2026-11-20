// Read-only: compares the notes a Circuit sent while playing a project (recorded with
// `npm run app:midi-record`) with the notes the project stores, to settle whether the device
// transposes note tracks by the scale root. Usage: node tools/compare-midi.ts <project.ncs> <recording.json>
import { readFileSync } from "node:fs";
import * as N from "@circuit-desk/ncs";
import { arrange, DEFAULT_CHANNELS } from "@circuit-desk/export";

const [file, rec] = process.argv.slice(2);
if (!file || !rec) throw new Error("usage: compare-midi.ts <project.ncs> <recording.json>");
const p = N.openProject(new Uint8Array(readFileSync(file)));
const { root, type } = N.readScale(p);
const a = arrange(p, { source: "current", swing: false });
const msgs = JSON.parse(readFileSync(rec, "utf8")) as { t: number; bytes: number[] }[];
console.log(`project root ${N.NOTE_NAMES[root]} (${root}), scale ${N.SCALE_NAMES[type]}`);
for (let t = 0; t < 4; t++) {
  const ch = DEFAULT_CHANNELS[t]!;
  const withRoot = new Set(a.tracks[t]!.notes.map((n) => n.pitch));
  const stored = new Set([...withRoot].map((x) => x - root));
  const sent = msgs.filter((m) => m.bytes[0] === (0x90 | ch) && (m.bytes[2] ?? 0) > 0).map((m) => m.bytes[1]!);
  if (!sent.length && !withRoot.size) continue;
  const hit = (s: Set<number>): number => sent.filter((x) => s.has(x)).length;
  console.log(`${N.NOTE_TRACKS[t]} (channel ${ch + 1}): ${sent.length} note-ons sent; match stored + root: ${hit(withRoot)}, match stored as is: ${hit(stored)}`);
  console.log(`  sent pitches ${[...new Set(sent)].sort((x, y) => x - y).join(" ")} | stored ${[...stored].sort((x, y) => x - y).join(" ")}`);
}
