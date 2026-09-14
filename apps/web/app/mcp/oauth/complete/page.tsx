import * as React from "react";
import { McpSignInComplete } from "~/components/app/connectivity/mcp-sign-in-complete";

export const metadata = {
  title: "Signing in",
  robots: { index: false, follow: false },
};

/**
 * Where an MCP server's sign-in lands.
 *
 * The API's callback exchanges the code, stores the credential, discovers the
 * tools, and redirects here with only a connection id and an outcome — nothing
 * secret ever reaches the browser. This page tells the screen that started the
 * sign-in, then closes itself.
 *
 * Outside the app shell on purpose: it is shown for a second in a popup, and a
 * sidebar that flashes and disappears reads as a glitch.
 */
export default function McpOAuthCompletePage() {
  return (
    <React.Suspense fallback={null}>
      <McpSignInComplete />
    </React.Suspense>
  );
}
