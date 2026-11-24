// The Circuit Tracks panel, laid out like the device (Novation's photo of it on the Programmer's
// Reference cover): two staggered rows of knobs, the function row (Scales … Shift), the track row
// (Preset, Synth 1 … Drum 4, Patterns), and the 4 × 8 pads between the view buttons on the left
// (Note, Velocity, Gate, Pattern Settings) and Mixer, FX, Record and Play on the right.
// Every button does its device job here, or opens the part of the app that does it. Shift (latched,
// or the Shift key held while clicking) gives the second function printed on a button.
//
// Pad views:
// - Note: on a note track, rows 1–2 are 16 steps (page 1–16 or 17–32), rows 3–4 a 16-key keyboard
//   laid out as on the device (in a scale the bottom row climbs it from the root and the top row is
//   an octave up; in Chromatic a piano). On a drum track, all 32 steps.
// - Velocity / Gate: rows 1–2 pick a step, rows 3–4 are a 16-pad level for it.
// - Pattern Settings: the 32 steps; a pad sets the last step, Shift + pad the first.
// - Patterns: one column per track, patterns 1–4 (▲ ▼ for 5–8); a pad edits that pattern,
//   Shift + pad chains the track's patterns up to it.
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Knob } from "./ui/Knob.tsx";
import { useServiceData } from "./ui/useServiceData.ts";
import type { DrumStepIn, NoteStepIn, TrackName } from "@circuit-desk/core-service";
import type { DrumPatternData, NotePatternData, PatternData, Scenes, Summary } from "./desk.ts";
import { SCALE_NAMES, type ScaleSetting } from "@circuit-desk/ncs";
import { clamp, isBlackKey, keyboardNote, listMove, noteName, noteSpoken, stepMap, toggleNote, toggleStep } from "./model.ts";
import { TRACK_NAMES, trackStyle } from "./tracks.ts";
import { useRoving } from "./useRoving.ts";
import { usePlayStep, usePlayingPattern } from "./playheads.ts";
import type { DetailView } from "./views.ts";

export type PadView = "note" | "velocity" | "gate" | "settings" | "patterns";

export interface CircuitProps {
  projectId: string;
  version: number;
  /** Follow playback: a note track's pads turn to the step page that is playing, as on the device. */
  follow: boolean;
  onFollow: (on: boolean) => void;
  /** Turn a macro knob of Synth 1 or 2: one undoable patch edit. */
  onMacro: (synth: 1 | 2, k: number, v: number) => void;
  summary: Summary;
  scenes: Scenes | null;
  /** The project's scale; null until settings load (then a piano layout). */
  scale: ScaleSetting | null;
  track: TrackName;
  pattern: number;
  data: PatternData;
  selectedStep: number | null;
  page: 0 | 1;
  octave: number;
  currentNote: number;
  playing: boolean;
  libraryOpen: boolean;
  onTrack: (t: TrackName) => void;
  onPattern: (p: number) => void;
  onSelectStep: (s: number) => void;
  onPage: (p: 0 | 1) => void;
  onOctave: (o: number) => void;
  onCurrentNote: (n: number) => void;
  onNoteSteps: (steps: NoteStepIn[], label: string) => void;
  onDrumSteps: (steps: DrumStepIn[], label: string) => void;
  onSettings: (s: { firstStep?: number; lastStep?: number }) => void;
  onChain: (t: TrackName, first: number, last: number) => void;
  onOpen: (v: DetailView) => void;
  onLibrary: () => void;
  onInspector: () => void;
  onSave: () => void;
  onPlay: () => void;
}

/** The knob labels printed on the device (factory macro names), upper row then lower row. */
const KNOB_LABELS = ["1 Oscillator", "2 Oscillator Mod", "3 Amp Envelope", "4 Filter Envelope", "5 Filter Frequency", "6 Resonance", "7 Modulation", "8 FX"] as const;

