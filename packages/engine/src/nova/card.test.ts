// The Nova voice over every real patch in the card copy (outside the repo; skipped without it):
// a C4 note on each project and pack patch must render finite, below full scale, and audible.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PATCH_SIZE, parsePatch, readBank } from "@circuit-desk/patch";
import { NovaSynth } from "./synth.ts";
import { VOICE_GAIN } from "./voice.ts";

const CARD = process.env["CIRCUIT_DESK_CARD"] ?? join(homedir(), "Circuit Desk", "Card copy", "2026-11-19");
const TRACKS = join(CARD, "Tracks");
const PATCH0 = 0x26d14;
const SR = 48_000;

function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

function patches(): { where: string; bytes: Uint8Array }[] {
  const out: { where: string; bytes: Uint8Array }[] = [];
  for (const f of files(TRACKS, /\.ncs$/i)) {
    const b = readFileSync(f);
    for (const s of [0, 1]) out.push({ where: `${f}#${s + 1}`, bytes: new Uint8Array(b.subarray(PATCH0 + s * PATCH_SIZE, PATCH0 + (s + 1) * PATCH_SIZE)) });
  }
  for (const f of files(TRACKS, /\.cpb$/i)) for (const r of readBank(new Uint8Array(readFileSync(f)))) out.push({ where: `${f}#${r.index}`, bytes: r.patch });
  return out;
}

describe.skipIf(!existsSync(TRACKS))("Nova voice over the card's patches", () => {
  // Baseline 2026-11-19 (tools/nova-levels.ts), at VOICE_GAIN 0.6: 37 of 1 050 below 0.001 on one
  // C4, loudest 4.9 (8 × the voice gain). The quiet ones take their level from LFOs (E2) or macros
  // (E0.4); the bound, 10 × the voice gain, catches runaway gain such as an unstable filter.
  it("every patch renders finite and bounded, and silent patches stay rare", () => {
    const all = patches();
    const silent: string[] = [];
    for (const p of all) {
      const s = new NovaSynth(SR, parsePatch(p.bytes).values);
      s.schedule({ frame: 0, type: "on", note: 60, velocity: 100 });
      s.schedule({ frame: 0.4 * SR, type: "off", note: 60 });
      const out = new Float32Array(0.6 * SR);
      s.process(out);
      let peak = 0;
      for (const v of out) { expect(Number.isFinite(v), p.where).toBe(true); peak = Math.max(peak, Math.abs(v)); }
      expect(peak, p.where).toBeLessThan(10 * VOICE_GAIN);
      if (peak < 1e-3) silent.push(p.where);
    }
    expect(silent.length / all.length).toBeLessThan(0.06);
  }, 120_000);
});
