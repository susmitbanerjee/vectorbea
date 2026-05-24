import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  /** Optional color accent: "emerald" | "red" | "amber" | "blue" | "violet" */
  accent?: "emerald" | "red" | "amber" | "blue" | "violet";
  className?: string;
}

const ACCENT_ICON: Record<string, string> = {
  emerald: "text-emerald-500",
  red:     "text-red-500",
  amber:   "text-amber-500",
  blue:    "text-blue-500",
  violet:  "text-violet-500",
};

const ACCENT_VALUE: Record<string, string> = {
  emerald: "text-emerald-700",
  red:     "text-red-700",
  amber:   "text-amber-700",
  blue:    "text-[#1D4ED8]",
  violet:  "text-violet-700",
};

export function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-white px-4 py-3.5 shadow-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          {label}
        </p>
        {Icon && (
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              accent ? ACCENT_ICON[accent] : "text-muted-foreground/50",
            )}
          />
        )}
      </div>
      <p
        className={cn(
          "mt-1.5 text-[22px] font-semibold leading-none tabular-nums",
          accent ? ACCENT_VALUE[accent] : "text-foreground",
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}
