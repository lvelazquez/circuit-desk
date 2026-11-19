// Byte layout of a Circuit Tracks project file (.ncs), firmware 1.2.1.
// Sources: circuit-hacks-rc/tools/sd_app.html:150-153 and the session map in docs/NOTAS.md.

/** Size of the part the stock firmware reads and writes. Mod data may follow it. */
export const SESS_SIZE = 0x2740c;

export const MAGIC = "USER";
export const HEADER_SIZE_AT = 0x04;
export const COLOUR_AT = 0x0c;
export const NAME_AT = 0x10;
export const NAME_LEN = 32;
export const TEMPO_AT = 0x34;
export const SWING_AT = 0x35;
export const SWING_SYNC_AT = 0x36;

export const SCENE0 = 0x40;
export const SCENE_SIZE = 40;
export const NSCENES = 16;
/** Byte inside a scene that is 1 when the scene has been saved. */
export const SCENE_SAVED = 32;
export const CHAIN0 = 0x2c0;
/** Entry 0 is the scene chain; entries 1 to 8 are the pattern chain of each track. */
export const NCHAINS = 9;
export const NTRACKS = 8;

export const SYNTH0 = 0x2e4;
export const DRUM0 = 0xcd74;
export const MIDI0 = 0x1a27c;
export const PATTERNS_PER_TRACK = 8;

/** A note-track pattern: Synth 1, Synth 2, MIDI 1, MIDI 2. */
export const PAT = 0xca8;
export const NSTEPS = 32;
export const STEP = 28;
export const UNITS = 6;
export const SETT = 0x380;
export const SETN = 40;
export const LANE0 = 0x3a8;
export const NLANES = 12;
/** One automation lane: 32 steps of 6 micro-steps; 0xFF means no value. */
export const LANE = 192;

/** A drum pattern. */
export const DPAT = 0x6a8;
export const DSETT = 0x80;
export const DLANE0 = 0xa8;
export const DLANES = 8;

/** Two bytes after the synth patterns hold the patch index of Synth 1 (+0) and Synth 2 (+8). */
export const SYNTH_GAP = 0xcd64;
export const SYNTH_GAP_N = 16;
export const DRUM_GAP = 0x1a274;
export const DRUM_GAP_N = 8;

export const LOOSE = 0x26cfc;
export const LOOSE_N = 24;
export const PATCH0 = 0x26d14;
export const PATCH_SIZE = 340;
/** Four records of 11 bytes, one per drum. Byte 0 is the sample index. */
export const DRUM_BLOCK = 0x26fbc;
export const DRUM_RECORD = 11;
export const PROJECT_PARAMS = 0x26fe8;
export const PROJECT_PARAMS_N = 60;
export const TAIL = 0x27024;
export const TAIL_N = 1000;

/** Ticks per step at 480 ticks a quarter note, by sync-rate index (sd_app.html:884). */
export const SYNC_RATE_TICKS = [40, 60, 80, 120, 160, 240, 320, 480] as const;

export const NOTE_TRACKS = ["Synth 1", "Synth 2", "MIDI 1", "MIDI 2"] as const;
export const DRUM_TRACKS = ["Drum 1", "Drum 2", "Drum 3", "Drum 4"] as const;

/** CIRCUIT-HACKS data that can follow the stock part of the file. */
export const XLN1_HEADER = 16;
export const XLN1_DATA = 16 * 1626;
export const XLN1_SUM_AT = 8;
export const SCN3_AT = SESS_SIZE + XLN1_HEADER + XLN1_DATA;

/** Where note-track pattern `index` (0–7) of note track `track` (0–3) starts. */
export function notePatternOffset(track: number, index: number): number {
  const base = track < 2 ? SYNTH0 : MIDI0;
  return base + ((track & 1) * PATTERNS_PER_TRACK + index) * PAT;
}

/** Where pattern `index` (0–7) of drum `drum` (0–3) starts. */
export function drumPatternOffset(drum: number, index: number): number {
  return DRUM0 + (drum * PATTERNS_PER_TRACK + index) * DPAT;
}
