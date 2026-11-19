// Starts the real app (no fake MIDI) and reports what Web MIDI gives the window: the outputs, or
// the error. Read-only: sends nothing. `npm run app:midi-probe`
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env["CIRCUIT_DESK_USER_DATA"] ??= mkdtempSync(path.join(tmpdir(), "circuit-desk-probe-"));
const mainEntry: string = "../electron/main.ts";
void import(mainEntry);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
void app.whenReady().then(async () => {
  let win: BrowserWindow | undefined;
  for (let i = 0; i < 80 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await wait(100); }
  if (!win) { console.log("no window"); app.exit(1); return; }
  const wc = win.webContents;
  if (wc.isLoading()) await new Promise<void>((r) => wc.once("did-finish-load", () => r()));
  await wait(1500);
  const r = await wc.executeJavaScript(`navigator.requestMIDIAccess({ sysex: false }).then(a => ({ outputs: [...a.outputs.values()].map(o => o.name), inputs: [...a.inputs.values()].map(o => o.name) }), e => ({ error: String(e) }))`);
  const ui = await wc.executeJavaScript(`({ select: [...document.getElementById('midi-out').options].map(o => o.text), alert: document.querySelector('[role=alert]')?.textContent ?? null, status: document.querySelector('[role=status]')?.textContent })`);
  console.log(JSON.stringify({ midi: r, ui }, null, 2));
  app.exit(0);
});
