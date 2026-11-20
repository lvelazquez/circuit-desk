// The window: library on the left, the current view in the middle, the inspector on the right.
// All project state lives in the main process; this keeps only what is on screen and reloads it
// after every edit. Data, commands and menu wiring live in their own hooks.
import { useCallback, useState } from "react";
import type { Direction, DrumStepIn, DrumTrackName, NoteStepIn, SyncRate, TrackName } from "@circuit-desk/core-service";
import type { SettingsEdit } from "@circuit-desk/ncs";
import { CircuitView } from "./CircuitView.tsx";
import { bridge, call } from "./desk.ts";
import { EditorPane } from "./EditorPane.tsx";
import type { LaneEdit } from "./EditorView.tsx";
import { useFirmware, useKeySound, useStatus } from "./hooks.ts";
import { Inspector } from "./Inspector.tsx";
import { Library } from "./Library.tsx";
import { MixerView } from "./MixerView.tsx";
import { setNoteRoot } from "./model.ts";
import { PackView, type PackPatchChoice } from "./PackView.tsx";
import { PatchView } from "./PatchView.tsx";
import { ProjectView } from "./ProjectView.tsx";
import { ScenesView } from "./ScenesView.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { Tooltips } from "./Tooltips.tsx";
import { DRUM_NAMES, isDrum, isNoteTrack } from "./tracks.ts";
import { Loading } from "./ui/States.tsx";
import { useKeyboardPlayer } from "./useKeyboardPlayer.ts";
import { useMenuCommands } from "./useMenuCommands.ts";
import { usePlayer } from "./usePlayer.ts";
import { useProjectCommands } from "./useProjectCommands.ts";
import { useProjectData } from "./useProjectData.ts";
import { nextView, type View } from "./views.ts";

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [track, setTrack] = useState<TrackName>("Synth 1");
  const [pattern, setPattern] = useState(1);
  const [view, setView] = useState<View>("circuit");
  const [step, setStep] = useState<number | null>(null);
  const [drumSel, setDrumSel] = useState<{ drum: DrumTrackName; step: number } | null>(null);
  const [page, setPage] = useState<0 | 1>(0);
  const [octave, setOctave] = useState(48);
  const [currentNote, setCurrentNote] = useState(60);
  const [packChoice, setPackChoice] = useState<PackPatchChoice | null>(null);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const { status, setStatus, fail } = useStatus("Open a project from the library.");
  const failLibrary = useCallback((e: unknown) => setStatus({ text: `Library: ${(e as Error).message}`, error: true }), [setStatus]);
  const { library, summary, scenes, settings, data, drums } = useProjectData(projectId, track, pattern, version, setProjectId, fail, failLibrary);
  // Note names on screen are the pitches stored notes sound at: stored + the scale root.
  // Set during render on purpose: children name notes in this same pass, and the call is idempotent.
  setNoteRoot(settings?.scale.root ?? 0);

  const player = usePlayer(projectId, version);
  const fw = useFirmware((f) => { bump(); setStatus({ text: `Firmware: ${f.name} ${f.versions}. ${f.description}` }); }, fail);
  const keySound = useKeySound(projectId, track, packChoice, version, fw.firmware, fail);
  const keys = useKeyboardPlayer(keySound, player.liveOutput);

  /** The synth the Patch view edits: the current track when it is a synth, else Synth 1. */
  const patchSynth: 1 | 2 = track === "Synth 2" ? 2 : 1;
  const cmd = useProjectCommands({ projectId, summary, firmware: fw.firmware, player, keySound, view, track, patchSynth, setStatus, fail, bump });

  const open = useCallback(async (path: string) => {
    try {
      const { id } = await call("openProject", path);
      setProjectId(id); setStep(null); setDrumSel(null); setPackChoice(null);
      setStatus({ text: `Opened ${path.split("/").pop() ?? path}` });
    } catch (e) { fail(e); }
  }, [setStatus, fail]);
  const pick = async (): Promise<void> => {
    try { const p = await bridge().pickProject(); if (p) await open(p); } catch (e) { fail(e); }
  };

  /** Runs one undoable edit, then reloads; true when it succeeded. */
  const edit = useCallback(async (label: string, f: () => Promise<unknown>): Promise<boolean> => {
    try { await f(); bump(); setStatus({ text: `Edited: ${label}` }); return true; } catch (e) { fail(e); return false; }
  }, [bump, setStatus, fail]);

  /** A lane edit: the whole lane goes to the service as one undoable change. */
  const onLaneEdit: LaneEdit = (t, lane, points, label) => {
    if (!projectId) return;
    const list = points.flatMap((v, k) => (v === null ? [] : [{ step: Math.floor(k / 6) + 1, micro: (k % 6) + 1, value: v }]));
    void edit(`${t} pattern ${pattern}, ${label}`, () => call("setAutomation", projectId, t, pattern, lane, list, { clear: true }));
  };
  const onNoteSteps = (steps: NoteStepIn[], label: string): void => {
    if (projectId && isNoteTrack(track)) void edit(label, () => call("setSteps", projectId, track, pattern, steps));
  };
  const onDrumSteps = (drum: DrumTrackName, steps: DrumStepIn[], label: string): void => {
    if (projectId) void edit(label, () => call("setDrumSteps", projectId, drum, pattern, steps));
  };
  const onSettingsEdit = (e: SettingsEdit, label: string): void => {
    if (projectId) void edit(label, () => call("setSettings", projectId, e));
  };
  const onChain = (first: number, last: number): void => {
    if (projectId) void edit(`${track} chain ${first}–${last}`, () => call("setChain", projectId, track, first, last));
  };
  const onPatchEdit = (changes: Record<string, number>, name: string | undefined, label: string): void => {
    if (projectId) void edit(`${label} (patch fields are partial: saved to copies)`, () => call("setPatchParams", projectId, patchSynth, changes, name));
  };

  const chooseTrack = (t: TrackName): void => { setTrack(t); setStep(null); setPackChoice(null); };
  const choosePattern = (n: number): void => { setPattern(n); setStep(null); setDrumSel(null); };
  const choosePackPatch = (p: PackPatchChoice): void => { setPackChoice(p); window.setTimeout(() => void keys.audition(), 0); };
  /** Copies a pack patch into Synth 1 or 2 (one undoable edit), then opens it in the Patch view. */
  const loadPackPatch = (c: PackPatchChoice, synth: 1 | 2): void => {
    if (!projectId) return;
    void edit(`loaded "${c.name}" from bank ${c.bank + 1} into Synth ${synth}`, () => call("loadPackPatch", projectId, synth, c.bank, c.record))
      .then((ok) => { if (ok) { chooseTrack(synth === 1 ? "Synth 1" : "Synth 2"); setView("patch"); } });
  };

  useMenuCommands({
    undo: () => void cmd.undo(),
    redo: () => void cmd.undo(true),
    open: () => void pick(),
    "save-copy": () => void cmd.saveCopy(),
    "export-midi": () => void cmd.exportTo("midi"),
    "export-als": () => void cmd.exportTo("als"),
    "export-audio": () => void cmd.exportAudio(),
    "export-syx": () => void cmd.exportSyx(),
    "toggle-view": () => setView(nextView),
    // Claude edited or opened a project (or chose the firmware) through the MCP link.
    changed: () => { bump(); fw.read(); void call("openProjects").then((o) => setProjectId((cur) => cur ?? o[0]?.id ?? null), fail); },
    play: () => { if (player.playing) player.stop(); else void player.play(); },
    capture: () => void cmd.capture(),
  });

  const current = library.find((l) => l.path === summary?.path)?.path ?? summary?.path ?? null;
  const inspectorTrack: TrackName = view === "editor" && drumSel ? drumSel.drum : track;
  const inspectorData = view === "editor" && drumSel ? drums[DRUM_NAMES.indexOf(drumSel.drum)] ?? data : data;
  const inspectorStep = view === "editor" && drumSel ? drumSel.step : step;

  const workspace = (): React.ReactNode => {
    if (!summary || !data) return projectId ? <Loading /> : <p className="empty">Choose a project in the library, or File › Open Project.</p>;
    switch (view) {
      case "mixer": return settings ? <MixerView settings={settings} muted={player.muted} solo={player.solo} onMute={player.toggleMute} onSolo={player.toggleSolo} onEdit={onSettingsEdit} /> : <Loading />;
      case "project": return settings && projectId ? <ProjectView projectId={projectId} version={version} settings={settings} onEdit={onSettingsEdit} /> : <Loading />;
      case "patch": return projectId && <PatchView projectId={projectId} version={version} synth={patchSynth} onSynth={(s) => chooseTrack(s === 1 ? "Synth 1" : "Synth 2")} onEdit={onPatchEdit} onPlay={() => void keys.audition()} onExport={() => void cmd.exportSyx()} />;
      case "pack": return projectId && <PackView projectId={projectId} version={version} firmware={fw.firmware?.current ?? null} chosen={packChoice} onPatch={choosePackPatch} onLoad={loadPackPatch} />;
      case "scenes": return scenes ? (
        <ScenesView scenes={scenes} playing={player.playing && player.playFrom.kind === "scene" ? player.playFrom.n : null} onPlayScene={(n) => player.choosePlayFrom({ kind: "scene", n }, true)}
          onSceneChain={(first, last) => { if (projectId) void edit(`scene chain ${first}–${last}`, () => call("setChain", projectId, "scenes", first, last)); }}
          onScene={(n, chains, label) => { if (projectId) void edit(label, () => call("setScene", projectId, n, chains)); }} />
      ) : <Loading />;
      case "circuit": return (
        <CircuitView scale={settings?.scale ?? null} onPlayPattern={(n) => player.choosePlayFrom({ kind: "pattern", n }, true)} summary={summary} track={track} pattern={pattern} data={data} selectedStep={step} page={page} octave={octave} currentNote={currentNote}
          onTrack={chooseTrack} onPattern={choosePattern} onSelectStep={setStep} onPage={setPage} onOctave={setOctave} onCurrentNote={setCurrentNote}
          onNoteSteps={onNoteSteps} onDrumStep={(s, velocity, label) => { if (isDrum(track)) onDrumSteps(track, [{ step: s, velocity }], label); }} />
      );
      case "editor": return (
        <EditorPane projectId={projectId} version={version} track={track} pattern={pattern} data={data} drums={drums} drumSel={drumSel}
          onTrack={chooseTrack} onPattern={choosePattern} onSelectStep={(s) => { setStep(s); setDrumSel(null); }} onSelectDrum={(d, s) => setDrumSel({ drum: d, step: s })}
          onNoteSteps={onNoteSteps} onDrumSteps={onDrumSteps} onLaneEdit={onLaneEdit} />
      );
    }
  };

  return (
    <div className="app">
      <Toolbar summary={summary} projectId={projectId} scenes={scenes} view={view} onView={setView} player={player} keys={keys} keySound={keySound}
        firmware={fw.firmware} onFirmware={fw.choose} onOpen={() => void pick()} onUndo={() => void cmd.undo()} onRedo={() => void cmd.undo(true)}
        onSaveCopy={() => void cmd.saveCopy()} onExport={(k) => void cmd.exportTo(k)} />
      <div className="main">
        <Library items={library} current={current} onOpen={(p) => void open(p)} />
        <main className="workspace" aria-label={`${view[0]!.toUpperCase()}${view.slice(1)} view`}>{workspace()}</main>
        {inspectorData ? (
          <Inspector track={inspectorTrack} pattern={pattern} data={inspectorData} step={inspectorStep} scenes={scenes} currentNote={currentNote}
            onNoteSteps={onNoteSteps} onDrumSteps={(steps, label) => { if (isDrum(inspectorTrack)) onDrumSteps(inspectorTrack, steps, label); }}
            onSettings={(s: { firstStep?: number; lastStep?: number; syncRate?: SyncRate; direction?: Direction }) => { if (projectId) void edit("pattern settings", () => call("setPatternSettings", projectId, inspectorTrack, pattern, s)); }} onChain={onChain} />
        ) : <aside className="panel inspector" aria-label="Inspector" />}
      </div>
      <StatusBar status={status} player={player} keys={keys} keySound={keySound} onCapture={() => void cmd.capture()} />
      <Tooltips />
    </div>
  );
}
