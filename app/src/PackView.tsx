// The project's pack: its 64 drum samples (click or Enter to hear one) and which drum uses which,
// and its synth patch banks (click or Enter to hear a patch through the Nova preview; with Keys on,
// the chosen patch plays from the computer keyboard).
import { useState } from "react";
import type { FirmwareProfile } from "@circuit-desk/core-service";
import { audition } from "./audio.ts";
import { DRUM_NAMES, trackStyle } from "./tracks.ts";
import { Empty, ErrorState, Loading } from "./ui/States.tsx";
import { useServiceData } from "./ui/useServiceData.ts";


export interface PackPatchChoice { bank: number; record: number; name: string }

export function PackView({ projectId, version, firmware, chosen, onPatch, onLoad }: {
  projectId: string;
  version: number;
  firmware: FirmwareProfile | null;
  chosen: PackPatchChoice | null;
  /** The user picked a pack patch: make it the keyboard sound and play it once. */
  onPatch: (p: PackPatchChoice) => void;
  /** Copy the chosen pack patch into Synth 1 or 2 (an undoable edit) and open it in the Patch view. */
  onLoad: (p: PackPatchChoice, synth: 1 | 2) => void;
}) {
  const samples = useServiceData("packSamples", [projectId], [projectId, version]);
  const { data: patches, error: patchError } = useServiceData("packPatches", [projectId], [projectId, version]);
  const pack = samples.data;
  const [playError, setError] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const error = samples.error ?? patchError ?? playError;
  if (error) return <ErrorState message={error} />;
  if (!pack) return <Loading what="the pack" />;
  if (!pack.pack) return <Empty>This project is not inside a pack folder (Tracks/NN_Pack/Sessions/), so there are no samples to show.</Empty>;

  const users = (i: number): (typeof DRUM_NAMES)[number][] => DRUM_NAMES.filter((_, d) => pack.drums[d] === i);
  const play = async (i: number): Promise<void> => { setLast(i); if (!(await audition(projectId, i))) setError(`Sample ${i} could not be played`); };
  const ownSynthLabel = firmware?.circuitHacks ? "MIDI own synth" : "CIRCUIT-HACKS data, kept";
  return (
    <section aria-label="Pack" className="scene-tint">
      <h2 className="section-title">Samples · {pack.pack.split("/").slice(-1)[0]}</h2>
      <div className="sample-grid" role="list" aria-label="Pack samples">
        {pack.samples.map((s) => {
          const used = users(s.index);
          return (
            <div role="listitem" key={s.index}>
              <button type="button" className="pad sample" data-tip={`Hear sample ${s.index + 1}. Lit in a drum's colour: that drum uses it. Choose a drum's sample in the Project view.`} data-on={used.length > 0} data-selected={last === s.index}
                style={used[0] ? trackStyle(used[0]) : undefined}
                aria-label={`Play sample ${s.index + 1}, ${s.name}${used.length ? `, used by ${used.join(" and ")}` : ""}`}
                onClick={() => void play(s.index)}>
                <span className="pad-num" aria-hidden="true">{s.index + 1}</span>
                <span aria-hidden="true">{s.name}</span>
                {used.length > 0 && <span className="sample-users" aria-hidden="true">{used.map((u) => u.replace("Drum ", "D")).join(" ")}</span>}
              </button>
            </div>
          );
        })}
      </div>
      <h2 className="section-title">Synth patches</h2>
      <p className="hint">
        Choose a patch to hear it on the built-in preview (the emulated synth; wavetables are still approximations).
        Turn on Keys to play the chosen patch from the computer keyboard, or load it into a synth to edit it.
      </p>
      {chosen && (
        <div className="row" role="group" aria-label={`Edit ${chosen.name || "the chosen patch"}`}>
          {([1, 2] as const).map((s) => (
            <button key={s} type="button" className="btn" onClick={() => onLoad(chosen, s)}
              data-tip={`Copy "${chosen.name}" into this project's Synth ${s} (replacing its patch, undoable) and open it in the Patch view. The pack's files are not changed.`}>
              Edit in Synth {s}
            </button>
          ))}
        </div>
      )}
      {!patches?.banks.length ? <p className="hint">This pack has no patch banks.</p> : patches.banks.map((b) => (
        <div key={b.bank} className="patch-bank">
          <h3 className="patch-bank-title">Bank {b.bank + 1}</h3>
          <div className="sample-grid" role="list" aria-label={`Patch bank ${b.bank + 1}`}>
            {b.patches.map((p) => {
              const selected = chosen?.bank === b.bank && chosen.record === p.record;
              return (
                <div role="listitem" key={p.record}>
                  <button type="button" className="pad sample patch" data-tip={`Hear ${p.name || "this patch"} on the preview, and make it the sound Keys plays.${p.ownSynthData ? " CH: it also holds CIRCUIT-HACKS synth data." : ""}`} data-selected={selected} aria-pressed={selected}
                    aria-label={`Hear patch ${p.name || "unnamed"}, ${p.category}, bank ${b.bank + 1} slot ${p.record + 1}${p.ownSynthData ? `, ${ownSynthLabel}` : ""}`}
                    onClick={() => onPatch({ bank: b.bank, record: p.record, name: p.name })}>
                    <span className="pad-num" aria-hidden="true">{p.record + 1}</span>
                    <span aria-hidden="true">{p.name || "—"}</span>
                    <span className="sample-users" aria-hidden="true">{p.category}{p.ownSynthData ? " · CH" : ""}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
