// Edits the selected step (notes or drum hit), the pattern's length and rate, and the track's chain.
import type { Direction, DrumStepIn, NoteOut, NoteStepIn, SyncRate, TrackName } from "@circuit-desk/core-service";
import type { PatternData, Scenes } from "./desk.ts";
import { DEFAULT_NOTE, getNoteRoot, MAX_NOTES, noteName, stepMap } from "./model.ts";
import { NumberField } from "./NumberField.tsx";

const SYNC_RATES: readonly SyncRate[] = ["1/32T", "1/32", "1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4"];
const DIRECTIONS: readonly { value: Direction; label: string }[] = [
  { value: "forward", label: "Forward" }, { value: "reverse", label: "Reverse" }, { value: "ping-pong", label: "Ping-pong" }, { value: "random", label: "Random" },
];

export interface InspectorProps {
  track: TrackName;
  pattern: number;
  data: PatternData;
  step: number | null;
  scenes: Scenes | null;
  currentNote: number;
  onNoteSteps: (steps: NoteStepIn[], label: string) => void;
  onDrumSteps: (steps: DrumStepIn[], label: string) => void;
  onSettings: (s: { firstStep?: number; lastStep?: number; syncRate?: SyncRate; direction?: Direction }) => void;
  onChain: (first: number, last: number) => void;
}

