// The window: library on the left, the Circuit or Editor view in the middle, the inspector on the
// right. All project state lives in the main process; this keeps only what is on screen and
// reloads it after every edit.
import { useCallback, useEffect, useState } from "react";
import type { DrumStepIn, DrumTrackName, NoteStepIn, SyncRate, TrackName } from "@circuit-desk/core-service";
import type { MenuCommand } from "../electron/api.ts";
import { CircuitView } from "./CircuitView.tsx";
import { bridge, call, type DrumPatternData, type Listing, type PatternData, type Scenes, type Summary } from "./desk.ts";
import { DrumGrid, PianoRoll } from "./EditorView.tsx";
import { Inspector } from "./Inspector.tsx";
import { Library } from "./Library.tsx";
import { PackView } from "./PackView.tsx";
import { ScenesView } from "./ScenesView.tsx";
import { DRUM_NAMES, isDrum, isNoteTrack, TRACK_NAMES } from "./tracks.ts";
import { encodeWav, renderOffline } from "@circuit-desk/engine";
import { novaRender } from "./audio.ts";
import { buildReport } from "./capture.ts";
import appPackage from "../package.json";
import { parsePlayFrom, playFromValue, usePlayer } from "./usePlayer.ts";
import { useKeyboardPlayer, type KeySound } from "./useKeyboardPlayer.ts";
import type { PackPatchChoice } from "./PackView.tsx";
import { patchName } from "@circuit-desk/patch";

