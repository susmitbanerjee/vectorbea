"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { Wordmark } from "~/components/app/shell/wordmark";
import { cn } from "~/lib/cn";

/* ══════════════════════════════════════════════════════════════════════════════
   ACCEPT AN INVITATION

   THIS PAGE RAN ON SUPABASE BROWSER AUTH. It built a `createBrowserClient` from
   `NEXT_PUBLIC_SUPABASE_URL`, asked it for a session, and sent that session's
   token to the API. This product's sessions are its own HS256 cookie — Supabase
   never issues one — so `getSession()` returned null forever and the page
   either sat on "Sign in to accept" or failed. Worse, on ANY failure it printed
   a fixed paragraph: "the link has expired, was already accepted, or was
   revoked". That sentence is why a freshly issued invitation reported itself as
   expired: the page was guessing, and guessing wrong, about a request that had
   failed for an unrelated reason.

   IT NO LONGER ACCEPTS ON LOAD. Redeeming is single-use, so it is now a button.
   A page that POSTs on mount hands the one-shot token to whatever opens the URL
   first — a mail gateway's link scanner, a prefetch, a preview pane — and the
   invitee then finds a link that has already been used.

   The reason a link does not work comes from the server, one sentence per
   cause, so nobody is left choosing between three explanations.
══════════════════════════════════════════════════════════════════════════════ */

type Role = "owner" | "admin" | "developer" | "viewer";

interface ValidPreview {
  valid: true;
  workspaceName: string;
  role: Role;
  inviterName: string;
  invitedEmail: string;
  expiresAt: string;
  viewer: { email: string | null } | null;
  emailMatches: boolean | null;
}

interface InvalidPreview {
  valid: false;
  reason: "expired" | "accepted" | "revoked" | "unknown";
  message: string;
}

type Preview = ValidPreview | InvalidPreview;

const ROLE_SUMMARY: Record<Role, string> = {
  owner: "full control, including billing and deleting the workspace",
  admin: "manage members, settings and connections",
  developer: "build and run workflows",
  viewer: "read-only access across the workspace",
};

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner", admin: "Admin", developer: "Developer", viewer: "Viewer",
};

