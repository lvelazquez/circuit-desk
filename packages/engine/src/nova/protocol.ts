// Messages between the main thread (NovaInstrument) and the AudioWorklet (worklet.ts).
// Times are audio-context seconds; the worklet turns them into frames.

export const NOVA_PROCESSOR = "circuit-desk-nova";

export type NovaMessage =
  | { type: "values"; values: Record<string, number> }
  | { type: "on"; time: number; note: number; velocity: number }
  | { type: "off"; time: number; note: number }
  | { type: "silence"; time: number }
  /** Tempo, for synced chorus rates. */
  | { type: "bpm"; bpm: number }
  /** The app's FX switch: false plays the voices without the patch's effects. */
  | { type: "fx"; on: boolean };

/** What a Nova node starts with (AudioWorkletNode processorOptions). */
export interface NovaInit { values?: Record<string, number>; fx?: boolean; bpm?: number }

/** The project mixer (fx/mixer.ts): 8 stereo strips in, one stereo mix out. */
export const MIXER_PROCESSOR = "circuit-desk-mixer";
/** What the mixer node starts with (processorOptions). */
export interface MixerInit { sound?: import("@circuit-desk/ncs").SoundSettings; bpm?: number; fx?: boolean }
export type MixerMessage =
  | { type: "sound"; sound: import("@circuit-desk/ncs").SoundSettings; bpm: number }
  | { type: "trigger"; time: number; drum: number }
  | { type: "fx"; on: boolean };

/** The capture tap: passes audio through and keeps the last seconds of it for a sound report. */
export const TAP_PROCESSOR = "circuit-desk-tap";
/** How much audio the tap keeps, seconds. */
export const TAP_SECONDS = 10;

/** To the tap: send what you have. */
export type TapRequest = { type: "dump"; id: number };
/** From the tap: the last TAP_SECONDS (or less, right after start), oldest first. `endFrame` is
 * the audio frame just after the last sample, so event times can be placed in the buffer. */
export type TapDump = { type: "dump"; id: number; endFrame: number; sampleRate: number; left: Float32Array; right: Float32Array };
