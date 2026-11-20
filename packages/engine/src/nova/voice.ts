// The Nova voice: oscillators, mixer, filter, three envelopes, two LFOs (lfo.ts), the mod matrix,
// the polyphony modes and portamento. Macros apply in the patch domain; the per-patch FX are in
// fx/patch.ts.
// Pure DSP: it renders into Float32Arrays and keeps time in frames.
import { FIRST_WAVETABLE, PATCH_PARAMS, applyMacros } from "@circuit-desk/patch";
import * as C from "./curves.ts";
import { Envelope, Noise, Svf, type SvfMode, saw, sawPulse, sine, triangle } from "./dsp.ts";
import { Lfo, lfoParams, type LfoParams } from "./lfo.ts";

/** The device updates parameters per 32-frame block (NOTAS:3098). */
export const BLOCK = 32;
/** Synth 1 and 2 share 12 voice slots on the device (NOTAS:4397): 6 each. */
export const VOICES = 6;
/**
 * Output level of one voice: a guess until plan step E4 measures the device. Set from the card's
 * own projects (tools/synth-audit.ts, 298 synth parts playing their real notes, macros applied):
 * at 0.4 the median part peaks near −5 dBFS, next to pack drum samples that play near −3 dBFS.
 * Chords add up above that; the master gain and limiter take the sum, as they do for drums.
 * History: 0.2, then 0.6 while macros were off and many filters stayed closed; 0.6 with macros on
 * put the median part at −1.5 dBFS and a quarter of them above +4.6.
 */
export const VOICE_GAIN = 0.4;
/**
 * Macros on: the offset formula is read from the firmware (packages/patch/macros.ts, plan E0.4).
 * Many patches store a closed filter or a silent oscillator and let a macro at its stored position
 * open it, so without macros they play silent (tools/synth-audit.ts).
 */
export const APPLY_MACROS = true;

/** How far envelope 2 at full depth moves the cutoff, semitones (a guess, like the curves). */
const ENV2_RANGE = 60;

export interface OscParams { wave: number; width: number; morph: number; transpose: number; level: number }

export interface NovaParams {
  polyphony: 0 | 1 | 2;
  portamento: number;
  preGlide: number;
  osc: [OscParams, OscParams];
  ring: number;
  noise: number;
  preFx: number;
  postFx: number;
  routing: number;
  drive: number;
  filterType: number;
  cutoff: number;
  tracking: number;
  q: number;
  /** Q normalise 0–1: how much the filter's input is turned down as resonance rises (a guess). */
  qNormalise: number;
  env2ToCutoff: number;
  env: { velocity: number; delay: number; attack: number; decay: number; sustain: number; release: number }[];
  lfo: [LfoParams, LfoParams];
  /** Active mod matrix slots (depth ≠ 0). */
  matrix: { source1: number; source2: number; depth: number; destination: number }[];
  /** Raw 0–127 values the matrix offsets, so modulated parameters go through the same curves. */
  raw: { cutoff: number; resonance: number; drive: number };
}

// Mod matrix sources (guide p. 9): 0 direct, 4 velocity, 5 keyboard, 6–9 LFOs, 10–12 envelopes.
// Scales for destinations are guesses until E0.6 measures them.
/** Pitch destinations at full depth, semitones. */
const MOD_PITCH_RANGE = 12;

/**
 * Turns a patch's raw values (by parameter id, as packages/patch parses them) into voice settings.
 * Macros are applied first, in the 0–127 domain, as the firmware does; `macroPositions` overrides
 * the stored knob positions (automation lanes 1–8).
 */
