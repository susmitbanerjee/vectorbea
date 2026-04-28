"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Loader2 } from "lucide-react";

import { BeeLogo } from "@/components/brand/bee-logo";
import {
  EnterpriseSsoMark,
  GitHubMark,
  GoogleMark,
  MicrosoftMark,
} from "@/components/auth/oauth-provider-icons";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Mode = "signin" | "signup";
type Provider = "github" | "google" | "azure" | "sso";

const benefitItems = [
  "See regressions clearly",
  "Debug AI issues faster",
  "Roll out safely with confidence",
  "Compare providers with clear evidence",
];

function mapError(value: string | null): string | null {
  if (!value) return null;
  if (value === "oauth" || value === "callback_failed") return "Sign in failed please try again";
  if (value === "session_expired") return "Session expired please sign in again";
  return value;
}

export function AuthScreen({ mode, next }: { mode: Mode; next?: string }) {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(mapError(searchParams.get("error")));
  const [loading, setLoading] = useState<Provider | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [workEmail, setWorkEmail] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function hydrateSession() {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as { redirectTo?: string };
        if (!cancelled && payload.redirectTo) {
          const dest = next && next !== "/" ? next : payload.redirectTo;
          window.location.assign(dest);
        }
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    }
    void hydrateSession();
    return () => {
      cancelled = true;
    };
  }, [next]);

  const callbackNext = next || searchParams.get("next") || undefined;
  const disabled = checkingSession || loading !== null;

  const alternateHref = mode === "signin" ? "/signup" : "/signin";
  const alternateLabel = mode === "signin" ? "Create account" : "Sign in";

  function buildRedirectUrl() {
    const u = new URL("/api/auth/callback", window.location.origin);
    if (callbackNext) u.searchParams.set("next", callbackNext);
    return u;
  }

  async function startOAuth(provider: "github" | "google" | "azure") {
    setLoading(provider);
    setError(null);
    try {
      const route = provider === "github" ? "/api/auth/github" : provider === "google" ? "/api/auth/google" : "/api/auth/microsoft";
      const url = new URL(route, window.location.origin);
      if (callbackNext) url.searchParams.set("next", callbackNext);
      window.location.assign(url.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setLoading(null);
    }
  }

  async function startSso() {
    const domain = workEmail.trim().toLowerCase().split("@")[1]?.trim();
    if (!domain) {
      setError("Enter a valid work email");
      return;
    }
    setLoading("sso");
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: ssoError } = await supabase.auth.signInWithSSO({
        domain,
        options: { redirectTo: buildRedirectUrl().toString() },
      });
      if (ssoError) throw ssoError;
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSO sign in failed");
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F5EF] text-[#111827]">
      <div className="grid min-h-screen lg:grid-cols-[1fr_520px]">
        <section className="relative hidden border-r border-[#E5E0D8] bg-[#FBF8F1] lg:flex">
          <div className="absolute inset-0 surface-grid opacity-40" />
          <div className="relative flex h-full w-full flex-col px-12 py-10 xl:px-16 xl:py-14">
            <Link href="/" className="inline-flex w-fit items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E5E0D8] bg-white">
                <BeeLogo className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-[#111827]">VectorBea</span>
            </Link>

            <div className="my-auto max-w-xl space-y-8">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
                AI risk control for production LLMs
              </p>
              <h1 className="text-balance text-5xl font-semibold leading-[1.08] tracking-tight text-[#111827]">
                {mode === "signin" ? "Welcome back" : "Start using VectorBea"}
              </h1>
              <p className="text-base leading-7 text-[#374151]">
                Access tracing evaluations rollouts and alerts in one place
              </p>

              <ul className="space-y-3">
                {benefitItems.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF]">
                      <Check className="h-3.5 w-3.5 text-[#2563EB]" />
                    </span>
                    <span className="text-sm leading-6 text-[#4B5563]">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-md space-y-7">
            <div className="flex items-center justify-between lg:justify-end">
              <Link href="/" className="inline-flex items-center gap-2 lg:hidden">
                <BeeLogo className="h-7 w-7" />
                <span className="text-sm font-semibold text-[#111827]">VectorBea</span>
              </Link>
              <ThemeToggle />
            </div>

            <article className="rounded-2xl border border-[#E5E0D8] bg-white p-7 shadow-[0_12px_24px_rgba(17,24,39,0.06)] sm:p-8">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-[#111827]">
                  {mode === "signin" ? "Sign in to VectorBea" : "Create your account"}
                </h2>
                <p className="text-sm leading-6 text-[#4B5563]">
                  {mode === "signin"
                    ? "Control production AI with confidence"
                    : "Trace evaluate and safely ship production LLM changes"}
                </p>
              </div>

              {error ? (
                <div className="mt-4 rounded-lg border border-[#F4C7C7] bg-[#FFF3F3] px-3 py-2 text-sm text-[#B91C1C]">
                  {error}
                </div>
              ) : null}

              <div className="mt-6 space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6B7280]">Work email</span>
                  <Input
                    type="email"
                    value={workEmail}
                    onChange={(e) => setWorkEmail(e.target.value)}
                    placeholder="name at company"
                    disabled={disabled}
                    className="h-10 rounded-lg border-[#D8CFC2] bg-white text-[#111827] placeholder:text-[#9CA3AF] focus-visible:border-[#2563EB] focus-visible:ring-[rgba(37,99,235,0.22)]"
                    onKeyDown={(e) => e.key === "Enter" && void startSso()}
                  />
                </label>

                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void startSso()}
                  className="h-10 w-full justify-between rounded-lg border-[#D8CFC2] bg-white text-[#111827] hover:bg-[#F8F5EF]"
                >
                  <span className="inline-flex items-center gap-2">
                    <EnterpriseSsoMark className="h-4 w-4 text-[#4B5563]" />
                    Continue with SSO
                  </span>
                  {loading === "sso" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4 text-[#6B7280]" />}
                </Button>
              </div>

              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-[#EDE6DA]" />
                <span className="text-xs font-medium text-[#6B7280]">Or continue with</span>
                <span className="h-px flex-1 bg-[#EDE6DA]" />
              </div>

              <div className="space-y-2.5">
                <ProviderButton
                  icon={<GitHubMark className="h-[18px] w-[18px]" />}
                  label="GitHub"
                  loading={loading === "github"}
                  disabled={disabled}
                  onClick={() => void startOAuth("github")}
                />
                <ProviderButton
                  icon={<GoogleMark className="h-[18px] w-[18px]" />}
                  label="Google"
                  loading={loading === "google"}
                  disabled={disabled}
                  onClick={() => void startOAuth("google")}
                />
                <ProviderButton
                  icon={<MicrosoftMark className="h-[18px] w-[18px]" />}
                  label="Microsoft"
                  loading={loading === "azure"}
                  disabled={disabled}
                  onClick={() => void startOAuth("azure")}
                />
              </div>

              <div className="mt-6 flex items-center justify-between text-xs text-[#6B7280]">
                <p>
                  {mode === "signin" ? "No account" : "Already have an account"}{" "}
                  <Link href={alternateHref} className="font-semibold text-[#2563EB] hover:text-[#1D4ED8]">
                    {alternateLabel}
                  </Link>
                </p>
                <Link href="/docs/security" className="hover:text-[#111827]">
                  Privacy
                </Link>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}

function ProviderButton({
  icon,
  label,
  loading,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-lg border border-[#D8CFC2] bg-white px-3.5 text-sm font-medium text-[#111827]",
        "transition-colors hover:bg-[#F8F5EF]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/20",
        "disabled:opacity-50",
      )}
    >
      <span className="inline-flex items-center gap-2.5">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-[#4B5563]" /> : icon}
        Continue with {label}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-[#6B7280]" />
    </button>
  );
}
