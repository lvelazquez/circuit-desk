import { describe, expect, it } from "vitest";
import { MENU_VIEWS } from "../electron/api.ts";
import { DETAIL_VIEWS, VIEWS, stepView } from "./views.ts";

describe("views", () => {
  it("the View menu lists the same views in the same order (⌘1–⌘7)", () => {
    expect(VIEWS.map((v) => v.label)).toEqual([...MENU_VIEWS]);
  });
  it("the pane beside the panel has every view but the panel itself", () => {
    expect(DETAIL_VIEWS.map((v) => v.id)).toEqual(["editor", "scenes", "sounds", "mixer", "pack", "project"]);
  });
  it("Next and Previous View wrap round the pane's tabs", () => {
    expect(stepView("project", 1)).toBe("editor");
    expect(stepView("editor", -1)).toBe("project");
    expect(stepView("scenes", 1)).toBe("sounds");
  });
});
