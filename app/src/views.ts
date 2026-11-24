// The window's views, in menu order (⌘1–⌘7). The Circuit panel is always on screen (⌘1 moves focus to
// its pads); the others are tabs of the pane beside it.
export type View = "circuit" | "editor" | "scenes" | "sounds" | "mixer" | "pack" | "project";
export type DetailView = Exclude<View, "circuit">;

export interface ViewInfo { id: View; label: string; tip: string }

export const VIEWS: readonly ViewInfo[] = [
  { id: "circuit", label: "Circuit", tip: "The device panel: knobs, buttons and the 32 pads. Always on screen; this moves focus to its pads." },
  { id: "editor", label: "Editor", tip: "Piano roll, velocity lane, automation lanes and the drum grid for the pattern." },
  { id: "scenes", label: "Scenes", tip: "The 16 scenes: which patterns each track plays, and the scene chain." },
  { id: "sounds", label: "Sounds", tip: "Synth 1 and 2's patches page by page, and each drum's sample and knobs." },
  { id: "mixer", label: "Mixer", tip: "Levels, pans, reverb and delay sends, mute and solo, the project FX and the sidechains." },
  { id: "pack", label: "Pack", tip: "The pack's 64 drum samples and its synth patch banks, to audition and copy." },
  { id: "project", label: "Project", tip: "Name, tempo, swing, scale and root." },
];

/** The tabs of the pane beside the panel. */
export const DETAIL_VIEWS: readonly (ViewInfo & { id: DetailView })[] = VIEWS.filter((v): v is ViewInfo & { id: DetailView } => v.id !== "circuit");

/** The tab `d` places after (or before) `v`, wrapping round. */
export const stepView = (v: DetailView, d: 1 | -1): DetailView => {
  const i = DETAIL_VIEWS.findIndex((x) => x.id === v);
  return DETAIL_VIEWS[(i + d + DETAIL_VIEWS.length) % DETAIL_VIEWS.length]!.id;
};
