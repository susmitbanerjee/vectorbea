import type { ReactNode } from "react";
import { AlertTriangle, Info, Terminal } from "lucide-react";
import { CopyButton } from "@/components/docs/copy-button";

// ─── Code block ───────────────────────────────────────────────────────────────

export function Code({ lang, children }: { lang?: string; children: string }) {
  const trimmed = children.trim();
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/40 bg-[#0d1117] shadow-sm">
      <div className="flex items-center justify-between border-b border-border/30 bg-white/[0.03] px-4 py-1.5">
        <div className="flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground/50" />
          {lang && (
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/50">
              {lang}
            </span>
          )}
        </div>
        <CopyButton text={trimmed} />
      </div>
      <pre className="overflow-x-auto px-5 py-4 text-sm leading-relaxed text-slate-200">
        <code>{trimmed}</code>
      </pre>
    </div>
  );
}

// ─── Inline code ──────────────────────────────────────────────────────────────

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-mono text-foreground">
      {children}
    </code>
  );
}

// ─── Callout ─────────────────────────────────────────────────────────────────

export function Callout({
  kind = "info",
  children,
}: {
  kind?: "info" | "warn";
  children: ReactNode;
}) {
  const styles =
    kind === "warn"
      ? "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300"
      : "border-primary/30 bg-primary/5 text-foreground";
  const Icon = kind === "warn" ? AlertTriangle : Info;
  return (
    <div className={`flex gap-3 rounded-xl border p-4 text-sm leading-relaxed ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
      <div>{children}</div>
    </div>
  );
}

// ─── Step ─────────────────────────────────────────────────────────────────────

export function Step({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="space-y-4 scroll-mt-24">
      <div className="flex items-center gap-3 border-t border-border/60 pt-8">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {n}
        </span>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}
