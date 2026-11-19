// Smoke test in the real Electron app, on a synthetic project in a temporary folder:
// keyboard editing in the Circuit view, undo/redo through the app menu, a saved copy on disk,
// the piano roll and drum grid, accessible names, and reduced motion. `npm run app:smoke`.
import { app, BrowserWindow, Menu, type MenuItem } from "electron";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openProject, readNotePattern } from "@circuit-desk/ncs";
import { blankProject } from "../../packages/ncs/src/testing.ts";

const home = mkdtempSync(path.join(tmpdir(), "circuit-desk-smoke-"));
const file = path.join(home, "Card copy", "Tracks", "01_Smoke", "Sessions", "01_Smoke.ncs");
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, blankProject("Smoke"));
process.env["CIRCUIT_DESK_HOME"] = home;
process.env["CIRCUIT_DESK_OPEN"] = file;
const mainEntry: string = "../electron/main.ts";
void import(mainEntry);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: string[] = [];
let failed = false;
const check = (name: string, ok: boolean, detail = ""): void => { results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed = true; };

async function run(): Promise<void> {
  let win: BrowserWindow | undefined;
  for (let i = 0; i < 80 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await wait(100); }
  if (!win) throw new Error("no window");
  const wc = win.webContents;
  if (wc.isLoading()) await new Promise<void>((r) => wc.once("did-finish-load", () => r()));
  const js = <T>(code: string) => wc.executeJavaScript(code) as Promise<T>;
  const until = async (code: string, ms = 3000): Promise<boolean> => { for (let t = 0; t < ms; t += 100) { if (await js<boolean>(code)) return true; await wait(100); } return false; };
  const key = async (keyCode: string, modifiers: ("shift" | "alt")[] = []): Promise<void> => {
    wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    if (keyCode.length === 1 || keyCode === "Space") wc.sendInputEvent({ type: "char", keyCode: keyCode === "Space" ? " " : keyCode, modifiers });
    wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await wait(250);
  };
  const menuClick = (label: string): void => {
    const find = (items: MenuItem[]): MenuItem | undefined => items.map((i) => (i.label === label ? i : i.submenu ? find(i.submenu.items) : undefined)).find(Boolean);
    const item = find(Menu.getApplicationMenu()?.items ?? []);
    if (!item) throw new Error(`no menu item ${label}`);
    item.click();
  };
  const step1 = `document.querySelector('[aria-label^="Step 1:"]')`;

  check("project opens in the Circuit view", await until(`document.querySelectorAll('.grid .pad').length === 32`), `${await js<number>(`document.querySelectorAll('.grid .pad').length`)} pads`);
  check("8 track buttons", (await js<number>(`document.querySelectorAll('[role=radiogroup][aria-label=Track] [role=radio]').length`)) === 8);

  await js(`${step1}.focus()`);
  await key("Space");
  check("Space on step 1 puts the current note there", await until(`${step1}.getAttribute('aria-pressed') === 'true'`), await js<string>(`${step1}.getAttribute('aria-label')`));
  await key("Right");
  check("arrow key moves focus to step 2", (await js<string>(`document.activeElement.getAttribute('aria-label')`)).startsWith("Step 2:"));

  menuClick("Undo");
  check("Edit › Undo removes it", await until(`${step1}.getAttribute('aria-pressed') === 'false'`));
  menuClick("Redo");
  check("Edit › Redo puts it back", await until(`${step1}.getAttribute('aria-pressed') === 'true'`));

  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Save a copy').click()`);
  await until(`document.querySelector('[role=status]').textContent.startsWith('Saved a copy')`);
  const copies = path.join(home, "Copies");
  const saved = readdirSync(copies).filter((f) => f.endsWith(".ncs"));
  const copy = saved[0] ? openProject(new Uint8Array(readFileSync(path.join(copies, saved[0])))) : null;
  check("Save a copy writes the edit to a new file", !!copy && readNotePattern(copy, 0, 0).steps[0]!.units[0]!.on && readNotePattern(copy, 0, 0).steps[0]!.units[0]!.note === 60, saved.join(", "));
  check("the original is untouched", readFileSync(file).equals(Buffer.from(blankProject("Smoke"))));

  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Editor').click()`);
  check("Editor view shows the piano roll", await until(`!!document.querySelector('.roll')`));
  const before = await js<number>(`document.querySelectorAll('.roll-note').length`);
  await js(`document.querySelector('.roll').focus()`);
  await key("Up"); await key("Up"); await key("Enter");
  check("Enter in the piano roll adds a note at the cursor", await until(`document.querySelectorAll('.roll-note').length === ${before + 1}`), `${before} → ${await js<number>(`document.querySelectorAll('.roll-note').length`)}`);
  await key("]", ["shift"]);
  const width = await js<string>(`getComputedStyle(document.querySelector('.roll-note[data-selected=true]')).getPropertyValue('--w')`);
  check("Shift+] makes the note a step longer", width.trim() === "2", `--w ${width}`);

  await js(`document.querySelector('.drum-cell').click()`);
  check("a click on the drum grid adds a hit", await until(`document.querySelector('.drum-cell').getAttribute('aria-pressed') === 'true'`));

  const unnamed = await js<number>(`[...document.querySelectorAll('button, [role=application], input, select')].filter(b => !(b.getAttribute('aria-label') || b.textContent.trim() || b.labels?.length)).length`);
  check("every control has an accessible name", unnamed === 0, `${unnamed} without`);

  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Circuit').click()`);
  await until(`!!document.querySelector('.grid .pad')`);
  const motion = await js<string>(`getComputedStyle(document.querySelector('.grid .pad')).transitionDuration`);
  wc.debugger.attach();
  await wc.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await wait(200);
  const reduced = await js<string>(`getComputedStyle(document.querySelector('.grid .pad')).transitionDuration`);
  check("pads animate normally and not under reduced motion", motion.includes("0.09s") && reduced.split(",").every((d) => d.trim() === "0s"), `${motion} → ${reduced}`);
  await wc.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
  wc.debugger.detach();

  const shot = path.join(home, "circuit-view.png");
  writeFileSync(shot, (await wc.capturePage()).toPNG());
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Editor').click()`);
  await wait(400);
  const shot2 = path.join(home, "editor-view.png");
  writeFileSync(shot2, (await wc.capturePage()).toPNG());
  console.log(results.join("\n"));
  console.log(`screenshots: ${shot} ${shot2}`);
}

void app.whenReady().then(() => setTimeout(() => {
  run().catch((e: unknown) => { console.error(e); failed = true; }).finally(() => { app.exit(failed ? 1 : 0); });
}, 300));
