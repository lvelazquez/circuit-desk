// Ableton Live 12 set (.als) from an arrangement, built from Live's own templates so the set is
// one this Live writes itself. Ported from bitbox-instruments/tools/texture/liveset.ts.
//
// - Each Circuit track with notes becomes a MIDI track with no instrument: you add your own, or
//   route the track to the Circuit.
// - Session view: one row per scene played (or "Current chains"), each clip the track's whole
//   chain for that scene, looping; then one row per pattern 1–8, each clip that pattern, looping.
// - Arrangement view (optional): one clip per pattern as it plays, in order, as in the MIDI file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { XMLValidator } from "fast-xml-parser";
import type { Arrangement, ArrangedTrack, MidiNote } from "./arrange.ts";
import { sceneLabel } from "./smf.ts";

export const DEFAULT_LIVE_APP = "/Applications/Ableton Live 12 Suite.app";

export interface LiveTemplates {
  /** Live's DefaultLiveSet, as XML. */
  set: string;
  /** A MIDI clip taken from one of Live's own sets, as XML. */
  clip: string;
}

/** Reads the templates out of an installed Live 12 (personal use; nothing of Live's is stored). */
export function loadLiveTemplates(app = DEFAULT_LIVE_APP): LiveTemplates {
  const res = join(app, "Contents", "App-Resources");
  const set = gunzipSync(readFileSync(join(res, "Builtin", "Templates", "DefaultLiveSet.als"))).toString("utf8");
  const beat = gunzipSync(readFileSync(join(res, "Core Library", "Templates", "Quick Start Beat.als"))).toString("utf8");
  const clip = /<MidiClip Id="\d+" Time="0">[\s\S]*?<\/MidiClip>/.exec(beat)?.[0];
  if (!clip) throw new Error("no MIDI clip found in Live's Quick Start Beat template");
  return { set, clip };
}

export interface AlsOptions {
  /** Also lay the patterns out in the Arrangement view. Default true. */
  arrangement?: boolean;
  /** Leave out tracks with no notes. Default true. */
  skipEmpty?: boolean;
}

/** Live clip colours (index into Live's 70-colour palette), by Circuit track. */
export const TRACK_COLOURS = [24, 24, 13, 13, 9, 9, 9, 9] as const;

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const num = (v: number): string => String(Math.round(v * 1e6) / 1e6);

/** Replaces exactly the first match of `re` and fails loudly when the template has no such place. */
function must(x: string, re: RegExp, by: string | ((...m: string[]) => string), what: string): string {
  if (!re.test(x)) throw new Error(`Live template: cannot find ${what}`);
  re.lastIndex = 0;
  return x.replace(re, by as string);
}

class Ids {
  next: number;
  constructor(next: number) { this.next = next; }
  /** Every automation/modulation target and pointee gets a set-unique id. */
  fresh(xml: string): string {
    return xml.replace(/<([\w.]*(?:Target|Pointee)[\w.]*) Id="\d+"/g, (_m, tag: string) => `<${tag} Id="${this.next++}"`);
  }
}

function clipXml(tpl: string, o: { id: number; time: number; name: string; colour: number; length: number; loop: boolean; notes: readonly MidiNote[]; ppq: number }): string {
  const beats = (t: number): number => t / o.ppq;
  const byKey = new Map<number, MidiNote[]>();
  for (const n of o.notes) byKey.set(n.pitch, [...(byKey.get(n.pitch) ?? []), n]);
  let noteId = 1;
  const keys = [...byKey.keys()].sort((a, b) => a - b).map((k, i) =>
    `<KeyTrack Id="${i}"><Notes>${byKey.get(k)!.sort((a, b) => a.tick - b.tick).map((n) =>
      `<MidiNoteEvent Time="${num(beats(n.tick))}" Duration="${num(beats(n.dur))}" Velocity="${n.velocity}" OffVelocity="64" NoteId="${noteId++}" />`).join("")}</Notes><MidiKey Value="${k}" /></KeyTrack>`).join("");
  const len = num(beats(o.length)), end = num(beats(o.time + o.length)), start = num(beats(o.time));
  let x = must(tpl, /<MidiClip Id="\d+" Time="0">/, `<MidiClip Id="${o.id}" Time="${start}">`, "the clip start");
  const set = (tag: string, v: string | number): void => { x = must(x, new RegExp(`<${tag} Value="[^"]*" />`), `<${tag} Value="${v}" />`, `clip ${tag}`); };
  // Arrangement clips give their place on the timeline; session clips start at 0.
  set("CurrentStart", start); set("CurrentEnd", end);
  set("LoopStart", 0); set("LoopEnd", len); set("StartRelative", 0); set("LoopOn", String(o.loop));
  set("OutMarker", len); set("HiddenLoopStart", 0); set("HiddenLoopEnd", len);
  set("Name", esc(o.name)); set("Color", o.colour);
  x = must(x, /(<RemoteableTimeSignature Id="\d+">\s*<Numerator Value=")\d+(")/, "$14$2", "the clip meter");
  x = must(x, /<KeyTracks>[\s\S]*<\/KeyTracks>/, `<KeyTracks>${keys}</KeyTracks>`, "the clip notes");
  x = must(x, /(<NoteIdGenerator>\s*<NextId Value=")\d+(")/, `$1${noteId}$2`, "the note id counter");
  x = x.replace(/<Envelopes>[\s\S]*?<\/Envelopes>\s*<\/Envelopes>/, "<Envelopes><Envelopes /></Envelopes>");
  return x;
}

const emptySlot = (i: number): string => `<ClipSlot Id="${i}"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /><NeedRefreeze Value="true" /></ClipSlot>`;
const fullSlot = (i: number, clip: string): string => `<ClipSlot Id="${i}"><LomId Value="0" /><ClipSlot><Value>${clip}</Value></ClipSlot><HasStop Value="true" /><NeedRefreeze Value="true" /></ClipSlot>`;

function notesIn(t: ArrangedTrack, from: number, length: number): MidiNote[] {
  return t.notes.filter((n) => n.tick >= from && n.tick < from + length).map((n) => ({ ...n, tick: n.tick - from, dur: Math.min(n.dur, from + length - n.tick) }));
}

/** The set as XML. `writeAls` gzips it. */
export function buildAlsXml(a: Arrangement, tpl: LiveTemplates, opts: AlsOptions = {}): string {
  const withArrangement = opts.arrangement ?? true;
  const used = a.tracks.map((t, i) => ({ t, i })).filter(({ t }) => !(opts.skipEmpty ?? true) || t.notes.length || t.patterns.some((p) => p.notes.length));
  if (!used.length) throw new Error("the project has no notes to export");
  const firstPass = a.scenes.slice(0, a.scenes.length / a.repeats);
  const ids = new Ids(Number(/<NextPointeeId Value="(\d+)"/.exec(tpl.set)?.[1] ?? 100000) + 1000);
  const track = /<MidiTrack Id="\d+"[\s\S]*?<\/MidiTrack>/.exec(tpl.set)?.[0];
  const sceneTpl = /<Scene Id="\d+">[\s\S]*?<\/Scene>/.exec(tpl.set)?.[0];
  if (!track || !sceneTpl) throw new Error("Live template: no MIDI track or scene");

  const rowNames = [...firstPass.map((s) => sceneLabel(s.scene)), ...Array.from({ length: 8 }, (_, k) => `Pattern ${k + 1}`)];
  const tracksXml = used.map(({ t, i }, k) => {
    const colour = TRACK_COLOURS[i] ?? 0;
    let clipId = 0;
    const sceneClips = firstPass.map((s) => {
      const notes = notesIn(t, s.tick, s.length);
      return notes.length ? clipXml(tpl.clip, { id: clipId++, time: 0, name: `${t.name} · ${sceneLabel(s.scene)}`, colour, length: s.length, loop: true, notes, ppq: a.ppq }) : null;
    });
    const patternClips = t.patterns.map((p, n) =>
      p.notes.length ? clipXml(tpl.clip, { id: clipId++, time: 0, name: `${t.name} · ${n + 1}`, colour, length: p.length, loop: true, notes: p.notes, ppq: a.ppq }) : null);
    const slots = [...sceneClips, ...patternClips].map((c, n) => (c ? fullSlot(n, c) : emptySlot(n))).join("");
    const freeze = rowNames.map((_, n) => emptySlot(n)).join("");
    const arranged = withArrangement
      ? t.plays.map((pl) => ({ pl, notes: notesIn(t, pl.tick, pl.length) })).filter((x) => x.notes.length).map(({ pl, notes }) =>
        clipXml(tpl.clip, { id: clipId++, time: pl.tick, name: `${t.name} · ${pl.pattern + 1}`, colour, length: pl.length, loop: false, notes: notes.map((n) => ({ ...n, tick: n.tick + pl.tick })), ppq: a.ppq })).join("")
      : "";
    let x = must(track, /<MidiTrack Id="\d+"/, `<MidiTrack Id="${1000 + k}"`, "the track id");
    x = must(x, /<EffectiveName Value="[^"]*" \/>(\s*)<UserName Value="[^"]*" \/>/, `<EffectiveName Value="${esc(t.name)}" />$1<UserName Value="${esc(t.name)}" />`, "the track name");
    x = must(x, /<Color Value="\d+" \/>/, `<Color Value="${colour}" />`, "the track colour");
    // Main sequencer first, freeze sequencer second (checked against Live 12.1's template).
    let list = 0;
    x = x.replace(/<ClipSlotList>[\s\S]*?<\/ClipSlotList>/g, () => `<ClipSlotList>${list++ === 0 ? slots : freeze}</ClipSlotList>`);
    if (list !== 2) throw new Error(`Live template: expected 2 clip slot lists in a MIDI track, found ${list}`);
    x = must(x, /(<ClipTimeable>\s*<ArrangerAutomation>\s*)<Events \/>/, `$1<Events>${arranged}</Events>`, "the arrangement lane");
    return ids.fresh(x);
  });

  let set = tpl.set.replace(/\t*<(MidiTrack|AudioTrack) Id="\d+"[\s\S]*?<\/\1>\n?/g, "");
  set = must(set, /(\t*)<ReturnTrack /, (_m, tab: string) => `${tracksXml.join("\n")}\n${tab}<ReturnTrack `, "the return tracks");
  const scenes = rowNames.map((name, n) => sceneTpl.replace(/<Scene Id="\d+">/, `<Scene Id="${n}">`).replace(/<Name Value="[^"]*" \/>/, `<Name Value="${esc(name)}" />`)).join("");
  set = must(set, /<Scenes>[\s\S]*?<\/Scenes>/, `<Scenes>${scenes}</Scenes>`, "the scenes");
  set = must(set, /(<Tempo>\s*<LomId Value="0" \/>\s*<Manual Value=")[^"]*(")/, `$1${num(a.bpm)}$2`, "the tempo");
  set = must(set, /(<TimeSignature>\s*<LomId Value="0" \/>\s*<Manual Value=")[^"]*(")/, "$1201$2", "the meter");
  // The main track's automation overrides the manual tempo, so it is written there too.
  set = must(set, /<FloatEvent Id="0" Time="-63072000" Value="[^"]*" \/>/, `<FloatEvent Id="0" Time="-63072000" Value="${num(a.bpm)}" />`, "the tempo automation");
  set = must(set, /<NextPointeeId Value="\d+" \/>/, `<NextPointeeId Value="${ids.next + 10}" />`, "the id counter");

  const valid = XMLValidator.validate(set);
  if (valid !== true) throw new Error(`the set is not well-formed XML: ${valid.err.msg} (line ${valid.err.line})`);
  const targets = [...set.matchAll(/<[\w.]*(?:Target|Pointee)[\w.]* Id="(\d+)"/g)].map((m) => m[1]);
  if (new Set(targets).size !== targets.length) throw new Error("the set has duplicate target ids");
  return set;
}

export function writeAls(a: Arrangement, tpl: LiveTemplates, opts: AlsOptions = {}): Uint8Array {
  return new Uint8Array(gzipSync(buildAlsXml(a, tpl, opts)));
}
