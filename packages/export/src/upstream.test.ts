// P2 acceptance: our notes for each pattern equal those of the upstream editor's patMidi
// (circuit-hacks-rc/tools/sd_app.html:883), run here from its own source. Skipped without the
// upstream clone or the card copy.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as N from "@circuit-desk/ncs";
import { DEFAULT_DRUM_NOTES, drumPatternNotes, notePatternNotes, patternLength, type MidiNote } from "./arrange.ts";

const HTML = process.env["CIRCUIT_HACKS_SD_APP"] ?? join(homedir(), "Personal Repo", "circuit-hacks-rc", "tools", "sd_app.html");
const CARD = process.env["CIRCUIT_DESK_CARD"] ?? join(homedir(), "Circuit Desk", "Card copy", "2026-11-19");
const TRACKS = join(CARD, "Tracks");

type PatMidi = (b: Uint8Array, n: number, ch: number) => Uint8Array;

function loadPatMidi(): PatMidi {
  const src = readFileSync(HTML, "utf8");
  const start = src.indexOf("function patCells(");
  const end = src.indexOf("const Patterns = {");
  if (start < 0 || end < start) throw new Error("patCells/patMidi not found in sd_app.html");
  const consts = ["NSTEPS = 32", "STEP = 28", "UNITS = 6", "SETT = 0x380", "DSETT = 0x80", "DRUM_NOTE = [60, 62, 64, 65]"];
  for (const c of consts) if (!src.includes(c)) throw new Error(`sd_app.html no longer has ${c}`);
  const body = `const ${consts.join(", ")}; const TRACK_NAME = ["Synth 1","Synth 2","MIDI 1","MIDI 2","Drum 1","Drum 2","Drum 3","Drum 4"];\n${src.slice(start, end)}\nreturn patMidi;`;
  return new Function(body)() as PatMidi;
}

/**
 * Note-ons as "tick key vel" and note-offs as "tick key", sorted: overlaps cannot hide a difference.
 * patMidi writes a stored note above 127 as a raw data byte (an invalid file); we leave such notes
 * out, so they are skipped here too.
 */
function events(smf: Uint8Array): { on: string[]; off: string[] } {
  const on: string[] = [], off: string[] = [];
  let p = 22, tick = 0; // one track: header 14 + chunk header 8
  while (p < smf.length) {
    let d = 0, c: number;
    do { c = smf[p++] ?? 0; d = (d << 7) | (c & 127); } while (c & 128);
    tick += d;
    const s = smf[p++] ?? 0;
    if (s === 0xff) { const len = smf[p + 1] ?? 0; p += 2 + len; continue; }
    const key = smf[p++] ?? 0, vel = smf[p++] ?? 0;
    if (key > 127) continue;
    if ((s & 0xf0) === 0x90 && vel > 0) on.push(`${tick} ${key} ${vel}`);
    else off.push(`${tick} ${key}`);
  }
  return { on: on.sort(), off: off.sort() };
}

function ours(notes: MidiNote[], end: number): { on: string[]; off: string[] } {
  return {
    on: notes.map((n) => `${n.tick} ${n.pitch} ${n.velocity}`).sort(),
    off: notes.map((n) => `${Math.min(end, n.tick + n.dur)} ${n.pitch}`).sort(),
  };
}

function projects(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) projects(p, out);
    else if (/\.ncs$/i.test(name)) out.push(p);
  }
  return out;
}

describe.skipIf(!existsSync(HTML) || !existsSync(TRACKS))("notes match upstream patMidi", () => {
  it("for every pattern of every project in the card copy", () => {
    const patMidi = loadPatMidi();
    let checked = 0;
    const failed: string[] = [];
    for (const f of projects(TRACKS)) {
      const p = N.openProject(new Uint8Array(readFileSync(f)));
      for (let n = 0; n < 64; n++) {
        const t = n >> 3, i = n & 7;
        const drum = t >= 4;
        const bytes = drum ? N.drumPatternBytes(p, t - 4, i) : N.notePatternBytes(p, t, i);
        const model = drum ? N.parseDrumPattern(bytes) : N.parseNotePattern(bytes);
        const notes = drum ? drumPatternNotes(model as N.DrumPattern, DEFAULT_DRUM_NOTES[t - 4] ?? 60) : notePatternNotes(model as N.NotePattern);
        const theirs = events(patMidi(bytes, n, drum ? 9 : t));
        const mine = ours(notes, patternLength(model.settings));
        if (mine.on.length) checked++;
        if (JSON.stringify(mine) !== JSON.stringify(theirs)) failed.push(`${f.slice(TRACKS.length + 1)} slot ${n}`);
      }
    }
    expect(failed.slice(0, 10)).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });
});
