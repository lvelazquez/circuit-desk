// The MCP server working through a running app's socket: calls land in the app's service, edits
// are reported to the app, and without the socket the same tools work on the files.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { dispatch, ProjectService, serveSocket, SocketClient } from "@circuit-desk/core-service";
import { blankProject } from "../../ncs/src/testing.ts";
import { createServer } from "./server.ts";

const root = mkdtempSync(join(tmpdir(), "cd-link-"));
const paths = { library: join(root, "lib"), copies: join(root, "copies"), exports: join(root, "exports"), socket: join(root, "app.sock") };
mkdirSync(paths.library, { recursive: true });
const file = join(paths.library, "01_Link.ncs");
writeFileSync(file, blankProject("Link"));

async function client(service: ProjectService): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "t", version: "0" });
  await Promise.all([createServer(service).connect(a), c.connect(b)]);
  return c;
}
const text = async (c: Client, name: string, args: Record<string, unknown> = {}): Promise<string> =>
  ((await c.callTool({ name, arguments: args })) as CallToolResult).content.map((x) => (x.type === "text" ? x.text : "")).join("");

describe("MCP ↔ app link", () => {
  it("works on the files when no app is running", async () => {
    const c = await client(new ProjectService(paths));
    expect(JSON.parse(await text(c, "connection"))).toMatchObject({ via: "files" });
    await c.close();
  });

  it("works through the running app, which hears about each edit", async () => {
    const app = new ProjectService(paths);
    const edits: string[] = [];
    const server = await serveSocket(app, paths.socket, (m) => edits.push(m));
    const mcpLocal = new ProjectService(paths);
    const c = await client(mcpLocal);
    expect(JSON.parse(await text(c, "connection"))).toMatchObject({ via: "app" });
    const opened = JSON.parse(await text(c, "open_project", { path: file })) as { id: string };
    await text(c, "set_steps", { project: opened.id, track: "Synth 1", pattern: 1, steps: [{ step: 3, notes: [{ note: 67, velocity: 90, gate: 6 }] }] });
    expect(app.getPattern(opened.id, "Synth 1", 1).steps).toEqual([{ step: 3, probability: 7, notes: [{ note: 67, velocity: 90, gate: 6, micro: 0 }] }]);
    expect(mcpLocal.openProjects()).toEqual([]);
    expect(edits).toEqual(["openProject", "setSteps"]);
    expect(await text(c, "get_pattern", { project: "p9", track: "Synth 1", pattern: 1 })).toMatch(/no open project/);
    await c.close();
    server.close();
  });

  it("serves only service methods", async () => {
    const app = new ProjectService(paths);
    for (const m of ["paths", "constructor", "get", "apply", "__proto__"]) expect(await dispatch(app, m, [])).toMatchObject({ ok: false });
    expect(await dispatch(app, "openProjects", "not an array")).toMatchObject({ ok: false });
    const server = await serveSocket(app, paths.socket);
    const c = await SocketClient.connect(paths.socket);
    await expect(c!.call("paths" as never, [])).rejects.toThrow(/refused/);
    c!.close(); server.close();
  });

  it("refuses to start a second app on the same socket, and cleans up a stale one", async () => {
    const a = await serveSocket(new ProjectService(paths), paths.socket);
    await expect(serveSocket(new ProjectService(paths), paths.socket)).rejects.toThrow(/already serving/);
    a.close();
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(paths.socket, ""); // left by a crash
    const b = await serveSocket(new ProjectService(paths), paths.socket);
    b.close();
  });
});
