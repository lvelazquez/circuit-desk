/// <reference lib="dom" />
// The preview engine's instrument contract. Every sound source — today's stand-in synth and the
// pack sampler, later a Nova emulator or a drum engine with the pack's settings — implements it,
// so the scheduler, mixer and UI never change when a more accurate instrument arrives.

export interface NoteOn {
  /** Audio-context time, seconds. */
  time: number;
  note: number;
  velocity: number;
  /** Drums: a pack sample to play instead of the track's own (a step's sample flip). */
  sample?: number;
}

export interface Instrument {
  /** Plays a note; `out` is the track's channel strip input. */
  noteOn(e: NoteOn): void;
  noteOff(time: number, note: number): void;
  /** A controller change (MIDI CC numbering). Instruments ignore what they do not model. */
  control(time: number, cc: number, value: number): void;
  /** Stops everything now (or at `time`), with a short fade so nothing clicks. */
  silence(time: number): void;
  dispose(): void;
}

/** How a track's instrument is chosen; a later engine can add "circuit-drum". */
export type InstrumentKind = "synth" | "sampler" | "nova";
