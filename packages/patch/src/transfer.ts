// Read-only file transfer from a Circuit Tracks: list the packs and their files, and download one.
// The protocol is Components' own, captured 2026-11-24 from the web app reading a project
// (docs/device-transfer.md). Pure: nothing here opens a port. Every message a script may send is
// built here and checked by `assertTransferSend`, which accepts only these read-only shapes.
//
// Messages are F0 00 20 29 01 64 03 <cmd> … F7. Numbers travel as 8 nibbles (u32, big-endian).
//   40                      open a transfer session        ← 08 00 (ack)
//   0B 01                   (unknown query, sent by Components) ← 0B 01 n
//   09 01 00                (unknown query, sent by Components) ← 09 01 00 …
//   0B 02                   list the packs                 ← 0B 02 n, then 0C 02 i name per pack
//   0B 03 pack              list a pack's files            ← 0B 03 pack n lo hi, then 0C 03 pack i name
//   01 <u32 0> kind pack i 02   read a file                ← 01 <u32 0> kind pack i 01 <u32 size>,
//                                                             then 02 <u32 packet 1…> kind pack i <data>
//   41                      close the session              ← 08 00
// Data is 7-bit packed: each group is one byte of high bits (bit k = the high bit of data byte k)
// followed by up to 7 data bytes. A full packet carries 8,192 bytes.
import { hex } from "./device.ts";

export const TRANSFER_PREFIX: readonly number[] = [0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x03];
/** Bytes per data packet, before packing. */
export const TRANSFER_PACKET = 8192;
/** File kinds in a pack (the firmware's storage API: circuit-hacks-rc tools/probe35s.py). */
export const TRANSFER_KINDS = { sessions: 3 } as const;

const msg = (...body: number[]): Uint8Array => Uint8Array.from([...TRANSFER_PREFIX, ...body, 0xf7]);
const u32 = (v: number): number[] => Array.from({ length: 8 }, (_, i) => (v >>> ((7 - i) * 4)) & 0xf);
const readU32 = (b: ArrayLike<number>, at: number): number => {
  let v = 0;
  for (let i = 0; i < 8; i++) v = v * 16 + (b[at + i]! & 0xf);
  return v;
};

export const openSession = (): Uint8Array => msg(0x40);
export const closeSession = (): Uint8Array => msg(0x41);
export const queryCapabilities = (): Uint8Array => msg(0x0b, 0x01);
export const queryInfo = (): Uint8Array => msg(0x09, 0x01, 0x00);
export const listPacks = (): Uint8Array => msg(0x0b, 0x02);
export function listFiles(pack: number): Uint8Array {
  checkByte(pack, "pack");
  return msg(0x0b, 0x03, pack);
}
export function readFile(kind: number, pack: number, index: number): Uint8Array {
  if (!Object.values(TRANSFER_KINDS).includes(kind as 3)) throw new Error(`unknown file kind ${kind}`);
  checkByte(pack, "pack");
  checkByte(index, "file index");
  return msg(0x01, ...u32(0), kind, pack, index, 0x02);
}

function checkByte(v: number, what: string): void {
  if (!Number.isInteger(v) || v < 0 || v > 0x7f) throw new Error(`${what} ${v} is not 0–127`);
}

/** The read-only request these bytes are, or null. Accepts exactly the shapes built above. */
export function transferRequest(b: ArrayLike<number>): string | null {
  const a = Array.from(b);
  if (a.length < TRANSFER_PREFIX.length + 2 || a.at(-1) !== 0xf7) return null;
  if (!TRANSFER_PREFIX.every((x, i) => a[i] === x)) return null;
  const body = a.slice(TRANSFER_PREFIX.length, -1);
  const is = (...x: number[]): boolean => body.length === x.length && x.every((v, i) => body[i] === v);
  if (is(0x40)) return "open session";
  if (is(0x41)) return "close session";
  if (is(0x0b, 0x01)) return "query 0B 01";
  if (is(0x09, 0x01, 0x00)) return "query 09 01 00";
  if (is(0x0b, 0x02)) return "list packs";
  if (body.length === 3 && body[0] === 0x0b && body[1] === 0x03 && body[2]! <= 0x7f) return `list files of pack ${body[2]}`;
  if (body.length === 13 && body[0] === 0x01 && body.slice(1, 9).every((x) => x === 0) && body[9] === TRANSFER_KINDS.sessions && body[10]! <= 0x7f && body[11]! <= 0x7f && body[12] === 0x02) {
    return `read session ${body[11]} of pack ${body[10]}`;
  }
  return null;
}

