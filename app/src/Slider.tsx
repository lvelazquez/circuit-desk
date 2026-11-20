import { useEffect, useState } from "react";

/**
 * A 0–127 (or other range) slider that shows its value while it moves and commits once: on
 * pointer release, on a key release, or on blur. Each commit is one undoable edit.
 */
export function Slider({ label, value, min = 0, max = 127, onCommit, text, hideLabel }: {
  label: string; value: number; min?: number; max?: number; onCommit: (v: number) => void;
  /** The value as words, for the readout and screen readers (e.g. "L 20", "centre"). */
  text?: (v: number) => string;
  hideLabel?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = (): void => { if (v !== value) onCommit(v); };
  const shown = text ? text(v) : String(v);
  return (
    <label className="slider">
      <span className={hideLabel ? "visually-hidden" : "slider-label"}>{label}</span>
      <input type="range" min={min} max={max} step={1} value={v} aria-valuetext={shown}
        onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <output aria-hidden="true">{shown}</output>
    </label>
  );
}

/** Pan as words: 64 is the centre. */
export const panText = (v: number): string => (v === 64 ? "C" : v < 64 ? `L${64 - v}` : `R${v - 64}`);
/** A bipolar knob with 64 = no change. */
export const centreText = (v: number): string => (v === 64 ? "0" : v < 64 ? `−${64 - v}` : `+${v - 64}`);
