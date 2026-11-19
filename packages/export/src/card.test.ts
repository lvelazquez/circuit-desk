// P2 sweep over the real card copy (outside the repo; skipped without it): every project exports
// a MIDI file that reads back with the arrangement's notes and no hanging or overlapping notes.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import * as N from "@circuit-desk/ncs";
import { arrange } from "./arrange.ts";
import { readSmf } from "./smf-read.ts";
import { writeSmf } from "./smf.ts";

const CARD = process.env["CIRCUIT_DESK_CARD"] ?? join(homedir(), "Circuit Desk", "Card copy", "2026-11-19");
const TRACKS = join(CARD, "Tracks");
function projects(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) projects(p, out);
    else if (/\.ncs$/i.test(name)) out.push(p);
  }
  return out;
}

describe.skipIf(!existsSync(TRACKS))(`MIDI export of the card copy at ${CARD}`, () => {
  it("writes a clean file for every project, both from scenes and from the current chains", () => {
    const failed: string[] = [];
    let notes = 0;
    for (const f of existsSync(TRACKS) ? projects(TRACKS) : []) {
      const p = N.openProject(new Uint8Array(readFileSync(f)));
      const sources = N.readScenes(p).some((s) => s.saved) ? (["scenes", "current"] as const) : (["current"] as const);
      for (const source of sources) {
        const a = arrange(p, { source });
        const r = readSmf(writeSmf(a, { skipEmpty: false }));
        const expected = a.tracks.reduce((n, t) => n + t.notes.length, 0);
        notes += expected;
        if (r.problems.length || r.notes.length !== expected || a.length <= 0) failed.push(`${relative(CARD, f)} (${source}): ${r.problems[0] ?? `${r.notes.length} of ${expected} notes`}`);
      }
    }
    expect(failed).toEqual([]);
    expect(notes).toBeGreaterThan(0);
  });
});
