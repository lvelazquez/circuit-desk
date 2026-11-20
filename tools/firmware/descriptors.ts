// Read-only: prints the stock firmware's parameter descriptors for the drum store (type 0x10) and the
// project store (type 0x20): where each parameter sits in the saved blob, its maximum and its CC.
// Entry layout (circuit-hacks-rc docs/NOTAS.md, "Estudio 2026-10-04"): 8 bytes,
// u16 offset, u8 type, s8, s8, u8 max, u8, u8 CC. Table addresses from the same section.
// Usage: node tools/firmware/descriptors.ts [stock.bin] [count]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BIN = process.argv[2] ?? join(homedir(), "Personal Repo", "circuit-hacks-rc", "stock", "circuittracks-firmware-4486-STOCK.bin");
const COUNT = Number(process.argv[3] ?? 64);
const BASE = 0x08010000;
const img = readFileSync(BIN);

const TABLES = [
  { name: "drums (type 0x10, 44 B)", at: 0x08058fa0, size: 44 },
  { name: "project (type 0x20, 60 B)", at: 0x08057ad0, size: 60 },
];

for (const t of TABLES) {
  console.log(`\n${t.name} @ 0x${t.at.toString(16)}`);
  console.log("index  offset  type  b3   b4   max  b6   cc");
  for (let i = 0; i < COUNT; i++) {
    const o = t.at - BASE + 8 * i;
    const off = img.readUInt16LE(o), type = img[o + 2]!, b3 = img.readInt8(o + 3), b4 = img.readInt8(o + 4), max = img[o + 5]!, b6 = img[o + 6]!, cc = img[o + 7]!;
    if (off >= t.size && i > 0) { console.log(`(entry ${i}: offset ${off} is past the ${t.size}-byte blob: end of table)`); break; }
    console.log(`${String(i).padStart(5)}  ${String(off).padStart(6)}  0x${type.toString(16).padStart(2, "0")}  ${String(b3).padStart(4)} ${String(b4).padStart(4)}  ${String(max).padStart(3)}  ${String(b6).padStart(3)}  ${cc === 0xff ? "  –" : String(cc).padStart(3)}`);
  }
}
