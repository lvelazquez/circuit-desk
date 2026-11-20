// Project settings: name, tempo, swing, scale, and the sound of each drum track (its sample and
// knobs). Each change is one undoable edit, heard at once in the preview.
import { useEffect, useState } from "react";
import type { SettingsEdit } from "@circuit-desk/ncs";
import { NOTE_NAMES, SCALE_INTERVALS, SCALE_NAMES } from "@circuit-desk/ncs";
import { call, type Settings } from "./desk.ts";
import { NumberField } from "./NumberField.tsx";
import { Slider, centreText } from "./Slider.tsx";
import { DRUM_NAMES, trackStyle } from "./tracks.ts";

export interface ProjectProps {
  projectId: string;
  version: number;
  settings: Settings;
  onEdit: (edit: SettingsEdit, label: string) => void;
}

export function ProjectView(p: ProjectProps) {
  const s = p.settings;
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name]);
  const [samples, setSamples] = useState<{ index: number; name: string }[]>([]);
  useEffect(() => {
    let live = true;
    void call("packSamples", p.projectId).then((r) => { if (live) setSamples(r.samples); }, () => undefined);
    return () => { live = false; };
  }, [p.projectId, p.version]);
  const commitName = (): void => { const n = name.trim(); if (n && n !== s.name) p.onEdit({ name: n }, `name “${n}”`); else setName(s.name); };
  const drum = (d: number, f: "sample" | "pitch" | "decay" | "distortion" | "eq", v: number, label: string): void =>
    p.onEdit({ sound: { drums: [0, 1, 2, 3].map((i) => (i === d ? { [f]: v } : null)) } }, label);

  return (
    <section aria-label="Project settings" className="project-settings">
      <fieldset className="fx-panel">
        <legend>Project</legend>
        <label>Name
          <input type="text" maxLength={32} data-tip="The name stored in the project: up to 32 plain characters. Enter saves it; Esc cancels." value={name} pattern="[\x20-\x7e]*" onChange={(e) => setName(e.target.value)} onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") setName(s.name); }} />
        </label>
        <div className="row">
          <NumberField tip="Beats per minute, 40–240." label="Tempo (BPM)" value={s.tempo} min={40} max={240} onCommit={(v) => p.onEdit({ tempo: v }, `tempo ${v}`)} />
          <NumberField tip="Delays every second 1/16 step: 50 is straight, higher swings, lower pushes early (20–80)." label="Swing (%)" value={s.swing} min={20} max={80} onCommit={(v) => p.onEdit({ swing: v }, `swing ${v}`)} />
        </div>
      </fieldset>

      <fieldset className="fx-panel">
        <legend>Scale</legend>
        <div className="row">
          <label>Root
            <select data-tip="The key. Notes are stored relative to it, so changing it transposes every note track, as on the device." value={s.scale.root} onChange={(e) => p.onEdit({ scale: { root: Number(e.target.value) } }, `root ${NOTE_NAMES[Number(e.target.value)]}`)}>
              {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
          <label>Scale
            <select data-tip="The scale the keyboard pads lay out. Notes already in patterns keep their pitch here." value={s.scale.type} onChange={(e) => p.onEdit({ scale: { type: Number(e.target.value) } }, `scale ${SCALE_NAMES[Number(e.target.value)]}`)}>
              {SCALE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
        </div>
        <p className="hint">
          {NOTE_NAMES[s.scale.root]} {SCALE_NAMES[s.scale.type]}: {SCALE_INTERVALS[s.scale.type]!.map((iv) => NOTE_NAMES[(s.scale.root + iv) % 12]).join(" ")}.
          {" "}As on the device, notes are stored relative to the root: changing the root transposes every note track. Here the scale lays out the keyboard pads; notes already in patterns keep their pitch (whether the device moves them on a scale change is not confirmed).
        </p>
      </fieldset>

      <h2>Drum sounds</h2>
      <div className="fx-panels">
        {DRUM_NAMES.map((n, d) => {
          const k = s.sound.drums[d]!;
          return (
            <fieldset key={n} className="fx-panel" style={trackStyle(n)}>
              <legend>{n}</legend>
              <label>Sample
                <select data-tip="The pack sample this drum plays (a step can flip to another)." value={k.sample} onChange={(e) => drum(d, "sample", Number(e.target.value), `${n} sample ${Number(e.target.value) + 1}`)}>
                  {(samples.length ? samples : Array.from({ length: 64 }, (_, i) => ({ index: i, name: "" }))).map((x) => (
                    <option key={x.index} value={x.index}>{x.index + 1}{x.name ? ` · ${x.name}` : ""}</option>
                  ))}
                </select>
              </label>
              <Slider tip="Tunes the drum sample up or down; 0 is as recorded." label="Pitch" value={k.pitch} text={centreText} onCommit={(v) => drum(d, "pitch", v, `${n} pitch ${centreText(v)}`)} />
              <Slider tip="How long the drum sounds before it fades." label="Decay" value={k.decay} onCommit={(v) => drum(d, "decay", v, `${n} decay ${v}`)} />
              <Slider tip="Drive on this drum." label="Distortion" value={k.distortion} onCommit={(v) => drum(d, "distortion", v, `${n} distortion ${v}`)} />
              <Slider tip="Tilt EQ: below 0 darker, above 0 brighter." label="EQ" value={k.eq} text={centreText} onCommit={(v) => drum(d, "eq", v, `${n} EQ ${centreText(v)}`)} />
            </fieldset>
          );
        })}
      </div>
      <p className="hint">Drum level and pan are in the Mixer. These settings are read from the firmware's parameter table and the card; they are not yet confirmed by loading an edited copy on a device.</p>
    </section>
  );
}
