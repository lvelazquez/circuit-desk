// Lays a project out in time: which pattern each track plays, and when, with its notes as MIDI.
// Note and drum timing follow circuit-hacks-rc/tools/sd_app.html patMidi (:883).
//
// Assumptions not confirmed on a device (each is reported in `warnings` when it matters):
// - Inside a scene, the tracks are in the order Synth 1, Synth 2, MIDI 1, MIDI 2, Drum 1–4.
//   Card evidence only: over 152 projects, each chain slot points at used patterns of that track
//   most often (docs/card-survey.md).
// - A scene lasts as long as its longest track chain; shorter chains loop inside it.
// - Patterns play forward from their first step to their last; other directions are drawn forward.
// - Probability and swing are ignored: every note plays, straight.
import * as N from "@circuit-desk/ncs";

export const PPQ = 480;

/** Default MIDI channels (0-based) and drum notes of a Circuit Tracks. */
export const DEFAULT_CHANNELS = [0, 1, 2, 3, 9, 9, 9, 9] as const;
export const DEFAULT_DRUM_NOTES = [60, 62, 64, 65] as const;
export const TRACK_NAMES = [...N.NOTE_TRACKS, ...N.DRUM_TRACKS] as const;

export interface MidiNote {
  tick: number;
  /** Length in ticks, at least 1. */
  dur: number;
  pitch: number;
  velocity: number;
  /** Drums: the pack sample (0–63) this hit flips to, when the step has a sample flip. */
  sample?: number;
}

/** One pattern as it is played once: its position, its length, and its notes from tick 0. */
export interface PatternPlay {
  /** 0–7. */
  pattern: number;
  tick: number;
  length: number;
  /** Ticks per step, and the pattern's first step (1-based), to show where playback is. */
  stepTicks: number;
  firstStep: number;
}

/** A controller change: lane automation sent as MIDI CC. */
export interface MidiCc {
  tick: number;
  cc: number;
  value: number;
}

/** What an automation lane drives (packages/ncs lanes.ts). */
export type AutoTarget = "macro" | "level" | "pan" | "reverb" | "delay" | "drumPitch" | "drumDecay" | "drumDistortion" | "drumEq";

/** One automation change: a lane's new value at `tick`, and the CC that carries it to a Circuit. */
export interface AutoEvent {
  tick: number;
  target: AutoTarget;
  /** The macro knob (0–7) for `macro`. */
  index?: number;
  value: number;
  /** Present for the Circuit target where the Programmer's Reference documents a CC. Channel 0-based. */
  cc?: { channel: number; cc: number };
}

export interface PatternClip {
  /** Length in ticks, from the pattern's first step to its last. */
  length: number;
  /** From tick 0 of the pattern. */
  notes: MidiNote[];
  /** Automation sent as CC (MIDI tracks' knob lanes), from tick 0 of the pattern. */
  ccs: MidiCc[];
  /** The pattern's other automation (synth and drum lanes, level, pan, sends), from tick 0. */
  auto: AutoEvent[];
}

export interface ArrangedTrack {
  name: string;
  /** 0-based MIDI channel. */
  channel: number;
  /** The track's 8 patterns, each as it plays once. */
  patterns: PatternClip[];
  plays: PatternPlay[];
  notes: MidiNote[];
  ccs: MidiCc[];
  /** Synth and drum lanes, and every track's level, pan and send lanes (MIDI 1/2 knob lanes are in `ccs`). */
  auto: AutoEvent[];
}

export interface ArrangedScene {
  /** 0–15, or null when the project has no saved scenes and the current chains are used. */
  scene: number | null;
  tick: number;
  length: number;
}

export interface Arrangement {
  name: string;
  bpm: number;
  ppq: number;
  scenes: ArrangedScene[];
  /** How many times the scene sequence repeats in `scenes`. */
  repeats: number;
  tracks: ArrangedTrack[];
  length: number;
  warnings: string[];
}

