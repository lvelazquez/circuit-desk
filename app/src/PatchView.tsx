// The patch editor: Synth 1 or 2's patch, page by page as on the device (Voice, Osc 1/2, Mixer,
// Filter, Env 1–3, LFO 1/2, FX, EQ, Mod Matrix, Macros). Every change is one undoable edit, heard
// at once on the built-in preview (Play, Keys, or while the pattern plays). Patch fields are
// `partial` until a device dump confirms the layout, so edits go to copies (Save a copy) and .syx.
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { listMove } from "./model.ts";
import { ErrorState, Loading } from "./ui/States.tsx";
import { useServiceData } from "./ui/useServiceData.ts";
import { TextField, printableAscii } from "./ui/TextField.tsx";
import { PATCH_PARAMS, displayValue, param, type PatchParam, type Section } from "@circuit-desk/patch";
import { Slider } from "./Slider.tsx";
import { trackStyle } from "./tracks.ts";

const PAGES: readonly Section[] = ["Voice", "Osc 1", "Osc 2", "Mixer", "Filter", "Env 1", "Env 2", "Env 3", "LFO 1", "LFO 2", "FX", "EQ", "Mod Matrix", "Macros"];
const FADE_MODES = ["Fade in", "Fade out", "Gate in", "Gate out"] as const;

