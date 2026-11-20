import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import * as L from "./layout.ts";
import { openProject } from "./project.ts";
import { PROJECT_PARAM_OFFSETS, readSound } from "./sound.ts";
import { blankProject } from "./testing.ts";

describe("project sound settings", () => {
  it("has 54 parameters, skipping the reserved offsets 11–15 and 30", () => {
    expect(PROJECT_PARAM_OFFSETS).toHaveLength(54);
    for (const r of [11, 12, 13, 14, 15, 30]) expect(PROJECT_PARAM_OFFSETS).not.toContain(r);
    expect(new Set(PROJECT_PARAM_OFFSETS).size).toBe(54);
    expect(Math.max(...PROJECT_PARAM_OFFSETS)).toBe(L.PROJECT_PARAMS_N - 1);
  });

  it("reads every group from where the descriptors put it", () => {
    const b = blankProject();
    const P = L.PROJECT_PARAMS;
    b[P + 2] = 90;                       // reverb send, Drum 1
    b[P + 8] = 4; b[P + 9] = 70; b[P + 10] = 30;
    b[P + 17] = 55;                      // delay send, Synth 2
    b[P + 24] = 64; b[P + 25] = 20; b[P + 26] = 80; b[P + 27] = 127; b[P + 28] = 4; b[P + 29] = 5;
    b[P + 31] = 1;                       // FX bypass
    b.set([1, 5, 90, 75, 123], P + 37);  // Synth 2 sidechain: Drum 2, preset 4
    b[P + 52] = 100; b[P + 59] = 0;      // Synth 1 level, MIDI 2 pan hard left
    b.set([12, 90, 70, 40, 20, 100, 30], L.DRUM_BLOCK + 2 * L.DRUM_RECORD);
    const s = readSound(openProject(b));
    expect(s.reverb).toEqual({ type: 4, decay: 70, damping: 30, sends: [0, 0, 90, 0, 0, 0, 0, 0] });
    expect(s.delay).toEqual({ time: 64, sync: 20, feedback: 80, width: 127, ratio: 4, slew: 5, sends: [0, 55, 0, 0, 0, 0, 0, 0] });
    expect(s.fxBypass).toBe(true);
    expect(s.sidechains[1]).toEqual({ source: 1, attack: 5, hold: 90, decay: 75, depth: 123 });
    expect(s.levels[0]).toBe(100);
    expect(s.pans[3]).toBe(0);
    expect(s.drums[2]).toEqual({ sample: 12, level: 90, pitch: 70, decay: 40, distortion: 20, eq: 100, pan: 30 });
  });
});

const CARD = process.env["CIRCUIT_DESK_CARD"] ?? join(homedir(), "Circuit Desk", "Card copy", "2026-11-19");
const TRACKS = join(CARD, "Tracks");
const files = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir).sort()) {
    if (n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out); else if (/\.ncs$/i.test(n)) out.push(p);
  }
  return out;
};

/** The device's sidechain presets: attack, hold, decay, depth (circuit-hacks-rc NOTAS, sidechain study). */
const PRESETS = [[0, 50, 70, 0], [5, 50, 80, 80], [5, 70, 70, 100], [5, 85, 70, 115], [5, 90, 75, 123], [5, 90, 85, 127], [5, 95, 95, 127], [5, 102, 95, 127]];

describe.skipIf(!existsSync(TRACKS))("sound settings over the card copy", () => {
  it("are in range in every project, and every sidechain is a device preset", () => {
    const odd: string[] = [];
    for (const f of files(TRACKS)) {
      const s = readSound(openProject(new Uint8Array(readFileSync(f))));
      const where = relative(CARD, f);
      if (s.reverb.type > 5 || s.delay.sync > 35 || s.delay.ratio > 12) odd.push(`${where}: reverb/delay out of range`);
      for (const sc of s.sidechains) {
        if (sc.source > 4) odd.push(`${where}: sidechain source ${sc.source}`);
        if (!PRESETS.some((p) => p[0] === sc.attack && p[1] === sc.hold && p[2] === sc.decay && p[3] === sc.depth)) odd.push(`${where}: sidechain ${JSON.stringify(sc)}`);
      }
      for (const d of s.drums) if (d.sample > 63 || d.level > 127) odd.push(`${where}: drum ${JSON.stringify(d)}`);
    }
    expect(odd).toEqual([]);
  });
});
