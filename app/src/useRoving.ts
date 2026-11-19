import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { gridMove } from "./model.ts";

/** Roving focus over a grid of buttons: one tab stop, arrow keys move, no wrapping. */
export function useRoving(rows: number, cols: number) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const ref = useCallback((i: number) => (el: HTMLButtonElement | null) => { refs.current[i] = el; }, []);
  const onKeyDown = useCallback((i: number, e: KeyboardEvent): number | null => {
    const next = gridMove(i, e.key, rows, cols);
    if (next === null) return null;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
    return next;
  }, [rows, cols]);
  return { active, setActive, ref, onKeyDown, tabIndex: (i: number) => (i === active ? 0 : -1) };
}
