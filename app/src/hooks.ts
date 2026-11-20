// App-level state that is not about one view: the firmware choice, what the computer keyboard
// plays, and the status line. Each was inline in App.tsx.
import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackName } from "@circuit-desk/core-service";
import { patchName } from "@circuit-desk/patch";
import { call } from "./desk.ts";
import type { PackPatchChoice } from "./PackView.tsx";
import { remember, remembered } from "./storage.ts";
import { NOTE_TRACKS, isNoteTrack } from "./tracks.ts";
import type { KeySound } from "./useKeyboardPlayer.ts";

export type Firmware = Awaited<ReturnType<typeof call<"firmware">>>;
const FIRMWARE_KEY = "circuit-desk.firmware";

/** A status-line message. `path`: a file the message is about (shown by name, with Reveal). */
export interface Status { text: string; error?: boolean; path?: string }
/** How long an ordinary message stays before it fades; errors stay until the next message. */
const STATUS_MS = 6000;

/** The status line: messages fade after a while, errors stay. */
export function useStatus(initial: string) {
  const [status, setStatusNow] = useState<Status>({ text: initial });
  const [fading, setFading] = useState(false);
  const timer = useRef(0);
  const setStatus = useCallback((s: Status) => {
    window.clearTimeout(timer.current);
    setFading(false);
    setStatusNow(s);
    if (!s.error && s.text) timer.current = window.setTimeout(() => setFading(true), STATUS_MS);
  }, []);
  /** The fade (Fast/SmoothIn, an exit) has finished: clear the message. */
  const faded = useCallback(() => { setFading(false); setStatusNow({ text: "" }); }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const fail = useCallback((e: unknown) => setStatus({ text: (e as Error).message, error: true }), [setStatus]);
  return { status, fading, faded, setStatus, fail };
}

/** The firmware on the user's device: remembered here, held by the service (validation, MCP). */
export function useFirmware(onChanged: (f: Firmware["current"]) => void, fail: (e: unknown) => void) {
  const [firmware, setFirmware] = useState<Firmware | null>(null);
  const read = useCallback(() => { void call("firmware").then(setFirmware, fail); }, [fail]);
  useEffect(() => {
    const saved = remembered(FIRMWARE_KEY);
    void (saved ? call("setFirmware", saved).catch(() => undefined) : Promise.resolve()).then(read);
  }, [read]);
  const choose = (id: string): void => {
    void call("setFirmware", id).then((f) => { remember(FIRMWARE_KEY, f.id); read(); onChanged(f); }, fail);
  };
  return { firmware, choose, read };
}

/** What the computer keyboard plays: the chosen pack patch, else the current note track's sound. */
export function useKeySound(projectId: string | null, track: TrackName, packChoice: PackPatchChoice | null, version: number,
  firmware: Firmware | null, fail: (e: unknown) => void): KeySound | null {
  const [keySound, setKeySound] = useState<KeySound | null>(null);
  const ownSynth = firmware?.current.midiTracks === "own-synth";
  useEffect(() => {
    if (!projectId) { setKeySound(null); return; }
    let live = true;
    void (async () => {
      try {
        if (packChoice) {
          const bytes = Uint8Array.from(await call("packPatch", projectId, packChoice.bank, packChoice.record));
          if (live) setKeySound({ label: `Pack bank ${packChoice.bank + 1} · ${packChoice.name}`, patch: bytes, channel: 0, previewOnly: true });
          return;
        }
        const t = isNoteTrack(track) ? track : "Synth 1";
        const channel = NOTE_TRACKS.indexOf(t);
        if (channel < 2) {
          const p = await call("synthPatches", projectId);
          const bytes = Uint8Array.from(channel === 0 ? p.synth1 : p.synth2);
          if (live) setKeySound({ label: `${t} · ${patchName(bytes) || "unnamed"}`, patch: bytes, channel, previewOnly: false });
        } else if (live) {
          setKeySound({ label: `${t} · ${ownSynth ? "own synth (not emulated: simple sound)" : "external MIDI (simple sound here)"}`, patch: null, channel, previewOnly: false });
        }
      } catch (e) { if (live) fail(e); }
    })();
    return () => { live = false; };
  }, [projectId, track, packChoice, version, ownSynth, fail]);
  return keySound;
}
