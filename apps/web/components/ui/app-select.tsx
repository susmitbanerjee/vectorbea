"use client";

/**
 * AppSelect — Vectorbea's common themed dropdown/select component.
 *
 * Uses Radix UI DropdownMenu under the hood so the opened menu is
 * fully custom-styled (not a raw native browser dropdown). Both the
 * closed trigger AND the opened item list follow Vectorbea's light theme.
 *
 * API:
 *   <AppSelect
 *     value={typeFilter}
 *     onValueChange={(v) => setTypeFilter(v)}
 *     options={[{ label: "All types", value: "" }, ...]}
 *     className="w-[150px]"     ← controls the trigger width
 *   />
 */

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface AppSelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface AppSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Controls the trigger container width, e.g. "w-[150px]" or "w-full" */
  className?: string;
}

export function AppSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
}: AppSelectProps) {
  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label ?? placeholder ?? "Select…";

  return (
    <DropdownMenuPrimitive.Root>
      {/* ── Trigger ─────────────────────────────────────────────────────── */}
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            // Layout
            "inline-flex h-9 items-center justify-between gap-2 rounded-xl border px-3",
            // Surface
            "border-slate-200 bg-white",
            "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
            // Typography
            "text-[13.5px] font-medium",
            selected ? "text-slate-700" : "text-slate-400",
            // Transitions
            "transition-all duration-150 outline-none",
            // Hover
            "hover:border-slate-300 hover:bg-slate-50",
            // Focus / open
            "focus-visible:border-blue-400 focus-visible:ring-4 focus-visible:ring-blue-100",
            "data-[state=open]:border-blue-400 data-[state=open]:ring-4 data-[state=open]:ring-blue-100",
            // Disabled
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="min-w-0 truncate">{displayLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuPrimitive.Trigger>

      {/* ── Dropdown menu ───────────────────────────────────────────────── */}
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={6}
          className={cn(
            "z-[80] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5",
            "shadow-[0_18px_40px_rgba(15,23,42,0.12),0_4px_12px_rgba(15,23,42,0.06)]",
            // Match trigger width so it doesn't look misaligned
            "min-w-[var(--radix-dropdown-menu-trigger-width)]",
            // Animations
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          )}
        >
          {options.map((option) => {
            const isSelected = value === option.value;
            return (
              <DropdownMenuPrimitive.Item
                key={option.value}
                disabled={option.disabled}
                onSelect={() => onValueChange(option.value)}
                className={cn(
                  // Layout
                  "relative flex h-9 cursor-pointer select-none items-center justify-between gap-2 rounded-xl px-3",
                  // Typography
                  "text-[13.5px] font-medium outline-none",
                  // Transitions
                  "transition-colors duration-100",
                  // States
                  isSelected
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:text-slate-900",
                  option.disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <span>{option.label}</span>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                )}
              </DropdownMenuPrimitive.Item>
            );
          })}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

/**
 * AppSelectFromChildren — convenience wrapper that accepts native
 * <option> children and converts them to AppSelect options internally.
 * Used by the WorkflowInspector ISelect to avoid rewriting every call site.
 */
export function AppSelectFromChildren({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const options: AppSelectOption[] = React.Children.toArray(children)
    .filter(React.isValidElement)
    .map((child) => {
      const el = child as React.ReactElement<{
        value?: string;
        children?: React.ReactNode;
        disabled?: boolean;
      }>;
      return {
        value: String(el.props.value ?? ""),
        label: String(el.props.children ?? el.props.value ?? ""),
        disabled: el.props.disabled,
      };
    });

  return (
    <AppSelect
      value={value}
      onValueChange={onChange}
      options={options}
      className={className ?? "w-full"}
    />
  );
}
