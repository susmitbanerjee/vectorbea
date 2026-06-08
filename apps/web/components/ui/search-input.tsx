/**
 * SearchInput — light-theme search field used across registry pages.
 * Drop-in replacement for the raw <input> + absolute Search icon pattern.
 */
import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, containerClassName, ...props }, ref) => (
    <div className={cn("relative", containerClassName)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-xl border border-slate-200 bg-white",
          "pl-9 pr-3 text-[13.5px] text-slate-800",
          "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
          "placeholder:text-slate-400",
          "transition-all duration-150 outline-none",
          "hover:border-slate-300",
          "focus:border-[#9CCFBB] focus:ring-4 focus:ring-[#E6F4EF]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
SearchInput.displayName = "SearchInput";
