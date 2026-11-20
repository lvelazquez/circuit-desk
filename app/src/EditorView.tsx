// DAW-style editing: a piano roll with a velocity lane for note tracks, a drum grid for all four
// drums of a pattern. Every edit goes through the same service calls as the Circuit view, so the
// device's limits (6 notes a step, 32 steps, sixth-of-a-step timing) always hold.
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { DrumStepIn, DrumTrackName, NoteStepIn, TrackName } from "@circuit-desk/core-service";
import { call, type Automation, type DrumPatternData, type NotePatternData } from "./desk.ts";
import { clamp, isBlackKey, moveNote, noteName, noteSpoken, rollRange, STEPS, stepMap, toggleNote, updateNote } from "./model.ts";
import { DRUM_NAMES, TRACK_NAMES, trackStyle } from "./tracks.ts";
import { usePlayStep, usePlaySteps } from "./playheads.ts";
import { useRoving } from "./useRoving.ts";

/** Grid positions go to CSS as counts; the sizes are the --size-roll-* tokens. */
const vars = (v: Record<string, number>): CSSProperties => Object.fromEntries(Object.entries(v).map(([k, x]) => [`--${k}`, String(x)])) as CSSProperties;
const tokenPx = (el: Element, name: string): number => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 1;
/** Grabbing a note this close to its end (in steps) resizes it instead of moving it. */
const RESIZE_ZONE = 0.35;

interface Drag { mode: "move" | "resize"; step: number; pitch: number; x0: number; p0: number; dStep: number; dPitch: number; dGate: number; moved: boolean }

/** Notes are drawn at least this opaque, reaching full at velocity 127, so soft notes stay visible. */
/** Drum 1–4 are tracks 4–7 in the playhead store. */
const DRUM_TRACKS = [4, 5, 6, 7] as const;

export function PianoRoll({ projectId, version, track, pattern, data, onNoteSteps, onSelectStep, onLaneEdit }: {
  projectId: string | null; version: number; track: TrackName; pattern: number; data: NotePatternData;
  onNoteSteps: (steps: NoteStepIn[], label: string) => void; onSelectStep: (s: number) => void; onLaneEdit: LaneEdit;
}) {
  const playStep = usePlayStep(TRACK_NAMES.indexOf(track), pattern);
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
  // The live drag is in a ref: pointer events can arrive before React re-renders, and a handler that
  // read stale state would drop the move (and the click after it would move the cursor instead).
  // The state copy is only for drawing.
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null): void => { dragRef.current = d; setDragState(d); };
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
    const drag = dragRef.current;
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
    const drag = dragRef.current;
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
      <div className="roll" tabIndex={0} role="application" data-tip="Piano roll: arrows move the cursor, Enter or a double-click adds or removes a note, drag a note to move it or its end to resize it. Full keys below." aria-roledescription="piano roll" aria-label={`${track} pattern ${pattern} piano roll`}
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
              style={vars({ x: n.step - 1 + n.micro / 6, y: top - n.note, w: n.gate / 6, vel: n.velocity / 127 })} />
          ))}
          {playStep !== null && <div className="roll-playhead" style={vars({ x: playStep - 1 })} />}
          <div className="roll-cursor" style={vars({ x: cursor.step - 1, y: top - cursor.pitch })} />
        </div>
      </div>
      <div className="velocity-lane-wrap" ref={lane}>
        <div className="velocity-lane" aria-label="Velocity per step" role="img">
          {velocities.map((v, k) => <span key={k} title={v ? `Step ${k + 1}: ${v}` : undefined}><i style={vars({ level: v / 127 })} /></span>)}
        </div>
        <AutomationLanes projectId={projectId} version={version} track={track} pattern={pattern} onLaneEdit={onLaneEdit} />
      </div>
      <p className="visually-hidden" aria-live="polite">Step {cursor.step}, {noteSpoken(cursor.pitch)}: {described}</p>
      <p id="roll-help" className="hint">
        Arrows move the cursor (Shift: octave). Enter adds or removes a note; double-click does the same. Drag a note to move it, or its end to change its length. On a note: Alt+arrows move it,
        [ and ] change its length (Shift: a whole step), − and = its velocity, comma and period its offset, Delete removes it.
      </p>
    </section>
  );
}

