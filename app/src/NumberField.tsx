import { useEffect, useState } from "react";
import { clamp } from "./model.ts";

/** A number field that commits on Enter or blur, clamped to its range. */
export function NumberField({ label, value, min, max, onCommit, hideLabel }: { label: string; value: number; min: number; max: number; onCommit: (v: number) => void; hideLabel?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (): void => {
    const v = Number(text);
    if (!Number.isFinite(v)) { setText(String(value)); return; }
    const c = clamp(Math.round(v), min, max);
    setText(String(c));
    if (c !== value) onCommit(c);
  };
  return (
    <label>
      <span className={hideLabel ? "visually-hidden" : undefined}>{label}</span>
      <input type="number" min={min} max={max} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setText(String(value)); }} />
    </label>
  );
}

