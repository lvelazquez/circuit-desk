// Writes the patch parameter table (public parameter names, ranges and CC/NRPN numbers, from
// packages/patch) as JSON, so the Python firmware tools can sweep each one.
// Usage: node tools/export-params.ts <out.json>
import { writeFileSync } from "node:fs";
import { PATCH_PARAMS } from "@circuit-desk/patch";

const out = process.argv[2];
if (!out) throw new Error("usage: export-params.ts <out.json>");
const rows = PATCH_PARAMS.filter((p) => !p.reserved).map((p) => ({
  id: p.id, address: p.address, section: p.section, min: p.min, max: p.max, default: p.default,
  cc: p.controller && "cc" in p.controller ? p.controller.cc : null,
  nrpn: p.controller && "nrpn" in p.controller ? p.controller.nrpn : null,
}));
writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(`${rows.length} parameters, ${rows.filter((r) => r.cc !== null).length} with a CC, ${rows.filter((r) => r.nrpn !== null).length} with an NRPN`);
