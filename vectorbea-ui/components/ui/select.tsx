import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          className={cn(
            "flex h-9 w-full cursor-pointer appearance-none rounded-xl border border-slate-800/80 bg-slate-950/70 bg-none px-3 py-1 pr-9 text-sm text-slate-100 shadow-sm shadow-black/10 transition-all duration-200 hover:border-slate-700 hover:bg-slate-900/80 focus:border-cyan-500/50 focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:[color-scheme:dark] [&>option]:bg-slate-950 [&>option]:text-slate-100",
            className,
          )}
          ref={ref}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };
