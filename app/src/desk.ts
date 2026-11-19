// Typed access to the project service through the window bridge (electron/preload.cjs).
import type { DeskBridge, DeskMethod, DeskService } from "../electron/api.ts";

declare global {
  interface Window { circuitDesk?: DeskBridge }
}

export class DeskError extends Error {}

export function bridge(): DeskBridge {
  const b = window.circuitDesk;
  if (!b) throw new DeskError("Circuit Desk runs inside its desktop app; the service is not available in a plain browser.");
  return b;
}

export async function call<M extends DeskMethod>(method: M, ...args: Parameters<DeskService[M]>): Promise<Awaited<ReturnType<DeskService[M]>>> {
  const r = await bridge().call(method, args);
  if (!r.ok) throw new DeskError(r.error);
  return r.value as Awaited<ReturnType<DeskService[M]>>;
}

export type Summary = Awaited<ReturnType<DeskService["summary"]>>;
export type PatternData = Awaited<ReturnType<DeskService["getPattern"]>>;
export type NotePatternData = Extract<PatternData, { kind: "notes" }>;
export type DrumPatternData = Extract<PatternData, { kind: "drums" }>;
export type Scenes = Awaited<ReturnType<DeskService["getScenes"]>>;
export type Listing = Awaited<ReturnType<DeskService["listProjects"]>>[number];
export type Automation = Awaited<ReturnType<DeskService["getAutomation"]>>;
