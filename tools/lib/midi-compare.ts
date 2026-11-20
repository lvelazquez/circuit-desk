// P4b acceptance (docs/PLAN.md): compare two note streams (what the device sent while playing a
// project, and what the app sends, or the project's own notes) by pitch, velocity, length and onset
// time within a tolerance, and list stuck notes (a note-on with no note-off). Pure.

/** A recorded MIDI message: ms from the start of the recording (app/scripts/midi-record.ts). */
export interface RecordedMessage {
  t: number;
  bytes: number[];
}

export interface HeldNote {
  channel: number;
  pitch: number;
  velocity: number;
  /** ms. */
  on: number;
  /** ms; null when no note-off came (closedBy tells whether All Notes Off ended it). */
  off: number | null;
  closedBy?: "cc123" | "cc120";
}

/**
 * Pairs each note-on with the next note-off of the same channel and pitch (note-on with velocity 0
 * counts as a note-off). A note left on is closed by CC 123 (All Notes Off) or 120 (All Sound Off)
 * on its channel, but still reported in `stuck`: P4b wants note-offs, the CC is only the safety net.
 */
export function heldNotes(rec: readonly RecordedMessage[]): { notes: HeldNote[]; stuck: HeldNote[] } {
  const notes: HeldNote[] = [], open = new Map<string, HeldNote[]>();
  for (const m of rec) {
    const [s = 0, d1 = 0, d2 = 0] = m.bytes, kind = s & 0xf0, ch = s & 15;
    if (s >= 0xf0) continue;
    if (kind === 0x90 && d2 > 0) {
      const n: HeldNote = { channel: ch, pitch: d1, velocity: d2, on: m.t, off: null };
      notes.push(n);
      const k = `${ch}:${d1}`;
      open.set(k, [...(open.get(k) ?? []), n]);
    } else if (kind === 0x80 || kind === 0x90) {
      const q = open.get(`${ch}:${d1}`);
      const n = q?.shift();
      if (n) n.off = m.t;
    } else if (kind === 0xb0 && (d1 === 123 || d1 === 120)) {
      for (const [k, q] of open) if (k.startsWith(`${ch}:`)) for (const n of q.splice(0)) n.closedBy = d1 === 123 ? "cc123" : "cc120";
    }
  }
  return { notes, stuck: notes.filter((n) => n.off === null) };
}

export interface CompareOptions {
  /** Timing (onset and length) tolerance per channel, ms; `default` for channels not listed. */
  toleranceMs: { default: number; byChannel?: Readonly<Record<number, number>> };
  /** Two notes of the same channel and pitch are paired when their onsets are this close, ms. Default 4 × tolerance. */
  matchWindowMs?: number;
  /** Compare only notes starting before this time (ms, after alignment), e.g. the shorter recording's length. */
  until?: number;
}

export interface NotePair {
  ref: HeldNote;
  test: HeldNote;
  /** test − ref, ms (after aligning both streams). */
  onsetMs: number;
  /** Length difference (test − ref), ms; null when either note is stuck. */
  lengthMs: number | null;
  velocity: number;
  /** Whether the pair is within tolerance on every count. */
  ok: boolean;
}

export interface Comparison {
  /** Shift applied to `test` to line it up with `ref`, ms. */
  shiftMs: number;
  pairs: NotePair[];
  /** In `ref` but not heard in `test`. */
  missing: HeldNote[];
  /** In `test` only. */
  extra: HeldNote[];
  counts: { ref: number; test: number; matched: number; velocity: number; length: number; onset: number };
}

const tol = (o: CompareOptions, ch: number): number => o.toleranceMs.byChannel?.[ch] ?? o.toleranceMs.default;

/**
 * Lines up `test` with `ref` (first note-ons, then the median onset difference), then pairs notes of the same channel and pitch
 * in time order. Each pair is checked for equal velocity, onset and length within the tolerance.
 */
export function compareNotes(ref: readonly HeldNote[], test: readonly HeldNote[], o: CompareOptions): Comparison {
  const first = (ns: readonly HeldNote[]): number => ns.reduce((m, n) => Math.min(m, n.on), Infinity);
  const rough = ref.length && test.length ? first(ref) - first(test) : 0;
  // Then by the median onset difference of the pairs, so jitter on the first note does not move them all.
  const c = pairUp(ref, test, rough, o);
  if (!c.pairs.length) return c;
  const d = c.pairs.map((p) => p.onsetMs).sort((a, b) => a - b);
  const median = d.length % 2 ? d[(d.length - 1) / 2]! : (d[d.length / 2 - 1]! + d[d.length / 2]!) / 2;
  return median === 0 ? c : pairUp(ref, test, rough - median, o);
}

