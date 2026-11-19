/// <reference lib="dom" />
// A small polyphonic subtractive synth: the stand-in voice for Synth 1/2 and MIDI tracks until the
// Nova patch format is decoded. Its settings are plain data (SynthPatch) so a decoded patch can be
// mapped onto it, and so a Nova emulator can replace it behind the same Instrument interface.
import type { Instrument, NoteOn } from "./types.ts";

export type Wave = "sawtooth" | "square" | "triangle" | "sine";

export interface Envelope { attack: number; decay: number; sustain: number; release: number }

export interface SynthPatch {
  name: string;
  osc1: Wave;
  osc2: Wave;
  /** Osc 2 detune in cents, and its level against osc 1 (0–1). */
  detune: number;
  osc2Level: number;
  /** Osc 2 transpose in semitones (e.g. −12 for a sub). */
  osc2Semitones: number;
  cutoff: number;
  resonance: number;
  /** How far the filter envelope opens the cutoff, in Hz. */
  filterEnvAmount: number;
  filterEnv: Envelope;
  ampEnv: Envelope;
  /** Most notes sounding at once; the oldest is stolen. The Circuit synths have 6. */
  voices: number;
  /** Output level, 0–1. */
  level: number;
}

/** Stand-in sounds, one per track kind. Named so they can be listed and edited later. */
export const STAND_IN_PATCHES: Readonly<Record<"synth1" | "synth2" | "midi", SynthPatch>> = {
  synth1: {
    name: "Stand-in keys", osc1: "sawtooth", osc2: "square", detune: 7, osc2Level: 0.5, osc2Semitones: 0,
    cutoff: 1800, resonance: 2, filterEnvAmount: 2400, filterEnv: { attack: 0.005, decay: 0.25, sustain: 0.2, release: 0.2 },
    ampEnv: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.25 }, voices: 6, level: 0.35,
  },
  synth2: {
    name: "Stand-in bass", osc1: "sawtooth", osc2: "square", detune: 0, osc2Level: 0.6, osc2Semitones: -12,
    cutoff: 500, resonance: 4, filterEnvAmount: 1500, filterEnv: { attack: 0.002, decay: 0.18, sustain: 0.1, release: 0.1 },
    ampEnv: { attack: 0.002, decay: 0.2, sustain: 0.8, release: 0.12 }, voices: 6, level: 0.4,
  },
  midi: {
    name: "Stand-in MIDI preview", osc1: "triangle", osc2: "sine", detune: 3, osc2Level: 0.4, osc2Semitones: 12,
    cutoff: 4000, resonance: 0.7, filterEnvAmount: 0, filterEnv: { attack: 0.01, decay: 0.1, sustain: 1, release: 0.1 },
    ampEnv: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.2 }, voices: 6, level: 0.3,
  },
};

const hz = (note: number): number => 440 * 2 ** ((note - 69) / 12);
/** Envelopes ramp towards zero exponentially; this is "silent enough". */
const FLOOR = 0.0001;

interface Voice { note: number; start: number; oscs: OscillatorNode[]; amp: GainNode; filter: BiquadFilterNode; released: boolean }

export class Synth implements Instrument {
  private readonly ctx: BaseAudioContext;
  private readonly out: AudioNode;
  private patch: SynthPatch;
  private voices: Voice[] = [];

  constructor(ctx: BaseAudioContext, out: AudioNode, patch: SynthPatch) {
    this.ctx = ctx; this.out = out; this.patch = patch;
  }

  setPatch(p: SynthPatch): void { this.patch = p; }

  noteOn({ time, note, velocity }: NoteOn): void {
    const p = this.patch, ctx = this.ctx;
    // Retriggering a sounding key, or more notes than voices, steals the oldest.
    for (const v of this.voices.filter((x) => x.note === note && !x.released)) this.release(v, time, 0.01);
    while (this.voices.length >= p.voices) { const v = this.voices.shift(); if (v) this.kill(v, time); }
    const amp = ctx.createGain(), filter = ctx.createBiquadFilter();
    filter.type = "lowpass"; filter.Q.value = p.resonance;
    const peak = p.level * (velocity / 127);
    const a = p.ampEnv, f = p.filterEnv;
    amp.gain.setValueAtTime(FLOOR, time);
    amp.gain.exponentialRampToValueAtTime(Math.max(FLOOR, peak), time + a.attack);
    amp.gain.exponentialRampToValueAtTime(Math.max(FLOOR, peak * a.sustain), time + a.attack + a.decay);
    filter.frequency.setValueAtTime(p.cutoff, time);
    filter.frequency.linearRampToValueAtTime(p.cutoff + p.filterEnvAmount, time + f.attack);
    filter.frequency.linearRampToValueAtTime(p.cutoff + p.filterEnvAmount * f.sustain, time + f.attack + f.decay);
    const mk = (type: Wave, freq: number, detune: number, level: number): OscillatorNode => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq; o.detune.value = detune; g.gain.value = level;
      o.connect(g).connect(filter); o.start(time);
      return o;
    };
    const oscs = [mk(p.osc1, hz(note), 0, 1 - p.osc2Level * 0.5), mk(p.osc2, hz(note + p.osc2Semitones), p.detune, p.osc2Level)];
    filter.connect(amp).connect(this.out);
    const v: Voice = { note, start: time, oscs, amp, filter, released: false };
    oscs[0]!.onended = () => { this.voices = this.voices.filter((x) => x !== v); amp.disconnect(); };
    this.voices.push(v);
  }

  noteOff(time: number, note: number): void {
    for (const v of this.voices) if (v.note === note && !v.released) this.release(v, time, this.patch.ampEnv.release);
  }

  control(time: number, cc: number): void {
    if (cc === 120 || cc === 123) this.silence(time);
  }

  silence(time: number): void {
    for (const v of [...this.voices]) this.kill(v, time);
  }

  dispose(): void { this.silence(this.ctx.currentTime); }

  private release(v: Voice, time: number, release: number): void {
    v.released = true;
    const t = Math.max(time, v.start);
    v.amp.gain.cancelScheduledValues(t);
    v.amp.gain.setTargetAtTime(FLOOR, t, Math.max(0.005, release / 4));
    for (const o of v.oscs) o.stop(t + release + 0.05);
  }

  private kill(v: Voice, time: number): void {
    this.voices = this.voices.filter((x) => x !== v);
    if (!v.released) this.release(v, time, 0.015);
  }
}
