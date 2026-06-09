"use client";

/**
 * page-kit — shared control-plane UI primitives in the Vectorbea green theme.
 * Used to give Overview / Agents / Schedules / Workflows / Runs / Approvals
 * a consistent layout language. Presentational only.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "@/lib/utils";

/* ── Mono section label (e.g. "01 · ACTIVE RUNS") ─────────────────────────── */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("vb-mono-label", className)}>{children}</span>;
}

/* ── Card / panel surface ─────────────────────────────────────────────────── */
export function Panel({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border border-[#E0E3E6] bg-white",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Panel header (title + optional action) ───────────────────────────────── */
export function PanelHeader({
  label,
  title,
  action,
}: {
  label?: string;
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        {label && <SectionLabel className="mb-1.5 block">{label}</SectionLabel>}
        <h3 className="text-[15px] font-bold tracking-[-0.01em] text-[#0B0D0F]">{title}</h3>
      </div>
      {action}
    </div>
  );
}

/* ── Stat tile — metric with optional mini bar chart ──────────────────────── */
export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  accent = "#0B0D0F",
  bars,
  barTint = "#007F4E",
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  accent?: string;
  bars?: number[];
  barTint?: string;
  href?: Route;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#9CA3AF]">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-[#C9CED4]" />}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em]" style={{ color: accent }}>
          {value}
        </span>
        {sub && <span className="mb-0.5 text-[12px] text-[#6B7280]">{sub}</span>}
      </div>
      {bars && (
        <div className="mt-3 flex items-end gap-[3px]" style={{ height: 30 }}>
          {bars.map((v, i) => (
            <span
              key={i}
              className="flex-1 rounded-[2px]"
              style={{ height: `${Math.max(6, v)}%`, background: barTint, opacity: 0.3 + (i / bars.length) * 0.7 }}
            />
          ))}
        </div>
      )}
    </>
  );
  const cls = "block rounded-[12px] border border-[#E0E3E6] bg-white p-4 transition-colors";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-[#C9CED4]")}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/* ── Checkpoint diamond motif ─────────────────────────────────────────────── */
export function Diamond({ size = 9, color = "#007F4E" }: { size?: number; color?: string }) {
  return (
    <span
      className="inline-block rotate-45 rounded-[2px]"
      style={{ width: size, height: size, background: "#FFFFFF", border: `2px solid ${color}` }}
    />
  );
}

/* ── Status chip (semantic) ───────────────────────────────────────────────── */
const CHIP: Record<string, { bg: string; fg: string; bd: string; dot: string }> = {
  green:   { bg: "#E6F4EF", fg: "#006B45", bd: "#9CCFBB", dot: "#007F4E" },
  teal:    { bg: "#F0FDFA", fg: "#0F766E", bd: "#99F6E4", dot: "#0F766E" },
  amber:   { bg: "#FFFBEB", fg: "#92400E", bd: "#FDE68A", dot: "#CA8A04" },
  red:     { bg: "#FEF2F2", fg: "#B91C1C", bd: "#FECACA", dot: "#DC2626" },
  gray:    { bg: "#F3F4F5", fg: "#4B5563", bd: "#E0E3E6", dot: "#9CA3AF" },
  violet:  { bg: "#F5F3FF", fg: "#6D28D9", bd: "#DDD6FE", dot: "#7C3AED" },
};
export function Chip({
  tone = "gray",
  children,
  dot = true,
  pulse = false,
}: {
  tone?: keyof typeof CHIP;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
}) {
  const c = CHIP[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold leading-none"
      style={{ background: c.bg, color: c.fg, borderColor: c.bd }}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", pulse && "animate-pulse")} style={{ background: c.dot }} />}
      {children}
    </span>
  );
}

/* ── Filter tab group (segmented) ─────────────────────────────────────────── */
export function FilterTabs({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-[9px] border border-[#E0E3E6] bg-white p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[12.5px] font-medium transition-colors",
              active ? "bg-[#0B0D0F] text-white" : "text-[#4B5563] hover:bg-[#F3F4F5]",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
                  active ? "bg-white/20 text-white" : "bg-[#F3F4F5] text-[#6B7280]",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Empty hint ───────────────────────────────────────────────────────────── */
export function EmptyHint({
  icon: Icon,
  title,
  desc,
  action,
}: {
  icon: LucideIcon;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-[#D7DBE0] bg-[#FAFBFB] px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-[11px] border border-[#9CCFBB] bg-[#E6F4EF] text-[#007F4E]">
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <p className="mt-4 text-[14px] font-semibold text-[#0B0D0F]">{title}</p>
      {desc && <p className="mt-1 max-w-[340px] text-[13px] leading-[1.55] text-[#6B7280]">{desc}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
