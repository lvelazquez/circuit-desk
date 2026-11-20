// The window's top bar, one row: the project, the views (Sequence · Sound · Song), the transport
// with its Playback settings, Keys, Undo/Redo and Export. Opening and saving copies are in the
// File menu (⌘O, ⌘S).
import type { Scenes, Summary } from "./desk.ts";
import type { Firmware } from "./hooks.ts";
import { Popover } from "./ui/Popover.tsx";
import type { KeySound } from "./useKeyboardPlayer.ts";
import { parsePlayFrom, playFromValue, type Player } from "./usePlayer.ts";
import { VIEWS, type View } from "./views.ts";

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
  onUndo: () => void;
  onRedo: () => void;
  onExport: (kind: "midi" | "als" | "audio" | "syx") => void;
  /** Which synth Export › Synth patch writes. */
  patchSynth: 1 | 2;
}

const GROUPS = ["Sequence", "Sound", "Song"] as const;

export function Toolbar(p: ToolbarProps) {
  const { summary, player, firmware } = p;
  const project = summary ? `${summary.name} · ${summary.tempo.value} BPM${summary.edits ? ` · ${summary.edits} edit${summary.edits > 1 ? "s" : ""}` : ""}` : "No project";
  return (
    <header className="toolbar" id="toolbar">
      <a className="skip-link" href="#workspace" onClick={(e) => { e.preventDefault(); document.getElementById("workspace")?.focus(); }}>Skip to workspace</a>
      <h1 className="visually-hidden">Circuit Desk</h1>
      <span className="project-name" data-tip={summary ? `${project}. ${summary.path}` : "Open a project from the library or File › Open Project… (⌘O)."}>{project}</span>

      <nav aria-label="Views" className="view-switch">
        {GROUPS.map((g) => (
          <div key={g} role="group" aria-label={g} className="row">
            {VIEWS.filter((v) => v.group === g).map((v) => {
              const n = VIEWS.indexOf(v) + 1;
              return <button key={v.id} type="button" className="btn" aria-pressed={p.view === v.id} aria-keyshortcuts={`Meta+${n}`}
                data-tip={`${v.tip} (⌘${n})`} onClick={() => p.onView(v.id)}>{v.label}</button>;
            })}
          </div>
        ))}
      </nav>

      <div role="group" aria-label="Transport" className="row">
        <button type="button" className="btn" aria-pressed={player.playing} disabled={!p.projectId} aria-keyshortcuts="Meta+Enter"
          data-tip="Play or stop (⌘↩). Plays what the menu beside it says. Edits made while playing are heard at once."
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
        <Popover label="Playback ▾" tip="Where playback goes and how: the output, MIDI channels, clock, the preview's effects, and your Circuit's firmware.">
          {() => (
            <>
              <label>Output
                <select id="midi-out" value={player.portId ?? ""} onChange={(e) => player.choosePort(e.target.value)}
                  data-tip="Built-in preview: the app's own sound (pack drums, Synth 1/2 patches, approximate effects). A MIDI port: your Circuit (load the same project on it) or Live through the IAC bus.">
                  <option value="">{player.ports.length ? "Choose an output…" : "No MIDI outputs"}</option>
                  {player.ports.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label>Channels and notes
                <select id="play-target" value={player.target} onChange={(e) => player.chooseTarget(e.target.value === "live" ? "live" : "circuit")}
                  data-tip="Which channels and notes playback uses on a MIDI port. Circuit: the device's defaults. Live set: the exported play-along set's (drums on channels 10–13, kit keys).">
                  <option value="circuit">For the Circuit</option>
                  <option value="live">For the Live play-along set</option>
                </select>
              </label>
              <label className="check" data-tip="Also send MIDI clock with start and stop, so the device or Live follows the app's tempo. Set before pressing Play.">
                <input type="checkbox" checked={player.clock} disabled={player.playing} onChange={(e) => player.setClock(e.target.checked)} /> Send MIDI clock
              </label>
              <button type="button" className="btn" aria-pressed={player.fx} disabled={player.portId !== "preview"}
                data-tip="Built-in preview only. On: track levels and pans, sidechains, drum knobs, patch distortion, EQ and chorus, reverb and delay. Off: every track dry, to compare. Reverb, delay, chorus and distortion are approximations."
                onClick={() => player.setFx(!player.fx)}>Preview FX {player.fx ? "on" : "off"}</button>
              <label>Your Circuit's firmware
                <select id="firmware" value={firmware?.current.id ?? ""} disabled={!firmware} onChange={(e) => p.onFirmware(e.target.value)}
                  data-tip={firmware ? `${firmware.current.name} ${firmware.current.versions}. ${firmware.current.description} It decides what the MIDI tracks and CIRCUIT-HACKS data mean.` : "The firmware on your Circuit Tracks."}>
                  {firmware?.available.map((f) => <option key={f.id} value={f.id}>{f.short}</option>)}
                </select>
              </label>
            </>
          )}
        </Popover>
        <button type="button" className="btn" aria-pressed={p.keys.on} disabled={!p.keySound} aria-keyshortcuts="Meta+K"
          data-tip="Play the current synth's patch (or the chosen pack patch) from the computer keyboard (⌘K): A to ; are notes, W E T Y U O P sharps, Z/X octave, C/V velocity, Esc turns it off. Playing keys never edits the project."
          onClick={() => p.keys.setOn(!p.keys.on)}>⌨ Keys</button>
      </div>

      <div role="group" aria-label="History" className="row">
        <button type="button" className="btn" disabled={!summary?.edits} onClick={p.onUndo} aria-keyshortcuts="Meta+Z" data-tip="Undo the last edit to this project (⌘Z). Edits from the app and from Claude over MCP share one history.">Undo</button>
        <button type="button" className="btn" disabled={!summary?.canRedo} onClick={p.onRedo} aria-keyshortcuts="Shift+Meta+Z" data-tip="Redo the last undone edit (⇧⌘Z).">Redo</button>
      </div>

      <Popover label="Export ▾" align="end" tip="Export the project to ~/Circuit Desk/Exports: a MIDI file, a Live set, the preview as audio, or a synth patch.">
        {(close) => (
          <>
            {([
              ["midi", "MIDI file", "A multitrack MIDI file of the arrangement, with automation as CC (⌘E)."],
              ["als", "Live set", "An Ableton Live 12 set: patterns as Session clips, scenes as scenes, the arrangement as clips; plus a play-along set that listens to the app over the IAC bus (⇧⌘E)."],
              ["audio", "Preview audio (WAV)", "The arrangement as heard on the built-in preview, as a WAV file (⌥⌘E)."],
              ["syx", `Synth ${p.patchSynth} patch (.syx)`, `Synth ${p.patchSynth}'s patch as a .syx file, Novation's portable patch format. Nothing is sent to a device (⌥⌘P).`],
            ] as const).map(([kind, label, tip]) => (
              <button key={kind} type="button" className="btn menu-item" disabled={!p.projectId} data-tip={tip} onClick={() => { close(); p.onExport(kind); }}>{label}</button>
            ))}
          </>
        )}
      </Popover>
    </header>
  );
}
