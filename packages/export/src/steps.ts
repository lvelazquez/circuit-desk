// A pattern as a list of steps, and what the device does with them while playing: the order of
// the steps in each play direction, swing, and the per-pass rolls of step probability and of the
// random direction.
//
// Evidence (circuit-hacks-rc/docs/NOTAS.md):
// - Probability: the note-track player draws one random word at tick 0 of each step and tests the
//   step's probability against `word & 7` (:2042, :2359); drums compare the top 3 bits of a random
//   word with the probability's (:1156). 7 = always, so a step plays when the roll is ≤ its
//   probability: (p + 1) / 8, which gives the device's 12.5 % … 100 % levels. Every note and
//   micro-step hit of a step shares its roll.
// - Ping-pong: the sequencer keeps a lap counter per track for it (:2057), so a ping-pong pattern
//   plays forward on one lap and backward on the next; the end steps repeat. Inferred, not
//   confirmed on a device.
// - Direction values: 0 forward, then reverse, ping-pong, random in the device's pad order. Your
//   card uses 0, 2 and 3 only (docs/card-survey.md). Assumed.
// - Swing: the header's percent (50 = straight) at the swing sync rate (byte 0x36, 3 = 1/16 in
//   every card project). Modelled as a classic swing on pairs of those steps: the first step of a
//   pair lasts swing % of the pair. The device's exact curve is not measured.
import * as N from "@circuit-desk/ncs";
import type { Arrangement, AutoEvent, MidiCc, MidiNote } from "./arrange.ts";

export const DIRECTION_FORWARD = 0;
export const DIRECTION_REVERSE = 1;
export const DIRECTION_PING_PONG = 2;
export const DIRECTION_RANDOM = 3;

/** One step's contents, ticks from the start of the step. Automation is every stored point. */
export interface StepContent {
  notes: MidiNote[];
  ccs: MidiCc[];
  auto: (AutoEvent & { lane: number })[];
}

/** A play of a random-direction pattern: playback picks its steps on each pass. */
export interface RandomPlay {
  /** 0–7. */
  pattern: number;
  /** Unswung, from the start of the arrangement. */
  tick: number;
  length: number;
  stepTicks: number;
}

/**
 * The steps (0-based from the pattern's first step) that play in each step slot of one play of
 * `count` steps, or null for the random direction (rolled at playback). `lap` counts the earlier
 * plays of ping-pong patterns on the same track.
 */
export function stepOrder(direction: number, count: number, lap: number): number[] | null {
  const forward = Array.from({ length: count }, (_, k) => k);
  if (direction === DIRECTION_REVERSE) return forward.reverse();
  if (direction === DIRECTION_PING_PONG) return lap % 2 ? forward.reverse() : forward;
  if (direction === DIRECTION_RANDOM) return null;
  return forward;
}

/**
 * Lays steps out in the order given, one slot of `stepTicks` each, up to `length`. A lane value is
 * kept only when it differs from that lane's previous one in this play, as it would be sent.
 */
export function placeSteps(steps: readonly StepContent[], order: readonly number[], stepTicks: number, length: number): { notes: MidiNote[]; ccs: MidiCc[]; auto: AutoEvent[] } {
  const notes: MidiNote[] = [], ccs: MidiCc[] = [], auto: (AutoEvent & { lane: number })[] = [];
  const lastCc = new Map<number, number>(), lastLane = new Map<number, number>();
  order.forEach((src, k) => {
    const base = k * stepTicks, s = steps[src];
    if (!s || base >= length) return;
    for (const n of s.notes) if (base + n.tick < length) notes.push({ ...n, tick: base + n.tick });
    for (const c of s.ccs) {
      if (base + c.tick >= length || lastCc.get(c.cc) === c.value) continue;
      lastCc.set(c.cc, c.value);
      ccs.push({ ...c, tick: base + c.tick });
    }
    for (const e of s.auto) {
      if (base + e.tick >= length || lastLane.get(e.lane) === e.value) continue;
      lastLane.set(e.lane, e.value);
      auto.push({ ...e, tick: base + e.tick });
    }
  });
  ccs.sort((a, b) => a.tick - b.tick || a.cc - b.cc);
  auto.sort((a, b) => a.tick - b.tick || a.lane - b.lane);
  return { notes, ccs, auto: auto.map(({ lane: _, ...e }) => e) };
}

/** Ticks per swing step for the stored swing sync rate. */
export function swingStepTicks(syncRate: number): number {
  return N.SYNC_RATE_TICKS[syncRate & 7] ?? N.SYNC_RATE_TICKS[3];
}

