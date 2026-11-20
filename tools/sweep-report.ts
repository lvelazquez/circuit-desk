// Summarises a firmware sweep (tools/firmware/sweep.py): for each parameter, which DSP words it moves
// and how: linear (one constant step), monotonic, stepped (few distinct values), or other.
// Usage: node tools/sweep-report.ts <sweep.json> [report.md]
// Input and output live under ~/Circuit Desk/Firmware-derived/ and are not committed.
import { readFileSync, writeFileSync } from "node:fs";

interface Row { id: string; cc: number | null; nrpn: [number, number] | null; values: number[]; words: Record<string, (number | null)[]> }

const file = process.argv[2];
if (!file) throw new Error("usage: sweep-report.ts <sweep.json> [report.md]");
const rows = JSON.parse(readFileSync(file, "utf8")) as Row[];

const signed = (v: number): number => (v >= 0x800000 ? v - 0x1000000 : v);

/** The ARM only rewrites a word when the group changes; a missing value means "same as the last one written". */
function fill(vals: (number | null)[]): number[] {
  const out: number[] = [];
  let last: number | null = vals.find((v) => v !== null) ?? null;
  for (const v of vals) { if (v !== null) last = v; if (last !== null) out.push(last); }
  return out;
}

function classify(vals: (number | null)[]): string {
  const x = fill(vals).map(signed);
  if (x.length < 2) return "constant";
  const steps = x.slice(1).map((v, i) => v - (x[i] as number));
  const distinct = new Set(x).size;
  const nonzero = steps.filter((s) => s !== 0);
  const asc = steps.every((s) => s >= 0), desc = steps.every((s) => s <= 0);
  const stepSet = new Set(nonzero);
  const first = nonzero[0];
  const lastIdx = steps.reduce((n, s, i) => (s !== 0 ? i : n), -1);
  const clampAt = lastIdx >= 0 && lastIdx < steps.length - 1 ? ` flat from index ${lastIdx + 1}` : "";
  if (distinct <= 4) return `stepped (${distinct} values)`;
  if (first !== undefined && stepSet.size === 1) return `linear, step ${first}${clampAt}`;
  if (first !== undefined && (asc || desc)) {
    const ratios = nonzero.slice(1).map((s, i) => s / (nonzero[i] as number));
    const mean = ratios.reduce((a, b) => a + b, 0) / (ratios.length || 1);
    const geometric = ratios.length > 3 && ratios.every((r) => Math.abs(r - mean) < 0.05 * Math.abs(mean));
    return `${asc ? "rising" : "falling"} ${geometric ? `geometric (ratio ${mean.toFixed(4)})` : "monotonic"}${clampAt}`;
  }
  return "non-monotonic";
}

const out: string[] = ["# Firmware sweep report", "", `Source: \`${file}\`. ${rows.length} parameters.`, ""];
const none = rows.filter((r) => Object.keys(r.words).length === 0).map((r) => r.id);
out.push(`**No DSP word moves for ${none.length} parameters** (handled on the ARM, or not reached by this method): ${none.join(", ") || "none"}.`, "");
out.push("| Parameter | Controller | Words that move | Pattern of the first word |", "|---|---|---|---|");
for (const r of rows) {
  const keys = Object.keys(r.words);
  if (!keys.length) continue;
  const ctrl = r.cc !== null ? `CC ${r.cc}` : `NRPN ${r.nrpn?.[0]}:${r.nrpn?.[1]}`;
  const k0 = keys[0] as string;
  const hex = (v: number | null | undefined): string => (v == null ? "–" : "0x" + (v >>> 0).toString(16));
  const w = r.words[k0] as (number | null)[];
  out.push(`| ${r.id} | ${ctrl} | ${keys.length}: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} | ${k0}: ${classify(w)} (${hex(w[0])} → ${hex(w[w.length - 1])}) |`);
}
const text = out.join("\n") + "\n";
if (process.argv[3]) writeFileSync(process.argv[3], text);
console.log(text.split("\n").slice(0, 6).join("\n"));
