"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { isMockMode } from "~/lib/api/config";

/**
 * <MockModeBadge> — the app is running on fixtures.
 *
 * Deliberately hard to miss and impossible to dismiss. The failure this guards
 * against is someone demoing mock data to a customer believing it is real, and
 * a badge that can be closed, or that fades after a few seconds, does not
 * prevent that. It sits above everything, ignores pointer events so it never
 * blocks a control, and stays for the whole session.
 *
 * `status-waiting` (ember) rather than `status-failed`: nothing is broken, but
 * nothing here is real either. Brand colour would be wrong twice over — it is
 * reserved from status, and this is emphatically not a feature to celebrate.
 */
export function MockModeBadge() {
  if (!isMockMode()) return null;

  return (
    <div
      // aria-live is wrong here: this is a persistent condition, not an event,
      // and announcing it on every route change would be noise. A role="status"
      // landmark lets a screen reader user find it on demand.
      role="status"
      aria-label="Mock data mode. Nothing on this screen is real."
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center",
        "px-4 pt-2",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-3 py-1",
          "border border-status-waiting-border bg-status-waiting-subtle",
          "text-xs font-medium tracking-wide text-status-waiting",
          "shadow-2",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full bg-status-waiting",
            // Opacity only, and only when the user has not asked for stillness.
            "motion-safe:animate-pulse",
          )}
        />
        Mock data — nothing here is real
      </span>
    </div>
  );
}
