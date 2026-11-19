// Electron shell. The built window (app/dist) is served from a private app:// origin; the project
// service runs here, in the main process, and the window reaches it only through the allowlisted
// bridge in api.ts. Set CIRCUIT_DESK_DEV_URL to load the Vite dev server instead.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dispatch, isInside, ProjectService, serveSocket } from "@circuit-desk/core-service";
import type { DeskResult, MenuCommand } from "./api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, "..", "dist");
const ORIGIN = "app://circuit-desk";
const DEV_URL = process.env["CIRCUIT_DESK_DEV_URL"];

const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self' data:", "connect-src 'self'"].join("; ");

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

export const service = new ProjectService();

function serveDist(): void {
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname) === "/" ? "index.html" : decodeURIComponent(pathname);
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response("Not found", { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set("Content-Security-Policy", CSP);
    return new Response(res.body, { status: res.status, headers });
  });
}

function isAppUrl(url: string): boolean {
  return url.startsWith(ORIGIN) || (DEV_URL !== undefined && url.startsWith(DEV_URL));
}

function bridge(): void {
  ipcMain.handle("desk:call", async (event, method: unknown, args: unknown): Promise<DeskResult<unknown>> => {
    if (!isAppUrl(event.senderFrame?.url ?? "")) return { ok: false, error: "refused: not the app window" };
    const r = await dispatch(service, method, args);
    if (!r.ok && r.error.startsWith("unexpected")) console.error(r.error);
    return r;
  });
  ipcMain.handle("desk:pickProject", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = { title: "Open a Circuit Tracks project", defaultPath: service.paths.library, properties: ["openFile" as const], filters: [{ name: "Circuit Tracks project", extensions: ["ncs"] }] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle("desk:reveal", (_event, p: unknown) => {
    if (typeof p !== "string" || ![service.paths.copies, service.paths.exports].some((r) => isInside(p, r))) return;
    shell.showItemInFolder(p);
  });
}

/**
 * Web MIDI for playback is the one permission the window gets, and only without SysEx: the app
 * sends notes and clock, never messages that could change a device's settings. All else is refused.
 */
function permissions(): void {
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permission === "midi" && isAppUrl(origin));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => callback(permission === "midi" && isAppUrl(details.requestingUrl)));
}

function send(command: MenuCommand): void {
  (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send("desk:menu", command);
}

function menu(): void {
  const item = (label: string, accelerator: string, command: MenuCommand): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(command) });
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    { label: "File", submenu: [item("Open Project…", "CmdOrCtrl+O", "open"), item("Save a Copy", "CmdOrCtrl+S", "save-copy"), { type: "separator" }, item("Export MIDI", "CmdOrCtrl+E", "export-midi"), item("Export Live Set", "CmdOrCtrl+Shift+E", "export-als"), { type: "separator" }, { role: "close" }] },
    // Undo and redo go to the window, which undoes text in a focused field or the project's last edit.
    { label: "Edit", submenu: [item("Undo", "CmdOrCtrl+Z", "undo"), item("Redo", "Shift+CmdOrCtrl+Z", "redo"), { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "Transport", submenu: [item("Play / Stop", "CmdOrCtrl+Return", "play")] },
    { label: "View", submenu: [item("Next View (Circuit, Editor, Scenes)", "CmdOrCtrl+1", "toggle-view"), { type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 640, title: "Circuit Desk", backgroundColor: "#101114",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(here, "preload.cjs") },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => { if (!isAppUrl(url)) e.preventDefault(); });
  void win.loadURL(DEV_URL ?? `${ORIGIN}/`);
  return win;
}

app.setName("Circuit Desk");
void app.whenReady().then(() => {
  serveDist();
  permissions();
  bridge();
  menu();
  const start = process.env["CIRCUIT_DESK_OPEN"];
  if (start) service.openProject(start);
  createWindow();
  // The MCP server talks to this app through a private local socket; its edits refresh the window.
  serveSocket(service, service.paths.socket, () => send("changed")).then(
    (server) => app.on("will-quit", () => server.close()),
    (e: unknown) => console.error(`MCP link not started: ${(e as Error).message}`),
  );
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
