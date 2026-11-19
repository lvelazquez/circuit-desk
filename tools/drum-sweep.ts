// Read-only: value profile of the drum block (4 × 11 B at 0x26FBC) and the 60 B project params (0x26FE8).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: drum-sweep.ts <Tracks dir>");
const cols: number[][] = Array.from({ length: 11 }, () => []);
const pp: number[][] = Array.from({ length: 60 }, () => []);
for (const pack of readdirSync(root)) {
  const s = join(root, pack, "Sessions");
  if (!existsSync(s)) continue;
  for (const f of readdirSync(s).filter((n) => n.endsWith(".ncs"))) {
    const b = readFileSync(join(s, f));
    for (let d = 0; d < 4; d++) for (let i = 0; i < 11; i++) cols[i]!.push(b[0x26fbc + d * 11 + i]!);
    for (let i = 0; i < 60; i++) pp[i]!.push(b[0x26fe8 + i]!);
  }
}
const sum = (v: number[]): string => {
  const c = new Map<number, number>();
  for (const x of v) c.set(x, (c.get(x) ?? 0) + 1);
  const top = [...c].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k}×${n}`).join(" ");
  return `min ${Math.min(...v)} max ${Math.max(...v)} distinct ${c.size} top ${top}`;
};
cols.forEach((v, i) => console.log(`drum +${i}: ${sum(v)}`));
pp.forEach((v, i) => console.log(`proj +${i}: ${sum(v)}`));
