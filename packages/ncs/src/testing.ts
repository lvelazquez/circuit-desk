// Synthetic projects for tests. No real project data is used or stored in the repo.
import * as L from "./layout.ts";

/** A small deterministic generator, so fixtures are the same on every run. */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  };
}

/** An empty project as the device would save it, as far as the parts we read go. */
export function blankProject(name = "Blank"): Uint8Array {
  const b = new Uint8Array(L.SESS_SIZE);
  const v = new DataView(b.buffer);
  for (let i = 0; i < 4; i++) b[i] = L.MAGIC.charCodeAt(i);
  v.setUint32(L.HEADER_SIZE_AT, L.SESS_SIZE, true);
  for (let i = 0; i < Math.min(name.length, L.NAME_LEN); i++) b[L.NAME_AT + i] = name.charCodeAt(i);
  b[L.TEMPO_AT] = 120; b[L.SWING_AT] = 50; b[L.SWING_SYNC_AT] = 3;
  for (let track = 0; track < 4; track++) {
    for (let index = 0; index < L.PATTERNS_PER_TRACK; index++) {
      const o = L.notePatternOffset(track, index);
      for (let s = 0; s < L.NSTEPS; s++) {
        b[o + s * L.STEP + 1] = 7;
        for (let u = 0; u < L.UNITS; u++) b[o + s * L.STEP + 4 + 4 * u + 3] = 0x60;
      }
      b[o + L.SETT] = 0x0f; b[o + L.SETT + 2] = 3;
      b.fill(0xff, o + L.LANE0, o + L.PAT);
      const d = L.drumPatternOffset(track, index);
      b.fill(7, d + 32, d + 64); b.fill(0xff, d + 64, d + 96);
      b[d + L.DSETT] = 0x0f; b[d + L.DSETT + 2] = 3;
      b.fill(0xff, d + L.DLANE0, d + L.DPAT);
    }
  }
  return b;
}

/** A project where every byte after the header is pseudo-random: the worst case for losing data. */
export function noisyProject(seed: number): Uint8Array {
  const b = blankProject("Noise");
  const next = prng(seed);
  for (let i = L.TEMPO_AT; i < L.SESS_SIZE; i++) b[i] = next();
  return b;
}

/** Appends the two CIRCUIT-HACKS sections (extra lanes, scene rules) with a correct lane checksum. */
export function withModTrailer(stock: Uint8Array, seed: number): Uint8Array {
  const sceneRulesSize = 16 + 564;
  const b = new Uint8Array(L.SCN3_AT + sceneRulesSize);
  b.set(stock);
  const next = prng(seed);
  for (let i = L.SESS_SIZE; i < b.length; i++) b[i] = next();
  const v = new DataView(b.buffer);
  "XLN1".split("").forEach((c, i) => { b[L.SESS_SIZE + i] = c.charCodeAt(0); });
  "SCN3".split("").forEach((c, i) => { b[L.SCN3_AT + i] = c.charCodeAt(0); });
  let sum = 0;
  for (let i = L.MIDI0; i < L.MIDI0 + 16 * L.PAT; i += 4) sum = (sum + v.getUint32(i, true)) >>> 0;
  v.setUint32(L.SESS_SIZE + L.XLN1_SUM_AT, sum, true);
  return b;
}