/** One device button: its printed label, and the second function Shift gives (printed under it). */
function HwButton({ label, alt, tip, altTip, shifted, pressed, disabled, altDisabled, onPress, onAlt, className, style, shortcut }: {
  label: ReactNode; alt?: string; tip: string; altTip?: string; shifted: boolean; pressed?: boolean; disabled?: boolean; altDisabled?: boolean;
  onPress: () => void; onAlt?: () => void; className?: string; style?: CSSProperties; shortcut?: string;
}) {
  const useAlt = shifted && !!alt;
  const off = useAlt ? altDisabled || !onAlt : disabled;
  const name = typeof label === "string" ? label : undefined;
  return (
    <button type="button" className={`hw-btn${className ? ` ${className}` : ""}`} style={style} aria-pressed={pressed} disabled={off}
      data-shifted={useAlt || undefined} aria-label={useAlt ? alt : name} aria-keyshortcuts={useAlt ? undefined : shortcut}
      data-tip={useAlt ? altTip ?? alt : `${tip}${alt ? ` Shift: ${alt}${altTip ? ` (${altTip})` : ""}.` : ""}`}
      onClick={(e: MouseEvent<HTMLButtonElement>) => { if ((useAlt || (e.shiftKey && alt)) && onAlt) onAlt(); else onPress(); }}>
      <span className="hw-label">{label}</span>
      {alt && <span className="hw-alt" aria-hidden="true">{alt}</span>}
    </button>
  );
}

/**
 * The knob row: Master Volume, macros 1–8 and Master Filter, staggered as on the device. The macros
 * are Synth 1 or 2's patch macros at their stored positions; turning one is one undoable patch edit
 * (moves over time are automation lanes 1–8 in the Editor). Master Volume and Master Filter are the
 * device's own, not saved in a project, so they show as unavailable.
 */
function Knobs({ projectId, version, track, onMacro }: { projectId: string; version: number; track: TrackName; onMacro: (synth: 1 | 2, k: number, v: number) => void }) {
  const synth = track === "Synth 1" ? 1 : track === "Synth 2" ? 2 : null;
  const patch = useServiceData(synth ? "getPatch" : null, [projectId, synth ?? 1], [projectId, synth, version]).data;
  const macro = (k: number): ReactNode => (
    <div key={k} className="hw-knob" data-row={k % 2 === 0 ? "lower" : "upper"} data-col={Math.floor(k / 2)}>
      <Knob label={KNOB_LABELS[k]!} value={patch?.values[`macro${k + 1}.position`] ?? 0} disabled={!synth || !patch}
        tip={synth ? `Macro ${k + 1} of Synth ${synth}'s patch: where the knob rests (an undoable patch edit). Arrows step it; Shift steps by 10. Its moves over time are automation lane ${k + 1} in the Editor.` : "Macro knobs belong to Synth 1 and 2's patches: choose Synth 1 or 2."}
        onCommit={(v) => { if (synth) onMacro(synth, k, v); }} />
    </div>
  );
  return (
    <div className="hw-knobs" role="group" aria-label={synth ? `Synth ${synth} macro knobs` : "Macro knobs (only Synth 1 and 2 have them)"}>
      <div className="hw-knob" data-row="upper" data-col="master">
        <Knob label="Master Volume" value={0} disabled tip="The device's master volume: not saved in projects, so not here." onCommit={() => undefined} />
      </div>
      {Array.from({ length: 8 }, (_, k) => macro(k))}
      <div className="hw-knob" data-row="lower" data-col="filter">
        <Knob label="Master Filter" value={0} disabled tip="The device's master filter: global, not saved in projects, so not here." onCommit={() => undefined} />
      </div>
    </div>
  );
}

function TrackRow({ track, onTrack }: { track: TrackName; onTrack: (t: TrackName) => void }) {
  const index = TRACK_NAMES.indexOf(track);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const to = listMove(i, e.key, TRACK_NAMES.length, true);
    const next = to === null ? undefined : TRACK_NAMES[to];
    if (to === null || next === undefined) return;
    e.preventDefault();
    onTrack(next);
    (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Track" className="hw-tracks">
      {TRACK_NAMES.map((t, i) => (
        <button key={t} type="button" role="radio" aria-checked={i === index} tabIndex={i === index ? 0 : -1} className="hw-btn hw-track" style={trackStyle(t)}
          data-tip={`Show ${t} on the pads${t.startsWith("Drum") ? " (32 steps)" : " (steps and keyboard)"}. Arrow keys move between tracks.`}
          onClick={() => onTrack(t)} onKeyDown={(e) => onKey(e, i)}><span className="hw-label">{t}</span></button>
      ))}
    </div>
  );
}