/** "osc1.waveInterpolate" → "Wave interpolate"; "macro3.b.depth" → "Depth". */
function labelOf(p: PatchParam): string {
  const last = p.id.split(".").at(-1) ?? p.id;
  const words = last.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([A-Za-z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function tipOf(p: PatchParam): string {
  const ctl = p.controller ? ("cc" in p.controller ? `CC ${p.controller.cc}` : `NRPN ${p.controller.nrpn[0]}:${p.controller.nrpn[1]}`) : "no MIDI controller";
  return `${p.name} (patch byte ${p.address}, ${ctl}), ${p.min}–${p.max}.${p.note ? ` ${p.note}.` : ""}`;
}

export interface PatchViewProps {
  projectId: string;
  version: number;
  synth: 1 | 2;
  onSynth: (s: 1 | 2) => void;
  /** One undoable edit: changed values by id, and/or a new name. */
  onEdit: (changes: Record<string, number>, name: string | undefined, label: string) => void;
  onPlay: () => void;
  onExport: () => void;
}

export function PatchView(p: PatchViewProps) {
  const { data: patch, error } = useServiceData("getPatch", [p.projectId, p.synth], [p.projectId, p.synth, p.version]);
  const [page, setPage] = useState<Section>("Voice");
  if (error) return <ErrorState message={error} />;
  if (!patch) return <Loading what="the patch" />;

  const v = (id: string): number => patch.values[id] ?? 0;
  const set = (q: PatchParam, value: number): void => p.onEdit({ [q.id]: value }, undefined, `Synth ${p.synth} ${q.section} ${labelOf(q).toLowerCase()} ${displayValue(q, value)}`);
  const control = (id: string, opts: { label?: string; hideLabel?: boolean } = {}): ReactNode => {
    const q = param(id);
    const label = opts.label ?? labelOf(q);
    if (q.display.kind === "enum") {
      const labels = q.display.labels;
      return (
        <label key={id}>{opts.hideLabel ? <span className="visually-hidden">{label}</span> : label}
          <select value={v(id)} data-tip={tipOf(q)} onChange={(e) => set(q, Number(e.target.value))}>
            {Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map((n) => <option key={n} value={n}>{labels[n] ?? n}</option>)}
            {(v(id) < q.min || v(id) > q.max) && <option value={v(id)}>{v(id)} (stored, out of range)</option>}
          </select>
        </label>
      );
    }
    if (q.display.kind === "bits") {
      const byte = v(id);
      const setBits = (bit: number, width: number, value: number): void => {
        const mask = ((1 << width) - 1) << bit;
        set(q, (byte & ~mask) | ((value << bit) & mask));
      };
      return (
        <fieldset key={id} className="patch-flags" data-tip={tipOf(q)}>
          <legend>{label}</legend>
          {q.display.fields.map((f) => f.width === 1 ? (
            <label key={f.name} className="check"><input type="checkbox" checked={((byte >> f.bit) & 1) === 1} onChange={(e) => setBits(f.bit, 1, e.target.checked ? 1 : 0)} /> {f.name}</label>
          ) : (
            <label key={f.name}>{f.name}
              <select value={(byte >> f.bit) & 3} onChange={(e) => setBits(f.bit, f.width, Number(e.target.value))}>
                {FADE_MODES.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
            </label>
          ))}
        </fieldset>
      );
    }
    return <Slider key={id} label={label} hideLabel={opts.hideLabel} value={v(id)} min={Math.min(q.min, v(id))} max={Math.max(q.max, v(id))}
      text={(x) => displayValue(q, x)} tip={tipOf(q)} onCommit={(x) => set(q, Math.min(q.max, Math.max(q.min, x)))} />;
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const next = listMove(i, e.key, PAGES.length, true);
    if (next === null) return;
    e.preventDefault();
    setPage(PAGES[next]!);
    document.getElementById(`patch-tab-${next}`)?.focus();
  };

  const trusted = patch.status === "verified";
  return (
    <section aria-label="Patch" className="patch-view" style={trackStyle(p.synth === 1 ? "Synth 1" : "Synth 2")}>
      <div className="row patch-head">
        <div role="group" aria-label="Synth" className="row">
          {([1, 2] as const).map((s) => (
            <button key={s} type="button" className="btn" aria-pressed={p.synth === s} onClick={() => p.onSynth(s)}
              data-tip={`Edit Synth ${s}'s patch (stored in the project).`}>Synth {s}</button>
          ))}
        </div>
        <TextField label="Name" value={patch.name} maxLength={16} valid={printableAscii} onCommit={(name) => p.onEdit({}, name, `Synth ${p.synth} patch name "${name}"`)}
          tip="The patch name: up to 16 letters, digits and plain punctuation (ASCII). Enter saves it as an edit; Esc cancels." />
        {control("category")}
        <button type="button" className="btn" onClick={p.onPlay} data-tip="Play a short C3 with this patch on the built-in preview. Turn on Keys to play it from the computer keyboard.">▶ Play C3</button>
        <button type="button" className="btn" onClick={p.onExport} data-tip="Write this patch as a .syx file (Novation's portable patch format) to the project's exports folder. Nothing is sent to a device.">Export .syx</button>
      </div>
      <p className="hint" role="note">
        {trusted ? "Patch fields are verified on a device." : "Patch fields are partial: the layout is Novation's documented format, checked on all 1,050 patches of the card copy; a device check is pending, so edits go to saved copies and .syx files."}
        {patch.problems.length > 0 && ` This patch stores ${patch.problems.length} value${patch.problems.length > 1 ? "s" : ""} outside the guide's ranges; they are kept unless you change them.`}
      </p>

      <div role="tablist" aria-label="Patch pages" className="patch-tabs">
        {PAGES.map((s, i) => (
          <button key={s} id={`patch-tab-${i}`} type="button" role="tab" className="btn btn-small" aria-selected={page === s} aria-controls="patch-page"
            tabIndex={page === s ? 0 : -1} onClick={() => setPage(s)} onKeyDown={(e) => onTabKey(e, i)}
            data-tip={`The ${s} page of the patch. Left and Right arrows move between pages.`}>{s}</button>
        ))}
      </div>

      <div id="patch-page" role="tabpanel" aria-label={page} className="patch-page">
        {page === "Mod Matrix" ? <ModMatrix control={control} />
          : page === "Macros" ? <Macros control={control} />
          : (
            <fieldset className="fx-panel patch-panel">
              <legend>{page}</legend>
              {PATCH_PARAMS.filter((q) => q.section === page && !q.reserved).map((q) => control(q.id))}
            </fieldset>
          )}
      </div>
    </section>
  );
}

type Control = (id: string, opts?: { label?: string; hideLabel?: boolean }) => ReactNode;

function ModMatrix({ control }: { control: Control }) {
  return (
    <table className="patch-table">
      <caption className="visually-hidden">Mod matrix: 20 slots, each source 1 × source 2 × depth to a destination</caption>
      <thead><tr><th scope="col">Slot</th><th scope="col">Source 1</th><th scope="col">Source 2</th><th scope="col">Depth</th><th scope="col">Destination</th></tr></thead>
      <tbody>
        {Array.from({ length: 20 }, (_, k) => (
          <tr key={k}>
            <th scope="row">{k + 1}</th>
            {(["source1", "source2", "depth", "destination"] as const).map((f) => (
              <td key={f}>{control(`mod${k + 1}.${f}`, { label: `Slot ${k + 1} ${f.replace("source", "source ")}`, hideLabel: true })}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Macros({ control }: { control: Control }) {
  return (
    <div className="fx-panels">
      {Array.from({ length: 8 }, (_, k) => (
        <fieldset key={k} className="fx-panel">
          <legend>Macro {k + 1}</legend>
          {control(`macro${k + 1}.position`, { label: "Position" })}
          {(["a", "b", "c", "d"] as const).map((s) => (
            <fieldset key={s} className="patch-slot">
              <legend>Slot {s.toUpperCase()}</legend>
              {control(`macro${k + 1}.${s}.destination`, { label: "Destination" })}
              {control(`macro${k + 1}.${s}.start`, { label: "Start" })}
              {control(`macro${k + 1}.${s}.end`, { label: "End" })}
              {control(`macro${k + 1}.${s}.depth`, { label: "Depth" })}
            </fieldset>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
