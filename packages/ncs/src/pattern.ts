// Patterns: parse into a model and build back over the bytes they came from.
// Ported from circuit-hacks-rc/tools/sd_app.html (patParse :831, patBuild :842, patCells :872).
// Building always starts from a base pattern, so every byte the model does not describe survives.
import { DLANE0, DLANES, DPAT, DSETT, LANE, LANE0, NLANES, NSTEPS, PAT, SETT, STEP, UNITS } from "./layout.ts";

/** One of the six note slots of a step. */
export interface NoteUnit {
  on: boolean;
  /** MIDI note number. */
  note: number;
  /** Length in sixths of a step, 1–96. */
  gate: number;
  /** Bit 7 of the gate byte. How a tied note plays is not confirmed on a device yet. */
  tie: boolean;
  /** Start offset inside the step, in sixths of a step. */
  micro: number;
  velocity: number;
}

export interface NoteStep {
  /** 0–7; 7 = always. */
  probability: number;
  /** Step byte 2. Zero in stock projects; CIRCUIT-HACKS uses it. */
  byte2: number;
  /** Step byte 3. Zero in stock projects; CIRCUIT-HACKS uses it. */
  byte3: number;
  units: NoteUnit[];
}

export interface PatternSettings {
  lastStep: number;
  firstStep: number;
  /** Index into SYNC_RATE_TICKS. */
  syncRate: number;
  /** 0 = forward; 1–3 are the other play directions. */
  direction: number;
}

export interface NotePattern {
  steps: NoteStep[];
  settings: PatternSettings;
  /** 12 lanes of 192 bytes; 0xFF = no value. */
  lanes: Uint8Array[];
}

export interface DrumStep {
  /** Raw byte: 0 = no hit, otherwise the velocity. */
  velocity: number;
  /** Raw byte; the device uses bits 0–2. */
  probability: number;
  /** Raw byte: a sample index for this step, or 0xFF for the track's sample. */
  sampleFlip: number;
  /** Raw byte: a mask of the six micro-steps that sound; 0 = the first only. */
  microSteps: number;
}

export interface DrumPattern {
  steps: DrumStep[];
  settings: PatternSettings;
  /** 8 lanes of 192 bytes; 0xFF = no value. */
  lanes: Uint8Array[];
}

function at(b: Uint8Array, i: number): number {
  const v = b[i];
  if (v === undefined) throw new RangeError(`offset ${i} is outside the pattern`);
  return v;
}

function readSettings(b: Uint8Array, s: number): PatternSettings {
  return { lastStep: at(b, s), firstStep: at(b, s + 1), syncRate: at(b, s + 2), direction: at(b, s + 3) };
}

function writeSettings(b: Uint8Array, s: number, m: PatternSettings): void {
  b[s] = m.lastStep; b[s + 1] = m.firstStep; b[s + 2] = m.syncRate; b[s + 3] = m.direction;
}

function readLanes(b: Uint8Array, start: number, count: number): Uint8Array[] {
  const lanes: Uint8Array[] = [];
  for (let k = 0; k < count; k++) lanes.push(b.slice(start + LANE * k, start + LANE * (k + 1)));
  return lanes;
}

function writeLanes(b: Uint8Array, start: number, count: number, lanes: readonly Uint8Array[]): void {
  if (lanes.length !== count) throw new RangeError(`expected ${count} lanes, got ${lanes.length}`);
  lanes.forEach((lane, k) => {
    if (lane.length !== LANE) throw new RangeError(`lane ${k} has ${lane.length} bytes, expected ${LANE}`);
    b.set(lane, start + LANE * k);
  });
}

export function parseNotePattern(b: Uint8Array): NotePattern {
  if (b.length !== PAT) throw new RangeError(`a note pattern is ${PAT} bytes, got ${b.length}`);
  const steps: NoteStep[] = [];
  for (let s = 0; s < NSTEPS; s++) {
    const o = s * STEP;
    const mask = at(b, o);
    const units: NoteUnit[] = [];
    for (let u = 0; u < UNITS; u++) {
      const q = o + 4 + 4 * u;
      const g = at(b, q + 1);
      units.push({ on: ((mask >> u) & 1) === 1, note: at(b, q), gate: g & 127, tie: g >> 7 === 1, micro: at(b, q + 2), velocity: at(b, q + 3) });
    }
    steps.push({ probability: at(b, o + 1), byte2: at(b, o + 2), byte3: at(b, o + 3), units });
  }
  return { steps, settings: readSettings(b, SETT), lanes: readLanes(b, LANE0, NLANES) };
}

/**
 * Writes `m` over a copy of `base`. A unit that is off in both keeps its bytes; a unit switched
 * off is reset to the device's empty value. Bits 6–7 of the step mask are kept from `base`.
 */
export function buildNotePattern(m: NotePattern, base: Uint8Array): Uint8Array {
  if (base.length !== PAT) throw new RangeError(`a note pattern is ${PAT} bytes, got ${base.length}`);
  if (m.steps.length !== NSTEPS) throw new RangeError(`expected ${NSTEPS} steps, got ${m.steps.length}`);
  const b = base.slice();
  m.steps.forEach((st, s) => {
    const o = s * STEP;
    const old = at(b, o);
    let mask = old & 0xc0;
    st.units.forEach((u, i) => {
      const q = o + 4 + 4 * i;
      if (u.on) {
        mask |= 1 << i;
        b[q] = u.note; b[q + 1] = (u.gate & 127) | (u.tie ? 128 : 0); b[q + 2] = u.micro; b[q + 3] = u.velocity;
      } else if ((old >> i) & 1) {
        b[q] = 0; b[q + 1] = 0; b[q + 2] = 0; b[q + 3] = 0x60;
      }
    });
    b[o] = mask; b[o + 1] = st.probability; b[o + 2] = st.byte2; b[o + 3] = st.byte3;
  });
  writeSettings(b, SETT, m.settings);
  writeLanes(b, LANE0, NLANES, m.lanes);
  return b;
}

export function parseDrumPattern(b: Uint8Array): DrumPattern {
  if (b.length !== DPAT) throw new RangeError(`a drum pattern is ${DPAT} bytes, got ${b.length}`);
  const steps: DrumStep[] = [];
  for (let s = 0; s < NSTEPS; s++) {
    steps.push({ velocity: at(b, s), probability: at(b, 32 + s), sampleFlip: at(b, 64 + s), microSteps: at(b, 96 + s) });
  }
  return { steps, settings: readSettings(b, DSETT), lanes: readLanes(b, DLANE0, DLANES) };
}

export function buildDrumPattern(m: DrumPattern, base: Uint8Array): Uint8Array {
  if (base.length !== DPAT) throw new RangeError(`a drum pattern is ${DPAT} bytes, got ${base.length}`);
  if (m.steps.length !== NSTEPS) throw new RangeError(`expected ${NSTEPS} steps, got ${m.steps.length}`);
  const b = base.slice();
  m.steps.forEach((st, s) => {
    b[s] = st.velocity; b[32 + s] = st.probability; b[64 + s] = st.sampleFlip; b[96 + s] = st.microSteps;
  });
  writeSettings(b, DSETT, m.settings);
  writeLanes(b, DLANE0, DLANES, m.lanes);
  return b;
}
