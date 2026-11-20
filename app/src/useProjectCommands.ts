// What the toolbar and the menu do to the open project as a whole: undo and redo, save a copy, the
// exports, and the sound capture. Each reports in the status line and reveals the file it wrote.
import { useCallback } from "react";
import { encodeWav, renderOffline } from "@circuit-desk/engine";
import appPackage from "../package.json";
import { novaRender } from "./audio.ts";
import { buildReport } from "./capture.ts";
import { bridge, call, type Summary } from "./desk.ts";
import type { Firmware, Status } from "./hooks.ts";
import type { KeySound } from "./useKeyboardPlayer.ts";
import type { Player } from "./usePlayer.ts";

export interface CommandContext {
  projectId: string | null;
  summary: Summary | null;
  firmware: Firmware | null;
  player: Player;
  keySound: KeySound | null;
  view: string;
  track: string;
  patchSynth: 1 | 2;
  setStatus: (s: Status) => void;
  fail: (e: unknown) => void;
  bump: () => void;
}

export function useProjectCommands(c: CommandContext) {
  const { projectId, setStatus, fail, bump } = c;
  const reveal = (path: string): void => { void bridge().reveal(path); };

  const undo = useCallback(async (redo = false) => {
    if (!projectId) return;
    try {
      const done = redo ? await call("redo", projectId) : await call("undo", projectId);
      setStatus({ text: done ? (redo ? "Redone" : "Undone") : redo ? "Nothing to redo" : "Nothing to undo" });
      bump();
    } catch (e) { fail(e); }
  }, [projectId, setStatus, fail, bump]);

  const saveCopy = useCallback(async () => {
    if (!projectId) return;
    try { const path = await call("saveCopy", projectId); setStatus({ text: `Saved a copy: ${path}`, path }); reveal(path); } catch (e) { fail(e); }
  }, [projectId, setStatus, fail]);

  const exportTo = useCallback(async (kind: "midi" | "als") => {
    if (!projectId) return;
    try {
      const r = kind === "midi" ? await call("exportMidi", projectId) : await call("exportAls", projectId);
      const playAlong = (r as { playAlong?: string }).playAlong;
      const along = playAlong ? ` and ${playAlong.split("/").pop()}` : "";
      setStatus({ text: `Exported ${r.path}${along}${r.notes.length ? ` (${r.notes.join("; ")})` : ""}`, path: r.path });
      reveal(r.path);
    } catch (e) { fail(e); }
  }, [projectId, setStatus, fail]);

  const fx = c.player.fx;
  const ownSynth = c.firmware?.current.midiTracks === "own-synth";
  const exportAudio = useCallback(async () => {
    if (!projectId) return;
    try {
      setStatus({ text: "Rendering the preview…" });
      const a = await call("arrangement", projectId, { source: "current" });
      const pack = await call("packSamples", projectId);
      const buf = await renderOffline(a, pack.drums, (i) => call("sampleData", projectId, i), await novaRender(projectId), await call("soundSettings", projectId), fx);
      const wav = encodeWav(Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch)), buf.sampleRate);
      const { path } = await call("saveAudio", projectId, wav);
      const midi = ownSynth ? "MIDI 1/2 own synths are not emulated yet (stand-ins)" : "MIDI 1/2 are stand-ins for external gear";
      setStatus({ text: `Exported ${path} (built-in preview: drums from the pack; Synth 1/2 play their own patches on a first Nova voice; ${midi})`, path });
      reveal(path);
    } catch (e) { fail(e); }
  }, [projectId, fx, ownSynth, setStatus, fail]);

  const { patchSynth } = c;
  const exportSyx = useCallback(async () => {
    if (!projectId) return;
    try {
      const { path } = await call("exportPatchSyx", projectId, patchSynth);
      setStatus({ text: `Exported Synth ${patchSynth}'s patch as ${path} (a file only; nothing was sent to a device)`, path });
      reveal(path);
    } catch (e) { fail(e); }
  }, [projectId, patchSynth, setStatus, fail]);

  /** Saves the last 10 seconds of sound with its events and patches, for finding a glitch. */
  const capture = async (): Promise<void> => {
    try {
      setStatus({ text: "Capturing the last 10 seconds…" });
      const synthPatches = projectId ? await call("synthPatches", projectId) : null;
      const k = c.keySound;
      const r = await buildReport({
        appVersion: appPackage.version,
        firmware: c.firmware?.current.id ?? null,
        project: c.summary?.path ?? null,
        view: c.view, track: c.track,
        output: c.player.portId,
        keys: k ? { label: k.label, channel: k.channel, previewOnly: k.previewOnly, patch: k.patch ? Array.from(k.patch) : null } : null,
        synthPatches,
      });
      const { path } = await call("saveReport", r.json, r.wav);
      setStatus({ path, text: r.events === 0
        ? `Saved a sound report in ${path}, but nothing played in the last 10 seconds: play the glitch, then capture right after.`
        : `Saved a sound report (${r.seconds.toFixed(1)} s, ${r.events} events) in ${path}. Say what you heard and roughly when.` });
      reveal(path);
    } catch (e) { fail(e); }
  };

  return { undo, saveCopy, exportTo, exportAudio, exportSyx, capture };
}
