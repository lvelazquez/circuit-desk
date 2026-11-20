// Plays a note list to a MIDI output (the Circuit) while recording an audio input (the interface the
// Circuit's outputs go into), for the measurements in docs/device-session.md. Sends channel messages
// only: Web MIDI is opened without SysEx and every message is checked (tools/lib/note-list.ts) here
// and in the page; at the end every note still on gets its note-off, then All Notes Off (CC 123).
//
//   npm run app:device-record -- --input "<audio input label part>" --notes 48,60,72 --channel 1 [--yes]
//   npm run app:device-record -- --input "<…>" --list notes.json [--yes]        (JSON: [{ "t": ms, "bytes": [...] }])
//   npm run app:device-record -- --input "<…>" --seconds 20 [--yes]   (record only: no MIDI is opened; press Play on the device)
// Options: --port <MIDI output name part> (default "circuit"), --velocity 100, --length 1000, --gap 1000
// (ms), --tail 2000 (ms recorded after the last message), --out <dir>, --fake.
//
// Without --yes it is a dry run: it lists the MIDI outputs and audio inputs and prints what it would
// send, opening no input and sending nothing. With --yes it writes audio.wav and events.json (the
// sound-report shape of app/src/capture.ts: each event's `offset` is seconds from the start of
// audio.wav) to ~/Circuit Desk/Device/<timestamp>-record/; then run tools/analyse-recording.ts on them.
// Audio processing is off (no echo cancellation, noise suppression or gain control).
// --fake replaces Web MIDI and the audio input with a fake Circuit that plays a sawtooth for each note.
import { app } from "electron";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeWav } from "@circuit-desk/engine";
import { checkChannelMessage, closingMessages, parseNoteList, parseNoteNumbers, recordingLog, testNoteList, type NoteEvent } from "../../tools/lib/note-list.ts";
import { checkOutputFolder, deviceFolder, openDeviceWindow, pageEval, orExit, pickPort, scriptArgs, takeFlag, takeOption, wait } from "./device-window.ts";

// The audio context must run without a click in the hidden window.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// Arguments and the note list are checked before any window or port is opened.
const { yes, fake, port, inputMatch, tailMs, outOption, all, lastMs } = orExit(() => {
  const args = scriptArgs();
  const yes = takeFlag(args, "--yes"), fake = takeFlag(args, "--fake");
  const port = takeOption(args, "--port") ?? "circuit";
  const inputMatch = takeOption(args, "--input");
  const listFile = takeOption(args, "--list"), notesArg = takeOption(args, "--notes"), channelArg = takeOption(args, "--channel");
  const velocity = Number(takeOption(args, "--velocity") ?? 100), lengthMs = Number(takeOption(args, "--length") ?? 1000), gapMs = Number(takeOption(args, "--gap") ?? 1000);
  const tailMs = Number(takeOption(args, "--tail") ?? 2000);
  const secondsArg = takeOption(args, "--seconds");
  const outArg = takeOption(args, "--out"), outOption = outArg === undefined ? undefined : checkOutputFolder(outArg);
  const USAGE = "usage: device-record.ts --input <audio input> (--notes 48,60 --channel 1 | --list notes.json | --seconds N) [--port name] [--velocity v] [--length ms] [--gap ms] [--tail ms] [--out dir] [--yes] [--fake]";
  if (args.length) throw new Error(`unknown arguments: ${args.join(" ")}\n${USAGE}`);
  if (!inputMatch) throw new Error(`--input is required (part of the audio input's name)\n${USAGE}`);
  if ([listFile, notesArg, secondsArg].filter((x) => x !== undefined).length !== 1) throw new Error(`give one of --list, --notes or --seconds\n${USAGE}`);
  if (secondsArg !== undefined) {
    const seconds = Number(secondsArg);
    if (!(seconds > 0 && seconds <= 600)) throw new Error(`--seconds must be 0–600, got ${secondsArg}`);
    return { yes, fake, port, inputMatch, tailMs: 0, outOption, all: [] as NoteEvent[], lastMs: seconds * 1000 };
  }

  const list: NoteEvent[] = listFile
    ? parseNoteList(JSON.parse(readFileSync(listFile, "utf8")))
    : testNoteList({ notes: parseNoteNumbers(notesArg!), channel: Number(channelArg ?? 1), velocity, lengthMs, gapMs });
  const closing = closingMessages(list);
  const all = [...list, ...closing];
  for (const e of all) checkChannelMessage(e.bytes);
  const lastMs = Math.max(...all.map((e) => e.t));
  return { yes, fake, port, inputMatch, tailMs, outOption, all, lastMs };
});

