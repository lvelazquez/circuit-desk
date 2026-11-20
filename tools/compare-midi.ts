// Read-only: compares the notes a Circuit sent while playing a project (recorded with
// `npm run app:midi-record`) with the notes the project stores, to settle whether the device
// transposes note tracks by the scale root. Then the P4b check (docs/PLAN.md, docs/device-session.md):
// pitch, velocity, length and onset time within a tolerance, and stuck notes, either against the
// project's own notes or, with --against, against a second recording (the app playing the project).
// Usage: node tools/compare-midi.ts <project.ncs> <recording.json> [--against <app-recording.json>]
//        [--ticks N (default 1)] [--tolerance-ms N] [--limit N]
// Exit code 1 when the P4b check fails.
import { readFileSync } from "node:fs";
import * as N from "@circuit-desk/ncs";
import { arrange, DEFAULT_CHANNELS, type Arrangement } from "@circuit-desk/export";
import { compareNotes, describeComparison, heldNotes, passes, tickMs, type HeldNote, type RecordedMessage } from "./lib/midi-compare.ts";

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const against = opt("--against"), ticks = Number(opt("--ticks") ?? 1), tolOverride = opt("--tolerance-ms"), limit = Number(opt("--limit") ?? 20);
const [file, rec] = argv;
if (!file || !rec) throw new Error("usage: compare-midi.ts <project.ncs> <recording.json> [--against <app-recording.json>] [--ticks N] [--tolerance-ms N]");
const p = N.openProject(new Uint8Array(readFileSync(file)));
const { root, type } = N.readScale(p);
const a = arrange(p, { source: "current", swing: false });
const msgs = JSON.parse(readFileSync(rec, "utf8")) as RecordedMessage[];
console.log(`project root ${N.NOTE_NAMES[root]} (${root}), scale ${N.SCALE_NAMES[type]}`);
for (let t = 0; t < 4; t++) {
  const ch = DEFAULT_CHANNELS[t]!;
  const withRoot = new Set(a.tracks[t]!.notes.map((n) => n.pitch));
  const stored = new Set([...withRoot].map((x) => x - root));
  const sent = msgs.filter((m) => m.bytes[0] === (0x90 | ch) && (m.bytes[2] ?? 0) > 0).map((m) => m.bytes[1]!);
  if (!sent.length && !withRoot.size) continue;
  const hit = (s: Set<number>): number => sent.filter((x) => s.has(x)).length;
  console.log(`${N.NOTE_TRACKS[t]} (channel ${ch + 1}): ${sent.length} note-ons sent; match stored + root: ${hit(withRoot)}, match stored as is: ${hit(stored)}`);
  console.log(`  sent pitches ${[...new Set(sent)].sort((x, y) => x - y).join(" ")} | stored ${[...stored].sort((x, y) => x - y).join(" ")}`);
}

// ── P4b ─────────────────────────────────────────────────────────────────────────────────────
const msPerTick = (x: Arrangement): number => 60_000 / (x.bpm * x.ppq);
/** One micro-step tick (a step is 6) of each channel's slowest-synced track at the project's tempo, times --ticks. */
function tolerances(x: Arrangement): { default: number; byChannel: Record<number, number> } {
  if (tolOverride !== undefined) return { default: Number(tolOverride), byChannel: {} };
  const byChannel: Record<number, number> = {};
  for (const t of x.tracks) {
    const st = t.plays[0]?.stepTicks;
    if (st === undefined) continue;
    byChannel[t.channel] = Math.max(byChannel[t.channel] ?? 0, ticks * tickMs(x.bpm, x.ppq, st));
  }
  return { default: ticks * tickMs(x.bpm, x.ppq, x.ppq / 4), byChannel };
}
const span = (ns: readonly HeldNote[]): number => (ns.length ? Math.max(...ns.map((n) => n.on)) - Math.min(...ns.map((n) => n.on)) : 0);

const device = heldNotes(msgs);
const timed = arrange(p, { source: "current" });
const tol = tolerances(timed);
// Notes are compared up to the shorter stream's last note-on (plus a tolerance for its jitter).
const maxTol = Math.max(tol.default, ...Object.values(tol.byChannel));
console.log(`\nP4b: tolerance ${ticks} tick${ticks === 1 ? "" : "s"} at ${timed.bpm} BPM: ${Object.entries(tol.byChannel).map(([ch, ms]) => `ch ${Number(ch) + 1} ±${ms.toFixed(1)} ms`).join(", ") || `±${tol.default.toFixed(1)} ms`}`);
let ok: boolean;
if (against) {
  const app = heldNotes(JSON.parse(readFileSync(against, "utf8")) as RecordedMessage[]);
  const until = Math.min(span(device.notes), span(app.notes)) + maxTol;
  const c = compareNotes(device.notes, app.notes, { toleranceMs: tol, until });
  console.log(describeComparison(c, { ref: device.stuck, test: app.stuck }, { ref: "device", test: "app" }, limit));
  ok = passes(c, [...device.stuck, ...app.stuck]);
} else {
  // The project's notes, repeated to cover the recording (the device loops the chains).
  const passMs = timed.length * msPerTick(timed);
  const repeats = Math.max(1, Math.ceil((span(device.notes) + 1) / Math.max(1, passMs)) + 1);
  const x = repeats > 1 ? arrange(p, { source: "current", repeats }) : timed;
  const expected: HeldNote[] = x.tracks.flatMap((t) => t.notes.map((n) => ({ channel: t.channel, pitch: n.pitch, velocity: n.velocity, on: n.tick * msPerTick(x), off: (n.tick + n.dur) * msPerTick(x) })));
  const rolled = x.tracks.reduce((s, t) => s + t.notes.filter((n) => n.prob !== undefined || n.rnd).length, 0);
  if (rolled) console.log(`  warning: ${rolled} notes have step probability or a random direction; the device may skip or move them (P4b uses a pattern with probability 100 %)`);
  const c = compareNotes(expected, device.notes, { toleranceMs: tol, until: span(device.notes) + maxTol });
  console.log(describeComparison(c, { ref: [], test: device.stuck }, { ref: "project", test: "device" }, limit));
  ok = passes(c, device.stuck);
}
if (!ok) process.exitCode = 1;
