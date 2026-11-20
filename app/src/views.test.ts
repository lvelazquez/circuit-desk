import { describe, expect, it } from "vitest";
import { MENU_VIEWS } from "../electron/api.ts";
import { PATTERN_VIEWS, VIEWS, stepView } from "./views.ts";

describe("views", () => {
  it("the View menu lists the same views in the same order (⌘1–⌘7)", () => {
    expect(VIEWS.map((v) => v.label)).toEqual([...MENU_VIEWS]);
  });
  it("Next and Previous View wrap round", () => {
    expect(stepView("project", 1)).toBe("circuit");
    expect(stepView("circuit", -1)).toBe("project");
    expect(stepView("scenes", 1)).toBe("sounds");
  });
  it("only the pattern views show the Inspector", () => {
    expect([...PATTERN_VIEWS].sort()).toEqual(["circuit", "editor"]);
  });
});
