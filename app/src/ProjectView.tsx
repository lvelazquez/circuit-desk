// Project settings: name, tempo, swing and scale. Each change is one undoable edit, heard at once
// in the preview. The drums' samples and knobs are in Sounds › Drums.
import type { SettingsEdit } from "@circuit-desk/ncs";
import { NOTE_NAMES, SCALE_INTERVALS, SCALE_NAMES } from "@circuit-desk/ncs";
import type { Settings } from "./desk.ts";
import { NumberField } from "./NumberField.tsx";
import { TextField, printableAscii } from "./ui/TextField.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Select, optionsOf } from "./ui/Select.tsx";

export interface ProjectProps {
  projectId: string;
  version: number;
  settings: Settings;
  onEdit: (edit: SettingsEdit, label: string) => void;
}

export function ProjectView(p: ProjectProps) {
  const s = p.settings;

  return (
    <section aria-label="Project settings" className="project-settings">
      <Panel title="Project">
        <TextField label="Name" value={s.name} maxLength={32} valid={printableAscii} onCommit={(n) => p.onEdit({ name: n }, `name “${n}”`)}
          tip="The name stored in the project: up to 32 plain characters. Enter saves it; Esc cancels." />
        <div className="row">
          <NumberField tip="Beats per minute, 40–240." label="Tempo (BPM)" value={s.tempo} min={40} max={240} onCommit={(v) => p.onEdit({ tempo: v }, `tempo ${v}`)} />
          <NumberField tip="Delays every second 1/16 step: 50 is straight, higher swings, lower pushes early (20–80)." label="Swing (%)" value={s.swing} min={20} max={80} onCommit={(v) => p.onEdit({ swing: v }, `swing ${v}`)} />
        </div>
      </Panel>

      <Panel title="Scale">
        <div className="row">
          <Select label="Root" value={s.scale.root} options={optionsOf(NOTE_NAMES)} onChange={(v) => p.onEdit({ scale: { root: v } }, `root ${NOTE_NAMES[v]}`)}
            tip="The key. Notes are stored relative to it, so changing it transposes every note track, as on the device." />
          <Select label="Scale" value={s.scale.type} options={optionsOf(SCALE_NAMES)} onChange={(v) => p.onEdit({ scale: { type: v } }, `scale ${SCALE_NAMES[v]}`)}
            tip="The scale the keyboard pads lay out. Notes already in patterns keep their pitch here." />
        </div>
        <p className="hint">
          {NOTE_NAMES[s.scale.root]} {SCALE_NAMES[s.scale.type]}: {SCALE_INTERVALS[s.scale.type]!.map((iv) => NOTE_NAMES[(s.scale.root + iv) % 12]).join(" ")}.
          {" "}As on the device, notes are stored relative to the root: changing the root transposes every note track. Here the scale lays out the keyboard pads; notes already in patterns keep their pitch (whether the device moves them on a scale change is not confirmed).
        </p>
      </Panel>

    </section>
  );
}
