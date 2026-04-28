"use client";

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
        default:     "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md hover:-translate-y-px",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-md hover:-translate-y-px",
        outline:     "border border-border bg-transparent text-foreground hover:bg-muted/60 hover:border-border/80 hover:-translate-y-px",
        ghost:       "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        secondary:   "bg-secondary text-secondary-foreground border border-border/50 hover:bg-secondary/80 hover:-translate-y-px",
        success:     "bg-success text-success-foreground shadow-sm hover:bg-success/90 hover:shadow-md hover:-translate-y-px",
        brand:       "bg-primary/[0.08] text-primary border border-primary/20 hover:bg-primary/[0.14] hover:border-primary/30 hover:-translate-y-px",
        link:        "text-primary underline-offset-4 hover:underline h-auto p-0",
      },
      size: {
        default:   "h-9 px-4 py-2",
        sm:        "h-8 px-3 py-1.5 text-xs rounded-md",
        lg:        "h-11 px-6 py-2.5 text-[0.9375rem]",
        xl:        "h-12 px-8 py-3 text-[0.9375rem]",
        icon:      "h-9 w-9 p-0",
        "icon-sm": "h-8 w-8 p-0",
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