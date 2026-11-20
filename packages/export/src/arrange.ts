// Lays a project out in time: which pattern each track plays, and when, with its notes as MIDI.
// Note and drum timing follow circuit-hacks-rc/tools/sd_app.html patMidi (:883).
//
// Assumptions not confirmed on a device (each is reported in `warnings` when it matters):
// - Inside a scene, the tracks are in the order Synth 1, Synth 2, MIDI 1, MIDI 2, Drum 1–4.
//   Card evidence only: over 152 projects, each chain slot points at used patterns of that track
//   most often (docs/card-survey.md).
// - A scene lasts as long as its longest track chain; shorter chains loop inside it.
// - Directions, probability and swing follow steps.ts (evidence and assumptions there). Files
//   (MIDI, Live) get swing, reverse and ping-pong; every note plays and random-direction patterns
//   are written forward. Playback rolls probability and random steps on each pass (`realise`).
import * as N from "@circuit-desk/ncs";
import { placeSteps, removeOverlaps, stepOrder, swingNote, swingStepTicks, swingTick, type RandomPlay, type StepContent } from "./steps.ts";

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
  /** The step's probability, 0–6 (plays with (p + 1) / 8); absent = always. */
  prob?: number;
  /** With `prob`: the unswung tick where the note's step starts, which its roll is shared by. */
  step?: number;
  /** A forward stand-in for a random-direction play: written to files, replaced at playback. */
  rnd?: true;
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
  /** A forward stand-in for a random-direction play (see MidiNote). */
  rnd?: true;
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
  /** A forward stand-in for a random-direction play (see MidiNote). */
  rnd?: true;
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
  /** Random-direction plays, with the steps of each pattern they use, for playback to roll. */
  random?: { plays: RandomPlay[]; steps: Record<number, StepContent[]> };
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
  /** Swing percent (50 = straight) and the ticks of the steps it pairs, as applied to the ticks here. */
  swing: number;
  swingTicks: number;
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
  /** Apply the project's swing to the timeline (default true). */
  swing?: boolean;
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

/** Where a lane point goes: a MIDI CC (MIDI 1/2 knob lanes) or an automation change, or nowhere. */
type LaneSink = (lane: number, value: number) => { cc: number } | Omit<AutoEvent, "tick" | "value"> | null;

/**
 * A pattern step by step, from its first step: notes with their step's probability, and every
 * stored lane point (not yet thinned to changes; placeSteps does that in play order).
 */
