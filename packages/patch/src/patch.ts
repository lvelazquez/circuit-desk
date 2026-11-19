// A synth patch as data: its name plus one value per parameter id. Parsing keeps the original bytes,
// and building writes only what changed, so an edit never disturbs bytes we do not model.
import { DEFAULT_NAME, NAME_LEN, PATCH_PARAMS, PATCH_SIZE, param } from "./format.ts";

export interface Patch {
  name: string;
  /** Raw byte per parameter id (see PATCH_PARAMS). */
  values: Record<string, number>;
}

export class PatchError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(problems.join("; "));
    this.name = "PatchError";
    this.problems = problems;
  }
}

/**
 * The 16-byte name, trailing spaces removed. Zero bytes count as spaces (an empty name); other bytes
 * outside printable ASCII are shown as "?".
 */
export function patchName(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < NAME_LEN; i++) {
    const c = bytes[i] ?? 32;
    s += c === 0 ? " " : c >= 32 && c <= 126 ? String.fromCharCode(c) : "?";
  }
  return s.trimEnd();
}

export function parsePatch(bytes: Uint8Array): Patch {
  if (bytes.length < PATCH_SIZE) throw new PatchError([`a patch is ${PATCH_SIZE} bytes, got ${bytes.length}`]);
  const values: Record<string, number> = {};
  for (const p of PATCH_PARAMS) values[p.id] = bytes[p.address]!;
  return { name: patchName(bytes), values };
}

/** Problems with a patch's values and name; empty when it is valid. Reserved bytes are not judged. */
export function patchProblems(patch: Patch): string[] {
  const out: string[] = [];
  if (patch.name.length > NAME_LEN) out.push(`name is longer than ${NAME_LEN} characters`);
  if (!/^[\x20-\x7e]*$/.test(patch.name)) out.push("name must be printable ASCII");
  for (const [id, v] of Object.entries(patch.values)) {
    const p = param(id);
    if (p.reserved) continue;
    if (!Number.isInteger(v) || v < p.min || v > p.max) out.push(`${id} = ${v} is outside ${p.min}–${p.max}`);
  }
  return out;
}

/**
 * Writes `patch` over a copy of `base` (the patch's original 340 bytes). Only bytes whose value
 * changed are written; a name is rewritten only when it changed. Throws PatchError on bad values.
 */
export function buildPatch(patch: Patch, base: Uint8Array): Uint8Array {
  const problems = patchProblems(patch);
  if (problems.length) throw new PatchError(problems);
  const out = base.slice(0, PATCH_SIZE);
  if (patch.name !== patchName(base)) {
    const padded = patch.name.padEnd(NAME_LEN, " ");
    for (let i = 0; i < NAME_LEN; i++) out[i] = padded.charCodeAt(i);
  }
  for (const [id, v] of Object.entries(patch.values)) {
    const p = param(id);
    if (p.reserved) continue;
    out[p.address] = v;
  }
  return out;
}

/** The guide's default patch ("Initial Patch"): a synthetic fixture with no pack data in it. */
export function initPatchBytes(): Uint8Array {
  const b = new Uint8Array(PATCH_SIZE);
  const name = DEFAULT_NAME.padEnd(NAME_LEN, " ");
  for (let i = 0; i < NAME_LEN; i++) b[i] = name.charCodeAt(i);
  for (const p of PATCH_PARAMS) b[p.address] = p.default;
  return b;
}

export function initPatch(): Patch {
  return parsePatch(initPatchBytes());
}

/** Returns a copy of `patch` with some values changed (ids are checked). */
export function withValues(patch: Patch, changes: Readonly<Record<string, number>>): Patch {
  for (const id of Object.keys(changes)) param(id);
  return { name: patch.name, values: { ...patch.values, ...changes } };
}
