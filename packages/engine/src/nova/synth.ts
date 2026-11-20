// One Nova synth part (Synth 1 or 2): a voice pool, the polyphony modes, and an event queue timed
// in frames so notes land on the exact sample. Pure DSP; the AudioWorklet and tests drive it.
import { BLOCK, VOICES, Voice, defaultValues, novaParams, type NovaParams } from "./voice.ts";
import { Lfo } from "./lfo.ts";
import { PatchFx } from "../fx/patch.ts";

export type NovaEvent =
  | { frame: number; type: "on"; note: number; velocity: number }
  | { frame: number; type: "off"; note: number }
  | { frame: number; type: "silence" }
  /** A macro knob moved (automation lanes 1–8): index 0–7, value 0–127. */
  | { frame: number; type: "macro"; index: number; value: number };

export class NovaSynth {
  private params: NovaParams;
  private readonly voices: Voice[];
  private queue: NovaEvent[] = [];
  /** The next frame process() renders. */
  frame = 0;
  /** Held keys, latest last: mono modes return to the previous key on release. */
  private held: { note: number; velocity: number }[] = [];
  private lastNote: number | null = null;

  readonly sampleRate: number;
  /** The patch's own distortion, EQ and chorus, after the voices (processStereo). */
  readonly fx: PatchFx;
  private values: Readonly<Record<string, number>>;
  private bpm = 120;
  private mono = new Float32Array(128);
  /** Macro knob positions set by automation; undefined = the patch's stored position. */
  private macros: (number | undefined)[] = [];
  /** The LFOs every voice follows when an LFO has common sync on. */
  private readonly common: [Lfo, Lfo] = [new Lfo(97), new Lfo(98)];
  private readonly commonValues: [number, number] = [0, 0];

  constructor(sampleRate: number, values: Readonly<Record<string, number>> = defaultValues()) {
    this.sampleRate = sampleRate;
    this.values = values;
    this.params = novaParams(values);
    this.voices = Array.from({ length: VOICES }, (_, k) => new Voice(sampleRate, k + 1));
    this.fx = new PatchFx(sampleRate);
    this.fx.setValues(values, this.bpm);
  }

  /** New patch values; sounding voices pick them up from the next block. */
  setValues(values: Readonly<Record<string, number>>): void {
    this.values = values;
    this.macros = [];
    this.params = novaParams(values, undefined, this.bpm);
    this.fx.setValues(values, this.bpm);
  }

  /** Tempo, for synced chorus and LFO rates. */
  setBpm(bpm: number): void {
    if (!(bpm > 0)) return;
    this.bpm = bpm;
    this.params = novaParams(this.values, this.macros, bpm);
    this.fx.setValues(this.values, bpm);
  }

  /** Renders left.length frames through the patch's effects into `left` and `right` (written, not added). */
  processStereo(left: Float32Array, right: Float32Array): void {
    if (this.mono.length !== left.length) this.mono = new Float32Array(left.length);
    this.mono.fill(0);
    this.process(this.mono);
    this.fx.process(this.mono, left, right);
  }

  schedule(e: NovaEvent): void {
    // Keep the queue sorted; events at the same frame keep their order.
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]!.frame > e.frame) i--;
    this.queue.splice(i, 0, e);
  }

  /** Renders out.length frames (mono, added to `out`), applying events at their frames. */
  process(out: Float32Array): void {
    const end = this.frame + out.length;
    let at = 0;
    while (at < out.length) {
      while (this.queue.length && this.queue[0]!.frame <= this.frame + at) this.apply(this.queue.shift()!, this.frame + at);
      const nextEvent = this.queue.length ? this.queue[0]!.frame - this.frame : out.length;
      const n = Math.max(1, Math.min(BLOCK, out.length - at, nextEvent - at));
      const p = this.params;
      if (p.lfo[0].commonSync || p.lfo[1].commonSync) {
        // The shared LFOs run whether or not a voice sounds; no per-voice rate modulation here.
        p.lfo.forEach((l, k) => { this.commonValues[k] = this.common[k]!.advance(l, Lfo.hz(l), n / this.sampleRate); });
      }
      for (const v of this.voices) if (v.active) v.render(p, out, at, n, this.commonValues);
      at += n;
    }
    this.frame = end;
  }

  private apply(e: NovaEvent, frame: number): void {
    if (e.type === "silence") {
      // Playback stopped: automation already queued for later must not move the next play.
      this.queue = this.queue.filter((q) => q.type !== "macro");
      for (const v of this.voices) if (v.active) v.kill(this.params);
      this.held = [];
      return;
    }
    if (e.type === "macro") {
      this.macros[e.index] = e.value;
      this.params = novaParams(this.values, this.macros, this.bpm);
      return;
    }
    if (e.type === "on") this.noteOn(e.note, e.velocity, frame);
    else this.noteOff(e.note);
  }

  private noteOn(note: number, velocity: number, frame: number): void {
    const p = this.params;
    this.held = this.held.filter((h) => h.note !== note);
    this.held.push({ note, velocity });
    const from = p.portamento > 0 ? this.lastNote : null;
    // Common sync with key sync: the shared LFO restarts on every note.
    p.lfo.forEach((l, k) => { if (l.commonSync) this.common[k]!.trigger(l, this.held.length > 1); });
    this.lastNote = note;
    if (p.polyphony < 2) {
      // Mono: one voice. Mono AG keeps envelopes running while a key is held (legato).
      const v = this.voices[0]!;
      const legato = p.polyphony === 1 && this.held.length > 1 && v.active && !v.releasing;
      v.start(p, note, velocity, frame, from, legato);
      return;
    }
    const same = this.voices.find((v) => v.active && v.note === note);
    // A retriggered or stolen voice is restarted in place (Voice.start keeps it continuous).
    const v = same ?? this.voices.find((x) => !x.active) ?? this.steal();
    v.start(p, note, velocity, frame, from, false);
  }

  /** Released voices first (quietest), then the oldest. The device's load-based rule is not modelled. */
  private steal(): Voice {
    const released = this.voices.filter((v) => v.releasing).sort((a, b) => a.level - b.level);
    return released[0] ?? [...this.voices].sort((a, b) => a.started - b.started)[0]!;
  }

  private noteOff(note: number): void {
    const p = this.params;
    this.held = this.held.filter((h) => h.note !== note);
    if (p.polyphony < 2) {
      const v = this.voices[0]!;
      if (v.note !== note) return;
      const back = this.held.at(-1);
      if (back) v.start(p, back.note, back.velocity, this.frame, p.portamento > 0 ? note : null, p.polyphony === 1);
      else v.release();
      return;
    }
    for (const v of this.voices) if (v.active && !v.releasing && v.note === note) v.release();
  }
}
