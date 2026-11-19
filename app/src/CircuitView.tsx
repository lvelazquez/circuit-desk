// The device-like view: track buttons, pattern pads, the 4 × 8 pad grid and the macro knobs.
// Note tracks: rows 1–2 are 16 steps (page 1–16 or 17–32), rows 3–4 a 16-key keyboard.
// Drum tracks: all 32 steps.
import type { KeyboardEvent } from "react";
import type { NoteStepIn, TrackName } from "@circuit-desk/core-service";
import type { DrumPatternData, NotePatternData, PatternData, Summary } from "./desk.ts";
import { isBlackKey, noteName, noteSpoken, stepMap, toggleNote, toggleStep } from "./model.ts";
import { TRACK_NAMES, trackStyle } from "./tracks.ts";
import { useRoving } from "./useRoving.ts";

export interface CircuitProps {
  summary: Summary;
  track: TrackName;
  pattern: number;
  data: PatternData;
  selectedStep: number | null;
  page: 0 | 1;
  octave: number;
  currentNote: number;
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
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = items[(i + d + items.length) % items.length];
    if (next !== undefined) { onChange(next); (e.currentTarget.parentElement?.children[(i + d + items.length) % items.length] as HTMLElement | undefined)?.focus(); }
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

export function CircuitView(p: CircuitProps) {
  const used = new Set(p.summary.tracks.find((t) => t.track === p.track)?.patternsWithNotes ?? []);
  return (
    <section className="device" aria-label="Circuit" style={trackStyle(p.track)}>
      <RadioRow label="Track" items={TRACK_NAMES} value={p.track} onChange={p.onTrack} render={(t) => t} className="tracks" itemClass="track-btn"
        extra={(t) => ({ style: trackStyle(t) })} />
      <div>
        <RadioRow label="Pattern" items={[1, 2, 3, 4, 5, 6, 7, 8]} value={p.pattern} onChange={p.onPattern}
          render={(n) => `${n}${used.has(n) ? " •" : ""}`} className="patterns" itemClass="pattern-pad"
          extra={(n) => ({ "data-used": used.has(n), "aria-label": `Pattern ${n}${used.has(n) ? ", has notes" : ", empty"}` })} />
        {p.data.kind === "notes" ? <NoteGrid {...p} data={p.data} /> : <DrumPads {...p} data={p.data} />}
        <div className="knobs" aria-label="Macro knobs (read-only: synth patches are not decoded yet)" role="group">
          {Array.from({ length: 8 }, (_, k) => <div key={k} className="knob" aria-disabled="true"><span aria-hidden="true" /><span>Macro {k + 1}</span></div>)}
        </div>
      </div>
    </section>
  );
}

function NoteGrid(p: CircuitProps & { data: NotePatternData }) {
  const notes = stepMap(p.data.steps);
  const roving = useRoving(4, 8);
  const first = p.data.settings.firstStep, last = p.data.settings.lastStep;
  const stepAt = (cell: number): number => p.page * 16 + cell + 1;
  const keyAt = (cell: number): number => p.octave + (cell - 16);
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
      pressKey(keyAt(cell));
    }
  };

  return (
    <>
      <div className="row">
        <div role="group" aria-label="Step page" className="row">
          <button type="button" className="btn" aria-pressed={p.page === 0} onClick={() => p.onPage(0)}>Steps 1–16</button>
          <button type="button" className="btn" aria-pressed={p.page === 1} onClick={() => p.onPage(1)}>Steps 17–32</button>
        </div>
        <button type="button" className="btn" onClick={() => p.onOctave(Math.max(0, p.octave - 12))} disabled={p.octave <= 0}>Octave ▼</button>
        <button type="button" className="btn" onClick={() => p.onOctave(Math.min(112, p.octave + 12))} disabled={p.octave >= 112}>Octave ▲</button>
        <span className="hint">Keys {noteName(p.octave)}–{noteName(p.octave + 15)}</span>
      </div>
      <div role="grid" aria-label={`${p.track} pattern ${p.pattern}: steps and keyboard`} aria-describedby="note-grid-help" className="grid">
        {[0, 1, 2, 3].map((r) => (
          <div role="row" key={r} style={{ display: "contents" }}>
            {Array.from({ length: 8 }, (_, c) => {
              const cell = r * 8 + c;
              if (cell < 16) {
                const s = stepAt(cell), ns = notes.get(s) ?? [], outside = s < first || s > last;
                return (
                  <div role="gridcell" key={cell} style={{ display: "contents" }}>
                    <button ref={roving.ref(cell)} type="button" className="pad" tabIndex={roving.tabIndex(cell)}
                      data-on={ns.length > 0} data-selected={p.selectedStep === s} data-outside={outside}
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
              const key = keyAt(cell), held = selected.some((n) => n.note === key);
              return (
                <div role="gridcell" key={cell} style={{ display: "contents" }}>
                  <button ref={roving.ref(cell)} type="button" className="pad key" tabIndex={roving.tabIndex(cell)} data-black={isBlackKey(key)}
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
  const hits = new Map(p.data.steps.map((s) => [s.step, s]));
  const roving = useRoving(4, 8);
  const first = p.data.settings.firstStep, last = p.data.settings.lastStep;
  const toggle = (s: number): void => { p.onSelectStep(s); p.onDrumStep(s, hits.has(s) ? 0 : 100, `${p.track} step ${s}`); };
  return (
    <>
      <div role="grid" aria-label={`${p.track} pattern ${p.pattern}: 32 steps`} aria-describedby="drum-grid-help" className="grid">
        {[0, 1, 2, 3].map((r) => (
          <div role="row" key={r} style={{ display: "contents" }}>
            {Array.from({ length: 8 }, (_, c) => {
              const cell = r * 8 + c, s = cell + 1, h = hits.get(s), outside = s < first || s > last;
              return (
                <div role="gridcell" key={cell} style={{ display: "contents" }}>
                  <button ref={roving.ref(cell)} type="button" className="pad" tabIndex={roving.tabIndex(cell)} data-on={!!h} data-selected={p.selectedStep === s} data-outside={outside}
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
