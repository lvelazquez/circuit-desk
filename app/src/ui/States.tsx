// What a view shows before its data arrives, when loading failed, or when there is nothing to show:
// the same three states everywhere, announced politely to screen readers.
import type { ReactNode } from "react";

export function Loading({ what }: { what?: string }) {
  return <p className="empty" role="status">Loading{what ? ` ${what}` : ""}…</p>;
}

export function ErrorState({ message }: { message: string }) {
  return <p className="empty error" role="alert">{message}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
