// Sounds › Drums: each drum track's sample from the pack and its four knobs. Each change is one
// undoable edit, heard at once in the preview. Level and pan stay in the Mixer.
import type { SettingsEdit } from "@circuit-desk/ncs";
import type { Settings } from "./desk.ts";
import { Slider, centreText } from "./Slider.tsx";
import { SoundTabs, type SoundPage } from "./SoundTabs.tsx";
import { DRUM_NAMES, trackStyle } from "./tracks.ts";
import { Panel } from "./ui/Panel.tsx";
import { Select } from "./ui/Select.tsx";
import { useServiceData } from "./ui/useServiceData.ts";

type DrumField = "sample" | "pitch" | "decay" | "distortion" | "eq";

export function DrumSoundsView({ projectId, version, settings, onEdit, onPage }: {
  projectId: string;
  version: number;
  settings: Settings;
  onEdit: (edit: SettingsEdit, label: string) => void;
  onPage: (p: SoundPage) => void;
}) {
  const samples = useServiceData("packSamples", [projectId], [projectId, version]).data?.samples ?? [];
  const sampleOptions = (samples.length ? samples : Array.from({ length: 64 }, (_, i) => ({ index: i, name: "" })))
    .map((x) => ({ value: x.index, label: `${x.index + 1}${x.name ? ` · ${x.name}` : ""}` }));
  const drum = (d: number, f: DrumField, v: number, label: string): void =>
    onEdit({ sound: { drums: [0, 1, 2, 3].map((i) => (i === d ? { [f]: v } : null)) } }, label);

  return (
    <section aria-label="Drum sounds" className="patch-view">
      <div className="row patch-head">
        <SoundTabs page="drums" onPage={onPage} />
      </div>
      <div className="fx-panels">
        {DRUM_NAMES.map((n, d) => {
          const k = settings.sound.drums[d]!;
          return (
            <Panel key={n} title={n} style={trackStyle(n)}>
              <Select label="Sample" value={k.sample} options={sampleOptions} tip="The pack sample this drum plays (a step can flip to another)."
                onChange={(v) => drum(d, "sample", v, `${n} sample ${v + 1}`)} />
              <Slider tip="Tunes the drum sample up or down; 0 is as recorded." label="Pitch" value={k.pitch} text={centreText} onCommit={(v) => drum(d, "pitch", v, `${n} pitch ${centreText(v)}`)} />
              <Slider tip="How long the drum sounds before it fades." label="Decay" value={k.decay} onCommit={(v) => drum(d, "decay", v, `${n} decay ${v}`)} />
              <Slider tip="Drive on this drum." label="Distortion" value={k.distortion} onCommit={(v) => drum(d, "distortion", v, `${n} distortion ${v}`)} />
              <Slider tip="Tilt EQ: below 0 darker, above 0 brighter." label="EQ" value={k.eq} text={centreText} onCommit={(v) => drum(d, "eq", v, `${n} EQ ${centreText(v)}`)} />
            </Panel>
          );
        })}
      </div>
      <p className="hint">Level and pan are in the Mixer. <span className="badge" data-tip="Read from the firmware's parameter table and the card; not yet confirmed by loading an edited copy on a device.">Unverified on a device</span></p>
    </section>
  );
}
