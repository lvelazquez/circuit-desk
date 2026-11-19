// DAW-style editing: a piano roll with a velocity lane for note tracks, a drum grid for all four
// drums of a pattern. Every edit goes through the same service calls as the Circuit view, so the
// device's limits (6 notes a step, 32 steps, sixth-of-a-step timing) always hold.
import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { DrumStepIn, DrumTrackName, NoteStepIn, TrackName } from "@circuit-desk/core-service";
import type { DrumPatternData, NotePatternData } from "./desk.ts";
import { clamp, isBlackKey, moveNote, noteName, noteSpoken, rollRange, STEPS, stepMap, toggleNote, updateNote } from "./model.ts";
import { DRUM_NAMES, trackStyle } from "./tracks.ts";
import { useRoving } from "./useRoving.ts";

/** Grid positions go to CSS as counts; the sizes are the --size-roll-* tokens. */
const vars = (v: Record<string, number>): CSSProperties => Object.fromEntries(Object.entries(v).map(([k, x]) => [`--${k}`, String(x)])) as CSSProperties;
const tokenPx = (el: Element, name: string): number => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 1;
/** Notes are drawn at least this opaque, reaching full at velocity 127, so soft notes stay visible. */
const VELOCITY_ALPHA_FLOOR = 0.45;

