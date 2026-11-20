// A titled group of controls (a fieldset with its legend), optionally in a track's colour.
import type { CSSProperties, ReactNode } from "react";

export function Panel({ title, style, className, children }: { title: string; style?: CSSProperties; className?: string; children: ReactNode }) {
  return (
    <fieldset className={`fx-panel${className ? ` ${className}` : ""}`} style={style}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}