export interface ArrangeOptions {
  /** `scenes` plays the saved scene chain; `current` plays the pattern chains the project was saved with. Default: scenes when any is saved. */
  source?: "scenes" | "current";
  /** Plays only this scene (1–16), with the pattern chains stored in it. Overrides `source`. */
  scene?: number;
  /** Plays only this pattern (1–8) on every track. Overrides `source`; not together with `scene`. */
  pattern?: number;
  /** How many times the whole sequence plays. Default 1. */
  repeats?: number;
  channels?: readonly number[];
  drumNotes?: readonly number[];
  /**
   * CC numbers for the 8 knob lanes of MIDI 1 and MIDI 2 (the MIDI template's knobs). Default: the
   * device's default template. null: leave automation out.
   */
  templateCcs?: readonly number[] | null;
  /** Attach the Circuit's CC to each automation change (default true; false for the Live target). */
  automationCcs?: boolean;
}

/** The knob lanes of a MIDI-track pattern as CC changes, from its first step; a value is sent only when it changes. */
export function patternCcs(p: N.NotePattern, ccs: readonly number[]): MidiCc[] {
  const step = stepTicks(p.settings), { first, last } = span(p.settings), out: MidiCc[] = [];
  ccs.slice(0, 8).forEach((cc, lane) => {
    const points = p.lanes[lane];
    if (!points) return;
    let prev = -1;
    for (let s = first; s <= last; s++) {
      for (let u = 0; u < 6; u++) {
        const v = points[s * 6 + u];
        if (v === undefined || v === 0xff || v > 127 || v === prev) continue;
        out.push({ tick: (s - first) * step + Math.round((u * step) / 6), cc: cc & 127, value: v });
        prev = v;
      }
    }
  });
  return out.sort((a, b) => a.tick - b.tick || a.cc - b.cc);
}

/** Every lane's changes in one pattern, from its first step: a point is kept only when its value changes. */
export function patternAutomation(p: N.NotePattern | N.DrumPattern): { tick: number; lane: number; value: number }[] {
  const step = stepTicks(p.settings), { first, last } = span(p.settings), out: { tick: number; lane: number; value: number }[] = [];
  p.lanes.forEach((points, lane) => {
    let prev = -1;
    for (let s = first; s <= last; s++) {
      for (let u = 0; u < 6; u++) {
        const v = points[s * 6 + u];
        if (v === undefined || v === 0xff || v > 127 || v === prev) continue;
        out.push({ tick: (s - first) * step + Math.round((u * step) / 6), lane, value: v });
        prev = v;
      }
    }
  });
  return out.sort((a, b) => a.tick - b.tick || a.lane - b.lane);
}

const MIX_TARGETS: readonly AutoTarget[] = ["level", "reverb", "delay", "pan"];
const DRUM_KNOBS: readonly AutoTarget[] = ["drumPitch", "drumDecay", "drumDistortion", "drumEq"];

/** What lane `lane` (0-based) of track `t` (0–7) drives, or null for MIDI 1/2's knob lanes (sent as `ccs`). */
export function laneTarget(t: number, lane: number): { target: AutoTarget; index?: number } | null {
  if (t >= 4) return lane < 4 ? { target: DRUM_KNOBS[lane]! } : MIX_TARGETS[lane - 4] ? { target: MIX_TARGETS[lane - 4]! } : null;
  if (lane < 8) return t < 2 ? { target: "macro", index: lane } : null;
  return MIX_TARGETS[lane - 8] ? { target: MIX_TARGETS[lane - 8]! } : null;
}

/** The Circuit's project channel (0-based: 16), where levels, pans and sends are received. */
export const PROJECT_CHANNEL = 15;
/** Drum knob CCs on the drum channel, for drums 1–4 (Programmer's Reference v3, "Drum Control"). */
const DRUM_CCS: Readonly<Record<string, readonly number[]>> = {
  level: [12, 23, 45, 53], pan: [77, 78, 79, 80],
  drumPitch: [14, 34, 46, 55], drumDecay: [15, 40, 47, 57], drumDistortion: [16, 42, 48, 61], drumEq: [17, 43, 49, 76],
};
/** Reverb and delay send CCs on the project channel: Synth 1, Synth 2, Drum 1–4 ("Project Control"). */
const REVERB_SEND_CCS = [88, 89, 90, 106, 109, 110] as const;
const DELAY_SEND_CCS = [111, 112, 113, 114, 115, 116] as const;

