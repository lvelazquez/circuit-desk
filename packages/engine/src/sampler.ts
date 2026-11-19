/// <reference lib="dom" />
// Plays a drum track from the pack's own samples (48 kHz mono WAVs, PCM/NN_Name.wav). One sound
// at a time per track, as the Circuit's drum tracks do: a new hit cuts the last.
import type { Instrument, NoteOn } from "./types.ts";

/** Fetches and decodes sample `index` (0–63) of the pack; null when the pack has none. */
export type SampleLoader = (index: number) => Promise<AudioBuffer | null>;

/** A short synthetic hit, used when the pack's sample is not available. */
export type FallbackVoice = "kick" | "snare" | "hat" | "perc";

const FADE = 0.004;

export class Sampler implements Instrument {
  private readonly ctx: BaseAudioContext;
  private readonly out: AudioNode;
  private readonly buffers = new Map<number, AudioBuffer | null>();
  private sample: number;
  private readonly fallback: FallbackVoice;
  private current: { src: AudioScheduledSourceNode; gain: GainNode } | null = null;

  constructor(ctx: BaseAudioContext, out: AudioNode, sample: number, fallback: FallbackVoice) {
    this.ctx = ctx; this.out = out; this.sample = sample; this.fallback = fallback;
  }

  /** The track's own sample (from the project's drum record). */
  setSample(index: number): void { this.sample = index; }

  /** Decodes the samples this track will need before playback starts, so the first hit is on time. */
  async load(indices: Iterable<number>, loader: SampleLoader): Promise<void> {
    await Promise.all([...new Set([this.sample, ...indices])].filter((i) => !this.buffers.has(i)).map(async (i) => {
      try { this.buffers.set(i, await loader(i)); } catch { this.buffers.set(i, null); }
    }));
  }

  noteOn({ time, velocity, sample }: NoteOn): void {
    this.choke(time);
    const gain = this.ctx.createGain();
    gain.gain.value = (velocity / 127) ** 1.5;
    gain.connect(this.out);
    const buf = this.buffers.get(sample ?? this.sample);
    const src = buf ? this.play(buf, gain, time) : this.synthesize(gain, time);
    this.current = { src, gain };
    src.onended = () => { gain.disconnect(); if (this.current?.src === src) this.current = null; };
  }

  noteOff(): void { /* one-shots play to the end, as on the Circuit */ }
  control(time: number, cc: number): void { if (cc === 120 || cc === 123) this.silence(time); }
  silence(time: number): void { this.choke(time); }
  dispose(): void { this.silence(this.ctx.currentTime); }

  private choke(time: number): void {
    const c = this.current;
    if (!c) return;
    c.gain.gain.setTargetAtTime(0, time, FADE);
    try { c.src.stop(time + FADE * 6); } catch { /* already stopped */ }
    this.current = null;
  }

  private play(buf: AudioBuffer, out: AudioNode, time: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.connect(out); src.start(time);
    return src;
  }

  /** A rough stand-in hit: pitched sine for kick/perc, filtered noise for snare/hat. */
  private synthesize(out: GainNode, time: number): AudioScheduledSourceNode {
    const ctx = this.ctx, env = ctx.createGain();
    env.connect(out);
    const len = this.fallback === "kick" ? 0.35 : this.fallback === "hat" ? 0.06 : 0.18;
    env.gain.setValueAtTime(1, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + len);
    if (this.fallback === "kick" || this.fallback === "perc") {
      const o = ctx.createOscillator();
      const f0 = this.fallback === "kick" ? 150 : 600;
      o.frequency.setValueAtTime(f0, time);
      o.frequency.exponentialRampToValueAtTime(f0 / 3, time + len);
      o.connect(env); o.start(time); o.stop(time + len + 0.02);
      return o;
    }
    const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = seed / 1073741823.5 - 1; }
    const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter();
    src.buffer = noise; hp.type = "highpass"; hp.frequency.value = this.fallback === "hat" ? 7000 : 1500;
    src.connect(hp).connect(env); src.start(time);
    return src;
  }
}
