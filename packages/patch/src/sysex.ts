// Patch SysEx messages (Programmer's Reference Guide v3, pp. 13–14). This module only builds and
// parses bytes; sending anything to a device is a separate, approval-gated step.
//   F0 00 20 29 01 64 <command> <location / patch number> [00 <340 B>] F7
import { PATCH_SIZE } from "./format.ts";

const HEADER = [0xf0, 0x00, 0x20, 0x29, 0x01, 0x64] as const;
export const COMMAND_REPLACE_CURRENT = 0x00;
export const COMMAND_REPLACE_PATCH = 0x01;
export const COMMAND_DUMP_REQUEST = 0x40;
/** A "replace" message: header (6) + command + location + reserved + 340 + F7. */
export const PATCH_MESSAGE_SIZE = 350;

export type Location = 0 | 1;

function patchMessage(command: number, slot: number, patch: Uint8Array): Uint8Array {
  if (patch.length !== PATCH_SIZE) throw new Error(`a patch is ${PATCH_SIZE} bytes, got ${patch.length}`);
  if (patch.some((b) => b > 0x7f)) throw new Error("patch bytes must be 7-bit for SysEx");
  const m = new Uint8Array(PATCH_MESSAGE_SIZE);
  m.set(HEADER, 0);
  m[6] = command;
  m[7] = slot;
  m[8] = 0;
  m.set(patch, 9);
  m[PATCH_MESSAGE_SIZE - 1] = 0xf7;
  return m;
}

/** "Replace current patch" for Synth 1 (0) or 2 (1). A single-patch .syx file is this message with location 0. */
export function replaceCurrentPatchMessage(patch: Uint8Array, location: Location = 0): Uint8Array {
  return patchMessage(COMMAND_REPLACE_CURRENT, location, patch);
}

/** "Replace patch" n (0–63) in flash. Built only for bank .syx files; never sent by this app. */
export function replacePatchMessage(patch: Uint8Array, n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 63) throw new Error(`patch number ${n} is outside 0–63`);
  return patchMessage(COMMAND_REPLACE_PATCH, n, patch);
}

/** "Current patch dump request" (read-only on the device): the answer is a replace-current message. */
export function dumpRequestMessage(location: Location): Uint8Array {
  return Uint8Array.from([...HEADER, COMMAND_DUMP_REQUEST, location, 0xf7]);
}

export interface PatchMessage {
  command: typeof COMMAND_REPLACE_CURRENT | typeof COMMAND_REPLACE_PATCH;
  /** Location (0/1) for replace-current, patch number for replace-patch. */
  slot: number;
  patch: Uint8Array;
}

/** Parses one replace message, or returns null when `m` is not one. */
export function parsePatchMessage(m: Uint8Array): PatchMessage | null {
  if (m.length !== PATCH_MESSAGE_SIZE || m[PATCH_MESSAGE_SIZE - 1] !== 0xf7) return null;
  for (let i = 0; i < HEADER.length; i++) if (m[i] !== HEADER[i]) return null;
  const command = m[6];
  if (command !== COMMAND_REPLACE_CURRENT && command !== COMMAND_REPLACE_PATCH) return null;
  return { command, slot: m[7]!, patch: m.slice(9, 9 + PATCH_SIZE) };
}

/** Splits a .syx file into its patch messages (single patch: 1; bank: 64). Other messages are skipped. */
export function readSyx(file: Uint8Array): PatchMessage[] {
  const out: PatchMessage[] = [];
  let start = -1;
  for (let i = 0; i < file.length; i++) {
    if (file[i] === 0xf0) start = i;
    else if (file[i] === 0xf7 && start >= 0) {
      const msg = parsePatchMessage(file.subarray(start, i + 1));
      if (msg) out.push(msg);
      start = -1;
    }
  }
  return out;
}