export function novaParams(raw: Readonly<Record<string, number>>, macroPositions?: readonly (number | undefined)[], bpm = 120): NovaParams {
  const v = APPLY_MACROS ? applyMacros(raw, macroPositions) : raw;
  const g = (id: string): number => {
    const x = v[id];
    if (x === undefined) throw new Error(`patch value ${id} missing`);
    return x;
  };
  // "Keyboard Octave" (byte 35) is the octave the device's pads are set to, saved with the patch
  // (NOTAS:3632: Octave ▲/▼ in the note view is the keyboard octave). A pad sends the shifted note,
  // and the sequencer stores that note, so the voice must not shift it again. Applying it played
  // 198 of the card's 304 project patches one to four octaves low, many below hearing (e.g.
  // "LivingDead" in 00_Delorean Dream-Tracks/40_SESSION: Osc 1 at 16 Hz). To confirm on a device.
  const osc = (n: 1 | 2): OscParams => ({
    wave: g(`osc${n}.wave`),
    width: 0.05 + 0.9 * (g(`osc${n}.pulseWidth`) / 127),
    morph: g(`osc${n}.waveInterpolate`) / 127,
    transpose: (g(`osc${n}.semitones`) - 64) + (g(`osc${n}.cents`) - 64) / 100,
    level: C.level(g(`mixer.osc${n}`)),
  });
  const env = (n: 1 | 2 | 3) => ({
    velocity: n === 3 ? 0 : C.bipolar(g(`env${n}.velocity`)),
    delay: n === 3 ? C.envelopeSeconds(g("env3.delay")) : 0,
    attack: C.envelopeSeconds(g(`env${n}.attack`), "attack", n),
    decay: C.envelopeSeconds(g(`env${n}.decay`), "decay", n),
    sustain: g(`env${n}.sustain`) / 127,
    release: C.envelopeSeconds(g(`env${n}.release`), "release", n),
  });
  return {
    polyphony: Math.min(2, g("voice.polyphony")) as 0 | 1 | 2,
    portamento: C.portamentoSeconds(g("voice.portamento")),
    preGlide: g("voice.preGlide") - 64,
    osc: [osc(1), osc(2)],
    ring: C.level(g("mixer.ringMod")),
    noise: C.level(g("mixer.noise")),
    preFx: C.dbGain(g("mixer.preFx")),
    postFx: C.dbGain(g("mixer.postFx")),
    routing: g("filter.routing"),
    drive: g("filter.drive") / 127,
    filterType: g("filter.type"),
    cutoff: g("filter.frequency"),
    tracking: g("filter.tracking") / 127,
    q: C.resonanceQ(g("filter.resonance")),
    qNormalise: g("filter.qNormalise") / 127,
    env2ToCutoff: C.bipolar(g("filter.env2ToFrequency")),
    env: [env(1), env(2), env(3)],
    lfo: [lfoParams(g, 1, bpm), lfoParams(g, 2, bpm)],
    matrix: Array.from({ length: 20 }, (_, k) => ({
      source1: g(`mod${k + 1}.source1`), source2: g(`mod${k + 1}.source2`),
      depth: C.bipolar(g(`mod${k + 1}.depth`)), destination: g(`mod${k + 1}.destination`),
    })).filter((m) => m.depth !== 0),
    raw: { cutoff: g("filter.frequency"), resonance: g("filter.resonance"), drive: g("filter.drive") },
  };
}

/** Per-block modulation from the mod matrix, by destination (guide p. 9 table, 0–17). */
export interface ModState { values: Float64Array }

/**
 * Mod matrix sums for one voice at block rate. Sources: direct, velocity, keyboard, the LFOs (6/8
 * unipolar "+", 7/9 bipolar "±") and the three envelopes; 1–3 are undocumented and read 0. Two
 * sources multiply; source 2 = direct is 1.
 */
export function modSums(p: NovaParams, velocity: number, note: number, env: readonly number[], out: Float64Array, lfo: readonly number[] = [0, 0]): void {
  out.fill(0);
  const src = (s: number): number => {
    switch (s) {
      case 0: return 1;
      case 4: return velocity / 127;
      case 5: return (note - 60) / 64;
      case 6: return ((lfo[0] ?? 0) + 1) / 2;
      case 7: return lfo[0] ?? 0;
      case 8: return ((lfo[1] ?? 0) + 1) / 2;
      case 9: return lfo[1] ?? 0;
      case 10: return env[0] ?? 0;
      case 11: return env[1] ?? 0;
      case 12: return env[2] ?? 0;
      default: return 0;
    }
  };
  for (const m of p.matrix) out[m.destination] = (out[m.destination] ?? 0) + m.depth * src(m.source1) * src(m.source2);
}

/** The guide's default values, by id: a patch for tests and the fallback when none is loaded. */
export function defaultValues(): Record<string, number> {
  return Object.fromEntries(PATCH_PARAMS.map((p) => [p.id, p.default]));
}

