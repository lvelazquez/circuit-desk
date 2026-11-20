// The window's views, in switcher order, with what each one is for.
export type View = "circuit" | "editor" | "scenes" | "mixer" | "project" | "patch" | "pack";

export const VIEWS: readonly { id: View; label: string }[] = [
  { id: "circuit", label: "Circuit" }, { id: "editor", label: "Editor" }, { id: "scenes", label: "Scenes" },
  { id: "mixer", label: "Mixer" }, { id: "project", label: "Project" }, { id: "patch", label: "Patch" }, { id: "pack", label: "Pack" },
];

export const VIEW_TIPS: Record<View, string> = {
  circuit: "The device: track buttons, pattern pads, and the 32-pad grid for steps and notes.",
  editor: "Piano roll, velocity lane, automation lanes and the drum grid for the pattern.",
  scenes: "The 16 scenes: which patterns each track plays, and the scene chain.",
  mixer: "Levels, pans, reverb and delay sends, mute and solo, the project FX and the sidechains.",
  project: "Name, tempo, swing, scale and root, and each drum's sample and knobs.",
  patch: "Synth 1 or 2's patch, page by page as on the device: oscillators, filter, envelopes, LFOs, FX, mod matrix and macros.",
  pack: "The pack's 64 drum samples and its synth patch banks, to audition.",
};

/** The view after `v`, wrapping round. */
export const nextView = (v: View): View => VIEWS[(VIEWS.findIndex((x) => x.id === v) + 1) % VIEWS.length]!.id;
