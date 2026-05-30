import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-[38px] w-full rounded-[10px] border border-slate-200 bg-white px-3.5 py-2 text-[13.5px] text-slate-900",
        "transition-all duration-150",
        "placeholder:text-slate-400",
        "hover:border-slate-300",
        "focus:border-blue-500 focus:outline-none focus:ring-3 focus:ring-blue-500/12",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
