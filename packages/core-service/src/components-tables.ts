// Finds the wavetables and LFO shapes tools/components-tables.ts saved from Novation Components
// (<components>/<yyyy-mm-dd>/circuit-tables.json, outside the repo) for the Nova voice. Returns the
// raw bytes as number arrays, for the window over IPC; the engine checks the sizes (tables.ts).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ComponentsTables {
  /** Where they were read from. */
  file: string;
  /** 16 waves × 9 frames × 128 bytes, waves 14–29 in order. */
  wavetables: number[];
  /** 38 waves × 250 bytes. */
  lfo: number[];
}

/** The newest dated folder's tables in `dir`, or null if there are none. */
export function loadComponentsTables(dir: string | undefined): ComponentsTables | null {
  if (!dir || !existsSync(dir)) return null;
  const dated = readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  for (const d of dated) {
    const file = join(dir, d, "circuit-tables.json");
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, "utf8")) as {
      wavetables?: Record<string, { frames?: number[][] }>;
      lfo?: { samples?: number[] }[];
    };
    const wavetables: number[] = [];
    for (let w = 14; w <= 29; w++) for (const f of doc.wavetables?.[String(w)]?.frames ?? []) wavetables.push(...f);
    const lfo = (doc.lfo ?? []).flatMap((l) => l.samples ?? []);
    return { file, wavetables, lfo };
  }
  return null;
}