/**
 * Where a straight tick lands with `swing` percent over pairs of `unit`-tick steps. Ticks in a
 * last pair cut short by `end` stay straight, so nothing is pushed past the end of the loop.
 */
export function swingTick(tick: number, swing: number, unit: number, end = Number.POSITIVE_INFINITY): number {
  if (swing === 50 || unit <= 0) return tick;
  const pair = 2 * unit, ph = ((tick % pair) + pair) % pair, base = tick - ph;
  if (base + pair > end) return tick;
  const first = (pair * Math.min(Math.max(swing, 1), 99)) / 100;
  return Math.round(ph < unit ? base + (ph * first) / unit : base + first + ((ph - unit) * (pair - first)) / unit);
}

/** A note moved by swing: its start and its end move, so its length follows. */
export function swingNote(n: MidiNote, swing: number, unit: number, end: number): MidiNote {
  const tick = swingTick(n.tick, swing, unit, end);
  return { ...n, tick, dur: Math.max(1, swingTick(n.tick + n.dur, swing, unit, end) - tick) };
}

/** Shortens any note that would still sound when the same key starts again, so no two overlap. */
export function removeOverlaps(notes: readonly MidiNote[]): MidiNote[] {
  const sorted = [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  const lastByKey = new Map<number, MidiNote>();
  const out: MidiNote[] = [];
  for (const n of sorted) {
    const prev = lastByKey.get(n.pitch);
    if (prev && prev.tick === n.tick) {
      prev.velocity = Math.max(prev.velocity, n.velocity);
      prev.dur = Math.max(prev.dur, n.dur);
      continue;
    }
    if (prev && prev.tick + prev.dur > n.tick) prev.dur = n.tick - prev.tick;
    const copy = { ...n };
    lastByKey.set(n.pitch, copy);
    out.push(copy);
  }
  return out;
}

/** What one track plays on one pass. */
export interface RealisedTrack { notes: MidiNote[]; ccs: MidiCc[]; auto: AutoEvent[] }

/**
 * One pass of the arrangement as the device would play it: each step with a probability is rolled
 * (`rng` returns 0 ≤ x < 1), and random-direction plays pick a step for every slot. The forward
 * stand-ins the arrangement carries for random plays (for files) are replaced.
 */
export function realise(a: Arrangement, rng: () => number): RealisedTrack[] {
  return a.tracks.map((t) => {
    const random = t.random;
    const hasProb = t.notes.some((n) => n.prob !== undefined);
    if (!random && !hasProb) return { notes: t.notes, ccs: t.ccs, auto: t.auto };
    const rolls = new Map<number, boolean>();
    const sounds = (step: number, prob: number): boolean => {
      let r = rolls.get(step);
      if (r === undefined) { r = Math.floor(rng() * 8) <= prob; rolls.set(step, r); }
      return r;
    };
    const notes = t.notes.filter((n) => !n.rnd && (n.prob === undefined || sounds(n.step ?? n.tick, n.prob)));
    const ccs = t.ccs.filter((c) => !c.rnd), auto = t.auto.filter((e) => !e.rnd);
    if (!random) return { notes, ccs, auto };
    const swing = (tick: number): number => swingTick(tick, a.swing, a.swingTicks, a.length);
    for (const p of random.plays) {
      const steps = random.steps[p.pattern] ?? [];
      if (!steps.length) continue;
      const order = Array.from({ length: Math.ceil(p.length / p.stepTicks) }, () => Math.min(steps.length - 1, Math.floor(rng() * steps.length)));
      const placed = placeSteps(steps, order, p.stepTicks, p.length);
      for (const n of placed.notes) {
        const step = p.tick + Math.floor(n.tick / p.stepTicks) * p.stepTicks;
        if (n.prob !== undefined && !sounds(step, n.prob)) continue;
        notes.push(swingNote({ ...n, tick: p.tick + n.tick }, a.swing, a.swingTicks, a.length));
      }
      for (const c of placed.ccs) ccs.push({ ...c, tick: swing(p.tick + c.tick) });
      for (const e of placed.auto) auto.push({ ...e, tick: swing(p.tick + e.tick) });
    }
    ccs.sort((x, y) => x.tick - y.tick);
    auto.sort((x, y) => x.tick - y.tick);
    return { notes: removeOverlaps(notes).map((n) => ({ ...n, dur: Math.min(n.dur, a.length - n.tick) })).filter((n) => n.dur > 0), ccs, auto };
  });
}
