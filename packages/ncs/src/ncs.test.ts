import { describe, expect, it } from "vitest";
import * as L from "./layout.ts";
import { buildDrumPattern, buildNotePattern, parseDrumPattern, parseNotePattern } from "./pattern.ts";
import { NcsError, drumPatternBytes, notePatternBytes, openProject, projectProblem, readChains, readHeader, readNotePattern, readScenes, readTrailer, rebuildUnchanged, toBytes } from "./project.ts";
import { DRUM_PATTERN_FIELDS, NOTE_PATTERN_FIELDS, SESSION_FIELDS, tilingProblem } from "./registry.ts";
import { blankProject, noisyProject, prng, withModTrailer } from "./testing.ts";

describe("field registry", () => {
  it("accounts for every byte of the file, once", () => {
    expect(tilingProblem(SESSION_FIELDS, L.SESS_SIZE)).toBeNull();
  });
  it("accounts for every byte of a note pattern and of a drum pattern", () => {
    expect(tilingProblem(NOTE_PATTERN_FIELDS, L.PAT)).toBeNull();
    expect(tilingProblem(DRUM_PATTERN_FIELDS, L.DPAT)).toBeNull();
  });
  it("reports a gap", () => {
    expect(tilingProblem(SESSION_FIELDS.slice(1), L.SESS_SIZE)).toMatch(/expected 0/);
  });
  it("places the pattern blocks where the layout says", () => {
    expect(L.notePatternOffset(1, 7) + L.PAT).toBe(L.SYNTH_GAP);
    expect(L.drumPatternOffset(3, 7) + L.DPAT).toBe(L.DRUM_GAP);
    expect(L.notePatternOffset(3, 7) + L.PAT).toBe(L.LOOSE);
    expect(L.TAIL + L.TAIL_N).toBe(L.SESS_SIZE);
  });
});

describe("opening a project", () => {
  it("rejects a short file, a wrong magic and a wrong size word, each with a clear message", () => {
    expect(projectProblem(new Uint8Array(100))).toBe("too-short");
    const magic = blankProject(); magic[0] = 0x58;
    expect(projectProblem(magic)).toBe("bad-magic");
    const size = blankProject(); size[L.HEADER_SIZE_AT] = 0;
    expect(projectProblem(size)).toBe("bad-size-word");
    expect(() => openProject(new Uint8Array(100))).toThrow(NcsError);
    expect(() => openProject(new Uint8Array(100))).toThrow(/100 bytes/);
  });
  it("copies its input, and gives the same bytes back", () => {
    const src = noisyProject(1);
    const p = openProject(src);
    src[L.TEMPO_AT] = 1;
    expect(toBytes(p)[L.TEMPO_AT]).not.toBe(1);
    expect(toBytes(p)).toEqual(noisyProject(1));
  });
  it("reads the header", () => {
    const b = blankProject("My Song");
    b[L.COLOUR_AT] = 11; b[L.TEMPO_AT] = 174; b[L.SWING_AT] = 57;
    expect(readHeader(openProject(b))).toEqual({ name: "My Song", colour: 11, tempo: 174, swing: 57 });
  });
  it("reads scenes and chains", () => {
    const b = blankProject();
    const s3 = L.SCENE0 + 3 * L.SCENE_SIZE;
    b[s3 + 4 * 2] = 1; b[s3 + 4 * 2 + 1] = 5; b[s3 + L.SCENE_SAVED] = 1;
    b[L.CHAIN0] = 0; b[L.CHAIN0 + 1] = 12;
    b[L.CHAIN0 + 4 * 8] = 2; b[L.CHAIN0 + 4 * 8 + 1] = 3;
    const p = openProject(b);
    const scenes = readScenes(p);
    expect(scenes).toHaveLength(16);
    expect(scenes[3]?.saved).toBe(true);
    expect(scenes[3]?.chains[2]).toEqual({ first: 1, last: 5 });
    expect(scenes[0]?.saved).toBe(false);
    const chains = readChains(p);
    expect(chains.scenes).toEqual({ first: 0, last: 12 });
    expect(chains.tracks).toHaveLength(8);
    expect(chains.tracks[7]).toEqual({ first: 2, last: 3 });
  });
  it("refuses a track or pattern number that does not exist", () => {
    const p = openProject(blankProject());
    expect(() => notePatternBytes(p, 4, 0)).toThrow(/track must be 0–3/);
    expect(() => drumPatternBytes(p, 0, 8)).toThrow(/pattern must be 0–7/);
  });
});