export function CircuitView(p: CircuitProps) {
  const [view, setView] = useState<PadView>("note");
  /** Shift, latched by its button (the Shift key held while clicking works too). */
  const [shift, setShift] = useState(false);
  /** Patterns view: patterns 1–4 or 5–8. */
  const [patternPage, setPatternPage] = useState<0 | 1>(0);
  const isDrum = p.track.startsWith("Drum");
  // Gate has no meaning on a drum hit: leave Gate for Note there.
  useEffect(() => { if (isDrum && view === "gate") setView("note"); }, [isDrum, view]);
  /** Runs a button's action and releases a latched Shift, as the device does. */
  const press = (f: () => void) => () => { f(); setShift(false); };

  const selected = p.selectedStep;
  const noteData = p.data.kind === "notes" ? p.data : null;
  const clearStep = (): void => {
    if (selected === null) return;
    if (noteData) p.onNoteSteps([{ step: selected, notes: [] }], `cleared step ${selected}`);
    else p.onDrumSteps([{ step: selected, velocity: 0 }], `cleared ${p.track} step ${selected}`);
  };
  const stepHasContent = selected !== null && (noteData ? noteData.steps.some((s) => s.step === selected && s.notes.length) : (p.data as DrumPatternData).steps.some((s) => s.step === selected));
  const pagesOn = view === "velocity" || view === "gate" || (view === "note" && !isDrum);
  const arrows = view === "patterns" ? "patterns" : view === "note" && !isDrum ? "octave" : null;

  const viewButton = (v: PadView, label: string, tip: string, extra: Partial<Parameters<typeof HwButton>[0]> = {}): ReactNode => (
    <HwButton label={label} tip={tip} shifted={shift} pressed={view === v} onPress={press(() => setView(v))} {...extra} />
  );

  return (
    <section className="hw" aria-label="Circuit Tracks panel" style={trackStyle(p.track)} aria-describedby="hw-help">
      <div className="hw-head">
        <span className="hw-brand" aria-hidden="true">Circuit <span>Tracks</span></span>
        <span className="hw-status">{statusLine(p, view, patternPage)}</span>
      </div>
      <Knobs projectId={p.projectId} version={p.version} track={p.track} onMacro={p.onMacro} />

      <div className="hw-row" role="group" aria-label="Function buttons">
        <HwButton label="Scales" tip="The project's scale and root: opens Project." shifted={shift} onPress={press(() => p.onOpen("project"))} />
        <HwButton label="▼" tip={arrows === "patterns" ? "Patterns 1–4." : "Keyboard pads down an octave."} shifted={shift}
          disabled={arrows === null || (arrows === "octave" ? p.octave <= 0 : patternPage === 0)}
          onPress={press(() => (arrows === "patterns" ? setPatternPage(0) : p.onOctave(Math.max(0, p.octave - 12))))} />
        <HwButton label="▲" tip={arrows === "patterns" ? "Patterns 5–8." : "Keyboard pads up an octave."} shifted={shift}
          disabled={arrows === null || (arrows === "octave" ? p.octave >= 112 : patternPage === 1)}
          onPress={press(() => (arrows === "patterns" ? setPatternPage(1) : p.onOctave(Math.min(112, p.octave + 12))))} />
        <HwButton label={<>1-16<br />17-32</>} tip={`Show steps ${p.page === 0 ? "17–32" : "1–16"} on the step pads (a pattern can be 32 steps).`} shifted={shift}
          pressed={p.page === 1} disabled={!pagesOn} onPress={press(() => p.onPage(p.page === 0 ? 1 : 0))} className="hw-page" />
        <HwButton label={<>Tempo<br />Swing</>} alt="Tap" altDisabled tip="Tempo and swing: opens Project." altTip="Tap tempo: on the device." shifted={shift} onPress={press(() => p.onOpen("project"))} />
        <HwButton label="Clear" alt="Click" altDisabled tip={selected === null ? "Clear the selected step: select a step first." : `Clear step ${selected} (one undoable edit).`} altTip="The click track: on the device."
          shifted={shift} disabled={!stepHasContent} onPress={press(clearStep)} />
        <HwButton label="Duplicate" alt="Mutate" altDisabled disabled tip="Duplicate: on the device for now." altTip="Mutate: on the device." shifted={shift} onPress={() => undefined} />
        <HwButton label="Save" tip="Save a copy of the project (⌘S); the original file is never changed." shortcut="Meta+S" shifted={shift} onPress={press(p.onSave)} />
        <HwButton label="Projects" alt="Packs" tip="Show or hide the project library." altTip="The pack's samples and patches: opens Pack." shifted={shift}
          pressed={p.libraryOpen} onPress={press(p.onLibrary)} onAlt={press(() => p.onOpen("pack"))} />
        <HwButton label="Shift" tip="Latch Shift: the next button does its second function (printed under its name). Holding the Shift key while clicking works too." shifted={false}
          pressed={shift} onPress={() => setShift(!shift)} className="hw-shift" />
      </div>

      <div className="hw-row">
        <HwButton label="Preset" tip={isDrum ? "This drum's sample and knobs: opens Sounds." : p.track.startsWith("MIDI") ? "MIDI tracks play an external instrument: no preset here." : `${p.track}'s patch: opens Sounds.`}
          shifted={shift} disabled={p.track.startsWith("MIDI")} onPress={press(() => p.onOpen("sounds"))} />
        <TrackRow track={p.track} onTrack={(t) => { p.onTrack(t); setShift(false); }} />
        <HwButton label="Patterns" alt="View Lock" tip="Patterns on the pads: one column per track." altTip={p.follow ? "Lock the view: stop following playback" : "Unlock the view: follow playback again"}
          shifted={shift} pressed={view === "patterns"} onPress={press(() => setView(view === "patterns" ? "note" : "patterns"))} onAlt={press(() => p.onFollow(!p.follow))} />
      </div>

      <div className="hw-main">
        <div className="hw-col" role="group" aria-label="Pad views">
          {viewButton("note", "Note", "Steps and the keyboard on the pads.", { alt: "Expand", altTip: "The piano roll: opens Editor", onAlt: press(() => p.onOpen("editor")) })}
          {viewButton("velocity", "Velocity", "Pick a step on the top rows, set its velocity on the bottom rows.", { alt: "Fixed", altDisabled: true, altTip: "Fixed velocity: on the device" })}
          {viewButton("gate", "Gate", "Pick a step on the top rows, set how long its notes last on the bottom rows.", { alt: "Micro Step", altTip: "Micro-steps: in the Inspector", onAlt: press(p.onInspector), disabled: isDrum })}
          {viewButton("settings", "Pattern Settings", "The pattern's first and last step on the pads; rate and direction in the Inspector.", { alt: "Probability", altTip: "Step probability: in the Inspector", onAlt: press(p.onInspector), className: "hw-two-line" })}
        </div>
        <Pads {...p} view={view} patternPage={patternPage} shift={shift} onShiftUsed={() => setShift(false)} />
        <div className="hw-col" role="group" aria-label="Mix and transport">
          <HwButton label="Mixer" tip="Levels, pans and sends: opens Mixer." shifted={shift} onPress={press(() => p.onOpen("mixer"))} className="hw-accent" />
          <HwButton label="FX" alt="Side Chain" tip="Reverb, delay and the project FX: opens Mixer." altTip="Sidechains: opens Mixer" shifted={shift}
            onPress={press(() => p.onOpen("mixer"))} onAlt={press(() => p.onOpen("mixer"))} />
          <HwButton label={<span className="hw-rec" aria-hidden="true">●</span>} alt="Rec Quantise" altDisabled disabled tip="Record: on the device (Circuit Desk edits steps instead)." altTip="Record quantise: on the device" shifted={shift} onPress={() => undefined} />
          <HwButton label={<span className="hw-play" aria-hidden="true">{p.playing ? "■" : "▶"}</span>} tip="Play or stop (⌘↩): what the toolbar's menu says." shortcut="Meta+Enter"
            shifted={shift} pressed={p.playing} onPress={press(p.onPlay)} />
        </div>
      </div>
      <p id="hw-help" className="hint hw-help">{helpFor(view, isDrum)}</p>
    </section>
  );
}

function statusLine(p: CircuitProps, view: PadView, patternPage: 0 | 1): string {
  const name = { note: "Note", velocity: "Velocity", gate: "Gate", settings: "Pattern Settings", patterns: "Patterns" }[view];
  if (view === "patterns") return `${name} · patterns ${patternPage === 0 ? "1–4" : "5–8"}`;
  const where = `${p.track} · pattern ${p.pattern}`;
  if (view === "settings" || p.track.startsWith("Drum") && view === "note") return `${name} · ${where} · steps ${p.data.settings.firstStep}–${p.data.settings.lastStep}`;
  const step = p.selectedStep !== null ? ` · step ${p.selectedStep}` : "";
  const keys = view === "note" ? keysText(p) : "";
  return `${name} · ${where} · steps ${p.page === 0 ? "1–16" : "17–32"}${step}${keys}`;
}

function keysText(p: CircuitProps): string {
  const keys = Array.from({ length: 16 }, (_, k) => keyboardNote(p.scale, p.octave, k)).filter((k): k is number => k !== null);
  return keys.length ? ` · ${p.scale ? `${SCALE_NAMES[p.scale.type]}, ` : ""}keys ${noteName(Math.min(...keys))}–${noteName(Math.max(...keys))}` : "";
}

function helpFor(view: PadView, drum: boolean): string {
  switch (view) {
    case "note": return drum
      ? "Arrow keys move; Enter, Space or a click adds or removes a hit. The Inspector edits velocity, probability and micro-steps."
      : "Arrow keys move. On a step, Enter or Space puts the current note on an empty step or clears it; Delete clears. Clicking an empty step adds the current note. A key adds or removes that note in the selected step and becomes the current note.";
    case "velocity": return "Top rows: pick a step. Bottom rows: its velocity, in 16 levels (every note in the step).";
    case "gate": return "Top rows: pick a step. Bottom rows: how long its notes last, 1 to 16 steps.";
    case "settings": return "A pad sets the pattern's last step; Shift + pad (or Shift latched) sets its first step. Rate and direction are in the Inspector.";
    case "patterns": return "One column per track. A pad edits that track's pattern; Shift + pad chains the track's patterns from its first one to that pad. ▲ ▼ show patterns 5–8 and 1–4.";
  }
}

