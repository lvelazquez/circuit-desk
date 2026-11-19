// DAW-style editing: a piano roll with a velocity lane for note tracks, a drum grid for all four
// drums of a pattern. Every edit goes through the same service calls as the Circuit view, so the
// device's limits (6 notes a step, 32 steps, sixth-of-a-step timing) always hold.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { DrumStepIn, DrumTrackName, NoteStepIn, TrackName } from "@circuit-desk/core-service";
import { call, type Automation, type DrumPatternData, type NotePatternData } from "./desk.ts";
import { clamp, isBlackKey, moveNote, noteName, noteSpoken, rollRange, STEPS, stepMap, toggleNote, updateNote } from "./model.ts";
import { DRUM_NAMES, trackStyle } from "./tracks.ts";
import { useRoving } from "./useRoving.ts";

/** Grid positions go to CSS as counts; the sizes are the --size-roll-* tokens. */
const vars = (v: Record<string, number>): CSSProperties => Object.fromEntries(Object.entries(v).map(([k, x]) => [`--${k}`, String(x)])) as CSSProperties;
const tokenPx = (el: Element, name: string): number => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 1;
/** Grabbing a note this close to its end (in steps) resizes it instead of moving it. */
const RESIZE_ZONE = 0.35;

interface Drag { mode: "move" | "resize"; step: number; pitch: number; x0: number; p0: number; dStep: number; dPitch: number; dGate: number; moved: boolean }

/** Notes are drawn at least this opaque, reaching full at velocity 127, so soft notes stay visible. */
const VELOCITY_ALPHA_FLOOR = 0.45;

export function PianoRoll({ projectId, version, track, pattern, data, onNoteSteps, onSelectStep, playStep }: {
  projectId: string | null; version: number; track: TrackName; playStep: number | null; pattern: number; data: NotePatternData;
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

  /** Pointer position as a fractional step position (0 = start of step 1) and a pitch. */
  const where = (e: MouseEvent<HTMLDivElement>): { x: number; pitch: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    const stepPx = tokenPx(e.currentTarget, "--size-roll-step"), rowPx = tokenPx(e.currentTarget, "--size-roll-row");
    return { x: clamp((e.clientX - r.left) / stepPx, 0, STEPS - 0.001), pitch: clamp(top - Math.floor((e.clientY - r.top) / rowPx), 0, 127) };
  };
  const at = (e: MouseEvent<HTMLDivElement>): { step: number; pitch: number } => { const w = where(e); return { step: Math.floor(w.x) + 1, pitch: w.pitch }; };

  // Mouse: drag a note to move it, drag its end to change its length.
  const [drag, setDrag] = useState<Drag | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const w = where(e);
    const n = all.find((x) => x.note === w.pitch && w.x >= x.step - 1 + x.micro / 6 && w.x < x.step - 1 + x.micro / 6 + Math.max(x.gate / 6, RESIZE_ZONE * 2));
    if (!n) return;
    const end = n.step - 1 + n.micro / 6 + n.gate / 6;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ mode: end - w.x < RESIZE_ZONE ? "resize" : "move", step: n.step, pitch: n.note, x0: w.x, p0: w.pitch, dStep: 0, dPitch: 0, dGate: 0, moved: false });
    move(n.step, n.note);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag) return;
    const w = where(e);
    const next = drag.mode === "move"
      ? { ...drag, dStep: Math.round(w.x - drag.x0), dPitch: w.pitch - drag.p0 }
      : { ...drag, dGate: Math.round((w.x - drag.x0) * 6) };
    next.moved = drag.moved || next.dStep !== 0 || next.dPitch !== 0 || next.dGate !== 0;
    if (next.dStep !== drag.dStep || next.dPitch !== drag.dPitch || next.dGate !== drag.dGate || next.moved !== drag.moved) setDrag(next);
  };
  /** The click the browser fires after a drag must not move the cursor. */
  const dragged = useRef(false);
  const onPointerUp = (): void => {
    if (!drag) return;
    dragged.current = drag.moved;
    setDrag(null);
    if (drag.mode === "move" && (drag.dStep || drag.dPitch)) {
      const change = moveNote(notes, drag.step, drag.pitch, drag.step + drag.dStep, drag.pitch + drag.dPitch);
      if (change) { onNoteSteps(change, `moved ${noteName(drag.pitch)}`); move(drag.step + drag.dStep, drag.pitch + drag.dPitch); }
    } else if (drag.mode === "resize" && drag.dGate) {
      const n = (notes.get(drag.step) ?? []).find((x) => x.note === drag.pitch);
      const u = n ? updateNote(notes, drag.step, drag.pitch, { gate: clamp(n.gate + drag.dGate, 1, 96) }) : null;
      if (u) onNoteSteps([u], "length");
    }
  };
  const shown = (n: (typeof all)[number]): (typeof all)[number] => {
    if (!drag || n.step !== drag.step || n.note !== drag.pitch) return n;
    return drag.mode === "move" ? { ...n, step: n.step + drag.dStep, note: n.note + drag.dPitch } : { ...n, gate: clamp(n.gate + drag.dGate, 1, 96) };
  };
  const lane = useRef<HTMLDivElement | null>(null);

  const velocities = Array.from({ length: STEPS }, (_, k) => Math.max(0, ...(notes.get(k + 1) ?? []).map((n) => n.velocity)));
  const described = here ? `${noteSpoken(here.note)}, velocity ${here.velocity}, length ${here.gate} sixths, offset ${here.micro}` : "no note";

  return (
    <section aria-label={`${track} pattern ${pattern} piano roll`} style={trackStyle(track)}>
      <div className="roll" tabIndex={0} role="application" aria-roledescription="piano roll" aria-label={`${track} pattern ${pattern} piano roll`}
        aria-describedby="roll-help" onKeyDown={onKeyDown} onScroll={(e) => { if (lane.current) lane.current.scrollLeft = e.currentTarget.scrollLeft; }}>
        <div className="roll-keys" aria-hidden="true">
          {rows.map((n) => <div key={n} className="roll-key" data-black={isBlackKey(n)}>{n % 12 === 0 ? noteName(n) : ""}</div>)}
        </div>
        <div className="roll-body" style={vars({ cols: STEPS })} aria-hidden="true"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}
          data-dragging={drag?.mode}
          onClick={(e) => { if (dragged.current) { dragged.current = false; return; } const c = at(e); move(c.step, c.pitch); }}
          onDoubleClick={(e) => { const c = at(e); const t = toggleNote(notes, c.step, c.pitch); if (t) onNoteSteps([t], `step ${c.step}`); }}>
          {rows.map((n) => <div key={n} className="roll-row" data-black={isBlackKey(n)} />)}
          {Array.from({ length: STEPS }, (_, k) => (
            <div key={k} className="roll-col" data-beat={k % 4 === 0} data-outside={k + 1 < firstStep || k + 1 > lastStep} style={vars({ x: k })} />
          ))}
          {all.map(shown).map((n) => (
            <div key={`${n.step}-${n.note}`} className="roll-note" data-selected={n.step === cursor.step && n.note === cursor.pitch}
              style={vars({ x: n.step - 1 + n.micro / 6, y: top - n.note, w: n.gate / 6, alpha: VELOCITY_ALPHA_FLOOR + ((1 - VELOCITY_ALPHA_FLOOR) * n.velocity) / 127 })} />
          ))}
          {playStep !== null && <div className="roll-playhead" style={vars({ x: playStep - 1 })} />}
          <div className="roll-cursor" style={vars({ x: cursor.step - 1, y: top - cursor.pitch })} />
        </div>
      </div>
      <div className="velocity-lane-wrap" ref={lane}>
        <div className="velocity-lane" aria-label="Velocity per step" role="img">
          {velocities.map((v, k) => <span key={k} title={v ? `Step ${k + 1}: ${v}` : undefined}><i style={vars({ level: v / 127 })} /></span>)}
        </div>
        <AutomationLanes projectId={projectId} version={version} track={track} pattern={pattern} />
      </div>
      <p className="visually-hidden" aria-live="polite">Step {cursor.step}, {noteSpoken(cursor.pitch)}: {described}</p>
      <p id="roll-help" className="hint">
        Arrows move the cursor (Shift: octave). Enter adds or removes a note; double-click does the same. Drag a note to move it, or its end to change its length. On a note: Alt+arrows move it,
        [ and ] change its length (Shift: a whole step), − and = its velocity, comma and period its offset, Delete removes it.
      </p>
    </section>
  );
}

