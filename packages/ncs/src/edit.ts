// Edits. Each returns a new project; the input is never changed. Written: note and drum steps,
// pattern first/last step, sync rate, direction, scenes and chains (registry `verified`), and
// automation lanes, whose storage is known (32 steps × 6 points, 0–127, 0xFF = none) though which
// parameter each lane drives is `partial`. Everything else is carried over byte for byte.
import * as L from "./layout.ts";
import { buildDrumPattern, buildNotePattern, parseDrumPattern, parseNotePattern, type DrumPattern, type NotePattern } from "./pattern.ts";
import { extraLanesSum, readTrailer, type Chain, type Project } from "./project.ts";
import { DRUM_PATTERN_FIELDS, NOTE_PATTERN_FIELDS, SESSION_FIELDS, type Field } from "./registry.ts";
import { NAME_LEN, PATCH_PARAMS } from "@circuit-desk/patch";

function int(what: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${what} must be a whole number ${min}–${max}, got ${v}`);
}

const sameUnit = (a: NotePattern["steps"][number]["units"][number], b: typeof a | undefined): boolean =>
  !!b && a.on === b.on && a.note === b.note && a.gate === b.gate && a.tie === b.tie && a.micro === b.micro && a.velocity === b.velocity;

/**
 * Throws on any value the device cannot store. With `base`, values equal to the base's are not
 * checked: what the device saved is kept as it is (one factory project stores a note 128).
 */
export function checkNotePattern(m: NotePattern, base?: NotePattern): void {
  if (m.steps.length !== L.NSTEPS) throw new RangeError(`a pattern has ${L.NSTEPS} steps, got ${m.steps.length}`);
  m.steps.forEach((st, s) => {
    const old = base?.steps[s];
    if (st.probability !== old?.probability) int(`step ${s + 1} probability`, st.probability, 0, 7);
    if (st.units.length !== L.UNITS) throw new RangeError(`step ${s + 1} has ${L.UNITS} note slots, got ${st.units.length}`);
    st.units.forEach((u, k) => {
      if (!u.on || sameUnit(u, old?.units[k])) return;
      const at = `step ${s + 1} note ${k + 1}`;
      int(`${at} note`, u.note, 0, 127);
      int(`${at} velocity`, u.velocity, 1, 127);
      int(`${at} gate`, u.gate, 1, 96);
      int(`${at} micro-step`, u.micro, 0, 5);
    });
  });
  checkSettings(m.settings, base?.settings);
}

export function checkDrumPattern(m: DrumPattern, base?: DrumPattern): void {
  if (m.steps.length !== L.NSTEPS) throw new RangeError(`a pattern has ${L.NSTEPS} steps, got ${m.steps.length}`);
  m.steps.forEach((st, s) => {
    const old = base?.steps[s];
    if (old && old.velocity === st.velocity && old.probability === st.probability && old.microSteps === st.microSteps) return;
    int(`step ${s + 1} velocity`, st.velocity, 0, 127);
    int(`step ${s + 1} probability`, st.probability & 7, 0, 7);
    int(`step ${s + 1} micro-steps`, st.microSteps, 0, 63);
  });
  checkSettings(m.settings, base?.settings);
}

function checkSettings(s: NotePattern["settings"], base?: NotePattern["settings"]): void {
  if (base && s.lastStep === base.lastStep && s.firstStep === base.firstStep && s.syncRate === base.syncRate && s.direction === base.direction) return;
  int("last step", s.lastStep, 0, 31);
  int("first step", s.firstStep, 0, 31);
  int("sync rate", s.syncRate, 0, 7);
  int("direction", s.direction, 0, 3);
}

function checkChain(what: string, c: Chain, max: number): void {
  int(`${what} first`, c.first, 0, max);
  int(`${what} last`, c.last, 0, max);
  if (c.first > c.last) throw new RangeError(`${what}: first (${c.first + 1}) is after last (${c.last + 1})`);
}

/**
 * CIRCUIT-HACKS keeps a sum of MIDI 1/2's patterns with its extra lanes, and drops the lanes when
 * it does not match. After an edit the sum is refreshed only if it matched before: a stale sum
 * means the device has already dropped those lanes, and refreshing would bring them back.
 */
function keepExtraLanes(before: Project, after: Uint8Array): void {
  const t = readTrailer(before).extraLanes;
  if (!t?.sumMatches) return;
  new DataView(after.buffer, after.byteOffset, after.byteLength).setUint32(L.SESS_SIZE + L.XLN1_SUM_AT, extraLanesSum(after), true);
}

export function writeNotePattern(p: Project, track: number, index: number, m: NotePattern): Project {
  int("track", track, 0, 3); int("pattern", index, 0, L.PATTERNS_PER_TRACK - 1);
  const o = L.notePatternOffset(track, index);
  checkNotePattern(m, parseNotePattern(p.bytes.slice(o, o + L.PAT)));
  const out = p.bytes.slice();
  out.set(buildNotePattern(m, out.slice(o, o + L.PAT)), o);
  if (track >= 2) keepExtraLanes(p, out);
  return { bytes: out };
}

export function writeDrumPattern(p: Project, drum: number, index: number, m: DrumPattern): Project {
  int("drum", drum, 0, 3); int("pattern", index, 0, L.PATTERNS_PER_TRACK - 1);
  const o = L.drumPatternOffset(drum, index);
  checkDrumPattern(m, parseDrumPattern(p.bytes.slice(o, o + L.DPAT)));
  const out = p.bytes.slice();
  out.set(buildDrumPattern(m, out.slice(o, o + L.DPAT)), o);
  return { bytes: out };
}

/**
 * Replaces automation lane `lane` (0-based) of pattern `index` of `track` (0–7: Synth 1, Synth 2,
 * MIDI 1, MIDI 2, Drum 1–4) with `points`: 192 values (32 steps × 6 points), each 0–127 or null.
 */
export function writeLane(p: Project, track: number, index: number, lane: number, points: readonly (number | null)[]): Project {
  int("track", track, 0, 7); int("pattern", index, 0, L.PATTERNS_PER_TRACK - 1);
  int("lane", lane, 0, track < 4 ? L.NLANES - 1 : L.DLANES - 1);
  if (points.length !== L.LANE) throw new RangeError(`a lane has ${L.LANE} points (32 steps × 6), got ${points.length}`);
  points.forEach((v, k) => { if (v !== null) int(`point ${k + 1}`, v, 0, 127); });
  const o = track < 4 ? L.notePatternOffset(track, index) + L.LANE0 : L.drumPatternOffset(track - 4, index) + L.DLANE0;
  const out = p.bytes.slice();
  out.set(points.map((v) => (v === null ? 0xff : v)), o + L.LANE * lane);
  if (track === 2 || track === 3) keepExtraLanes(p, out);
  return { bytes: out };
}

/** `entry` 0 is the scene chain (scenes 0–15); 1–8 are the pattern chains of the 8 tracks (0–7). */
export function writeChain(p: Project, entry: number, c: Chain): Project {
  int("chain entry", entry, 0, L.NCHAINS - 1);
  checkChain(entry === 0 ? "scene chain" : `track ${entry} chain`, c, entry === 0 ? L.NSCENES - 1 : L.PATTERNS_PER_TRACK - 1);
  const out = p.bytes.slice();
  out[L.CHAIN0 + 4 * entry] = c.first; out[L.CHAIN0 + 4 * entry + 1] = c.last;
  return { bytes: out };
}

/** Stores the 8 track chains of a scene and marks it saved. */
export function writeScene(p: Project, scene: number, chains: readonly Chain[]): Project {
  int("scene", scene, 0, L.NSCENES - 1);
  if (chains.length !== L.NTRACKS) throw new RangeError(`a scene has ${L.NTRACKS} track chains, got ${chains.length}`);
  chains.forEach((c, t) => checkChain(`scene ${scene + 1} track ${t + 1}`, c, L.PATTERNS_PER_TRACK - 1));
  const out = p.bytes.slice(), o = L.SCENE0 + scene * L.SCENE_SIZE;
  chains.forEach((c, t) => { out[o + 4 * t] = c.first; out[o + 4 * t + 1] = c.last; });
  out[o + L.SCENE_SAVED] = 1;
  return { bytes: out };
}

/**
 * Replaces Synth 1 (0) or Synth 2 (1)'s 340-byte patch. The bytes are a whole patch, built with
 * packages/patch `buildPatch` so only the edited parameters differ. Status `partial` (registry).
 */
export function writePatch(p: Project, synth: number, patch: Uint8Array): Project {
  int("synth", synth, 0, 1);
  if (patch.length !== L.PATCH_SIZE) throw new RangeError(`a synth patch is ${L.PATCH_SIZE} bytes, got ${patch.length}`);
  const out = p.bytes.slice();
  out.set(patch, L.PATCH0 + synth * L.PATCH_SIZE);
  return { bytes: out };
}

/** The patch parameter at a byte inside a synth patch: "name" for bytes 0–15. */
function patchFieldAt(rel: number): string {
  if (rel < NAME_LEN) return "name";
  return PATCH_PARAMS.find((x) => x.address === rel)?.id ?? `byte ${rel}`;
}

export interface ChangedRange {
  offset: number;
  length: number;
  /** The registry field, with the pattern for pattern fields (e.g. "MIDI 1 pattern 3: steps"). */
  field: string;
  status: Field["status"] | "after-stock";
}

function fieldAt(offset: number): { field: string; status: ChangedRange["status"] } {
  if (offset >= L.SESS_SIZE) return { field: "data after the stock part", status: "after-stock" };
  const inPattern = (base: number, size: number, count: number, names: readonly string[], fields: readonly Field[]): { field: string; status: Field["status"] } | null => {
    if (offset < base || offset >= base + size * count) return null;
    const n = Math.floor((offset - base) / size), rel = (offset - base) % size;
    const f = fields.find((x) => rel >= x.offset && rel < x.offset + x.size);
    return { field: `${names[Math.floor(n / 8)]} pattern ${(n % 8) + 1}: ${f?.id ?? "?"}`, status: f?.status ?? "unknown" };
  };
  const hit = inPattern(L.SYNTH0, L.PAT, 16, ["Synth 1", "Synth 2"], NOTE_PATTERN_FIELDS)
    ?? inPattern(L.MIDI0, L.PAT, 16, ["MIDI 1", "MIDI 2"], NOTE_PATTERN_FIELDS)
    ?? inPattern(L.DRUM0, L.DPAT, 32, L.DRUM_TRACKS, DRUM_PATTERN_FIELDS);
  if (hit) return hit;
  // Synth patches: name the parameter, e.g. "Synth 1 patch: filter.frequency".
  if (offset >= L.PATCH0 && offset < L.PATCH0 + 2 * L.PATCH_SIZE) {
    const s = Math.floor((offset - L.PATCH0) / L.PATCH_SIZE);
    const entry = SESSION_FIELDS.find((x) => x.id === `patch.synth${s + 1}`);
    return { field: `Synth ${s + 1} patch: ${patchFieldAt((offset - L.PATCH0) % L.PATCH_SIZE)}`, status: entry?.status ?? "unknown" };
  }
  const f = SESSION_FIELDS.find((x) => offset >= x.offset && offset < x.offset + x.size);
  return { field: f?.id ?? "?", status: f?.status ?? "unknown" };
}

/** The byte ranges where `b` differs from `a`, each labelled with its field. */
export function changedRanges(a: Uint8Array, b: Uint8Array): ChangedRange[] {
  const out: ChangedRange[] = [];
  const n = Math.max(a.length, b.length);
  let i = 0;
  while (i < n) {
    if (a[i] === b[i]) { i++; continue; }
    const start = i, { field, status } = fieldAt(i);
    while (i < n && a[i] !== b[i] && fieldAt(i).field === field) i++;
    out.push({ offset: start, length: i - start, field, status });
  }
  return out;
}
