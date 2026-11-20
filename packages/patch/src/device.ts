// Read-only device checks (plan Track 3, D-8): the only bytes a device script may send, the fwid
// reply parser, and the byte-by-byte comparison of a dumped patch with the project file's patch.
// Pure: nothing here opens a port. app/scripts/device-dump.ts sends only through `assertAllowedSend`.
import { PATCH_PARAMS, PATCH_SIZE, type PatchParam } from "./format.ts";
import { dumpRequestMessage } from "./sysex.ts";

/** Synth 1's patch inside a project file (packages/ncs layout PATCH0); Synth 2 follows it. */
export const PROJECT_PATCH0 = 0x26d14;

/**
 * Firmware identity query (circuit-hacks-rc tools/fwid.py:5-6): F0 7D 43 54 00 seq 00×7 F7, seq 0x23.
 * A Hacks build answers F0 7D 43 54 40 seq 01 m0..m5 F7; the stock firmware answers nothing.
 */
export const FWID_SEQ = 0x23;
export const FWID_QUERY: Uint8Array = Uint8Array.from([0xf0, 0x7d, 0x43, 0x54, 0x00, FWID_SEQ, 0, 0, 0, 0, 0, 0, 0, 0xf7]);

/** Every message a device script may send. Exact bytes only: no prefixes, no variants. */
export const ALLOWED_DEVICE_MESSAGES: readonly { name: string; bytes: readonly number[] }[] = [
  { name: "dump request Synth 1", bytes: [...dumpRequestMessage(0)] },
  { name: "dump request Synth 2", bytes: [...dumpRequestMessage(1)] },
  { name: "fwid query", bytes: [...FWID_QUERY] },
];

/** The allowed message these bytes are, or null. */
export function allowedDeviceMessage(bytes: ArrayLike<number>): string | null {
  for (const m of ALLOWED_DEVICE_MESSAGES) {
    if (bytes.length !== m.bytes.length) continue;
    let same = true;
    for (let i = 0; i < bytes.length && same; i++) same = bytes[i] === m.bytes[i];
    if (same) return m.name;
  }
  return null;
}

export function isAllowedDeviceMessage(bytes: ArrayLike<number>): boolean {
  return allowedDeviceMessage(bytes) !== null;
}

/** Throws unless `bytes` is exactly one of ALLOWED_DEVICE_MESSAGES; returns its name. */
export function assertAllowedSend(bytes: ArrayLike<number>): string {
  const name = allowedDeviceMessage(bytes);
  if (!name) throw new Error(`refused to send ${hex(bytes)}: not on the device allowlist (dump request Synth 1/2, fwid query)`);
  return name;
}

export function hex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

export interface FwidReply {
  seq: number;
  format: number;
  /** The 6 marker bytes, and as text up to the first 0 (e.g. "B5.47"). */
  marker: number[];
  text: string;
}

/** Parses a fwid reply (F0 7D 43 54 40 seq 01 m0..m5 F7), or returns null. */
export function parseFwidReply(m: ArrayLike<number>): FwidReply | null {
  if (m.length !== 14 || m[0] !== 0xf0 || m[1] !== 0x7d || m[2] !== 0x43 || m[3] !== 0x54 || m[4] !== 0x40 || m[13] !== 0xf7) return null;
  const marker = Array.from({ length: 6 }, (_, i) => m[7 + i]!);
  const end = marker.indexOf(0);
  return { seq: m[5]!, format: m[6]!, marker, text: String.fromCharCode(...(end < 0 ? marker : marker.slice(0, end))) };
}

/** Synth n's patch (0 = Synth 1) inside a project file. */
export function projectPatch(file: Uint8Array, synth: 0 | 1): Uint8Array {
  const at = PROJECT_PATCH0 + PATCH_SIZE * synth;
  if (file.length < at + PATCH_SIZE) throw new Error(`the file is ${file.length} bytes, too short for Synth ${synth + 1}'s patch at 0x${at.toString(16)}`);
  return file.slice(at, at + PATCH_SIZE);
}

export interface PatchDifference {
  /** Address inside the 340-byte patch. */
  address: number;
  file: number;
  device: number;
  /** The parameter at this address (PATCH_PARAMS id), "name[i]" for the name bytes, or null. */
  param: string | null;
}

const PARAM_AT: ReadonlyMap<number, PatchParam> = new Map(PATCH_PARAMS.map((p) => [p.address, p]));

function paramAt(address: number): string | null {
  const p = PARAM_AT.get(address);
  if (p) return p.id;
  if (address < 16) return `name[${address}]`;
  return null;
}

/** Every address where the device's patch differs from the file's. Empty: byte-identical. */
export function comparePatches(file: Uint8Array, device: Uint8Array): PatchDifference[] {
  if (file.length !== PATCH_SIZE || device.length !== PATCH_SIZE) throw new Error(`patches are ${PATCH_SIZE} bytes (got ${file.length} and ${device.length})`);
  const out: PatchDifference[] = [];
  for (let a = 0; a < PATCH_SIZE; a++) if (file[a] !== device[a]) out.push({ address: a, file: file[a]!, device: device[a]!, param: paramAt(a) });
  return out;
}

/** One line per difference, or "identical". */
export function describeDifferences(d: readonly PatchDifference[]): string {
  if (!d.length) return "identical (340 bytes)";
  return [`${d.length} byte${d.length === 1 ? "" : "s"} differ:`, ...d.map((x) => `  0x${x.address.toString(16).padStart(3, "0")} (${x.address}) ${x.param ?? "unnamed"}: file ${x.file}, device ${x.device}`)].join("\n");
}