export function DrumGrid({ pattern, drums, selected, onSelect, onDrumSteps, playSteps }: {
  pattern: number; playSteps: (number | null)[]; drums: readonly DrumPatternData[]; selected: { drum: DrumTrackName; step: number } | null;
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
                      data-on={!!h} data-beat={k > 0 && k % 4 === 0} data-selected={selected?.drum === name && selected.step === s} data-playing={playSteps[r] === s}
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

/** Read-only automation lanes, aligned with the piano roll: 6 points a step, 0–127, gaps where none. */
function AutomationLanes({ projectId, version, track, pattern }: { projectId: string | null; version: number; track: TrackName; pattern: number }) {
  const [auto, setAuto] = useState<Automation | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void call("getAutomation", projectId, track, pattern).then((a) => { if (live) setAuto(a); }, () => { if (live) setAuto(null); });
    return () => { live = false; };
  }, [projectId, version, track, pattern]);
  if (!auto) return null;
  if (!auto.lanes.length) return <p className="lane-note">No automation in this pattern.</p>;
  return (
    <div className="automation" aria-label={`Automation, ${auto.lanes.length} of ${auto.laneCount} lanes in use (read-only; ${auto.evidence})`} role="group">
      {auto.lanes.map((l) => {
        const vals = l.points.filter((v): v is number => v !== null);
        const steps = l.points.flatMap((v, k) => (v === null ? [] : [Math.floor(k / 6) + 1]));
        return (
          <div key={l.lane} className="lane-row">
            <div className="lane-points" role="img"
              aria-label={`Lane ${l.lane}, ${l.name}: ${vals.length} points, values ${Math.min(...vals)}–${Math.max(...vals)}, steps ${steps[0]}–${steps.at(-1)}`}>
              {l.points.map((v, k) => <i key={k} data-empty={v === null} style={vars({ level: (v ?? 0) / 127 })} />)}
            </div>
            <span className="lane-name" aria-hidden="true">{l.lane}. {l.name}</span>
          </div>
        );
      })}
    </div>
  );
}