/** A fake Circuit: Web MIDI output plus an audio input that sounds a sawtooth from each note-on to its note-off. */
const FAKE = `
  const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination(), voices = new Map();
  const toCtx = (at) => ctx.currentTime + Math.max(0, ((at ?? performance.now()) - performance.now()) / 1000);
  const output = { id: "out", name: "Fake Circuit Tracks", send(bytes, at) {
    const [s, n, v] = bytes, k = s & 0xf0, key = (s & 15) + ":" + n;
    if (k === 0x90 && v > 0) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sawtooth"; o.frequency.value = 440 * 2 ** ((n - 69) / 12); g.gain.value = 0.3 * v / 127;
      o.connect(g).connect(dest); o.start(toCtx(at)); voices.set(key, o);
    } else if (k === 0x80 || k === 0x90) { const o = voices.get(key); if (o) { o.stop(toCtx(at)); voices.delete(key); } }
  } };
  navigator.requestMIDIAccess = async (o) => { if (o && o.sysex) throw new Error("the fake refuses SysEx"); return { inputs: new Map(), outputs: new Map([["out", output]]), sysexEnabled: false }; };
  navigator.mediaDevices.enumerateDevices = async () => [{ kind: "audioinput", label: "Fake Circuit audio", deviceId: "fake", groupId: "fake" }];
  navigator.mediaDevices.getUserMedia = async () => { await ctx.resume(); return dest.stream; };`;

