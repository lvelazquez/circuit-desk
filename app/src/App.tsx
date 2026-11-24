// The window: library on the left, the current view in the middle, the inspector on the right.
// All project state lives in the main process; this keeps only what is on screen and reloads it
// after every edit. Data, commands and menu wiring live in their own hooks.
import { useCallback, useEffect, useState } from "react";
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
import { DRUM_NAMES, TRACK_NAMES, isDrum, isNoteTrack } from "./tracks.ts";
import { usePlayingPattern } from "./playheads.ts";
import { remember, remembered } from "./storage.ts";

const FOLLOW_KEY = "circuit-desk.follow";
import { Loading } from "./ui/States.tsx";
import { useKeyboardPlayer } from "./useKeyboardPlayer.ts";
import { useMenuCommands } from "./useMenuCommands.ts";
import { usePlayer } from "./usePlayer.ts";
import { useProjectCommands } from "./useProjectCommands.ts";
import { useProjectData } from "./useProjectData.ts";
import { DETAIL_VIEWS, VIEWS, stepView, type DetailView } from "./views.ts";
import { DetailTabs } from "./DetailTabs.tsx";
import { DrumSoundsView } from "./DrumSoundsView.tsx";
import type { SoundPage } from "./SoundTabs.tsx";
import { cycleRegion } from "./regions.ts";

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [track, setTrack] = useState<TrackName>("Synth 1");
  const [pattern, setPattern] = useState(1);
  /** The pane beside the panel. */
  const [view, setView] = useState<DetailView>("editor");
  /** The library column: open until a project is open (Projects on the panel shows it again). */
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [step, setStep] = useState<number | null>(null);
  const [drumSel, setDrumSel] = useState<{ drum: DrumTrackName; step: number } | null>(null);
  const [page, setPage] = useState<0 | 1>(0);
  const [octave, setOctave] = useState(48);
  const [currentNote, setCurrentNote] = useState(60);
  const [packChoice, setPackChoice] = useState<PackPatchChoice | null>(null);
  const [version, setVersion] = useState(0);
  /** Sounds view: the drums page instead of the current synth's patch. */
  const [drumsPage, setDrumsPage] = useState(false);
  /** Follow: while playing, the views show the pattern and steps that are playing (remembered). */
  const [follow, setFollowState] = useState(remembered(FOLLOW_KEY) !== "off");
  const setFollow = useCallback((on: boolean) => { setFollowState(on); remember(FOLLOW_KEY, on ? "on" : "off"); }, []);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const { status, fading, faded, setStatus, fail } = useStatus("Open a project from the library.");
  const failLibrary = useCallback((e: unknown) => setStatus({ text: `Library: ${(e as Error).message}`, error: true }), [setStatus]);
  const { library, summary, scenes, settings, data, drums } = useProjectData(projectId, track, pattern, version, setProjectId, fail, failLibrary);
  // Note names on screen are the pitches stored notes sound at: stored + the scale root.
  // Set during render on purpose: children name notes in this same pass, and the call is idempotent.
  setNoteRoot(settings?.scale.root ?? 0);

  // A project opened (from the library, File › Open, the start-up file or Claude): give the room to the
  // panel and the pane; Projects on the panel brings the library back.
  useEffect(() => { if (projectId) setLibraryOpen(false); }, [projectId]);
  const player = usePlayer(projectId, version);
  // Follow: when the current track's chain moves on to another pattern, show that pattern.
  const playingPattern = usePlayingPattern(TRACK_NAMES.indexOf(track));
  useEffect(() => {
    if (!follow || !player.playing || playingPattern === null) return;
    setPattern((p) => (p === playingPattern ? p : playingPattern));
  }, [follow, player.playing, playingPattern]);
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
  const onChainFor = (t: TrackName, first: number, last: number): void => {
    if (projectId) void edit(`${t} chain ${first}–${last}`, () => call("setChain", projectId, t, first, last));
  };
  const onChain = (first: number, last: number): void => onChainFor(track, first, last);
  const onPatternSettings = (t: TrackName, s: { firstStep?: number; lastStep?: number; syncRate?: SyncRate; direction?: Direction }): void => {
    if (projectId) void edit(`${t} pattern ${pattern} settings`, () => call("setPatternSettings", projectId, t, pattern, s));
  };
  /** Moves focus to the Inspector's first control (Micro Step and Probability on the panel). */
  const focusInspector = (): void => { document.querySelector<HTMLElement>("#inspector input, #inspector select, #inspector button")?.focus(); };
  /** Moves focus to the panel's pads (⌘1). */
  const focusPads = (): void => { document.querySelector<HTMLElement>(".hw .grid [tabindex='0']")?.focus(); };
  const onPatchEdit = (changes: Record<string, number>, name: string | undefined, label: string): void => {
    if (projectId) void edit(label, () => call("setPatchParams", projectId, patchSynth, changes, name));
  };
  const onMacro = (synth: 1 | 2, k: number, v: number): void => {
    if (projectId) void edit(`Synth ${synth} macro ${k + 1} at ${v}`, () => call("setPatchParams", projectId, synth, { [`macro${k + 1}.position`]: v }));
  };

  const chooseTrack = (t: TrackName): void => { setTrack(t); setStep(null); setPackChoice(null); };
  const chooseSoundPage = (s: SoundPage): void => {
    if (s === "drums") { setDrumsPage(true); return; }
    setDrumsPage(false);
    chooseTrack(s === 1 ? "Synth 1" : "Synth 2");
  };
  const choosePattern = (n: number): void => { setPattern(n); setStep(null); setDrumSel(null); };
  const choosePackPatch = (p: PackPatchChoice): void => { setPackChoice(p); window.setTimeout(() => void keys.audition(), 0); };
  /** Copies a pack patch into Synth 1 or 2 (one undoable edit), then opens it in the Patch view. */
  const loadPackPatch = (c: PackPatchChoice, synth: 1 | 2): void => {
    if (!projectId) return;
    void edit(`loaded "${c.name}" from bank ${c.bank + 1} into Synth ${synth}`, () => call("loadPackPatch", projectId, synth, c.bank, c.record))
      .then((ok) => { if (ok) { chooseSoundPage(synth); setView("sounds"); } });
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
    ...Object.fromEntries(VIEWS.map((v, i) => [`view-${i + 1}`, () => (v.id === "circuit" ? focusPads() : setView(v.id))])),
    "next-view": () => setView((v) => stepView(v, 1)),
    "prev-view": () => setView((v) => stepView(v, -1)),
    "toggle-keys": () => { if (keySound) keys.setOn(!keys.on); },
    "toggle-follow": () => setFollow(!follow),
    // Claude edited or opened a project (or chose the firmware) through the MCP link.
    changed: () => { bump(); fw.read(); void call("openProjects").then((o) => setProjectId((cur) => cur ?? o[0]?.id ?? null), fail); },
    play: () => { if (player.playing) player.stop(); else void player.play(); },
    capture: () => void cmd.capture(),
  });


  const current = library.find((l) => l.path === summary?.path)?.path ?? summary?.path ?? null;
  // F6 / Shift+F6 move between the window's regions: toolbar, library, panel, inspector, pane.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "F6") { e.preventDefault(); cycleRegion(e.shiftKey ? -1 : 1); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const inspectorTrack: TrackName = view === "editor" && drumSel ? drumSel.drum : track;
  const inspectorData = view === "editor" && drumSel ? drums[DRUM_NAMES.indexOf(drumSel.drum)] ?? data : data;
  const inspectorStep = view === "editor" && drumSel ? drumSel.step : step;

  const detail = (): React.ReactNode => {
    if (!summary || !data) return projectId ? <Loading /> : <p className="empty">Choose a project in the library (Projects on the panel), or File › Open Project.</p>;
    switch (view) {
      case "mixer": return settings ? <MixerView settings={settings} muted={player.muted} solo={player.solo} onMute={player.toggleMute} onSolo={player.toggleSolo} onEdit={onSettingsEdit} /> : <Loading />;
      case "project": return settings && projectId ? <ProjectView projectId={projectId} version={version} settings={settings} onEdit={onSettingsEdit} /> : <Loading />;
      case "sounds": return projectId && (drumsPage
        ? (settings ? <DrumSoundsView projectId={projectId} version={version} settings={settings} onEdit={onSettingsEdit} onPage={chooseSoundPage} /> : <Loading />)
        : <PatchView projectId={projectId} version={version} synth={patchSynth} onPage={chooseSoundPage} onEdit={onPatchEdit} onPlay={() => void keys.audition()} onExport={() => void cmd.exportSyx()} />);
      case "pack": return projectId && <PackView projectId={projectId} version={version} firmware={fw.firmware?.current ?? null} chosen={packChoice} onPatch={choosePackPatch} onLoad={loadPackPatch} />;
      case "scenes": return scenes ? (
        <ScenesView scenes={scenes} playing={player.playing && player.playFrom.kind === "scene" ? player.playFrom.n : null} onPlayScene={(n) => player.choosePlayFrom({ kind: "scene", n }, true)}
          onSceneChain={(first, last) => { if (projectId) void edit(`scene chain ${first}–${last}`, () => call("setChain", projectId, "scenes", first, last)); }}
          onScene={(n, chains, label) => { if (projectId) void edit(label, () => call("setScene", projectId, n, chains)); }} />
      ) : <Loading />;
      case "editor": return (
        <EditorPane projectId={projectId} version={version} follow={follow} track={track} pattern={pattern} data={data} drums={drums} drumSel={drumSel}
          onTrack={chooseTrack} onPattern={choosePattern} onSelectStep={(s) => { setStep(s); setDrumSel(null); }} onSelectDrum={(d, s) => setDrumSel({ drum: d, step: s })}
          onNoteSteps={onNoteSteps} onDrumSteps={onDrumSteps} onLaneEdit={onLaneEdit} />
      );
    }
  };
  /** Preset on a drum opens the drums page of Sounds; on a synth, that synth's patch. */
  const openDetail = (v: DetailView): void => {
    if (v === "sounds") setDrumsPage(isDrum(track));
    setView(v);
  };

  return (
    <div className="app">
      <Toolbar summary={summary} projectId={projectId} scenes={scenes} player={player} keys={keys} keySound={keySound} follow={follow} onFollow={setFollow}
        firmware={fw.firmware} onFirmware={fw.choose} onUndo={() => void cmd.undo()} onRedo={() => void cmd.undo(true)} patchSynth={patchSynth}
        onExport={(k) => void (k === "audio" ? cmd.exportAudio() : k === "syx" ? cmd.exportSyx() : cmd.exportTo(k))} />
      <div className="main">
        {libraryOpen && <Library items={library} current={current} edited={!!summary?.edits} onOpen={(p) => void open(p)} />}
        <div className="device-column" id="device">
          {summary && data && projectId ? (
            <CircuitView projectId={projectId} version={version} follow={follow} onFollow={setFollow} onMacro={onMacro} scale={settings?.scale ?? null} summary={summary} scenes={scenes}
              track={track} pattern={pattern} data={data} selectedStep={step} page={page} octave={octave} currentNote={currentNote} playing={player.playing} libraryOpen={libraryOpen}
              onTrack={chooseTrack} onPattern={choosePattern} onSelectStep={setStep} onPage={setPage} onOctave={setOctave} onCurrentNote={setCurrentNote}
              onNoteSteps={onNoteSteps} onDrumSteps={(steps, label) => { if (isDrum(track)) onDrumSteps(track, steps, label); }}
              onSettings={(s) => onPatternSettings(track, s)} onChain={onChainFor} onOpen={openDetail} onLibrary={() => setLibraryOpen((o) => !o)}
              onInspector={focusInspector} onSave={() => void cmd.saveCopy()} onPlay={() => (player.playing ? player.stop() : void player.play())} />
          ) : projectId ? <Loading /> : null}
          {inspectorData ? (
            <Inspector track={inspectorTrack} pattern={pattern} data={inspectorData} step={inspectorStep} scenes={scenes} currentNote={currentNote}
              onNoteSteps={onNoteSteps} onDrumSteps={(steps, label) => { if (isDrum(inspectorTrack)) onDrumSteps(inspectorTrack, steps, label); }}
              onSettings={(s) => onPatternSettings(inspectorTrack, s)} onChain={onChain} />
          ) : null}
        </div>
        <main className="workspace" id="workspace" tabIndex={-1} aria-label={`${DETAIL_VIEWS.find((v) => v.id === view)!.label} view`}>
          <DetailTabs view={view} onView={setView} />
          <div role="tabpanel" id="detail-panel" aria-labelledby={`tab-${view}`} className="detail-body">{detail()}</div>
        </main>
      </div>
      <StatusBar status={status} fading={fading} onFaded={faded} player={player} keys={keys} keySound={keySound} />
      <Tooltips />
    </div>
  );
}
