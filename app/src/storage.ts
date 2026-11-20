// Per-viewer conveniences remembered between launches (output port, firmware, dismissed hints).
// Storage can be missing or blocked: reads then return null and writes do nothing.

export function remembered(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function remember(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* a convenience only */ }
}

/** True when focus is in a field where keys type text (shortcuts then leave the keys alone). */
export const isTextField = (el: EventTarget | null): boolean =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
