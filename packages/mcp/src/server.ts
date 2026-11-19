// The Circuit Desk MCP server: the project service as tools. Headless for now (P3): it works on
// files directly. When the desktop app exists it will forward to the running app instead.
// Numbers are 1-based as on the device: steps 1–32, patterns 1–8, scenes 1–16.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ProjectService, ServiceError, SocketClient, SYNC_RATES, TRACKS, UnsafeWriteError, type ServiceMethod } from "@circuit-desk/core-service";
import { DRUM_TRACKS, NOTE_TRACKS } from "@circuit-desk/ncs";

export const VERSION = "0.1.0";

const project = z.string().describe('Id from open_project, e.g. "p1"');
const track = z.enum(TRACKS);
const noteTrack = z.enum(NOTE_TRACKS);
const drumTrack = z.enum(DRUM_TRACKS);
const pattern = z.number().int().min(1).max(8).describe("Pattern 1–8");
const step = z.number().int().min(1).max(32).describe("Step 1–32");
const probability = z.number().int().min(0).max(7).describe("0–7; 7 = always plays");
const source = z.enum(["scenes", "current"]).optional().describe("scenes: the saved scene chain (default when any scene is saved); current: the pattern chains the project was saved with");
const repeats = z.number().int().min(1).max(64).optional().describe("How many times the sequence plays; default 1");
const note = z.object({
  note: z.number().int().min(0).max(127).describe("MIDI note number, 60 = C4"),
  velocity: z.number().int().min(1).max(127),
  gate: z.number().int().min(1).max(96).describe("Length in sixths of a step: 6 = one step, 96 = 16 steps"),
  micro: z.number().int().min(0).max(5).default(0).describe("Start offset in sixths of a step"),
});
const chain = z.object({ first: pattern, last: pattern });

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Tool failures the caller can fix come back as tool errors; anything else is a bug and is thrown. */
async function run(f: () => unknown): Promise<CallToolResult> {
  try { return ok(await f()); } catch (e) {
    if (e instanceof ServiceError || e instanceof UnsafeWriteError) return { isError: true, content: [{ type: "text", text: e.message }] };
    throw e;
  }
}

const changes = (r: { offset: number; length: number; field: string }[]) => ({
  changed: r.length ? r.map((c) => `${c.field} (${c.length} B at 0x${c.offset.toString(16)})`) : "nothing: the project already had these values",
});

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

