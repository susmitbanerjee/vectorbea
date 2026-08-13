"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { Kbd } from "~/components/ui/kbd";
import { Text } from "~/components/ui/text";
import { useKeyboard } from "~/lib/keyboard";

/**
 * <ShortcutsSheet> — press ?
 *
 * Reads the LIVE registry rather than a hand-maintained list. A shortcuts sheet
 * that is written separately from the shortcuts drifts within a week, and the
 * drift is silent: the binding still works, the documentation just stops
 * mentioning it. Registering is the only way to add one, so this cannot go
 * stale.
 */
export function ShortcutsSheet({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { shortcuts } = useKeyboard();

  const groups = React.useMemo(() => {
    const visible = shortcuts.filter((s) => !s.hidden);
    const byGroup = new Map<string, typeof visible>();
    for (const s of visible) {
      const list = byGroup.get(s.group) ?? [];
      list.push(s);
      byGroup.set(s.group, list);
    }
    // Stable, meaningful order rather than insertion order.
    const order = ["Global", "Navigate", "Palette"];
    return [...byGroup.entries()].sort(
      (a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99,
    );
  }, [shortcuts]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "motion-overlay z-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "bg-surface-overlay border-subtle shadow-3 border",
            "w-[min(34rem,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto rounded-lg",
          )}
        >
          <div className="border-subtle flex items-center justify-between gap-3 border-b px-4 py-3">
            <Dialog.Title asChild>
              <Text variant="heading-md" tone="max">Keyboard shortcuts</Text>
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className={cn(
                "text-fg-muted grid size-6 place-items-center rounded-sm",
                "transition-colors duration-fast outline-none",
                "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
              )}
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </Dialog.Close>
          </div>

          <Dialog.Description asChild>
            <Text variant="caption" tone="muted" className="block px-4 pt-3">
              Shortcuts never fire while a text field has focus.
            </Text>
          </Dialog.Description>

          <div className="grid gap-5 p-4">
            {groups.map(([group, items]) => (
              <div key={group}>
                <Text variant="eyebrow" tone="muted" className="mb-2 block">{group}</Text>
                <div className="grid gap-0.5">
                  {items.map((s) => (
                    <div
                      key={`${s.group}-${s.keys}`}
                      className="flex items-center justify-between gap-4 rounded-xs px-2 py-1.5"
                    >
                      <Text variant="body-sm" tone="secondary">{s.label}</Text>
                      <Kbd keys={s.keys} size="md" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
