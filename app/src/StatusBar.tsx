// The bottom line: what just happened (files by name, with Reveal), what is playing, the
// keyboard readout, and a one-time hint when there is no MIDI output. Ordinary messages fade after
// a while (Fast/SmoothIn, an exit; at once under reduced motion); errors stay.
import { useEffect, useState } from "react";
import { bridge } from "./desk.ts";
import type { Status } from "./hooks.ts";
import { remember, remembered } from "./storage.ts";
import type { KeyPlayer, KeySound } from "./useKeyboardPlayer.ts";
import type { Player } from "./usePlayer.ts";

const NO_MIDI_HINT = "circuit-desk.hint.no-midi";
const fileName = (path: string): string => path.split("/").pop() ?? path;
const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function playingLabel(p: Player): string {
  if (!p.playing) return "";
  const f = p.playFrom;
  return f.kind === "scenes" ? "Playing the scene chain" : f.kind === "scene" ? `Playing scene ${f.n}` : f.kind === "pattern" ? `Playing pattern ${f.n} on all tracks` : "Playing the current chains";
}

export function StatusBar({ status, fading, onFaded, player, keys, keySound }: {
  status: Status;
  fading: boolean;
  onFaded: () => void;
  player: Player;
  keys: KeyPlayer;
  keySound: KeySound | null;
}) {
  const [hintGone, setHintGone] = useState(() => remembered(NO_MIDI_HINT) === "dismissed");
  useEffect(() => { if (fading && reducedMotion()) onFaded(); }, [fading, onFaded]);
  const text = status.path ? status.text.split(status.path).join(fileName(status.path)) : status.text;
  const dest = keySound?.previewOnly || !player.liveOutput() ? "preview" : "MIDI out";
  return (
    <footer className="statusbar">
      <span role="status" aria-live="polite" className={status.error ? "error" : undefined} data-tip={status.path}
        data-state={fading ? "leaving" : undefined} onAnimationEnd={(e) => { if (e.animationName === "status-out") onFaded(); }}>{text}</span>
      {status.path && !fading && (
        <button type="button" className="btn btn-small" onClick={() => void bridge().reveal(status.path!)} data-tip={`Show ${fileName(status.path)} in the Finder.`}>Reveal</button>
      )}
      {player.error && <span role="alert" className="error">{player.error}</span>}
      {keys.error && <span role="alert" className="error">{keys.error}</span>}
      <span className="status-end">
        {!player.error && player.ports.length <= 1 && !hintGone && (
          <span className="status-hint">
            No MIDI outputs: playback uses the built-in preview.
            <button type="button" className="btn btn-small" aria-label="Dismiss the MIDI output hint"
              data-tip="To play to your Circuit or Live, connect the Circuit or turn on the IAC Driver in Audio MIDI Setup."
              onClick={() => { remember(NO_MIDI_HINT, "dismissed"); setHintGone(true); }}>Dismiss</button>
          </span>
        )}
        <span>{playingLabel(player)}</span>
        <span className="keys-status" aria-live="polite"
          data-tip={keys.on ? "Z/X change octave, C/V velocity, Esc turns Keys off." : undefined}>
          {keys.on && keySound ? `Keys: ${keySound.label} · ${dest} · C${keys.octave} · vel ${keys.velocity}` : ""}
        </span>
      </span>
    </footer>
  );
}
