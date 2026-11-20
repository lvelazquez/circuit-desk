// The project mixer: per track the drum knobs (drums), the sidechain (Synth 1/2, MIDI 1/2), level and
// pan, then the reverb and delay sends and returns. Automation lanes move level, pan, sends and the
// drums' distortion and EQ at exact frames. Pure DSP; the mixer worklet runs it.
// Track order everywhere: Synth 1, Synth 2, MIDI 1, MIDI 2, Drum 1–4 (the engine's strips).
import type { SoundSettings } from "@circuit-desk/ncs";
import type { MixerTarget } from "../nova/protocol.ts";
import * as C from "./curves.ts";
import { Reverb, SidechainEnv, StereoDelay, TiltEq, drumShape } from "./effects.ts";

/** Each strip's index in the project's send lists (ncs SEND_TRACKS: Synth 1, Synth 2, Drum 1–4, MIDI 1, MIDI 2). */
const SEND_INDEX = [0, 1, 6, 7, 2, 3, 4, 5];

/** Level and pan changes glide over this long, so a stepped lane does not click (the firmware smooths its gains too). */
const GLIDE_SECONDS = 0.005;

interface Strip {
  level: number; pan: number;
  /** Current gains, gliding toward the targets tgl / tgr. */
  gl: number; gr: number; tgl: number; tgr: number;
  rev: number; del: number; tilt: number; drive: number;
  eq: [TiltEq, TiltEq];
}

export type MixerEvent =
  | { frame: number; drum: number }
  | { frame: number; track: number; target: MixerTarget; value: number };

export class ProjectMixer {
  readonly sr: number;
  private strips: Strip[];
  private readonly sidechains: SidechainEnv[];
  /** Which drum (0–3) triggers each sidechain (Synth 1, Synth 2, MIDI 1, MIDI 2); -1 = none. */
  private scSource = [-1, -1, -1, -1];
  private readonly delay: StereoDelay;
  private readonly reverb: Reverb;
  private fxBypass = false;
  private queue: MixerEvent[] = [];
  /** False passes every strip straight through at unity (the app's FX switch). */
  enabled = true;
  private haveSettings = false;
  private readonly ret: [number, number] = [0, 0];
  private readonly glide: number;

  constructor(sr: number) {
    this.sr = sr;
    this.glide = 1 - Math.exp(-1 / (GLIDE_SECONDS * sr));
    this.strips = Array.from({ length: 8 }, () => ({
      level: 127, pan: 64, gl: 1, gr: 1, tgl: 1, tgr: 1, rev: 0, del: 0, tilt: 0, drive: 0, eq: [new TiltEq(sr), new TiltEq(sr)] as [TiltEq, TiltEq],
    }));
    this.sidechains = [0, 1, 2, 3].map(() => new SidechainEnv(sr));
    this.delay = new StereoDelay(sr);
    this.reverb = new Reverb(sr);
  }

  /** The project's stored settings; every strip jumps to them (no glide). */
  set(s: SoundSettings, bpm: number): void {
    this.strips = this.strips.map((old, t) => {
      const drum = t >= 4 ? s.drums[t - 4] : undefined;
      const strip: Strip = {
        ...old,
        level: drum ? drum.level : s.levels[t] ?? 100,
        pan: drum ? drum.pan : s.pans[t] ?? 64,
        rev: C.sendGain(s.reverb.sends[SEND_INDEX[t]!] ?? 0), del: C.sendGain(s.delay.sends[SEND_INDEX[t]!] ?? 0),
        tilt: drum ? C.drumTilt(drum.eq) : 0, drive: drum ? C.drumDrive(drum.distortion) : 0,
      };
      this.aim(strip);
      strip.gl = strip.tgl; strip.gr = strip.tgr;
      return strip;
    });
    s.sidechains.forEach((sc, i) => {
      this.sidechains[i]!.set(sc.attack, sc.hold, sc.decay, sc.depth);
      this.scSource[i] = sc.source <= 3 && sc.depth > 0 ? sc.source : -1;
    });
    this.delay.set(s.delay, bpm);
    this.reverb.set(s.reverb.type, s.reverb.decay, s.reverb.damping);
    this.fxBypass = s.fxBypass;
    this.haveSettings = true;
  }

