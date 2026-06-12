"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, LogOut, MailCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/** Client half of /verify-email — resend + refresh actions. */
export function VerifyEmailScreen({ email, error }: { email: string; error?: string }) {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  async function handleResend() {
    setResending(true);
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; alreadyVerified?: boolean };
      if (data.alreadyVerified) {
        window.location.assign("/beta");
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? "Could not resend right now. Try again shortly.");
        return;
      }
      setResent(true);
      toast.success("Verification email sent.");
    } catch {
      toast.error("Network error. Try again shortly.");
    } finally {
      setResending(false);
    }
  }

  async function handleSignOut() {
    try { await fetch("/api/auth/signout", { method: "POST" }); } catch { /* ignore */ }
    window.location.href = "/signin";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F8F9] px-4">
      <div className="w-full max-w-[460px]">
        {/* Brand */}
        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[#0B0D0F] text-[13px] font-bold text-white">V</div>
          <span className="text-[15px] font-bold tracking-[-0.02em] text-[#0B0D0F]">Vectorbea</span>
        </div>

        <div className="rounded-[14px] border border-[#E0E3E6] bg-white p-8 shadow-[0_12px_36px_rgba(11,13,15,0.06)]">
          <span className="flex h-11 w-11 items-center justify-center rounded-[11px] border border-[#9CCFBB] bg-[#E6F4EF]">
            <MailCheck className="h-5 w-5 text-[#007F4E]" />
          </span>

          <p className="mt-5 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">One more step</p>
          <h1 className="mt-1 text-[22px] font-bold leading-tight tracking-[-0.02em] text-[#0B0D0F]">
            Check your inbox
          </h1>
          <p className="mt-3 text-[13.5px] leading-[1.7] text-[#4B5563]">
            We sent a verification link to <span className="font-semibold text-[#0B0D0F]">{email}</span>.
            Click it to confirm your address — then you&apos;ll land on the private-beta application.
          </p>

          {error === "invalid_or_expired" && (
            <div className="mt-4 rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5 text-[12.5px] font-medium text-[#92400E]">
              That link is invalid or has expired. Send yourself a fresh one below.
            </div>
          )}
          {error === "server" && (
            <div className="mt-4 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-[12.5px] font-medium text-[#B91C1C]">
              Something went wrong on our side. Try the link again in a moment.
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-[9px] bg-[#0B0D0F] text-[13.5px] font-semibold text-white transition-colors hover:bg-[#23272B]"
            >
              <CheckCircle2 className="h-4 w-4" /> I&apos;ve verified — continue
            </button>
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={resending || resent}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-[9px] border border-[#E0E3E6] bg-white text-[13.5px] font-medium text-[#374151] transition-colors hover:bg-[#F7F8F9] disabled:opacity-50"
            >
              {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {resent ? "Email sent — check spam too" : "Resend verification email"}
            </button>
          </div>

          <p className="mt-5 border-t border-[#F1F2F4] pt-4 text-[12px] leading-[1.6] text-[#9CA3AF]">
            Wrong address?{" "}
            <button type="button" onClick={() => void handleSignOut()} className="font-medium text-[#007F4E] hover:underline">
              Sign out
            </button>{" "}
            and create the account again with the right email.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-[#9CA3AF] transition-colors hover:text-[#0B0D0F]"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </div>
  );
}
