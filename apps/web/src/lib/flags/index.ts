"use client";

import { isEnabled, type FlagName } from "./flags";

export {
  allFlags,
  describeFlag,
  isEnabled,
  FLAG_NAMES,
  type FlagName,
} from "./flags";

/**
 * Read a flag from a client component.
 *
 * Not a hook over context, and not stateful: flag values are inlined at build
 * time, so they cannot change during a session. A `useState`/`useEffect`
 * version would render `false` on the server and the real value on the client,
 * producing a hydration mismatch and a flash of the wrong UI for a value that
 * was constant all along.
 */
export function useFlag(name: FlagName): boolean {
  return isEnabled(name);
}
