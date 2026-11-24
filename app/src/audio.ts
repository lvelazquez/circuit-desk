// The window's one AudioContext, made on first use (browsers start audio only after a click or key),
// and sample loading shared by the preview engine and the pack view.
import { TAP_PROCESSOR, loadNovaWorklet as loadModule, wavLoader, type NovaRender, type NovaTableBytes, type SampleLoader } from "@circuit-desk/engine";
import novaWorkletUrl from "@circuit-desk/engine/nova-worklet?worker&url";
import { call } from "./desk.ts";

/** Loads the Nova worklet into `ctx` (once). */
export function loadNovaWorklet(ctx: BaseAudioContext): Promise<void> {
  return loadModule(ctx, novaWorkletUrl);
}

let tables: Promise<NovaTableBytes | null> | null = null;

/**
 * Components' wavetables and LFO shapes, if tools/components-tables.ts has saved them (asked once).
 * Without them the Nova voice plays its stand-ins.
 */
export function novaTables(): Promise<NovaTableBytes | null> {
  tables ??= call("novaTables").then(
    (t) => (t ? { wavetables: Uint8Array.from(t.wavetables), lfo: Uint8Array.from(t.lfo) } : null),
    () => null,
  );
  return tables;
}

/** The project's own Synth 1/2 patches for the Nova voice, with the bundled worklet and the tables. */
export async function novaRender(projectId: string): Promise<NovaRender> {
  const p = await call("synthPatches", projectId);
  return { moduleUrl: novaWorkletUrl, patches: [Uint8Array.from(p.synth1), Uint8Array.from(p.synth2)], tables: await novaTables() };
}

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

let tap: Promise<AudioWorkletNode> | null = null;

/**
 * The app's output bus: everything audible (the preview engine, Keys, sample auditions) goes
 * through the capture tap on its way to the speakers, so a sound report has exactly what was heard.
 */
export function appOutput(): Promise<AudioWorkletNode> {
  const c = audioContext();
  tap ??= loadNovaWorklet(c).then(() => {
    const n = new AudioWorkletNode(c, TAP_PROCESSOR, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit",
    });
    n.connect(c.destination);
    return n;
  });
  return tap;
}

const cache = new Map<string, Promise<AudioBuffer | null>>();

/** Decoded pack samples, cached per project. */
export function packLoader(projectId: string): SampleLoader {
  const load = wavLoader(audioContext(), (i) => call("sampleData", projectId, i));
  return (index) => {
    const key = `${projectId}:${index}`;
    let p = cache.get(key);
    if (!p) { p = load(index).catch(() => null); cache.set(key, p); }
    return p;
  };
}

/** Plays one pack sample now, at full velocity. */
export async function audition(projectId: string, index: number): Promise<boolean> {
  const c = audioContext();
  const buf = await packLoader(projectId)(index);
  if (!buf) return false;
  const src = c.createBufferSource();
  src.buffer = buf; src.connect(await appOutput()); src.start();
  return true;
}
