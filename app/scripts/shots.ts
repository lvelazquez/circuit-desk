// Screenshots of every view on a real project, for comparing the UI before and after a change:
// `npm run app:shots -- <project.ncs> <out dir> [width height]`. It also plays the project for a few
// seconds on the built-in preview and logs what the Editor shows (pattern, playhead, scroll).
// Read-only: a temporary Circuit Desk home, so nothing is written next to the project.
import { app, BrowserWindow } from "electron";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [project, outDir, w, h] = process.argv.slice(process.argv.findIndex((a) => a.endsWith("shots.ts")) + 1);
if (!project || !outDir) throw new Error("usage: electron app/scripts/shots.ts <project.ncs> <out dir> [width height]");
mkdirSync(outDir, { recursive: true });
const home = mkdtempSync(path.join(tmpdir(), "circuit-desk-shots-"));
process.env["CIRCUIT_DESK_HOME"] = home;
process.env["CIRCUIT_DESK_LIBRARY"] = path.dirname(project);
process.env["CIRCUIT_DESK_USER_DATA"] = path.join(home, "app-data");
process.env["CIRCUIT_DESK_OPEN"] = project;
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
const mainEntry: string = "../electron/main.ts";
void import(mainEntry);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(): Promise<void> {
  let win: BrowserWindow | undefined;
  for (let i = 0; i < 80 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await wait(100); }
  if (!win) throw new Error("no window");
  win.setSize(Number(w ?? 1440), Number(h ?? 900));
  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  if (wc.isLoading()) await new Promise<void>((r) => wc.once("did-finish-load", () => r()));
  const js = <T>(code: string) => wc.executeJavaScript(code) as Promise<T>;
  await wait(1500);
  const shot = async (name: string) => writeFileSync(path.join(outDir!, `${name}.png`), (await wc.capturePage()).toPNG());
  const views = await js<string[]>(`[...document.querySelectorAll('[data-view]')].map(b => b.dataset.view)`);
  const labels = views.length ? views : ["Circuit", "Editor", "Scenes", "Sounds", "Mixer", "Pack", "Project"];
  for (const v of labels) {
    await js(`(document.querySelector('[data-view="${v}"]') ?? [...document.querySelectorAll('button')].find(b => b.textContent === '${v}'))?.click()`);
    await wait(700);
    await shot(`view-${v.toLowerCase()}`);
  }
  // The panel's pad views and Shift, when the panel is there.
  const panelButton = (name: string) => `[...document.querySelectorAll('.hw-btn')].find(b => b.querySelector('.hw-label')?.textContent === '${name}')`;
  if (await js<boolean>(`!!document.querySelector('.hw')`)) {
    for (const [name, file] of [["Patterns", "pads-patterns"], ["Velocity", "pads-velocity"], ["Pattern Settings", "pads-settings"], ["Note", "pads-note"]] as const) {
      await js(`${panelButton(name)}?.click()`);
      await wait(300);
      if (name === "Velocity") { await js(`document.querySelector('.hw .grid .pad')?.click()`); await wait(300); }
      await shot(file);
    }
    await js(`${panelButton("Shift")}?.click()`);
    await wait(300);
    await shot("panel-shift");
    await js(`${panelButton("Shift")}?.click()`);
  }
  // The Editor while playing, a few seconds in.
  await js(`(document.querySelector('[data-view="editor"]') ?? [...document.querySelectorAll('button')].find(b => b.textContent === 'Editor'))?.click()`);
  await wait(400);
  await js(`[...document.querySelectorAll('button')].find(b => /^(▶|Play)/.test(b.textContent.trim()) || b.getAttribute('aria-label') === 'Play')?.click()`);
  // Once a second: the pattern the Editor shows, whether its playhead is drawn, and the roll's scroll.
  for (let s = 1; s <= 9; s++) {
    await wait(1000);
    console.log(`t=${s}s`, JSON.stringify(await js(`({ pattern: document.querySelector('label select[data-tip^="The pattern shown"]')?.value, playhead: !!document.querySelector('.roll-playhead'), scroll: [document.querySelector('.roll')?.scrollLeft, document.querySelector('.roll')?.scrollTop] })`)));
    if (s === 4) await shot("editor-playing");
  }
  console.log(`shots in ${outDir}`);
}

void app.whenReady().then(() => setTimeout(() => {
  run().catch((e: unknown) => { console.error(e); process.exitCode = 1; }).finally(() => app.exit());
}, 300));