type PadsProps = CircuitProps & { view: PadView; patternPage: 0 | 1; shift: boolean; onShiftUsed: () => void };

function Pads(p: PadsProps) {
  if (p.view === "patterns") return <PatternsGrid {...p} />;
  if (p.view === "settings") return <RangeGrid {...p} />;
  if (p.view === "velocity" || p.view === "gate") return <LevelGrid {...p} kind={p.view} />;
  return p.data.kind === "notes" ? <NoteGrid {...p} data={p.data} /> : <DrumPads {...p} data={p.data} />;
}

/** A pad grid's frame: four rows of eight, one roving tab stop, named for screen readers. */
function PadGrid({ label, cell }: { label: string; cell: (i: number, roving: ReturnType<typeof useRoving>) => ReactNode }) {
  const roving = useRoving(4, 8);
  return (
    <div role="grid" aria-label={label} aria-describedby="hw-help" className="grid">
      {[0, 1, 2, 3].map((r) => (
        <div role="row" key={r} className="contents">
          {Array.from({ length: 8 }, (_, c) => <div role="gridcell" key={c} className="contents">{cell(r * 8 + c, roving)}</div>)}
        </div>
      ))}
    </div>
  );
}

function NoteGrid(p: PadsProps & { data: NotePatternData }) {
  const playStep = usePlayStep(TRACK_NAMES.indexOf(p.track), p.pattern);
  const notes = stepMap(p.data.steps);
  const usedPitches = new Set([...notes.values()].flatMap((ns) => ns.map((n) => n.note)));
  const first = p.data.settings.firstStep, last = p.data.settings.lastStep;
  const stepAt = (cell: number): number => p.page * 16 + cell + 1;
  const keyAt = (cell: number): number | null => keyboardNote(p.scale, p.octave, cell - 16);
  const selected = p.selectedStep !== null ? notes.get(p.selectedStep) ?? [] : [];
  const playPage = playStep === null ? null : playStep > 16 ? 1 : 0;
  const { follow, page, onPage } = p;
  useEffect(() => { if (follow && playPage !== null && playPage !== page) onPage(playPage); }, [follow, playPage, page, onPage]);

  const pressKey = (key: number): void => {
    p.onCurrentNote(key);
    if (p.selectedStep === null) return;
    const change = toggleNote(notes, p.selectedStep, key);
    if (change) p.onNoteSteps([change], `${noteName(key)} on step ${p.selectedStep}`);
  };

  return (
    <PadGrid label={`${p.track} pattern ${p.pattern}: steps and keyboard`} cell={(cell, roving) => {
      const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
        const moved = roving.onKeyDown(cell, e);
        if (moved !== null) { if (moved < 16) p.onSelectStep(stepAt(moved)); return; }
        if (cell < 16 && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          const s = stepAt(cell);
          p.onSelectStep(s);
          p.onNoteSteps([toggleStep(notes, s, p.currentNote)], `step ${s}`);
        } else if (cell < 16 && (e.key === "Delete" || e.key === "Backspace")) {
          e.preventDefault();
          const s = stepAt(cell);
          if ((notes.get(s) ?? []).length) p.onNoteSteps([{ step: s, notes: [] }], `cleared step ${s}`);
        } else if (cell >= 16 && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          const key = keyAt(cell);
          if (key !== null) pressKey(key);
        }
      };
      if (cell < 16) {
        const s = stepAt(cell), ns = notes.get(s) ?? [], outside = s < first || s > last;
        return (
          <button ref={roving.ref(cell)} type="button" className="pad" tabIndex={roving.tabIndex(cell)}
            data-tip={`Step ${s}. Click an empty step to add the current note; click a lit one to select it, then press keys below to add or remove notes. Delete clears. The bar shows velocity.${outside ? " Dark: outside the pattern's first–last steps." : ""}`}
            style={ns.length ? ({ "--vel": Math.max(...ns.map((n) => n.velocity)) / 127 } as CSSProperties) : undefined}
            data-on={ns.length > 0} data-selected={p.selectedStep === s} data-outside={outside} data-playing={playStep === s}
            aria-pressed={ns.length > 0} aria-current={p.selectedStep === s}
            aria-label={`Step ${s}: ${ns.length ? ns.map((n) => noteSpoken(n.note)).join(", ") : "empty"}${outside ? ", outside the pattern" : ""}`}
            onClick={() => { roving.setActive(cell); p.onSelectStep(s); if (!ns.length) p.onNoteSteps([toggleStep(notes, s, p.currentNote)], `step ${s}`); }}
            onKeyDown={onKeyDown}>
            <span className="pad-num" aria-hidden="true">{s}</span>
            <span aria-hidden="true">{ns.length ? (ns.length === 1 ? noteName(ns[0]!.note) : `${ns.length} notes`) : ""}</span>
          </button>
        );
      }
      const key = keyAt(cell);
      if (key === null) {
        return (
          <button ref={roving.ref(cell)} type="button" className="pad key" tabIndex={roving.tabIndex(cell)} data-gap="true" data-tip="No sharp here: in Chromatic the pads are a piano, naturals below and sharps above." aria-label="No key here (piano layout)" aria-disabled="true"
            onClick={() => roving.setActive(cell)} onKeyDown={onKeyDown} />
        );
      }
      const held = selected.some((n) => n.note === key);
      return (
        <button ref={roving.ref(cell)} type="button" className="pad key" tabIndex={roving.tabIndex(cell)} data-tip={`${noteName(key)}: with a step selected, adds or removes this note there; it also becomes the current note new steps get. Pads follow the project's scale; the outlined pads are the root. Tinted: used in this pattern.`} data-black={isBlackKey(key)} data-root={key % 12 === 0} data-used={usedPitches.has(key)}
          aria-pressed={held} aria-label={`Key ${noteSpoken(key)}${held ? ", in the selected step" : ""}${key === p.currentNote ? ", current note" : ""}`}
          disabled={key > 127} onClick={() => { roving.setActive(cell); pressKey(key); }} onKeyDown={onKeyDown}>
          <span aria-hidden="true">{noteName(key)}{key === p.currentNote ? " ●" : ""}</span>
        </button>
      );
    }} />
  );
}

