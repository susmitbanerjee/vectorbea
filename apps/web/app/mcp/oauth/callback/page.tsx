import * as React from "react";
import { McpSignInCallback } from "~/components/app/connectivity/mcp-sign-in-complete";

export const metadata = {
  title: "Signing in",
  robots: { index: false, follow: false },
};

/**
 * Where an MCP server's authorization server sends the browser after sign-in.
 *
 * On the web app's own domain rather than the API's, so signing in never
 * depends on the public API hostname — and so that hostname can serve the run
 * API and nothing else. This page hands the code to the API and reports back.
 */
export default function McpOAuthCallbackPage() {
  return (
    <React.Suspense fallback={null}>
      <McpSignInCallback />
    </React.Suspense>
  );
}
