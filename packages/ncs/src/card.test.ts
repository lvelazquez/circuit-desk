// P1 acceptance: every real project in the card copy survives parse → build unchanged.
// The copy is outside the repo. Set CIRCUIT_DESK_CARD to use another one; without a copy the
// sweep is skipped and says so.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import * as L from "./layout.ts";
import { openProject, readChains, readHeader, readScenes, readTrailer, rebuildUnchanged, toBytes } from "./project.ts";

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

describe.skipIf(!existsSync(TRACKS))(`card copy at ${CARD}`, () => {
  const files = existsSync(TRACKS) ? projects(TRACKS) : [];

  it("has projects to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("round-trips every project byte for byte", () => {
    const failed: string[] = [];
    for (const f of files) {
      const raw = new Uint8Array(readFileSync(f));
      const p = openProject(raw);
      const same = (a: Uint8Array): boolean => a.length === raw.length && a.every((v, i) => v === raw[i]);
      if (!same(toBytes(p)) || !same(rebuildUnchanged(p))) failed.push(relative(CARD, f));
    }
    expect(failed).toEqual([]);
  });

  it("reads plausible headers, scenes and chains from every project", () => {
    const odd: string[] = [];
    for (const f of files) {
      const p = openProject(new Uint8Array(readFileSync(f)));
      const h = readHeader(p);
      const chains = readChains(p);
      const scenes = readScenes(p);
      const chainOk = [chains.scenes, ...chains.tracks].every((c) => c.first <= c.last);
      const sceneOk = chains.scenes.last < L.NSCENES && chains.tracks.every((c) => c.last < L.PATTERNS_PER_TRACK);
      const sceneChainsOk = scenes.every((s) => s.chains.every((c) => c.first <= c.last && c.last < L.PATTERNS_PER_TRACK));
      const headerOk = h.tempo >= 40 && h.tempo <= 240 && h.swing >= 20 && h.swing <= 80 && h.colour <= 13 && /^[\x20-\x7e]*$/.test(h.name);
      if (!chainOk || !sceneOk || !sceneChainsOk || !headerOk) odd.push(`${relative(CARD, f)} ${JSON.stringify(h)}`);
    }
    expect(odd).toEqual([]);
  });

  it("finds no CIRCUIT-HACKS data (this card was saved by stock firmware)", () => {
    const withTrailer = files.filter((f) => readTrailer(openProject(new Uint8Array(readFileSync(f)))).length > 0);
    expect(withTrailer).toEqual([]);
  });
});
