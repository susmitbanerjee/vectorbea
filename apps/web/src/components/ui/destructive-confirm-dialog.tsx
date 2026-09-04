"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type * as React from "react";
import { cn } from "~/lib/cn";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

export function DestructiveConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "motion-overlay z-modal fixed p-4",
            "bg-surface-overlay border-subtle shadow-3 border",
            "inset-x-0 bottom-0 rounded-t-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(30rem,calc(100vw-2rem))]",
            "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">{title}</Text>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text variant="body-sm" tone="secondary" className="mt-1 block">
              {description}
            </Text>
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button size="sm" variant="secondary" disabled={pending}>Keep as is</Button>
            </Dialog.Close>
            <Button
              size="sm"
              variant="danger"
              loading={pending}
              loadingLabel="Working"
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
