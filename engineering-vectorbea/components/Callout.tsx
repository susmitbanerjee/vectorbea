import type { ReactNode } from "react";

const ICONS: Record<string, string> = {
  decision: "◆",
  tradeoff: "⇄",
  note: "ℹ",
  warning: "▲",
  lesson: "✓",
};

const LABELS: Record<string, string> = {
  decision: "Design decision",
  tradeoff: "Tradeoff",
  note: "Note",
  warning: "Warning",
  lesson: "Lesson learned",
};

export function Callout({
  type = "note",
  title,
  children,
}: {
  type?: "decision" | "tradeoff" | "note" | "warning" | "lesson";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`callout callout-${type}`}>
      <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <span aria-hidden>{ICONS[type] ?? "ℹ"}</span>
        {title ?? LABELS[type] ?? "Note"}
      </p>
      <div className="text-sm leading-relaxed text-slate-600 [&>p]:my-1">{children}</div>
    </div>
  );
}