/** The CC that carries a lane change to a Circuit, or undefined where the reference documents none (MIDI 1/2 mix). */
export function deviceCc(t: number, target: AutoTarget, index: number | undefined, channels: readonly number[]): { channel: number; cc: number } | undefined {
  const send = t < 2 ? t : t >= 4 ? t - 2 : -1;
  if (target === "reverb") return send >= 0 ? { channel: PROJECT_CHANNEL, cc: REVERB_SEND_CCS[send]! } : undefined;
  if (target === "delay") return send >= 0 ? { channel: PROJECT_CHANNEL, cc: DELAY_SEND_CCS[send]! } : undefined;
  if (t < 2) {
    if (target === "macro") return { channel: channels[t] ?? t, cc: 80 + (index ?? 0) };
    if (target === "level") return { channel: PROJECT_CHANNEL, cc: t === 0 ? 12 : 14 };
    if (target === "pan") return { channel: PROJECT_CHANNEL, cc: 117 + t };
    return undefined;
  }
  if (t >= 4) {
    const cc = DRUM_CCS[target]?.[t - 4];
    return cc === undefined ? undefined : { channel: channels[t] ?? 9, cc };
  }
  return undefined;
}

function stepTicks(s: N.PatternSettings): number {
  return N.SYNC_RATE_TICKS[s.syncRate & 7] ?? N.SYNC_RATE_TICKS[3];
}

function span(s: N.PatternSettings): { first: number; last: number } {
  return { first: Math.min(s.firstStep, s.lastStep), last: Math.max(s.firstStep, s.lastStep) };
}

export function patternLength(s: N.PatternSettings): number {
  const { first, last } = span(s);
  return (last - first + 1) * stepTicks(s);
}

/**
 * The notes of one note-track pattern, from its first step, relative to tick 0. A stored note
 * number above 127 cannot be sent as MIDI and is left out (one factory project has a 128).
 */
export function notePatternNotes(p: N.NotePattern): MidiNote[] {
  const step = stepTicks(p.settings), { first, last } = span(p.settings), out: MidiNote[] = [];
  for (let s = first; s <= last; s++) {
    for (const u of p.steps[s]?.units ?? []) {
      if (!u.on || u.note > 127) continue;
      out.push({ tick: (s - first) * step + Math.round((u.micro * step) / 6), dur: Math.max(1, Math.round((u.gate * step) / 6)), pitch: u.note, velocity: Math.max(1, u.velocity & 127) });
    }
  }
  return out;
}

/** The hits of one drum pattern. A micro-step mask of 0 means the first micro-step only. */
export function drumPatternNotes(p: N.DrumPattern, pitch: number): MidiNote[] {
  const step = stepTicks(p.settings), { first, last } = span(p.settings), out: MidiNote[] = [];
  for (let s = first; s <= last; s++) {
    const st = p.steps[s];
    if (!st || st.velocity === 0) continue;
    const mask = st.microSteps & 63 || 1;
    for (let k = 0; k < 6; k++) {
      if ((mask >> k) & 1) {
        out.push({
          tick: (s - first) * step + Math.round((k * step) / 6), dur: Math.max(1, step >> 2), pitch, velocity: Math.max(1, st.velocity & 127),
          ...(st.sampleFlip < 64 ? { sample: st.sampleFlip } : {}),
        });
      }
    }
  }
  return out;
}

