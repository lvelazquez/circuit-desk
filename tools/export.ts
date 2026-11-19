// Exports Circuit Tracks projects as a multitrack MIDI file and an Ableton Live 12 set.
// Usage: node tools/export.ts <project.ncs>... [--out <dir>] [--current] [--repeats N] [--no-arrangement] [--no-instruments]
// Output goes to ~/Circuit Desk/Exports/<project file name>/ unless --out is given. Never writes beside the input.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { openProject } from "../packages/ncs/src/index.ts";
import { arrange, loadLiveTemplates, writeAls, writeSmf } from "../packages/export/src/index.ts";

const args = process.argv.slice(2);
const flag = (name: string): boolean => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const option = (name: string): string | undefined => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = option("--out") ?? join(homedir(), "Circuit Desk", "Exports");
const repeats = Number(option("--repeats") ?? 1);
const current = flag("--current");
const arrangement = !flag("--no-arrangement");
const instruments = flag("--no-instruments") ? "none" as const : "live" as const;
if (!args.length) { console.error("usage: node tools/export.ts <project.ncs>... [--out <dir>] [--current] [--repeats N] [--no-arrangement] [--no-instruments]"); process.exit(2); }

const tpl = loadLiveTemplates();
for (const file of args) {
  const project = openProject(new Uint8Array(readFileSync(file)));
  const a = arrange(project, { repeats, ...(current ? { source: "current" as const } : {}) });
  const stem = basename(file).replace(/\.ncs$/i, "");
  const dir = join(out, stem);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stem}.mid`), writeSmf(a));
  const hasNotes = a.tracks.some((t) => t.notes.length);
  if (hasNotes) writeFileSync(join(dir, `${stem}.als`), writeAls(a, tpl, { arrangement, instruments }));
  const bars = a.length / a.ppq / 4;
  const report = [
    `${a.name}: ${a.bpm} BPM, ${a.scenes.length} section(s), ${bars} bars`,
    ...a.tracks.filter((t) => t.notes.length).map((t) => `  ${t.name} (ch ${t.channel + 1}): ${t.notes.length} notes`),
    ...a.warnings.map((w) => `  note: ${w}`),
    hasNotes ? "" : "  no notes: no Live set written",
  ].join("\n");
  writeFileSync(join(dir, "export.txt"), report + "\n");
  console.log(`${dir}\n${report}`);
}
