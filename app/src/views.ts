// The window's views, in switcher order (⌘1–⌘7), grouped as the toolbar shows them.
export type View = "circuit" | "editor" | "scenes" | "sounds" | "mixer" | "pack" | "project";

export interface ViewInfo { id: View; label: string; group: "Sequence" | "Sound" | "Song"; tip: string }

export const VIEWS: readonly ViewInfo[] = [
  { id: "circuit", label: "Circuit", group: "Sequence", tip: "The device: track buttons, pattern pads, the 32-pad grid for steps and notes, and the macro knobs." },
  { id: "editor", label: "Editor", group: "Sequence", tip: "Piano roll, velocity lane, automation lanes and the drum grid for the pattern." },
  { id: "scenes", label: "Scenes", group: "Sequence", tip: "The 16 scenes: which patterns each track plays, and the scene chain." },
  { id: "sounds", label: "Sounds", group: "Sound", tip: "Synth 1 and 2's patches page by page, and each drum's sample and knobs." },
  { id: "mixer", label: "Mixer", group: "Sound", tip: "Levels, pans, reverb and delay sends, mute and solo, the project FX and the sidechains." },
  { id: "pack", label: "Pack", group: "Sound", tip: "The pack's 64 drum samples and its synth patch banks, to audition and copy." },
  { id: "project", label: "Project", group: "Song", tip: "Name, tempo, swing, scale and root." },
];

/** Views that edit a pattern, and so show the Inspector beside them. */
export const PATTERN_VIEWS: ReadonlySet<View> = new Set(["circuit", "editor"]);

/** The view `d` places after (or before) `v`, wrapping round. */
export const stepView = (v: View, d: 1 | -1): View => VIEWS[(VIEWS.findIndex((x) => x.id === v) + d + VIEWS.length) % VIEWS.length]!.id;
