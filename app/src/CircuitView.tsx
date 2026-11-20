// The device-like view: track buttons, pattern pads, the 4 × 8 pad grid and the macro knobs.
// Note tracks: rows 1–2 are 16 steps (page 1–16 or 17–32), rows 3–4 a 16-key keyboard laid out
// as on the device: in a scale, the bottom row climbs the scale from the root and the top row is
// the same an octave up; in Chromatic, a piano (naturals below, sharps above).
// Drum tracks: all 32 steps.
import type { CSSProperties, KeyboardEvent } from "react";
import { Knob } from "./ui/Knob.tsx";
import { useServiceData } from "./ui/useServiceData.ts";
import type { NoteStepIn, TrackName } from "@circuit-desk/core-service";
import type { DrumPatternData, NotePatternData, PatternData, Summary } from "./desk.ts";
import { SCALE_NAMES, type ScaleSetting } from "@circuit-desk/ncs";
import { isBlackKey, keyboardNote, listMove, noteName, noteSpoken, stepMap, toggleNote, toggleStep } from "./model.ts";
import { TRACK_NAMES, trackStyle } from "./tracks.ts";
import { useRoving } from "./useRoving.ts";
import { usePlayStep, usePlayingPattern } from "./playheads.ts";

export interface CircuitProps {
  projectId: string;
  version: number;
  /** Turn a macro knob of Synth 1 or 2: one undoable patch edit. */
  onMacro: (synth: 1 | 2, k: number, v: number) => void;
  summary: Summary;
  /** The project's scale; null until settings load (then a piano layout). */
  scale: ScaleSetting | null;
  track: TrackName;
  pattern: number;
  data: PatternData;
  selectedStep: number | null;
  page: 0 | 1;
  octave: number;
  currentNote: number;
  onPlayPattern: (n: number) => void;
  onTrack: (t: TrackName) => void;
  onPattern: (p: number) => void;
  onSelectStep: (s: number) => void;
  onPage: (p: 0 | 1) => void;
  onOctave: (o: number) => void;
  onCurrentNote: (n: number) => void;
  onNoteSteps: (steps: NoteStepIn[], label: string) => void;
  onDrumStep: (step: number, velocity: number, label: string) => void;
}

function RadioRow<T>({ label, items, value, onChange, render, className, itemClass, extra }: {
  label: string; items: readonly T[]; value: T; onChange: (v: T) => void; render: (v: T) => string; className: string; itemClass: string;
  extra?: (v: T) => Record<string, unknown>;
}) {
  const index = items.indexOf(value);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const to = listMove(i, e.key, items.length);
    const next = to === null ? undefined : items[to];
    if (to === null || next === undefined) return;
    e.preventDefault();
    onChange(next);
    (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {items.map((v, i) => (
        <button key={String(v)} type="button" role="radio" aria-checked={i === index} tabIndex={i === index ? 0 : -1} className={itemClass}
          onClick={() => onChange(v)} onKeyDown={(e) => onKey(e, i)} {...(extra?.(v) as object | undefined)}>{render(v)}</button>
      ))}
    </div>
  );
}

/**
 * The eight macro knobs of Synth 1 or 2's patch, at their stored positions. Turning one is one
 * undoable patch edit (the knob's resting position); moves over time are automation lanes 1–8 in the
 * Editor. MIDI and drum tracks have no patch here, so the knobs show as unavailable.
 */
function MacroKnobs({ projectId, version, track, onMacro }: { projectId: string; version: number; track: TrackName; onMacro: (synth: 1 | 2, k: number, v: number) => void }) {
  const synth = track === "Synth 1" ? 1 : track === "Synth 2" ? 2 : null;
  const patch = useServiceData(synth ? "getPatch" : null, [projectId, synth ?? 1], [projectId, synth, version]).data;
  return (
    <div className="knobs" role="group" aria-label={synth ? `Synth ${synth} macro knobs` : `Macro knobs (only Synth 1 and 2 have them)`}>
      {Array.from({ length: 8 }, (_, k) => (
        <Knob key={k} label={`Macro ${k + 1}`} value={patch?.values[`macro${k + 1}.position`] ?? 0} disabled={!synth || !patch}
          tip={synth ? `Macro ${k + 1} of Synth ${synth}'s patch: where the knob rests (an undoable patch edit). Arrows step it; Shift steps by 10. Its moves over time are automation lane ${k + 1} in the Editor.` : "Macro knobs belong to Synth 1 and 2's patches."}
          onCommit={(v) => { if (synth) onMacro(synth, k, v); }} />
      ))}
    </div>
  );
}