type View = "circuit" | "editor" | "scenes" | "pack";
type Firmware = Awaited<ReturnType<typeof call<"firmware">>>;
const FIRMWARE_KEY = "circuit-desk.firmware";
function remembered(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function remember(key: string, v: string): void { try { localStorage.setItem(key, v); } catch { /* a per-viewer convenience only */ } }
interface Status { text: string; error?: boolean }

const isTextField = (el: Element | null): boolean => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

export function App() {
  const [library, setLibrary] = useState<Listing[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [track, setTrack] = useState<TrackName>("Synth 1");
  const [pattern, setPattern] = useState(1);
  const [data, setData] = useState<PatternData | null>(null);
  const [drums, setDrums] = useState<DrumPatternData[]>([]);
  const [scenes, setScenes] = useState<Scenes | null>(null);
  const [view, setView] = useState<View>("circuit");
  const [step, setStep] = useState<number | null>(null);
  const [drumSel, setDrumSel] = useState<{ drum: DrumTrackName; step: number } | null>(null);
  const [page, setPage] = useState<0 | 1>(0);
  const [octave, setOctave] = useState(48);
  const [currentNote, setCurrentNote] = useState(60);
  const [status, setStatus] = useState<Status>({ text: "Open a project from the library." });
  const [version, setVersion] = useState(0);

  const fail = (e: unknown): void => setStatus({ text: (e as Error).message, error: true });
  const player = usePlayer(projectId, version);

  // Firmware the device runs: remembered here, held by the service (validation, MCP).
  const [firmware, setFirmware] = useState<Firmware | null>(null);
  const readFirmware = useCallback(() => { void call("firmware").then(setFirmware, fail); }, []);
  useEffect(() => {
    const saved = remembered(FIRMWARE_KEY);
    void (saved ? call("setFirmware", saved).catch(() => undefined) : Promise.resolve()).then(readFirmware);
  }, [readFirmware]);
  const chooseFirmware = (id: string): void => {
    void call("setFirmware", id).then((f) => {
      remember(FIRMWARE_KEY, f.id);
      readFirmware();
      setVersion((v) => v + 1);
      setStatus({ text: `Firmware: ${f.name} ${f.versions}. ${f.description}` });
    }, fail);
  };

  // What the computer keyboard plays: the chosen pack patch, else the current note track's sound.
  const [packChoice, setPackChoice] = useState<PackPatchChoice | null>(null);
  const [keySound, setKeySound] = useState<KeySound | null>(null);
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
        const channel = (["Synth 1", "Synth 2", "MIDI 1", "MIDI 2"] as const).indexOf(t);
        if (channel < 2) {
          const p = await call("synthPatches", projectId);
          const bytes = Uint8Array.from(channel === 0 ? p.synth1 : p.synth2);
          if (live) setKeySound({ label: `${t} · ${patchName(bytes) || "unnamed"}`, patch: bytes, channel, previewOnly: false });
        } else if (live) {
          const own = firmware?.current.midiTracks === "own-synth";
          setKeySound({ label: `${t} · ${own ? "own synth not emulated yet: stand-in" : "external MIDI: stand-in on the preview"}`, patch: null, channel, previewOnly: false });
        }
      } catch (e) { if (live) fail(e); }
    })();
    return () => { live = false; };
  }, [projectId, track, packChoice, version, firmware]);
  const keys = useKeyboardPlayer(keySound, player.liveOutput);
  const choosePackPatch = (p: PackPatchChoice): void => { setPackChoice(p); window.setTimeout(() => void keys.audition(), 0); };
  /** The step playing on `t`, if it is playing the pattern on screen. */
  const playStep = (t: TrackName): number | null => {
    const h = player.heads[TRACK_NAMES.indexOf(t as (typeof TRACK_NAMES)[number])];
    return h && h.pattern === pattern ? h.step : null;
  };

  useEffect(() => {
    void (async () => {
      try {
        setLibrary(await call("listProjects"));
      } catch (e) { setStatus({ text: `Library: ${(e as Error).message}`, error: true }); }
      try {
        const open = await call("openProjects");
        if (open[0]) setProjectId(open[0].id);
      } catch (e) { fail(e); }
    })();
  }, []);

  // Reload what is on screen whenever the project, track, pattern or an edit changes.
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void (async () => {
      try {
        const [s, d, sc, ds] = await Promise.all([
          call("summary", projectId), call("getPattern", projectId, track, pattern), call("getScenes", projectId),
          Promise.all(DRUM_NAMES.map((n) => call("getPattern", projectId, n, pattern))),
        ]);
        if (!live) return;
        setSummary(s); setData(d); setScenes(sc); setDrums(ds.filter((x): x is DrumPatternData => x.kind === "drums"));
      } catch (e) { if (live) fail(e); }
    })();
    return () => { live = false; };
  }, [projectId, track, pattern, version]);

  const open = useCallback(async (path: string) => {
    try {
      const { id } = await call("openProject", path);
      setProjectId(id); setStep(null); setDrumSel(null);
      setStatus({ text: `Opened ${path.split("/").pop() ?? path}` });
    } catch (e) { fail(e); }
  }, []);

  const edit = useCallback(async (label: string, f: () => Promise<unknown>) => {
    try {
      await f();
      setVersion((v) => v + 1);
      setStatus({ text: `Edited: ${label}` });
    } catch (e) { fail(e); }
  }, []);

  const onNoteSteps = (steps: NoteStepIn[], label: string): void => {
    if (projectId && isNoteTrack(track)) void edit(label, () => call("setSteps", projectId, track, pattern, steps));
  };
  const onDrumSteps = (drum: DrumTrackName, steps: DrumStepIn[], label: string): void => {
    if (projectId) void edit(label, () => call("setDrumSteps", projectId, drum, pattern, steps));
  };
  const onChain = (first: number, last: number): void => {
    if (projectId) void edit(`${track} chain ${first}–${last}`, () => call("setChain", projectId, track, first, last));
  };

  const undo = useCallback(async (redo = false) => {
    if (!projectId) return;
    try {
      const done = redo ? await call("redo", projectId) : await call("undo", projectId);
      setStatus({ text: done ? (redo ? "Redone" : "Undone") : redo ? "Nothing to redo" : "Nothing to undo" });
      setVersion((v) => v + 1);
    } catch (e) { fail(e); }
  }, [projectId]);

  const saveCopy = useCallback(async () => {
    if (!projectId) return;
    try { const path = await call("saveCopy", projectId); setStatus({ text: `Saved a copy: ${path}` }); void bridge().reveal(path); } catch (e) { fail(e); }
  }, [projectId]);

  const exportTo = useCallback(async (kind: "midi" | "als") => {
    if (!projectId) return;
    try {
      const r = kind === "midi" ? await call("exportMidi", projectId) : await call("exportAls", projectId);
      const playAlong = (r as { playAlong?: string }).playAlong;
      const along = playAlong ? ` and ${playAlong.split("/").pop()}` : "";
      setStatus({ text: `Exported ${r.path}${along}${r.notes.length ? ` (${r.notes.join("; ")})` : ""}` });
      void bridge().reveal(r.path);
    } catch (e) { fail(e); }
  }, [projectId]);

  /** Saves the last 10 seconds of sound with its events and patches, for finding a glitch. */
  const capture = useCallback(async () => {
    try {
      setStatus({ text: "Capturing the last 10 seconds…" });
      const synthPatches = projectId ? await call("synthPatches", projectId) : null;
      const r = await buildReport({
        appVersion: appPackage.version,
        firmware: firmware?.current.id ?? null,
        project: summary?.path ?? null,
        view, track,
        output: player.portId,
        keys: keySound ? { label: keySound.label, channel: keySound.channel, previewOnly: keySound.previewOnly, patch: keySound.patch ? Array.from(keySound.patch) : null } : null,
        synthPatches,
      });
      const { path } = await call("saveReport", r.json, r.wav);
      setStatus({ text: r.events === 0
        ? `Saved a sound report in ${path}, but nothing played in the last 10 seconds: play the glitch, then capture right after.`
        : `Saved a sound report (${r.seconds.toFixed(1)} s, ${r.events} events) in ${path}. Say what you heard and roughly when.` });
      void bridge().reveal(path);
    } catch (e) { fail(e); }
  }, [projectId, firmware, summary, view, track, player.portId, keySound]);

  const exportAudio = useCallback(async () => {
    if (!projectId) return;
    try {
      setStatus({ text: "Rendering the preview…" });
      const a = await call("arrangement", projectId, { source: "current" });
      const pack = await call("packSamples", projectId);
      const buf = await renderOffline(a, pack.drums, (i) => call("sampleData", projectId, i), await novaRender(projectId));
      const wav = encodeWav(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), buf.sampleRate);
      const { path } = await call("saveAudio", projectId, wav);
      const midi = firmware?.current.midiTracks === "own-synth" ? "MIDI 1/2 own synths are not emulated yet (stand-ins)" : "MIDI 1/2 are stand-ins for external gear";
      setStatus({ text: `Exported ${path} (built-in preview: drums from the pack; Synth 1/2 play their own patches on a first Nova voice; ${midi})` });
      void bridge().reveal(path);
    } catch (e) { fail(e); }
  }, [projectId, firmware]);

  const pick = useCallback(async () => {
    try { const p = await bridge().pickProject(); if (p) await open(p); } catch (e) { fail(e); }
  }, [open]);

  useEffect(() => {
    try {
      return bridge().onMenu((command: MenuCommand) => {
        const text = isTextField(document.activeElement);
        if (command === "undo") { if (text) document.execCommand("undo"); else void undo(); }
        else if (command === "redo") { if (text) document.execCommand("redo"); else void undo(true); }
        else if (command === "open") void pick();
        else if (command === "save-copy") void saveCopy();
        else if (command === "export-midi") void exportTo("midi");
        else if (command === "export-als") void exportTo("als");
        else if (command === "export-audio") void exportAudio();
        else if (command === "toggle-view") setView((v) => (v === "circuit" ? "editor" : v === "editor" ? "scenes" : v === "scenes" ? "pack" : "circuit"));
        else if (command === "changed") {
          // Claude edited or opened a project (or chose the firmware) through the MCP link.
          setVersion((v) => v + 1);
          readFirmware();
          void call("openProjects").then((o) => setProjectId((cur) => cur ?? o[0]?.id ?? null), fail);
        }
        else if (command === "play") { if (player.playing) player.stop(); else void player.play(); }
        else if (command === "capture") void capture();
      });
    } catch { return undefined; }
  }, [undo, pick, saveCopy, exportTo, exportAudio, player, readFirmware, capture]);

  const chooseTrack = (t: TrackName): void => { setTrack(t); setStep(null); setPackChoice(null); };
  const choosePattern = (n: number): void => { setPattern(n); setStep(null); setDrumSel(null); };
  const current = library.find((l) => l.path === summary?.path)?.path ?? summary?.path ?? null;
  const inspectorTrack: TrackName = view === "editor" && drumSel ? drumSel.drum : track;
  const inspectorData = view === "editor" && drumSel ? drums[DRUM_NAMES.indexOf(drumSel.drum)] ?? data : data;
  const inspectorStep = view === "editor" && drumSel ? drumSel.step : step;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>Circuit Desk</h1>
        <span className="project-name">{summary ? `${summary.name} · ${summary.tempo.value} BPM${summary.edits ? ` · ${summary.edits} edits` : ""}` : "No project"}</span>
        <div role="group" aria-label="View" className="row" style={{ margin: 0 }}>
          <button type="button" className="btn" aria-pressed={view === "circuit"} onClick={() => setView("circuit")}>Circuit</button>
          <button type="button" className="btn" aria-pressed={view === "editor"} onClick={() => setView("editor")}>Editor</button>
          <button type="button" className="btn" aria-pressed={view === "scenes"} onClick={() => setView("scenes")}>Scenes</button>
          <button type="button" className="btn" aria-pressed={view === "pack"} onClick={() => setView("pack")}>Pack</button>
        </div>
        <div role="group" aria-label="Transport" className="row" style={{ margin: 0 }}>
          <button type="button" className="btn" aria-pressed={player.playing} disabled={!projectId}
            onClick={() => (player.playing ? player.stop() : void player.play())}>{player.playing ? "■ Stop" : "▶ Play"}</button>
          <label className="visually-hidden" htmlFor="play-from">What plays</label>
          <select id="play-from" value={playFromValue(player.playFrom)} disabled={!projectId} onChange={(e) => player.choosePlayFrom(parsePlayFrom(e.target.value))}
            title="What the Play button plays. Changing it while playing starts the new part from its beginning.">
            <option value="current">Current patterns</option>
            <option value="scenes">Scene chain</option>
            <optgroup label="One scene">
              {Array.from({ length: 16 }, (_, i) => <option key={i} value={`scene:${i + 1}`}>Scene {i + 1}{scenes?.scenes[i]?.saved ? " •" : ""}</option>)}
            </optgroup>
            <optgroup label="One pattern, all tracks">
              {Array.from({ length: 8 }, (_, i) => <option key={i} value={`pattern:${i + 1}`}>Pattern {i + 1}</option>)}
            </optgroup>
          </select>
          <label className="visually-hidden" htmlFor="midi-out">MIDI output</label>
          <select id="midi-out" value={player.portId ?? ""} onChange={(e) => player.choosePort(e.target.value)}>
            <option value="">{player.ports.length ? "MIDI output…" : "No MIDI outputs"}</option>
            {player.ports.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="play-target">Plays to (Circuit, or the Live play-along set)</label>
          <select id="play-target" value={player.target} onChange={(e) => player.chooseTarget(e.target.value === "live" ? "live" : "circuit")}
            title="Circuit: the device's channels and drum notes. Live: the play-along set's (drums on channels 10–13, kit keys).">
            <option value="circuit">→ Circuit</option>
            <option value="live">→ Live set</option>
          </select>
          <label><input type="checkbox" checked={player.clock} disabled={player.playing} onChange={(e) => player.setClock(e.target.checked)} /> Clock</label>
          <button type="button" className="btn" aria-pressed={keys.on} disabled={!keySound}
            title="Play the synth sound from the computer keyboard: A–; notes, W E T Y U O P sharps, Z/X octave, C/V velocity, Esc off"
            onClick={() => keys.setOn(!keys.on)}>⌨ Keys</button>
        </div>
        <label className="visually-hidden" htmlFor="firmware">Firmware on your Circuit Tracks</label>
        <select id="firmware" value={firmware?.current.id ?? ""} disabled={!firmware} onChange={(e) => chooseFirmware(e.target.value)}
          title={firmware ? `Firmware on your Circuit Tracks: ${firmware.current.name} ${firmware.current.versions}. ${firmware.current.description}` : undefined}>
          {firmware?.available.map((f) => <option key={f.id} value={f.id}>{f.short}</option>)}
        </select>
        <button type="button" className="btn" onClick={() => void pick()}>Open…</button>
        <button type="button" className="btn" disabled={!summary?.edits} onClick={() => void undo()}>Undo</button>
        <button type="button" className="btn" disabled={!summary?.canRedo} onClick={() => void undo(true)}>Redo</button>
        <button type="button" className="btn" disabled={!projectId} onClick={() => void saveCopy()}>Save a copy</button>
        <button type="button" className="btn" disabled={!projectId} onClick={() => void exportTo("midi")}>Export MIDI</button>
        <button type="button" className="btn" disabled={!projectId} onClick={() => void exportTo("als")}>Export Live set</button>
      </header>
      <div className="main">
        <Library items={library} current={current} onOpen={(p) => void open(p)} />
        <main className="workspace" aria-label={`${view[0]!.toUpperCase()}${view.slice(1)} view`}>
          {!summary || !data ? <p className="empty">{projectId ? "Loading…" : "Choose a project in the library, or File › Open Project."}</p>
            : view === "pack" && projectId ? <PackView projectId={projectId} version={version} firmware={firmware?.current ?? null} chosen={packChoice} onPatch={choosePackPatch} />
            : view === "scenes" ? (scenes ? (
              <ScenesView scenes={scenes} playing={player.playing && player.playFrom.kind === "scene" ? player.playFrom.n : null} onPlayScene={(n) => player.choosePlayFrom({ kind: "scene", n }, true)}
                onSceneChain={(first, last) => { if (projectId) void edit(`scene chain ${first}–${last}`, () => call("setChain", projectId, "scenes", first, last)); }}
                onScene={(n, chains, label) => { if (projectId) void edit(label, () => call("setScene", projectId, n, chains)); }} />
            ) : <p className="empty">Loading…</p>)
            : view === "circuit" ? (
              <CircuitView playingPattern={player.playing ? player.heads[TRACK_NAMES.indexOf(track)]?.pattern ?? null : null} onPlayPattern={(n) => player.choosePlayFrom({ kind: "pattern", n }, true)} playStep={playStep(track)} summary={summary} track={track} pattern={pattern} data={data} selectedStep={step} page={page} octave={octave} currentNote={currentNote}
                onTrack={chooseTrack} onPattern={choosePattern} onSelectStep={setStep} onPage={setPage} onOctave={setOctave} onCurrentNote={setCurrentNote}
                onNoteSteps={onNoteSteps} onDrumStep={(s, velocity, label) => { if (isDrum(track)) onDrumSteps(track, [{ step: s, velocity }], label); }} />
            ) : (
              <>
                <div className="row">
                  <label>Track
                    <select value={track} onChange={(e) => chooseTrack(e.target.value as TrackName)}>
                      {["Synth 1", "Synth 2", "MIDI 1", "MIDI 2"].map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </label>
                  <label>Pattern
                    <select value={pattern} onChange={(e) => choosePattern(Number(e.target.value))}>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                </div>
                {data.kind === "notes" ? <PianoRoll projectId={projectId} version={version} playStep={playStep(track)} track={track} pattern={pattern} data={data} onNoteSteps={onNoteSteps} onSelectStep={(s) => { setStep(s); setDrumSel(null); }} />
                  : <p className="hint">Choose a Synth or MIDI track for the piano roll.</p>}
                <h2 className="visually-hidden">Drums</h2>
                <div style={{ marginTop: "var(--space-xl)" }}>
                  <DrumGrid playSteps={DRUM_NAMES.map(playStep)} pattern={pattern} drums={drums} selected={drumSel} onSelect={(d, s) => setDrumSel({ drum: d, step: s })} onDrumSteps={onDrumSteps} />
                </div>
              </>
            )}
        </main>
        {inspectorData ? (
          <Inspector track={inspectorTrack} pattern={pattern} data={inspectorData} step={inspectorStep} scenes={scenes} currentNote={currentNote}
            onNoteSteps={onNoteSteps} onDrumSteps={(steps, label) => { if (isDrum(inspectorTrack)) onDrumSteps(inspectorTrack, steps, label); }}
            onSettings={(s: { firstStep?: number; lastStep?: number; syncRate?: SyncRate }) => { if (projectId) void edit("pattern settings", () => call("setPatternSettings", projectId, inspectorTrack, pattern, s)); }} onChain={onChain} />
        ) : <aside className="panel inspector" aria-label="Inspector" />}
      </div>
      <footer className="statusbar">
        <button type="button" className="btn btn-small" onClick={() => void capture()}
          title="Save the last 10 seconds of sound, with the notes and patches, to report a glitch (Transport › Capture Last 10 Seconds, ⇧⌘R)">⏺ Capture sound</button>
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
    </div>
  );
}