export function patternSteps(p: N.NotePattern | N.DrumPattern, drumPitch: number | null, sink: LaneSink): StepContent[] {
  const step = stepTicks(p.settings), { first, last } = span(p.settings), out: StepContent[] = [];
  for (let s = first; s <= last; s++) {
    const c: StepContent = { notes: [], ccs: [], auto: [] };
    if (drumPitch === null) {
      const st = (p as N.NotePattern).steps[s];
      const prob = (st?.probability ?? 7) & 7;
      for (const u of st?.units ?? []) {
        if (!u.on || u.note > 127) continue;
        c.notes.push({
          tick: Math.round((u.micro * step) / 6), dur: Math.max(1, Math.round((u.gate * step) / 6)), pitch: u.note, velocity: Math.max(1, u.velocity & 127),
          ...(prob < 7 ? { prob } : {}),
        });
      }
    } else {
      const st = (p as N.DrumPattern).steps[s];
      if (st && st.velocity !== 0) {
        const mask = st.microSteps & 63 || 1, prob = st.probability & 7;
        for (let k = 0; k < 6; k++) {
          if (!((mask >> k) & 1)) continue;
          c.notes.push({
            tick: Math.round((k * step) / 6), dur: Math.max(1, step >> 2), pitch: drumPitch, velocity: Math.max(1, st.velocity & 127),
            ...(st.sampleFlip < 64 ? { sample: st.sampleFlip } : {}), ...(prob < 7 ? { prob } : {}),
          });
        }
      }
    }
    for (let u = 0; u < 6; u++) {
      p.lanes.forEach((points, lane) => {
        const v = points[s * 6 + u];
        if (v === undefined || v === 0xff || v > 127) return;
        const to = sink(lane, v);
        if (!to) return;
        const tick = Math.round((u * step) / 6);
        if ("target" in to) c.auto.push({ ...to, tick, value: v, lane });
        else c.ccs.push({ tick, cc: to.cc, value: v });
      });
    }
    out.push(c);
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

  const swing = opts.swing === false ? 50 : header.swing;
  const swingTicks = swingStepTicks(project.bytes[N.SWING_SYNC_AT] ?? 3);
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

  const steps: StepContent[][][] = patterns.map((list, t) => list.map((p) => patternSteps(p, t < 4 ? null : drumNotes[t - 4] ?? 60, (lane) => {
    if ((t === 2 || t === 3) && lane < 8) return templateCcs && templateCcs[lane] !== undefined ? { cc: templateCcs[lane]! & 127 } : null;
    const what = laneTarget(t, lane);
    if (!what) return null;
    const cc = withCcs ? deviceCc(t, what.target, what.index, channels) : undefined;
    return { ...what, ...(cc ? { cc } : {}) };
  })));
  const randoms = new Set<string>(), pingPongs = new Set<string>();
  let anyProb = false;
  const laps = TRACK_NAMES.map(() => 0);
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
          const st = patterns[t]![i]!.settings, sTicks = stepTicks(st), here = tick + at, tr = tracks[t]!;
          const content = steps[t]![i]!;
          tr.plays.push({ pattern: i, tick: here, length: len, stepTicks: sTicks, firstStep: span(st).first + 1 });
          const order = stepOrder(st.direction, content.length, laps[t]!);
          if (st.direction === 2) { laps[t]!++; pingPongs.add(`${TRACK_NAMES[t]} pattern ${i + 1}`); }
          const rnd = order === null;
          if (rnd) {
            randoms.add(`${TRACK_NAMES[t]} pattern ${i + 1}`);
            tr.random ??= { plays: [], steps: {} };
            tr.random.plays.push({ pattern: i, tick: here, length: len, stepTicks: sTicks });
            tr.random.steps[i] ??= content;
          }
          const placed = placeSteps(content, order ?? content.map((_, k) => k), sTicks, len);
          const flag = rnd ? { rnd: true as const } : {};
          for (const n of placed.notes) {
            if (n.prob !== undefined) anyProb = true;
            const step = here + Math.floor(n.tick / sTicks) * sTicks;
            tr.notes.push({ ...n, tick: here + n.tick, ...(n.prob !== undefined ? { step } : {}), ...flag });
          }
          for (const c of placed.ccs) tr.ccs.push({ ...c, tick: here + c.tick, ...flag });
          for (const e of placed.auto) tr.auto.push({ ...e, tick: here + e.tick, ...flag });
          at += len; k++;
        }
      });
      arrangedScenes.push({ scene: pass.scene, tick, length: sceneLength });
      tick += sceneLength;
    }
  }

  for (const t of tracks) {
    if (swing !== 50) {
      t.notes = t.notes.map((n) => swingNote(n, swing, swingTicks, tick));
      t.ccs = t.ccs.map((c) => ({ ...c, tick: swingTick(c.tick, swing, swingTicks, tick) }));
      t.auto = t.auto.map((e) => ({ ...e, tick: swingTick(e.tick, swing, swingTicks, tick) }));
    }
    t.notes = removeOverlaps(t.notes).map((n) => ({ ...n, dur: Math.min(n.dur, tick - n.tick) })).filter((n) => n.dur > 0);
  }
  if (swing !== 50) warnings.push(`swing ${swing} % is applied to pairs of steps; the device's exact swing curve is not measured`);
  if (pingPongs.size) warnings.push(`ping-pong alternates direction on each play, repeating the end steps (not confirmed on a device): ${[...pingPongs].join(", ")}`);
  if (randoms.size) warnings.push(`random direction: files have these patterns forward; playback picks the steps at random: ${[...randoms].join(", ")}`);
  if (anyProb) warnings.push("step probability: files have every note; playback rolls each step on each pass");

  return { name: header.name, bpm: header.tempo, ppq: PPQ, swing, swingTicks, scenes: arrangedScenes, repeats, tracks, length: tick, warnings };
}
