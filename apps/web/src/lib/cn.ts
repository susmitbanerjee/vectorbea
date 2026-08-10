import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names, resolving Tailwind conflicts so the last
 * utility wins. Use for every className in src/components/**.
 *
 * Mirrors the legacy helper at apps/web/lib/utils.ts so the two layers behave
 * identically during the migration; that file is removed in Stage 6.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
