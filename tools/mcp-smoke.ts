// Starts the MCP server over stdio, as Claude Code would, and calls a few read-only tools on the
// first project of the library. Usage: node tools/mcp-smoke.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";

const main = fileURLToPath(new URL("../packages/mcp/src/main.ts", import.meta.url));
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [main], env: { ...process.env } as Record<string, string>, stderr: "ignore" }));
const text = async (name: string, args: Record<string, unknown>): Promise<string> =>
  ((await client.callTool({ name, arguments: args })) as CallToolResult).content.map((c) => (c.type === "text" ? c.text : "")).join("");
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const list = JSON.parse(await text("list_projects", {})) as { path: string; name: string }[];
console.log(`library: ${list.length} projects`);
const first = list.find((p) => /Hello Tracks/.test(p.path)) ?? list[0];
if (first) {
  const s = JSON.parse(await text("open_project", { path: first.path })) as { id: string; name: string; tracks: { track: string; patternsWithNotes: number[] }[] };
  console.log(`opened ${s.id}: ${s.name}; ${s.tracks.map((t) => `${t.track} [${t.patternsWithNotes.join(",")}]`).join("; ")}`);
  const pat = JSON.parse(await text("get_pattern", { project: s.id, track: "Synth 1", pattern: 1 })) as { steps: unknown[] };
  console.log(`Synth 1 pattern 1: ${pat.steps.length} steps with notes; first: ${JSON.stringify(pat.steps[0])}`);
  console.log("validate:", await text("validate", { project: s.id }));
}
await client.close();
