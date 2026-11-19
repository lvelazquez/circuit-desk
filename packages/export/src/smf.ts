// Standard MIDI File writer, format 1: a tempo track, then one track per Circuit track.
// Ported from motorik/packages/core/src/smf.ts (note-off before note-on at the same tick).
import type { Arrangement, MidiNote } from "./arrange.ts";

export function vlq(n: number): number[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`vlq needs a non-negative integer, got ${n}`);
  const out = [n & 0x7f];
  while ((n >>>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number): number[] => [(n >> 8) & 255, n & 255];
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0) & 0x7f);
const nameMeta = (s: string): number[] => [0xff, 0x03, ...vlq(ascii(s).length), ...ascii(s)];
const chunk = (id: string, data: number[]): number[] => [...ascii(id), ...u32(data.length), ...data];

export function tempoMeta(bpm: number): number[] {
  if (!(bpm > 0)) throw new RangeError(`tempo must be above 0, got ${bpm}`);
  const us = Math.round(60_000_000 / bpm);
  return [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255];
}

interface Ev { tick: number; order: number; bytes: number[] }

function track(events: Ev[], end: number): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let last = 0;
  for (const e of sorted) { data.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
  data.push(...vlq(Math.max(0, end - last)), 0xff, 0x2f, 0x00);
  return chunk("MTrk", data);
}

function noteEvents(notes: readonly MidiNote[], ch: number): Ev[] {
  return notes.flatMap((n) => [
    { tick: n.tick, order: 2, bytes: [0x90 | ch, n.pitch, n.velocity] },
    { tick: n.tick + n.dur, order: 1, bytes: [0x80 | ch, n.pitch, 0] },
  ]);
}

export interface SmfOptions {
  /** Leave out tracks with no notes. Default true. */
  skipEmpty?: boolean;
}

export function writeSmf(a: Arrangement, opts: SmfOptions = {}): Uint8Array {
  const skipEmpty = opts.skipEmpty ?? true;
  const conductor: Ev[] = [
    { tick: 0, order: 0, bytes: nameMeta(a.name || "Circuit project") },
    { tick: 0, order: 0, bytes: tempoMeta(a.bpm) },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
    ...a.scenes.map((s) => ({ tick: s.tick, order: 0, bytes: [0xff, 0x06, ...vlq(ascii(sceneLabel(s.scene)).length), ...ascii(sceneLabel(s.scene))] })),
  ];
  const chunks = [track(conductor, a.length)];
  for (const t of a.tracks) {
    if (skipEmpty && t.notes.length === 0 && t.ccs.length === 0) continue;
    const ccs = t.ccs.map((c) => ({ tick: c.tick, order: 1, bytes: [0xb0 | (t.channel & 15), c.cc, c.value] }));
    chunks.push(track([{ tick: 0, order: 0, bytes: nameMeta(t.name) }, ...ccs, ...noteEvents(t.notes, t.channel & 15)], a.length));
  }
  return Uint8Array.from([...chunk("MThd", [...u16(1), ...u16(chunks.length), ...u16(a.ppq)]), ...chunks.flat()]);
}

export function sceneLabel(scene: number | null): string {
  return scene === null ? "Current chains" : `Scene ${scene + 1}`;
}
