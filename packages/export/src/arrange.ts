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

export interface PatternClip {
  /** Length in ticks, from the pattern's first step to its last. */
  length: number;
  /** From tick 0 of the pattern. */
  notes: MidiNote[];
  /** Automation sent as CC (MIDI tracks' knob lanes), from tick 0 of the pattern. */
  ccs: MidiCc[];
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
  const lanesNotSent = patterns.slice(0, 2).some((list) => list.some((p) => p.lanes.some((l) => l.some((v) => v !== 0xff))))
    || patterns.slice(4).some((list) => list.some((p) => p.lanes.some((l) => l.some((v) => v !== 0xff))));
  if (lanesNotSent) warnings.push("Synth and drum automation is not exported (it drives the Circuit's own sound)");

  const directions = new Set<string>();
  const tracks: ArrangedTrack[] = TRACK_NAMES.map((name, t) => ({
    name,
    channel: channels[t] ?? 0,
    patterns: patterns[t]!.map((p, i) => ({ length: patternLength(p.settings), notes: removeOverlaps(patternNotes[t]![i]!), ccs: patternCc[t]![i]! })),
    plays: [],
    notes: [],
    ccs: [],
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
