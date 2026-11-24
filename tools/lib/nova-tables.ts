// For tools that run the Nova voice in Node: load Components' wavetables and LFO shapes the way the
// app does (the newest ~/Circuit Desk/Components-derived/<date>/circuit-tables.json), or say that
// the stand-ins play. `--no-tables` keeps the stand-ins, to compare.
import { defaultPaths, loadComponentsTables } from "@circuit-desk/core-service";
import { setNovaTables } from "@circuit-desk/engine";

/** Loads the tables (unless --no-tables) and returns a line saying what plays. */
export function useComponentsTables(argv: readonly string[] = process.argv): string {
  const t = argv.includes("--no-tables") ? null : loadComponentsTables(defaultPaths().components);
  setNovaTables(t ? { wavetables: Uint8Array.from(t.wavetables), lfo: Uint8Array.from(t.lfo) } : null);
  return t ? `Nova tables: ${t.file}` : "Nova tables: none, stand-in wavetables and LFO shapes";
}
