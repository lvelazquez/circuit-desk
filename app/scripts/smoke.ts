// Smoke test in the real Electron app, on a synthetic project in a temporary folder:
// keyboard editing in the Circuit view, undo/redo through the app menu, a saved copy on disk,
// the piano roll and drum grid, accessible names, and reduced motion. `npm run app:smoke`.
import { app, BrowserWindow, Menu, type MenuItem } from "electron";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SocketClient } from "@circuit-desk/core-service";
import { encodeWav } from "@circuit-desk/engine";
import { DLANE0, LANE0, drumPatternOffset, notePatternOffset, openProject, readNotePattern } from "@circuit-desk/ncs";
import { blankProject } from "../../packages/ncs/src/testing.ts";
import { PATCH_SIZE, initPatchBytes } from "@circuit-desk/patch";

const home = mkdtempSync(path.join(tmpdir(), "circuit-desk-smoke-"));
const file = path.join(home, "Card copy", "Tracks", "01_Smoke", "Sessions", "01_Smoke.ncs");
mkdirSync(path.dirname(file), { recursive: true });
const start = blankProject("Smoke");
// Synth 1 pattern 1, lane 1 (macro 1): a ramp over steps 1–4, so the editor has automation to show.
for (let k = 0; k < 24; k++) start[notePatternOffset(0, 0) + LANE0 + k] = k * 5;
// Drum 1 pattern 1, lane 8 (pan): hard left from step 1, so playing to a Circuit sends CC 77 on channel 10.
start[drumPatternOffset(0, 0) + DLANE0 + 192 * 7] = 0;
writeFileSync(file, start);
// The pack's sample 0: a 60 ms 200 Hz burst, so the rendered preview can be checked for it.
mkdirSync(path.join(path.dirname(path.dirname(file)), "PCM"));
const burst = new Float32Array(2880).map((_, i) => 0.8 * Math.sin((2 * Math.PI * 200 * i) / 48_000));
writeFileSync(path.join(path.dirname(path.dirname(file)), "PCM", "00_Burst.wav"), encodeWav([burst], 48_000));
// A patch bank: slot 1 is the guide's default patch as a Bass, with a CIRCUIT-HACKS own-synth record
// in its padding; slot 2 is the default patch with the stock 0xFF filler.
mkdirSync(path.join(path.dirname(path.dirname(file)), "Patches"));
{
  const bank = new Uint8Array(512 + PATCH_SIZE).fill(0xff);
  const bass = initPatchBytes(); bass[16] = 2;
  bank.set(bass, 0);
  bank.set([0x43, 0x54, 0x4d, 0x31], PATCH_SIZE);
  bank.set(initPatchBytes(), 512);
  writeFileSync(path.join(path.dirname(path.dirname(file)), "Patches", "00_PATCHBANK.cpb"), bank);
}
process.env["CIRCUIT_DESK_HOME"] = home;
process.env["CIRCUIT_DESK_USER_DATA"] = path.join(home, "app-data");
process.env["CIRCUIT_DESK_OPEN"] = file;
// The smoke window is often behind other windows. Chromium stops painting (and requestAnimationFrame,
// which draws the playhead) for occluded or background windows, so checks failed at random.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
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
  wc.setBackgroundThrottling(false);
  if (wc.isLoading()) await new Promise<void>((r) => wc.once("did-finish-load", () => r()));
  const js = <T>(code: string) => (wc.executeJavaScript(code) as Promise<T>).catch((e: unknown) => { throw new Error(`${(e as Error).message} in: ${code.slice(0, 120)}`); });
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

  // A fake MIDI output, installed before the page loads, so playback is checked without sending to real ports.
  wc.debugger.attach();
  await wc.debugger.sendCommand("Page.enable");
  await wc.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__sent = [];
    const out = { id: "fake", name: "Smoke output", send: (bytes, at) => window.__sent.push({ bytes: [...bytes], at }) };
    navigator.requestMIDIAccess = async () => ({ outputs: new Map([["fake", out]]), onstatechange: null, sysexEnabled: false });` });
  wc.reload();
  await new Promise<void>((r) => wc.once("did-finish-load", () => r()));

  check("project opens in the Circuit view", await until(`document.querySelectorAll('.grid .pad').length === 32`), `${await js<number>(`document.querySelectorAll('.grid .pad').length`)} pads`);
  check("8 track buttons", (await js<number>(`document.querySelectorAll('[role=radiogroup][aria-label=Track] [role=radio]').length`)) === 8);

  await js(`${step1}.focus()`);
  await key("Space");
  check("Space on step 1 puts the current note there", await until(`${step1}.getAttribute('aria-pressed') === 'true'`), await js<string>(`${step1}.getAttribute('aria-label')`));
  // The held key is solid in the track colour, even when it is also the root or a used pitch.
  const held = await js<{ bg: string; track: string } | null>(`(() => { const k = document.querySelector('.pad.key[aria-pressed=true]'); if (!k) return null;
    const probe = document.createElement('div'); probe.style.background = 'var(--track)'; k.appendChild(probe); const track = getComputedStyle(probe).backgroundColor; probe.remove();
    return { bg: getComputedStyle(k).backgroundColor, track }; })()`);
  check("the held key is solid in the track colour", !!held && held.bg === held.track, JSON.stringify(held));
  await key("Right");
  check("arrow key moves focus to step 2", (await js<string>(`document.activeElement.getAttribute('aria-label')`)).startsWith("Step 2:"));
  // The project name stays readable in the toolbar (it once shrank to one letter).
  const nameWidth = await js<number>(`document.querySelector('.project-name').getBoundingClientRect().width`);
  check("the project name is readable in the toolbar", nameWidth >= 120, `${Math.round(nameWidth)} px: ${await js<string>(`document.querySelector('.project-name').textContent`)}`);

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
  check("the original is untouched", readFileSync(file).equals(Buffer.from(start)));

  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Editor').click()`);
  check("Editor view shows the piano roll", await until(`!!document.querySelector('.roll')`));
  check("automation lanes show under the piano roll", await until(`!!document.querySelector('.lane-points[aria-label^="Lane 1, Macro 1: 24 points, values 0–115"]')`),
    await js<string>(`document.querySelector('.lane-points')?.getAttribute('aria-label') ?? 'none'`));
  check("the player can target a Circuit or the Live play-along set", (await js<string>(`[...document.getElementById('play-target').options].map(o => o.value).join()`)) === "circuit,live");
  const before = await js<number>(`document.querySelectorAll('.roll-note').length`);
  await js(`document.querySelector('.roll').focus()`);
  await key("Up"); await key("Up"); await key("Enter");
  check("Enter in the piano roll adds a note at the cursor", await until(`document.querySelectorAll('.roll-note').length === ${before + 1}`), `${before} → ${await js<number>(`document.querySelectorAll('.roll-note').length`)}`);
  await key("]", ["shift"]);
  const width = await js<string>(`getComputedStyle(document.querySelector('.roll-note[data-selected=true]')).getPropertyValue('--w')`);
  check("Shift+] makes the note a step longer", width.trim() === "2", `--w ${width}`);

  // Mouse: drag the selected note two steps right, then drag its end one step longer.
  // After an edit the pattern reloads and the selected note is briefly re-rendered: wait for it.
  const rect = async (): Promise<{ x: number; y: number; w: number; h: number }> => (await until(`!!document.querySelector('.roll-note[data-selected=true]')`), js(`(() => { const r = document.querySelector('.roll-note[data-selected=true]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`));
  const stepPx = await js<number>(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--size-roll-step'))`);
  const mouse = async (type: "mouseDown" | "mouseMove" | "mouseUp", x: number, y: number): Promise<void> => { wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 }); await wait(60); };
  let r0 = await rect();
  await mouse("mouseDown", r0.x + 4, r0.y + r0.h / 2); await mouse("mouseMove", r0.x + 4 + stepPx, r0.y + r0.h / 2); await mouse("mouseMove", r0.x + 4 + 2 * stepPx, r0.y + r0.h / 2); await mouse("mouseUp", r0.x + 4 + 2 * stepPx, r0.y + r0.h / 2);
  await wait(300);
  const r1 = await rect();
  check("dragging a note moves it two steps", Math.abs(r1.x - r0.x - 2 * stepPx) < 2, `${r0.x} → ${r1.x}`);
  r0 = r1;
  const end = r0.x + r0.w - 2;
  await mouse("mouseDown", end, r0.y + r0.h / 2); await mouse("mouseMove", end + stepPx, r0.y + r0.h / 2); await mouse("mouseUp", end + stepPx, r0.y + r0.h / 2);
  await wait(300);
  const r2 = await rect();
  check("dragging a note's end makes it longer", r2.w - r0.w > stepPx * 0.8, `${r0.w} → ${r2.w}`);

  // Editing lanes: the keyboard in a focused lane, then drawing a new lane with the mouse; each is one undoable edit.
  const statusText = (): Promise<string> => js<string>(`document.querySelector('[role=status]').textContent`);
  const laneSel = (prefix: string): string => `document.querySelector('.lane-points[aria-label^="${prefix}"]')`;
  await js(`${laneSel("Lane 1, Macro 1")}.focus()`);
  await key("Up");
  check("Up in a focused lane raises the point and saves it", await until(`document.querySelector('[role=status]').textContent.includes('Macro 1: 1 at step 1.1')`), await statusText());
  await js(`(() => { const s = document.querySelector('.lane-add select'); s.value = '12'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check("a lane can be added", await until(`!!${laneSel("Lane 12, Pan: empty")}`));
  await js(`${laneSel("Lane 12, Pan")}.scrollIntoView({ block: 'center' })`);
  await wait(200);
  const lr = await js<{ x: number; y: number; w: number; h: number }>(`(() => { const b = ${laneSel("Lane 12, Pan")}.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  await mouse("mouseDown", lr.x + 3, lr.y + lr.h * 0.8); await mouse("mouseMove", lr.x + lr.w * 0.12, lr.y + lr.h * 0.5); await mouse("mouseMove", lr.x + lr.w * 0.25, lr.y + lr.h * 0.2); await mouse("mouseUp", lr.x + lr.w * 0.25, lr.y + lr.h * 0.2);
  // Drawn from 20 % to 80 % of the lane's height: values about 25 to 100.
  check("drawing with the mouse saves a run of points in one edit, at the heights drawn", await until(`(() => { const m = /^Lane 12, Pan: \\d+ points, values (\\d+)–(\\d+)/.exec(${laneSel("Lane 12, Pan")}?.getAttribute('aria-label') ?? ''); return !!m && +m[1] < 40 && +m[2] > 85 && +m[2] < 115; })()`),
    `${await js<string>(`${laneSel("Lane 12, Pan")}?.getAttribute('aria-label') ?? 'none'`)} · ${await statusText()}`);
  menuClick("Undo");
  check("Undo removes the drawn points", await until(`!!${laneSel("Lane 12, Pan: empty")}`));
  menuClick("Undo");
  check("a second Undo restores the macro lane", await until(`!!${laneSel("Lane 1, Macro 1: 24 points, values 0–115")}`));
  check("each drum's lanes can be chosen for editing", await js<boolean>(`document.querySelector('.drum-automation > label select')?.options.length === 4`));

  await js(`document.querySelector('.drum-cell').click()`);
  check("a click on the drum grid adds a hit", await until(`document.querySelector('.drum-cell').getAttribute('aria-pressed') === 'true'`));

  const unnamed = await js<number>(`[...document.querySelectorAll('button, [role=application], input, select')].filter(b => !(b.getAttribute('aria-label') || b.textContent.trim() || b.labels?.length)).length`);
  check("every control has an accessible name", unnamed === 0, `${unnamed} without`);

  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Circuit').click()`);
  await until(`!!document.querySelector('.grid .pad')`);
  const motion = await js<string>(`getComputedStyle(document.querySelector('.grid .pad')).transitionDuration`);
  await wc.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await wait(200);
  const reduced = await js<string>(`getComputedStyle(document.querySelector('.grid .pad')).transitionDuration`);
  check("pads animate normally and not under reduced motion", motion.includes("0.09s") && reduced.split(",").every((d) => d.trim() === "0s"), `${motion} → ${reduced}`);
  await wc.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });

  // Tooltips: every control in every view has one; hover shows it after the delay, keyboard focus
  // at once, Escape hides it; it enters with Fast/SmoothOut and without motion under reduced motion.
  const untipped: string[] = [];
  for (const v of ["Circuit", "Editor", "Scenes", "Mixer", "Project", "Patch", "Pack"]) {
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent === '${v}').click()`);
    await wait(600);
    // A screenshot of every view, for comparing the UI before and after a change.
    writeFileSync(path.join(home, `view-${v.toLowerCase()}.png`), (await wc.capturePage()).toPNG());
    untipped.push(...await js<string[]>(`[...document.querySelectorAll('.app button, .app select, .app input, .app [role=application], .app .lane-points')]
      .filter(e => !e.closest('[data-tip]')).map(e => '${v}: ' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30) || e.id || e.tagName)).slice(0, 6)`));
  }
  check("every control has a tooltip", untipped.length === 0, untipped.join(" | "));
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Circuit').click()`);
  await wait(300);
  const tipEl = `document.getElementById('app-tooltip')`;
  const saveBox = await js<{ x: number; y: number }>(`(() => { const r = [...document.querySelectorAll('button')].find(b => b.textContent === 'Save a copy').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  // Record the tooltip's animations the moment it appears (the entry is over in 90 ms).
  await js(`window.__tipAnim = []; new MutationObserver(() => { const t = document.getElementById('app-tooltip'); if (t && !t.hidden) window.__tipAnim.push(t.getAnimations().map(a => a.effect.getTiming().duration + ' ' + a.effect.getKeyframes()[0].easing).join()); }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] })`);
  wc.sendInputEvent({ type: "mouseMove", x: saveBox.x, y: saveBox.y });
  await wait(250);
  const early = await js<boolean>(`${tipEl}.hidden`);
  const earlyText = await js<string>(`${tipEl}.textContent.slice(0, 50) + ' / active: ' + (document.activeElement?.textContent?.slice(0, 20) || document.activeElement?.className)`);
  const shown = await until(`!${tipEl}.hidden && ${tipEl}.textContent.includes('Copies')`, 1500);
  const described = await js<string>(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Save a copy').getAttribute('aria-describedby') ?? 'none'`);
  check("hovering shows a tooltip after the delay, linked to its control", early && shown && described.includes("app-tooltip"), `hidden at 250 ms: ${early} (${earlyText}), shown: ${shown}, aria-describedby: ${described}`);
  await wait(150);
  writeFileSync(path.join(home, "tooltip.png"), (await wc.capturePage()).toPNG());
  const timing = (await js<string[]>(`window.__tipAnim`)).find(Boolean) ?? "none";
  check("the tooltip enters with Fast/SmoothOut", timing === "90 cubic-bezier(0.2, 0, 0, 1)", timing);
  wc.sendInputEvent({ type: "mouseMove", x: 4, y: 4 });
  check("leaving the control hides it", await until(`${tipEl}.hidden`));
  // Focus events only fire in a window that has the system focus.
  win.focus(); wc.focus();
  await wait(200);
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Open…').focus()`);
  await key("Tab");
  check("keyboard focus shows the focused control's tooltip at once", await until(`!${tipEl}.hidden && ${tipEl}.textContent === document.activeElement.closest('[data-tip]')?.dataset.tip`, 300),
    await js<string>(`JSON.stringify({ active: document.activeElement.textContent || document.activeElement.id, focusVisible: document.activeElement.matches(':focus-visible'), hidden: ${tipEl}.hidden, tip: ${tipEl}.textContent.slice(0, 40) })`));
  await key("Escape");
  check("Escape hides it", await until(`${tipEl}.hidden`));
  await wc.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await js(`window.__tipAnim = []`);
  await key("Tab", ["shift"]); await key("Tab");
  await until(`!${tipEl}.hidden`, 500);
  const reducedTiming = await js<string>(`(${tipEl}.hidden ? 'hidden' : 'shown') + ', animation-duration ' + getComputedStyle(${tipEl}).animationDuration + ', running ' + ${tipEl}.getAnimations().filter(a => a.playState === 'running').length`);
  check("under reduced motion the tooltip appears without motion", reducedTiming === "shown, animation-duration 0s, running 0", reducedTiming);
  await key("Escape");
  await wc.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
  wc.debugger.detach();

  // Scenes: store the current chains in scene 2.
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Scenes').click()`);
  await until(`!!document.querySelector('[aria-label^="Scene 2:"]')`);
  await js(`document.querySelector('[aria-label^="Scene 2:"]').click()`);
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Store current chains in scene 2').click()`);
  check("storing the current chains saves scene 2", await until(`document.querySelector('[aria-label^="Scene 2:"]').getAttribute('aria-label').startsWith('Scene 2: saved')`));
  const shot3 = path.join(home, "scenes-view.png");
  writeFileSync(shot3, (await wc.capturePage()).toPNG());

  // Mixer: one keyboard step on a level is one edit; mute marks the strip; both undo.
  const click = (label: string): Promise<unknown> => js(`[...document.querySelectorAll('button')].find(b => b.textContent === '${label}').click()`);
  await click("Mixer");
  check("the Mixer shows a strip per track", await until(`document.querySelectorAll('.strip').length === 8`));
  const level = `document.querySelector('.strip input[type=range]')`;
  const level0 = await js<number>(`+${level}.value`);
  await js(`${level}.focus()`);
  await key("Right");
  check("a key on a level slider saves one edit", await until(`document.querySelector('[role=status]').textContent === 'Edited: Synth 1 level ${level0 + 1}'`),
    await js<string>(`document.querySelector('[role=status]').textContent`));
  await js(`[...document.querySelector('.strip').querySelectorAll('button')].find(b => b.textContent === 'Mute').click()`);
  check("Mute marks the strip silent", await until(`document.querySelector('.strip').dataset.silent === 'true'`));
  await js(`[...document.querySelectorAll('.strip')][4].querySelectorAll('button')[1].click()`);
  check("Solo on Drum 1 silences every other strip", await until(`[...document.querySelectorAll('.strip')].filter(s => s.dataset.silent === 'true').length === 7`));
  writeFileSync(path.join(home, "mixer-view.png"), (await wc.capturePage()).toPNG());
  await js(`[...document.querySelectorAll('.strip')][4].querySelectorAll('button')[1].click()`);
  await js(`[...document.querySelector('.strip').querySelectorAll('button')].find(b => b.textContent === 'Mute').click()`);
  await click("Undo");
  check("Undo puts the level back", await until(`+${level}.value === ${level0}`));

  // Project: the root transposes what the pads and steps show; the keyboard follows the scale.
  await click("Project");
  await until(`!!document.querySelector('.project-settings select')`);
  const pick = (n: number, v: string): Promise<unknown> => js(`(() => { const s = document.querySelectorAll('.project-settings select')[${n}]; s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await pick(0, "2");
  check("choosing root D is an edit", await until(`document.querySelector('[role=status]').textContent === 'Edited: root D'`));
  await pick(1, "1");
  check("choosing Major is an edit", await until(`document.querySelector('[role=status]').textContent === 'Edited: scale Major'`));
  writeFileSync(path.join(home, "project-view.png"), (await wc.capturePage()).toPNG());
  await click("Circuit");
  check("a stored C4 shows as D4 with root D", await until(`${step1}.getAttribute('aria-label').startsWith('Step 1: D4')`), await js<string>(`${step1}.getAttribute('aria-label')`));
  const keyLabels = await js<string[]>(`[...document.querySelectorAll('.pad.key')].slice(8).map(b => b.textContent.replace(' ●', ''))`);
  check("the bottom row of keys climbs D major", keyLabels.join(" ") === "D3 E3 F♯3 G3 A3 B3 C♯4 D4", keyLabels.join(" "));
  writeFileSync(path.join(home, "circuit-scale.png"), (await wc.capturePage()).toPNG());
  await click("Undo"); await click("Undo");
  check("Undo returns to C natural minor", await until(`${step1}.getAttribute('aria-label').startsWith('Step 1: C4') && [...document.querySelectorAll('.pad.key')].slice(8).map(b => b.textContent.replace(' ●', '')).join(' ') === 'C3 D3 D♯3 F3 G3 G♯3 A♯3 C4'`),
    await js<string>(`[...document.querySelectorAll('.pad.key')].slice(8).map(b => b.textContent).join(' ')`));

  // An edit from outside (as the MCP server makes it) shows in the window.
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Circuit').click()`);
  const link = await SocketClient.connect(path.join(home, ".circuit-desk.sock"));
  check("the app serves the MCP link", !!link);
  await link?.call("setSteps", ["p1", "Synth 1", 1, [{ step: 5, notes: [{ note: 72, velocity: 100, gate: 6, micro: 0 }] }]]);
  check("an edit through the link shows in the window", await until(`document.querySelector('[aria-label^="Step 5:"]').getAttribute('aria-pressed') === 'true'`));
  link?.close();

  // Built-in preview: the default output, playing through the engine.
  check("the built-in preview is the default output", (await js<string>(`document.getElementById('midi-out').value`)) === "preview");
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Play')).click()`);
  check("the built-in preview plays (playhead moves, no error)", await until(`!!document.querySelector('.pad[data-playing=true]') && !document.querySelector('[role=alert]')`),
    await js<string>(`document.querySelector('[role=alert]')?.textContent ?? ''`));
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Stop')).click()`);
  await until(`!document.querySelector('[data-playing=true]')`);

  // The pack view lists the pack's samples and plays one.
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Pack').click()`);
  check("the pack view lists the samples and marks the drums that use one", await until(`!!document.querySelector('[aria-label^="Play sample 1, Burst, used by Drum 1"]')`),
    await js<string>(`document.querySelector('.pad.sample')?.getAttribute('aria-label') ?? 'none'`));
  await js(`document.querySelector('[aria-label^="Play sample 1"]').click()`);
  await wait(300);
  check("auditioning a sample plays without an error", !(await js<boolean>(`!!document.querySelector('[role=alert]') || /could not/.test(document.querySelector('.empty')?.textContent ?? '')`)));
  // The pack's synth patches: listed with category and CIRCUIT-HACKS data, and auditioned on the Nova preview.
  check("the pack view lists the synth patches, marking CIRCUIT-HACKS data as kept on the official firmware",
    await until(`!!document.querySelector('[aria-label="Hear patch Initial Patch, Bass, bank 1 slot 1, CIRCUIT-HACKS data, kept"]') && !!document.querySelector('[aria-label="Hear patch Initial Patch, None, bank 1 slot 2"]')`),
    await js<string>(`[...document.querySelectorAll('.pad.patch')].map(b => b.getAttribute('aria-label')).join(' | ') || 'none'`));
  await js(`document.querySelector('[aria-label^="Hear patch Initial Patch, None"]').click()`);
  check("choosing a pack patch selects it and plays without an error",
    await until(`document.querySelector('[aria-label^="Hear patch Initial Patch, None"]').getAttribute('aria-pressed') === 'true'`) && !(await js<boolean>(`!!document.querySelector('[role=alert]')`)),
    await js<string>(`document.querySelector('[role=alert]')?.textContent ?? ''`));

  // Patch editing: a pack patch loads into Synth 2 and opens in the Patch view; pages move with
  // the arrow keys; one keyboard step on a slider is one undoable edit, named by parameter and
  // marked partial; the patch exports as .syx; Play sounds it without an error.
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Edit in Synth 2').click()`);
  check("Edit in Synth 2 loads the pack patch and opens the Patch view",
    await until(`!!document.querySelector('[aria-label="Patch"]') && [...document.querySelectorAll('.patch-head .btn')].find(b => b.textContent === 'Synth 2')?.getAttribute('aria-pressed') === 'true' && document.querySelector('.patch-head input[type=text]')?.value === 'Initial Patch'`),
    await js<string>(`document.querySelector('[role=status]').textContent`));
  await js(`document.getElementById('patch-tab-0').focus()`);
  for (let i = 0; i < 4; i++) await key("Right");
  check("arrow keys move between the patch pages", await until(`document.getElementById('patch-tab-4')?.getAttribute('aria-selected') === 'true' && document.activeElement?.id === 'patch-tab-4'`),
    await js<string>(`document.activeElement?.id ?? 'none'`));
  const freq = `[...document.querySelectorAll('#patch-page label.slider')].find(l => l.textContent.startsWith('Frequency')).querySelector('input')`;
  await js(`${freq}.focus()`);
  await key("Left");
  check("one keyboard step on a patch slider is one edit", await until(`document.querySelector('[role=status]').textContent.includes('Synth 2 Filter frequency 126')`),
    await js<string>(`document.querySelector('[role=status]').textContent`));
  const patchLink = await SocketClient.connect(path.join(home, ".circuit-desk.sock"));
  const patchDiff = (await patchLink?.call("diffVsOriginal", ["p1"])) as { field: string; status: string }[] | undefined;
  patchLink?.close();
  check("the edit is named by parameter and marked partial", !!patchDiff?.some((r) => r.field === "Synth 2 patch: filter.frequency" && r.status === "partial"),
    JSON.stringify(patchDiff?.filter((r) => r.field.includes("patch"))));
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Export .syx').click()`);
  const syxPath = path.join(home, "Exports", "01_Smoke", "Synth 2 - Initial Patch.syx");
  check("Export .syx writes the patch as a 350-byte message", await until(`document.querySelector('[role=status]').textContent.includes('.syx')`) && (() => { try { return readFileSync(syxPath).length === 350; } catch { return false; } })(),
    await js<string>(`document.querySelector('[role=status]').textContent`));
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Play C3')).click()`);
  await wait(400);
  check("Play C3 sounds the edited patch without an error", !(await js<boolean>(`!!document.querySelector('[role=alert]')`)), await js<string>(`document.querySelector('[role=alert]')?.textContent ?? ''`));
  // Back to Synth 1, which later checks use.
  await js(`[...document.querySelectorAll('.patch-head .btn')].find(b => b.textContent === 'Synth 1').click()`);
  await until(`[...document.querySelectorAll('.patch-head .btn')].find(b => b.textContent === 'Synth 1')?.getAttribute('aria-pressed') === 'true'`);

  // Export Preview Audio: the rendered WAV has the burst at step 1 and silence between hits.
  menuClick("Export Preview Audio");
  check("Export Preview Audio writes a WAV", await until(`document.querySelector('[role=status]').textContent.includes('(preview).wav')`, 15_000), await js<string>(`document.querySelector('[role=status]').textContent`));
  const wavPath = path.join(home, "Exports", "01_Smoke", "01_Smoke (preview).wav");
  const wav = readFileSync(wavPath);
  const ch = wav.readUInt16LE(22), frames = (wav.length - 44) / (2 * ch);
  const at = (sec: number): number => { let peak = 0; const a = Math.floor(sec * 48_000), b = Math.min(frames, a + 480); for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + i * ch * 2)) / 32768); return peak; };
  check("the preview WAV sounds at step 1", at(0) > 0.05, `peak ${at(0).toFixed(3)}`);
  const seconds = frames / 48_000, expected = 16 * 0.125 + 1.5; // 16 steps at 120 BPM, plus the render tail
  check("the preview WAV is the pattern's length plus the tail", Math.abs(seconds - expected) < 0.01, `${seconds.toFixed(3)} s`);
  check("every note has ended by the end of the WAV", at(seconds - 0.02) < 0.005, `peak at the end ${at(seconds - 0.02).toFixed(4)}`);

  // Effects: the FX switch is on by default; off renders every track dry at unity (no level 100, no pan).
  const fxBtn = `[...document.querySelectorAll('button')].find(b => /^FX (on|off)$/.test(b.textContent))`;
  check("the FX switch is on by default", (await js<string>(`${fxBtn}?.textContent ?? ''`)) === "FX on");
  const peakStart = (buf: Buffer): number => { const c = buf.readUInt16LE(22); let p = 0; for (let i = 0; i < 480; i++) p = Math.max(p, Math.abs(buf.readInt16LE(44 + i * c * 2)) / 32768); return p; };
  const peakOn = peakStart(wav), wavTime = statSync(wavPath).mtimeMs;
  await js(`${fxBtn}.click()`);
  check("the FX switch turns off and says so", await until(`${fxBtn}.textContent === 'FX off' && ${fxBtn}.getAttribute('aria-pressed') === 'false'`));
  menuClick("Export Preview Audio");
  for (let i = 0; i < 150 && statSync(wavPath).mtimeMs === wavTime; i++) await wait(100);
  await wait(300);
  const peakOff = peakStart(readFileSync(wavPath));
  check("with FX off the preview is the dry mix (louder than level 100 with FX on)", peakOff > peakOn * 1.1, `on ${peakOn.toFixed(3)}, off ${peakOff.toFixed(3)}`);
  await js(`${fxBtn}.click()`);

  // Playback through the fake output.
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Circuit').click()`);
  await until(`!!document.querySelector('.grid .pad')`);
  await js(`(() => { const s = document.getElementById('midi-out'); s.value = 'fake'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(200);
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Play')).click()`);
  check("Play sends the pattern's notes with timestamps", await until(`window.__sent.some(m => m.bytes[0] === 0x90 && m.bytes[1] === 60 && m.at > 0)`), JSON.stringify(await js(`window.__sent.slice(0, 3)`)));
  check("the playhead shows on the grid", await until(`!!document.querySelector('.pad[data-playing=true]')`));
  check("Synth 1's macro lane goes to the Circuit as CC 80 on channel 1, with timestamps", await until(`window.__sent.some(m => m.bytes[0] === 0xb0 && m.bytes[1] === 80 && m.at > 0)`),
    JSON.stringify(await js(`window.__sent.filter(m => (m.bytes[0] & 0xf0) === 0xb0).slice(0, 4)`)));
  check("Drum 1's pan lane goes as CC 77 on channel 10", await until(`window.__sent.some(m => m.bytes[0] === 0xb9 && m.bytes[1] === 77 && m.bytes[2] === 0)`));
  check("no empty message reaches the MIDI output", await js<boolean>(`window.__sent.every(m => m.bytes.length > 0)`));
  // Cells read like the device: velocity bar on lit steps, C keys marked, used pitches tinted.
  const bar = await js<string>(`getComputedStyle(document.querySelector('.grid .pad[data-on=true]'), '::after').content`);
  check("a lit step shows its velocity as a bar", bar !== "none" && bar !== "normal" && bar !== "", bar);
  const keyColours = await js<string[]>(`(() => { const bg = (e) => getComputedStyle(e).backgroundColor; const bd = (e) => getComputedStyle(e).borderColor;
    const root = document.querySelector('.pad.key[data-root=true][data-used=false]'), plain = document.querySelector('.pad.key[data-root=false][data-used=false][data-black=false]'), used = document.querySelector('.pad.key[data-used=true][data-root=false]');
    return [root ? bd(root) : 'none', plain ? bd(plain) : 'none', used ? bg(used) : 'none', plain ? bg(plain) : 'none']; })()`);
  check("C keys have their own border, and the pitches a pattern uses are tinted", keyColours[0] !== keyColours[1] && keyColours[2] !== keyColours[3], keyColours.join(" | "));
  // What plays: changing it while playing starts the chosen part, and the pattern pad shows it.
  const chooseFrom = (v: string): Promise<unknown> => js(`(() => { const s = document.getElementById('play-from'); s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await js(`window.__sent.length = 0`);
  await chooseFrom("scene:2");
  check("choosing a scene while playing plays it", await until(`document.getElementById('play-from').value === 'scene:2' && window.__sent.some(m => m.bytes[0] === 0x90) && !document.querySelector('[role=alert]')`),
    await js<string>(`document.querySelector('[role=alert]')?.textContent ?? ''`));
  await chooseFrom("pattern:1");
  check("choosing a pattern plays it on every track and marks its pad", await until(`!!document.querySelector('.pattern-pad[data-playing=true]') && !document.querySelector('[role=alert]')`),
    await js<string>(`document.querySelector('[role=alert]')?.textContent ?? ''`));
  await chooseFrom("current");
  const shotPlaying = path.join(home, "playing.png");
  writeFileSync(shotPlaying, (await wc.capturePage()).toPNG());
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Stop')).click()`);
  check("Stop sends All Notes Off and clears the playhead", await until(`window.__sent.some(m => m.bytes[0] === 0xb0 && m.bytes[1] === 123) && !document.querySelector('[data-playing=true]')`));
  const sysex = await js<number>(`window.__sent.filter(m => m.bytes[0] === 0xf0).length`);
  check("no SysEx is ever sent", sysex === 0);

  // Firmware: defaults to Novation official; a choice is remembered and reported.
  const setSelect = (id: string, v: string): Promise<unknown> => js(`(() => { const s = document.getElementById('${id}'); s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check("the firmware is Novation official by default", (await js<string>(`document.getElementById('firmware').value`)) === "official");
  await setSelect("firmware", "circuit-hacks");
  check("choosing CIRCUIT-HACKS is remembered and reported", await until(`localStorage.getItem('circuit-desk.firmware') === 'circuit-hacks' && document.querySelector('[role=status]').textContent.includes('Firmware: CIRCUIT-HACKS')`),
    await js<string>(`document.querySelector('[role=status]').textContent`));
  await setSelect("firmware", "official");
  await until(`localStorage.getItem('circuit-desk.firmware') === 'official'`);

  // Keys: the computer keyboard plays Synth 1 on the chosen output (the fake port: channel 1).
  await js(`[...document.querySelectorAll('[role=radio]')].find(b => b.textContent.includes('Synth 1'))?.click()`);
  const keysBtn = `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Keys'))`;
  const editsBefore = await js<string>(`document.querySelector('.project-name').textContent`);
  await js(`window.__sent.length = 0; ${keysBtn}.click()`);
  check("Keys turns on and says what it plays", await until(`${keysBtn}.getAttribute('aria-pressed') === 'true' && document.querySelector('.keys-status').textContent.includes('Keys: Synth 1')`),
    await js<string>(`document.querySelector('.keys-status').textContent`));
  const tap = async (k: string): Promise<void> => { wc.sendInputEvent({ type: "keyDown", keyCode: k }); await wait(80); wc.sendInputEvent({ type: "keyUp", keyCode: k }); await wait(80); };
  await tap("A");
  check("A plays C3 (60) on Synth 1's channel and releases it", await until(`window.__sent.some(m => m.bytes[0] === 0x90 && m.bytes[1] === 60 && m.bytes[2] === 100) && window.__sent.some(m => m.bytes[0] === 0x80 && m.bytes[1] === 60)`),
    JSON.stringify(await js(`window.__sent`)));
  await tap("X"); await tap("V"); await tap("W");
  check("X raises the octave and V the velocity (W = C#4 at 120)", await until(`window.__sent.some(m => m.bytes[0] === 0x90 && m.bytes[1] === 73 && m.bytes[2] === 120)`),
    JSON.stringify(await js(`window.__sent.slice(-2)`)));
  check("playing keys does not edit the project", (await js<string>(`document.querySelector('.project-name').textContent`)) === editsBefore);
  await tap("Escape");
  check("Esc turns Keys off and nothing is left sounding", await until(`${keysBtn}.getAttribute('aria-pressed') === 'false'`)
    && (await js<number>(`window.__sent.filter(m => m.bytes[0] === 0x90).length - window.__sent.filter(m => m.bytes[0] === 0x80).length`)) === 0);
  // On the built-in preview, keys play the Nova worklet without an error.
  await setSelect("midi-out", "preview");
  await js(`${keysBtn}.click()`);
  await tap("A");
  check("Keys on the built-in preview play without an error", await until(`document.querySelector('.keys-status').textContent.includes('preview')`) && !(await js<boolean>(`!!document.querySelector('[role=alert]')`)),
    await js<string>(`document.querySelector('[role=alert]')?.textContent ?? document.querySelector('.keys-status').textContent`));
  await tap("Escape");

  // Sound report: the last seconds of audio with the events that made them, saved under Exports/Reports.
  menuClick("Capture Last 10 Seconds (Sound Report)");
  const captured = await until(`document.querySelector('[role=status]').textContent.includes('Saved a sound report')`, 8000);
  const reportsDir = path.join(home, "Exports", "Reports");
  const reportDir = captured ? readdirSync(reportsDir).map((d) => path.join(reportsDir, d))[0] : undefined;
  const report = reportDir ? JSON.parse(readFileSync(path.join(reportDir, "report.json"), "utf8")) as { events: { source: string; route?: string; bytes: number[]; offset: number }[]; audio: { frames: number } } : null;
  const keyNote = report?.events.find((e) => e.source === "keys" && e.route === "preview" && e.bytes[0] === 0x90);
  check("Capture saves the audio and the events that made it", !!report && report.audio.frames > 0 && !!keyNote && keyNote.offset > 0,
    `${await js<string>(`document.querySelector('[role=status]').textContent`)} | ${report ? `${report.events.length} events, ${report.audio.frames} frames` : "no report"}`);
  if (reportDir) console.log(`sound report: ${reportDir}`);

  const shot = path.join(home, "circuit-view.png");
  writeFileSync(shot, (await wc.capturePage()).toPNG());
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Editor').click()`);
  await wait(400);
  const shot2 = path.join(home, "editor-view.png");
  writeFileSync(shot2, (await wc.capturePage()).toPNG());
  console.log(results.join("\n"));
  console.log(`screenshots: ${shot} ${shot2} ${shotPlaying} ${shot3}`);
  console.log(`view screenshots: ${home}/view-*.png`);
}

void app.whenReady().then(() => setTimeout(() => {
  run().catch((e: unknown) => { console.error(e); failed = true; }).finally(() => { if (failed) console.log(results.join("\n")); app.exit(failed ? 1 : 0); });
}, 300));
