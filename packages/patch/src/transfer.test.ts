import { describe, expect, it } from "vitest";
import {
  assembleFile, assertTransferSend, closeSession, dataPacketMessage, listFiles, listPacks, openSession, pack7, parseDataPacket, parseListedName,
  parseReadReply, queryCapabilities, queryInfo, readFile, readReplyMessage, transferRequest, unpack7, TRANSFER_PACKET,
} from "./transfer.ts";

const bytes = (s: string): number[] => s.split(" ").map((x) => parseInt(x, 16));

describe("transfer requests", () => {
  it("builds exactly what Components sent (capture 2026-11-24)", () => {
    expect([...openSession()]).toEqual(bytes("f0 00 20 29 01 64 03 40 f7"));
    expect([...queryCapabilities()]).toEqual(bytes("f0 00 20 29 01 64 03 0b 01 f7"));
    expect([...queryInfo()]).toEqual(bytes("f0 00 20 29 01 64 03 09 01 00 f7"));
    expect([...listPacks()]).toEqual(bytes("f0 00 20 29 01 64 03 0b 02 f7"));
    expect([...listFiles(0)]).toEqual(bytes("f0 00 20 29 01 64 03 0b 03 00 f7"));
    expect([...readFile(3, 0, 30)]).toEqual(bytes("f0 00 20 29 01 64 03 01 00 00 00 00 00 00 00 00 03 00 1e 02 f7"));
    expect([...closeSession()]).toEqual(bytes("f0 00 20 29 01 64 03 41 f7"));
  });

  it("accepts only the read-only shapes", () => {
    for (const m of [openSession(), closeSession(), queryCapabilities(), queryInfo(), listPacks(), listFiles(5), readFile(3, 2, 63)]) expect(transferRequest(m)).not.toBeNull();
    // A data packet (what a write would send), another command, a changed byte, another kind.
    expect(() => assertTransferSend(dataPacketMessage(1, 3, 0, 0, [1, 2, 3]))).toThrow(/refused/);
    expect(() => assertTransferSend(bytes("f0 00 20 29 01 64 03 05 f7"))).toThrow(/refused/);
    const r = [...readFile(3, 0, 1)];
    r[19] = 0x03;
    expect(transferRequest(r)).toBeNull();
    expect(() => readFile(4, 0, 0)).toThrow(/kind/);
    expect(() => readFile(3, 0, 200)).toThrow(/0–127/);
  });
});

describe("transfer replies", () => {
  it("parses names, the size and packets as captured", () => {
    const pack = bytes("f0 00 20 29 01 64 03 0c 02 00 30 30 5f 57 61 76 65 73 f7");
    expect(parseListedName(pack)).toEqual({ list: 2, pack: null, index: 0, name: "00_Waves" });
    const file = bytes("f0 00 20 29 01 64 03 0c 03 00 1f 33 31 5f 53 45 53 53 49 4f 4e 2e 6e 63 73 f7");
    expect(parseListedName(file)).toEqual({ list: 3, pack: 0, index: 31, name: "31_SESSION.ncs" });
    const reply = bytes("f0 00 20 29 01 64 03 01 00 00 00 00 00 00 00 00 03 00 1e 01 00 00 00 02 07 04 00 0c f7");
    expect(parseReadReply(reply, 3, 0, 30)).toEqual({ size: 160780 });
    expect(parseReadReply(reply, 3, 0, 31)).toBeNull();
    expect([...readReplyMessage(3, 0, 30, 160780)]).toEqual(reply);
  });

  it("unpacks 7-bit groups with the high bits first", () => {
    // From the capture: high-bits byte 00, then "USER".
    expect([...unpack7(bytes("00 55 53 45 52"))]).toEqual([0x55, 0x53, 0x45, 0x52]);
    expect([...unpack7([0x03, 0x7f, 0x7f])]).toEqual([0xff, 0xff]);
    const d = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) & 0xff);
    expect([...unpack7(pack7(d))]).toEqual([...d]);
    // A full packet packs to the captured length: 9,383 bytes with the 19-byte header and F7.
    expect(dataPacketMessage(1, 3, 0, 30, new Uint8Array(TRANSFER_PACKET)).length).toBe(9383);
  });

  it("assembles a file and refuses gaps", () => {
    const file = Uint8Array.from({ length: TRANSFER_PACKET * 2 + 5 }, (_, i) => (i * 7) & 0xff);
    const pk = [0, 1, 2].map((i) => parseDataPacket(dataPacketMessage(i + 1, 3, 0, 9, file.slice(i * TRANSFER_PACKET, (i + 1) * TRANSFER_PACKET)))!);
    expect([...assembleFile(file.length, pk, 3, 0, 9)]).toEqual([...file]);
    expect(() => assembleFile(file.length, [pk[0]!, pk[2]!], 3, 0, 9)).toThrow(/expected 3/);
    expect(() => assembleFile(file.length, [pk[0]!, pk[0]!, pk[2]!], 3, 0, 9)).toThrow(/missing/);
  });
});
