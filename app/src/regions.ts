// F6 moves focus between the window's regions, as in a browser: toolbar → library → panel →
// inspector → pane → toolbar (Shift+F6 goes back). Regions not on screen (a closed library) are skipped.
const REGIONS = ["#toolbar", "#library", "#device", "#inspector", "#workspace"] as const;

/** The first control in a region, or the region itself (the workspace is focusable). */
function target(region: HTMLElement): HTMLElement {
  if (region.tabIndex >= 0 || region.id === "workspace") return region;
  return region.querySelector<HTMLElement>("button:not([disabled]):not([tabindex='-1']), input, select, [tabindex='0']") ?? region;
}

export function cycleRegion(d: 1 | -1): void {
  const present = REGIONS.map((s) => document.querySelector<HTMLElement>(s)).filter((x): x is HTMLElement => !!x && x.offsetParent !== null);
  if (!present.length) return;
  const at = present.findIndex((r) => r.contains(document.activeElement) && !present.some((o) => o !== r && r.contains(o) && o.contains(document.activeElement)));
  const next = present[(at === -1 ? (d === 1 ? 0 : present.length - 1) : at + d + present.length) % present.length]!;
  target(next).focus();
}
