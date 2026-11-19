// Renders a project through the built-in preview, as File › Export Preview Audio does, and prints
// the WAV's path, length and levels. `npm run app:render -- <project.ncs>`
import { app, BrowserWindow } from "electron";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const file = process.argv.find((a) => a.endsWith(".ncs"));
if (!file) { console.log("usage: npm run app:render -- <project.ncs>"); process.exit(2); }
process.env["CIRCUIT_DESK_OPEN"] = path.resolve(file);
process.env["CIRCUIT_DESK_USER_DATA"] ??= mkdtempSync(path.join(tmpdir(), "circuit-desk-render-"));
const mainEntry: string = "../electron/main.ts";
const { service } = (await import(mainEntry)) as { service: { paths: { exports: string } } };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

void app.whenReady().then(async () => {
  let win: BrowserWindow | undefined;
  for (let i = 0; i < 80 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await wait(100); }
  const wc = win!.webContents;
  if (wc.isLoading()) await new Promise<void>((r) => wc.once("did-finish-load", () => r()));
  await wait(1000);
  wc.send("desk:menu", "export-audio");
  let status = "";
  for (let t = 0; t < 120 && !/preview\)\.wav|Error|not/.test(status); t++) { await wait(500); status = await wc.executeJavaScript(`document.querySelector('[role=status]').textContent`) as string; }
  const stem = path.basename(file).replace(/\.ncs$/i, "");
  const out = path.join(service.paths.exports, stem, `${stem} (preview).wav`);
  try {
    const w = readFileSync(out), ch = w.readUInt16LE(22), frames = (w.length - 44) / (2 * ch);
    let peak = 0, sum = 0;
    for (let i = 44; i < w.length; i += 2) { const x = Math.abs(w.readInt16LE(i)) / 32768; peak = Math.max(peak, x); sum += x * x; }
    console.log(`${out}\n${(frames / 48_000).toFixed(1)} s, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS, RMS ${(10 * Math.log10(sum / (frames * ch))).toFixed(1)} dBFS`);
  } catch { console.log(`no WAV: ${status}`); }
  app.exit(0);
});
