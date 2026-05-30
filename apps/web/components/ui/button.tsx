import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
    "rounded-[10px] font-semibold tracking-[-0.01em]",
    "transition-all duration-150 ease-out",
    "focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-40",
    "active:scale-[0.97]",
  ].join(" "),
  {
    variants: {
      variant: {
        default:     "bg-slate-900 text-white shadow-sm hover:bg-slate-800 hover:shadow-md active:bg-slate-900",
        primary:     "bg-blue-600 text-white shadow-sm hover:bg-blue-700 hover:shadow-md active:bg-blue-600",
        destructive: "bg-red-600 text-white shadow-sm hover:bg-red-700",
        outline:     "border border-slate-200 bg-white text-slate-700 shadow-xs hover:bg-slate-50 hover:border-slate-300",
        ghost:       "text-slate-600 hover:bg-slate-100 hover:text-slate-800",
        secondary:   "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200",
        success:     "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
        brand:       "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:border-blue-300",
        link:        "text-blue-600 underline-offset-4 hover:underline h-auto p-0 shadow-none",
      },
      size: {
        default:   "h-[36px] px-4 text-[13.5px]",
        sm:        "h-[30px] px-3 text-[12.5px] rounded-[8px]",
        lg:        "h-[40px] px-5 text-[14px]",
        xl:        "h-11 px-7 text-[14.5px] rounded-xl",
        icon:      "h-[36px] w-[36px] p-0",
        "icon-sm": "h-[30px] w-[30px] p-0 rounded-[8px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