/** Shortens any note that would still sound when the same key starts again, so no two overlap. */
export function removeOverlaps(notes: readonly MidiNote[]): MidiNote[] {
  const sorted = [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  const lastByKey = new Map<number, MidiNote>();
  const out: MidiNote[] = [];
  for (const n of sorted) {
    const prev = lastByKey.get(n.pitch);
    if (prev && prev.tick === n.tick) {
      prev.velocity = Math.max(prev.velocity, n.velocity);
      prev.dur = Math.max(prev.dur, n.dur);
      continue;
    }
    if (prev && prev.tick + prev.dur > n.tick) prev.dur = n.tick - prev.tick;
    const copy = { ...n };
    lastByKey.set(n.pitch, copy);
    out.push(copy);
  }
  return out;
}

export function arrange(project: N.Project, opts: ArrangeOptions = {}): Arrangement {
  const header = N.readHeader(project);
  const scenes = N.readScenes(project);
  const chains = N.readChains(project);
  const channels = opts.channels ?? DEFAULT_CHANNELS;
  const drumNotes = opts.drumNotes ?? DEFAULT_DRUM_NOTES;
  const repeats = opts.repeats ?? 1;
  if (!Number.isInteger(repeats) || repeats < 1) throw new RangeError(`repeats must be a whole number of at least 1, got ${repeats}`);
  const warnings: string[] = [];

  const anySaved = scenes.some((s) => s.saved);
  if (opts.scene !== undefined && opts.pattern !== undefined) throw new RangeError("choose a scene or a pattern, not both");
  const source = opts.source ?? (anySaved ? "scenes" : "current");
  if (opts.scene === undefined && opts.pattern === undefined && source === "scenes" && !anySaved) throw new Error("the project has no saved scenes; use source: current");

  // Each pass: the pattern chain of every track.
  const passes: { scene: number | null; chains: N.Chain[] }[] = [];
  if (opts.scene !== undefined) {
    if (!Number.isInteger(opts.scene) || opts.scene < 1 || opts.scene > 16) throw new RangeError(`scene must be 1–16, got ${opts.scene}`);
    const sc = scenes[opts.scene - 1];
    if (!sc) throw new RangeError(`no scene ${opts.scene}`);
    if (!sc.saved) warnings.push(`scene ${opts.scene} is not saved; its stored chains are used`);
    passes.push({ scene: opts.scene - 1, chains: sc.chains });
  } else if (opts.pattern !== undefined) {
    if (!Number.isInteger(opts.pattern) || opts.pattern < 1 || opts.pattern > N.PATTERNS_PER_TRACK) throw new RangeError(`pattern must be 1–${N.PATTERNS_PER_TRACK}, got ${opts.pattern}`);
    passes.push({ scene: null, chains: TRACK_NAMES.map(() => ({ first: opts.pattern! - 1, last: opts.pattern! - 1 })) });
  } else if (source === "current") passes.push({ scene: null, chains: chains.tracks });
  else {
    const a = Math.min(chains.scenes.first, chains.scenes.last), z = Math.max(chains.scenes.first, chains.scenes.last);
    for (let e = a; e <= z; e++) {
      const sc = scenes[e];
      if (!sc) continue;
      if (!sc.saved) warnings.push(`scene ${e + 1} is in the scene chain but not saved; its stored chains are used`);
      passes.push({ scene: e, chains: sc.chains });
    }
  }

  const patterns = TRACK_NAMES.map((_, t) =>
    Array.from({ length: N.PATTERNS_PER_TRACK }, (_, i) => (t < 4 ? N.readNotePattern(project, t, i) : N.readDrumPattern(project, t - 4, i))),
  );
  const patternNotes = patterns.map((list, t) =>
    list.map((p) => (t < 4 ? notePatternNotes(p as N.NotePattern) : drumPatternNotes(p as N.DrumPattern, drumNotes[t - 4] ?? 60))),
  );

  const outOfRange: string[] = [];
  patterns.slice(0, 4).forEach((list, t) => list.forEach((p, i) => {
    const n = (p as N.NotePattern).steps.reduce((k, st) => k + st.units.filter((u) => u.on && u.note > 127).length, 0);
    if (n) outOfRange.push(`${TRACK_NAMES[t]} pattern ${i + 1} (${n})`);
  }));
  if (outOfRange.length) warnings.push(`left out notes stored above 127: ${outOfRange.join(", ")}`);

  const templateCcs = opts.templateCcs === undefined ? N.DEFAULT_TEMPLATE_CCS : opts.templateCcs;
  const patternCc = patterns.map((list, t) => list.map((p) => (t === 2 || t === 3) && templateCcs ? patternCcs(p as N.NotePattern, templateCcs) : []));
  if (templateCcs && patternCc.some((l) => l.some((c) => c.length))) warnings.push("MIDI 1/2 automation is sent as CC assuming the default MIDI template's knob CCs");
  const withCcs = opts.automationCcs ?? true;
  const patternAuto: AutoEvent[][][] = patterns.map((list, t) => list.map((p) => patternAutomation(p).flatMap((e) => {
    const what = laneTarget(t, e.lane);
    if (!what) return [];
    const cc = withCcs ? deviceCc(t, what.target, what.index, channels) : undefined;
    return [{ tick: e.tick, ...what, value: e.value, ...(cc ? { cc } : {}) }];
  })));
  if (patternAuto.some((list) => list.some((a) => a.some((e) => e.cc?.channel === PROJECT_CHANNEL))))
    warnings.push("level, pan and send lanes go to the Circuit's project channel 16: MIDI files keep them, Live sets leave them out");
  if (patternAuto.slice(2, 4).some((list) => list.some((a) => a.length)))
    warnings.push("MIDI 1/2 level, pan and send lanes have no CC on the Circuit: they play only in the app's preview");

  const directions = new Set<string>();
  const tracks: ArrangedTrack[] = TRACK_NAMES.map((name, t) => ({
    name,
    channel: channels[t] ?? 0,
    patterns: patterns[t]!.map((p, i) => ({ length: patternLength(p.settings), notes: removeOverlaps(patternNotes[t]![i]!), ccs: patternCc[t]![i]!, auto: patternAuto[t]![i]! })),
    plays: [],
    notes: [],
    ccs: [],
    auto: [],
  }));
  const arrangedScenes: ArrangedScene[] = [];
  let tick = 0;
  for (let r = 0; r < repeats; r++) {
    for (const pass of passes) {
      const order = pass.chains.map((c) => {
        const ids: number[] = [];
        const a = Math.min(c.first, c.last) & 7, z = Math.max(c.first, c.last) & 7;
        for (let i = a; i <= z; i++) ids.push(i);
        return ids;
      });
      const lengthOf = (t: number, i: number): number => patternLength(patterns[t]![i]!.settings);
      const sceneLength = Math.max(...order.map((ids, t) => ids.reduce((sum, i) => sum + lengthOf(t, i), 0)));
      order.forEach((ids, t) => {
        let at = 0, k = 0;
        while (at < sceneLength && ids.length) {
          const i = ids[k % ids.length]!;
          const len = Math.min(lengthOf(t, i), sceneLength - at);
          const dir = patterns[t]![i]!.settings.direction;
          if (dir !== 0) directions.add(`${TRACK_NAMES[t]} pattern ${i + 1}`);
          const st = patterns[t]![i]!.settings;
          tracks[t]!.plays.push({ pattern: i, tick: tick + at, length: len, stepTicks: stepTicks(st), firstStep: span(st).first + 1 });
          for (const n of patternNotes[t]![i]!) if (n.tick < len) tracks[t]!.notes.push({ ...n, tick: tick + at + n.tick });
          for (const c of patternCc[t]![i]!) if (c.tick < len) tracks[t]!.ccs.push({ ...c, tick: tick + at + c.tick });
          for (const e of patternAuto[t]![i]!) if (e.tick < len) tracks[t]!.auto.push({ ...e, tick: tick + at + e.tick });
          at += len; k++;
        }
      });
      arrangedScenes.push({ scene: pass.scene, tick, length: sceneLength });
      tick += sceneLength;
    }
  }

  for (const t of tracks) t.notes = removeOverlaps(t.notes).map((n) => ({ ...n, dur: Math.min(n.dur, tick - n.tick) })).filter((n) => n.dur > 0);
  if (directions.size) warnings.push(`played forward, though set to another direction: ${[...directions].join(", ")}`);
  if (header.swing !== 50) warnings.push(`swing ${header.swing} is not applied`);
  warnings.push("probability is not applied: every note plays");

  return { name: header.name, bpm: header.tempo, ppq: PPQ, scenes: arrangedScenes, repeats, tracks, length: tick, warnings };
}