export function Inspector(p: InspectorProps) {
  const chain = p.scenes?.currentChains[p.track];
  return (
    <aside className="panel inspector" aria-label="Inspector">
      <h2>Step</h2>
      {p.step === null ? <p className="hint">Select a step.</p> : p.data.kind === "notes" ? <NoteStep {...p} step={p.step} /> : <DrumStep {...p} step={p.step} />}

      <h2>Pattern {p.pattern}</h2>
      <fieldset>
        <legend>Length and rate</legend>
        <div className="row">
          <NumberField tip="The step the pattern starts on. Steps before it are skipped (shown dark)." label="First step" value={p.data.settings.firstStep} min={1} max={32} onCommit={(v) => p.onSettings({ firstStep: v })} />
          <NumberField tip="The step the pattern ends on before it repeats; with First step, its length." label="Last step" value={p.data.settings.lastStep} min={1} max={32} onCommit={(v) => p.onSettings({ lastStep: v })} />
        </div>
        <div className="row">
          <label>Sync rate
            <select data-tip="How long one step lasts: 1/16 is the default; T means triplet. Slower rates stretch the pattern." value={p.data.settings.syncRate} onChange={(e) => p.onSettings({ syncRate: e.target.value as SyncRate })}>
              {SYNC_RATES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label>Direction
            <select data-tip="Play order: forward, reverse, ping-pong (alternates direction each time round) or random (a random step at every step)." value={p.data.settings.direction} onChange={(e) => p.onSettings({ direction: e.target.value as Direction })}>
              {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      <h2>{p.track} chain</h2>
      {chain ? (
        <fieldset>
          <legend>Patterns played in turn</legend>
          <div className="row">
            <NumberField tip="The first pattern of this track's chain: patterns From–To play one after another." label="From" value={chain.first} min={1} max={8} onCommit={(v) => p.onChain(v, Math.max(v, chain.last))} />
            <NumberField tip="The last pattern of this track's chain." label="To" value={chain.last} min={1} max={8} onCommit={(v) => p.onChain(Math.min(v, chain.first), v)} />
          </div>
        </fieldset>
      ) : <p className="hint">Loading…</p>}
    </aside>
  );
}

function NoteStep(p: InspectorProps & { step: number }) {
  if (p.data.kind !== "notes") return null;
  const notes = stepMap(p.data.steps).get(p.step) ?? [];
  const root = getNoteRoot();
  const probability = p.data.steps.find((s) => s.step === p.step)?.probability ?? 7;
  const write = (next: NoteOut[], label: string, prob?: number): void =>
    p.onNoteSteps([{ step: p.step, notes: next, ...(prob !== undefined ? { probability: prob } : {}) }], label);
  const change = (i: number, c: Partial<NoteOut>): void => write(notes.map((n, k) => (k === i ? { ...n, ...c } : n)), `step ${p.step}`);
  const free = [p.currentNote, ...Array.from({ length: 128 }, (_, k) => k)].find((k) => !notes.some((n) => n.note === k)) ?? 60;
  return (
    <fieldset>
      <legend>Step {p.step}: {notes.length ? `${notes.length} of ${MAX_NOTES} notes` : "empty"}</legend>
      {notes.length > 0 && (
        <div className="note-row hint" aria-hidden="true"><span>Note</span><span>Pitch</span><span>Velocity</span><span>Gate ⅙</span><span>Micro ⅙</span><span /></div>
      )}
      {notes.map((n, i) => (
        <div className="note-row" key={`${n.note}-${i}`} role="group" aria-label={`Note ${i + 1}: ${noteName(n.note)}`}>
          <span>{noteName(n.note)}</span>
          {/* The MIDI pitch it sounds at (stored note + root), as the name beside it. */}
          <NumberField tip="Pitch as a MIDI note number (60 = C4), as it sounds with the project's root." hideLabel label={`Note ${i + 1} pitch, as MIDI note number`} value={n.note + root} min={root} max={127} onCommit={(v) => { const st = v - root; if (!notes.some((x, k) => k !== i && x.note === st)) change(i, { note: st }); }} />
          <NumberField tip="How hard the note plays, 1–127." hideLabel label={`Note ${i + 1} velocity`} value={n.velocity} min={1} max={127} onCommit={(v) => change(i, { velocity: v })} />
          <NumberField tip="Length in sixths of a step: 6 = one step, up to 96 (16 steps)." hideLabel label={`Note ${i + 1} gate, in sixths of a step`} value={n.gate} min={1} max={96} onCommit={(v) => change(i, { gate: v })} />
          <NumberField tip="Starts the note late by 0–5 sixths of a step, for feel." hideLabel label={`Note ${i + 1} micro-step offset, in sixths`} value={n.micro} min={0} max={5} onCommit={(v) => change(i, { micro: v })} />
          <button type="button" className="btn" data-tip="Remove this note from the step." aria-label={`Remove note ${i + 1}`} onClick={() => write(notes.filter((_, k) => k !== i), `removed ${noteName(n.note)}`)}>✕</button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn" data-tip="Add another note to this step (up to 6), starting from the current note." disabled={notes.length >= MAX_NOTES} onClick={() => write([...notes, { ...DEFAULT_NOTE, note: free }], `added ${noteName(free)}`)}>Add note</button>
        <button type="button" className="btn" data-tip="Remove every note from this step." disabled={!notes.length} onClick={() => write([], `cleared step ${p.step}`)}>Clear step</button>
      </div>
      <div className="row">
        <NumberField tip="Chance the step plays each time round: 7 always, 6 = 87.5 %, down to 0 = 12.5 %. All the step's notes play or none do." label="Probability (0–7, 7 = always)" value={probability} min={0} max={7} onCommit={(v) => write(notes, `probability ${v}`, v)} />
      </div>
    </fieldset>
  );
}

function DrumStep(p: InspectorProps & { step: number }) {
  if (p.data.kind !== "drums") return null;
  const hit = p.data.steps.find((s) => s.step === p.step);
  const set = (c: Partial<DrumStepIn>, label: string): void => p.onDrumSteps([{ step: p.step, velocity: hit?.velocity ?? 100, ...c }], label);
  const micro = new Set(hit?.microSteps ?? [1]);
  return (
    <fieldset>
      <legend>{p.track} step {p.step}: {hit ? "hit" : "empty"}</legend>
      <div className="row">
        <NumberField tip="How hard the hit plays, 1–127; 0 removes it." label="Velocity (0 = none)" value={hit?.velocity ?? 0} min={0} max={127} onCommit={(v) => set({ velocity: v }, `velocity ${v}`)} />
      </div>
      {hit && (
        <>
          <div className="row">
            <NumberField tip="Chance the hit plays each time round: 7 always, down to 0 = 12.5 %." label="Probability (0–7)" value={hit.probability} min={0} max={7} onCommit={(v) => set({ probability: v }, `probability ${v}`)} />
          </div>
          <fieldset>
            <legend data-tip="The hit plays on each ticked sixth of the step: tick several for rolls and flams.">Micro-steps that sound</legend>
            <div className="row">
              {[1, 2, 3, 4, 5, 6].map((k) => (
                <label key={k} data-tip={`Sixth ${k} of the step: tick to add a hit there (at least one stays on).`}>
                  <input type="checkbox" checked={micro.has(k)} disabled={micro.size === 1 && micro.has(k)}
                    onChange={() => { const next = new Set(micro); if (next.has(k)) next.delete(k); else next.add(k); set({ microSteps: [...next].sort() }, "micro-steps"); }} />
                  {k}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
    </fieldset>
  );
}
