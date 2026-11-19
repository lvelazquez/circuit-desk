// The set is built from the installed Live 12's templates; without Live these tests are skipped.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as N from "@circuit-desk/ncs";
import { blankProject } from "../../ncs/src/testing.ts";
import { arrange, type Arrangement } from "./arrange.ts";
import { buildAlsXml, DEFAULT_LIVE_APP, loadLiveTemplates, writeAls } from "./als.ts";
import { readAlsXml } from "./als-read.ts";

const LIVE = process.env["CIRCUIT_DESK_LIVE_APP"] ?? DEFAULT_LIVE_APP;
const CARD = process.env["CIRCUIT_DESK_CARD"] ?? join(homedir(), "Circuit Desk", "Card copy", "2026-11-19");
const TRACKS = join(CARD, "Tracks");

function putNote(b: Uint8Array, t: number, i: number, s: number, note: number, gate: number, vel: number): void {
  const o = N.notePatternOffset(t, i) + s * N.STEP;
  b[o] = (b[o] ?? 0) | 1;
  b[o + 4] = note; b[o + 5] = gate; b[o + 6] = 0; b[o + 7] = vel;
}

/** The arrangement's notes cut at the end of the pattern play they start in, in beats. */
function expectedArrangement(a: Arrangement, track: number): { pitch: number; start: number; dur: number; velocity: number }[] {
  const t = a.tracks[track]!;
  return t.plays.flatMap((pl) => t.notes.filter((n) => n.tick >= pl.tick && n.tick < pl.tick + pl.length)
    .map((n) => ({ pitch: n.pitch, start: n.tick / a.ppq, dur: Math.min(n.dur, pl.tick + pl.length - n.tick) / a.ppq, velocity: n.velocity })))
    .sort((x, y) => x.start - y.start || x.pitch - y.pitch);
}

