import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as N from "@circuit-desk/ncs";
import { initPatchBytes, PATCH_SIZE } from "@circuit-desk/patch";
import { blankProject } from "../../ncs/src/testing.ts";
import { ProjectService } from "./service.ts";
import { FIRMWARES } from "./firmware.ts";

function service(root: string): ProjectService {
  return new ProjectService({ library: root, copies: join(root, "c"), exports: join(root, "e"), socket: join(root, "s") });
}

describe("firmware choice", () => {
  const root = mkdtempSync(join(tmpdir(), "cd-fw-"));
  // A project with CIRCUIT-HACKS extra lanes whose stored sum is wrong.
  const b = new Uint8Array(N.SESS_SIZE + N.XLN1_HEADER + N.XLN1_DATA);
  b.set(blankProject("Lanes"));
  b.set([0x58, 0x4c, 0x4e, 0x31], N.SESS_SIZE);
  b[N.SESS_SIZE + N.XLN1_SUM_AT] = 0x5a;
  writeFileSync(join(root, "Lanes.ncs"), b);
  const svc = service(root);
  const { id } = svc.openProject(join(root, "Lanes.ncs"));

  it("starts on the official firmware and lists the known ones", () => {
    const f = svc.firmware();
    expect(f.current.id).toBe("official");
    expect(f.available.map((x) => x.id)).toEqual(FIRMWARES.map((x) => x.id));
  });

  it("CIRCUIT-HACKS data problems block only when the device runs CIRCUIT-HACKS", () => {
    svc.setFirmware("official");
    const off = svc.validate(id);
    expect(off.problems).toEqual([]);
    expect(off.firmwareNotes.join()).toMatch(/does not read them/);
    expect(svc.summary(id).circuitHacksData.usedByDevice).toBe(false);
    svc.setFirmware("circuit-hacks");
    const on = svc.validate(id);
    expect(on.problems.join()).toMatch(/extra lanes/);
    expect(svc.summary(id).circuitHacksData.usedByDevice).toBe(true);
    svc.setFirmware("official");
  });

  it("refuses an unknown firmware", () => {
    expect(() => svc.setFirmware("og")).toThrow(/official, circuit-hacks/);
  });
});

describe("pack patches", () => {
  const root = mkdtempSync(join(tmpdir(), "cd-patches-"));
  const pack = join(root, "Tracks", "04_Test");
  mkdirSync(join(pack, "Sessions"), { recursive: true });
  mkdirSync(join(pack, "Patches"));
  writeFileSync(join(pack, "Sessions", "00_P.ncs"), blankProject("P"));
  const bank = new Uint8Array(512 + PATCH_SIZE).fill(0xff);
  const a = initPatchBytes(); a[16] = 2; // Bass
  const c = initPatchBytes(); c.set([...("Second".padEnd(16, " "))].map((ch) => ch.charCodeAt(0)), 0);
  bank.set(a, 0); bank.set(c, 512);
  bank.set([0x43, 0x54, 0x4d, 0x31], PATCH_SIZE); // record 0 carries a CIRCUIT-HACKS own-synth patch
  writeFileSync(join(pack, "Patches", "03_PATCHBANK.cpb"), bank);
  const svc = service(root);
  const { id } = svc.openProject(join(pack, "Sessions", "00_P.ncs"));

  it("lists banks with names, categories and CIRCUIT-HACKS records", () => {
    const r = svc.packPatches(id);
    expect(r.banks).toEqual([{ bank: 3, file: "03_PATCHBANK.cpb", patches: [
      { record: 0, name: "Initial Patch", category: "Bass", ownSynthData: true },
      { record: 1, name: "Second", category: "None", ownSynthData: false },
    ] }]);
  });

  it("reads one patch's bytes, and refuses what is not there", () => {
    expect(svc.packPatch(id, 3, 1)).toEqual(Array.from(c));
    expect(() => svc.packPatch(id, 5, 0)).toThrow(/no patch bank 5/);
    expect(() => svc.packPatch(id, 3, 2)).toThrow(/no patch 2/);
  });

  it("returns the project's own Synth 1/2 patches", () => {
    const p = svc.synthPatches(id);
    expect(p.synth1).toHaveLength(PATCH_SIZE);
    expect(p.synth2).toHaveLength(PATCH_SIZE);
  });
});
