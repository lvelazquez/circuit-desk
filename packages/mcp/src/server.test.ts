// The tools, called through a real MCP client over the in-memory transport, on synthetic files
// in a temporary folder.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { checkWritable, ProjectService } from "@circuit-desk/core-service";
import * as N from "@circuit-desk/ncs";
import { readSmf } from "../../export/src/smf-read.ts";
import { blankProject } from "../../ncs/src/testing.ts";
import { createServer } from "./server.ts";

const root = mkdtempSync(join(tmpdir(), "circuit-desk-mcp-"));
const paths = { library: join(root, "library"), copies: join(root, "copies"), exports: join(root, "exports"), socket: join(root, "no-app.sock") };
const file = join(paths.library, "Tracks", "01_Test Pack", "Sessions", "01_Test.ncs");
let client: Client;

beforeAll(async () => {
  mkdirSync(join(paths.library, "Tracks", "01_Test Pack", "Sessions"), { recursive: true });
  writeFileSync(file, blankProject("Test"));
  writeFileSync(join(paths.library, "Tracks", "01_Test Pack", "Sessions", "02_Broken.ncs"), new Uint8Array(10));
  const server = createServer(new ProjectService(paths));
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});
afterAll(async () => { await client.close(); });

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ error: boolean; text: string; json: unknown }> {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* error messages are plain text */ }
  return { error: r.isError === true, text, json };
}

