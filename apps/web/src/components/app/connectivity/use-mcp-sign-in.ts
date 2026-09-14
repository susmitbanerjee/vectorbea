"use client";

import * as React from "react";
import { useApi } from "~/lib/api/api-provider";
import type { Scope } from "~/lib/api/client";
import { MCP_OAUTH_MESSAGE, MCP_OAUTH_STORAGE_PREFIX, type McpOAuthOutcome } from "~/lib/connectivity/mcp-oauth";

/**
 * Signing in to an MCP server from a popup, and finding out when it finished.
 *
 * One implementation for the two places a sign-in starts — connecting a new
 * server, and signing in again on an existing one — because the hard part is the
 * same in both and easy to get subtly wrong:
 *
 *   · The window has to be opened INSIDE the click, before any await. Opened after
 *     a network round trip, it is no longer a response to a user gesture and
 *     every browser blocks it.
 *   · The authorization server is someone else's page, and many set
 *     Cross-Origin-Opener-Policy, which severs `window.opener` for good. So the
 *     completion page reports by `postMessage` AND by a `localStorage` write
 *     (whose `storage` event reaches this tab regardless), and this hook also
 *     polls the connection. Any one channel is enough; the first wins.
 */
export interface McpSignInPending {
  connectionId: string;
  url: string;
  /** The browser refused the popup; show the link instead. */
  blocked: boolean;
}

export function useMcpSignIn(
  scope: Scope,
  onOutcome: (outcome: McpOAuthOutcome) => void,
  /**
   * Also poll the connection for a stored sign-in. Only meaningful for a server
   * that was NOT signed in before — signing in again to one that already is
   * would read "signed in" on the first poll, before the person did anything.
   */
  { poll = true }: { poll?: boolean } = {},
) {
  const api = useApi();
  const [pending, setPending] = React.useState<McpSignInPending | null>(null);
  const popupRef = React.useRef<Window | null>(null);
  const outcomeRef = React.useRef(onOutcome);
  outcomeRef.current = onOutcome;

  /**
   * Start a sign-in. [connectionIdFor] runs AFTER the window is open, so it may
   * save a connection first. Resolves `false` when the server turned out to need
   * no sign-in — the caller should just discover.
   */
  const start = React.useCallback(async (connectionIdFor: () => Promise<string>): Promise<boolean> => {
    const popup = window.open("about:blank", "vectorbea-mcp-sign-in", "popup,width=520,height=720");
    popupRef.current = popup;
    try {
      const connectionId = await connectionIdFor();
      const started = await api.connections.mcpSignIn(connectionId, { returnTo: window.location.pathname }, scope);
      if (!started.signInRequired || !started.authorizationUrl) {
        popup?.close();
        return false;
      }
      const blocked = !popup || popup.closed;
      if (!blocked) popup.location.href = started.authorizationUrl;
      setPending({ connectionId, url: started.authorizationUrl, blocked });
      return true;
    } catch (error) {
      popup?.close();
      throw error;
    }
  }, [api, scope]);

  const cancel = React.useCallback(() => {
    popupRef.current?.close();
    setPending(null);
  }, []);

  React.useEffect(() => {
    if (!pending) return;
    let settled = false;
    const settle = (outcome: McpOAuthOutcome) => {
      if (settled || outcome.connectionId !== pending.connectionId) return;
      settled = true;
      popupRef.current?.close();
      setPending(null);
      outcomeRef.current(outcome);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as ({ type?: string } & McpOAuthOutcome) | null;
      if (data?.type === MCP_OAUTH_MESSAGE) settle(data);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== `${MCP_OAUTH_STORAGE_PREFIX}${pending.connectionId}` || !event.newValue) return;
      try { settle(JSON.parse(event.newValue) as McpOAuthOutcome); } catch { /* malformed; keep waiting */ }
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);

    const startedAt = Date.now();
    const timer = !poll ? null : window.setInterval(() => {
      /* A stored sign-in is the one fact the API can confirm. Polling does not
         learn about a cancelled sign-in — that arrives by the other channels, or
         the person closes the dialog. Stopped after the pending row's lifetime. */
      if (Date.now() - startedAt > 15 * 60_000) { if (timer) window.clearInterval(timer); return; }
      void api.connections.mcpTools(pending.connectionId, scope)
        .then((response) => { if (response.signedIn) settle({ connectionId: pending.connectionId, status: "ok" }); })
        .catch(() => { /* keep waiting */ });
    }, 3_000);

    return () => {
      settled = true;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
      if (timer) window.clearInterval(timer);
    };
  }, [pending, api, scope, poll]);

  return { start, pending, cancel };
}
