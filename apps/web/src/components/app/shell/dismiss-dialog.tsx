"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/input";
import { Radio, RadioGroup } from "~/components/ui/choice";

/**
 * Dismissal takes a reason.
 *
 * A dismiss button with no reason produces an inbox people clear without
 * reading, and the clearing tells us nothing. The reason is also the only
 * signal we would ever get that an item is badly tuned — "this should not have
 * been flagged" is a bug report that arrives for free.
 *
 * Presentational: it knows a string to show and hands back a reason. It has no
 * idea what an attention item is, which is what keeps it out of the fixture
 * import graph.
 */

export const DISMISS_REASONS = [
  { value: "expected", label: "Expected — planned work" },
  { value: "resolved", label: "Already resolved elsewhere" },
  { value: "not-actionable", label: "Not actionable by this team" },
  { value: "noise", label: "This should not have been flagged" },
];

export interface DismissDialogProps {
  /** The problem being dismissed. `null` closes the dialog. */
  problem: string | null;
  onClose: () => void;
  onConfirm: (reason: string, note: string) => void;
}

export function DismissDialog({ problem, onClose, onConfirm }: DismissDialogProps) {
  const [reason, setReason] = React.useState(DISMISS_REASONS[0].value);
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (problem !== null) {
      setReason(DISMISS_REASONS[0].value);
      setNote("");
    }
  }, [problem]);

  return (
    <Dialog.Root open={problem !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "motion-overlay z-modal fixed",
            "bg-surface-overlay border-subtle shadow-3 border",
            "inset-x-0 bottom-0 rounded-t-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:w-[min(30rem,calc(100vw-2rem))] sm:rounded-lg",
            "p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">Dismiss this item</Text>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text variant="body-sm" tone="secondary" className="mt-1 block">
              {problem ?? ""}
            </Text>
          </Dialog.Description>

          <div className="mt-4">
            <Text variant="label" tone="primary" className="mb-2 block">Why are you dismissing it?</Text>
            <RadioGroup value={reason} onValueChange={setReason} aria-label="Dismissal reason">
              {DISMISS_REASONS.map((r) => (
                <Radio key={r.value} value={r.value}>{r.label}</Radio>
              ))}
            </RadioGroup>
          </div>

          <div className="mt-3">
            <Textarea
              minRows={2}
              maxRows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the next person on call should know (optional)"
              aria-label="Dismissal note"
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button variant="primary" size="sm" onClick={() => onConfirm(reason, note)}>
              Dismiss item
            </Button>
          </div>

          <Text variant="caption" tone="muted" className="mt-3 block">
            Dismissing hides it from the inbox. It does not resolve the underlying condition, and the
            item returns if the condition worsens.
          </Text>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
