// Messages between the main thread (NovaInstrument) and the AudioWorklet (worklet.ts).
// Times are audio-context seconds; the worklet turns them into frames.

export const NOVA_PROCESSOR = "circuit-desk-nova";

export type NovaMessage =
  | { type: "values"; values: Record<string, number> }
  | { type: "on"; time: number; note: number; velocity: number }
  | { type: "off"; time: number; note: number }
  | { type: "silence"; time: number };
