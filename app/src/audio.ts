// The window's one AudioContext, made on first use (browsers start audio only after a click or key),
// and sample loading shared by the preview engine and the pack view.
import { wavLoader, type SampleLoader } from "@circuit-desk/engine";
import { call } from "./desk.ts";

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
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
  src.buffer = buf; src.connect(c.destination); src.start();
  return true;
}
