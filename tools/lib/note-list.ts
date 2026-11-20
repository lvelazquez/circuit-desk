// The note lists app/scripts/device-record.ts plays: [{ t (ms from the start), bytes }], checked
// to be plain channel messages (never SysEx), plus the recording's event log. Pure.

export interface NoteEvent {
  /** ms from the start of the list. */
  t: number;
  bytes: number[];
}

/** Data-byte count of each channel message (status high nibble 0x8–0xE). */
const DATA_BYTES: Readonly<Record<number, number>> = { 0x80: 2, 0x90: 2, 0xa0: 2, 0xb0: 2, 0xc0: 1, 0xd0: 1, 0xe0: 2 };

/** Throws unless `bytes` is one complete channel message. SysEx (0xF0) and all system messages are refused. */
export function checkChannelMessage(bytes: readonly number[]): void {
  const status = bytes[0];
  if (status === undefined) throw new Error("empty message");
  if (status === 0xf0 || bytes.includes(0xf0) || bytes.includes(0xf7)) throw new Error(`refused: SysEx is never sent by the recorder (${bytes.join(" ")})`);
  if (status < 0x80 || status >= 0xf0) throw new Error(`refused: only channel messages are sent (status 0x${status.toString(16)})`);
  const n = DATA_BYTES[status & 0xf0]!;
  if (bytes.length !== n + 1) throw new Error(`a 0x${(status & 0xf0).toString(16)} message has ${n} data bytes, got ${bytes.length - 1}`);
  for (const d of bytes.slice(1)) if (!Number.isInteger(d) || d < 0 || d > 127) throw new Error(`data byte ${d} is outside 0–127`);
}

/** Validates a parsed JSON note list and sorts it by time (stable). */
export function parseNoteList(json: unknown): NoteEvent[] {
  if (!Array.isArray(json)) throw new Error("a note list is a JSON array of { t, bytes }");
  const out = json.map((e: unknown, i): NoteEvent => {
    const o = e as { t?: unknown; bytes?: unknown };
    if (typeof o?.t !== "number" || !Number.isFinite(o.t) || o.t < 0) throw new Error(`entry ${i}: t must be a number of ms ≥ 0`);
    if (!Array.isArray(o.bytes) || !o.bytes.every((x) => typeof x === "number")) throw new Error(`entry ${i}: bytes must be an array of numbers`);
    const bytes = o.bytes as number[];
    try { checkChannelMessage(bytes); } catch (err) { throw new Error(`entry ${i}: ${(err as Error).message}`); }
    return { t: o.t, bytes: [...bytes] };
  });
  return out.map((e, i) => ({ e, i })).sort((x, y) => x.e.t - y.e.t || x.i - y.i).map((x) => x.e);
}

export interface TestListOptions {
  /** MIDI note numbers, played one after another. */
  notes: readonly number[];
  /** MIDI channel 1–16. */
  channel: number;
  velocity?: number;
  /** Held for this long, ms. Default 1000. */
  lengthMs?: number;
  /** Silence after each note, ms (lets release tails die out). Default 1000. */
  gapMs?: number;
  /** Silence before the first note, ms (room noise for the analysis). Default 500. */
  leadMs?: number;
}

/** A simple list: each note on, held, off, then a gap. */
export function testNoteList(o: TestListOptions): NoteEvent[] {
  if (!Number.isInteger(o.channel) || o.channel < 1 || o.channel > 16) throw new Error(`channel ${o.channel} is outside 1–16`);
  const ch = o.channel - 1, vel = o.velocity ?? 100, len = o.lengthMs ?? 1000, gap = o.gapMs ?? 1000;
  if (!o.notes.length) throw new Error("no notes");
  const out: NoteEvent[] = [];
  let t = o.leadMs ?? 500;
  for (const n of o.notes) {
    out.push({ t, bytes: [0x90 | ch, n, vel] }, { t: t + len, bytes: [0x80 | ch, n, 0] });
    t += len + gap;
  }
  for (const e of out) checkChannelMessage(e.bytes);
  return out;
}

/** Parses "--notes 48,60,72". */
export function parseNoteNumbers(s: string): number[] {
  const out = s.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
  if (!out.length || out.some((n) => !Number.isInteger(n) || n < 0 || n > 127)) throw new Error(`notes must be MIDI numbers 0–127, comma-separated: "${s}"`);
  return out;
}

/**
 * Messages that make sure nothing keeps sounding after the list: a note-off for every note still on
 * at the end, then All Notes Off (CC 123) on each channel the list used.
 */
export function closingMessages(list: readonly NoteEvent[]): NoteEvent[] {
  const on = new Map<string, number[]>();
  const channels = new Set<number>();
  let end = 0;
  for (const e of list) {
    const [s, d1 = 0, d2 = 0] = e.bytes, ch = s! & 15, kind = s! & 0xf0, key = `${ch}:${d1}`;
    channels.add(ch);
    end = Math.max(end, e.t);
    if (kind === 0x90 && d2 > 0) on.set(key, [ch, d1]);
    else if (kind === 0x80 || kind === 0x90) on.delete(key);
  }
  const t = end + 50;
  return [
    ...[...on.values()].map(([ch, n]) => ({ t, bytes: [0x80 | ch!, n!, 0] })),
    ...[...channels].sort((a, b) => a - b).map((ch) => ({ t: t + 10, bytes: [0xb0 | ch, 123, 0] })),
  ];
}

/** The recording's event log, in the sound-report shape of app/src/capture.ts (offset: s from the start of audio.wav). */
export interface DeviceRecording {
  kind: "circuit-desk device recording";
  version: 1;
  createdAt: string;
  output: string;
  input: string;
  audio: { file: string; sampleRate: number; frames: number; channels: number };
  /** `offset`: seconds from the start of audio.wav when the message was scheduled to go out. */
  events: { offset: number; bytes: number[] }[];
}

export function recordingLog(o: { output: string; input: string; file: string; sampleRate: number; frames: number; channels: number; sent: readonly { atMs: number; bytes: number[] }[]; audioStartMs: number; createdAt?: string }): DeviceRecording {
  return {
    kind: "circuit-desk device recording",
    version: 1,
    createdAt: o.createdAt ?? new Date().toISOString(),
    output: o.output,
    input: o.input,
    audio: { file: o.file, sampleRate: o.sampleRate, frames: o.frames, channels: o.channels },
    events: o.sent.map((e) => ({ offset: Number(((e.atMs - o.audioStartMs) / 1000).toFixed(6)), bytes: e.bytes })),
  };
}
