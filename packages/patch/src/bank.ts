// Pack patch banks: Tracks/NN_Pack/Patches/NN_PATCHBANK.cpb.
// Up to 8 records at a stride of 512 B: a 340 B patch, then 172 B of padding. The last record of a
// file usually has no padding (3 924 B = 7 × 512 + 340 on the card copy). CIRCUIT-HACKS keeps its
// MIDI 1/2 own-synth patch in the padding (a "CTM1" record, patchtool.py:27-33) and FM-8 records
// after byte 4 096 (sd_app.html:509-526). We change only the 340 B of a patch and keep the rest.
import { PATCH_SIZE } from "./format.ts";
import { patchName } from "./patch.ts";

export const RECORD = 512;
export const RECORDS = 8;

/** What follows a patch inside its record. */
export type PaddingKind =
  /** The file ends after the patch. */
  | "none"
  /** Stock filler, all 0xFF. */
  | "empty"
  /** A CIRCUIT-HACKS own-synth record, magic "CTM1". */
  | "ctm1"
  | "other";

export interface BankRecord {
  index: number;
  offset: number;
  name: string;
  /** A copy of the 340 B patch. */
  patch: Uint8Array;
  padding: PaddingKind;
}

export function paddingKind(pad: Uint8Array): PaddingKind {
  if (pad.length === 0) return "none";
  if (pad.every((b) => b === 0xff)) return "empty";
  if (pad.length >= 4 && pad[0] === 0x43 && pad[1] === 0x54 && pad[2] === 0x4d && pad[3] === 0x31) return "ctm1";
  return "other";
}

export function readBank(file: Uint8Array): BankRecord[] {
  const out: BankRecord[] = [];
  for (let i = 0; i < RECORDS; i++) {
    const offset = i * RECORD;
    if (offset + PATCH_SIZE > file.length) break;
    const patch = file.slice(offset, offset + PATCH_SIZE);
    const padEnd = Math.min(offset + RECORD, file.length);
    out.push({ index: i, offset, name: patchName(patch), patch, padding: paddingKind(file.subarray(offset + PATCH_SIZE, padEnd)) });
  }
  return out;
}

/** A copy of the bank file with record `index`'s patch replaced; every other byte is kept. */
export function writeBankPatch(file: Uint8Array, index: number, patch: Uint8Array): Uint8Array {
  if (patch.length !== PATCH_SIZE) throw new Error(`a patch is ${PATCH_SIZE} bytes, got ${patch.length}`);
  const offset = index * RECORD;
  if (!Number.isInteger(index) || index < 0 || index >= RECORDS || offset + PATCH_SIZE > file.length) {
    throw new Error(`the bank has no record ${index}`);
  }
  const out = file.slice();
  out.set(patch, offset);
  return out;
}