describe.skipIf(!existsSync(LIVE))("Live set", () => {
  const tpl = existsSync(LIVE) ? loadLiveTemplates(LIVE) : { set: "", clip: "", instruments: {} };

  it("reads back with tempo, scenes, session clips and arrangement notes", () => {
    const b = blankProject("Live & <test>");
    b[N.TEMPO_AT] = 133;
    putNote(b, 0, 0, 0, 60, 6, 100);
    putNote(b, 0, 1, 4, 67, 12, 90);
    b[N.CHAIN0 + 4] = 0; b[N.CHAIN0 + 5] = 1; // Synth 1 chain: patterns 1–2
    b[N.drumPatternOffset(1, 0) + 2] = 80;
    const a = arrange(N.openProject(b));
    const r = readAlsXml(gunzipSync(writeAls(a, tpl)).toString("utf8"));
    expect(r.tempo).toBe(133);
    expect(r.tempoAutomation).toBe(133);
    expect(r.scenes).toEqual(["Current chains", ...Array.from({ length: 8 }, (_, k) => `Pattern ${k + 1}`)]);
    expect(r.tracks.map((t) => t.name)).toEqual(["Synth 1", "Drum 2"]);
    const s1 = r.tracks[0]!;
    expect(s1.session).toHaveLength(9);
    expect(s1.session[0]).toMatchObject({ name: "Synth 1 · Current chains", length: 8, loop: true });
    expect(s1.session[1]?.notes).toEqual([{ pitch: 60, start: 0, dur: 0.25, velocity: 100 }]);
    expect(s1.session[2]?.notes).toEqual([{ pitch: 67, start: 1, dur: 0.5, velocity: 90 }]);
    expect(s1.session[3]).toBeNull();
    expect(s1.arrangement.map((c) => [c.name, c.time])).toEqual([["Synth 1 · 1", 0], ["Synth 1 · 2", 4]]);
    expect(s1.arrangement.flatMap((c) => c.notes)).toEqual(expectedArrangement(a, 0));
    // Drum 2 plays the snare of Live's starter kit.
    expect(r.tracks[1]!.arrangement.flatMap((c) => c.notes)).toEqual([{ pitch: 38, start: 0.5, dur: 0.0625, velocity: 80 }, { pitch: 38, start: 4.5, dur: 0.0625, velocity: 80 }]);
  });

  it("loads Live's starter instruments, or none", () => {
    expect(Object.keys(tpl.instruments).sort()).toEqual(["bass", "drums", "keys", "lead"]);
    const b = blankProject();
    putNote(b, 1, 0, 0, 40, 6, 100);
    b[N.drumPatternOffset(0, 0)] = 100;
    const a = arrange(N.openProject(b));
    const live = buildAlsXml(a, tpl);
    expect(live).toContain("<DrumGroupDevice");
    expect(readAlsXml(live).tracks[1]!.session[1]!.notes[0]!.pitch).toBe(36);
    const none = buildAlsXml(a, tpl, { instruments: "none" });
    expect(none).not.toContain("<DrumGroupDevice");
    expect(readAlsXml(none).tracks[1]!.session[1]!.notes[0]!.pitch).toBe(60);
  });

  it("can leave the arrangement empty", () => {
    const b = blankProject();
    putNote(b, 1, 0, 0, 60, 6, 100);
    const r = readAlsXml(buildAlsXml(arrange(N.openProject(b)), tpl, { arrangement: false }));
    expect(r.tracks[0]!.arrangement).toEqual([]);
    expect(r.tracks[0]!.session.filter(Boolean)).toHaveLength(2);
  });

  it("writes a play-along set: each track hears its own channel, monitoring In", () => {
    const b = blankProject();
    putNote(b, 0, 0, 0, 60, 6, 100);
    b[N.drumPatternOffset(2, 0)] = 100;
    const x = buildAlsXml(arrange(N.openProject(b)), tpl, { listen: true });
    // Each track's own routing is its first; Live's instrument racks carry more inside.
    const first = (xml: string, re: RegExp): (string | undefined)[] => [...xml.matchAll(/<MidiTrack [\s\S]*?<\/MidiTrack>/g)].map((t) => re.exec(t[0])?.[1]);
    const routes = first(x, /<MidiInputRouting>\s*<Target Value="([^"]*)"/);
    expect(routes).toEqual(["MidiIn/External.All/0", "MidiIn/External.All/11"]); // Synth 1 ch 1, Drum 3 ch 12
    expect(first(x, /<MonitoringEnum Value="(\d)"/)).toEqual(["0", "0"]);
    const normal = buildAlsXml(arrange(N.openProject(b)), tpl);
    expect(first(normal, /<MidiInputRouting>\s*<Target Value="([^"]*)"/)).toEqual(["MidiIn/External.All/-1", "MidiIn/External.All/-1"]);
  });

  it("refuses a project with no notes", () => {
    expect(() => buildAlsXml(arrange(N.openProject(blankProject())), tpl)).toThrow(/no notes/);
  });

  describe.skipIf(!existsSync(TRACKS))("every project in the card copy", () => {
    it("builds a well-formed set whose arrangement holds the arranged notes", () => {
      const files: string[] = [];
      const walk = (d: string): void => { for (const n of readdirSync(d).sort()) { if (n.startsWith(".")) continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ncs$/i.test(n)) files.push(p); } };
      walk(TRACKS);
      const failed: string[] = [];
      let built = 0;
      for (const f of files) {
        const a = arrange(N.openProject(new Uint8Array(readFileSync(f))));
        if (!a.tracks.some((t) => t.notes.length)) continue;
        try {
          const r = readAlsXml(buildAlsXml(a, tpl, { instruments: "none" }));
          const used = a.tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.notes.length || t.patterns.some((p) => p.notes.length));
          used.forEach(({ i }, k) => {
            const got = r.tracks[k]!.arrangement.flatMap((c) => c.notes.map((n) => ({ ...n, start: Math.round(n.start * 1e6) / 1e6, dur: Math.round(n.dur * 1e6) / 1e6 })));
            const want = expectedArrangement(a, i).map((n) => ({ ...n, start: Math.round(n.start * 1e6) / 1e6, dur: Math.round(n.dur * 1e6) / 1e6 }));
            if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${a.tracks[i]!.name}: ${got.length} of ${want.length} notes`);
          });
          built++;
        } catch (e) { failed.push(`${relative(CARD, f)}: ${(e as Error).message}`); }
      }
      expect(failed).toEqual([]);
      expect(built).toBeGreaterThan(100);
    }, 120_000);
  });
});
