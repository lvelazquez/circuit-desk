// Runs the device scripts end to end against their fakes (no device is opened): device-dump in both
// modes, device-record, then analyse-recording on what it wrote. `npm run app:device-smoke`
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { blankProject } from "../packages/ncs/src/testing.ts";
import { comparePatches, parsePatchMessage, projectPatch } from "@circuit-desk/patch";
import { analyseRecording, sentNotes } from "./lib/recording.ts";
import { mono, readWav } from "./lib/wav.ts";

const root = path.resolve(import.meta.dirname, "..");
const electron = path.join(root, "node_modules", ".bin", "electron");
const dir = mkdtempSync(path.join(tmpdir(), "circuit-desk-device-smoke-"));
const project = path.join(dir, "Smoke.ncs");
writeFileSync(project, blankProject("Smoke"));

let failed = false;
const check = (name: string, ok: boolean, detail = ""): void => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed = true; };
const run = (script: string, args: string[]): { code: number; out: string } => {
  const r = spawnSync(electron, [path.join(root, "app", "scripts", script), ...args], { encoding: "utf8", timeout: 60_000 });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
};

const dry = run("device-dump.ts", ["dump", project, "--fake"]);
check("dump dry run lists the ports and sends nothing", dry.code === 0 && dry.out.includes("Dry run: nothing sent") && !dry.out.includes("sent dump request"));

const dumpOut = path.join(dir, "dump");
const dump = run("device-dump.ts", ["dump", project, "--fake", "--yes", "--out", dumpOut]);
check("dump --yes sends exactly the two dump requests", dump.out.includes("fake device received: F0 00 20 29 01 64 40 00 F7 | F0 00 20 29 01 64 40 01 F7"));
check("Synth 1 is identical, Synth 2's changed byte is named", dump.out.includes("Synth 1: identical") && /0x064 \(100\) \S+: file \d+, device \d+/.test(dump.out), dump.out.split("\n").filter((l) => l.startsWith("Synth") || l.includes("0x064")).join(" | "));
check("a difference exits with code 2", dump.code === 2, `code ${dump.code}`);
const s1 = parsePatchMessage(new Uint8Array(readFileSync(path.join(dumpOut, "synth1.syx"))));
check("the raw answer is saved and reads back", !!s1 && comparePatches(projectPatch(new Uint8Array(readFileSync(project)), 0), s1.patch).length === 0);
const summary = JSON.parse(readFileSync(path.join(dumpOut, "summary.json"), "utf8")) as { identical: boolean; synths: { differences?: unknown[] }[] };
check("summary.json records the comparison", summary.identical === false && summary.synths[1]?.differences?.length === 1);

const fwid = run("device-dump.ts", ["fwid", "--fake", "--yes", "--out", path.join(dir, "fwid")]);
check("fwid sends the fwid query only and reads the marker", fwid.code === 0 && fwid.out.includes("fake device received: F0 7D 43 54 00 23 00 00 00 00 00 00 00 F7\n") && fwid.out.includes('firmware marker "FAKE"'));

const tracks = run("device-dump.ts", ["fwid", "--fake", "--yes", "--out", path.join(dir, "Tracks", "x")]);
check("an output folder under Tracks/ is refused before anything is sent", tracks.code === 1 && !tracks.out.includes("sent fwid"));

mkdirSync(path.join(dir, "lists"));
const bad = path.join(dir, "lists", "sysex.json");
writeFileSync(bad, JSON.stringify([{ t: 0, bytes: [0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x00, 0x00, 0xf7] }]));
const refused = run("device-record.ts", ["--input", "fake", "--list", bad, "--fake", "--yes"]);
check("the recorder refuses a SysEx message in a note list", refused.code === 1 && refused.out.includes("SysEx"));

const recOut = path.join(dir, "record");
const rec = run("device-record.ts", ["--input", "fake", "--notes", "45,57,69", "--channel", "2", "--length", "500", "--gap", "300", "--tail", "500", "--fake", "--yes", "--out", recOut]);
check("the recorder plays and writes audio.wav and events.json", rec.code === 0, rec.out.split("\n").filter(Boolean).slice(-2, -1).join(""));
if (rec.code === 0) {
  const wav = readWav(new Uint8Array(readFileSync(path.join(recOut, "audio.wav"))));
  const log = JSON.parse(readFileSync(path.join(recOut, "events.json"), "utf8")) as { events: { offset: number; bytes: number[] }[] };
  check("the log ends with note-offs and All Notes Off on channel 2", JSON.stringify(log.events.at(-1)?.bytes) === JSON.stringify([0xb1, 123, 0]));
  const r = analyseRecording(mono(wav.channels), wav.sampleRate, sentNotes(log.events));
  check("the analysis hears each sent note at its pitch", r.notes.map((n) => n.note).join() === "45,57,69", r.notes.map((n) => `${n.name} ${n.hz} Hz`).join(", "));
}
const only = run("device-record.ts", ["--input", "fake", "--seconds", "1", "--fake", "--yes", "--out", path.join(dir, "record-only")]);
if (only.code === 0) {
  const wav = readWav(new Uint8Array(readFileSync(path.join(dir, "record-only", "audio.wav"))));
  const log = JSON.parse(readFileSync(path.join(dir, "record-only", "events.json"), "utf8")) as { events: unknown[] };
  check("record-only (--seconds) opens no MIDI and records about that long", !only.out.includes("MIDI outputs") && log.events.length === 0 && Math.abs(wav.channels[0]!.length / wav.sampleRate - 1.3) < 0.3, `${(wav.channels[0]!.length / wav.sampleRate).toFixed(2)} s`);
} else check("record-only (--seconds) runs", false, only.out.slice(-300));
console.log(failed ? "device smoke: FAILED" : "device smoke: all passed");
process.exitCode = failed ? 1 : 0;
