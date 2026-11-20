// The app menu (and its shortcuts) arrives from the main process as commands. The subscription is
// made once; the handlers are read from a ref, so they always see the current state.
import { useEffect, useRef } from "react";
import type { MenuCommand } from "../electron/api.ts";
import { bridge } from "./desk.ts";
import { isTextField } from "./storage.ts";

export type MenuHandlers = { [C in MenuCommand]?: () => void } & { undo: () => void; redo: () => void };

export function useMenuCommands(handlers: MenuHandlers): void {
  const current = useRef(handlers);
  current.current = handlers;
  useEffect(() => {
    try {
      return bridge().onMenu((command: MenuCommand) => {
        // In a text field, Undo and Redo edit the text, not the project.
        if ((command === "undo" || command === "redo") && isTextField(document.activeElement)) { document.execCommand(command); return; }
        current.current[command]?.();
      });
    } catch { return undefined; }
  }, []);
}
