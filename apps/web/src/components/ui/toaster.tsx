"use client";

import { Toaster as SonnerToaster } from "sonner";
import { CheckCircle, Info, Spinner, Warning, XCircle } from "@phosphor-icons/react/dist/ssr";

/**
 * <Toaster> — notifications on the token layer.
 *
 * Replaces the legacy toaster, which used the old theme's card classes and
 * sonner's `richColors` (saturated green and red fills). Unstyled sonner with
 * token classes, so a toast follows the light and dark themes like every other
 * surface, and status is carried by the icon rather than by a filled background.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      gap={8}
      visibleToasts={4}
      icons={{
        success: <CheckCircle size={16} weight="fill" className="text-status-success" aria-hidden="true" />,
        error: <XCircle size={16} weight="fill" className="text-status-failed" aria-hidden="true" />,
        warning: <Warning size={16} weight="fill" className="text-status-waiting" aria-hidden="true" />,
        info: <Info size={16} weight="fill" className="text-fg-muted" aria-hidden="true" />,
        loading: <Spinner size={16} className="text-fg-muted motion-safe:animate-spin" aria-hidden="true" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "font-ui bg-surface-overlay border-subtle shadow-3 flex w-[var(--width)] items-start gap-2.5 rounded-lg border px-3.5 py-3",
          icon: "mt-0.5 shrink-0",
          content: "min-w-0 flex-1",
          title: "text-body-sm text-fg-primary font-medium",
          description: "text-caption text-fg-secondary mt-0.5 block",
          actionButton:
            "font-ui text-caption bg-accent text-fg-on-accent shrink-0 rounded-sm px-2 py-1 outline-none focus-visible:focus-ring",
          cancelButton:
            "font-ui text-caption text-fg-secondary hover:text-fg-primary shrink-0 rounded-sm px-2 py-1 outline-none focus-visible:focus-ring",
          closeButton: "text-fg-muted hover:text-fg-primary",
        },
      }}
    />
  );
}
