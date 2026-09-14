"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Wordmark } from "~/components/app/shell/wordmark";
import { MCP_OAUTH_MESSAGE, MCP_OAUTH_STORAGE_PREFIX, type McpOAuthOutcome } from "~/lib/connectivity/mcp-oauth";

/**
 * The end of an MCP sign-in, shown in the popup for as long as it takes to say so.
 *
 * Reports the outcome through both channels the connect dialog listens on —
 * `postMessage` when the opener survived, `localStorage` when an authorization
 * server's Cross-Origin-Opener-Policy severed it — then closes. When there is no
 * opener at all (the sign-in was opened in a tab, or the popup was blocked and
 * the link used), it offers the way back instead of closing on the person.
 */
export function McpSignInComplete() {
  const params = useSearchParams();
  const connectionId = params.get("connection") ?? "";
  const status = params.get("status") === "ok" ? "ok" : "error";
  const reason = params.get("reason") ?? undefined;
  const tools = Number(params.get("tools") ?? "NaN");
  const returnTo = safePath(params.get("returnTo"));

  const [hasOpener, setHasOpener] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const outcome: McpOAuthOutcome = {
      connectionId,
      status,
      reason,
      toolsWritten: Number.isFinite(tools) ? tools : undefined,
    };
    if (connectionId) {
      try {
        window.localStorage.setItem(`${MCP_OAUTH_STORAGE_PREFIX}${connectionId}`, JSON.stringify({ ...outcome, at: Date.now() }));
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
  }, [connectionId, status, reason, tools]);

  const ok = status === "ok";

  return (
    <main className="bg-surface-canvas grid min-h-screen place-items-center px-4">
      <div className="border-subtle bg-surface-raised w-full max-w-md rounded-lg border p-6 text-center">
        <div className="mb-4 flex justify-center"><Wordmark /></div>
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
              : Number.isFinite(tools)
                ? `The server is connected and ${tools} tool${tools === 1 ? " was" : "s were"} discovered.`
                : "The server is connected."
            : failureCopy(reason)}
        </Text>
        {hasOpener === false ? (
          <div className="mt-4 flex justify-center">
            <Button asChild variant="primary" size="sm">
              <Link href={(returnTo ?? "/connections") as Route}>Back to Vectorbea</Link>
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function failureCopy(reason: string | undefined): string {
  switch (reason) {
    case "cancelled": return "You cancelled the sign-in. Start it again from the connection when you're ready.";
    case "expired": return "The sign-in link expired or was already used. Start the sign-in again.";
    case "exchange_failed": return "The server didn't accept the sign-in. Start it again from the connection.";
    default: return "Start the sign-in again from the connection.";
  }
}

/** Only a same-origin path is followed — this page is reached by redirect. */
function safePath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}
