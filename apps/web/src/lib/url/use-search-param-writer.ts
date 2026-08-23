"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/* ══════════════════════════════════════════════════════════════════════════════
   Write a few search params without losing the rest.

   THE BUG THIS EXISTS TO PREVENT — two writes in one tick, and the second one
   silently discards the first.

   The obvious implementation closes over the `useSearchParams()` snapshot:

     const next = new URLSearchParams(params.toString());   // ← render-time value

   That is correct for a single call and wrong the moment two happen together,
   because `params` does not update until the router commits and the component
   re-renders. The registry create dialogs do exactly that: on success they open
   the new record AND close themselves —

     onCreated   → setParams({ create: null, tool: id })
     onOpenChange→ setParams({ create: null })

   — both reading the same stale snapshot, so the second `router.replace` wins
   and `tool=<id>` never reaches the URL. The visible symptom is registering a
   tool and being returned to the list instead of to the thing you just made.

   Seeding from `window.location.search` instead is not a fix either: App Router
   commits the history entry with the transition, not synchronously, so the
   second call can still read the pre-update URL.

   So the last written value is held in a ref. Within a tick, call two merges
   onto call one; after the router commits, the effect re-syncs the ref to the
   real URL, which is what keeps Back/Forward and external navigation
   authoritative rather than this ref.
══════════════════════════════════════════════════════════════════════════════ */

export type SearchParamUpdates = Record<string, string | null>;

export function useSearchParamWriter(): (updates: SearchParamUpdates) => void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const latest = React.useRef(params.toString());

  // After commit — so a back/forward, a link, or another component's write is
  // what the next merge starts from.
  React.useEffect(() => { latest.current = params.toString(); }, [params]);

  return React.useCallback((updates: SearchParamUpdates) => {
    const next = new URLSearchParams(latest.current);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    latest.current = next.toString();

    const query = next.toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as never, { scroll: false });
  }, [pathname, router]);
}
