"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/telemetry/client";

/**
 * Emits a `page_viewed` analytics event on every in-app route change.
 * Renders nothing; mounted once in the (app) layout so user journeys are
 * captured without per-page instrumentation.
 */
export function TelemetryPageViews() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;
    track("page_viewed", { properties: { path: pathname } });
  }, [pathname]);

  return null;
}