function DrumPads(p: PadsProps & { data: DrumPatternData }) {
  const playStep = usePlayStep(TRACK_NAMES.indexOf(p.track), p.pattern);
  const hits = new Map(p.data.steps.map((s) => [s.step, s]));
  const first = p.data.settings.firstStep, last = p.data.settings.lastStep;
  const toggle = (s: number): void => { p.onSelectStep(s); p.onDrumSteps([{ step: s, velocity: hits.has(s) ? 0 : 100 }], `${p.track} step ${s}`); };
  return (
    <PadGrid label={`${p.track} pattern ${p.pattern}: 32 steps`} cell={(cell, roving) => {
      const s = cell + 1, h = hits.get(s), outside = s < first || s > last;
      return (
        <button ref={roving.ref(cell)} type="button" className="pad" tabIndex={roving.tabIndex(cell)} data-tip={`Step ${s}: click to add or remove a hit. The Inspector edits its velocity, probability and micro-steps.`} style={h ? ({ "--vel": h.velocity / 127 } as CSSProperties) : undefined} data-on={!!h} data-selected={p.selectedStep === s} data-outside={outside} data-playing={playStep === s}
          aria-pressed={!!h} aria-current={p.selectedStep === s}
          aria-label={`Step ${s}: ${h ? `hit, velocity ${h.velocity}` : "empty"}${outside ? ", outside the pattern" : ""}`}
          onClick={() => { roving.setActive(cell); toggle(s); }}
          onKeyDown={(e) => {
            const moved = roving.onKeyDown(cell, e);
            if (moved !== null) { p.onSelectStep(moved + 1); return; }
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(s); }
          }}>
          <span className="pad-num" aria-hidden="true">{s}</span>
          <span aria-hidden="true">{h ? h.velocity : ""}</span>
        </button>
      );
    }} />
  );
}

