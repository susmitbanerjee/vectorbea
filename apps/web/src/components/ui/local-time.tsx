"use client";

import * as React from "react";
import { formatClock, formatDateTime, useTimeZone } from "~/lib/time/time-zone";

/**
 * A timestamp in the viewer's time zone (Settings → Profile, else the browser's).
 *
 * `datetime` — `15 Sep 2026, 14:05:32 GMT+5:30`; `clock` — `14:05:32`;
 * `short` — `15 Sep 2026, 14:05`.
 */
export function LocalTime({
  at,
  format = "datetime",
  className,
}: {
  at: string | number | Date;
  format?: "datetime" | "clock" | "short";
  className?: string;
}) {
  const timeZone = useTimeZone();
  const text =
    format === "clock" ? formatClock(at, timeZone)
    : format === "short" ? formatDateTime(at, timeZone, { seconds: false, zone: false })
    : formatDateTime(at, timeZone);
  const iso = React.useMemo(() => {
    const date = at instanceof Date ? at : new Date(at);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }, [at]);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
