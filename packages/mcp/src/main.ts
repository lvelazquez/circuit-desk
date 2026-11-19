#!/usr/bin/env node
// stdio entry point: `node packages/mcp/src/main.ts`. Paths come from CIRCUIT_DESK_* variables
// (see core-service/src/paths.ts). Logs go to stderr: stdout carries the protocol.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

const server = createServer();
await server.connect(new StdioServerTransport());
console.error("circuit-desk MCP server ready");
