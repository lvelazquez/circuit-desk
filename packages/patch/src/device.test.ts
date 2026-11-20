import { describe, expect, it } from "vitest";
import { ALLOWED_DEVICE_MESSAGES, FWID_QUERY, PROJECT_PATCH0, assertAllowedSend, comparePatches, describeDifferences, isAllowedDeviceMessage, parseFwidReply, projectPatch } from "./device.ts";
import { PATCH_SIZE, param } from "./format.ts";
import { initPatchBytes } from "./patch.ts";
import { dumpRequestMessage, replaceCurrentPatchMessage, replacePatchMessage } from "./sysex.ts";

describe("device output allowlist", () => {
  it("accepts exactly the two dump requests and the fwid query", () => {
    expect(ALLOWED_DEVICE_MESSAGES.map((m) => m.bytes.length)).toEqual([9, 9, 14]);
    expect(isAllowedDeviceMessage(dumpRequestMessage(0))).toBe(true);
    expect(isAllowedDeviceMessage(dumpRequestMessage(1))).toBe(true);
    expect(isAllowedDeviceMessage([...dumpRequestMessage(1)])).toBe(true);
    expect(isAllowedDeviceMessage(FWID_QUERY)).toBe(true);
    expect([...FWID_QUERY]).toEqual([0xf0, 0x7d, 0x43, 0x54, 0x00, 0x23, 0, 0, 0, 0, 0, 0, 0, 0xf7]);
    expect([...dumpRequestMessage(0)]).toEqual([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x40, 0x00, 0xf7]);
    expect(assertAllowedSend(dumpRequestMessage(1))).toBe("dump request Synth 2");
  });

  it("refuses patch writes", () => {
    const p = initPatchBytes();
    expect(isAllowedDeviceMessage(replaceCurrentPatchMessage(p, 0))).toBe(false);
    expect(isAllowedDeviceMessage(replaceCurrentPatchMessage(p, 1))).toBe(false);
    expect(isAllowedDeviceMessage(replacePatchMessage(p, 0))).toBe(false);
    expect(() => assertAllowedSend(replaceCurrentPatchMessage(p, 0))).toThrow(/allowlist/);
  });

  it("refuses near misses", () => {
    const d = [...dumpRequestMessage(0)];
    expect(isAllowedDeviceMessage([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x40, 0x02, 0xf7])).toBe(false); // location 2
    expect(isAllowedDeviceMessage([0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x00, 0x00, 0xf7])).toBe(false); // replace command, no patch
    expect(isAllowedDeviceMessage(d.slice(0, -1))).toBe(false); // no F7
    expect(isAllowedDeviceMessage([...d, 0xf7])).toBe(false); // trailing byte
    expect(isAllowedDeviceMessage([...d, ...d])).toBe(false); // two messages in one send
    const f = [...FWID_QUERY];
    f[5] = 0x24;
    expect(isAllowedDeviceMessage(f)).toBe(false); // other seq
    const g = [...FWID_QUERY];
    g[4] = 0x01;
    expect(isAllowedDeviceMessage(g)).toBe(false); // other command
    expect(isAllowedDeviceMessage(FWID_QUERY.slice(0, 13))).toBe(false);
    expect(isAllowedDeviceMessage([])).toBe(false);
  });

  it("refuses notes, controllers and other channel messages", () => {
    for (const m of [[0x90, 60, 100], [0x80, 60, 0], [0xb0, 123, 0], [0xc0, 1], [0xf8], [0xfa], [0xfc], [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]]) {
      expect(isAllowedDeviceMessage(m)).toBe(false);
      expect(() => assertAllowedSend(m)).toThrow();
    }
  });
});

describe("fwid reply", () => {
  it("reads the marker text", () => {
    const r = parseFwidReply([0xf0, 0x7d, 0x43, 0x54, 0x40, 0x23, 0x01, 0x42, 0x35, 0x2e, 0x34, 0x37, 0x00, 0xf7]);
    expect(r).toEqual({ seq: 0x23, format: 1, marker: [0x42, 0x35, 0x2e, 0x34, 0x37, 0], text: "B5.47" });
    expect(parseFwidReply(FWID_QUERY)).toBeNull(); // the request itself is not a reply
  });
});

describe("patch comparison", () => {
  it("finds identical patches identical", () => {
    const p = initPatchBytes();
    expect(comparePatches(p, p.slice())).toEqual([]);
    expect(describeDifferences([])).toMatch(/identical/);
  });

  it("names differing addresses with their parameter ids", () => {
    const file = initPatchBytes();
    const dev = file.slice();
    const freq = param("filter.frequency");
    dev[freq.address] = (dev[freq.address]! + 1) & 0x7f;
    dev[0] = 0x41;
    const d = comparePatches(file, dev);
    expect(d.map((x) => x.param)).toEqual(["name[0]", "filter.frequency"]);
    expect(d[1]).toMatchObject({ address: freq.address, file: file[freq.address], device: dev[freq.address] });
    expect(describeDifferences(d)).toContain("filter.frequency");
  });

  it("reads Synth 1 and 2 from a project file", () => {
    const file = new Uint8Array(PROJECT_PATCH0 + 2 * PATCH_SIZE + 10);
    file[PROJECT_PATCH0] = 1;
    file[PROJECT_PATCH0 + PATCH_SIZE] = 2;
    expect(projectPatch(file, 0)[0]).toBe(1);
    expect(projectPatch(file, 1)[0]).toBe(2);
    expect(() => projectPatch(file.slice(0, PROJECT_PATCH0), 0)).toThrow(/too short/);
    expect(() => comparePatches(file, file)).toThrow();
  });
});
