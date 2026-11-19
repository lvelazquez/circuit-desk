// The field registry: every byte of the stock file belongs to exactly one entry, with how far
// we trust our reading of it. Editors may only change `verified` fields.
import * as L from "./layout.ts";

/**
 * - `verified`: the meaning is confirmed on a device (so far: by the upstream project's editor).
 * - `partial`: the meaning is likely, from evidence short of a device check.
 * - `unknown`: kept byte for byte and shown raw.
 */
export type FieldStatus = "verified" | "partial" | "unknown";

export interface Field {
  id: string;
  offset: number;
  size: number;
  status: FieldStatus;
  /** Where the reading comes from. */
  evidence: string;
}

const UPSTREAM = "upstream sd_app.html editor, used on a device";

/** Top-level regions of the file, in order. They cover all 160 780 bytes. */
export const SESSION_FIELDS: readonly Field[] = [
  { id: "header.magic", offset: 0x00, size: 4, status: "verified", evidence: "sd_app.html:732" },
  { id: "header.size", offset: L.HEADER_SIZE_AT, size: 4, status: "verified", evidence: "xlanes.py: the Projects view compares it with the file size" },
  { id: "header.word08", offset: 0x08, size: 4, status: "unknown", evidence: "NOTAS session map: 'versions'" },
  { id: "header.colour", offset: L.COLOUR_AT, size: 4, status: "partial", evidence: "values 0–13 in 152 projects; the Novation validator has 'Session colour out of range'" },
  { id: "header.name", offset: L.NAME_AT, size: L.NAME_LEN, status: "verified", evidence: "sd_app.html:998" },
  { id: "header.word30", offset: 0x30, size: 4, status: "unknown", evidence: "not described" },
  { id: "tempo", offset: L.TEMPO_AT, size: 1, status: "partial", evidence: "values 40–174 in 152 projects: reads as BPM (docs/card-survey.md)" },
  { id: "swing", offset: L.SWING_AT, size: 1, status: "partial", evidence: "50 in 84 of 152 projects, otherwise 22–70: reads as percent" },
  { id: "swingSync", offset: L.SWING_SYNC_AT, size: 1, status: "unknown", evidence: "3 in all 152 projects; the validator has 'Swing sync rate out of range'" },
  { id: "header.reserved", offset: 0x37, size: 9, status: "unknown", evidence: "zero in all 152 projects" },
  { id: "scenes", offset: L.SCENE0, size: L.NSCENES * L.SCENE_SIZE, status: "verified", evidence: "NOTAS, scenes located 2026-10-13" },
  { id: "chains", offset: L.CHAIN0, size: L.NCHAINS * 4, status: "verified", evidence: "NOTAS, scenes located 2026-10-13" },
  { id: "patterns.synth", offset: L.SYNTH0, size: 16 * L.PAT, status: "verified", evidence: UPSTREAM },
  { id: "synthPatchIndex", offset: L.SYNTH_GAP, size: L.SYNTH_GAP_N, status: "partial", evidence: "sd_app.html:1029: bytes +0 and +8 are the patch index of Synth 1 and 2; the rest is not described" },
  { id: "patterns.drum", offset: L.DRUM0, size: 32 * L.DPAT, status: "verified", evidence: UPSTREAM },
  { id: "drumGap", offset: L.DRUM_GAP, size: L.DRUM_GAP_N, status: "unknown", evidence: "NOTAS session map: '8 B between blocks (with data)'" },
  { id: "patterns.midi", offset: L.MIDI0, size: 16 * L.PAT, status: "verified", evidence: UPSTREAM },
  { id: "looseSettings", offset: L.LOOSE, size: L.LOOSE_N, status: "unknown", evidence: "10 of 24 bytes vary across 152 projects" },
  { id: "patch.synth1", offset: L.PATCH0, size: L.PATCH_SIZE, status: "partial", evidence: "Novation Programmer's Reference v3 Synth Patch Format, field table in packages/patch; 1 050 card patches in range (tools/patch-sweep.ts). Verified after one device dump matches (plan D-8)" },
  { id: "patch.synth2", offset: L.PATCH0 + L.PATCH_SIZE, size: L.PATCH_SIZE, status: "partial", evidence: "Novation Programmer's Reference v3 Synth Patch Format, field table in packages/patch; 1 050 card patches in range (tools/patch-sweep.ts). Verified after one device dump matches (plan D-8)" },
  { id: "drumBlock", offset: L.DRUM_BLOCK, size: 4 * L.DRUM_RECORD, status: "partial", evidence: "sd_app.html:1031: byte 0 of each 11-byte record is the sample index; the rest is not described" },
  { id: "projectParams", offset: L.PROJECT_PARAMS, size: L.PROJECT_PARAMS_N, status: "unknown", evidence: "52 of 60 bytes vary across 152 projects" },
  { id: "tail", offset: L.TAIL, size: L.TAIL_N, status: "unknown", evidence: "not read by stock; not zero in 24 of 152 projects; CIRCUIT-HACKS keeps signed blocks here" },
];

/** Regions inside one note-track pattern (3 240 bytes). */
export const NOTE_PATTERN_FIELDS: readonly Field[] = [
  { id: "steps", offset: 0, size: L.NSTEPS * L.STEP, status: "verified", evidence: UPSTREAM },
  { id: "lastStep", offset: L.SETT, size: 1, status: "verified", evidence: "NOTAS audit 2026-10-13: byte 0 = last step" },
  { id: "firstStep", offset: L.SETT + 1, size: 1, status: "verified", evidence: "NOTAS audit 2026-10-13: byte 1 = first step" },
  { id: "syncRate", offset: L.SETT + 2, size: 1, status: "verified", evidence: "stock reads it at 0x0803C744" },
  { id: "direction", offset: L.SETT + 3, size: 1, status: "verified", evidence: "stock reads it at 0x0803C790" },
  { id: "settings4to6", offset: L.SETT + 4, size: 3, status: "unknown", evidence: "not read by stock; CIRCUIT-HACKS chain rule" },
  { id: "settings7", offset: L.SETT + 7, size: 1, status: "unknown", evidence: "not read by stock; CIRCUIT-HACKS play order" },
  { id: "settings8to39", offset: L.SETT + 8, size: L.SETN - 8, status: "unknown", evidence: "not read by stock; not zero in 24 of 152 projects" },
  { id: "automation", offset: L.LANE0, size: L.NLANES * L.LANE, status: "partial", evidence: "the storage is known; which parameter each lane drives is not" },
];

/** Regions inside one drum pattern (1 704 bytes). */
export const DRUM_PATTERN_FIELDS: readonly Field[] = [
  { id: "velocity", offset: 0, size: 32, status: "verified", evidence: UPSTREAM },
  { id: "probability", offset: 32, size: 32, status: "verified", evidence: UPSTREAM },
  { id: "sampleFlip", offset: 64, size: 32, status: "verified", evidence: UPSTREAM },
  { id: "microSteps", offset: 96, size: 32, status: "verified", evidence: UPSTREAM },
  { id: "lastStep", offset: L.DSETT, size: 1, status: "verified", evidence: "as note patterns" },
  { id: "firstStep", offset: L.DSETT + 1, size: 1, status: "verified", evidence: "as note patterns" },
  { id: "syncRate", offset: L.DSETT + 2, size: 1, status: "verified", evidence: "as note patterns" },
  { id: "direction", offset: L.DSETT + 3, size: 1, status: "verified", evidence: "as note patterns" },
  { id: "settings4to39", offset: L.DSETT + 4, size: L.SETN - 4, status: "unknown", evidence: "not read by stock; not zero in 24 of 152 projects" },
  { id: "automation", offset: L.DLANE0, size: L.DLANES * L.LANE, status: "partial", evidence: "NOTAS:1178: lanes 0–3 the drum knobs, 4 level, 5/6 FX sends, 7 pan; no device check of ours yet" },
];

/** Returns the first gap or overlap in `fields` over `[0, total)`, or null when they tile it exactly. */
export function tilingProblem(fields: readonly Field[], total: number): string | null {
  let at = 0;
  for (const f of fields) {
    if (f.offset !== at) return `${f.id} starts at ${f.offset}, expected ${at}`;
    if (f.size <= 0) return `${f.id} has size ${f.size}`;
    at += f.size;
  }
  return at === total ? null : `fields end at ${at}, expected ${total}`;
}

export function fieldById(fields: readonly Field[], id: string): Field {
  const f = fields.find((x) => x.id === id);
  if (!f) throw new Error(`no field ${id}`);
  return f;
}
