// Read-only: arranges every project in a card copy and counts its automation changes by kind, and
// how many of them reach a Circuit as CC. Usage: node tools/automation-survey.ts <folder with Tracks/>
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { openProject } from "@circuit-desk/ncs";
import { arrange } from "@circuit-desk/export";

const root = process.argv[2];
if (!root) throw new Error("usage: automation-survey.ts <folder that contains Tracks/>");
const walk = (d: string, o: string[] = []): string[] => {
  for (const n of readdirSync(d).sort()) { if (n.startsWith(".")) continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p, o); else if (/\.ncs$/i.test(n)) o.push(p); }
  return o;
};
const kinds = new Map<string, { events: number; withCc: number; projects: Set<string> }>();
let projects = 0, failed = 0;
for (const f of walk(join(root, "Tracks"))) {
  projects++;
  try {
    const a = arrange(openProject(new Uint8Array(readFileSync(f))), { source: "current" });
    a.tracks.forEach((t) => {
      for (const e of t.auto) {
        const k = `${t.name}: ${e.target}`;
        const row = kinds.get(k) ?? { events: 0, withCc: 0, projects: new Set<string>() };
        row.events++; if (e.cc) row.withCc++; row.projects.add(f);
        kinds.set(k, row);
      }
    });
  } catch (e) { failed++; console.log(`FAILED ${f}: ${(e as Error).message}`); }
}
console.log(`${projects} projects, ${failed} failed. Automation changes in the current patterns, by track and target:`);
for (const [k, r] of [...kinds].sort((a, b) => b[1].events - a[1].events)) console.log(`  ${k.padEnd(26)} ${String(r.events).padStart(6)} changes in ${String(r.projects.size).padStart(3)} projects, ${r.withCc === r.events ? "all" : r.withCc} with a CC`);
