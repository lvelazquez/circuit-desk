// Contrast of the colour tokens (WCAG 2.2): text needs 4.5:1 against the surfaces it sits on;
// control edges, the focus ring and the selection frame need 3:1 (non-text contrast, 1.4.11).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
const token = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`no colour token --${name}`);
  return m[1];
};
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Where text and controls sit. */
const SURFACES = ["color-surface-body", "color-surface-panel", "color-surface-raised", "color-surface-hw"];
const TRACKS = ["synth1", "synth2", "midi1", "midi2", "drum1", "drum2", "drum3", "drum4"].map((t) => `color-track-${t}`).concat(["color-scene"]);

describe("colour tokens meet WCAG contrast", () => {
  it("primary and secondary text: 4.5:1 on every surface, including pads", () => {
    for (const text of ["color-text-primary", "color-text-secondary"]) {
      for (const bg of [...SURFACES, "color-surface-pad", "color-surface-pad-hover"]) {
        expect(contrast(token(text), token(bg)), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("control edges, the focus ring and the selection frame: 3:1 against the surfaces around them", () => {
    for (const edge of ["color-border-control", "color-focus-ring", "color-selected"]) {
      for (const bg of SURFACES) expect(contrast(token(edge), token(bg)), `${edge} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the panel's coloured Mixer label: 4.5:1 on its button; the Play and Record symbols (icons): 3:1", () => {
    for (const bg of ["color-surface-pad", "color-surface-pad-hover"]) {
      expect(contrast(token("color-hw-label-accent"), token(bg)), `Mixer on ${bg}`).toBeGreaterThanOrEqual(4.5);
      for (const icon of ["color-hw-play", "color-danger"]) expect(contrast(token(icon), token(bg)), `${icon} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("text and the selection frame on lit (track-coloured) cells", () => {
    for (const t of TRACKS) {
      expect(contrast(token("color-text-on-accent"), token(t)), `text on ${t}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token("color-selected-on-accent"), token(t)), `selection on ${t}`).toBeGreaterThanOrEqual(3);
    }
  });
});
