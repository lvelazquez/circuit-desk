// The Sounds view's three pages: Synth 1's patch, Synth 2's patch, and the four drums' samples
// and knobs. Shown at the head of each page so the switch stays in the same place.
export type SoundPage = 1 | 2 | "drums";

const PAGES: readonly { id: SoundPage; label: string; tip: string }[] = [
  { id: 1, label: "Synth 1", tip: "Edit Synth 1's patch (stored in the project)." },
  { id: 2, label: "Synth 2", tip: "Edit Synth 2's patch (stored in the project)." },
  { id: "drums", label: "Drums", tip: "Each drum's sample, pitch, decay, distortion and EQ (stored in the project)." },
];

export function SoundTabs({ page, onPage }: { page: SoundPage; onPage: (p: SoundPage) => void }) {
  return (
    <div role="group" aria-label="Sound" className="row">
      {PAGES.map((s) => (
        <button key={s.label} type="button" className="btn" aria-pressed={page === s.id} onClick={() => onPage(s.id)} data-tip={s.tip}>{s.label}</button>
      ))}
    </div>
  );
}