export function CircuitView(p: CircuitProps) {
  // The playhead comes from its own store (playheads.ts), so a step change redraws this view only.
  const playingPattern = usePlayingPattern(TRACK_NAMES.indexOf(p.track));
  const used = new Set(p.summary.tracks.find((t) => t.track === p.track)?.patternsWithNotes ?? []);
  return (
    <section className="device" aria-label="Circuit" style={trackStyle(p.track)}>
      <RadioRow label="Track" items={TRACK_NAMES} value={p.track} onChange={p.onTrack} render={(t) => t} className="tracks" itemClass="track-btn"
        extra={(t) => ({ style: trackStyle(t), "data-tip": `Show ${t}'s pattern on the grid${t.startsWith("Drum") ? " (32 steps)" : " (steps and keyboard)"}. Arrow keys move between tracks.` })} />
      <div>
        <RadioRow label="Pattern" items={[1, 2, 3, 4, 5, 6, 7, 8]} value={p.pattern} onChange={p.onPattern}
          render={(n) => `${n}${used.has(n) ? " •" : ""}`} className="patterns" itemClass="pattern-pad"
          extra={(n) => ({ "data-used": used.has(n), "data-playing": n === playingPattern, "data-tip": `Edit pattern ${n} of ${p.track}. A dot means it has notes; an outline means it is playing.`, "aria-label": `Pattern ${n}${used.has(n) ? ", has notes" : ", empty"}${n === playingPattern ? ", playing" : ""}` })} />
        <div className="row">
          <button type="button" className="btn btn-small" onClick={() => p.onPlayPattern(p.pattern)} data-tip="Play this pattern number on all eight tracks at once, looping (sets the play menu to One pattern).">▶ Play pattern {p.pattern} on all tracks</button>
        </div>
        {p.data.kind === "notes" ? <NoteGrid {...p} data={p.data} /> : <DrumPads {...p} data={p.data} />}
        <MacroKnobs projectId={p.projectId} version={p.version} track={p.track} onMacro={p.onMacro} />
      </div>
    </section>
  );
}

