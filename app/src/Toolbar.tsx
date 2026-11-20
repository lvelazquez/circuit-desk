// The window's top bar: title and project, the view switcher, the transport and the file actions.
import type { Scenes, Summary } from "./desk.ts";
import type { Firmware } from "./hooks.ts";
import type { KeySound } from "./useKeyboardPlayer.ts";
import { parsePlayFrom, playFromValue, type Player } from "./usePlayer.ts";
import { VIEWS, VIEW_TIPS, type View } from "./views.ts";

export interface ToolbarProps {
  summary: Summary | null;
  projectId: string | null;
  scenes: Scenes | null;
  view: View;
  onView: (v: View) => void;
  player: Player;
  keys: { on: boolean; setOn: (on: boolean) => void };
  keySound: KeySound | null;
  firmware: Firmware | null;
  onFirmware: (id: string) => void;
  onOpen: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSaveCopy: () => void;
  onExport: (kind: "midi" | "als") => void;
}

export function Toolbar(p: ToolbarProps) {
  const { summary, player, firmware } = p;
  return (
    <header className="toolbar">
      <h1>Circuit Desk</h1>
      <span className="project-name">{summary ? `${summary.name} · ${summary.tempo.value} BPM${summary.edits ? ` · ${summary.edits} edits` : ""}` : "No project"}</span>
      <div role="group" aria-label="View" className="row">
        {VIEWS.map((v) => <button key={v.id} type="button" className="btn" aria-pressed={p.view === v.id} data-tip={`${VIEW_TIPS[v.id]} ⌘1 goes to the next view.`} onClick={() => p.onView(v.id)}>{v.label}</button>)}
      </div>
      <div role="group" aria-label="Transport" className="row">
        <button type="button" className="btn" aria-pressed={player.playing} disabled={!p.projectId} data-tip="Play or stop (⌘↩). Plays what the menu beside it says, to the output chosen after it. Edits made while playing are heard at once."
          onClick={() => (player.playing ? player.stop() : void player.play())}>{player.playing ? "■ Stop" : "▶ Play"}</button>
        <label className="visually-hidden" htmlFor="play-from">What plays</label>
        <select id="play-from" value={playFromValue(player.playFrom)} disabled={!p.projectId} onChange={(e) => player.choosePlayFrom(parsePlayFrom(e.target.value))}
          data-tip="What Play plays: the current pattern chains, the scene chain, one scene, or one pattern on every track. Changing it while playing starts the new part from its beginning.">
          <option value="current">Current patterns</option>
          <option value="scenes">Scene chain</option>
          <optgroup label="One scene">
            {Array.from({ length: 16 }, (_, i) => <option key={i} value={`scene:${i + 1}`}>Scene {i + 1}{p.scenes?.scenes[i]?.saved ? " •" : ""}</option>)}
          </optgroup>
          <optgroup label="One pattern, all tracks">
            {Array.from({ length: 8 }, (_, i) => <option key={i} value={`pattern:${i + 1}`}>Pattern {i + 1}</option>)}
          </optgroup>
        </select>
        <label className="visually-hidden" htmlFor="midi-out">MIDI output</label>
        <select id="midi-out" value={player.portId ?? ""} onChange={(e) => player.choosePort(e.target.value)}
          data-tip="Where playback goes. Built-in preview: the app's own sound (pack drums, Synth 1/2 patches, approximate FX). A MIDI port: your Circuit (load the same project on it) or Live through the IAC bus.">
          <option value="">{player.ports.length ? "MIDI output…" : "No MIDI outputs"}</option>
          {player.ports.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <label className="visually-hidden" htmlFor="play-target">Plays to (Circuit, or the Live play-along set)</label>
        <select id="play-target" value={player.target} onChange={(e) => player.chooseTarget(e.target.value === "live" ? "live" : "circuit")}
          data-tip="Which channels and notes playback uses on a MIDI port. Circuit: the device's defaults. Live set: the exported play-along set's (drums on channels 10–13, kit keys).">
          <option value="circuit">→ Circuit</option>
          <option value="live">→ Live set</option>
        </select>
        <label data-tip="Also send MIDI clock with start and stop, so the device or Live follows the app's tempo. Set before pressing Play."><input type="checkbox" checked={player.clock} disabled={player.playing} onChange={(e) => player.setClock(e.target.checked)} /> Clock</label>
        <button type="button" className="btn" aria-pressed={player.fx} disabled={player.portId !== "preview"}
          data-tip="Built-in preview only. On: track levels and pans, sidechains, drum knobs, patch distortion, EQ and chorus, reverb and delay. Off: every track dry, to compare. Reverb, delay, chorus and distortion are approximations."
          onClick={() => player.setFx(!player.fx)}>FX {player.fx ? "on" : "off"}</button>
        <button type="button" className="btn" aria-pressed={p.keys.on} disabled={!p.keySound}
          data-tip="Play the current synth sound (or the chosen pack patch) from the computer keyboard: A to ; are notes, W E T Y U O P sharps, Z/X octave, C/V velocity, Esc turns it off. Playing keys never edits the project."
          onClick={() => p.keys.setOn(!p.keys.on)}>⌨ Keys</button>
      </div>
      <label className="visually-hidden" htmlFor="firmware">Firmware on your Circuit Tracks</label>
      <select id="firmware" value={firmware?.current.id ?? ""} disabled={!firmware} onChange={(e) => p.onFirmware(e.target.value)}
        data-tip={firmware ? `The firmware on your Circuit Tracks: ${firmware.current.name} ${firmware.current.versions}. ${firmware.current.description} It decides what the MIDI tracks and CIRCUIT-HACKS data mean.` : "The firmware on your Circuit Tracks."}>
        {firmware?.available.map((f) => <option key={f.id} value={f.id}>{f.short}</option>)}
      </select>
      <button type="button" className="btn" onClick={p.onOpen} data-tip="Open a project file (.ncs) from anywhere (⌘O). The library on the left lists your card copy.">Open…</button>
      <button type="button" className="btn" disabled={!summary?.edits} onClick={p.onUndo} data-tip="Undo the last edit to this project (⌘Z). Every edit, from the app or from Claude over MCP, is in the same history.">Undo</button>
      <button type="button" className="btn" disabled={!summary?.canRedo} onClick={p.onRedo} data-tip="Redo the last undone edit (⇧⌘Z).">Redo</button>
      <button type="button" className="btn" disabled={!p.projectId} onClick={p.onSaveCopy} data-tip="Write the edited project as a new file in ~/Circuit Desk/Copies (⌘S). The original file and the SD card are never changed.">Save a copy</button>
      <button type="button" className="btn" disabled={!p.projectId} onClick={() => p.onExport("midi")} data-tip="Export a multitrack MIDI file of the arrangement, with automation as CC, to ~/Circuit Desk/Exports.">Export MIDI</button>
      <button type="button" className="btn" disabled={!p.projectId} onClick={() => p.onExport("als")} data-tip="Export an Ableton Live 12 set: patterns as Session clips, scenes as scenes, the arrangement as clips; plus a play-along set that listens to the app over the IAC bus.">Export Live set</button>
    </header>
  );
}
