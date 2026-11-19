// The project's pack: its 64 drum samples (click or Enter to hear one) and which drum uses which.
// Synth patches are listed as not decoded yet; this view is where patch auditioning and editing
// will go once the Nova patch format is decoded.
import { useEffect, useState, type CSSProperties } from "react";
import { audition } from "./audio.ts";
import { call } from "./desk.ts";
import { DRUM_NAMES, trackStyle } from "./tracks.ts";

type Pack = Awaited<ReturnType<typeof call<"packSamples">>>;

export function PackView({ projectId, version }: { projectId: string; version: number }) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void call("packSamples", projectId).then((p) => { if (live) setPack(p); }, (e: unknown) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [projectId, version]);
  if (error) return <p className="empty">{error}</p>;
  if (!pack) return <p className="empty">Loading…</p>;
  if (!pack.pack) return <p className="empty">This project is not inside a pack folder (Tracks/NN_Pack/Sessions/), so there are no samples to show.</p>;

  const users = (i: number): (typeof DRUM_NAMES)[number][] => DRUM_NAMES.filter((_, d) => pack.drums[d] === i);
  const play = async (i: number): Promise<void> => { setLast(i); if (!(await audition(projectId, i))) setError(`Sample ${i} could not be played`); };
  return (
    <section aria-label="Pack" style={{ "--track": "var(--color-scene)" } as CSSProperties}>
      <h2 className="section-title">Samples · {pack.pack.split("/").slice(-1)[0]}</h2>
      <div className="sample-grid" role="list" aria-label="Pack samples">
        {pack.samples.map((s) => {
          const used = users(s.index);
          return (
            <div role="listitem" key={s.index}>
              <button type="button" className="pad sample" data-on={used.length > 0} data-selected={last === s.index}
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
      <p className="hint">The pack's synth patches are not decoded yet, so Synth 1 and 2 preview with stand-in sounds. Patch auditioning and editing will live here.</p>
    </section>
  );
}