export function PianoRoll({ track, pattern, data, onNoteSteps, onSelectStep }: {
  track: TrackName; pattern: number; data: NotePatternData;
  onNoteSteps: (steps: NoteStepIn[], label: string) => void; onSelectStep: (s: number) => void;
}) {
  const notes = stepMap(data.steps);
  const all = data.steps.flatMap((s) => s.notes.map((n) => ({ ...n, step: s.step })));
  const [cursor, setCursor] = useState<{ step: number; pitch: number }>(() => ({ step: 1, pitch: all[0]?.note ?? 60 }));
  const rows = rollRange([...all.map((n) => n.note), cursor.pitch]);
  const top = rows[0] ?? 127;
  const here = (notes.get(cursor.step) ?? []).find((n) => n.note === cursor.pitch);
  const { firstStep, lastStep } = data.settings;

  const move = (step: number, pitch: number): void => { const s = clamp(step, 1, STEPS); setCursor({ step: s, pitch: clamp(pitch, 0, 127) }); onSelectStep(s); };
  const toggle = (): void => {
    const c = toggleNote(notes, cursor.step, cursor.pitch);
    if (c) onNoteSteps([c], `${here ? "removed" : "added"} ${noteName(cursor.pitch)} on step ${cursor.step}`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const big = e.shiftKey ? 12 : 1;
    if (here && e.altKey && e.key.startsWith("Arrow")) {
      // Alt + arrows move the note under the cursor (Shift: by an octave).
      e.preventDefault();
      const to = e.key === "ArrowLeft" ? [cursor.step - 1, cursor.pitch] : e.key === "ArrowRight" ? [cursor.step + 1, cursor.pitch] : e.key === "ArrowUp" ? [cursor.step, cursor.pitch + big] : [cursor.step, cursor.pitch - big];
      const change = moveNote(notes, cursor.step, cursor.pitch, to[0]!, to[1]!);
      if (change) { onNoteSteps(change, `moved ${noteName(cursor.pitch)}`); move(to[0]!, to[1]!); }
      return;
    }
    switch (e.key) {
      case "ArrowLeft": e.preventDefault(); move(cursor.step - 1, cursor.pitch); return;
      case "ArrowRight": e.preventDefault(); move(cursor.step + 1, cursor.pitch); return;
      case "ArrowUp": e.preventDefault(); move(cursor.step, cursor.pitch + big); return;
      case "ArrowDown": e.preventDefault(); move(cursor.step, cursor.pitch - big); return;
      case "Enter": case " ": e.preventDefault(); toggle(); return;
      case "Delete": case "Backspace": if (here) { e.preventDefault(); toggle(); } return;
    }
    if (!here) return;
    const edit = (c: Partial<typeof here>, label: string): void => { const u = updateNote(notes, cursor.step, cursor.pitch, c); if (u) { e.preventDefault(); onNoteSteps([u], label); } };
    if (e.key === "[" || e.key === "{") edit({ gate: clamp(here.gate - (e.shiftKey ? 6 : 1), 1, 96) }, "shorter");
    if (e.key === "]" || e.key === "}") edit({ gate: clamp(here.gate + (e.shiftKey ? 6 : 1), 1, 96) }, "longer");
    if (e.key === "-" || e.key === "_") edit({ velocity: clamp(here.velocity - 8, 1, 127) }, "softer");
    if (e.key === "=" || e.key === "+") edit({ velocity: clamp(here.velocity + 8, 1, 127) }, "louder");
    if (e.key === ",") edit({ micro: clamp(here.micro - 1, 0, 5) }, "earlier");
    if (e.key === ".") edit({ micro: clamp(here.micro + 1, 0, 5) }, "later");
  };

  const at = (e: MouseEvent<HTMLDivElement>): { step: number; pitch: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    const stepPx = tokenPx(e.currentTarget, "--size-roll-step"), rowPx = tokenPx(e.currentTarget, "--size-roll-row");
    return { step: clamp(Math.floor((e.clientX - r.left) / stepPx) + 1, 1, STEPS), pitch: clamp(top - Math.floor((e.clientY - r.top) / rowPx), 0, 127) };
  };

  const velocities = Array.from({ length: STEPS }, (_, k) => Math.max(0, ...(notes.get(k + 1) ?? []).map((n) => n.velocity)));
  const described = here ? `${noteSpoken(here.note)}, velocity ${here.velocity}, length ${here.gate} sixths, offset ${here.micro}` : "no note";

  return (
    <section aria-label={`${track} pattern ${pattern} piano roll`} style={trackStyle(track)}>
      <div className="roll" tabIndex={0} role="application" aria-roledescription="piano roll" aria-label={`${track} pattern ${pattern} piano roll`}
        aria-describedby="roll-help" onKeyDown={onKeyDown}>
        <div className="roll-keys" aria-hidden="true">
          {rows.map((n) => <div key={n} className="roll-key" data-black={isBlackKey(n)}>{n % 12 === 0 ? noteName(n) : ""}</div>)}
        </div>
        <div className="roll-body" style={vars({ cols: STEPS })} aria-hidden="true"
          onClick={(e) => { const c = at(e); move(c.step, c.pitch); }}
          onDoubleClick={(e) => { const c = at(e); const t = toggleNote(notes, c.step, c.pitch); if (t) onNoteSteps([t], `step ${c.step}`); }}>
          {rows.map((n) => <div key={n} className="roll-row" data-black={isBlackKey(n)} />)}
          {Array.from({ length: STEPS }, (_, k) => (
            <div key={k} className="roll-col" data-beat={k % 4 === 0} data-outside={k + 1 < firstStep || k + 1 > lastStep} style={vars({ x: k })} />
          ))}
          {all.map((n) => (
            <div key={`${n.step}-${n.note}`} className="roll-note" data-selected={n.step === cursor.step && n.note === cursor.pitch}
              style={vars({ x: n.step - 1 + n.micro / 6, y: top - n.note, w: n.gate / 6, alpha: VELOCITY_ALPHA_FLOOR + ((1 - VELOCITY_ALPHA_FLOOR) * n.velocity) / 127 })} />
          ))}
          <div className="roll-cursor" style={vars({ x: cursor.step - 1, y: top - cursor.pitch })} />
        </div>
      </div>
      <div className="velocity-lane" aria-label="Velocity per step" role="img">
        {velocities.map((v, k) => <span key={k} title={v ? `Step ${k + 1}: ${v}` : undefined}><i style={vars({ level: v / 127 })} /></span>)}
      </div>
      <p className="visually-hidden" aria-live="polite">Step {cursor.step}, {noteSpoken(cursor.pitch)}: {described}</p>
      <p id="roll-help" className="hint">
        Arrows move the cursor (Shift: octave). Enter adds or removes a note; double-click does the same. On a note: Alt+arrows move it,
        [ and ] change its length (Shift: a whole step), − and = its velocity, comma and period its offset, Delete removes it.
      </p>
    </section>
  );
}

export function DrumGrid({ pattern, drums, selected, onSelect, onDrumSteps }: {
  pattern: number; drums: readonly DrumPatternData[]; selected: { drum: DrumTrackName; step: number } | null;
  onSelect: (drum: DrumTrackName, step: number) => void; onDrumSteps: (drum: DrumTrackName, steps: DrumStepIn[], label: string) => void;
}) {
  const roving = useRoving(4, STEPS);
  return (
    <section aria-label={`Drums, pattern ${pattern}`}>
      <div className="drum-scroll">
      <div role="grid" aria-label={`Drums, pattern ${pattern}`} aria-describedby="drumgrid-help" className="drum-grid">
        {DRUM_NAMES.map((name, r) => {
          const d = drums[r];
          const hits = new Map((d?.steps ?? []).map((s) => [s.step, s]));
          return (
            <div role="row" key={name} style={{ display: "contents", ...trackStyle(name) }}>
              <div role="rowheader" className="drum-name" style={trackStyle(name)}>{name}</div>
              {Array.from({ length: STEPS }, (_, k) => {
                const cell = r * STEPS + k, s = k + 1, h = hits.get(s);
                const toggle = (): void => { onSelect(name, s); onDrumSteps(name, [{ step: s, velocity: h ? 0 : 100 }], `${name} step ${s}`); };
                return (
                  <div role="gridcell" key={k} style={{ display: "contents" }}>
                    <button ref={roving.ref(cell)} type="button" className="drum-cell" style={trackStyle(name)} tabIndex={roving.tabIndex(cell)}
                      data-on={!!h} data-beat={k > 0 && k % 4 === 0} data-selected={selected?.drum === name && selected.step === s}
                      aria-pressed={!!h} aria-label={`${name} step ${s}: ${h ? `velocity ${h.velocity}` : "empty"}`}
                      onClick={() => { roving.setActive(cell); toggle(); }}
                      onFocus={() => onSelect(name, s)}
                      onKeyDown={(e) => { if (roving.onKeyDown(cell, e) !== null) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
                      <span aria-hidden="true">{h && h.microSteps.length > 1 ? h.microSteps.length : ""}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      </div>
      <p id="drumgrid-help" className="hint">Arrow keys move between drums and steps; Enter, Space or a click adds or removes a hit. The number on a hit is how many micro-steps sound.</p>
    </section>
  );
}
