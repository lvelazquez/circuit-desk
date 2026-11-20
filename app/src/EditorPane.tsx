// The Editor view: track and pattern pickers, the piano roll with its lanes, then the drum grid and
// the drum automation lanes.
import type { DrumStepIn, DrumTrackName, NoteStepIn, TrackName } from "@circuit-desk/core-service";
import type { DrumPatternData, PatternData } from "./desk.ts";
import { DrumAutomation, DrumGrid, PianoRoll, type LaneEdit } from "./EditorView.tsx";
import { NOTE_TRACKS } from "./tracks.ts";

export interface EditorPaneProps {
  projectId: string | null;
  version: number;
  track: TrackName;
  pattern: number;
  data: PatternData;
  drums: readonly DrumPatternData[];
  drumSel: { drum: DrumTrackName; step: number } | null;
  onTrack: (t: TrackName) => void;
  onPattern: (n: number) => void;
  onSelectStep: (s: number | null) => void;
  onSelectDrum: (d: DrumTrackName, s: number) => void;
  onNoteSteps: (steps: NoteStepIn[], label: string) => void;
  onDrumSteps: (drum: DrumTrackName, steps: DrumStepIn[], label: string) => void;
  onLaneEdit: LaneEdit;
}

export function EditorPane(p: EditorPaneProps) {
  return (
    <>
      <div className="row">
        <label>Track
          <select data-tip="The note track shown in the piano roll." value={p.track} onChange={(e) => p.onTrack(e.target.value as TrackName)}>
            {NOTE_TRACKS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>Pattern
          <select data-tip="The pattern shown in the piano roll and the drum grid." value={p.pattern} onChange={(e) => p.onPattern(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      {p.data.kind === "notes" ? <PianoRoll projectId={p.projectId} version={p.version} track={p.track} pattern={p.pattern} data={p.data} onNoteSteps={p.onNoteSteps} onLaneEdit={p.onLaneEdit} onSelectStep={p.onSelectStep} />
        : <p className="hint">Choose a Synth or MIDI track for the piano roll.</p>}
      <h2 className="visually-hidden">Drums</h2>
      <div className="stack-gap-xl">
        <DrumGrid pattern={p.pattern} drums={p.drums} selected={p.drumSel} onSelect={p.onSelectDrum} onDrumSteps={p.onDrumSteps} />
        <DrumAutomation projectId={p.projectId} version={p.version} pattern={p.pattern} onLaneEdit={p.onLaneEdit} />
      </div>
    </>
  );
}
