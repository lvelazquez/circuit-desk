// Read-only: prints a synth patch's non-default parameters in display units.
// Usage: node tools/patch-show.ts <project.ncs> [1|2]   or   node tools/patch-show.ts <bank.cpb> <record 0–7>
import { readFileSync } from "node:fs";
import { PATCH_PARAMS, PATCH_SIZE, displayValue, parsePatch, readBank } from "@circuit-desk/patch";

const [file, which = "1"] = process.argv.slice(2);
if (!file) throw new Error("usage: patch-show.ts <project.ncs> [1|2] | <bank.cpb> <record>");
const bytes = new Uint8Array(readFileSync(file));
const raw = /\.cpb$/i.test(file)
  ? readBank(bytes)[Number(which)]?.patch
  : bytes.subarray(0x26d14 + (Number(which) - 1) * PATCH_SIZE, 0x26d14 + Number(which) * PATCH_SIZE);
if (!raw) throw new Error(`no patch ${which} in ${file}`);
const p = parsePatch(raw);
console.log(p.name);
for (const q of PATCH_PARAMS) {
  const v = p.values[q.id]!;
  if (v !== q.default && !q.reserved) console.log(`  ${q.section.padEnd(10)} ${q.id.padEnd(26)} ${String(v).padStart(3)}  ${displayValue(q, v)}`);
}
