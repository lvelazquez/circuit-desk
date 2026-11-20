import { describe, expect, it } from "vitest";
import { compareNotes, describeComparison, heldNotes, passes, tickMs, type RecordedMessage } from "./midi-compare.ts";

/** A synthetic recording: notes at [ms, pitch, velocity, length], on one channel, starting at `start`. */
function rec(notes: [number, number, number, number][], start = 0, ch = 0): RecordedMessage[] {
  const out: RecordedMessage[] = [{ t: start, bytes: [0xfa] }];
  for (const [t, p, v, len] of notes) out.push({ t: start + t, bytes: [0x90 | ch, p, v] }, { t: start + t + len, bytes: [0x80 | ch, p, 0] });
  return out.sort((a, b) => a.t - b.t);
}
const TOL = { toleranceMs: { default: 21 } };
const seq: [number, number, number, number][] = [[0, 60, 100, 100], [125, 62, 90, 100], [250, 64, 80, 220], [500, 60, 100, 100]];

describe("note pairing", () => {
  it("pairs note-ons with note-offs (velocity-0 note-ons too)", () => {
    const { notes, stuck } = heldNotes([{ t: 0, bytes: [0x90, 60, 100] }, { t: 10, bytes: [0x90, 60, 90] }, { t: 50, bytes: [0x90, 60, 0] }, { t: 80, bytes: [0x80, 60, 0] }, { t: 90, bytes: [0xf8] }]);
    expect(notes.map((n) => [n.on, n.off, n.velocity])).toEqual([[0, 50, 100], [10, 80, 90]]);
    expect(stuck).toEqual([]);
  });

  it("reports a note with no note-off as stuck, even when All Notes Off ended it", () => {
    const { stuck } = heldNotes([{ t: 0, bytes: [0x91, 60, 100] }, { t: 0, bytes: [0x90, 61, 100] }, { t: 500, bytes: [0xb1, 123, 0] }]);
    expect(stuck.map((n) => [n.channel, n.pitch, n.closedBy])).toEqual([[1, 60, "cc123"], [0, 61, undefined]]);
  });
});

describe("P4b comparison", () => {
  it("passes the same notes started at a different time, with jitter inside the tolerance", () => {
    const a = heldNotes(rec(seq)), b = heldNotes(rec(seq.map(([t, p, v, l], i) => [t + (i % 2 ? 8 : -5), p, v, l + (i % 2 ? -3 : 4)]), 3210));
    const c = compareNotes(a.notes, b.notes, TOL);
    expect(c.shiftMs).toBe(-3210 - 1.5); // median of the onset jitter (−5, +8, −5, +8)
    expect(c.counts).toMatchObject({ ref: 4, test: 4, matched: 4, velocity: 0, length: 0, onset: 0 });
    expect(passes(c, [...a.stuck, ...b.stuck])).toBe(true);
    expect(describeComparison(c, { ref: a.stuck, test: b.stuck }, { ref: "device", test: "app" })).toContain("PASS");
  });

  it("flags velocity, length and onset differences outside the tolerance", () => {
    const a = heldNotes(rec(seq)).notes;
    const b = heldNotes(rec([[0, 60, 100, 100], [125 + 30, 62, 90, 100], [250, 64, 81, 220], [500, 60, 100, 160]])).notes;
    const c = compareNotes(a, b, TOL);
    expect(c.counts).toMatchObject({ matched: 4, velocity: 1, length: 1, onset: 1 });
    expect(c.pairs.filter((p) => !p.ok).map((p) => p.ref.pitch)).toEqual([62, 64, 60]);
    expect(passes(c, [])).toBe(false);
    const text = describeComparison(c, { ref: [], test: [] }, { ref: "device", test: "app" });
    expect(text).toContain("onset +30.0 ms");
    expect(text).toContain("FAIL");
  });

  it("uses each channel's tolerance", () => {
    const a = heldNotes(rec([[0, 60, 100, 100], [100, 62, 100, 100], [200, 64, 100, 100]])).notes;
    const b = heldNotes(rec([[0, 60, 100, 100], [115, 62, 100, 100], [200, 64, 100, 100]])).notes;
    expect(compareNotes(a, b, { toleranceMs: { default: 21 } }).counts.onset).toBe(0);
    expect(compareNotes(a, b, { toleranceMs: { default: 21, byChannel: { 0: 10 } } }).counts.onset).toBe(1);
  });

  it("lists missing and extra notes, and wrong pitches as both", () => {
    const a = heldNotes(rec(seq)).notes;
    const b = heldNotes(rec([[0, 60, 100, 100], [125, 63, 90, 100], [500, 60, 100, 100], [600, 67, 100, 50]])).notes;
    const c = compareNotes(a, b, TOL);
    expect(c.missing.map((n) => n.pitch)).toEqual([62, 64]);
    expect(c.extra.map((n) => n.pitch)).toEqual([63, 67]);
    expect(c.counts.matched).toBe(2);
  });

  it("compares only up to `until`, for recordings of different lengths", () => {
    const a = heldNotes(rec(seq)).notes, b = heldNotes(rec(seq.slice(0, 2))).notes;
    expect(compareNotes(a, b, TOL).missing.length).toBe(2);
    expect(compareNotes(a, b, { ...TOL, until: 200 }).missing.length).toBe(0);
  });

  it("fails on a stuck note in either stream", () => {
    const a = heldNotes(rec(seq));
    const b = heldNotes([...rec(seq), { t: 700, bytes: [0x90, 70, 100] }]);
    const c = compareNotes(a.notes, b.notes, TOL);
    expect(b.stuck.length).toBe(1);
    expect(passes(c, [...a.stuck, ...b.stuck])).toBe(false);
    expect(describeComparison(c, { ref: a.stuck, test: b.stuck }, { ref: "device", test: "app" })).toContain("stuck in app");
  });

  it("works out one micro-step tick: 1/16 sync at 120 BPM is 125/6 ms", () => {
    expect(tickMs(120, 480, 120)).toBeCloseTo(125 / 6, 6);
    expect(tickMs(120, 480, 240)).toBeCloseTo(250 / 6, 6);
  });
});
