import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
    "rounded-[8px] font-semibold tracking-[-0.01em]",
    "transition-all duration-150 ease-out",
    "focus-visible:outline-none",
    "disabled:pointer-events-none disabled:opacity-40",
    "active:scale-[0.97]",
  ].join(" "),
  {
    variants: {
      variant: {
        default:     "bg-[#0B0D0F] text-white shadow-sm hover:bg-[#1c1f22] hover:shadow-md active:bg-[#0B0D0F]",
        primary:     "bg-[#007F4E] text-white shadow-sm hover:bg-[#006B45] hover:shadow-md active:bg-[#007F4E]",
        destructive: "bg-red-600 text-white shadow-sm hover:bg-red-700",
        outline:     "border border-[#E0E3E6] bg-white text-[#4B5563] shadow-xs hover:bg-[#F3F4F5] hover:border-[#C9CED4]",
        ghost:       "text-[#4B5563] hover:bg-[#F3F4F5] hover:text-[#0B0D0F]",
        secondary:   "bg-[#F3F4F5] text-[#4B5563] border border-[#E0E3E6] hover:bg-[#ECEEEF]",
        success:     "bg-[#007F4E] text-white shadow-sm hover:bg-[#006B45]",
        brand:       "bg-[#E6F4EF] text-[#006B45] border border-[#9CCFBB] hover:bg-[#d8ebe2]",
        link:        "text-[#007F4E] underline-offset-4 hover:underline h-auto p-0 shadow-none",
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
