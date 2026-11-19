// Messages between the main thread (NovaInstrument) and the AudioWorklet (worklet.ts).
// Times are audio-context seconds; the worklet turns them into frames.

export const NOVA_PROCESSOR = "circuit-desk-nova";

export type NovaMessage =
  | { type: "values"; values: Record<string, number> }
  | { type: "on"; time: number; note: number; velocity: number }
  | { type: "off"; time: number; note: number }
  | { type: "silence"; time: number };

/** The capture tap: passes audio through and keeps the last seconds of it for a sound report. */
export const TAP_PROCESSOR = "circuit-desk-tap";
/** How much audio the tap keeps, seconds. */
export const TAP_SECONDS = 10;

/** To the tap: send what you have. */
export type TapRequest = { type: "dump"; id: number };
/** From the tap: the last TAP_SECONDS (or less, right after start), oldest first. `endFrame` is
 * the audio frame just after the last sample, so event times can be placed in the buffer. */
export type TapDump = { type: "dump"; id: number; endFrame: number; sampleRate: number; left: Float32Array; right: Float32Array };