/** One oscillator sample. Wavetables (14–29) are placeholders until real tables exist (plan D-1). */
export function oscSample(o: OscParams, phase: number, dt: number): number {
  const w = o.wave;
  if (w === 0) return sine(phase);
  if (w === 1) return triangle(phase);
  if (w === 2) return saw(phase, dt);
  if (w >= 3 && w <= 11) return sawPulse(phase, dt, (12 - w) / 10);
  if (w === 12) return sawPulse(phase, dt, o.width);
  if (w === 13) return sawPulse(phase, dt, 0.5);
  if (w === FIRST_WAVETABLE) return sine(phase);
  // Placeholder for the other wavetables: interpolate sweeps from saw to square.
  return (1 - o.morph) * saw(phase, dt) + o.morph * sawPulse(phase, dt, 0.5);
}

const FILTER_STAGES: readonly { mode: SvfMode; stages: 1 | 2 }[] = [
  { mode: "low", stages: 1 }, { mode: "low", stages: 2 }, { mode: "band", stages: 1 },
  { mode: "band", stages: 2 }, { mode: "high", stages: 1 }, { mode: "high", stages: 2 },
];

const midiHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

export class Voice {
  note = -1;
  velocity = 0;
  /** Frame the voice started, for stealing the oldest. */
  started = 0;
  private pitch = 0;
  private glideFrom = 0;
  private glideLeft = 0;
  private glideTotal = 0;
  private readonly phase = [0, 0];
  private readonly env = [new Envelope(), new Envelope(), new Envelope()];
  private readonly svf = [new Svf(), new Svf()];
  private readonly noise = new Noise();
  private readonly mod = new Float64Array(18);
  readonly lfo: [Lfo, Lfo];

  private readonly sampleRate: number;

  /** `seed` keeps each voice's random LFO shapes its own and repeatable. */
  constructor(sampleRate: number, seed = 1) {
    this.sampleRate = sampleRate;
    this.lfo = [new Lfo(seed * 2 + 1), new Lfo(seed * 2 + 2)];
  }

  get active(): boolean { return this.env[0]!.stage !== "idle"; }
  get releasing(): boolean { return this.env[0]!.stage === "release"; }
  get level(): number { return this.env[0]!.value; }

  /** Starts (or, with `legato`, moves) the voice to `note`. `from` is the pitch to glide from. */
  start(p: NovaParams, note: number, velocity: number, frame: number, from: number | null, legato: boolean): void {
    const sr = this.sampleRate;
    this.started = frame;
    // Only a silent voice starts its waveform and filter afresh. A sounding voice (retrigger, a
    // stolen voice, a mono note change) carries on from where it is, and its envelopes rise from
    // their current level: restarting mid-cycle was a click.
    if (!this.active) {
      this.phase[0] = 0; this.phase[1] = 0;
      for (const f of this.svf) f.reset();
    }
    this.note = note;
    this.velocity = velocity;
    const preGlide = p.preGlide !== 0 && p.portamento > 0 ? note + p.preGlide : null;
    const start = from ?? preGlide;
    if (start !== null && p.portamento > 0) {
      this.glideFrom = start;
      this.glideTotal = this.glideLeft = Math.max(1, Math.round(p.portamento * sr));
    } else {
      this.glideLeft = 0;
    }
    this.pitch = note;
    p.env.forEach((e, i) => {
      this.env[i]!.configure(e.delay, e.attack, e.decay, e.sustain, e.release, sr);
      this.env[i]!.gate(Math.round(e.delay * sr), legato);
    });
    p.lfo.forEach((l, i) => this.lfo[i]!.trigger(l, legato));
  }

  release(): void { for (const e of this.env) e.release(); }

  /** Fast fade for all-notes-off: the shortest click-free release. */
  kill(p: NovaParams): void {
    const e = p.env[0]!;
    this.env[0]!.configure(0, e.attack, e.decay, e.sustain, 0, this.sampleRate);
    this.env[0]!.release();
  }

