// The project service: open projects, read them, edit them with undo, and write copies and
// exports. The MCP server uses it directly; the desktop app will use it from Electron's main process.
// Numbers facing people and tools are 1-based (steps 1–32, patterns 1–8, scenes 1–16), as on the device.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import * as N from "@circuit-desk/ncs";
import * as X from "@circuit-desk/export";
import { checkWritable, defaultPaths, type DeskPaths } from "./paths.ts";

export const TRACKS = [...N.NOTE_TRACKS, ...N.DRUM_TRACKS] as const;
export type TrackName = (typeof TRACKS)[number];
export type NoteTrackName = (typeof N.NOTE_TRACKS)[number];
export type DrumTrackName = (typeof N.DRUM_TRACKS)[number];
/** Step length by sync-rate index, at 480 ticks a quarter note. */
export const SYNC_RATES = ["1/32T", "1/32", "1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4"] as const;
export type SyncRate = (typeof SYNC_RATES)[number];

const UNDO_LIMIT = 200;

export interface ProjectListing { path: string; pack: string; file: string; name: string; problem: N.NcsProblem | null }

export interface NoteOut { note: number; velocity: number; gate: number; micro: number }
export interface NoteStepOut { step: number; probability: number; notes: NoteOut[] }
export interface DrumStepOut { step: number; velocity: number; probability: number; sampleFlip: number | null; microSteps: number[] }
export interface PatternSettingsOut { firstStep: number; lastStep: number; syncRate: SyncRate; direction: number }

export interface NoteStepIn { step: number; notes: NoteOut[]; probability?: number }
export interface DrumStepIn { step: number; velocity: number; probability?: number; microSteps?: number[] }

interface Open {
  id: string;
  path: string;
  original: Uint8Array;
  project: N.Project;
  undo: N.Project[];
  redo: N.Project[];
  savedTo: string | null;
}

export class ServiceError extends Error {
  constructor(message: string) { super(message); this.name = "ServiceError"; }
}

function trackIndex(name: string): number {
  const i = (TRACKS as readonly string[]).indexOf(name);
  if (i < 0) throw new ServiceError(`no track "${name}"; tracks are ${TRACKS.join(", ")}`);
  return i;
}

function one(what: string, v: number, max: number): number {
  if (!Number.isInteger(v) || v < 1 || v > max) throw new ServiceError(`${what} must be 1–${max}, got ${v}`);
  return v - 1;
}

const settingsOut = (s: N.PatternSettings): PatternSettingsOut => ({
  firstStep: s.firstStep + 1, lastStep: s.lastStep + 1, syncRate: SYNC_RATES[s.syncRate & 7] ?? "1/16", direction: s.direction,
});
const maskToList = (m: number): number[] => [0, 1, 2, 3, 4, 5].filter((k) => (m >> k) & 1).map((k) => k + 1);

export class ProjectService {
  readonly paths: DeskPaths;
  private readonly open = new Map<string, Open>();
  private nextId = 1;
  private live: X.LiveTemplates | null = null;

  constructor(paths: DeskPaths = defaultPaths()) { this.paths = paths; }

