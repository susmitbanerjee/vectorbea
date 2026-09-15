"use client";

import * as React from "react";

/* ══════════════════════════════════════════════════════════════════════════════
   THE VIEWER'S TIME ZONE

   Timestamps were printed as UTC ISO fragments (`toISOString().slice(11, 23)`),
   so somebody in India read a run that started at 15:20 as 09:50 and assumed the
   clock was wrong. Every timestamp a person reads now goes through this.

   The preference is the one saved on the profile (Settings → Profile), mirrored
   in localStorage so the first render after a reload is already right. With no
   preference it is the browser's own zone — which is what nearly everyone wants,
   and why saving one is optional.
══════════════════════════════════════════════════════════════════════════════ */

const KEY = "vectorbea-time-zone";
const listeners = new Set<() => void>();

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function readPreference(): string | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value && isValidTimeZone(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remember the viewer's choice. Null goes back to the browser's zone. */
export function setPreferredTimeZone(timeZone: string | null): void {
  try {
    if (timeZone && isValidTimeZone(timeZone)) window.localStorage.setItem(KEY, timeZone);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked — the choice still applies until reload.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) listener(); };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The zone every timestamp should be shown in. */
export function useTimeZone(): string {
  return React.useSyncExternalStore(
    subscribe,
    () => readPreference() ?? browserTimeZone(),
    () => "UTC",
  );
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function toDate(at: string | number | Date): Date {
  return at instanceof Date ? at : new Date(at);
}

/** `14:05:32`, or `14:05:32.123` with milliseconds. */
export function formatClock(at: string | number | Date, timeZone: string, options: { ms?: boolean } = {}): string {
  const date = toDate(at);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...(options.ms ? { fractionalSecondDigits: 3 } : {}),
  }).format(date);
}

/** `15 Sep 2026, 14:05:32 GMT+5:30`. */
export function formatDateTime(
  at: string | number | Date,
  timeZone: string,
  options: { seconds?: boolean; zone?: boolean } = {},
): string {
  const date = toDate(at);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(options.seconds === false ? {} : { second: "2-digit" }),
    hour12: false,
    ...(options.zone === false ? {} : { timeZoneName: "short" }),
  }).format(date);
}

/** `GMT+5:30` — the short label shown beside a list of times. */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
      .formatToParts(at).find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}
