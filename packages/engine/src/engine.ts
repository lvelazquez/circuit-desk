/// <reference lib="dom" />
// The built-in preview: eight tracks, each an instrument into its own channel strip, then a master
// bus with a limiter. It takes the scheduler's timed messages (performance.now() milliseconds), so
// it plays exactly what would go to a MIDI port. Works on an AudioContext or, for tests and
// rendering, an OfflineAudioContext.
import type { TimedMessage } from "@circuit-desk/playback";
import { Sampler, type FallbackVoice, type SampleLoader } from "./sampler.ts";
import { STAND_IN_PATCHES, Synth } from "./synth.ts";
import type { Instrument } from "./types.ts";
import { NovaInstrument, loadNovaWorklet } from "./nova/instrument.ts";

const DRUM_FALLBACK: readonly FallbackVoice[] = ["kick", "snare", "hat", "perc"];
/** Headroom so eight tracks summed rarely reach the limiter. */
const MASTER_LEVEL = 0.6;

export interface TrackStrip { gain: GainNode; instrument: Instrument }

export class PreviewEngine {
  readonly ctx: BaseAudioContext;
  readonly strips: TrackStrip[];
  private readonly master: GainNode;
  /** Maps the caller's clock (ms) to the audio clock (s). */
  private clock: () => { perfMs: number; audioS: number };

  constructor(ctx: BaseAudioContext, opts: { drumSamples?: readonly number[]; clock?: () => { perfMs: number; audioS: number } } = {}) {
    this.ctx = ctx;
    this.clock = opts.clock ?? (() => ({ perfMs: performance.now(), audioS: ctx.currentTime }));
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.1;
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_LEVEL;
    this.master.connect(limiter).connect(ctx.destination);
    this.strips = Array.from({ length: 8 }, (_, t) => {
      const gain = ctx.createGain();
      gain.connect(this.master);
      const instrument: Instrument = t < 4
        ? new Synth(ctx, gain, t === 0 ? STAND_IN_PATCHES.synth1 : t === 1 ? STAND_IN_PATCHES.synth2 : STAND_IN_PATCHES.midi)
        : new Sampler(ctx, gain, opts.drumSamples?.[t - 4] ?? 0, DRUM_FALLBACK[t - 4]!);
      return { gain, instrument };
    });
  }

  /** Sets each drum track's own sample and decodes every sample the playback will use. */
  async loadDrums(drumSamples: readonly number[], flips: readonly (readonly number[])[], loader: SampleLoader): Promise<void> {
    await Promise.all(this.strips.slice(4).map(async (s, d) => {
      const sampler = s.instrument as Sampler;
      sampler.setSample(drumSamples[d] ?? 0);
      await sampler.load(flips[d] ?? [], loader);
    }));
  }

  /**
   * Plays Synth 1 and 2 with the Nova voice and the project's own patches (340 B each; null keeps
   * the stand-in). `moduleUrl` is the bundled nova worklet. Returns the patch names now playing.
   */
  async useNova(moduleUrl: string, patches: readonly (Uint8Array | null)[]): Promise<string[]> {
    await loadNovaWorklet(this.ctx, moduleUrl);
    const names: string[] = [];
    for (const t of [0, 1]) {
      const strip = this.strips[t]!, patch = patches[t];
      if (!patch) continue;
      if (strip.instrument instanceof NovaInstrument) strip.instrument.setPatch(patch);
      else {
        strip.instrument.dispose();
        strip.instrument = new NovaInstrument(this.ctx, strip.gain, patch);
      }
      names.push((strip.instrument as NovaInstrument).name);
    }
    return names;
  }

  /** Plays scheduler messages. Messages without a track (clock, start, stop) are ignored here. */
  handle(msgs: readonly TimedMessage[]): void {
    const { perfMs, audioS } = this.clock();
    for (const m of msgs) {
      if (m.track === undefined) continue;
      const strip = this.strips[m.track];
      if (!strip) continue;
      const time = Math.max(audioS, audioS + (m.at - perfMs) / 1000);
      const kind = (m.bytes[0] ?? 0) & 0xf0, a = m.bytes[1] ?? 0, b = m.bytes[2] ?? 0;
      if (kind === 0x90 && b > 0) strip.instrument.noteOn({ time, note: a, velocity: b, ...(m.sample !== undefined ? { sample: m.sample } : {}) });
      else if (kind === 0x80 || kind === 0x90) strip.instrument.noteOff(time, a);
      else if (kind === 0xb0) strip.instrument.control(time, a, b);
    }
  }

  /** Every track silent now. */
  silence(): void { for (const s of this.strips) s.instrument.silence(this.ctx.currentTime); }

  setTrackLevel(track: number, level: number): void {
    const s = this.strips[track];
    if (s) s.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), this.ctx.currentTime, 0.01);
  }

  dispose(): void { for (const s of this.strips) s.instrument.dispose(); }
}

/** Decodes a WAV the service returned. */
export function wavLoader(ctx: BaseAudioContext, fetchBytes: (index: number) => Promise<Uint8Array>): SampleLoader {
  return async (index) => {
    const bytes = await fetchBytes(index);
    const copy = bytes.slice().buffer; // decodeAudioData detaches its input
    return ctx.decodeAudioData(copy);
  };
}
