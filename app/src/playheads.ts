// Where each track is playing. It changes on every step while playing, so it lives outside React
// state: only the components that draw a playhead subscribe, instead of the whole window
// re-rendering on each step.
import { useSyncExternalStore } from "react";

export type Head = { pattern: number; step: number } | null;
export type Heads = readonly Head[];

const EMPTY: Heads = [];
let current: Heads = EMPTY;
const listeners = new Set<() => void>();

export function setHeads(h: Heads): void {
  if (h === current) return;
  current = h.length ? h : EMPTY;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const getHeads = (): Heads => current;

/** The step track `t` (0–7) is playing, if it is playing `pattern`; else null. */
export function usePlayStep(t: number, pattern: number): number | null {
  return useSyncExternalStore(subscribe, () => {
    const h = getHeads()[t];
    return h && h.pattern === pattern ? h.step : null;
  });
}

/** The steps tracks `ts` are playing in `pattern` (null where not), compared as one string. */
export function usePlaySteps(ts: readonly number[], pattern: number): (number | null)[] {
  const key = useSyncExternalStore(subscribe, () => ts.map((t) => {
    const h = getHeads()[t];
    return h && h.pattern === pattern ? h.step : "";
  }).join(","));
  return key.split(",").map((x) => (x === "" ? null : Number(x)));
}

/** The pattern track `t` (0–7) is playing, or null. */
export function usePlayingPattern(t: number): number | null {
  return useSyncExternalStore(subscribe, () => getHeads()[t]?.pattern ?? null);
}
