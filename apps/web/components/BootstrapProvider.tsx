"use client";

import { useBootstrap } from "@/hooks/useBootstrap";

/**
 * Thin client component that fires the bootstrap hook on first load.
 * Must be a client component so it can access localStorage and useEffect.
 * Rendered as a child of the server root layout — renders nothing visually.
 */
export function BootstrapProvider() {
  useBootstrap();
  return null;
}
