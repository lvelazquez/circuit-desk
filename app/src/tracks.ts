import type { CSSProperties } from "react";
import type { DrumTrackName, NoteTrackName, TrackName } from "@circuit-desk/core-service";

export const TRACK_NAMES = ["Synth 1", "Synth 2", "MIDI 1", "MIDI 2", "Drum 1", "Drum 2", "Drum 3", "Drum 4"] as const satisfies readonly TrackName[];
export const DRUM_NAMES = ["Drum 1", "Drum 2", "Drum 3", "Drum 4"] as const satisfies readonly DrumTrackName[];

export const isDrum = (t: TrackName): t is DrumTrackName => t.startsWith("Drum");
export const isNoteTrack = (t: TrackName): t is NoteTrackName => !isDrum(t);

/** The track's colour token, as the --track custom property its controls read. */
export function trackStyle(t: TrackName): CSSProperties {
  return { "--track": `var(--color-track-${t.replace(" ", "").toLowerCase()})` } as CSSProperties;
}
