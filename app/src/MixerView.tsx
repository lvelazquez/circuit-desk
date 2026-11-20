// The Mixer: a strip per track (level, pan, reverb and delay sends, mute, solo), then the project
// FX (reverb, delay, FX bypass) and the sidechains. Levels, pans, sends and FX are project
// settings: each change is an undoable edit and is heard at once in the preview. Mute and solo
// are playback only (the file's mute state is not decoded).
import { DELAY_RATIOS, REVERB_TYPES, SEND_TRACKS } from "@circuit-desk/ncs";
import type { SettingsEdit } from "@circuit-desk/ncs";
import type { Settings } from "./desk.ts";
import { Slider, panText } from "./Slider.tsx";
import { TRACK_NAMES, trackStyle } from "./tracks.ts";

/** Synth 1, Synth 2, MIDI 1, MIDI 2 keep level and pan in the project block, in this order. */
const BLOCK_TRACKS = ["Synth 1", "Synth 2", "MIDI 1", "MIDI 2"] as const;
const SIDECHAIN_SOURCES = ["Drum 1", "Drum 2", "Drum 3", "Drum 4", "Off"] as const;

export interface MixerProps {
  settings: Settings;
  muted: ReadonlySet<number>;
  solo: number | null;
  onMute: (track: number) => void;
  onSolo: (track: number) => void;
  onEdit: (edit: SettingsEdit, label: string) => void;
}

/** A list edit that changes entry `k` only (null leaves the others). */
const at = (k: number, v: number, n: number): (number | null)[] => Array.from({ length: n }, (_, i) => (i === k ? v : null));