export function DrumGrid({ pattern, drums, selected, onSelect, onDrumSteps }: {
  pattern: number; drums: readonly DrumPatternData[]; selected: { drum: DrumTrackName; step: number } | null;
  onSelect: (drum: DrumTrackName, step: number) => void; onDrumSteps: (drum: DrumTrackName, steps: DrumStepIn[], label: string) => void;
}) {
  const playSteps = usePlaySteps(DRUM_TRACKS, pattern);
  const roving = useRoving(4, STEPS);
  return (
    <section aria-label={`Drums, pattern ${pattern}`}>
      <div className="drum-scroll">
      <div role="grid" aria-label={`Drums, pattern ${pattern}`} aria-describedby="drum-grid-help" className="drum-grid">
        {DRUM_NAMES.map((name, r) => {
          const d = drums[r];
          const hits = new Map((d?.steps ?? []).map((s) => [s.step, s]));
          return (
            <div role="row" key={name} className="contents" style={trackStyle(name)}>
              <div role="rowheader" className="drum-name" style={trackStyle(name)}>{name}</div>
              {Array.from({ length: STEPS }, (_, k) => {
                const cell = r * STEPS + k, s = k + 1, h = hits.get(s);
                const toggle = (): void => { onSelect(name, s); onDrumSteps(name, [{ step: s, velocity: h ? 0 : 100 }], `${name} step ${s}`); };
                return (
                  <div role="gridcell" key={k} className="contents">
                    <button ref={roving.ref(cell)} type="button" className="drum-cell" style={trackStyle(name)} tabIndex={roving.tabIndex(cell)} data-tip={`${name} step ${s}: click to add or remove a hit; the Inspector edits it. A number means extra micro-step hits.`}
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
      <p id="drum-grid-help" className="hint">Arrow keys move between drums and steps; Enter, Space or a click adds or removes a hit. The number on a hit is how many micro-steps sound.</p>
    </section>
  );
}

/** Edits one lane: 192 points (32 steps × 6), each 0–127 or empty. */
export type LaneEdit = (track: TrackName, lane: number, points: (number | null)[], label: string) => void;

const LANE_POINTS = 192;
/** An empty automation lane, shared so a lane with no points keeps the same array between renders. */
const EMPTY_LANE: readonly (number | null)[] = Object.freeze(new Array<number | null>(LANE_POINTS).fill(null));

/**
 * The pattern's automation lanes, aligned with the piano roll: 6 points a step, 0–127, gaps where
 * none. Drawn with the pointer or edited from the keyboard; each change is one undoable edit.
 */
export function AutomationLanes({ projectId, version, track, pattern, onLaneEdit }: {
  projectId: string | null; version: number; track: TrackName; pattern: number; onLaneEdit: LaneEdit;
}) {
  const [auto, setAuto] = useState<Automation | null>(null);
  const [added, setAdded] = useState<number[]>([]);
  const helpId = useId();
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void call("getAutomation", projectId, track, pattern).then((a) => { if (live) setAuto(a); }, () => { if (live) setAuto(null); });
    return () => { live = false; };
  }, [projectId, version, track, pattern]);
  useEffect(() => setAdded([]), [track, pattern]);
  if (!auto) return null;
  const shown = [...new Set([...auto.lanes.map((l) => l.lane), ...added])].sort((x, y) => x - y);
  const free = auto.names.map((name, k) => ({ lane: k + 1, name })).filter((x) => !shown.includes(x.lane));
  return (
    <div className="automation" role="group" aria-label={`Automation of ${track} pattern ${pattern}, ${auto.lanes.length} of ${auto.laneCount} lanes in use (${auto.evidence})`}>
      <p className="lane-note">These lanes play in the built-in preview and go to a Circuit as CC. A value holds until the next point.</p>
      {shown.map((lane) => (
        <LaneEditor key={`${track}-${pattern}-${lane}`} lane={lane} name={auto.names[lane - 1] ?? `Lane ${lane}`}
          points={auto.lanes.find((l) => l.lane === lane)?.points ?? EMPTY_LANE} helpId={helpId}
          onCommit={(pts, label) => onLaneEdit(track, lane, pts, label)} />
      ))}
      {free.length > 0 && (
        <label className="row lane-add">
          <span>Add a lane</span>
          <select data-tip="Show another automation lane to draw in: macros, level, pan, sends, or drum knobs." value="" onChange={(e) => { const n = Number(e.target.value); if (n) setAdded((a) => [...a, n]); }}>
            <option value="">Choose…</option>
            {free.map((f) => <option key={f.lane} value={f.lane}>{f.lane}. {f.name}</option>)}
          </select>
        </label>
      )}
      <p id={helpId} className="hint">
        Click or drag in a lane to draw (Alt erases). In a focused lane, arrows move the cursor (Shift: a whole step); Up and Down change the value (Shift: by 10);
        Delete removes the point (Shift: the whole step); Enter fills the step with the cursor's value.
      </p>
    </div>
  );
}

/** The value in force at point k: the point itself, else the last one before it, else `fallback`. */
function heldAt(points: readonly (number | null)[], k: number, fallback: number): number {
  for (let i = k; i >= 0; i--) { const v = points[i]; if (v !== null && v !== undefined) return v; }
  return fallback;
}

function LaneEditor({ lane, name, points, helpId, onCommit }: { lane: number; name: string; points: readonly (number | null)[]; helpId: string; onCommit: (pts: (number | null)[], label: string) => void }) {
  const [draft, setDraft] = useState<(number | null)[] | null>(null);
  const draftRef = useRef<(number | null)[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ last: number; lastValue: number; erase: boolean } | null>(null);
  // The saved lane arrived: drop the local drawing.
  useEffect(() => { setDraft(null); draftRef.current = null; }, [points]);
  const shown = draft ?? points;
  const put = (next: (number | null)[]): void => { draftRef.current = next; setDraft(next); };
  const at = (e: PointerEvent<HTMLDivElement>): { k: number; v: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return { k: clamp(Math.floor(((e.clientX - r.left) / r.width) * LANE_POINTS), 0, LANE_POINTS - 1), v: clamp(Math.round((1 - (e.clientY - r.top) / r.height) * 127), 0, 127) };
  };
  const where = (k: number): string => `step ${Math.floor(k / 6) + 1}.${(k % 6) + 1}`;
  const commit = (next: (number | null)[], label: string): void => { put(next); onCommit(next, `${name}: ${label}`); };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    const { k, v } = at(e), next = [...shown];
    next[k] = e.altKey ? null : v;
    drag.current = { last: k, lastValue: v, erase: e.altKey };
    put(next); setCursor(k);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    const { k, v } = at(e), next = [...(draftRef.current ?? shown)];
    // A straight line from the last pointer position, so a fast drag leaves no gaps or steps.
    const span = Math.abs(k - d.last) || 1;
    for (let i = Math.min(k, d.last); i <= Math.max(k, d.last); i++) {
      if (i === d.last && k !== d.last) continue;
      next[i] = d.erase ? null : Math.round(d.lastValue + ((v - d.lastValue) * Math.abs(i - d.last)) / span);
    }
    d.last = k; d.lastValue = v;
    put(next); setCursor(k);
  };
  const onPointerUp = (): void => {
    const d = drag.current;
    drag.current = null;
    if (d && draftRef.current) onCommit(draftRef.current, `${name}: ${d.erase ? "erased" : "drew"} points`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey || e.metaKey || e.ctrlKey ? 6 : 1;
    const value = heldAt(shown, cursor, 64);
    let next: (number | null)[] | null = null, label = "";
    switch (e.key) {
      case "ArrowLeft": setCursor((c) => clamp(c - step, 0, LANE_POINTS - 1)); break;
      case "ArrowRight": setCursor((c) => clamp(c + step, 0, LANE_POINTS - 1)); break;
      case "Home": setCursor(0); break;
      case "End": setCursor(LANE_POINTS - 1); break;
      case "ArrowUp": case "ArrowDown": {
        const v = clamp(value + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, 127);
        next = [...shown]; next[cursor] = v; label = `${v} at ${where(cursor)}`; break;
      }
      case "Delete": case "Backspace": {
        next = [...shown];
        if (e.shiftKey) { const s0 = cursor - (cursor % 6); for (let i = s0; i < s0 + 6; i++) next[i] = null; label = `cleared step ${s0 / 6 + 1}`; }
        else { next[cursor] = null; label = `removed the point at ${where(cursor)}`; }
        break;
      }
      case "Enter": {
        next = [...shown]; const s0 = cursor - (cursor % 6);
        for (let i = s0; i < s0 + 6; i++) next[i] = value;
        label = `filled step ${s0 / 6 + 1} with ${value}`; break;
      }
      default: return;
    }
    e.preventDefault();
    if (next) commit(next, label);
  };

  const vals = shown.filter((v): v is number => v !== null);
  const summary = vals.length ? `${vals.length} points, values ${Math.min(...vals)}–${Math.max(...vals)}` : "empty";
  const here = shown[cursor];
  return (
    <div className="lane-row">
      <div ref={ref} className="lane-points" tabIndex={0} role="group" data-focused={focused} data-tip={`Lane ${lane}, ${name}: drag to draw (Alt erases). Focused: Left/Right move, Up/Down change the value, Delete removes. A value holds until the next point; 6 points per step.`}
        aria-label={`Lane ${lane}, ${name}: ${summary}`} aria-describedby={helpId}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
        {shown.map((v, k) => <i key={k} data-empty={v === null} data-cursor={focused && k === cursor} style={vars({ level: (v ?? 0) / 127 })} />)}
      </div>
      <span className="lane-name">
        {lane}. {name}{focused ? ` · ${where(cursor)}: ${here ?? "no point"}` : ""}
        {/* Always present, so the row keeps its height while drawing starts. */}
        <button type="button" className="btn btn-small" data-tip="Remove every point of this lane (one undoable edit)." disabled={!vals.length} onClick={() => commit(new Array<number | null>(LANE_POINTS).fill(null), "cleared the lane")}>Clear lane {lane}</button>
      </span>
      <span className="visually-hidden" aria-live="polite">{focused ? `${where(cursor)}: ${here ?? "no point"}` : ""}</span>
    </div>
  );
}

/** The automation lanes of one drum of the pattern, chosen from the four. */
export function DrumAutomation({ projectId, version, pattern, onLaneEdit }: { projectId: string | null; version: number; pattern: number; onLaneEdit: LaneEdit }) {
  const [drum, setDrum] = useState<DrumTrackName>("Drum 1");
  return (
    <section aria-label="Drum automation" className="drum-automation">
      <label className="row">
        <span>Automation of</span>
        <select data-tip="Which drum's automation lanes to show below." value={drum} onChange={(e) => setDrum(e.target.value as DrumTrackName)}>
          {DRUM_NAMES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      <AutomationLanes projectId={projectId} version={version} track={drum} pattern={pattern} onLaneEdit={onLaneEdit} />
    </section>
  );
}