/** Velocity or gate: rows 1–2 pick a step of the page, rows 3–4 are 16 levels for it. */
function LevelGrid(p: PadsProps & { kind: "velocity" | "gate" }) {
  const playStep = usePlayStep(TRACK_NAMES.indexOf(p.track), p.pattern);
  const notes = p.data.kind === "notes" ? stepMap(p.data.steps) : null;
  const hits = p.data.kind === "drums" ? new Map(p.data.steps.map((s) => [s.step, s])) : null;
  const stepAt = (cell: number): number => p.page * 16 + cell + 1;
  const sel = p.selectedStep;
  const selNotes = sel !== null && notes ? notes.get(sel) ?? [] : [];
  const selHit = sel !== null && hits ? hits.get(sel) : undefined;
  const has = (s: number): boolean => (notes ? (notes.get(s) ?? []).length > 0 : !!hits?.has(s));
  // The selected step's value as a level 1–16 (velocity: 8 per level; gate: one step per level).
  const value = p.kind === "velocity"
    ? (selNotes.length ? Math.max(...selNotes.map((n) => n.velocity)) : selHit?.velocity ?? 0)
    : (selNotes.length ? Math.max(...selNotes.map((n) => n.gate)) : 0);
  const level = p.kind === "velocity" ? Math.ceil((value * 16) / 127) : Math.ceil(value / 6);
  const unit = (k: number): number => (p.kind === "velocity" ? clamp(Math.round(((k + 1) * 127) / 16), 1, 127) : (k + 1) * 6);
  const setLevel = (k: number): void => {
    if (sel === null) return;
    const v = unit(k);
    if (notes && selNotes.length) {
      const prob = p.data.kind === "notes" ? p.data.steps.find((s) => s.step === sel)?.probability : undefined;
      p.onNoteSteps([{ step: sel, notes: selNotes.map((n) => ({ ...n, [p.kind]: v })), ...(prob !== undefined ? { probability: prob } : {}) }],
        `step ${sel} ${p.kind} ${p.kind === "velocity" ? v : `${k + 1} step${k ? "s" : ""}`}`);
    } else if (selHit) p.onDrumSteps([{ step: sel, velocity: v }], `${p.track} step ${sel} velocity ${v}`);
  };
  const label = `${p.track} pattern ${p.pattern}: pick a step, then its ${p.kind}`;
  return (
    <PadGrid label={label} cell={(cell, roving) => {
      const keys = (e: KeyboardEvent<HTMLButtonElement>, act: () => void): void => {
        const moved = roving.onKeyDown(cell, e);
        if (moved !== null) { if (moved < 16) p.onSelectStep(stepAt(moved)); return; }
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); }
      };
      if (cell < 16) {
        const s = stepAt(cell);
        return (
          <button ref={roving.ref(cell)} type="button" className="pad" tabIndex={roving.tabIndex(cell)} data-on={has(s)} data-selected={sel === s} data-playing={playStep === s}
            aria-current={sel === s} aria-label={`Step ${s}${has(s) ? "" : ", empty"}`} data-tip={`Step ${s}: pick it to set its ${p.kind} on the pads below.`}
            onClick={() => { roving.setActive(cell); p.onSelectStep(s); }} onKeyDown={(e) => keys(e, () => p.onSelectStep(s))}>
            <span className="pad-num" aria-hidden="true">{s}</span>
          </button>
        );
      }
      const k = cell - 16, ok = sel !== null && (selNotes.length > 0 || !!selHit);
      return (
        <button ref={roving.ref(cell)} type="button" className="pad level" tabIndex={roving.tabIndex(cell)} data-on={ok && k < level} aria-pressed={ok && k + 1 === level} aria-disabled={!ok || undefined}
          aria-label={`${p.kind === "velocity" ? `Velocity ${unit(k)}` : `Gate ${k + 1} step${k ? "s" : ""}`}`}
          data-tip={ok ? `Set step ${sel}'s ${p.kind} to ${p.kind === "velocity" ? unit(k) : `${k + 1} step${k ? "s" : ""}`}.` : "Pick a step with notes on the top rows first."}
          onClick={() => { roving.setActive(cell); if (ok) setLevel(k); }} onKeyDown={(e) => keys(e, () => { if (ok) setLevel(k); })}>
          <span className="pad-num" aria-hidden="true">{p.kind === "velocity" ? unit(k) : k + 1}</span>
        </button>
      );
    }} />
  );
}

