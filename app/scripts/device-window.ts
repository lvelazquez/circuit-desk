// A hidden window of its own for the device scripts (device-dump.ts, device-record.ts): not the app,
// not the player. It is served from a private secure origin in its own session, which grants only the
// permissions the script names (Web MIDI; audio capture for the recorder) and nothing to any other page.
// With `fake`, Web MIDI (and, for the recorder, the audio input) is replaced before the page loads, so
// the scripts can be run end to end without any device.
import { app, BrowserWindow, protocol, session, type WebContents } from "electron";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const SCHEME = "device-check";
const ORIGIN = `${SCHEME}://local`;
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
// Own app data, so the scripts never touch the app's (or run into its single-instance lock).
app.setPath("userData", mkdtempSync(path.join(tmpdir(), "circuit-desk-device-")));
app.setName("Circuit Desk device check");

/** Script arguments after the script path (Electron passes its own first). */
export function scriptArgs(): string[] {
  const i = process.argv.findIndex((a) => a.endsWith(".ts"));
  return process.argv.slice(i + 1);
}

/** Runs `f`; on an error prints it and exits 1 (a throw at the top of an Electron script would hang on a dialog). */
export function orExit<T>(f: () => T): T {
  try { return f(); } catch (e) { console.error((e as Error).message); return process.exit(1); }
}

/** Pulls `--name value` (or a bare `--flag`) out of `args`. */
export function takeOption(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
export function takeFlag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}

/** `~/Circuit Desk/Device/<timestamp>` (or `CIRCUIT_DESK_HOME/Device/…`). Never under a Tracks/ folder. */
export function deviceFolder(stamp = new Date()): string {
  const home = process.env["CIRCUIT_DESK_HOME"] ?? path.join(homedir(), "Circuit Desk");
  return checkOutputFolder(path.join(home, "Device", stamp.toISOString().replace(/[:.]/g, "-")));
}

export function checkOutputFolder(dir: string): string {
  const abs = path.resolve(dir);
  if (/(^|[\\/])Tracks([\\/]|$)/.test(abs)) throw new Error(`refusing to write under a Tracks/ folder: ${abs}`);
  return abs;
}

export interface DeviceWindowOptions {
  /** Permissions granted to this window's page: "midi" / "midiSysex", "media" (audio only). */
  permissions: ReadonlySet<string>;
  /** A script run in the page before anything else (fakes), inlined in the page this window serves itself. */
  preload?: string;
}

/** Opens the hidden window and returns its contents once loaded. Call after app.whenReady(). */
export async function openDeviceWindow(o: DeviceWindowOptions): Promise<WebContents> {
  const ses = session.fromPartition("device-check");
  // The fake (if any) runs inline, first thing in the page, before any script asks for Web MIDI.
  const page = `<!doctype html><meta charset=utf-8><title>Circuit Desk device check</title>${o.preload ? `<script>${o.preload.replace(/<\/script/gi, "<\\/script")}</script>` : ""}`;
  if (!ses.protocol.isProtocolHandled(SCHEME)) ses.protocol.handle(SCHEME, () => new Response(page, { headers: { "content-type": "text/html" } }));
  const mine = (url: string | undefined): boolean => (url ?? "").startsWith(ORIGIN);
  ses.setPermissionCheckHandler((_wc, permission, origin, details) => o.permissions.has(permission) && mine(origin) && (permission !== "media" || details.mediaType !== "video"));
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const media = (details as { mediaTypes?: string[] }).mediaTypes;
    callback(o.permissions.has(permission) && mine(details.requestingUrl) && (permission !== "media" || (media ?? []).every((t) => t === "audio")));
  });
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  wc.on("will-navigate", (e) => e.preventDefault());
  await win.loadURL(`${ORIGIN}/`);
  return wc;
}

/** Runs `code` in the page and returns its (JSON-able) result. */
export function pageEval<T>(wc: WebContents, code: string): Promise<T> {
  return (wc.executeJavaScript(code) as Promise<T>).catch((e: unknown) => { throw new Error(`${(e as Error).message} in: ${code.slice(0, 160)}`); });
}

export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Port names that contain `match` (case-insensitive). */
export function pickPort(names: readonly string[], match: string, kind: string): string {
  const hits = names.filter((n) => n.toLowerCase().includes(match.toLowerCase()));
  if (hits.length === 1) return hits[0]!;
  throw new Error(`${hits.length ? `${hits.length} MIDI ${kind}s match` : `no MIDI ${kind} matches`} "${match}" (${kind}s: ${names.join(", ") || "none"}); pass a more exact --port`);
}
