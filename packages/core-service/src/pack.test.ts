import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as N from "@circuit-desk/ncs";
import { blankProject } from "../../ncs/src/testing.ts";
import { ProjectService } from "./service.ts";

describe("pack samples", () => {
  const root = mkdtempSync(join(tmpdir(), "cd-pack-"));
  const pack = join(root, "Tracks", "03_Test");
  mkdirSync(join(pack, "Sessions"), { recursive: true });
  mkdirSync(join(pack, "PCM"));
  const b = blankProject("Pack");
  b[N.DRUM_BLOCK] = 2; b[N.DRUM_BLOCK + N.DRUM_RECORD] = 7;
  writeFileSync(join(pack, "Sessions", "00_Pack.ncs"), b);
  writeFileSync(join(pack, "PCM", "02_Kick.wav"), new Uint8Array([1, 2, 3]));
  writeFileSync(join(pack, "PCM", "07_Snare.wav"), new Uint8Array([4]));
  writeFileSync(join(pack, "PCM", "._07_Snare.wav"), new Uint8Array([9])); // macOS litter
  const svc = new ProjectService({ library: root, copies: join(root, "c"), exports: join(root, "e"), socket: join(root, "s") });
  const { id } = svc.openProject(join(pack, "Sessions", "00_Pack.ncs"));

  it("lists the pack's samples and each drum's sample", () => {
    const r = svc.packSamples(id);
    expect(r.samples).toEqual([{ index: 2, name: "Kick", size: 3 }, { index: 7, name: "Snare", size: 1 }]);
    expect(r.drums).toEqual([2, 7, 0, 0]);
  });

  it("reads a sample, and refuses anything else", () => {
    expect([...svc.sampleData(id, 7)]).toEqual([4]);
    expect(() => svc.sampleData(id, 64)).toThrow(/0–63/);
    expect(() => svc.sampleData(id, 5)).toThrow(/no sample 5/);
  });

  it("has no samples for a project outside a pack", () => {
    writeFileSync(join(root, "Loose.ncs"), blankProject());
    const loose = svc.openProject(join(root, "Loose.ncs")).id;
    expect(svc.packSamples(loose).pack).toBeNull();
    expect(() => svc.sampleData(loose, 0)).toThrow(/not inside a pack/);
  });
});
