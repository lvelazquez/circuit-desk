// Read-only: analyses a recording of the Circuit (app/scripts/device-record.ts, or any WAV) note by
// note: onset, fundamental pitch (Hz, nearest MIDI note and cents), peak and RMS level, attack time
// (10 → 90 %), decay (peak → −20 dB), the rate of a periodic level change (LFO) and, with the events JSON, latency, sustain level and release.
// Usage: node tools/analyse-recording.ts <audio.wav> [events.json] [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { analyseRecording, findDropouts, sentNotes } from "./lib/recording.ts";
import { mono, readWav } from "./lib/wav.ts";
import type { DeviceRecording } from "./lib/note-list.ts";

const argv = process.argv.slice(2);
const j = argv.indexOf("--json");
const jsonOut = j >= 0 ? argv.splice(j, 2)[1] : undefined;
const [wavFile, eventsFile] = argv;
if (!wavFile) throw new Error("usage: analyse-recording.ts <audio.wav> [events.json] [--json out.json]");
const wav = readWav(new Uint8Array(readFileSync(wavFile)));
const log = eventsFile ? (JSON.parse(readFileSync(eventsFile, "utf8")) as Pick<DeviceRecording, "events">) : null;
const sent = log ? sentNotes(log.events) : undefined;
const r = analyseRecording(mono(wav.channels), wav.sampleRate, sent);

const f = (v: number | null | undefined, unit = "", digits = 1): string => (v === null || v === undefined ? "—" : `${v.toFixed(digits)}${unit}`);
console.log(`${wavFile}: ${r.seconds.toFixed(2)} s at ${r.sampleRate} Hz, ${wav.channels.length} channel(s); noise floor ${f(r.noiseDb, " dBFS")}; ${r.notes.length} notes${sent ? " (from the events JSON)" : " (from the level)"}`);
console.log("onset s   sent      heard           Hz        cents  peak dB  rms dB  attack ms  decay ms  latency ms  sustain dB  release ms  mod Hz");
for (const n of r.notes) {
  const sentNote = n.sent ? `${n.sent.note} v${n.sent.velocity}` : "";
  const heard = n.note !== null ? `${n.name} (${n.note})` : "no pitch";
  console.log([
    n.onset.toFixed(3).padEnd(9), sentNote.padEnd(9), heard.padEnd(15), f(n.hz, "", 2).padStart(9), f(n.cents).padStart(6),
    f(n.peakDb).padStart(8), f(n.rmsDb).padStart(7), f(n.attackMs).padStart(10), f(n.decayMs).padStart(9),
    f(n.latencyMs).padStart(11), f(n.sustainDb).padStart(11), f(n.releaseMs).padStart(11), f(n.modHz, "", 2).padStart(7),
  ].join(" "));
  if (n.sent && n.note !== null && n.note !== n.sent.note) console.log(`          heard ${n.note - n.sent.note > 0 ? "+" : ""}${n.note - n.sent.note} semitones from the sent note`);
}
// Exact zeros between sounds: the capture lost samples there; levels and envelopes across them are wrong.
const drops = findDropouts(mono(wav.channels), wav.sampleRate);
if (drops.length) console.log(`warning: ${drops.length} capture dropout(s) (exact digital silence between sounds): ${drops.slice(0, 10).map((d) => `${d.at.toFixed(3)} s (${d.ms} ms)`).join(", ")}${drops.length > 10 ? " …" : ""}`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ ...r, dropouts: drops }, null, 1)); console.log(`→ ${jsonOut}`); }
