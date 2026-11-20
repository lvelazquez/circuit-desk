// A text field that commits once: on Enter or when it loses focus. Escape puts the saved value
// back. Used for names (project, patch), so each rename is one undoable edit.
import { useEffect, useState } from "react";

export function TextField({ label, value, maxLength, valid, onCommit, tip, hideLabel }: {
  label: string;
  value: string;
  maxLength: number;
  /** Extra rule beyond the length, e.g. printable ASCII only. */
  valid?: (text: string) => boolean;
  onCommit: (text: string) => void;
  tip: string;
  hideLabel?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const ok = text.length <= maxLength && (valid ? valid(text) : true);
  const commit = (): void => {
    const t = text.trim();
    if (ok && t && t !== value) onCommit(t);
    else setText(value);
  };
  return (
    <label>
      {hideLabel ? <span className="visually-hidden">{label}</span> : label}
      <input type="text" value={text} maxLength={maxLength} aria-invalid={!ok} data-tip={tip}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setText(value); }} />
    </label>
  );
}

/** Letters, digits and plain punctuation: what the device's name fields store. */
export const printableAscii = (t: string): boolean => /^[\x20-\x7e]*$/.test(t);
