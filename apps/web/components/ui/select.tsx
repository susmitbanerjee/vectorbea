import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Select — styled native <select> wrapper.
 *
 * The `className` prop controls the WIDTH of the outer container
 * (e.g. className="w-[160px]" or className="w-full").
 * The inner <select> always fills its container via w-full.
 *
 * This keeps selects inline in flex toolbars (no w-full blowout).
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      // className controls container width — do NOT add w-full here
      <div className={cn("relative inline-flex", className)}>
        <select
          className={cn(
            // Always fill the container
            "h-9 w-full cursor-pointer appearance-none",
            // Light-theme surface
            "rounded-xl border border-slate-200 bg-white",
            // Typography
            "px-3 py-0 pr-8",
            "text-[13.5px] font-medium text-slate-600",
            // Shadow + transitions
            "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
            "transition-all duration-150 outline-none",
            // States
            "hover:border-slate-300 hover:bg-slate-50",
            "focus:border-blue-400 focus:ring-4 focus:ring-blue-100",
            // Option colours (best-effort)
            "[&>option]:bg-white [&>option]:text-slate-800",
            // Disabled
            "disabled:cursor-not-allowed disabled:opacity-50",
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
