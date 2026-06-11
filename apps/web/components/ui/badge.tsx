import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold transition-colors leading-none",
  {
    variants: {
      variant: {
        default:     "border border-blue-200 bg-blue-50 text-blue-700",
        secondary:   "border border-slate-200 bg-slate-100 text-slate-600",
        outline:     "border border-slate-200 bg-white text-slate-600",
        success:     "border border-emerald-200 bg-emerald-50 text-emerald-700",
        warning:     "border border-amber-200 bg-amber-50 text-amber-800",
        destructive: "border border-red-200 bg-red-50 text-red-700",
        purple:      "border border-violet-200 bg-violet-50 text-violet-700",
        cyan:        "border border-cyan-200 bg-cyan-50 text-cyan-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