  /** Every .ncs file under `folder` (default: the library), with its name or why it is not a project. */
  listProjects(folder = this.paths.library): ProjectListing[] {
    if (!existsSync(folder)) throw new ServiceError(`no folder ${folder}`);
    const out: ProjectListing[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d).sort()) {
        if (n.startsWith(".")) continue; // macOS writes ._ files on cards
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ncs$/i.test(n)) {
          const b = new Uint8Array(readFileSync(p));
          const problem = N.projectProblem(b);
          const parts = relative(folder, p).split(/[\\/]/);
          const pack = parts.length >= 3 && parts.at(-2) === "Sessions" ? parts.at(-3)! : dirname(relative(folder, p));
          out.push({ path: p, pack, file: n, name: problem ? "" : N.readHeader(N.openProject(b)).name, problem });
        }
      }
    };
    walk(folder);
    return out;
  }

  openProject(path: string): { id: string; path: string } {
    const abs = resolve(path);
    for (const o of this.open.values()) if (o.path === abs) return { id: o.id, path: abs };
    let project: N.Project;
    try { project = N.openProject(new Uint8Array(readFileSync(abs))); } catch (e) { throw new ServiceError((e as Error).message); }
    const id = `p${this.nextId++}`;
    this.open.set(id, { id, path: abs, original: project.bytes.slice(), project, undo: [], redo: [], savedTo: null });
    return { id, path: abs };
  }

  closeProject(id: string): void { this.get(id); this.open.delete(id); }

  openProjects(): { id: string; path: string; name: string; edits: number }[] {
    return [...this.open.values()].map((o) => ({ id: o.id, path: o.path, name: N.readHeader(o.project).name, edits: o.undo.length }));
  }

  private get(id: string): Open {
    const o = this.open.get(id);
    if (!o) throw new ServiceError(`no open project "${id}"; open one with open_project`);
    return o;
  }

  /** The current bytes of an open project (a copy). */
  bytes(id: string): Uint8Array { return this.get(id).project.bytes.slice(); }

  private apply(o: Open, next: N.Project): void {
    o.undo.push(o.project);
    if (o.undo.length > UNDO_LIMIT) o.undo.shift();
    o.redo = [];
    o.project = next;
  }

  private edit(id: string, f: (p: N.Project) => N.Project): N.ChangedRange[] {
    const o = this.get(id);
    let next: N.Project;
    try { next = f(o.project); } catch (e) { throw e instanceof RangeError ? new ServiceError(e.message) : e; }
    const changed = N.changedRanges(o.project.bytes, next.bytes);
    if (changed.length) this.apply(o, next);
    return changed;
  }

  undo(id: string): boolean {
    const o = this.get(id), prev = o.undo.pop();
    if (!prev) return false;
    o.redo.push(o.project); o.project = prev; return true;
  }

  redo(id: string): boolean {
    const o = this.get(id), next = o.redo.pop();
    if (!next) return false;
    o.undo.push(o.project); o.project = next; return true;
  }

  summary(id: string) {
    const o = this.get(id), p = o.project;
    const header = N.readHeader(p);
    const tracks = TRACKS.map((name, t) => {
      const used: number[] = [];
      for (let i = 0; i < N.PATTERNS_PER_TRACK; i++) {
        const has = t < 4 ? N.readNotePattern(p, t, i).steps.some((s) => s.units.some((u) => u.on)) : N.readDrumPattern(p, t - 4, i).steps.some((s) => s.velocity > 0);
        if (has) used.push(i + 1);
      }
      return { track: name, patternsWithNotes: used };
    });
    const trailer = N.readTrailer(p);
    return {
      id, path: o.path, name: header.name,
      tempo: { value: header.tempo, status: "partial: reads as BPM, not confirmed on a device" },
      swing: { value: header.swing, status: "partial: reads as percent, 50 = none" },
      tracks,
      savedScenes: N.readScenes(p).flatMap((s, e) => (s.saved ? [e + 1] : [])),
      circuitHacksData: { bytesAfterStockPart: trailer.length, extraLanes: trailer.extraLanes, sceneRules: trailer.sceneRules },
      edits: o.undo.length, canRedo: o.redo.length > 0,
    };
  }

  getPattern(id: string, track: TrackName, pattern: number) {
    const p = this.get(id).project, t = trackIndex(track), i = one("pattern", pattern, 8);
    if (t < 4) {
      const m = N.readNotePattern(p, t, i);
      const steps: NoteStepOut[] = m.steps.flatMap((s, k) => {
        const notes = s.units.filter((u) => u.on).map((u) => ({ note: u.note, velocity: u.velocity, gate: u.gate, micro: u.micro }));
        return notes.length ? [{ step: k + 1, probability: s.probability, notes }] : [];
      });
      return { track, pattern, kind: "notes" as const, settings: settingsOut(m.settings), steps, units: "gate and micro in sixths of a step; probability 0–7, 7 = always" };
    }
    const m = N.readDrumPattern(p, t - 4, i);
    const steps: DrumStepOut[] = m.steps.flatMap((s, k) => s.velocity === 0 ? [] : [{
      step: k + 1, velocity: s.velocity & 127, probability: s.probability & 7, sampleFlip: s.sampleFlip === 0xff ? null : s.sampleFlip, microSteps: maskToList(s.microSteps & 63 || 1),
    }]);
    return { track, pattern, kind: "drums" as const, settings: settingsOut(m.settings), steps, units: "microSteps: which of the step's 6 sixths sound; probability 0–7, 7 = always" };
  }

  /** Replaces the notes of each listed step; other steps are untouched. */
  setSteps(id: string, track: NoteTrackName, pattern: number, steps: readonly NoteStepIn[]): N.ChangedRange[] {
    const t = trackIndex(track), i = one("pattern", pattern, 8);
    if (t >= 4) throw new ServiceError(`${track} is a drum track: use set_drum_steps`);
    return this.edit(id, (p) => {
      const m = N.readNotePattern(p, t, i);
      for (const s of steps) {
        const st = m.steps[one("step", s.step, 32)]!;
        if (s.notes.length > N.UNITS) throw new ServiceError(`step ${s.step}: a step holds at most ${N.UNITS} notes, got ${s.notes.length}`);
        st.units = st.units.map((u, k) => {
          const n = s.notes[k];
          return n ? { on: true, note: n.note, velocity: n.velocity, gate: n.gate, micro: n.micro, tie: false } : { ...u, on: false };
        });
        if (s.probability !== undefined) st.probability = s.probability;
      }
      return N.writeNotePattern(p, t, i, m);
    });
  }

  setDrumSteps(id: string, track: DrumTrackName, pattern: number, steps: readonly DrumStepIn[]): N.ChangedRange[] {
    const t = trackIndex(track), i = one("pattern", pattern, 8);
    if (t < 4) throw new ServiceError(`${track} is a note track: use set_steps`);
    return this.edit(id, (p) => {
      const m = N.readDrumPattern(p, t - 4, i);
      for (const s of steps) {
        const st = m.steps[one("step", s.step, 32)]!;
        st.velocity = s.velocity;
        if (s.probability !== undefined) st.probability = (st.probability & ~7) | s.probability;
        if (s.microSteps !== undefined) {
          const mask = s.microSteps.reduce((a, k) => a | (1 << one("micro-step", k, 6)), 0);
          st.microSteps = mask === 1 ? 0 : mask;
        }
      }
      return N.writeDrumPattern(p, t - 4, i, m);
    });
  }

  setPatternSettings(id: string, track: TrackName, pattern: number, s: { firstStep?: number; lastStep?: number; syncRate?: SyncRate }): N.ChangedRange[] {
    const t = trackIndex(track), i = one("pattern", pattern, 8);
    return this.edit(id, (p) => {
      const m = t < 4 ? N.readNotePattern(p, t, i) : N.readDrumPattern(p, t - 4, i);
      if (s.firstStep !== undefined) m.settings.firstStep = one("first step", s.firstStep, 32);
      if (s.lastStep !== undefined) m.settings.lastStep = one("last step", s.lastStep, 32);
      if (s.syncRate !== undefined) m.settings.syncRate = SYNC_RATES.indexOf(s.syncRate);
      if (m.settings.firstStep > m.settings.lastStep) throw new ServiceError(`first step ${m.settings.firstStep + 1} is after last step ${m.settings.lastStep + 1}`);
      return t < 4 ? N.writeNotePattern(p, t, i, m as N.NotePattern) : N.writeDrumPattern(p, t - 4, i, m as N.DrumPattern);
    });
  }

  getScenes(id: string) {
    const p = this.get(id).project, c = N.readChains(p);
    const named = (chains: readonly N.Chain[]) => Object.fromEntries(chains.map((ch, t) => [TRACKS[t]!, { first: ch.first + 1, last: ch.last + 1 }]));
    return {
      note: "the order of tracks inside a scene is assumed (Synth 1, Synth 2, MIDI 1, MIDI 2, Drum 1–4), not confirmed on a device",
      sceneChain: { first: c.scenes.first + 1, last: c.scenes.last + 1 },
      currentChains: named(c.tracks),
      scenes: N.readScenes(p).map((s, e) => ({ scene: e + 1, saved: s.saved, chains: named(s.chains) })),
    };
  }

  setChain(id: string, target: "scenes" | TrackName, first: number, last: number): N.ChangedRange[] {
    const entry = target === "scenes" ? 0 : trackIndex(target) + 1, max = target === "scenes" ? 16 : 8;
    return this.edit(id, (p) => N.writeChain(p, entry, { first: one("first", first, max), last: one("last", last, max) }));
  }

  /** Sets the chains of the named tracks in a scene (others keep theirs) and marks it saved. */
  setScene(id: string, scene: number, chains: Partial<Record<TrackName, { first: number; last: number }>>): N.ChangedRange[] {
    const e = one("scene", scene, 16);
    return this.edit(id, (p) => {
      const cur = N.readScenes(p)[e]!.chains.map((c) => ({ ...c }));
      for (const [name, c] of Object.entries(chains)) {
        if (!c) continue;
        cur[trackIndex(name)] = { first: one(`${name} first`, c.first, 8), last: one(`${name} last`, c.last, 8) };
      }
      return N.writeScene(p, e, cur);
    });
  }

  diffVsOriginal(id: string): N.ChangedRange[] {
    const o = this.get(id);
    return N.changedRanges(o.original, o.project.bytes);
  }

  validate(id: string) {
    const p = this.get(id).project, problems: string[] = [];
    const t = N.readTrailer(p);
    if (t.extraLanes && !t.extraLanes.sumMatches) problems.push("CIRCUIT-HACKS extra lanes: the stored sum does not match MIDI 1/2's patterns, so the device drops those lanes");
    const changed = this.diffVsOriginal(id).filter((r) => r.status !== "verified");
    for (const r of changed) problems.push(`changed a field that is not verified: ${r.field} at 0x${r.offset.toString(16)}`);
    const warnings = X.arrange(p).warnings;
    return { ok: problems.length === 0, problems, exportNotes: warnings };
  }

  /** Writes the project to a new file in the copies folder. Never overwrites. */
  saveCopy(id: string, fileName?: string): string {
    const o = this.get(id);
    const stem = (fileName ?? basename(o.path)).replace(/\.ncs$/i, "").replace(/[^\w .()+-]/g, "_");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const out = join(this.paths.copies, `${stem} ${stamp}.ncs`);
    checkWritable(out, [this.paths.copies]);
    if (existsSync(out)) throw new ServiceError(`${out} already exists`);
    mkdirSync(this.paths.copies, { recursive: true });
    writeFileSync(out, o.project.bytes, { flag: "wx" });
    o.savedTo = out;
    return out;
  }

  private exportDir(o: Open): string {
    const dir = join(this.paths.exports, basename(o.path).replace(/\.ncs$/i, ""));
    checkWritable(join(dir, "x"), [this.paths.exports]);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private arrange(o: Open, opts: { source?: "scenes" | "current"; repeats?: number }): X.Arrangement {
    try { return X.arrange(o.project, opts); } catch (e) { throw new ServiceError((e as Error).message); }
  }

  /** The project laid out in time, for playback (same as the exports use). */
  arrangement(id: string, opts: { source?: "scenes" | "current"; repeats?: number } = {}): X.Arrangement {
    return this.arrange(this.get(id), opts);
  }

  exportMidi(id: string, opts: { source?: "scenes" | "current"; repeats?: number } = {}): { path: string; notes: string[] } {
    const o = this.get(id), a = this.arrange(o, opts);
    const path = join(this.exportDir(o), `${basename(o.path).replace(/\.ncs$/i, "")}.mid`);
    writeFileSync(path, X.writeSmf(a));
    return { path, notes: a.warnings };
  }

  exportAls(id: string, opts: { source?: "scenes" | "current"; repeats?: number; arrangement?: boolean; instruments?: "live" | "none"; liveApp?: string } = {}): { path: string; notes: string[] } {
    const o = this.get(id), a = this.arrange(o, opts);
    this.live ??= X.loadLiveTemplates(opts.liveApp);
    const path = join(this.exportDir(o), `${basename(o.path).replace(/\.ncs$/i, "")}.als`);
    let bytes: Uint8Array;
    try { bytes = X.writeAls(a, this.live, { arrangement: opts.arrangement ?? true, instruments: opts.instruments ?? "live" }); } catch (e) { throw new ServiceError((e as Error).message); }
    writeFileSync(path, bytes);
    return { path, notes: a.warnings };
  }

  fields(id: string, field?: string) {
    const p = this.get(id).project;
    const list = field ? N.SESSION_FIELDS.filter((f) => f.id === field) : N.SESSION_FIELDS;
    if (field && !list.length) throw new ServiceError(`no field "${field}"; fields are ${N.SESSION_FIELDS.map((f) => f.id).join(", ")}`);
    return list.map((f) => ({
      ...f,
      ...(f.size <= 64 ? { hex: Array.from(p.bytes.slice(f.offset, f.offset + f.size), (b) => b.toString(16).padStart(2, "0")).join(" ") } : {}),
    }));
  }
}
