// E0 acceptance on the real card copy (outside the repo; skipped without it): every patch in every
// project and pack bank is inside the guide's ranges, and parse → build is byte-identical.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PATCH_SIZE } from "./format.ts";
import { buildPatch, parsePatch, patchProblems } from "./patch.ts";
import { readBank, writeBankPatch } from "./bank.ts";

const CARD = process.env["CIRCUIT_DESK_CARD"] ?? join(homedir(), "Circuit Desk", "Card copy", "2026-11-19");
const TRACKS = join(CARD, "Tracks");
/** Synth 1's patch inside a project (packages/ncs layout PATCH0); Synth 2 follows it. */
const PATCH0 = 0x26d14;

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

describe.skipIf(!existsSync(TRACKS))(`patches in the card copy at ${CARD}`, () => {
  const projects = existsSync(TRACKS) ? files(TRACKS, /\.ncs$/i) : [];
  const banks = existsSync(TRACKS) ? files(TRACKS, /\.cpb$/i) : [];

  it("finds projects and banks", () => {
    expect(projects.length).toBeGreaterThan(0);
    expect(banks.length).toBeGreaterThan(0);
  });

  it("project patches are in range and rebuild byte for byte", () => {
    for (const f of projects) {
      const b = readFileSync(f);
      for (const s of [0, 1]) {
        const raw = new Uint8Array(b.subarray(PATCH0 + s * PATCH_SIZE, PATCH0 + (s + 1) * PATCH_SIZE));
        const p = parsePatch(raw);
        expect(patchProblems(p), `${f} synth ${s + 1}`).toEqual([]);
        expect(buildPatch(p, raw)).toEqual(raw);
      }
    }
  });

  it("bank patches are in range, and rewriting a record with itself changes nothing", () => {
    for (const f of banks) {
      const file = new Uint8Array(readFileSync(f));
      for (const r of readBank(file)) {
        const p = parsePatch(r.patch);
        expect(patchProblems(p), `${f} #${r.index}`).toEqual([]);
        expect(writeBankPatch(file, r.index, buildPatch(p, r.patch))).toEqual(file);
      }
    }
  });
});
