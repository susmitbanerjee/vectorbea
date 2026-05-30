import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative inline-flex w-full">
        <select
          className={cn(
            // Base
            "h-9 w-full cursor-pointer appearance-none",
            "rounded-xl border border-slate-200 bg-white",
            "px-3 py-0 pr-8",
            "text-[13.5px] font-medium text-slate-600",
            "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
            "transition-all duration-150 outline-none",
            // Hover
            "hover:border-slate-300 hover:bg-slate-50",
            // Focus
            "focus:border-blue-400 focus:ring-4 focus:ring-blue-100",
            // Option colours (best-effort in browser-rendered selects)
            "[&>option]:bg-white [&>option]:text-slate-800",
            // Disabled
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          ref={ref}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };
