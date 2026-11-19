// Turns an arrangement into timed MIDI messages and hands them out a little ahead of time, so a
// MIDI output with timestamps (Web MIDI) plays them exactly. Pure: no timers, no MIDI access.
// The caller calls `pump(now)` every few milliseconds and sends what it returns.
import type { Arrangement } from "@circuit-desk/export";

export interface TimedMessage {
  /** When to send, in the caller's clock (ms). */
  at: number;
  bytes: number[];
  /** The Circuit track (0–7) the message belongs to, for the built-in preview engine. */
  track?: number;
  /** Drums: the pack sample a hit flips to. */
  sample?: number;
}

interface Ev { tick: number; order: number; bytes: number[]; track?: number; sample?: number }

export interface ScheduleOptions {
  /** Send MIDI clock (24 a quarter note) with start and stop. Default false. */
  clock?: boolean;
  /** Loop the arrangement. Default true. */
  loop?: boolean;
  /** How far ahead messages are handed out, ms. Default 100. */
  lookahead?: number;
  /** Tracks (by index 0–7) that do not play. */
  muted?: ReadonlySet<number>;
}

/** All of an arrangement's messages in tick order; note-offs before note-ons at the same tick. */
export function events(a: Arrangement, opts: ScheduleOptions = {}): Ev[] {
  const out: Ev[] = [];
  a.tracks.forEach((t, i) => {
    if (opts.muted?.has(i)) return;
    for (const c of t.ccs) out.push({ tick: c.tick, order: 1, bytes: [0xb0 | (t.channel & 15), c.cc, c.value], track: i });
    for (const n of t.notes) {
      out.push({ tick: n.tick, order: 2, bytes: [0x90 | (t.channel & 15), n.pitch, n.velocity], track: i, ...(n.sample !== undefined ? { sample: n.sample } : {}) });
      out.push({ tick: n.tick + n.dur, order: 1, bytes: [0x80 | (t.channel & 15), n.pitch, 0], track: i });
    }
  });
  if (opts.clock) for (let k = 0; k < a.length; k += a.ppq / 24) out.push({ tick: k, order: 0, bytes: [0xf8] });
  return out.sort((x, y) => x.tick - y.tick || x.order - y.order);
}

export class Schedule {
  private evs: Ev[];
  private readonly a: Arrangement;
  private readonly opts: Required<Omit<ScheduleOptions, "muted">> & { muted: ReadonlySet<number> };
  private readonly msPerTick: number;
  private start = 0;
  /** Index of the next event, and the loop pass it belongs to. */
  private next = 0;
  private pass = 0;
  private sounding = new Map<string, number[]>();
  private running = false;

  constructor(a: Arrangement, opts: ScheduleOptions = {}) {
    if (!(a.bpm > 0) || a.length <= 0) throw new RangeError("nothing to play: the arrangement has no tempo or no length");
    this.a = a;
    this.opts = { clock: opts.clock ?? false, loop: opts.loop ?? true, lookahead: opts.lookahead ?? 100, muted: opts.muted ?? new Set() };
    this.evs = events(a, this.opts);
    this.msPerTick = 60_000 / a.bpm / a.ppq;
  }

  get isRunning(): boolean { return this.running; }
  get lengthMs(): number { return this.a.length * this.msPerTick; }

  /** Starts at `now`, from `fromTick` (default the beginning). */
  play(now: number, fromTick = 0): TimedMessage[] {
    this.running = true;
    this.start = now - fromTick * this.msPerTick;
    this.pass = 0;
    this.next = this.evs.findIndex((e) => e.tick >= fromTick);
    if (this.next < 0) this.next = this.evs.length;
    return this.opts.clock ? [{ at: now, bytes: fromTick === 0 ? [0xfa] : [0xfb] }] : [];
  }

  /** The playback position at `now`, in ticks from the start of the arrangement (looped). */
  position(now: number): number {
    if (!this.running) return 0;
    const t = (now - this.start) / this.msPerTick;
    return this.opts.loop ? ((t % this.a.length) + this.a.length) % this.a.length : Math.min(t, this.a.length);
  }

  /** Messages due before `now + lookahead`. Empty when stopped or finished. */
  pump(now: number): TimedMessage[] {
    const out: TimedMessage[] = [];
    const horizon = now + this.opts.lookahead;
    while (this.running) {
      if (this.next >= this.evs.length) {
        if (!this.opts.loop) { this.running = false; break; }
        this.pass++; this.next = 0;
        if (!this.evs.length) break;
      }
      const e = this.evs[this.next]!;
      const at = this.start + (this.pass * this.a.length + e.tick) * this.msPerTick;
      if (at >= horizon) break;
      this.next++;
      out.push({ at: Math.max(at, now), bytes: e.bytes, ...(e.track !== undefined ? { track: e.track } : {}), ...(e.sample !== undefined ? { sample: e.sample } : {}) });
      this.track(e.bytes);
    }
    return out;
  }

  /**
   * Stops: note-offs for every sounding note, then All Notes Off (CC 123) on each channel used, and
   * clock stop. With `handoff`, only the note-offs: another schedule carries on from here.
   */
  stop(now: number, handoff = false): TimedMessage[] {
    const out: TimedMessage[] = [];
    for (const bytes of this.sounding.values()) out.push({ at: now, bytes: [0x80 | ((bytes[0] ?? 0) & 15), bytes[1] ?? 0, 0] });
    this.sounding.clear();
    if (handoff) { this.running = false; return out; }
    const channels = new Set(this.a.tracks.filter((t, i) => t.notes.length && !this.opts.muted.has(i)).map((t) => t.channel & 15));
    for (const ch of channels) out.push({ at: now, bytes: [0xb0 | ch, 123, 0] });
    if (this.opts.clock && this.running) out.push({ at: now, bytes: [0xfc] });
    this.running = false;
    return out;
  }

  private track(b: number[]): void {
    const kind = (b[0] ?? 0) & 0xf0, key = `${(b[0] ?? 0) & 15}:${b[1]}`;
    if (kind === 0x90) this.sounding.set(key, b);
    else if (kind === 0x80) this.sounding.delete(key);
  }
}

/** Where each track is at `tick`: the pattern (1–8) and step (1–32) playing, or null. */
export function playheads(a: Arrangement, tick: number): ({ pattern: number; step: number } | null)[] {
  return a.tracks.map((t) => {
    const p = t.plays.find((x) => tick >= x.tick && tick < x.tick + x.length);
    return p ? { pattern: p.pattern + 1, step: p.firstStep + Math.floor((tick - p.tick) / p.stepTicks) } : null;
  });
}