describe("note patterns", () => {
  it("reads a note with its length, start and velocity", () => {
    const b = blankProject();
    const o = L.notePatternOffset(2, 1) + 5 * L.STEP;
    b[o] = 0b10; b[o + 1] = 4;
    b.set([64, 0x80 | 18, 3, 101], o + 4 + 4);
    const step = readNotePattern(openProject(b), 2, 1).steps[5];
    expect(step?.probability).toBe(4);
    expect(step?.units[0]?.on).toBe(false);
    expect(step?.units[1]).toEqual({ on: true, note: 64, gate: 18, tie: true, micro: 3, velocity: 101 });
  });
  it("builds back to the same bytes from pure noise", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const next = prng(seed);
      const raw = Uint8Array.from({ length: L.PAT }, () => next());
      expect(buildNotePattern(parseNotePattern(raw), raw)).toEqual(raw);
    }
  });
  it("carries every field of an active note in the model, not in the base", () => {
    // Build over a base whose described fields were wiped: the result must still be the original.
    const next = prng(7);
    const raw = Uint8Array.from({ length: L.PAT }, () => next());
    const model = parseNotePattern(raw);
    const wiped = raw.slice();
    for (let s = 0; s < L.NSTEPS; s++) {
      const o = s * L.STEP;
      const mask = raw[o] ?? 0;
      wiped[o + 1] = 0; wiped[o + 2] = 0; wiped[o + 3] = 0;
      for (let u = 0; u < L.UNITS; u++) if ((mask >> u) & 1) wiped.fill(0xaa, o + 4 + 4 * u, o + 8 + 4 * u);
    }
    wiped.fill(0, L.SETT, L.SETT + 4);
    wiped.fill(0, L.LANE0, L.PAT);
    expect(buildNotePattern(model, wiped)).toEqual(raw);
  });
  it("leaves the settings bytes it does not describe alone", () => {
    const raw = notePatternBytes(openProject(noisyProject(3)), 0, 0);
    const model = parseNotePattern(raw);
    model.settings.lastStep = 9;
    const out = buildNotePattern(model, raw);
    const changed: number[] = [];
    out.forEach((v, i) => { if (v !== raw[i]) changed.push(i); });
    expect(changed).toEqual([L.SETT]);
  });
  it("resets a note that is switched off to the device's empty value", () => {
    const b = blankProject();
    const o = L.notePatternOffset(0, 0);
    b[o] = 1; b.set([60, 6, 0, 100], o + 4);
    const raw = notePatternBytes(openProject(b), 0, 0);
    const model = parseNotePattern(raw);
    const unit = model.steps[0]?.units[0];
    if (!unit) throw new Error("no unit");
    unit.on = false;
    const out = buildNotePattern(model, raw);
    expect([...out.slice(0, 8)]).toEqual([0, 7, 0, 0, 0, 0, 0, 0x60]);
  });
  it("refuses a pattern of the wrong size", () => {
    expect(() => parseNotePattern(new Uint8Array(L.DPAT))).toThrow(/3240 bytes/);
  });
});

describe("drum patterns", () => {
  it("builds back to the same bytes from pure noise", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const next = prng(seed);
      const raw = Uint8Array.from({ length: L.DPAT }, () => next());
      expect(buildDrumPattern(parseDrumPattern(raw), raw)).toEqual(raw);
    }
  });
  it("carries steps, settings and lanes in the model", () => {
    const next = prng(9);
    const raw = Uint8Array.from({ length: L.DPAT }, () => next());
    const wiped = raw.slice();
    wiped.fill(0, 0, 128); wiped.fill(0, L.DSETT, L.DSETT + 4); wiped.fill(0, L.DLANE0, L.DPAT);
    expect(buildDrumPattern(parseDrumPattern(raw), wiped)).toEqual(raw);
  });
});

describe("whole-file round trip", () => {
  it("rebuilds a blank and a noisy project byte for byte", () => {
    for (const b of [blankProject(), noisyProject(11), noisyProject(12)]) {
      expect(rebuildUnchanged(openProject(b))).toEqual(b);
    }
  });
});

describe("CIRCUIT-HACKS data after the stock file", () => {
  it("reports none for a stock file", () => {
    expect(readTrailer(openProject(blankProject()))).toEqual({ length: 0, extraLanes: null, sceneRules: false });
  });
  it("finds both sections, checks the lane checksum, and keeps every byte", () => {
    const b = withModTrailer(noisyProject(5), 6);
    const p = openProject(b);
    const t = readTrailer(p);
    expect(t.length).toBe(16 + 16 * 1626 + 16 + 564);
    expect(t.extraLanes?.sumMatches).toBe(true);
    expect(t.sceneRules).toBe(true);
    expect(toBytes(p)).toEqual(b);
    expect(rebuildUnchanged(p)).toEqual(b);
  });
  it("notices a lane checksum that no longer matches the patterns", () => {
    const b = withModTrailer(noisyProject(5), 6);
    b[L.MIDI0] = (b[L.MIDI0] ?? 0) ^ 1;
    expect(readTrailer(openProject(b)).extraLanes?.sumMatches).toBe(false);
  });
});
