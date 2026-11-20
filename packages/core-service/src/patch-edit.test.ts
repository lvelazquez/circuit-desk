import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as N from "@circuit-desk/ncs";
import { PATCH_SIZE, initPatchBytes, param, readSyx } from "@circuit-desk/patch";
import { blankProject } from "../../ncs/src/testing.ts";
import { ProjectService } from "./service.ts";

/** A project in a pack, with the guide's default patch on Synth 1 and a zeroed patch on Synth 2. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cd-patchedit-"));
  const pack = join(root, "Tracks", "04_Test");
  mkdirSync(join(pack, "Sessions"), { recursive: true });
  mkdirSync(join(pack, "Patches"));
  const b = blankProject("Edit");
  b.set(initPatchBytes(), N.PATCH0);
  writeFileSync(join(pack, "Sessions", "00_Edit.ncs"), b);
  const bank = new Uint8Array(512 + PATCH_SIZE).fill(0xff);
  const lead = initPatchBytes();
  lead.set([..."Pack Lead".padEnd(16, " ")].map((c) => c.charCodeAt(0)), 0);
  lead[param("filter.frequency").address] = 40;
  bank.set(initPatchBytes(), 0); bank.set(lead, 512);
  writeFileSync(join(pack, "Patches", "02_PATCHBANK.cpb"), bank);
  const svc = new ProjectService({ library: root, copies: join(root, "Copies"), exports: join(root, "Exports"), socket: join(root, "s") });
  const { id } = svc.openProject(join(pack, "Sessions", "00_Edit.ncs"));
  return { svc, id, root, lead };
}

describe("patch editing", () => {
  it("reads a patch as values, with its status from the registry", () => {
    const { svc, id } = fixture();
    const p = svc.getPatch(id, 1);
    expect(p.name).toBe("Initial Patch");
    expect(p.values["filter.frequency"]).toBe(127);
    expect(p.status).toBe("partial");
    expect(p.problems).toEqual([]);
  });

  it("one parameter edit changes exactly its byte, labelled with the parameter, and undoes", () => {
    const { svc, id } = fixture();
    const changed = svc.setPatchParams(id, 1, { "filter.frequency": 60 });
    expect(changed).toEqual([{ offset: N.PATCH0 + param("filter.frequency").address, length: 1, field: "Synth 1 patch: filter.frequency", status: "partial" }]);
    expect(svc.getPatch(id, 1).values["filter.frequency"]).toBe(60);
    expect(svc.diffVsOriginal(id).map((r) => r.field)).toEqual(["Synth 1 patch: filter.frequency"]);
    svc.undo(id);
    expect(svc.getPatch(id, 1).values["filter.frequency"]).toBe(127);
    svc.redo(id);
    expect(svc.getPatch(id, 1).values["filter.frequency"]).toBe(60);
  });

  it("renames, and edits a patch whose other stored values are out of range (kept as stored)", () => {
    const { svc, id } = fixture();
    expect(svc.getPatch(id, 2).problems.length).toBeGreaterThan(0); // zeroed: e.g. pre-glide 0 < 52
    const changed = svc.setPatchParams(id, 2, { "osc1.wave": 13 }, "Square");
    expect(changed.map((r) => r.field)).toEqual(["Synth 2 patch: name", "Synth 2 patch: osc1.wave"]);
    const p = svc.getPatch(id, 2);
    expect(p.name).toBe("Square");
    expect(p.values["voice.preGlide"]).toBe(0);
  });

  it("refuses bad values, unknown or reserved parameters and bad names, changing nothing", () => {
    const { svc, id } = fixture();
    expect(() => svc.setPatchParams(id, 1, { "osc1.wave": 30 })).toThrow(/0–29/);
    expect(() => svc.setPatchParams(id, 1, { "osc3.wave": 1 })).toThrow(/no patch parameter/);
    expect(() => svc.setPatchParams(id, 1, { reserved3: 1 })).toThrow(/reserved/);
    expect(() => svc.setPatchParams(id, 1, {}, "Café")).toThrow(/ASCII/);
    expect(() => svc.setPatchParams(id, 3 as 1, {})).toThrow(/1 or 2/);
    expect(svc.diffVsOriginal(id)).toEqual([]);
  });

  it("loads a pack patch into a synth as one undoable edit", () => {
    const { svc, id, lead } = fixture();
    svc.loadPackPatch(id, 1, 2, 1);
    const p = svc.getPatch(id, 1);
    expect(p.name).toBe("Pack Lead");
    expect(Uint8Array.from(svc.synthPatches(id).synth1)).toEqual(lead);
    svc.undo(id);
    expect(svc.getPatch(id, 1).name).toBe("Initial Patch");
  });

  it("exports a .syx that reads back as the patch, without overwriting", () => {
    const { svc, id } = fixture();
    svc.setPatchParams(id, 1, {}, "My Lead");
    const a = svc.exportPatchSyx(id, 1), b = svc.exportPatchSyx(id, 1);
    expect(a.path).toMatch(/Synth 1 - My Lead\.syx$/);
    expect(b.path).toMatch(/Synth 1 - My Lead \(2\)\.syx$/);
    const msgs = readSyx(new Uint8Array(readFileSync(a.path)));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.command).toBe(0);
    expect(Array.from(msgs[0]!.patch)).toEqual(svc.synthPatches(id).synth1);
  });
});
