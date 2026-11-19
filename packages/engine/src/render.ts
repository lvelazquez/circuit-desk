/// <reference lib="dom" />
// Renders an arrangement through the preview engine faster than real time (OfflineAudioContext),
// for "Export Preview Audio" and for tests that need to hear what the engine does.
import type { Arrangement } from "@circuit-desk/export";
import { Schedule } from "@circuit-desk/playback";
import { PreviewEngine, wavLoader } from "./engine.ts";

export const RENDER_RATE = 48_000;
/** Seconds after the last step, so releases and sample tails are kept. */
export const RENDER_TAIL = 1.5;
/** Longest render, seconds: an arrangement is never longer than 16 scenes of long chains. */
export const RENDER_MAX = 20 * 60;

/** Synth 1/2 through the Nova voice: the bundled worklet url and the project's two patches. */
export interface NovaRender { moduleUrl: string; patches: readonly (Uint8Array | null)[] }

export async function renderOffline(
  a: Arrangement, drums: readonly number[], fetchSample: (index: number) => Promise<Uint8Array>, nova?: NovaRender,
): Promise<AudioBuffer> {
  const seconds = Math.min(RENDER_MAX, (a.length / a.ppq) * (60 / a.bpm) + RENDER_TAIL);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * RENDER_RATE), RENDER_RATE);
  const engine = new PreviewEngine(ctx, { clock: () => ({ perfMs: 0, audioS: 0 }) });
  const flips = a.tracks.slice(4).map((t) => [...new Set(t.notes.flatMap((n) => (n.sample !== undefined ? [n.sample] : [])))]);
  await engine.loadDrums(drums, flips, wavLoader(ctx, fetchSample));
  if (nova) await engine.useNova(nova.moduleUrl, nova.patches);
  const s = new Schedule(a, { loop: false, lookahead: Number.POSITIVE_INFINITY });
  s.play(0);
  engine.handle(s.pump(0));
  return ctx.startRendering();
}

/** 16-bit PCM WAV of the given channels (all the same length). */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const n = channels[0]?.length ?? 0, ch = channels.length, bytes = 44 + n * ch * 2;
  const b = new Uint8Array(bytes), v = new DataView(b.buffer);
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  str(0, "RIFF"); v.setUint32(4, bytes - 8, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]![i] ?? 0));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
    }
  }
  return b;
}
