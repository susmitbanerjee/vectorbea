import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Compact version for inline contexts */
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, className, compact = false }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-6 text-center",
        compact ? "py-10" : "py-16",
        "border-slate-200 bg-slate-50/60",
        className,
      )}
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Icon className="h-5.5 w-5.5 text-slate-400" />
        </div>
      )}
      <div className="space-y-1.5 max-w-xs">
        <p className="text-[14px] font-semibold text-slate-800">{title}</p>
        {description && (
          <p className="text-[13px] leading-[1.6] text-slate-500">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
