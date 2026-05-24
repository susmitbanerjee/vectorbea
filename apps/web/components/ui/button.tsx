import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-lg text-sm font-medium tracking-[-0.01em]",
    "transition-all duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40",
    "active:scale-[0.97]",
  ].join(" "),
  {
    variants: {
      variant: {
        default:     "bg-[#111827] text-white shadow-xs hover:bg-[#1F2937] active:bg-[#111827]",
        destructive: "bg-destructive text-white shadow-xs hover:bg-red-700",
        outline:     "border border-border bg-white text-foreground hover:bg-[#F1F3F5] hover:border-[#D1D5DB]",
        ghost:       "text-muted-foreground hover:bg-[#F1F3F5] hover:text-foreground",
        secondary:   "bg-[#F1F3F5] text-foreground border border-border hover:bg-[#E5E7EB]",
        success:     "bg-emerald-600 text-white shadow-xs hover:bg-emerald-700",
        brand:       "bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE] hover:bg-[#DBEAFE] hover:border-[#93C5FD]",
        link:        "text-[#2563EB] underline-offset-4 hover:underline h-auto p-0",
      },
      size: {
        default:   "h-8 px-3.5 py-1.5 text-[13px]",
        sm:        "h-7 px-2.5 py-1 text-[12px] rounded-md",
        lg:        "h-10 px-5 py-2 text-[14px]",
        xl:        "h-11 px-7 py-2.5 text-[14px]",
        icon:      "h-8 w-8 p-0",
        "icon-sm": "h-7 w-7 p-0",
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