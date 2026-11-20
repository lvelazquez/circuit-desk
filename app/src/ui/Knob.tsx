// A round knob, 0–127, like the device's macro knobs. It is a slider to assistive tech and the
// keyboard: arrows step by 1 (Shift: 10), Page Up/Down by 10, Home/End go to the ends; each key
// step is one edit. A vertical drag moves it and commits once on release.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { clamp } from "../model.ts";

const MAX = 127;
/** Pixels of vertical drag per step. */
const DRAG_PX = 2;

export function Knob({ label, value, onCommit, tip, disabled }: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  tip: string;
  disabled?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const drag = useRef<{ y: number; start: number } | null>(null);

  const key = (k: string, shift: boolean): number | null => {
    const big = 10, step = shift ? big : 1;
    switch (k) {
      case "ArrowUp": case "ArrowRight": return v + step;
      case "ArrowDown": case "ArrowLeft": return v - step;
      case "PageUp": return v + big;
      case "PageDown": return v - big;
      case "Home": return 0;
      case "End": return MAX;
      default: return null;
    }
  };

  return (
    <div className="knob" data-disabled={disabled || undefined}>
      <span role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={0} aria-valuemax={MAX} aria-valuenow={v}
        aria-disabled={disabled || undefined} data-tip={tip} style={{ "--knob-pos": v / MAX } as CSSProperties}
        onKeyDown={(e) => {
          if (disabled) return;
          const n = key(e.key, e.shiftKey);
          if (n === null) return;
          e.preventDefault();
          const c = clamp(n, 0, MAX);
          setV(c);
          if (c !== value) onCommit(c);
        }}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.focus();
          drag.current = { y: e.clientY, start: v };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setV(clamp(d.start + Math.round((d.y - e.clientY) / DRAG_PX), 0, MAX));
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          if (v !== value) onCommit(v);
        }}
        onPointerCancel={() => { drag.current = null; setV(value); }} />
      <span className="knob-label">{label}</span>
      <output className="knob-value" aria-hidden="true">{disabled ? "–" : v}</output>
    </div>
  );
}
