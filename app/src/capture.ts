// Sound reports: the last 10 seconds of what the app played (from the capture tap on the output
// bus), every note and controller event with its exact audio time, and the patches and settings in
// use. Saved with Transport › Capture Last 10 Seconds; tools/replay-report.ts re-renders the synth
// events offline, sample for sample, to find a glitch.
import { TAP_SECONDS, encodeWav, type TapDump, type TapRequest } from "@circuit-desk/engine";
import { appOutput } from "./audio.ts";

export interface LoggedEvent {
  /** Audio-context time, seconds. */
  time: number;
  /** "player": the sequencer on the preview engine; "keys": the computer keyboard. */
  source: "player" | "keys";
  /** Track 0–7 for the player; for keys, the sound's channel (Synth 1 = 0, Synth 2 = 1). */
  track: number | null;
  bytes: number[];
  sample?: number;
  /** Keys only: where it went ("preview" or "midi") and what sound it was. */
  route?: "preview" | "midi";
  sound?: string;
}

const MAX_EVENTS = 20_000;
const events: LoggedEvent[] = [];

export function logEvent(e: LoggedEvent): void {
  events.push(e);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

let nextId = 1;

/** The tap's last TAP_SECONDS of audio. */
async function captureAudio(): Promise<TapDump> {
  const node = await appOutput();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the capture tap did not answer")), 3000);
    const prev = node.port.onmessage;
    node.port.onmessage = (e: MessageEvent<TapDump>) => {
      if (e.data.type !== "dump" || e.data.id !== id) return;
      clearTimeout(timer);
      node.port.onmessage = prev;
      resolve(e.data);
    };
    const req: TapRequest = { type: "dump", id };
    node.port.postMessage(req);
  });
}

export interface ReportContext {
  appVersion: string;
  firmware: string | null;
  project: string | null;
  view: string;
  track: string;
  output: string | null;
  keys: { label: string; channel: number; previewOnly: boolean; patch: number[] | null } | null;
  synthPatches: { synth1: number[]; synth2: number[] } | null;
}

/** Builds the report: JSON text and the audio as a WAV. */
export async function buildReport(context: ReportContext): Promise<{ json: string; wav: Uint8Array; events: number; seconds: number }> {
  const dump = await captureAudio();
  const start = (dump.endFrame - dump.left.length) / dump.sampleRate;
  const end = dump.endFrame / dump.sampleRate;
  const inWindow = events.filter((e) => e.time >= start - 1 && e.time <= end);
  const report = {
    kind: "circuit-desk sound report",
    version: 1,
    createdAt: new Date().toISOString(),
    ...context,
    audio: { file: "audio.wav", sampleRate: dump.sampleRate, frames: dump.left.length, startTime: start, maxSeconds: TAP_SECONDS },
    // `offset`: seconds from the start of audio.wav (negative: just before the capture began).
    events: inWindow.map((e) => ({ ...e, offset: Number((e.time - start).toFixed(6)) })),
  };
  return {
    json: JSON.stringify(report, null, 1),
    wav: encodeWav([dump.left, dump.right], dump.sampleRate),
    events: inWindow.length,
    seconds: dump.left.length / dump.sampleRate,
  };
}
