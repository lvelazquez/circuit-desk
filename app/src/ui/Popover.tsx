// A button that opens a small panel anchored below it (Playback ▾, Export ▾). The panel grows from
// its button (transform-origin at the button's edge), enters with Medium/SmoothOut and leaves with
// the shorter Fast/SmoothIn; under reduced motion it appears and goes at once. Escape closes it and
// puts focus back on the button; a click outside closes it.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function Popover({ label, tip, align = "start", children }: {
  /** The button's text, e.g. "Playback ▾". */
  label: string;
  tip: string;
  /** Which edge of the button the panel lines up with (and grows from). */
  align?: "start" | "end";
  /** The panel's content; `close` closes it (e.g. after choosing an action). */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const close = (refocus = true): void => {
    if (!open || leaving) return;
    const el = panel.current;
    const finish = (): void => { setLeaving(false); setOpen(false); if (refocus) button.current?.focus(); };
    // No exit animation to wait for (reduced motion, or not rendered): close now.
    if (!el || parseFloat(getComputedStyle(el).animationDuration) === 0) { finish(); return; }
    setLeaving(true);
    const done = (): void => { el.removeEventListener("animationend", done); finish(); };
    el.addEventListener("animationend", done);
  };

  // On open: focus the first control inside.
  useEffect(() => {
    if (open && !leaving) panel.current?.querySelector<HTMLElement>("button, select, input, [tabindex]")?.focus();
  }, [open, leaving]);

  // A press outside closes it (focus stays where the press put it).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => { if (!wrap.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  });

  return (
    <div className="popover-anchor" ref={wrap} onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}>
      <button ref={button} type="button" className="btn" aria-expanded={open} aria-controls={id} data-tip={tip}
        onClick={() => (open ? close() : setOpen(true))}>{label}</button>
      <div ref={panel} id={id} role="dialog" aria-label={label.replace(/\s*▾$/, "")} className="popover" data-align={align}
        data-state={leaving ? "leaving" : "open"} hidden={!open}>
        {open && children(() => close())}
      </div>
    </div>
  );
}
