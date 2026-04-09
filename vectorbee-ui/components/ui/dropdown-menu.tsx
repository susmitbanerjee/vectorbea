"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuContent = DropdownMenuPrimitive.Content;
const DropdownMenuItem = DropdownMenuPrimitive.Item;
const DropdownMenuLabel = DropdownMenuPrimitive.Label;
const DropdownMenuSeparator = DropdownMenuPrimitive.Separator;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
const DropdownMenuRadioItem = DropdownMenuPrimitive.RadioItem;

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
};

export function DropdownMenuPanel({
  className,
  sideOffset = 8,
  ...props
}: DropdownMenuPrimitive.DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuContent
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[12rem] overflow-hidden rounded-xl border border-white/10 bg-popover/95 p-1 text-popover-foreground shadow-[0_20px_60px_-15px_rgba(0,0,0,0.6)] backdrop-blur-xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuPanelItem({
  className,
  inset,
  ...props
}: DropdownMenuPrimitive.DropdownMenuItemProps & { inset?: boolean }) {
  return (
    <DropdownMenuItem
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-foreground outline-none transition-colors hover:bg-white/5 focus:bg-white/[0.07] focus:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuPanelLabel({
  className,
  inset,
  ...props
}: DropdownMenuPrimitive.DropdownMenuLabelProps & { inset?: boolean }) {
  return (
    <DropdownMenuLabel
      className={cn("px-2 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground", inset && "pl-8", className)}
      {...props}
    />
  );
}

export function DropdownMenuPanelSeparator({
  className,
  ...props
}: DropdownMenuPrimitive.DropdownMenuSeparatorProps) {
  return <DropdownMenuSeparator className={cn("-mx-1 my-1 h-px bg-white/8", className)} {...props} />;
}

export function DropdownMenuPanelRadioItem({
  className,
  children,
  ...props
}: DropdownMenuPrimitive.DropdownMenuRadioItemProps) {
  return (
    <DropdownMenuRadioItem
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-2.5 text-sm text-foreground outline-none transition-colors hover:bg-white/5 focus:bg-white/[0.07] focus:text-white data-[state=checked]:text-white",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5 text-primary" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuRadioItem>
  );
}