type Async<T> = { [K in ServiceMethod]: T[K & keyof T] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

/**
 * Calls go to the running app when its socket answers (so edits show there at once), otherwise to
 * the files directly. Project ids belong to whichever side opened the project.
 */
export function backend(local: ProjectService, socket: string | null) {
  let client: SocketClient | null = null;
  const remote = async (): Promise<SocketClient | null> => {
    if (!socket) return null;
    if (client?.isOpen) return client;
    client = await SocketClient.connect(socket);
    return client;
  };
  const svc = new Proxy({} as Async<ProjectService>, {
    get: (_t, method: string) => async (...args: unknown[]) => {
      const c = await remote();
      if (c) return c.call(method as ServiceMethod, args);
      return (local[method as ServiceMethod] as (...a: unknown[]) => unknown).apply(local, args);
    },
  });
  return { svc, via: async (): Promise<"app" | "files"> => ((await remote()) ? "app" : "files"), close: () => client?.close() };
}

export function createServer(service = new ProjectService(), opts: { socket?: string | null } = {}): McpServer {
  const { svc, via } = backend(service, opts.socket === undefined ? service.paths.socket : opts.socket);
  const server = new McpServer({ name: "circuit-desk", version: VERSION }, {
    instructions: [
      "Reads, edits and exports Novation Circuit Tracks projects (.ncs).",
      "Open a project first; edits stay in memory (with undo) until save_copy, which writes a new file to the copies folder. Nothing here writes to the SD card or to the original file.",
      "When the Circuit Desk app is running, tools work on the projects open in it and edits show there at once; otherwise they work on the files (see the connection tool).",
      "Numbers are 1-based as on the device. Only fields confirmed on a device can be edited; tempo, swing, mixer, FX and synth patches are read-only for now.",
    ].join(" "),
  });

  server.registerTool("connection", {
    title: "Connection",
    description: "Whether tools are working through the running Circuit Desk app (edits show in its window) or directly on the files.",
    inputSchema: {}, annotations: READ,
  }, () => run(async () => ({ via: await via(), socket: service.paths.socket })));

  server.registerTool("list_projects", {
    title: "List projects",
    description: `Lists the .ncs projects in a folder (default: the library, ${service.paths.library}), with their pack and stored name.`,
    inputSchema: { folder: z.string().optional().describe("Folder to search, recursively") },
    annotations: READ,
  }, ({ folder }) => run(() => svc.listProjects(folder)));

  server.registerTool("open_project", {
    title: "Open project",
    description: "Opens a project file and returns its id and summary: tracks with notes, saved scenes, CIRCUIT-HACKS data. Opening the same file again returns the same id.",
    inputSchema: { path: z.string().describe("Path to an .ncs file") },
    annotations: READ,
  }, ({ path }) => run(async () => svc.summary((await svc.openProject(path)).id)));

  server.registerTool("list_open_projects", {
    title: "List open projects", description: "The projects open in this session, with their number of edits.", inputSchema: {}, annotations: READ,
  }, () => run(() => svc.openProjects()));

  server.registerTool("close_project", {
    title: "Close project", description: "Closes a project. Unsaved edits are lost.", inputSchema: { project }, annotations: WRITE,
  }, ({ project: id }) => run(async () => { await svc.closeProject(id); return { closed: id }; }));

  server.registerTool("get_project", {
    title: "Project summary", description: "Summary of an open project, including how many edits it has.", inputSchema: { project }, annotations: READ,
  }, ({ project: id }) => run(() => svc.summary(id)));

  server.registerTool("get_pattern", {
    title: "Get pattern",
    description: "The steps of one pattern that hold notes or hits, with the pattern's first/last step and sync rate. Note tracks: up to 6 notes per step. Drum tracks: velocity, probability, micro-steps.",
    inputSchema: { project, track, pattern },
    annotations: READ,
  }, ({ project: id, track: t, pattern: p }) => run(() => svc.getPattern(id, t, p)));

  server.registerTool("set_steps", {
    title: "Set note steps",
    description: "Replaces the notes of the listed steps of a Synth or MIDI pattern; steps not listed are untouched. An empty notes list clears the step. Returns the byte ranges that changed.",
    inputSchema: {
      project, track: noteTrack, pattern,
      steps: z.array(z.object({ step, notes: z.array(note).max(6).describe("At most 6 notes per step"), probability: probability.optional() })).min(1),
    },
    annotations: EDIT,
  }, ({ project: id, track: t, pattern: p, steps }) => run(async () => changes(await svc.setSteps(id, t, p, steps))));

  server.registerTool("set_drum_steps", {
    title: "Set drum steps",
    description: "Sets the listed steps of a drum pattern; steps not listed are untouched. velocity 0 removes the hit.",
    inputSchema: {
      project, track: drumTrack, pattern,
      steps: z.array(z.object({
        step,
        velocity: z.number().int().min(0).max(127).describe("0 = no hit"),
        probability: probability.optional(),
        microSteps: z.array(z.number().int().min(1).max(6)).min(1).max(6).optional().describe("Which sixths of the step sound, e.g. [1, 4] for a flam; default [1]"),
      })).min(1),
    },
    annotations: EDIT,
  }, ({ project: id, track: t, pattern: p, steps }) => run(async () => changes(await svc.setDrumSteps(id, t, p, steps))));

  server.registerTool("set_pattern_settings", {
    title: "Set pattern length and rate",
    description: "Sets a pattern's first and last step (its length) and its sync rate (the length of one step).",
    inputSchema: { project, track, pattern, firstStep: step.optional(), lastStep: step.optional(), syncRate: z.enum(SYNC_RATES).optional().describe("1/16 is the default; T = triplet") },
    annotations: EDIT,
  }, ({ project: id, track: t, pattern: p, ...s }) => run(async () => changes(await svc.setPatternSettings(id, t, p, {
    ...(s.firstStep !== undefined ? { firstStep: s.firstStep } : {}), ...(s.lastStep !== undefined ? { lastStep: s.lastStep } : {}), ...(s.syncRate !== undefined ? { syncRate: s.syncRate } : {}),
  }))));

  server.registerTool("get_scenes", {
    title: "Get scenes and chains", description: "The scene chain, the current pattern chain of each track, and the 16 scenes with their chains.", inputSchema: { project }, annotations: READ,
  }, ({ project: id }) => run(() => svc.getScenes(id)));

  server.registerTool("set_chain", {
    title: "Set chain",
    description: 'Sets the scene chain (target "scenes", scenes 1–16) or a track\'s current pattern chain (patterns 1–8).',
    inputSchema: { project, target: z.union([z.literal("scenes"), track]), first: z.number().int().min(1).max(16), last: z.number().int().min(1).max(16) },
    annotations: EDIT,
  }, ({ project: id, target, first, last }) => run(async () => changes(await svc.setChain(id, target, first, last))));

  server.registerTool("set_scene", {
    title: "Set scene",
    description: "Sets the pattern chain of the named tracks in a scene (other tracks keep theirs) and marks the scene saved.",
    inputSchema: { project, scene: z.number().int().min(1).max(16), chains: z.partialRecord(track, chain) },
    annotations: EDIT,
  }, ({ project: id, scene, chains }) => run(async () => changes(await svc.setScene(id, scene, chains))));

  server.registerTool("undo", {
    title: "Undo", description: "Undoes the last edit of a project.", inputSchema: { project }, annotations: WRITE,
  }, ({ project: id }) => run(async () => ({ undone: await svc.undo(id) })));

  server.registerTool("redo", {
    title: "Redo", description: "Redoes the last undone edit.", inputSchema: { project }, annotations: WRITE,
  }, ({ project: id }) => run(async () => ({ redone: await svc.redo(id) })));

  server.registerTool("diff_vs_original", {
    title: "Changes since opening", description: "Every byte range that differs from the file as opened, labelled with its field and how far that field is trusted.", inputSchema: { project }, annotations: READ,
  }, ({ project: id }) => run(() => svc.diffVsOriginal(id)));

  server.registerTool("validate", {
    title: "Validate",
    description: "Checks the project as it would be saved: CIRCUIT-HACKS checksum, no unverified field changed. Also lists what an export would not carry over.",
    inputSchema: { project }, annotations: READ,
  }, ({ project: id }) => run(() => svc.validate(id)));

  server.registerTool("get_fields", {
    title: "Get raw fields",
    description: "The file's field registry: offset, size, how far each field is trusted (verified / partial / unknown) and the evidence, with raw bytes for small fields.",
    inputSchema: { project, field: z.string().optional().describe("One field id, e.g. tempo") }, annotations: READ,
  }, ({ project: id, field }) => run(() => svc.fields(id, field)));

  server.registerTool("save_copy", {
    title: "Save a copy",
    description: `Writes the project, with its edits, to a new file in ${service.paths.copies}. Never overwrites a file and never writes to the card.`,
    inputSchema: { project, fileName: z.string().optional().describe("Base name for the copy; a time stamp is added") }, annotations: WRITE,
  }, ({ project: id, fileName }) => run(async () => ({ path: await svc.saveCopy(id, fileName) })));

  server.registerTool("export_midi", {
    title: "Export MIDI",
    description: `Writes a multitrack MIDI file (one track per Circuit track, tempo, scene markers) to ${service.paths.exports}.`,
    inputSchema: { project, source, repeats }, annotations: WRITE,
  }, ({ project: id, source: s, repeats: r }) => run(() => svc.exportMidi(id, { ...(s ? { source: s } : {}), ...(r ? { repeats: r } : {}) })));

  server.registerTool("export_als", {
    title: "Export Ableton Live set",
    description: `Writes an Ableton Live 12 set to ${service.paths.exports}: Session rows per scene and per pattern, and the arrangement laid out in time.`,
    inputSchema: {
      project, source, repeats,
      arrangement: z.boolean().optional().describe("Also fill the Arrangement view; default true"),
      instruments: z.enum(["live", "none"]).optional().describe("live (default): Live's starter kit and synths, drums on the kit's keys; none: empty tracks on the Circuit's own notes, to route to the Circuit"),
    },
    annotations: WRITE,
  }, ({ project: id, source: s, repeats: r, arrangement, instruments }) => run(() => svc.exportAls(id, {
    ...(s ? { source: s } : {}), ...(r ? { repeats: r } : {}), ...(arrangement !== undefined ? { arrangement } : {}), ...(instruments ? { instruments } : {}),
  })));

  return server;
}
