// The bridge between the app window and the project service in the main process. Shared by both
// sides; the window imports only types and the method list from here.
import type { ProjectService } from "@circuit-desk/core-service";

/** The service methods the window may call. Anything else is refused by the main process. */
export const DESK_METHODS = [
  "listProjects", "openProject", "closeProject", "openProjects", "summary", "getPattern",
  "setSteps", "setDrumSteps", "setPatternSettings", "getScenes", "setChain", "setScene",
  "undo", "redo", "diffVsOriginal", "validate", "saveCopy", "exportMidi", "exportAls", "arrangement",
] as const;
export type DeskMethod = (typeof DESK_METHODS)[number];
export type DeskService = Pick<ProjectService, DeskMethod>;

export type DeskResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Commands from the app menu; the window decides what each means where focus is. */
export type MenuCommand = "undo" | "redo" | "open" | "save-copy" | "export-midi" | "export-als" | "toggle-view" | "play";

export interface DeskBridge {
  call(method: DeskMethod, args: unknown[]): Promise<DeskResult<unknown>>;
  /** Shows the open dialog; resolves to the chosen .ncs path, or null. */
  pickProject(): Promise<string | null>;
  /** Shows a file in Finder. Only paths the service wrote are accepted. */
  reveal(path: string): Promise<void>;
  onMenu(callback: (command: MenuCommand) => void): () => void;
}