function NoteGrid(p: CircuitProps & { data: NotePatternData }) {
  const playStep = usePlayStep(TRACK_NAMES.indexOf(p.track), p.pattern);
  const notes = stepMap(p.data.steps);
  const usedPitches = new Set([...notes.values()].flatMap((ns) => ns.map((n) => n.note)));
  const roving = useRoving(4, 8);
  const first = p.data.settings.firstStep, last = p.data.settings.lastStep;
  const stepAt = (cell: number): number => p.page * 16 + cell + 1;
  const keyAt = (cell: number): number | null => keyboardNote(p.scale, p.octave, cell - 16);
  const keys = Array.from({ length: 16 }, (_, k) => keyboardNote(p.scale, p.octave, k)).filter((k): k is number => k !== null);
  const selected = p.selectedStep !== null ? notes.get(p.selectedStep) ?? [] : [];

  const pressKey = (key: number): void => {
    p.onCurrentNote(key);
    if (p.selectedStep === null) return;
    const change = toggleNote(notes, p.selectedStep, key);
    if (change) p.onNoteSteps([change], `${noteName(key)} on step ${p.selectedStep}`);
  };
  const onKeyDown = (cell: number, e: KeyboardEvent<HTMLButtonElement>): void => {
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

  return (
    <>
      <div className="row">
        <div role="group" aria-label="Step page" className="row">
          <button type="button" className="btn" aria-pressed={p.page === 0} onClick={() => p.onPage(0)} data-tip="Show steps 1–16 on the top two rows of pads.">Steps 1–16</button>
          <button type="button" className="btn" aria-pressed={p.page === 1} onClick={() => p.onPage(1)} data-tip="Show steps 17–32 (a pattern can be up to 32 steps long).">Steps 17–32</button>
        </div>
        <button type="button" className="btn" onClick={() => p.onOctave(Math.max(0, p.octave - 12))} disabled={p.octave <= 0} data-tip="Move the keyboard pads down an octave.">Octave ▼</button>
        <button type="button" className="btn" onClick={() => p.onOctave(Math.min(112, p.octave + 12))} disabled={p.octave >= 112} data-tip="Move the keyboard pads up an octave.">Octave ▲</button>
        <span className="hint">{p.scale ? `${SCALE_NAMES[p.scale.type]} · ` : ""}keys {noteName(Math.min(...keys))}–{noteName(Math.max(...keys))}</span>
      </div>
      <div role="grid" aria-label={`${p.track} pattern ${p.pattern}: steps and keyboard`} aria-describedby="note-grid-help" className="grid">
        {[0, 1, 2, 3].map((r) => (
          <div role="row" key={r} className="contents">
            {Array.from({ length: 8 }, (_, c) => {
              const cell = r * 8 + c;
              if (cell < 16) {
                const s = stepAt(cell), ns = notes.get(s) ?? [], outside = s < first || s > last;
                return (
                  <div role="gridcell" key={cell} className="contents">
                    <button ref={roving.ref(cell)} type="button" className="pad" tabIndex={roving.tabIndex(cell)}
                      data-tip={`Step ${s}. Click an empty step to add the current note; click a lit one to select it, then press keys below to add or remove notes. Delete clears. The bar shows velocity.${outside ? " Dark: outside the pattern's first–last steps." : ""}`}
                      style={ns.length ? ({ "--vel": Math.max(...ns.map((n) => n.velocity)) / 127 } as CSSProperties) : undefined}
                      data-on={ns.length > 0} data-selected={p.selectedStep === s} data-outside={outside} data-playing={playStep === s}
                      aria-pressed={ns.length > 0} aria-current={p.selectedStep === s}
                      aria-label={`Step ${s}: ${ns.length ? ns.map((n) => noteSpoken(n.note)).join(", ") : "empty"}${outside ? ", outside the pattern" : ""}`}
                      onClick={() => { roving.setActive(cell); p.onSelectStep(s); if (!ns.length) p.onNoteSteps([toggleStep(notes, s, p.currentNote)], `step ${s}`); }}
                      onKeyDown={(e) => onKeyDown(cell, e)}>
                      <span className="pad-num" aria-hidden="true">{s}</span>
                      <span aria-hidden="true">{ns.length ? (ns.length === 1 ? noteName(ns[0]!.note) : `${ns.length} notes`) : ""}</span>
                    </button>
                  </div>
                );
              }
              const key = keyAt(cell);
              if (key === null) {
                return (
                  <div role="gridcell" key={cell} className="contents">
                    <button ref={roving.ref(cell)} type="button" className="pad key" tabIndex={roving.tabIndex(cell)} data-gap="true" data-tip="No sharp here: in Chromatic the pads are a piano, naturals below and sharps above." aria-label="No key here (piano layout)" aria-disabled="true"
                      onClick={() => roving.setActive(cell)} onKeyDown={(e) => onKeyDown(cell, e)} />
                  </div>
                );
              }
              const held = selected.some((n) => n.note === key);
              return (
                <div role="gridcell" key={cell} className="contents">
                  <button ref={roving.ref(cell)} type="button" className="pad key" tabIndex={roving.tabIndex(cell)} data-tip={`${noteName(key)}: with a step selected, adds or removes this note there; it also becomes the current note new steps get. Pads follow the project's scale; the outlined pads are the root. Tinted: used in this pattern.`} data-black={isBlackKey(key)} data-root={key % 12 === 0} data-used={usedPitches.has(key)}
                    aria-pressed={held} aria-label={`Key ${noteSpoken(key)}${held ? ", in the selected step" : ""}${key === p.currentNote ? ", current note" : ""}`}
                    disabled={key > 127} onClick={() => { roving.setActive(cell); pressKey(key); }} onKeyDown={(e) => onKeyDown(cell, e)}>
                    <span aria-hidden="true">{noteName(key)}{key === p.currentNote ? " ●" : ""}</span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p id="note-grid-help" className="hint">
        Arrow keys move. On a step, Enter or Space puts the current note on an empty step or clears it; Delete clears. Clicking an empty step adds the current note.
        A key adds or removes that note in the selected step and becomes the current note.
      </p>
    </>
  );
}

function DrumPads(p: CircuitProps & { data: DrumPatternData }) {
  const playStep = usePlayStep(TRACK_NAMES.indexOf(p.track), p.pattern);
  const hits = new Map(p.data.steps.map((s) => [s.step, s]));
  const roving = useRoving(4, 8);
  const first = p.data.settings.firstStep, last = p.data.settings.lastStep;
  const toggle = (s: number): void => { p.onSelectStep(s); p.onDrumStep(s, hits.has(s) ? 0 : 100, `${p.track} step ${s}`); };
  return (
    <>
      <div role="grid" aria-label={`${p.track} pattern ${p.pattern}: 32 steps`} aria-describedby="drum-grid-help" className="grid">
        {[0, 1, 2, 3].map((r) => (
          <div role="row" key={r} className="contents">
            {Array.from({ length: 8 }, (_, c) => {
              const cell = r * 8 + c, s = cell + 1, h = hits.get(s), outside = s < first || s > last;
              return (
                <div role="gridcell" key={cell} className="contents">
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
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p id="drum-grid-help" className="hint">Arrow keys move; Enter, Space or a click adds or removes a hit. The inspector edits velocity, probability and micro-steps.</p>
    </>
  );
}

