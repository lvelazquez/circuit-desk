// Per-viewer conveniences remembered between launches (output port, firmware, dismissed hints).
// Storage can be missing or blocked: reads then return null and writes do nothing.

export function remembered(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function remember(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* a convenience only */ }
}

const TEXT_INPUTS = new Set(["text", "search", "number", "email", "url", "password", "tel"]);

/** True when focus is in a field where keys type text: Undo and Redo then edit that text, not the project. */
export const isTextField = (el: EventTarget | null): boolean =>
  (el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type)) || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);

/** True when focus is on any form control (sliders, selects, checkboxes too): the computer-keyboard player leaves keys alone. */
export const isFormControl = (el: EventTarget | null): boolean =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
