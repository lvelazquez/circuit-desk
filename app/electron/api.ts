// The bridge between the app window and the project service in the main process. Shared by both
// sides; the window imports only types and the method list from here.
import type { ProjectService, ServiceMethod } from "@circuit-desk/core-service";

/** The service methods the window may call: the same list the local socket serves (core-service rpc.ts). */
export type DeskMethod = ServiceMethod;
export type DeskService = Pick<ProjectService, DeskMethod>;

export type DeskResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Commands from the app menu; the window decides what each means where focus is. */
export type MenuCommand = "undo" | "redo" | "open" | "save-copy" | "export-midi" | "export-als" | "toggle-view" | "play" | "changed" | "export-audio";

export interface DeskBridge {
  call(method: DeskMethod, args: unknown[]): Promise<DeskResult<unknown>>;
  /** Shows the open dialog; resolves to the chosen .ncs path, or null. */
  pickProject(): Promise<string | null>;
  /** Shows a file in Finder. Only paths the service wrote are accepted. */
  reveal(path: string): Promise<void>;
  onMenu(callback: (command: MenuCommand) => void): () => void;
}