  /**
   * Adds `n` frames (n ≤ BLOCK) of this voice into `out` from `offset`. `shared` holds the synth's
   * common-sync LFO values, used for an LFO with common sync on.
   */
  render(p: NovaParams, out: Float32Array, offset: number, n: number, shared?: readonly [number, number]): void {
    const sr = this.sampleRate;
    // Control rate, once per block: pitch with glide, filter coefficients.
    let pitch = this.pitch;
    if (this.glideLeft > 0) {
      pitch = this.pitch + (this.glideFrom - this.pitch) * (this.glideLeft / this.glideTotal);
      this.glideLeft = Math.max(0, this.glideLeft - n);
    }
    const env2 = this.env[1]!.value;
    const vel = this.velocity / 127;
    const velScale = (amount: number): number => (amount >= 0 ? 1 - amount * (1 - vel) : 1 + amount * vel);
    // Mod matrix (block rate). Parameter-domain destinations add depth × 127 to the raw value.
    const mod = this.mod;
    // LFOs first: their rate destinations (14, 15) use the last block's matrix sums.
    const lfo = p.lfo.map((l, k) =>
      l.commonSync && shared ? shared[k]! : this.lfo[k]!.advance(l, Lfo.hz(l, mod[14 + k] ?? 0), n / sr));
    modSums(p, this.velocity, this.note, [this.env[0]!.value, env2, this.env[2]!.value], mod, lfo);
    const raw = (base: number, d: number): number => Math.min(127, Math.max(0, base + (mod[d] ?? 0) * 127));
    const unit = (base: number, d: number): number => Math.min(1, Math.max(0, base + (mod[d] ?? 0)));
    const q = C.resonanceQ(raw(p.raw.resonance, 13));
    const drive = raw(p.raw.drive, 11) / 127;
    const cutoffNote = 12 * Math.log2(C.filterHz(raw(p.raw.cutoff, 12)) / midiHz(60)) + 60
      + (pitch - 60) * p.tracking + env2 * p.env2ToCutoff * ENV2_RANGE * velScale(p.env[1]!.velocity);
    const fs = FILTER_STAGES[p.filterType] ?? FILTER_STAGES[1]!;
    for (const f of this.svf) f.set(midiHz(cutoffNote), fs.stages === 2 ? Math.sqrt(q) : q, sr);
    const both = (mod[0] ?? 0) * MOD_PITCH_RANGE;
    const dt = [
      midiHz(pitch + p.osc[0].transpose + both + (mod[1] ?? 0) * MOD_PITCH_RANGE) / sr,
      midiHz(pitch + p.osc[1].transpose + both + (mod[2] ?? 0) * MOD_PITCH_RANGE) / sr,
    ];
    const lv1 = unit(p.osc[0].level, 7), lv2 = unit(p.osc[1].level, 8);
    const noiseLv = unit(p.noise, 9), ringLv = unit(p.ring, 10);
    const amp = VOICE_GAIN * velScale(p.env[0]!.velocity) * p.postFx;
    const driveGain = 1 + drive * 7;
    // Q normalise: turn the filter input down as resonance rises (a guess at what the parameter does).
    const qComp = q > 1 ? q ** -(p.qNormalise) : 1;

    for (let i = 0; i < n; i++) {
      const e1 = this.env[0]!.next();
      this.env[1]!.next();
      this.env[2]!.next();
      const s1 = oscSample(p.osc[0], this.phase[0]!, dt[0]!);
      const s2 = oscSample(p.osc[1], this.phase[1]!, dt[1]!);
      for (let k = 0; k < 2; k++) {
        let ph = this.phase[k]! + dt[k]!;
        if (ph >= 1) ph -= 1;
        this.phase[k] = ph;
      }
      const a = s1 * lv1, b = s2 * lv2;
      const extra = s1 * s2 * ringLv + this.noise.next() * noiseLv;
      // Routing (guide): 0 everything through the filter; 1 osc 1 bypasses; 2 osc 1 + 2 bypass.
      const filtered = p.routing === 0 ? a + b + extra : p.routing === 1 ? b + extra : extra;
      const bypass = p.routing === 0 ? 0 : p.routing === 1 ? a : a + b;
      let x = filtered * p.preFx * qComp;
      if (drive > 0) x = Math.tanh(x * driveGain) / Math.sqrt(driveGain);
      let y = this.svf[0]!.process(x, fs.mode);
      if (fs.stages === 2) y = this.svf[1]!.process(y, fs.mode);
      out[offset + i]! += (y + bypass * p.preFx) * e1 * amp;
    }
  }
}
