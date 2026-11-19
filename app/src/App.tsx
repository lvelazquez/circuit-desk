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
import { DRUM_NAMES, isDrum, isNoteTrack, TRACK_NAMES } from "./tracks.ts";
import { usePlayer } from "./usePlayer.ts";

type View = "circuit" | "editor";
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
      setStatus({ text: `Exported ${r.path}${r.notes.length ? ` (${r.notes.join("; ")})` : ""}` });
      void bridge().reveal(r.path);
    } catch (e) { fail(e); }
  }, [projectId]);

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
        else if (command === "toggle-view") setView((v) => (v === "circuit" ? "editor" : "circuit"));
        else if (command === "changed") {
          // Claude edited or opened a project through the MCP link.
          setVersion((v) => v + 1);
          void call("openProjects").then((o) => setProjectId((cur) => cur ?? o[0]?.id ?? null), fail);
        }
        else if (command === "play") { if (player.playing) player.stop(); else void player.play(); }
      });
    } catch { return undefined; }
  }, [undo, pick, saveCopy, exportTo, player]);

  const chooseTrack = (t: TrackName): void => { setTrack(t); setStep(null); };
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
        </div>
        <div role="group" aria-label="Transport" className="row" style={{ margin: 0 }}>
          <button type="button" className="btn" aria-pressed={player.playing} disabled={!projectId}
            onClick={() => (player.playing ? player.stop() : void player.play())}>{player.playing ? "■ Stop" : "▶ Play"}</button>
          <label className="visually-hidden" htmlFor="midi-out">MIDI output</label>
          <select id="midi-out" value={player.portId ?? ""} onChange={(e) => player.choosePort(e.target.value)}>
            <option value="">{player.ports.length ? "MIDI output…" : "No MIDI outputs"}</option>
            {player.ports.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <label><input type="checkbox" checked={player.clock} disabled={player.playing} onChange={(e) => player.setClock(e.target.checked)} /> Clock</label>
        </div>
        <button type="button" className="btn" onClick={() => void pick()}>Open…</button>
        <button type="button" className="btn" disabled={!summary?.edits} onClick={() => void undo()}>Undo</button>
        <button type="button" className="btn" disabled={!summary?.canRedo} onClick={() => void undo(true)}>Redo</button>
        <button type="button" className="btn" disabled={!projectId} onClick={() => void saveCopy()}>Save a copy</button>
        <button type="button" className="btn" disabled={!projectId} onClick={() => void exportTo("midi")}>Export MIDI</button>
        <button type="button" className="btn" disabled={!projectId} onClick={() => void exportTo("als")}>Export Live set</button>
      </header>
      <div className="main">
        <Library items={library} current={current} onOpen={(p) => void open(p)} />
        <main className="workspace" aria-label={view === "circuit" ? "Circuit view" : "Editor view"}>
          {!summary || !data ? <p className="empty">{projectId ? "Loading…" : "Choose a project in the library, or File › Open Project."}</p>
            : view === "circuit" ? (
              <CircuitView playStep={playStep(track)} summary={summary} track={track} pattern={pattern} data={data} selectedStep={step} page={page} octave={octave} currentNote={currentNote}
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
                {data.kind === "notes" ? <PianoRoll playStep={playStep(track)} track={track} pattern={pattern} data={data} onNoteSteps={onNoteSteps} onSelectStep={(s) => { setStep(s); setDrumSel(null); }} />
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
        <span role="status" aria-live="polite" className={status.error ? "error" : undefined}>{status.text}</span>
        {player.error && <span role="alert" className="error">{player.error}</span>}
        <span>{player.playing ? "Playing the current chains" : ""}</span>
      </footer>
    </div>
  );
}
