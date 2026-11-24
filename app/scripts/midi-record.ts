// Records what a MIDI input sends (e.g. the Circuit playing a project) for a while and saves it as
// JSON: [{ t (ms), bytes }]. Read-only: sends nothing, and SysEx is not requested.
// `npm run app:midi-record -- [seconds] [input name part] [out.json]`
import { app, BrowserWindow } from "electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env["CIRCUIT_DESK_USER_DATA"] ??= mkdtempSync(path.join(tmpdir(), "circuit-desk-record-"));
const mainEntry: string = "../electron/main.ts";
void import(mainEntry);
const args = process.argv.slice(2).filter((a) => !a.endsWith(".ts") && a !== ".");
const seconds = Number(args[0] ?? 20), match = (args[1] ?? "circuit").toLowerCase();
const out = args[2] ?? path.join(tmpdir(), `circuit-midi-${Date.now()}.json`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
void app.whenReady().then(async () => {
  let win: BrowserWindow | undefined;
  for (let i = 0; i < 80 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await wait(100); }
  if (!win) { console.log("no window"); app.exit(1); return; }
  const wc = win.webContents;
  if (wc.isLoading()) await new Promise<void>((r) => wc.once("did-finish-load", () => r()));
  const inputs = await wc.executeJavaScript(`navigator.requestMIDIAccess({ sysex: false }).then(a => {
    window.__rec = []; const t0 = performance.now(); const names = [];
    for (const i of a.inputs.values()) if ((i.name ?? '').toLowerCase().includes(${JSON.stringify(match)})) { names.push(i.name); i.onmidimessage = (e) => window.__rec.push({ t: Math.round(e.timeStamp - t0), bytes: [...e.data] }); }
    return { names, all: [...a.inputs.values()].map(i => i.name) };
  })`) as { names: string[]; all: string[] };
  if (!inputs.names.length) { console.log(`no MIDI input matching "${match}"; inputs: ${inputs.all.join(", ") || "none"}`); app.exit(1); return; }
  console.log(`listening to ${inputs.names.join(", ")}: press Play on the device; recording starts at the first note and lasts ${seconds} s`);
  for (let i = 0; i < 6000; i++) { if (await wc.executeJavaScript("window.__rec.some(m => (m.bytes[0] & 0xf0) === 0x90)") as boolean) break; await wait(100); }
  await wait(seconds * 1000);
  const rec = await wc.executeJavaScript("window.__rec") as { t: number; bytes: number[] }[];
  writeFileSync(out, JSON.stringify(rec));
  console.log(`${rec.length} messages (${rec.filter((m) => (m.bytes[0]! & 0xf0) === 0x90 && m.bytes[2]).length} note-ons) → ${out}`);
  app.exit(0);
});
