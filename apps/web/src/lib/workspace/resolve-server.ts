import "server-only";

import type { Workspace } from "./types";

/**
 * Resolve the workspace the app should open in, on the server.
 *
 * `GET /api/bootstrap` is the only endpoint that hands back a workspace WITHOUT
 * a verified JWT — it is in the API's public path set precisely so a cold client
 * can provision and identify itself. `/api/me` would be richer but returns 401
 * without a real Supabase token, which is exactly the state a local dev server
 * and a first-load server render are in.
 *
 * Failure is not fatal. Returning an empty list leaves `workspaceId` null, every
 * scoped query disabled, and the screens in their own empty states — which is
 * the correct outcome for "we could not identify a workspace", and strictly
 * better than rendering bands full of zeroes as though they were measurements.
 */
export async function resolveWorkspacesForServer(): Promise<{
  workspaces: Workspace[];
  defaultWorkspaceId: string | null;
}> {
  const base = (
    process.env.NEXT_PUBLIC_VECTORBEA_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8080"
  ).replace(/\/+$/, "");

  try {
    const response = await fetch(`${base}/api/bootstrap`, {
      // Never cached: the bootstrap endpoint is how a brand new user gets a
      // workspace at all, and a cached miss would strand them.
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { workspaces: [], defaultWorkspaceId: null };

    const body = (await response.json()) as { workspaceId?: string };
    if (!body.workspaceId) return { workspaces: [], defaultWorkspaceId: null };

    return {
      // The endpoint returns ids, not names. A placeholder name is honest here:
      // the switcher shows the real list once /api/me is reachable with a token.
      workspaces: [{ id: body.workspaceId, name: "Workspace" }],
      defaultWorkspaceId: body.workspaceId,
    };
  } catch {
    return { workspaces: [], defaultWorkspaceId: null };
  }
}