describe("circuit-desk MCP server", () => {
  it("lists its tools, each with a description and read-only hint", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["list_projects", "open_project", "get_pattern", "set_steps", "set_drum_steps", "set_pattern_settings", "get_automation", "set_automation", "get_scenes", "set_chain", "set_scene", "undo", "redo", "diff_vs_original", "validate", "get_fields", "save_copy", "export_midi", "export_als"]) expect(names).toContain(n);
    for (const t of tools) { expect(t.description).toBeTruthy(); expect(t.annotations?.readOnlyHint).toBeTypeOf("boolean"); }
  });

  it("lists projects, and says which files are not projects", async () => {
    const r = await call("list_projects");
    expect(r.json).toEqual([
      expect.objectContaining({ pack: "01_Test Pack", file: "01_Test.ncs", name: "Test", problem: null }),
      expect.objectContaining({ file: "02_Broken.ncs", problem: "too-short" }),
    ]);
  });

  it("opens, edits with undo, saves a copy, and never touches the original", async () => {
    const opened = (await call("open_project", { path: file })).json as { id: string };
    expect(opened.id).toBe("p1");
    expect((await call("open_project", { path: file })).json).toMatchObject({ id: "p1" });

    const set = await call("set_steps", { project: "p1", track: "Synth 1", pattern: 2, steps: [{ step: 1, notes: [{ note: 60, velocity: 100, gate: 6 }, { note: 64, velocity: 90, gate: 12, micro: 3 }] }] });
    expect(set.error).toBe(false);
    expect((set.json as { changed: string[] }).changed[0]).toMatch(/^Synth 1 pattern 2: steps/);

    const pat = (await call("get_pattern", { project: "p1", track: "Synth 1", pattern: 2 })).json as { steps: unknown[]; settings: unknown };
    expect(pat.steps).toEqual([{ step: 1, probability: 7, notes: [{ note: 60, velocity: 100, gate: 6, micro: 0 }, { note: 64, velocity: 90, gate: 12, micro: 3 }] }]);
    expect(pat.settings).toEqual({ firstStep: 1, lastStep: 16, syncRate: "1/16", direction: "forward" });

    await call("set_drum_steps", { project: "p1", track: "Drum 1", pattern: 1, steps: [{ step: 5, velocity: 110, microSteps: [1, 4] }] });
    expect((await call("get_pattern", { project: "p1", track: "Drum 1", pattern: 1 })).json).toMatchObject({ steps: [{ step: 5, velocity: 110, microSteps: [1, 4] }] });

    const diff = (await call("diff_vs_original", { project: "p1" })).json as { field: string; status: string }[];
    expect([...new Set(diff.map((d) => d.field))]).toEqual(["Synth 1 pattern 2: steps", "Drum 1 pattern 1: velocity", "Drum 1 pattern 1: microSteps"]);
    expect(diff.every((d) => d.status === "verified")).toBe(true);
    expect((await call("validate", { project: "p1" })).json).toMatchObject({ ok: true, problems: [] });

    expect((await call("undo", { project: "p1" })).json).toEqual({ undone: true });
    expect((await call("get_pattern", { project: "p1", track: "Drum 1", pattern: 1 })).json).toMatchObject({ steps: [] });
    expect((await call("redo", { project: "p1" })).json).toEqual({ redone: true });

    const saved = (await call("save_copy", { project: "p1" })).json as { path: string };
    expect(saved.path.startsWith(paths.copies)).toBe(true);
    const copy = N.openProject(new Uint8Array(readFileSync(saved.path)));
    expect(N.readDrumPattern(copy, 0, 0).steps[4]!.velocity).toBe(110);
    expect(readFileSync(file)).toEqual(Buffer.from(blankProject("Test")));
  });

  it("exports MIDI into the exports folder", async () => {
    const r = (await call("export_midi", { project: "p1", source: "current" })).json as { path: string };
    expect(r.path.startsWith(paths.exports)).toBe(true);
    const smf = readSmf(new Uint8Array(readFileSync(r.path)));
    expect(smf.problems).toEqual([]);
    expect(smf.tracks.map((t) => t.name)).toContain("Drum 1");
  });

  it("edits chains and scenes", async () => {
    await call("set_chain", { project: "p1", target: "Synth 1", first: 1, last: 2 });
    await call("set_scene", { project: "p1", scene: 3, chains: { "Drum 1": { first: 2, last: 4 } } });
    const s = (await call("get_scenes", { project: "p1" })).json as { currentChains: Record<string, unknown>; scenes: { saved: boolean; chains: Record<string, unknown> }[] };
    expect(s.currentChains["Synth 1"]).toEqual({ first: 1, last: 2 });
    expect(s.scenes[2]).toMatchObject({ saved: true, chains: { "Drum 1": { first: 2, last: 4 }, "Synth 1": { first: 1, last: 1 } } });
  });

  it("returns fixable mistakes as tool errors", async () => {
    expect((await call("get_pattern", { project: "p9", track: "Synth 1", pattern: 1 })).text).toMatch(/no open project "p9"/);
    expect((await call("set_steps", { project: "p1", track: "Synth 1", pattern: 1, steps: [{ step: 1, notes: [{ note: 200, velocity: 1, gate: 6 }] }] })).error).toBe(true);
    expect((await call("set_chain", { project: "p1", target: "Synth 2", first: 4, last: 2 })).text).toMatch(/after last/);
    expect((await call("set_chain", { project: "p1", target: "Drum 2", first: 1, last: 12 })).text).toMatch(/last must be 1–8/);
    expect((await call("open_project", { path: join(paths.library, "Tracks", "01_Test Pack", "Sessions", "02_Broken.ncs") })).error).toBe(true);
  });

  it("refuses writes outside its folders and into pack folders", () => {
    expect(() => checkWritable(join(root, "elsewhere", "x.ncs"), [paths.copies])).toThrow(/refusing/);
    expect(() => checkWritable(join(paths.copies, "Tracks", "01_X", "Sessions", "01.ncs"), [paths.copies])).toThrow(/refusing/);
    expect(() => checkWritable(join(paths.copies, "..", "x.ncs"), [paths.copies])).toThrow(/refusing/);
    expect(existsSync(paths.copies) && readdirSync(paths.copies).length).toBe(1);
  });

  it("sets automation points, clears a lane, and refuses values the device cannot store", async () => {
    await call("set_automation", { project: "p1", track: "Drum 2", pattern: 1, lane: 8, points: [{ step: 1, value: 0 }, { step: 2, micro: 4, value: 127 }] });
    const got = (await call("get_automation", { project: "p1", track: "Drum 2", pattern: 1 })).json as { lanes: { lane: number; name: string; points: (number | null)[] }[]; names: string[] };
    const pan = got.lanes.find((l) => l.lane === 8)!;
    expect(pan.name).toBe("Pan");
    expect([pan.points[0], pan.points[6 + 3], pan.points[1]]).toEqual([0, 127, null]);
    expect(got.names).toHaveLength(8);
    await call("set_automation", { project: "p1", track: "Drum 2", pattern: 1, lane: 8, points: [], clear: true });
    const after = (await call("get_automation", { project: "p1", track: "Drum 2", pattern: 1 })).json as { lanes: unknown[] };
    expect(after.lanes).toHaveLength(0);
    const bad = await call("set_automation", { project: "p1", track: "Drum 2", pattern: 1, lane: 9, points: [{ step: 1, value: 3 }] });
    expect(bad.error).toBe(true);
    expect(bad.text).toMatch(/lane must be 1–8/);
  });

  it("reads and sets project settings and pattern direction", async () => {
    const opened = (await call("open_project", { path: file })).json as { id: string };
    const id = opened.id;
    const before = (await call("get_settings", { project: id })).json as { scale: { root: number; type: number }; sound: { levels: number[] } };
    expect(before.scale).toEqual({ root: 0, type: 0 });
    const r = await call("set_settings", { project: id, tempo: 126, scale: { root: 9 }, levels: [null, 90], drums: [null, null, { pan: 20 }] });
    expect(r.error).toBe(false);
    const after = (await call("get_settings", { project: id })).json as { tempo: number; scale: { root: number; type: number }; sound: { levels: number[]; drums: { pan: number }[] } };
    expect(after.tempo).toBe(126);
    expect(after.scale).toEqual({ root: 9, type: 0 });
    expect(after.sound.levels[1]).toBe(90);
    expect(after.sound.levels[0]).toBe(before.sound.levels[0]);
    expect(after.sound.drums[2]!.pan).toBe(20);
    expect((await call("set_settings", { project: id, scale: { type: 16 } })).error).toBe(true);
    await call("set_pattern_settings", { project: id, track: "Synth 1", pattern: 1, direction: "ping-pong" });
    const pat = (await call("get_pattern", { project: id, track: "Synth 1", pattern: 1 })).json as { settings: { direction: string } };
    expect(pat.settings.direction).toBe("ping-pong");
  });
});