/** Pattern settings: the 32 steps; a pad sets the last step, Shift + pad the first. */
function RangeGrid(p: PadsProps) {
  const { firstStep: first, lastStep: last } = p.data.settings;
  const set = (s: number, shift: boolean): void => {
    if (shift || p.shift) { p.onSettings(s > last ? { firstStep: s, lastStep: s } : { firstStep: s }); p.onShiftUsed(); }
    else p.onSettings(s < first ? { firstStep: s, lastStep: s } : { lastStep: s });
  };
  return (
    <PadGrid label={`${p.track} pattern ${p.pattern}: first and last step`} cell={(cell, roving) => {
      const s = cell + 1, inside = s >= first && s <= last;
      return (
        <button ref={roving.ref(cell)} type="button" className="pad range" tabIndex={roving.tabIndex(cell)} data-on={inside} data-edge={s === first || s === last}
          aria-label={`Step ${s}${s === first ? ", first step" : ""}${s === last ? ", last step" : ""}${inside ? "" : ", outside"}`}
          data-tip={`Step ${s}: click to end the pattern here; Shift + click to start it here.`}
          onClick={(e) => { roving.setActive(cell); set(s, e.shiftKey); }}
          onKeyDown={(e) => { if (roving.onKeyDown(cell, e) !== null) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set(s, e.shiftKey); } }}>
          <span className="pad-num" aria-hidden="true">{s}</span>
          <span aria-hidden="true">{s === first ? "First" : s === last ? "Last" : ""}</span>
        </button>
      );
    }} />
  );
}

/** Patterns: one column per track, four patterns per page; lit where a pattern has notes. */
function PatternsGrid(p: PadsProps) {
  const playing = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => usePlayingPattern(t)); // eslint-disable-line react-hooks/rules-of-hooks -- fixed count
  const used = new Map(p.summary.tracks.map((t) => [t.track, new Set(t.patternsWithNotes)]));
  return (
    <PadGrid label={`Patterns ${p.patternPage === 0 ? "1–4" : "5–8"} of every track`} cell={(cell, roving) => {
      const r = Math.floor(cell / 8), t = TRACK_NAMES[cell % 8]!, n = p.patternPage * 4 + r + 1;
      const chain = p.scenes?.currentChains[t];
      const inChain = !!chain && n >= chain.first && n <= chain.last, has = used.get(t)?.has(n) ?? false;
      const current = t === p.track && n === p.pattern;
      const act = (shift: boolean): void => {
        if ((shift || p.shift) && chain) { p.onChain(t, Math.min(chain.first, n), Math.max(chain.first, n)); p.onShiftUsed(); return; }
        p.onTrack(t); p.onPattern(n);
      };
      return (
        <button ref={roving.ref(cell)} type="button" className="pad pattern-pad" style={trackStyle(t)} tabIndex={roving.tabIndex(cell)}
          data-used={has} data-chain={inChain} data-selected={current} data-playing={playing[cell % 8] === n} aria-current={current}
          aria-label={`${t} pattern ${n}${has ? ", has notes" : ", empty"}${inChain ? ", in the chain" : ""}${playing[cell % 8] === n ? ", playing" : ""}`}
          data-tip={`${t} pattern ${n}: click to edit it; Shift + click to chain ${t}'s patterns up to it. Lit: has notes. Framed: in the chain. A bar: playing.`}
          onClick={(e) => { roving.setActive(cell); act(e.shiftKey); }}
          onKeyDown={(e) => { if (roving.onKeyDown(cell, e) !== null) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(e.shiftKey); } }}>
          <span className="pad-num" aria-hidden="true">{n}</span>
        </button>
      );
    }} />
  );
}
