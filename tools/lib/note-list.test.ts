import { describe, expect, it } from "vitest";
import { checkChannelMessage, closingMessages, parseNoteList, parseNoteNumbers, recordingLog, testNoteList } from "./note-list.ts";

describe("note lists for the device recorder", () => {
  it("builds the simple test list: on, held, off, gap", () => {
    const l = testNoteList({ notes: [48, 60], channel: 1, velocity: 90, lengthMs: 800, gapMs: 400, leadMs: 500 });
    expect(l).toEqual([
      { t: 500, bytes: [0x90, 48, 90] }, { t: 1300, bytes: [0x80, 48, 0] },
      { t: 1700, bytes: [0x90, 60, 90] }, { t: 2500, bytes: [0x80, 60, 0] },
    ]);
    expect(testNoteList({ notes: [60], channel: 16 })[0]!.bytes[0]).toBe(0x9f);
    expect(() => testNoteList({ notes: [60], channel: 0 })).toThrow(/1–16/);
    expect(() => testNoteList({ notes: [128], channel: 1 })).toThrow();
    expect(parseNoteNumbers("48, 60,72")).toEqual([48, 60, 72]);
    expect(() => parseNoteNumbers("C4")).toThrow();
  });

  it("sorts a JSON list by time and keeps the order of equal times", () => {
    const l = parseNoteList([{ t: 100, bytes: [0x80, 60, 0] }, { t: 0, bytes: [0x90, 60, 100] }, { t: 100, bytes: [0x90, 62, 100] }]);
    expect(l.map((e) => e.bytes[1])).toEqual([60, 60, 62]);
    expect(l.map((e) => e.bytes[0])).toEqual([0x90, 0x80, 0x90]);
  });

  it("refuses SysEx and every non-channel message", () => {
    expect(() => parseNoteList([{ t: 0, bytes: [0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x40, 0x00, 0xf7] }])).toThrow(/SysEx/);
    expect(() => checkChannelMessage([0x90, 0xf7, 0])).toThrow(/SysEx/);
    for (const m of [[0xf8], [0xfa], [0xff], [0x40, 1, 2], []]) expect(() => checkChannelMessage(m)).toThrow();
    expect(() => checkChannelMessage([0x90, 60])).toThrow(/data bytes/);
    expect(() => checkChannelMessage([0x90, 60, 128])).toThrow(/0–127/);
    expect(() => checkChannelMessage([0xc0, 5])).not.toThrow();
    expect(() => parseNoteList({})).toThrow(/array/);
    expect(() => parseNoteList([{ t: -1, bytes: [0x90, 60, 1] }])).toThrow(/entry 0/);
  });

  it("closes every note left on and sends All Notes Off per channel", () => {
    const c = closingMessages([{ t: 0, bytes: [0x90, 60, 100] }, { t: 0, bytes: [0x91, 62, 100] }, { t: 500, bytes: [0x81, 62, 0] }]);
    expect(c).toEqual([{ t: 550, bytes: [0x80, 60, 0] }, { t: 560, bytes: [0xb0, 123, 0] }, { t: 560, bytes: [0xb1, 123, 0] }]);
  });

  it("logs sent messages relative to the start of the audio", () => {
    const log = recordingLog({ output: "out", input: "in", file: "audio.wav", sampleRate: 48_000, frames: 96_000, channels: 2, audioStartMs: 1000, sent: [{ atMs: 1500, bytes: [0x90, 60, 100] }], createdAt: "x" });
    expect(log.events).toEqual([{ offset: 0.5, bytes: [0x90, 60, 100] }]);
    expect(log.kind).toBe("circuit-desk device recording");
  });
});