export default function AcceptInvitePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [accepting, setAccepting] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [joined, setJoined] = React.useState<{ workspaceId: string; role: Role } | null>(null);

  React.useEffect(() => {
    if (!token) {
      setPreview({ valid: false, reason: "unknown", message: "This link is missing its invitation token. Check you copied the whole link." });
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/auth/accept-invite?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        // The wire shape is one of the two union arms, or an error envelope
        // from the generic handler. Narrowed on `valid` rather than cast, so a
        // response the server never sends cannot slip through as a preview.
        const json = (await response.json()) as
          | ValidPreview
          | InvalidPreview
          | { valid?: undefined; error?: string };
        if (cancelled) return;
        setPreview(
          json.valid === undefined
            ? { valid: false, reason: "unknown", message: json.error ?? "This invitation could not be read." }
            : json,
        );
      } catch {
        if (!cancelled) {
          setPreview({ valid: false, reason: "unknown", message: "The invitation could not be checked. Your connection may be offline — try again." });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function accept() {
    if (!token) return;
    setAccepting(true);
    setFailure(null);
    try {
      const response = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = (await response.json()) as { workspaceId?: string; role?: Role; error?: string };
      if (!response.ok) {
        setFailure(json.error ?? "The invitation could not be accepted.");
        return;
      }
      setJoined({ workspaceId: json.workspaceId ?? "", role: json.role ?? "viewer" });
      // Straight in, no timed redirect: a countdown on a page whose only job is
      // done is a delay, not a confirmation.
      router.replace(
        (json.workspaceId ? `/control?org=${encodeURIComponent(json.workspaceId)}` : "/control") as Route,
      );
      router.refresh();
    } catch {
      setFailure("The request did not complete. Check your connection and try again.");
    } finally {
      setAccepting(false);
    }
  }

  const next = token ? `/auth/accept-invite?token=${encodeURIComponent(token)}` : "/";

  return (
    <main className="bg-canvas grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 flex justify-center">
          <Wordmark />
        </div>

        <section className="border-subtle bg-surface-base rounded-xl border p-6 shadow-2">
          {loading ? <PreviewSkeleton /> : null}

          {!loading && preview && !preview.valid ? (
            <Invalid message={preview.message} reason={preview.reason} />
          ) : null}

          {!loading && preview?.valid && joined ? (
            <Centred
              tone="success"
              title={`You have joined ${preview.workspaceName}`}
              body="Taking you to the workspace now."
            />
          ) : null}

          {!loading && preview?.valid && !joined ? (
            <div className="grid gap-4">
              <div>
                <Text variant="eyebrow" tone="muted" className="block">Workspace invitation</Text>
                <Text variant="heading-md" tone="max" as="h1" className="mt-1 block">
                  Join {preview.workspaceName}
                </Text>
                <Text variant="body-sm" tone="secondary" className="mt-1.5 block leading-snug">
                  {preview.inviterName} invited{" "}
                  <strong className="text-fg-primary">{preview.invitedEmail}</strong> as{" "}
                  <strong className="text-fg-primary">{ROLE_LABEL[preview.role]}</strong> —{" "}
                  {ROLE_SUMMARY[preview.role]}.
                </Text>
              </div>

              {preview.viewer === null ? (
                <>
                  <Note>
                    Sign in as {preview.invitedEmail} to accept. If you do not have an account yet, create
                    one with that address and you will come straight back here.
                  </Note>
                  <div className="grid gap-2">
                    <Button asChild size="md" variant="primary" fullWidth>
                      <Link href={`/signin?next=${encodeURIComponent(next)}` as Route}>Sign in to accept</Link>
                    </Button>
                    <Button asChild size="md" variant="secondary" fullWidth>
                      <Link href={`/signup?next=${encodeURIComponent(next)}` as Route}>Create an account</Link>
                    </Button>
                  </div>
                </>
              ) : preview.emailMatches === false ? (
                <>
                  <Note tone="waiting">
                    You are signed in as <strong>{preview.viewer.email}</strong>, but this invitation was
                    sent to <strong>{preview.invitedEmail}</strong>. Sign in as that address to accept it.
                  </Note>
                  <Button asChild size="md" variant="primary" fullWidth>
                    <Link href={`/signin?next=${encodeURIComponent(next)}` as Route}>
                      Sign in as {preview.invitedEmail}
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  {failure ? <Note tone="failed">{failure}</Note> : null}
                  <Button
                    size="md"
                    variant="primary"
                    fullWidth
                    loading={accepting}
                    loadingLabel="Joining"
                    onClick={() => void accept()}
                  >
                    Accept invitation
                  </Button>
                  <Text variant="caption" tone="muted" className="block text-center leading-snug">
                    Expires {new Date(preview.expiresAt).toLocaleDateString()}. Accepting adds you to this
                    workspace and is recorded in its audit log.
                  </Text>
                </>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function Invalid({ message, reason }: { message: string; reason: InvalidPreview["reason"] }) {
  return (
    <div className="grid gap-4 text-center">
      <div>
        <Text variant="heading-sm" tone="max" as="h1" className="block">
          {reason === "accepted" ? "This invitation has been used" : "This invitation is not valid"}
        </Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block leading-snug">{message}</Text>
      </div>
      <Button asChild size="md" variant="secondary" fullWidth>
        <Link href={"/control" as Route}>Go to Vectorbea</Link>
      </Button>
    </div>
  );
}

function Centred({ tone, title, body }: { tone: "success"; title: string; body: string }) {
  return (
    <div className="grid gap-2 text-center">
      <Text
        variant="heading-sm"
        tone="inherit"
        as="p"
        className={cn("block", tone === "success" && "text-status-success")}
      >
        {title}
      </Text>
      <Text variant="body-sm" tone="secondary" className="block">{body}</Text>
    </div>
  );
}

function Note({
  children, tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "waiting" | "failed";
}) {
  return (
    <div
      role={tone === "failed" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2",
        tone === "failed" ? "border-status-failed-border bg-status-failed-subtle"
          : tone === "waiting" ? "border-status-waiting-border bg-status-waiting-subtle"
            : "border-subtle bg-surface-sunken",
      )}
    >
      <Text
        variant="caption"
        tone={tone === "neutral" ? "secondary" : "inherit"}
        className={cn(
          "block leading-snug",
          tone === "failed" && "text-status-failed",
          tone === "waiting" && "text-status-waiting",
        )}
      >
        {children}
      </Text>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden="true">
      <div className="bg-surface-active h-3 w-28 animate-pulse rounded-xs" />
      <div className="bg-surface-active h-6 w-56 animate-pulse rounded-xs" />
      <div className="bg-surface-active h-3 w-full animate-pulse rounded-xs" />
      <div className="bg-surface-active mt-2 h-9 w-full animate-pulse rounded-md" />
    </div>
  );
}