export function MixerView(p: MixerProps) {
  const s = p.settings.sound;
  return (
    <section aria-label="Mixer" className="mixer">
      <div className="strips" role="group" aria-label="Track strips">
        {TRACK_NAMES.map((name, t) => {
          const drum = t >= 4 ? t - 4 : null;
          const b = drum === null ? BLOCK_TRACKS.indexOf(name as (typeof BLOCK_TRACKS)[number]) : -1;
          const level = drum !== null ? s.drums[drum]!.level : s.levels[b]!;
          const pan = drum !== null ? s.drums[drum]!.pan : s.pans[b]!;
          const send = SEND_TRACKS.indexOf(name as (typeof SEND_TRACKS)[number]);
          const setLevel = (v: number): void => p.onEdit(drum !== null ? { sound: { drums: at4(drum, { level: v }) } } : { sound: { levels: at(b, v, 4) } }, `${name} level ${v}`);
          const setPan = (v: number): void => p.onEdit(drum !== null ? { sound: { drums: at4(drum, { pan: v }) } } : { sound: { pans: at(b, v, 4) } }, `${name} pan ${panText(v)}`);
          const audible = p.solo === null ? !p.muted.has(t) : p.solo === t;
          return (
            <fieldset key={name} className="strip" style={trackStyle(name)} data-silent={!audible}>
              <legend>{name}</legend>
              <Slider label="Level" value={level} onCommit={setLevel} tip={`${name}'s volume in the mix. Saved in the project; heard at once while playing.`} />
              <Slider label="Pan" value={pan} onCommit={setPan} text={panText} tip="Left–right position; C is the centre." />
              <Slider tip="How much of this track goes to the project reverb." label="Reverb send" value={s.reverb.sends[send]!} onCommit={(v) => p.onEdit({ sound: { reverb: { sends: at(send, v, 8) } } }, `${name} reverb send ${v}`)} />
              <Slider tip="How much of this track goes to the project delay." label="Delay send" value={s.delay.sends[send]!} onCommit={(v) => p.onEdit({ sound: { delay: { sends: at(send, v, 8) } } }, `${name} delay send ${v}`)} />
              <div className="row">
                <button type="button" className="btn btn-small" aria-pressed={p.muted.has(t)} onClick={() => p.onMute(t)} data-tip="Silence this track while playing here. Not saved in the project.">Mute</button>
                <button type="button" className="btn btn-small" aria-pressed={p.solo === t} onClick={() => p.onSolo(t)} data-tip="Hear only this track while playing here; press again to hear all. Not saved in the project.">Solo</button>
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="fx-panels">
        <fieldset className="fx-panel">
          <legend>Reverb</legend>
          <label>Type
            <select data-tip="The reverb's room, from a small chamber to a great hall." value={s.reverb.type} onChange={(e) => p.onEdit({ sound: { reverb: { type: Number(e.target.value) } } }, `reverb ${REVERB_TYPES[Number(e.target.value)]}`)}>
              {REVERB_TYPES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
          <Slider tip="How long the reverb rings." label="Decay" value={s.reverb.decay} onCommit={(v) => p.onEdit({ sound: { reverb: { decay: v } } }, `reverb decay ${v}`)} />
          <Slider tip="How quickly the reverb's highs fade: more is darker." label="Damping" value={s.reverb.damping} onCommit={(v) => p.onEdit({ sound: { reverb: { damping: v } } }, `reverb damping ${v}`)} />
        </fieldset>
        <fieldset className="fx-panel">
          <legend>Delay</legend>
          <Slider tip="Delay time when Sync is free." label="Time" value={s.delay.time} onCommit={(v) => p.onEdit({ sound: { delay: { time: v } } }, `delay time ${v}`)} />
          <Slider tip="Ties the delay time to the tempo as a note length; free uses Time." label="Sync" value={s.delay.sync} max={35} text={(v) => (v === 0 ? "free" : String(v))} onCommit={(v) => p.onEdit({ sound: { delay: { sync: v } } }, `delay sync ${v}`)} />
          <Slider tip="How many repeats: more feedback, longer echo tail." label="Feedback" value={s.delay.feedback} onCommit={(v) => p.onEdit({ sound: { delay: { feedback: v } } }, `delay feedback ${v}`)} />
          <Slider tip="Stereo spread of the echoes: 0 mono, 127 wide." label="Width" value={s.delay.width} onCommit={(v) => p.onEdit({ sound: { delay: { width: v } } }, `delay width ${v}`)} />
          <Slider tip="How smoothly the delay time glides when it changes." label="Slew" value={s.delay.slew} onCommit={(v) => p.onEdit({ sound: { delay: { slew: v } } }, `delay slew ${v}`)} />
          <label>Left:right
            <select data-tip="Left and right echo times as a ratio, for ping-pong patterns; OFF silences one side." value={s.delay.ratio} onChange={(e) => p.onEdit({ sound: { delay: { ratio: Number(e.target.value) } } }, `delay ratio ${DELAY_RATIOS[Number(e.target.value)]}`)}>
              {DELAY_RATIOS.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
        </fieldset>
        <fieldset className="fx-panel">
          <legend>FX</legend>
          <label data-tip="Turn the reverb and delay off for the whole project, keeping their settings."><input type="checkbox" checked={s.fxBypass} onChange={(e) => p.onEdit({ sound: { fxBypass: e.target.checked } }, e.target.checked ? "FX bypass on" : "FX bypass off")} /> Bypass reverb and delay</label>
        </fieldset>
      </div>

      <h2>Sidechains</h2>
      <div className="fx-panels">
        {BLOCK_TRACKS.map((name, t) => {
          const c = s.sidechains[t]!;
          const set = (k: "attack" | "hold" | "decay" | "depth", v: number): void => p.onEdit({ sound: { sidechains: at4(t, { [k]: v }) } }, `${name} sidechain ${k} ${v}`);
          return (
            <fieldset key={name} className="fx-panel" style={trackStyle(name)}>
              <legend>{name}</legend>
              <label>Triggered by
                <select data-tip="Which drum ducks this track (pumping), or Off." value={Math.min(4, c.source)} onChange={(e) => p.onEdit({ sound: { sidechains: at4(t, { source: Number(e.target.value) }) } }, `${name} sidechain from ${SIDECHAIN_SOURCES[Number(e.target.value)]}`)}>
                  {SIDECHAIN_SOURCES.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </select>
              </label>
              <Slider tip="How far the track is turned down on each hit; 0 = no ducking." label="Depth" value={c.depth} onCommit={(v) => set("depth", v)} />
              <Slider tip="How fast the ducking comes in after a hit." label="Attack" value={c.attack} onCommit={(v) => set("attack", v)} />
              <Slider tip="How long the track stays ducked." label="Hold" value={c.hold} onCommit={(v) => set("hold", v)} />
              <Slider tip="How fast the track comes back up." label="Decay" value={c.decay} onCommit={(v) => set("decay", v)} />
            </fieldset>
          );
        })}
      </div>
      <p className="hint">Mute and solo change what plays here only; they are not saved in the project.</p>
    </section>
  );
}

/** A 4-entry list edit (drums, sidechains) that changes entry `k` only. */
function at4<T>(k: number, v: T): (T | null)[] {
  return [0, 1, 2, 3].map((i) => (i === k ? v : null));
}
