"use client";

import * as React from "react";
import { Combobox, type ComboboxOption } from "./combobox";
import type { ControlSize } from "./field";

/**
 * <TimezonePicker> — IANA zone selection.
 *
 * The list comes from `Intl.supportedValuesOf("timeZone")` — around 400 zones,
 * shipped by the runtime, so there is no bundled timezone table to go stale when
 * a government moves a DST boundary. Falls back to a small curated list on
 * engines without the API.
 *
 * Each option shows the CURRENT UTC OFFSET, computed live. That is the piece
 * operators actually need: "Europe/London" means nothing at 2am during an
 * incident, "Europe/London UTC+1" does. Offsets are recomputed on mount rather
 * than cached, so the list is correct on either side of a DST change.
 *
 * Rendered through <Combobox>, which virtualises past 40 rows — necessary here,
 * as 400 mounted rows is the difference between an instant menu and a stutter.
 */

const FALLBACK_ZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Madrid", "Asia/Dubai",
  "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];

function listZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    const zones = intl.supportedValuesOf?.("timeZone");
    if (zones && zones.length > 0) return zones;
  } catch {
    // Engine does not implement it — fall through.
  }
  return FALLBACK_ZONES;
}

/** Current offset for a zone, as "UTC+05:30". */
function offsetLabel(timeZone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at);
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    // longOffset yields "GMT+05:30"; normalise to UTC and tidy bare GMT.
    if (name) return name.replace("GMT", "UTC").replace(/^UTC$/, "UTC+00:00");
  } catch {
    // Invalid zone for this engine.
  }
  return "";
}

export interface TimezonePickerProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  size?: ControlSize;
  disabled?: boolean;
  className?: string;
  /** Pin these to the top — typically the workspace default and the viewer's. */
  pinned?: string[];
}

export function TimezonePicker({
  value, onValueChange, size = "md", disabled, className, pinned,
}: TimezonePickerProps) {
  const local = React.useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; }
  }, []);

  const options = React.useMemo<ComboboxOption[]>(() => {
    const at = new Date();
    const head = Array.from(new Set([...(pinned ?? []), local, "UTC"]));
    const rest = listZones().filter((z) => !head.includes(z));
    const toOption = (z: string, isPinned: boolean): ComboboxOption => {
      const off = offsetLabel(z, at);
      return {
        value: z,
        label: z.replace(/_/g, " "),
        description: [off, isPinned && z === local ? "your timezone" : null].filter(Boolean).join(" · "),
      };
    };
    return [...head.map((z) => toOption(z, true)), ...rest.map((z) => toOption(z, false))];
  }, [local, pinned]);

  return (
    <Combobox
      options={options}
      value={value}
      onValueChange={onValueChange}
      size={size}
      disabled={disabled}
      className={className}
      placeholder="Search timezones…"
      emptyMessage="No timezone matches that. Try a city or region name."
    />
  );
}