async function run(): Promise<number> {
  const midi = all.length > 0;
  console.log(`${fake ? "FAKE MIDI and audio (no device). " : ""}${midi ? `MIDI output containing "${port}"; ` : "record only, no MIDI; "}audio input containing "${inputMatch}".`);
  if (midi) console.log(`Will send ${all.length} channel messages over ${(lastMs / 1000).toFixed(1)} s (no SysEx), and record ${((lastMs + tailMs) / 1000).toFixed(1)} s:`);
  for (const e of all.slice(0, 12)) console.log(`  ${String(e.t).padStart(6)} ms  ${e.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}`);
  if (all.length > 12) console.log(`  … ${all.length - 12} more`);

  const wc = await openDeviceWindow({ permissions: new Set(["midi", "midiSysex", "media"]), ...(fake ? { preload: FAKE } : {}) });
  const found = await pageEval<{ outputs: string[]; inputs: { label: string; id: string }[] } | { error: string }>(wc, `Promise.all([
    ${midi ? "navigator.requestMIDIAccess({ sysex: false }).then((a) => { window.__access = a; return [...a.outputs.values()].map((p) => p.name); })" : "Promise.resolve([])"},
    navigator.mediaDevices.enumerateDevices().then((ds) => ds.filter((d) => d.kind === "audioinput").map((d) => ({ label: d.label, id: d.deviceId }))),
  ]).then(([outputs, inputs]) => ({ outputs, inputs }), (e) => ({ error: String(e) }))`);
  if ("error" in found) { console.log(`refused: ${found.error}`); return 1; }
  if (midi) console.log(`MIDI outputs: ${found.outputs.join(", ") || "none"}`);
  console.log(`Audio inputs: ${found.inputs.map((i) => i.label || "(unnamed)").join(", ") || "none"}`);
  let outName: string, inLabel: string;
  try { outName = midi ? pickPort(found.outputs, port, "output") : "(none)"; inLabel = pickPort(found.inputs.map((i) => i.label), inputMatch!, "audio input"); }
  catch (e) { console.log((e as Error).message); return 1; }
  const deviceId = found.inputs.find((i) => i.label === inLabel)!.id;
  console.log(midi ? `Would play to "${outName}" and record "${inLabel}".` : `Would record "${inLabel}" for ${(lastMs / 1000).toFixed(1)} s.`);
  if (!yes) { console.log("Dry run: nothing sent, no input opened. Add --yes to play and record."); return 0; }

  // Record: all processing off, every channel the input has; blocks copied out as they come.
  const start = await pageEval<{ sampleRate: number; channels: number } | { error: string }>(wc, `(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: ${JSON.stringify(deviceId)} }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } } });
    const ctx = new AudioContext(); await ctx.resume();
    const src = ctx.createMediaStreamSource(stream), ch = Math.max(1, Math.min(2, src.channelCount));
    const proc = ctx.createScriptProcessor(4096, ch, ch), mute = ctx.createGain(); mute.gain.value = 0;
    window.__rec = { blocks: Array.from({ length: ch }, () => []), start: null, ctx, stream, proc };
    proc.onaudioprocess = (e) => {
      // The first block's first sample was captured one block before this call.
      if (window.__rec.start === null) window.__rec.start = performance.now() - (e.inputBuffer.length / ctx.sampleRate) * 1000;
      for (let c = 0; c < ch; c++) window.__rec.blocks[c].push(new Float32Array(e.inputBuffer.getChannelData(c)));
    };
    src.connect(proc); proc.connect(mute).connect(ctx.destination);
    return { sampleRate: ctx.sampleRate, channels: ch };
  })().catch((e) => ({ error: String(e) }))`);
  if ("error" in start) { console.log(`could not open the audio input: ${start.error}`); return 1; }
  for (let t = 0; t < 3000 && !(await pageEval<boolean>(wc, "window.__rec.start !== null")); t += 50) await wait(50);

  // Play: every message timestamped ahead on the output; the page refuses anything but channel messages.
  const sent = !midi ? [] : await pageEval<{ atMs: number; bytes: number[] }[]>(wc, `(() => {
    const out = [...window.__access.outputs.values()].find((p) => p.name === ${JSON.stringify(outName)});
    const list = ${JSON.stringify(all)}, t0 = performance.now() + 300, sent = [];
    for (const e of list) {
      if (e.bytes.some((b) => b === 0xf0 || b === 0xf7) || e.bytes[0] < 0x80 || e.bytes[0] >= 0xf0) throw new Error("refused: not a channel message");
      out.send(e.bytes, t0 + e.t); sent.push({ atMs: t0 + e.t, bytes: e.bytes });
    }
    return sent;
  })()`);
  console.log(`${midi ? "playing and recording" : "recording: press Play on the device now;"} ${((lastMs + tailMs + 300) / 1000).toFixed(1)} s…`);
  await wait(lastMs + tailMs + 300);
  const audioStartMs = await pageEval<number>(wc, `(() => { const r = window.__rec; r.proc.disconnect(); r.stream.getTracks().forEach((t) => t.stop()); return r.start; })()`);

  // Copy the audio out in base64 slices (Float32, little-endian).
  const channels: Float32Array[] = [];
  for (let c = 0; c < start.channels; c++) {
    const n = await pageEval<number>(wc, `(() => { const b = window.__rec.blocks[${c}], a = new Float32Array(b.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of b) { a.set(x, o); o += x.length; } window.__rec.flat = a; return a.length; })()`);
    const out = new Float32Array(n), SLICE = 1 << 18;
    for (let from = 0; from < n; from += SLICE) {
      const b64 = await pageEval<string>(wc, `(() => { const a = window.__rec.flat.subarray(${from}, ${from + SLICE}), u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); })()`);
      out.set(new Float32Array(Uint8Array.from(Buffer.from(b64, "base64")).buffer), from); // copied: a Buffer may sit unaligned in its pool
    }
    channels.push(out);
  }

  const dir = outOption ? checkOutputFolder(outOption) : fake ? mkdtempSync(path.join(tmpdir(), "circuit-desk-record-fake-")) : `${deviceFolder()}-record`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "audio.wav"), encodeWav(channels, start.sampleRate));
  const log = recordingLog({ output: outName, input: inLabel, file: "audio.wav", sampleRate: start.sampleRate, frames: channels[0]?.length ?? 0, channels: channels.length, sent, audioStartMs });
  writeFileSync(path.join(dir, "events.json"), JSON.stringify({ ...log, fake }, null, 1));
  console.log(`${((channels[0]?.length ?? 0) / start.sampleRate).toFixed(1)} s, ${channels.length} channel(s) at ${start.sampleRate} Hz → ${dir}`);
  console.log(`next: node tools/analyse-recording.ts "${path.join(dir, "audio.wav")}" "${path.join(dir, "events.json")}"`);
  return 0;
}

void app.whenReady().then(() => run()).then((code) => app.exit(code), (e: unknown) => { console.error(e); app.exit(1); });
