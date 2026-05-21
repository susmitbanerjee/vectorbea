"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle, LogIn } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";

type State =
  | { phase: "loading" }
  | { phase: "needs_auth"; token: string }
  | { phase: "accepting" }
  | { phase: "success"; workspaceId: string; role: string }
  | { phase: "error"; message: string };

export default function AcceptInvitePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setState({ phase: "error", message: "No invitation token found in the URL." });
      return;
    }

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    async function run() {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        // Store token in sessionStorage so we can continue after login
        sessionStorage.setItem("pending_invite_token", token!);
        setState({ phase: "needs_auth", token: token! });
        return;
      }

      setState({ phase: "accepting" });

      try {
        const res = await fetch("/api/auth/accept-invite", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ token }),
        });
        const json = await res.json() as { workspaceId?: string; role?: string; error?: string };

        if (!res.ok) {
          setState({ phase: "error", message: json.error ?? "Failed to accept invitation." });
          return;
        }

        // Clear any pending token
        sessionStorage.removeItem("pending_invite_token");

        setState({
          phase: "success",
          workspaceId: json.workspaceId ?? "",
          role: json.role ?? "editor",
        });

        // Redirect after a short delay
        setTimeout(() => {
          const destination = json.workspaceId
            ? `/?org=${encodeURIComponent(json.workspaceId)}`
            : "/";
          router.push(destination as Parameters<typeof router.push>[0]);
        }, 2500);
      } catch {
        setState({ phase: "error", message: "Network error. Please try again." });
      }
    }

    void run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After login, continue with stored token
  useEffect(() => {
    const stored = sessionStorage.getItem("pending_invite_token");
    if (!stored || state.phase !== "needs_auth") return;

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
        subscription.unsubscribe();
        setState({ phase: "accepting" });
        fetch("/api/auth/accept-invite", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ token: stored }),
        })
          .then((r) => r.json() as Promise<{ workspaceId?: string; role?: string; error?: string }>)
          .then((json) => {
            sessionStorage.removeItem("pending_invite_token");
            if (json.error) {
              setState({ phase: "error", message: json.error });
            } else {
              setState({ phase: "success", workspaceId: json.workspaceId ?? "", role: json.role ?? "editor" });
              setTimeout(() => {
                router.push(
                  json.workspaceId
                    ? `/?org=${encodeURIComponent(json.workspaceId)}` as Parameters<typeof router.push>[0]
                    : "/" as Parameters<typeof router.push>[0],
                );
              }, 2500);
            }
          })
          .catch(() => setState({ phase: "error", message: "Network error. Please try again." }));
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl text-center space-y-5">
        {/* Logo wordmark */}
        <div className="mb-2">
          <span className="text-lg font-bold tracking-tight text-foreground">VectorBea</span>
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest mt-0.5">AI Release Control</p>
        </div>

        {state.phase === "loading" && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Validating invitation…</p>
          </>
        )}

        {state.phase === "needs_auth" && (
          <>
            <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
              <LogIn className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-xl font-bold">Sign in to accept</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to your VectorBea account to accept this workspace invitation. You&apos;ll be redirected back automatically.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(`/auth/accept-invite?token=${state.token}`)}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              <LogIn className="h-4 w-4" />
              Sign in to continue
            </Link>
            <p className="text-xs text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href={`/signup?next=${encodeURIComponent(`/auth/accept-invite?token=${state.token}`)}`} className="text-primary hover:underline">
                Create one for free
              </Link>
            </p>
          </>
        )}

        {state.phase === "accepting" && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <h1 className="text-xl font-bold">Accepting invitation…</h1>
            <p className="text-sm text-muted-foreground">Adding you to the workspace.</p>
          </>
        )}

        {state.phase === "success" && (
          <>
            <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold text-emerald-400">Invitation accepted!</h1>
            <p className="text-sm text-muted-foreground">
              You&apos;ve joined the workspace as <strong className="text-foreground capitalize">{state.role}</strong>. Redirecting you now…
            </p>
            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-emerald-500 animate-[grow_2.5s_linear_forwards]" style={{ width: "100%" }} />
            </div>
          </>
        )}

        {state.phase === "error" && (
          <>
            <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
              <XCircle className="h-7 w-7 text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-red-400">Invitation invalid</h1>
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <p className="text-xs text-muted-foreground">
              Possible reasons: the link has expired, was already accepted, or was revoked.
              Contact the person who invited you to request a new invitation.
            </p>
            <Link
              href="/"
              className="inline-flex w-full items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold shadow-sm hover:bg-accent/40 transition-colors"
            >
              Go to dashboard
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