/** Throws unless `bytes` is one of the read-only transfer requests; returns its name. */
export function assertTransferSend(bytes: ArrayLike<number>): string {
  const name = transferRequest(bytes);
  if (!name) throw new Error(`refused to send ${hex(bytes)}: not a read-only transfer request`);
  return name;
}

/** The command byte of a transfer reply, or null for any other message. */
export function transferCommand(m: ArrayLike<number>): number | null {
  if (m.length < TRANSFER_PREFIX.length + 2 || !TRANSFER_PREFIX.every((x, i) => m[i] === x)) return null;
  return m[TRANSFER_PREFIX.length]!;
}

export interface ListedName { list: number; pack: number | null; index: number; name: string }

/** A `0C` reply: one pack name (list 2) or one file name of a pack (list 3). */
export function parseListedName(m: ArrayLike<number>): ListedName | null {
  if (transferCommand(m) !== 0x0c) return null;
  const list = m[8]!;
  const at = list === 3 ? 11 : 10;
  const text = String.fromCharCode(...Array.from(m).slice(at, -1));
  return { list, pack: list === 3 ? m[9]! : null, index: list === 3 ? m[10]! : m[9]!, name: text };
}

/** The read reply: the file's size, or null when this is not it (status other than 1 = no such file). */
export function parseReadReply(m: ArrayLike<number>, kind: number, pack: number, index: number): { size: number } | { missing: true } | null {
  if (transferCommand(m) !== 0x01 || m.length !== 29) return null;
  if (m[16] !== kind || m[17] !== pack || m[18] !== index) return null;
  return m[19] === 1 ? { size: readU32(m, 20) } : { missing: true };
}

export interface DataPacket { packet: number; kind: number; pack: number; index: number; data: Uint8Array }

/** A data packet (`02`), unpacked. */
export function parseDataPacket(m: ArrayLike<number>): DataPacket | null {
  if (transferCommand(m) !== 0x02 || m.length < 21) return null;
  return { packet: readU32(m, 8), kind: m[16]!, pack: m[17]!, index: m[18]!, data: unpack7(Array.from(m).slice(19, -1)) };
}

/** 7-bit unpacking: a high-bits byte, then up to 7 data bytes. */
export function unpack7(p: readonly number[]): Uint8Array {
  const out: number[] = [];
  for (let g = 0; g < p.length; g += 8) {
    const hi = p[g]!;
    for (let k = 1; k < 8 && g + k < p.length; k++) out.push(p[g + k]! | (((hi >> (k - 1)) & 1) << 7));
  }
  return Uint8Array.from(out);
}

/** The inverse, for tests and fakes. */
export function pack7(d: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let g = 0; g < d.length; g += 7) {
    const grp = Array.from(d).slice(g, g + 7);
    out.push(grp.reduce((hi, x, k) => hi | ((x >> 7) << k), 0), ...grp.map((x) => x & 0x7f));
  }
  return out;
}

/** A data packet as the device sends it (for fakes). */
export function dataPacketMessage(packet: number, kind: number, pack: number, index: number, data: ArrayLike<number>): Uint8Array {
  return msg(0x02, ...u32(packet), kind, pack, index, ...pack7(data));
}

/** The read reply as the device sends it (for fakes). */
export function readReplyMessage(kind: number, pack: number, index: number, size: number | null): Uint8Array {
  return msg(0x01, ...u32(0), kind, pack, index, size === null ? 0 : 1, ...u32(size ?? 0));
}

/**
 * Puts a file together from its packets: numbered from 1, each 8,192 bytes but the last.
 * Throws on a gap, a repeat, a packet for another file or a size that doesn't add up.
 */
export function assembleFile(size: number, packets: readonly DataPacket[], kind: number, pack: number, index: number): Uint8Array {
  const want = Math.ceil(size / TRANSFER_PACKET);
  const mine = packets.filter((p) => p.kind === kind && p.pack === pack && p.index === index).sort((a, b) => a.packet - b.packet);
  if (mine.length !== want) throw new Error(`expected ${want} packets, got ${mine.length}`);
  const out = new Uint8Array(size);
  mine.forEach((p, i) => {
    if (p.packet !== i + 1) throw new Error(`packet ${i + 1} missing (got ${p.packet})`);
    const len = Math.min(TRANSFER_PACKET, size - i * TRANSFER_PACKET);
    if (p.data.length !== len) throw new Error(`packet ${p.packet} carries ${p.data.length} bytes, expected ${len}`);
    out.set(p.data, i * TRANSFER_PACKET);
  });
  return out;
}
