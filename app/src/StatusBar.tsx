// The bottom line: what just happened (or went wrong), the output hint, and the keyboard readout.
import type { Status } from "./hooks.ts";
import type { KeyPlayer, KeySound } from "./useKeyboardPlayer.ts";
import type { Player } from "./usePlayer.ts";

export function StatusBar({ status, player, keys, keySound, onCapture }: {
  status: Status;
  player: Player;
  keys: KeyPlayer;
  keySound: KeySound | null;
  onCapture: () => void;
}) {
  return (
    <footer className="statusbar">
      <button type="button" className="btn btn-small" onClick={onCapture}
        data-tip="Heard a glitch? Save the last 10 seconds of sound with the notes and patches that made it (⇧⌘R), to Exports/Reports, so it can be replayed and found.">⏺ Capture sound</button>
      <span role="status" aria-live="polite" className={status.error ? "error" : undefined}>{status.text}</span>
      {player.error && <span role="alert" className="error">{player.error}</span>}
      {!player.error && player.ports.length <= 1 && (
        <span>No MIDI outputs: the built-in preview plays here; for the Circuit or Live, connect it or turn on the IAC Driver.</span>
      )}
      <span>{player.playing ? "Playing the current chains" : ""}</span>
      {keys.error && <span role="alert" className="error">{keys.error}</span>}
      <span className="keys-status" aria-live="polite">
        {keys.on && keySound ? `Keys: ${keySound.label} · ${keySound.previewOnly || !player.liveOutput() ? "preview" : "MIDI out"} · octave C${keys.octave} · velocity ${keys.velocity} (Z/X, C/V, Esc)` : ""}
      </span>
    </footer>
  );
}