function pairUp(ref: readonly HeldNote[], test: readonly HeldNote[], shiftMs: number, o: CompareOptions): Comparison {
  const first = (ns: readonly HeldNote[]): number => ns.reduce((m, n) => Math.min(m, n.on), Infinity);
  const r0 = ref.length ? first(ref) : 0;
  const within = (n: HeldNote, shift: number): boolean => o.until === undefined || n.on + shift - r0 < o.until;
  const shifted = test.filter((n) => within(n, shiftMs)).map((n) => ({ ...n, on: n.on + shiftMs, off: n.off === null ? null : n.off + shiftMs }));
  const refs = ref.filter((n) => within(n, 0));
  const groups = new Map<string, { r: HeldNote[]; t: HeldNote[] }>();
  const group = (n: HeldNote): { r: HeldNote[]; t: HeldNote[] } => {
    const k = `${n.channel}:${n.pitch}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { r: [], t: [] }));
    return g;
  };
  for (const n of refs) group(n).r.push(n);
  for (const n of shifted) group(n).t.push(n);
  const pairs: NotePair[] = [], missing: HeldNote[] = [], extra: HeldNote[] = [];
  for (const g of groups.values()) {
    g.r.sort((a, b) => a.on - b.on); g.t.sort((a, b) => a.on - b.on);
    let i = 0, j = 0;
    while (i < g.r.length || j < g.t.length) {
      const a = g.r[i], b = g.t[j];
      if (!a) { extra.push(b!); j++; continue; }
      if (!b) { missing.push(a); i++; continue; }
      const t = tol(o, a.channel), win = o.matchWindowMs ?? 4 * t;
      if (Math.abs(b.on - a.on) <= win) {
        const onsetMs = b.on - a.on;
        const lengthMs = a.off !== null && b.off !== null ? (b.off - b.on) - (a.off - a.on) : null;
        const velocity = b.velocity - a.velocity;
        const ok = velocity === 0 && Math.abs(onsetMs) <= t && lengthMs !== null && Math.abs(lengthMs) <= t;
        pairs.push({ ref: a, test: b, onsetMs, lengthMs, velocity, ok });
        i++; j++;
      } else if (a.on < b.on) { missing.push(a); i++; }
      else { extra.push(b); j++; }
    }
  }
  pairs.sort((x, y) => x.ref.on - y.ref.on || x.ref.channel - y.ref.channel || x.ref.pitch - y.ref.pitch);
  missing.sort((x, y) => x.on - y.on);
  extra.sort((x, y) => x.on - y.on);
  return {
    shiftMs, pairs, missing, extra,
    counts: {
      ref: refs.length, test: shifted.length, matched: pairs.length,
      velocity: pairs.filter((p) => p.velocity !== 0).length,
      length: pairs.filter((p) => p.lengthMs === null || Math.abs(p.lengthMs) > tol(o, p.ref.channel)).length,
      onset: pairs.filter((p) => Math.abs(p.onsetMs) > tol(o, p.ref.channel)).length,
    },
  };
}

/** The P4b verdict: every note matched, within tolerance, and nothing stuck. */
export function passes(c: Comparison, stuck: readonly HeldNote[]): boolean {
  return !c.missing.length && !c.extra.length && c.pairs.every((p) => p.ok) && !stuck.length;
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n: number): string => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const desc = (n: HeldNote): string => `ch ${n.channel + 1} ${noteName(n.pitch)} (${n.pitch}) vel ${n.velocity} at ${n.on.toFixed(1)} ms${n.off === null ? ", no note-off" : `, ${(n.off - n.on).toFixed(1)} ms long`}`;

/** A readable report; at most `limit` lines per list. */
export function describeComparison(c: Comparison, stuck: { ref: readonly HeldNote[]; test: readonly HeldNote[] }, labels: { ref: string; test: string }, limit = 20): string {
  const lines: string[] = [];
  const k = c.counts;
  lines.push(`${labels.ref}: ${k.ref} notes; ${labels.test}: ${k.test} notes (shifted ${c.shiftMs.toFixed(1)} ms to line up); ${k.matched} paired`);
  lines.push(`  velocity differs: ${k.velocity}; length outside tolerance: ${k.length}; onset outside tolerance: ${k.onset}; missing in ${labels.test}: ${c.missing.length}; extra in ${labels.test}: ${c.extra.length}`);
  const list = (title: string, xs: readonly string[]): void => {
    if (!xs.length) return;
    lines.push(`  ${title}:`);
    for (const x of xs.slice(0, limit)) lines.push(`    ${x}`);
    if (xs.length > limit) lines.push(`    … ${xs.length - limit} more`);
  };
  list("pairs outside tolerance", c.pairs.filter((p) => !p.ok).map((p) => `${desc(p.ref)} → onset ${p.onsetMs >= 0 ? "+" : ""}${p.onsetMs.toFixed(1)} ms, length ${p.lengthMs === null ? "n/a" : `${p.lengthMs >= 0 ? "+" : ""}${p.lengthMs.toFixed(1)} ms`}, velocity ${p.velocity >= 0 ? "+" : ""}${p.velocity}`));
  list(`missing in ${labels.test}`, c.missing.map(desc));
  list(`extra in ${labels.test}`, c.extra.map(desc));
  list(`stuck in ${labels.ref}`, stuck.ref.map((n) => `${desc(n)}${n.closedBy ? ` (ended by ${n.closedBy})` : ""}`));
  list(`stuck in ${labels.test}`, stuck.test.map((n) => `${desc(n)}${n.closedBy ? ` (ended by ${n.closedBy})` : ""}`));
  lines.push(passes(c, [...stuck.ref, ...stuck.test]) ? "  PASS: same notes, velocities, lengths and timing within tolerance; no stuck notes" : "  FAIL");
  return lines.join("\n");
}

/** One tick of the Circuit's micro-timing (a step is 6 ticks) at `bpm`, for a pattern whose step is `stepTicks` of `ppq`. */
export function tickMs(bpm: number, ppq: number, stepTicks: number): number {
  return (stepTicks / 6) * (60_000 / (bpm * ppq));
}