  /** Drops pending drum triggers and automation (playback stopped). */
  clear(): void { this.queue = []; }

  /** A drum hit at absolute frame `frame` (for the sidechains). */
  trigger(frame: number, drum: number): void { this.enqueue({ frame, drum }); }

  /** An automation change of strip `track` at absolute frame `frame`. */
  automate(frame: number, track: number, target: MixerTarget, value: number): void { this.enqueue({ frame, track, target, value }); }

  private enqueue(e: MixerEvent): void {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1]!.frame > e.frame) i--;
    this.queue.splice(i, 0, e);
  }

  private aim(s: Strip): void {
    const [pl, pr] = C.panGains(s.pan), g = C.levelGain(s.level);
    s.tgl = g * pl; s.tgr = g * pr;
  }

  private apply(e: MixerEvent): void {
    if ("drum" in e) { this.scSource.forEach((src, k) => { if (src === e.drum) this.sidechains[k]!.trigger(); }); return; }
    const s = this.strips[e.track];
    if (!s) return;
    switch (e.target) {
      case "level": s.level = e.value; this.aim(s); break;
      case "pan": s.pan = e.value; this.aim(s); break;
      case "reverb": s.rev = C.sendGain(e.value); break;
      case "delay": s.del = C.sendGain(e.value); break;
      case "drumDistortion": if (e.track >= 4) s.drive = C.drumDrive(e.value); break;
      case "drumEq": if (e.track >= 4) s.tilt = C.drumTilt(e.value); break;
    }
  }

  /**
   * Mixes `n` frames starting at absolute frame `start`. `inputs[t]` is the strip's [left, right]
   * (either may be missing: silence). Writes the stereo result to `outL`, `outR`.
   */
  process(inputs: readonly (readonly (Float32Array | undefined)[] | undefined)[], outL: Float32Array, outR: Float32Array, start: number, n: number): void {
    const bypass = !this.enabled || !this.haveSettings;
    for (let i = 0; i < n; i++) {
      while (this.queue.length && this.queue[0]!.frame <= start + i) this.apply(this.queue.shift()!);
      const duck = this.sidechains.map((s) => s.next());
      let l = 0, r = 0;
      let revL = 0, revR = 0, delL = 0, delR = 0;
      for (let t = 0; t < 8; t++) {
        const s = this.strips[t]!;
        s.gl += (s.tgl - s.gl) * this.glide;
        s.gr += (s.tgr - s.gr) * this.glide;
        const inp = inputs[t];
        const a = inp?.[0], b = inp?.[1] ?? a;
        if (!a) continue;
        let xl = a[i]!, xr = b![i]!;
        if (bypass) { l += xl; r += xr; continue; }
        if (t >= 4) {
          if (s.tilt !== 0) { xl = s.eq[0].process(xl, s.tilt); xr = s.eq[1].process(xr, s.tilt); }
          if (s.drive > 0) { xl = drumShape(xl, s.drive); xr = drumShape(xr, s.drive); }
        }
        const d = t < 4 ? duck[t]! : 1;
        const yl = xl * s.gl * d, yr = xr * s.gr * d;
        l += yl; r += yr;
        revL += yl * s.rev; revR += yr * s.rev;
        delL += yl * s.del; delR += yr * s.del;
      }
      if (!bypass && !this.fxBypass) {
        this.ret[0] = 0; this.ret[1] = 0;
        this.delay.process(delL, delR, this.ret);
        this.reverb.process(revL, revR, this.ret);
        l += this.ret[0]; r += this.ret[1];
      }
      outL[i] = l; outR[i] = r;
    }
  }
}
