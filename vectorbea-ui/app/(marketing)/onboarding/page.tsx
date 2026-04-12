"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";

import { BeeLogo } from "@/components/brand/bee-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function OnboardingPage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState("");
  const [checkingRoute, setCheckingRoute] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function syncRouteState() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) {
          router.replace("/login?next=/onboarding");
          return;
        }

        const payload = (await response.json()) as { redirectTo?: string };
        if (!cancelled && payload.redirectTo && payload.redirectTo !== "/onboarding") {
          window.location.assign(payload.redirectTo);
          return;
        }
      } finally {
        if (!cancelled) {
          setCheckingRoute(false);
        }
      }
    }

    void syncRouteState();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit() {
    if (!workspaceName.trim() || isCreating) {
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/onboarding/bootstrap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspaceName: workspaceName.trim() }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        workspaceId?: string;
        error?: string;
      };

      if (!response.ok || !payload.workspaceId) {
        throw new Error(
          payload.error ??
            "We couldn't create your workspace right now. Please try again.",
        );
      }

      window.location.assign(
        `/dashboard?org=${encodeURIComponent(payload.workspaceId)}`,
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "We couldn't create your workspace right now. Please try again.",
      );
      setIsCreating(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16">
      <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-70" />
      <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2">
        <div className="h-[460px] w-[620px] rounded-full bg-primary/10 blur-[120px]" />
      </div>

      <Card className="relative z-10 w-full max-w-lg overflow-hidden border-border/70 bg-card/90 shadow-2xl backdrop-blur-xl">
        <CardHeader className="space-y-6 border-b border-border/70 px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-background shadow-sm">
              <BeeLogo className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
                VectorBea
              </p>
              <CardTitle className="text-2xl font-semibold tracking-tight">
                Name your workspace
              </CardTitle>
            </div>
          </div>

          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            Every account starts on the Free plan. Create your first workspace now
            and head straight into the dashboard.
          </p>
        </CardHeader>

        <CardContent className="space-y-6 px-8 py-8">
          {checkingRoute ? (
            <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
              Checking your account and workspace status...
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <label
                  htmlFor="workspace-name"
                  className="text-sm font-medium text-foreground"
                >
                  Workspace name
                </label>
                <Input
                  id="workspace-name"
                  autoFocus
                  placeholder="e.g. Acme AI Platform"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleSubmit();
                    }
                  }}
                  disabled={isCreating}
                  className="h-12"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Free workspaces include 1 seat, 5 prompts, and 100 audit events
                  each month.
                </p>
              </div>

              <div className="grid gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 md:grid-cols-3">
                <div className="rounded-xl bg-background/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Prompts
                  </p>
                  <p className="mt-2 text-lg font-semibold">5 included</p>
                </div>
                <div className="rounded-xl bg-background/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Audits
                  </p>
                  <p className="mt-2 text-lg font-semibold">100 / month</p>
                </div>
                <div className="rounded-xl bg-background/70 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Upgrade path
                  </p>
                  <p className="mt-2 text-lg font-semibold">Team anytime</p>
                </div>
              </div>

              {error ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-4 text-sm text-muted-foreground">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
                  <p className="leading-6">
                    If you need more than one workspace on Free, we&apos;ll guide
                    you to the Team billing flow from settings when you&apos;re ready
                    to upgrade.
                  </p>
                </div>
              </div>

              <Button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={checkingRoute || !workspaceName.trim() || isCreating}
                className="h-12 w-full gap-2 text-sm font-semibold"
              >
                {isCreating ? "Creating workspace..." : "Create workspace"}
                {!isCreating ? <ArrowRight className="h-4 w-4" /> : null}
              </Button>

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                You can rename your workspace later from settings.
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
