"use client";

import { useEffect } from "react";

/**
 * Auto-provisions workspace + environment for new users.
 *
 * Calls GET /api/bootstrap on first load (when localStorage is empty).
 * The endpoint is idempotent — safe to call on every cold start.
 * Once workspace/environment IDs are stored in localStorage, the hook
 * becomes a no-op on subsequent visits.
 */
export function useBootstrap() {
  useEffect(() => {
    const wsId = localStorage.getItem("vectorbea.activeWorkspaceId")?.trim();
    const envId = localStorage.getItem("vectorbea.activeEnvironmentId")?.trim();
    if (wsId && envId) return; // already bootstrapped — nothing to do

    // Both names, in the order the rest of the app resolves them. Reading only
    // the first meant `base` fell back to "" on any checkout that sets
    // NEXT_PUBLIC_API_URL — including this repo's own .env.local — so the call
    // went to the WEB origin and 404'd, and no workspace id was ever stored.
    const base = (
      process.env.NEXT_PUBLIC_VECTORBEA_API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:8080"
    ).replace(/\/+$/, "");
    fetch(`${base}/api/bootstrap`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`Bootstrap returned ${r.status}`);
        return r.json() as Promise<{ workspaceId?: string; environmentId?: string }>;
      })
      .then(({ workspaceId, environmentId }) => {
        if (workspaceId) {
          localStorage.setItem("vectorbea.activeWorkspaceId", workspaceId);
        }
        if (environmentId) {
          localStorage.setItem("vectorbea.activeEnvironmentId", environmentId);
        }
        if (workspaceId && environmentId) {
          // Reload so all pending API calls re-run with valid workspace/environment headers
          window.location.reload();
        }
      })
      .catch(() => {
        // Silent fail — UI will show empty states until connectivity is restored
      });
  }, []);
}
