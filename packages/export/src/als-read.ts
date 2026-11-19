// Reads notes back out of a Live set, for round-trip checks. Adapted from
// bitbox-instruments/tools/texture/als-read.ts: arrangement clips (unlooped) and session clips.
export interface AlsNote { pitch: number; start: number; dur: number; velocity: number }
export interface AlsClip { name: string; time: number; length: number; loop: boolean; notes: AlsNote[] }
export interface AlsTrackRead { name: string; arrangement: AlsClip[]; session: (AlsClip | null)[] }
export interface AlsRead { tempo: number; tempoAutomation: number | null; scenes: string[]; tracks: AlsTrackRead[] }

const attr = (x: string, tag: string): string | undefined => new RegExp(`<${tag} Value="([^"]*)"`).exec(x)?.[1];
const unesc = (s: string): string => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function readClip(c: string): AlsClip {
  const notes: AlsNote[] = [];
  for (const kt of c.matchAll(/<KeyTrack[^>]*>([\s\S]*?)<\/KeyTrack>/g)) {
    const pitch = Number(/<MidiKey Value="(\d+)"/.exec(kt[1] ?? "")?.[1]);
    for (const n of (kt[1] ?? "").matchAll(/<MidiNoteEvent ([^/]*)\/>/g)) {
      const g = (k: string): number => Number(new RegExp(`${k}="([^"]+)"`).exec(n[1] ?? "")?.[1] ?? 0);
      notes.push({ pitch, start: g("Time"), dur: g("Duration"), velocity: g("Velocity") });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const time = Number(/<MidiClip[^>]*Time="([^"]+)"/.exec(c)?.[1] ?? 0);
  return { name: unesc(attr(c, "Name") ?? ""), time, length: Number(attr(c, "LoopEnd") ?? 0) - Number(attr(c, "LoopStart") ?? 0), loop: attr(c, "LoopOn") === "true", notes };
}

export function readAlsXml(x: string): AlsRead {
  const tempoBlk = /<MainTrack[\s\S]*?<Tempo>([\s\S]*?)<\/Tempo>/.exec(x)?.[1] ?? "";
  const auto = /<FloatEvent Id="0" Time="-63072000" Value="([^"]+)"/.exec(x)?.[1];
  const scenes = [...(/<Scenes>([\s\S]*?)<\/Scenes>/.exec(x)?.[1] ?? "").matchAll(/<Scene Id="\d+">[\s\S]*?<Name Value="([^"]*)" \/>/g)].map((m) => unesc(m[1] ?? ""));
  const tracks = [...x.matchAll(/<MidiTrack [\s\S]*?<\/MidiTrack>/g)].map((m) => {
    const t = m[0];
    const arr = /<ClipTimeable>([\s\S]*?)<\/ClipTimeable>/.exec(t)?.[1] ?? "";
    const slots = /<ClipSlotList>([\s\S]*?)<\/ClipSlotList>/.exec(t)?.[1] ?? "";
    const session = [...slots.matchAll(/<ClipSlot Id="\d+">\s*<LomId Value="0" \/>\s*<ClipSlot>\s*(<Value \/>|<Value>([\s\S]*?)<\/Value>)/g)].map((s) => (s[2] ? readClip(s[2]) : null));
    return { name: unesc(attr(t, "EffectiveName") ?? ""), arrangement: [...arr.matchAll(/<MidiClip [\s\S]*?<\/MidiClip>/g)].map((c) => readClip(c[0])), session };
  });
  return { tempo: Number(attr(tempoBlk, "Manual") ?? 0), tempoAutomation: auto === undefined ? null : Number(auto), scenes, tracks };
}
