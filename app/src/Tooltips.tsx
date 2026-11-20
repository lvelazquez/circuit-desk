// One tooltip for the whole window. Any element with `data-tip="…"` gets it:
// - on hover, after a short delay (--motion-delay-tooltip), and at once on keyboard focus;
// - hidden by Escape, a press, scrolling, or leaving (the pointer may move onto the tip itself,
//   so it can be read and selected: WCAG 1.4.13, dismissible / hoverable / persistent);
// - linked to its element with aria-describedby while shown, so screen readers announce it.
// The tip grows from its trigger (transform-origin on the trigger's side) and leaves at once:
// entries are longer than exits. Reduced motion turns the entry off (the motion tokens go to 0).
import { useEffect, useRef, useState } from "react";

export const TIP_ID = "app-tooltip";

interface Tip { text: string; x: number; y: number; side: "below" | "above" }

function cssNumber(name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

/** A time token in ms. The production CSS build may write 500ms as .5s, so both units are read. */
function cssMs(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) return fallback;
  return /ms$/.test(raw) ? v : /s$/.test(raw) ? v * 1000 : v;
}

function describe(el: Element, on: boolean): void {
  const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((x) => x && x !== TIP_ID);
  if (on) ids.push(TIP_ID);
  if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
  else el.removeAttribute("aria-describedby");
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let target: HTMLElement | null = null;
    /** When the pointer last pressed: focus that follows a press is the pointer's, not the keyboard's. */
    let pressed = -Infinity;
    const show = (el: HTMLElement): void => {
      const text = el.dataset["tip"];
      if (!text || !el.isConnected) return;
      target = el;
      describe(el, true);
      const r = el.getBoundingClientRect();
      const half = cssNumber("--size-tooltip", 280) / 2, margin = cssNumber("--space-sm", 8), gap = cssNumber("--space-xs", 4);
      const x = Math.min(Math.max(r.left + r.width / 2, half + margin), window.innerWidth - half - margin);
      const below = r.bottom + gap + cssNumber("--size-tooltip-room", 96) < window.innerHeight;
      setTip({ text, x, y: below ? r.bottom + gap : r.top - gap, side: below ? "below" : "above" });
    };
    const hide = (): void => {
      window.clearTimeout(timer);
      if (target) describe(target, false);
      target = null;
      setTip(null);
    };
    const tipOf = (e: Event): HTMLElement | null => (e.target instanceof Element ? e.target.closest<HTMLElement>("[data-tip]") : null);

    const onOver = (e: PointerEvent): void => {
      if (node.current?.contains(e.target as Node)) return; // reading the tip keeps it
      const el = tipOf(e);
      if (el === target) return;
      if (target || timer) hide();
      if (el) timer = window.setTimeout(() => { timer = 0; show(el); }, cssMs("--motion-delay-tooltip", 500));
    };
    const onOut = (e: PointerEvent): void => {
      const to = e.relatedTarget as Node | null;
      if (to && (target?.contains(to) || node.current?.contains(to))) return;
      if (!to || !(to instanceof Element) || !to.closest("[data-tip]")) hide();
    };
    const onFocus = (e: FocusEvent): void => {
      const el = tipOf(e);
      if (!el || performance.now() - pressed < 400) return;
      hide();
      show(el);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape" && target) hide(); };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    const onPress = (): void => { pressed = performance.now(); hide(); };
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Always mounted, so aria-describedby never points at nothing.
  return (
    <div ref={node} id={TIP_ID} role="tooltip" className="tooltip" hidden={!tip} data-side={tip?.side}
      key={tip ? `${tip.x},${tip.y},${tip.text}` : "none"}
      style={tip ? { left: tip.x, top: tip.y } : undefined}>
      {tip?.text}
    </div>
  );
}
