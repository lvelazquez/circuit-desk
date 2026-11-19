// A private local socket between the running app and the MCP server, so Claude's edits land in
// the project open in the app (and show there at once). Newline-delimited JSON:
//   → {"id": 1, "method": "getPattern", "args": [...]}
//   ← {"id": 1, "ok": true, "value": ...}  or  {"id": 1, "ok": false, "error": "..."}
// Only SERVICE_METHODS are served. The socket file is owner-only (0600) and removed on close.
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { ServiceError, type ProjectService } from "./service.ts";
import { UnsafeWriteError } from "./paths.ts";

/** The service methods callable from outside the main process (the window and the socket). */
export const SERVICE_METHODS = [
  "listProjects", "openProject", "closeProject", "openProjects", "summary", "getPattern",
  "setSteps", "setDrumSteps", "setPatternSettings", "getScenes", "setChain", "setScene",
  "undo", "redo", "diffVsOriginal", "validate", "saveCopy", "exportMidi", "exportAls", "arrangement", "fields", "getAutomation",
] as const;
export type ServiceMethod = (typeof SERVICE_METHODS)[number];

/** Methods that change a project; after one, the app refreshes its window. */
export const EDIT_METHODS: ReadonlySet<string> = new Set(["openProject", "closeProject", "setSteps", "setDrumSteps", "setPatternSettings", "setChain", "setScene", "undo", "redo"]);

export type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

/** Calls `method` on `service` if it is allowed; errors the caller can fix come back as messages. */
export async function dispatch(service: ProjectService, method: unknown, args: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  if (typeof method !== "string" || !(SERVICE_METHODS as readonly string[]).includes(method) || !Array.isArray(args)) return { ok: false, error: `refused: ${String(method)} is not a service method` };
  try {
    const f = service[method as ServiceMethod] as (...a: unknown[]) => unknown;
    return { ok: true, value: await f.apply(service, args) };
  } catch (e) {
    if (e instanceof ServiceError || e instanceof UnsafeWriteError || e instanceof RangeError) return { ok: false, error: e.message };
    return { ok: false, error: `unexpected error: ${(e as Error).message}` };
  }
}

function lines(sock: Socket, onLine: (line: string) => void): void {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (chunk: string) => {
    buf += chunk;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(l); }
  });
}

/** Serves `service` on `path`. Removes a stale socket file left by a crashed app first. */
export async function serveSocket(service: ProjectService, path: string, onEdit: (method: string) => void = () => {}): Promise<Server> {
  if (existsSync(path)) {
    const alive = await new Promise<boolean>((resolve) => { const c = createConnection(path); c.once("connect", () => { c.destroy(); resolve(true); }); c.once("error", () => resolve(false)); });
    if (alive) throw new Error(`another Circuit Desk is already serving ${path}`);
    unlinkSync(path);
  }
  const server = createServer((sock) => lines(sock, (line) => {
    let msg: { id?: unknown; method?: unknown; args?: unknown };
    try { msg = JSON.parse(line) as typeof msg; } catch { sock.write(`${JSON.stringify({ id: -1, ok: false, error: "not JSON" })}\n`); return; }
    const id = typeof msg.id === "number" ? msg.id : -1;
    void dispatch(service, msg.method, msg.args).then((r) => {
      sock.write(`${JSON.stringify({ id, ...r })}\n`);
      if (r.ok && typeof msg.method === "string" && EDIT_METHODS.has(msg.method)) onEdit(msg.method);
    });
  }));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, () => resolve()); });
  chmodSync(path, 0o600);
  server.on("close", () => { try { unlinkSync(path); } catch { /* already gone */ } });
  return server;
}

/** A connection to a running app. `connect` resolves to null when no app is listening. */
export class SocketClient {
  private sock: Socket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private closed = false;

  private constructor(sock: Socket) {
    this.sock = sock;
    lines(sock, (line) => {
      const r = JSON.parse(line) as Reply;
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      if (r.ok) p.resolve(r.value); else p.reject(new ServiceError(r.error));
    });
    const fail = (): void => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new ServiceError("the Circuit Desk app closed the connection"));
      this.pending.clear();
    };
    sock.on("close", fail);
    sock.on("error", fail);
  }

  static connect(path: string): Promise<SocketClient | null> {
    return new Promise((resolve) => {
      if (!existsSync(path)) { resolve(null); return; }
      const s = createConnection(path);
      s.once("connect", () => resolve(new SocketClient(s)));
      s.once("error", () => resolve(null));
    });
  }

  get isOpen(): boolean { return !this.closed; }

  call(method: ServiceMethod, args: unknown[]): Promise<unknown> {
    if (this.closed) return Promise.reject(new ServiceError("not connected to the Circuit Desk app"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(`${JSON.stringify({ id, method, args })}\n`);
    });
  }

  close(): void { this.closed = true; this.sock.end(); }
}
