"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Wordmark } from "~/components/app/shell/wordmark";
import { createVectorbeaClient } from "~/lib/api/client";
import { MCP_OAUTH_MESSAGE, MCP_OAUTH_STORAGE_PREFIX, type McpOAuthOutcome } from "~/lib/connectivity/mcp-oauth";

/* ══════════════════════════════════════════════════════════════════════════════
   THE END OF AN MCP SIGN-IN

   Two routes land here, and they differ only in who finished the sign-in:

   · `/mcp/oauth/callback` — where the authorization server sends the browser.
     This page hands `state` and `code` to the API, which exchanges them, stores
     the credential and discovers the tools. The code never leaves this origin
     for anywhere but our API, and the page never sees a token.
   · `/mcp/oauth/complete` — the API already finished it (the older redirect
     target) and passed the outcome in the query string.

   Either way the outcome is reported through both channels the connect dialog
   listens on — `postMessage` when the opener survived, `localStorage` when an
   authorization server's Cross-Origin-Opener-Policy severed it — and the window
   closes. With no opener at all (opened in a tab, or the popup was blocked and
   the link used) it offers the way back instead of closing on the person.
══════════════════════════════════════════════════════════════════════════════ */

/** `/mcp/oauth/complete`: the outcome is already in the URL. */
export function McpSignInComplete() {
  const params = useSearchParams();
  const tools = Number(params.get("tools") ?? "NaN");
  const outcome: McpOAuthOutcome = {
    connectionId: params.get("connection") ?? "",
    status: params.get("status") === "ok" ? "ok" : "error",
    reason: params.get("reason") ?? undefined,
    toolsWritten: Number.isFinite(tools) ? tools : undefined,
  };
  return <SignInResult outcome={outcome} returnTo={safePath(params.get("returnTo"))} />;
}

/** `/mcp/oauth/callback`: finish the sign-in, then report it. */
export function McpSignInCallback() {
  const params = useSearchParams();
  const [result, setResult] = React.useState<{ outcome: McpOAuthOutcome; returnTo: string | null } | null>(null);
  const started = React.useRef(false);

  React.useEffect(() => {
    /* Exactly once. The state is single-use, so a second exchange — a development
       double-effect, a reload of this page — would report "expired" over the top
       of a sign-in that had just succeeded. The ref covers the first; the
       session-storage marker covers a reload. */
    if (started.current) return;
    started.current = true;

    const state = params.get("state");
    const marker = state ? `vectorbea:mcp-oauth-done:${state}` : null;
    try {
      const done = marker ? window.sessionStorage.getItem(marker) : null;
      if (done) { setResult(JSON.parse(done)); return; }
    } catch { /* storage blocked; proceed */ }

    const client = createVectorbeaClient({ getToken: async () => null });
    void client.connections
      .mcpCompleteSignIn({ state, code: params.get("code"), error: params.get("error") })
      .then((response) => ({
        outcome: {
          connectionId: response.connectionId ?? "",
          status: response.status,
          reason: response.reason ?? undefined,
          toolsWritten: response.toolsWritten ?? undefined,
        } satisfies McpOAuthOutcome,
        returnTo: safePath(response.returnTo),
      }))
      .catch(() => ({
        outcome: { connectionId: "", status: "error", reason: "unreachable" } satisfies McpOAuthOutcome,
        returnTo: null,
      }))
      .then((next) => {
        try { if (marker) window.sessionStorage.setItem(marker, JSON.stringify(next)); } catch { /* ignore */ }
        setResult(next);
      });
  }, [params]);

  if (!result) {
    return (
      <Frame>
        <Spinner className="mx-auto size-6" />
        <Text variant="heading-sm" tone="max" as="h1" className="mt-3 block">Finishing sign-in</Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block leading-snug">
          Saving the connection and discovering the server&rsquo;s tools.
        </Text>
      </Frame>
    );
  }
  return <SignInResult outcome={result.outcome} returnTo={result.returnTo} />;
}

function SignInResult({ outcome, returnTo }: { outcome: McpOAuthOutcome; returnTo: string | null }) {
  const [hasOpener, setHasOpener] = React.useState<boolean | null>(null);
  const { connectionId, status, reason, toolsWritten } = outcome;

  React.useEffect(() => {
    if (connectionId) {
      try {
        window.localStorage.setItem(
          `${MCP_OAUTH_STORAGE_PREFIX}${connectionId}`,
          JSON.stringify({ ...outcome, at: Date.now() }),
        );
      } catch { /* storage can be blocked; postMessage and the dialog's poll remain */ }
    }
    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      try { opener.postMessage({ type: MCP_OAUTH_MESSAGE, ...outcome }, window.location.origin); } catch { /* severed */ }
      setHasOpener(true);
      const id = window.setTimeout(() => window.close(), 900);
      return () => window.clearTimeout(id);
    }
    setHasOpener(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, status, reason, toolsWritten]);

  const ok = status === "ok";

  return (
    <Frame>
      <Icon
        icon={ok ? CheckCircle : WarningCircle}
        size="xl"
        decorative
        className={ok ? "text-status-success mx-auto" : "text-status-failed mx-auto"}
      />
      <Text variant="heading-sm" tone="max" as="h1" className="mt-2 block">
        {ok ? "Signed in" : "Sign-in didn't complete"}
      </Text>
      <Text variant="body-sm" tone="secondary" className="mt-1.5 block leading-snug">
        {ok
          ? hasOpener
            ? "You can close this window. Vectorbea is finishing up."
            : toolsWritten != null
              ? `The server is connected and ${toolsWritten} tool${toolsWritten === 1 ? " was" : "s were"} discovered.`
              : "The server is connected."
          : failureCopy(reason)}
      </Text>
      {hasOpener === false ? (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="primary" size="sm">
            <Link href={(returnTo ?? "/integrations") as Route}>Back to Vectorbea</Link>
          </Button>
        </div>
      ) : null}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-surface-canvas grid min-h-screen place-items-center px-4">
      <div className="border-subtle bg-surface-raised w-full max-w-md rounded-lg border p-6 text-center">
        <div className="mb-4 flex justify-center"><Wordmark /></div>
        {children}
      </div>
    </main>
  );
}

function failureCopy(reason: string | undefined): string {
  switch (reason) {
    case "cancelled": return "You cancelled the sign-in. Start it again from the connection when you're ready.";
    case "expired": return "The sign-in link expired or was already used. Start the sign-in again.";
    case "exchange_failed": return "The server didn't accept the sign-in. Start it again from the connection.";
    case "unreachable": return "Vectorbea couldn't be reached to finish the sign-in. Check your connection and start it again.";
    default: return "Start the sign-in again from the connection.";
  }
}

/** Only a same-origin path is followed — this page is reached by redirect. */
function safePath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}
