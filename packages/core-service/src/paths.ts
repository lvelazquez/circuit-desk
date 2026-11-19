// Where Circuit Desk reads and writes. It only ever writes inside `copies` and `exports`; the card
// copy and the card itself are read-only here (writing to a card is P5, behind its own safeguards).
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";

export interface DeskPaths {
  /** Folder searched for projects by default. */
  library: string;
  copies: string;
  exports: string;
  /** The running app's local socket, which the MCP server uses when it is there. */
  socket: string;
}

export function defaultPaths(env: NodeJS.ProcessEnv = process.env): DeskPaths {
  const home = env["CIRCUIT_DESK_HOME"] ?? join(homedir(), "Circuit Desk");
  return {
    library: env["CIRCUIT_DESK_LIBRARY"] ?? join(home, "Card copy"),
    copies: env["CIRCUIT_DESK_COPIES"] ?? join(home, "Copies"),
    exports: env["CIRCUIT_DESK_EXPORTS"] ?? join(home, "Exports"),
    socket: env["CIRCUIT_DESK_SOCKET"] ?? join(home, ".circuit-desk.sock"),
  };
}

/** Resolves symlinks of the longest existing parent, so a link cannot lead a write elsewhere. */
function real(p: string): string {
  let at = resolve(p), rest = "";
  for (;;) {
    try { return join(realpathSync(at), rest); } catch {
      const up = dirname(at);
      if (up === at) return resolve(p);
      rest = join(at.slice(up.length + 1), rest); at = up;
    }
  }
}

export function isInside(child: string, parent: string): boolean {
  const r = relative(real(parent), real(child));
  return r === "" ? false : !r.startsWith("..") && !isAbsolute(r);
}

export class UnsafeWriteError extends Error {
  constructor(path: string, allowed: readonly string[]) {
    super(`refusing to write ${path}: Circuit Desk writes only inside ${allowed.join(" or ")}`);
    this.name = "UnsafeWriteError";
  }
}

export function checkWritable(path: string, roots: readonly string[]): void {
  if (!roots.some((r) => isInside(path, r))) throw new UnsafeWriteError(path, roots);
  // A pack folder on a card copy is never a target, even inside an allowed root.
  if (/(^|[\\/])Tracks[\\/]/.test(path)) throw new UnsafeWriteError(path, roots);
}
